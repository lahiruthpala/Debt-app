import {randomUUID} from "node:crypto"
import {put,get,del} from "@vercel/blob"
import sharp from "sharp"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import type {PoolClient} from "pg"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const uuid=z.string().uuid()
class UploadError extends Error{constructor(public statusCode:number,message:string){super(message)}}
const reply=(v:unknown,status=200)=>Response.json(v,{status,headers:{"Cache-Control":"private, no-store"}})
function parse<T>(schema:z.ZodType<T>,value:unknown):T{
  const x=schema.safeParse(value)
  if(!x.success)throw new UploadError(400,x.error.issues[0]?.message||"Invalid upload request")
  return x.data
}
function origin(req:Request){
  const o=req.headers.get("origin"),u=new URL(req.url),h=req.headers.get("host")
  if(o){try{if([u.origin,...(h?[u.protocol+"//"+h]:[])].includes(new URL(o).origin))return}catch{}}
  else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new UploadError(403,"Request origin rejected")
}
async function actor(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)throw new UploadError(503,"Proof service unavailable")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new UploadError(401,"Sign in")
  const {rows}=await getPool().query<{id:string;role:string;adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new UploadError(403,"Complete your adult profile")
  return rows[0]
}
function fail(e:unknown){
  if(e instanceof UploadError)return reply({error:e.message},e.statusCode)
  console.error("Campaign proof:",e instanceof Error?e.message:"Unknown error")
  return reply({error:"Campaign evidence request failed"},500)
}
async function authorizedRecord(db:PoolClient,kind:"contribution"|"task",targetId:string,campaignId:string,actorId:string,lock=false){
  const table=kind==="task"?"campaign_task_claims":"campaign_contributions"
  const sql="SELECT t.id,t.campaign_id,t.member_id,t.status,c.creator_id,c.status AS campaign_status,"+
    "m.status AS membership_status FROM "+table+" t JOIN campaigns c ON c.id=t.campaign_id "+
    "JOIN campaign_memberships m ON m.campaign_id=t.campaign_id AND m.member_id=t.member_id "+
    "WHERE t.id=$1 AND t.campaign_id=$2 AND (t.member_id=$3 OR c.creator_id=$3) "+(lock?"FOR UPDATE OF t":"")
  const {rows}=await db.query(sql,[targetId,campaignId,actorId])
  if(!rows[0])throw new UploadError(404,"Record not found")
  return rows[0] as {id:string;member_id:string;creator_id:string;status:string;campaign_status:string;membership_status:string}
}
async function proof(db:PoolClient,id:string,userId:string){
  const {rows}=await db.query("SELECT e.*,c.creator_id FROM campaign_evidence e JOIN campaigns c ON c.id=e.campaign_id "+
    "WHERE e.id=$1 AND (e.uploader_id=$2 OR c.creator_id=$2)",[id,userId])
  if(!rows[0])throw new UploadError(404,"Private evidence not available")
  return rows[0] as {id:string;blob_path:string|null;uploader_id:string;content_type:string;deleted_at:Date|null}
}
export async function GET(req:Request){
  try{
    const u=await actor(req),url=new URL(req.url),view=url.searchParams.get("view")||"list"
    const db=await getPool().connect()
    try{
      if(view==="file"){
        const id=parse(uuid,url.searchParams.get("id"))
        const row=await proof(db,id,u.id)
        if(row.deleted_at||!row.blob_path)throw new UploadError(404,"Evidence was erased")
        const blob=await get(row.blob_path,{access:"private"})
        if(!blob||blob.statusCode!==200)throw new UploadError(404,"File not found")
        const isPdf=row.content_type==="application/pdf"
        return new Response(blob.stream,{headers:{
          "Content-Type":isPdf?"application/pdf":"image/webp",
          "Content-Disposition":isPdf?'attachment; filename="campaign-proof.pdf"':'inline; filename="campaign-proof.webp"',
          "Content-Security-Policy":"sandbox; default-src 'none'; frame-ancestors 'none'",
          "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY",
          "Referrer-Policy":"no-referrer","Cache-Control":"private, no-store"
        }})
      }
      if(view!=="list")throw new UploadError(400,"Unknown evidence view")
      const campaignId=parse(uuid,url.searchParams.get("campaignId"))
      const kind=parse(z.enum(["contribution","task"]),url.searchParams.get("kind"))
      const targetId=parse(uuid,url.searchParams.get("targetId"))
      await authorizedRecord(db,kind,targetId,campaignId,u.id)
      const field=kind==="task"?"claim_id":"contribution_id"
      const {rows}=await db.query("SELECT id,created_at,bytes,content_type,deleted_at,uploader_id FROM campaign_evidence "+
        "WHERE campaign_id=$1 AND "+field+"=$2 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 5",
        [campaignId,targetId])
      return reply({evidence:rows})
    }finally{db.release()}
  }catch(e){return fail(e)}
}
export async function POST(req:Request){
  let path:string|null=null,db:PoolClient|null=null,tx=false,persisted=false
  try{
    origin(req)
    const u=await actor(req)
    if(u.role!=="sub")throw new UploadError(403,"Only Sub participants can upload campaign evidence")
    if(!process.env.BLOB_READ_WRITE_TOKEN)throw new UploadError(503,"Private Blob storage not configured")
    const form=await req.formData().catch(()=>{throw new UploadError(400,"Invalid upload")})
    const campaignId=parse(uuid,form.get("campaignId"))
    const kind=parse(z.enum(["contribution","task"]),form.get("kind"))
    const targetId=parse(uuid,form.get("targetId"))
    if(form.get("consent")!=="yes")throw new UploadError(400,"Confirm voluntary, non-explicit evidence")
    const file=form.get("file")
    if(!(file instanceof File)||file.size<1||file.size>4000000)
      throw new UploadError(400,"Image or PDF must be under 4 MB")
    const isPdf=file.type==="application/pdf"
    const isImage=["image/jpeg","image/png","image/webp"].includes(file.type)
    if(!isPdf&&!isImage)throw new UploadError(400,"Only JPEG, PNG, WebP and PDF evidence is permitted")
    if(isImage&&file.size>3000000)throw new UploadError(400,"Images must be under 3 MB")
    const pre=await getPool().connect()
    try{
      const r=await authorizedRecord(pre,kind,targetId,campaignId,u.id)
      if(r.member_id!==u.id||r.status!=="pending"||r.membership_status!=="active")
        throw new UploadError(409,"Only an active participant can upload for a pending submission")
      const field=kind==="task"?"claim_id":"contribution_id"
      const count=await pre.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_evidence WHERE "+
        field+"=$1 AND deleted_at IS NULL",[targetId])
      if(count.rows[0].n>=3)throw new UploadError(429,"Three-file limit reached")
      const daily=await pre.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_evidence WHERE "+
        "uploader_id=$1 AND created_at>now()-interval '24 hours'",[u.id])
      if(daily.rows[0].n>=12)throw new UploadError(429,"Daily upload limit reached")
    }finally{pre.release()}
    let buffer=Buffer.from(await file.arrayBuffer()),type="image/webp"
    if(isImage){
      const input=sharp(buffer,{limitInputPixels:20000000})
      const metadata=await input.metadata().catch(()=>{throw new UploadError(400,"Unreadable image")})
      const expected:Record<string,string>={"image/jpeg":"jpeg","image/png":"png","image/webp":"webp"}
      if(metadata.format!==expected[file.type])throw new UploadError(400,"File contents do not match image type")
      buffer=await input.rotate().resize(1600,1600,{fit:"inside",withoutEnlargement:true}).webp({quality:80}).toBuffer()
      if(buffer.length>3000000)throw new UploadError(400,"Processed image too large")
    }else{
      type="application/pdf"
      const start=buffer.subarray(0,8).toString("ascii"),end=buffer.subarray(-2048).toString("latin1")
      if(!start.startsWith("%PDF-")||!end.includes("%%EOF"))
        throw new UploadError(400,"Invalid PDF structure")
    }
    const id=randomUUID()
    const obj=await put("private-proofs/campaign-"+id+(isPdf?".pdf":".webp"),buffer,{
      access:"private",contentType:type,addRandomSuffix:false
    })
    path=obj.pathname
    db=await getPool().connect()
    await db.query("BEGIN");tx=true
    const r=await authorizedRecord(db,kind,targetId,campaignId,u.id,true)
    if(r.member_id!==u.id||r.status!=="pending"||r.membership_status!=="active")
      throw new UploadError(409,"Submission status changed during upload")
    const field=kind==="task"?"claim_id":"contribution_id"
    const count=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_evidence WHERE "+
      field+"=$1 AND deleted_at IS NULL",[targetId])
    if(count.rows[0].n>=3)throw new UploadError(429,"Evidence limit reached")
    await db.query("INSERT INTO campaign_evidence(id,campaign_id,uploader_id,contribution_id,claim_id,blob_path,bytes,content_type) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [id,campaignId,u.id,kind==="contribution"?targetId:null,kind==="task"?targetId:null,path,buffer.length,type])
    await db.query("INSERT INTO campaign_events(id,campaign_id,actor_id,event_type,subject_id) VALUES($1,$2,$3,'proof.uploaded',$4)",
      [randomUUID(),campaignId,u.id,id])
    await db.query("COMMIT");tx=false;persisted=true
    return reply({id,message:"Private evidence uploaded for creator review"},201)
  }catch(e){
    if(db&&tx)await db.query("ROLLBACK").catch(()=>{})
    if(path&&!persisted)await del(path).catch(()=>{})
    return fail(e)
  }finally{db?.release()}
}
export async function DELETE(req:Request){
  let db:PoolClient|null=null,tx=false
  try{
    origin(req)
    const u=await actor(req)
    const body=await req.json().catch(()=>null),id=parse(uuid,body?.id)
    db=await getPool().connect()
    await db.query("BEGIN");tx=true
    const row=await proof(db,id,u.id)
    if(row.uploader_id!==u.id)throw new UploadError(403,"Only the uploader may erase evidence")
    if(row.deleted_at||!row.blob_path)throw new UploadError(409,"Evidence already erased")
    await del(row.blob_path)
    await db.query("UPDATE campaign_evidence SET blob_path=NULL,deleted_at=now() WHERE id=$1",[id])
    await db.query("COMMIT");tx=false
    return reply({message:"Private file erased; minimum audit metadata retained"})
  }catch(e){if(db&&tx)await db.query("ROLLBACK").catch(()=>{});return fail(e)}
  finally{db?.release()}
}
