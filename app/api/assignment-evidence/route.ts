import {randomUUID} from "node:crypto"
import {put,get,del} from "@vercel/blob"
import sharp from "sharp"
import {z} from "zod"
import type {PoolClient} from "pg"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {assignmentInput} from "@/lib/scene-platform"
import {maxProofBytes,isAllowedImageType} from "@/lib/proof-rules"

export const runtime="nodejs"
export const dynamic="force-dynamic"
class EvidenceError extends Error{constructor(public status:number,message:string){super(message)}}
const uuid=z.string().uuid(),respond=(body:unknown,status=200)=>Response.json(body,{status,headers:{"Cache-Control":"private, no-store"}})
function parse<T>(schema:z.ZodType<T>,input:unknown):T{
  const result=schema.safeParse(input)
  if(!result.success)throw new EvidenceError(400,result.error.issues[0]?.message||"Invalid evidence input")
  return result.data
}
function origin(req:Request){
  const from=req.headers.get("origin"),url=new URL(req.url),host=req.headers.get("host")
  if(from){
    try{if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(from).origin))return}catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new EvidenceError(403,"Request origin rejected")
}
async function user(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new EvidenceError(503,"Private evidence is not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new EvidenceError(401,"Sign in required")
  const {rows}=await getPool().query<{id:string;role:"dom"|"sub";adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new EvidenceError(403,"Complete your adult profile")
  return rows[0]
}
async function assignmentFor(db:PoolClient,id:string,actorId:string,lock=false){
  const {rows}=await db.query(
    "SELECT a.*,s.status AS scene_status,c.state AS connection_state "+
    "FROM scene_assignments a JOIN scenes s ON s.id=a.scene_id "+
    "JOIN connections c ON c.id=s.connection_id "+
    "WHERE a.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+
    (lock?"FOR UPDATE OF a":""),
    [id,actorId])
  if(!rows.length)throw new EvidenceError(404,"Assignment not available")
  return rows[0]
}
async function evidenceFor(db:PoolClient,id:string,actorId:string,lock=false){
  const {rows}=await db.query(
    "SELECT e.*,a.status AS assignment_status,a.next_step,s.status AS scene_status,c.state AS connection_state,"+
    "c.sender_id,c.recipient_id FROM assignment_step_evidence e "+
    "JOIN scene_assignments a ON a.id=e.assignment_id "+
    "JOIN scenes s ON s.id=e.scene_id JOIN connections c ON c.id=s.connection_id "+
    "WHERE e.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+
    (lock?"FOR UPDATE OF e":""),
    [id,actorId])
  if(!rows.length)throw new EvidenceError(404,"Evidence not found")
  return rows[0]
}
function active(row:{scene_status:string;connection_state:string}){
  if(row.scene_status!=="active"||row.connection_state!=="active")
    throw new EvidenceError(409,"An active mutual scene is required")
}
function failure(e:unknown){
  if(e instanceof EvidenceError)return respond({error:e.message},e.status)
  if((e as {code?:string})?.code==="23505")return respond({error:"Evidence was already submitted"},409)
  console.error("Assignment evidence:",e instanceof Error?e.message:"Unknown error")
  return respond({error:"Unable to handle assignment evidence"},500)
}
export async function GET(req:Request){
  try{
    const actor=await user(req),url=new URL(req.url)
    const view=url.searchParams.get("view")||"list"
    if(view==="image"){
      const id=parse(uuid,url.searchParams.get("id"))
      const db=await getPool().connect()
      let path:string
      try{
        const row=await evidenceFor(db,id,actor.id)
        if(row.deleted_at||!row.blob_path||
          (row.connection_state!=="active"&&row.uploader_id!==actor.id))
          throw new EvidenceError(404,"Evidence image not available")
        path=row.blob_path
      }finally{db.release()}
      const blob=await get(path,{access:"private"})
      if(!blob||blob.statusCode!==200)throw new EvidenceError(404,"Image no longer available")
      return new Response(blob.stream,{headers:{
        "Content-Type":"image/webp","Content-Disposition":'inline; filename="task-proof.webp"',
        "Content-Security-Policy":"sandbox; default-src 'none'; frame-ancestors 'none'",
        "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
        "X-Frame-Options":"DENY","Referrer-Policy":"no-referrer"
      }})
    }
    if(view!=="list")throw new EvidenceError(400,"Unknown evidence view")
    const assignmentId=parse(uuid,url.searchParams.get("assignmentId"))
    const db=await getPool().connect()
    try{
      const task=await assignmentFor(db,assignmentId,actor.id)
      const {rows}=await db.query(
        "SELECT e.id,e.assignment_id,e.step_number,e.status,e.bytes,e.created_at,e.reviewed_at,"+
        "e.review_note,e.deleted_at,e.uploader_id FROM assignment_step_evidence e "+
        "WHERE e.assignment_id=$1 AND ($2='active' OR e.uploader_id=$3) "+
        "ORDER BY e.created_at ASC LIMIT 60",
        [assignmentId,task.connection_state,actor.id])
      return respond({evidence:rows})
    }finally{db.release()}
  }catch(e){return failure(e)}
}
export async function POST(req:Request){
  let uploaded:string|null=null,db:PoolClient|null=null,inTx=false,inserted=false
  try{
    origin(req)
    const actor=await user(req)
    if(actor.role!=="sub")throw new EvidenceError(403,"Only the Sub may upload private step evidence")
    if(!process.env.BLOB_READ_WRITE_TOKEN)throw new EvidenceError(503,"Private Blob storage is not configured")
    const form=await req.formData().catch(()=>{throw new EvidenceError(400,"Upload a photo")})
    const assignmentId=parse(uuid,form.get("assignmentId"))
    if(form.get("consent")!=="yes")throw new EvidenceError(400,"Confirm this is voluntary, non-explicit evidence")
    const file=form.get("file")
    if(!(file instanceof File)||!isAllowedImageType(file.type)||file.size<1||file.size>maxProofBytes)
      throw new EvidenceError(400,"Choose a JPEG, PNG or WebP image smaller than 3MB")
    const pre=await getPool().connect()
    let stepNumber=0,sceneId=""
    try{
      const task=await assignmentFor(pre,assignmentId,actor.id)
      active(task)
      if(task.status!=="active")throw new EvidenceError(409,"Assignment must be active and awaiting this step")
      const steps=assignmentInput.shape.steps.parse(task.steps)
      if(!steps[task.next_step]?.requiresPhoto)throw new EvidenceError(409,"This step does not request photo evidence")
      stepNumber=task.next_step;sceneId=task.scene_id
      const {rows:count}=await pre.query<{n:number}>(
        "SELECT count(*)::int AS n FROM assignment_step_evidence WHERE assignment_id=$1 AND step_number=$2 AND deleted_at IS NULL",
        [assignmentId,stepNumber])
      if(count[0].n>=5)throw new EvidenceError(429,"This step has reached five images")
      const daily=await pre.query<{n:number}>("SELECT count(*)::int AS n FROM assignment_step_evidence "+
        "WHERE uploader_id=$1 AND created_at>now()-interval '24 hours'",[actor.id])
      if(daily.rows[0].n>=12)throw new EvidenceError(429,"Daily private evidence upload limit reached")
    }finally{pre.release()}
    const input=Buffer.from(await file.arrayBuffer())
    const image=sharp(input,{limitInputPixels:20_000_000})
    const metadata=await image.metadata().catch(()=>{throw new EvidenceError(400,"Image could not be decoded")})
    const expected:Record<string,string>={"image/jpeg":"jpeg","image/png":"png","image/webp":"webp"}
    if(metadata.format!==expected[file.type])throw new EvidenceError(400,"File type does not match the actual image")
    const converted=await image.rotate().resize(1600,1600,{fit:"inside",withoutEnlargement:true})
      .webp({quality:82}).toBuffer()
    if(converted.length<1||converted.length>maxProofBytes)throw new EvidenceError(400,"Processed image is too large")
    const evidenceId=randomUUID()
    const blob=await put("private-proofs/assignment-"+evidenceId+".webp",converted,{
      access:"private",contentType:"image/webp",addRandomSuffix:false
    })
    uploaded=blob.pathname
    db=await getPool().connect()
    await db.query("BEGIN");inTx=true
    const task=await assignmentFor(db,assignmentId,actor.id,true)
    active(task)
    if(task.status!=="active"||task.next_step!==stepNumber)throw new EvidenceError(409,"Assignment step changed during upload")
    const steps=assignmentInput.shape.steps.parse(task.steps)
    if(!steps[stepNumber]?.requiresPhoto)throw new EvidenceError(409,"This step no longer needs evidence")
    const count=await db.query<{n:number}>("SELECT count(*)::int AS n FROM assignment_step_evidence "+
      "WHERE assignment_id=$1 AND step_number=$2 AND deleted_at IS NULL",[assignmentId,stepNumber])
    if(count.rows[0].n>=5)throw new EvidenceError(429,"Photo limit reached")
    await db.query("INSERT INTO assignment_step_evidence(id,assignment_id,scene_id,step_number,uploader_id,blob_path,bytes) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7)",[evidenceId,assignmentId,sceneId,stepNumber,actor.id,uploaded,converted.length])
    await db.query("COMMIT");inTx=false;inserted=true
    return respond({id:evidenceId,message:"Private image uploaded. Your partner can review it in Partner Space."},201)
  }catch(e){
    if(db&&inTx)await db.query("ROLLBACK").catch(()=>{})
    if(uploaded&&!inserted)await del(uploaded).catch(()=>{})
    return failure(e)
  }finally{db?.release()}
}
export async function PATCH(req:Request){
  let db:PoolClient|null=null,inTx=false
  try{
    origin(req)
    const actor=await user(req)
    if(actor.role!=="dom")throw new EvidenceError(403,"Only the connected Dom can review images")
    const body=await req.json().catch(()=>null)
    const id=parse(uuid,body?.id),approve=parse(z.boolean(),body?.approve)
    const note=parse(z.string().trim().max(500),body?.note||"")
    if(!approve&&note.length<5)throw new EvidenceError(400,"Add a reason when rejecting evidence")
    db=await getPool().connect()
    await db.query("BEGIN");inTx=true
    const row=await evidenceFor(db,id,actor.id,true)
    active(row)
    if(row.deleted_at||row.status!=="pending"||!["active","submitted"].includes(row.assignment_status)||
      row.next_step!==row.step_number)
      throw new EvidenceError(409,"This evidence can no longer be reviewed")
    await db.query("UPDATE assignment_step_evidence SET status=$1,reviewer_id=$2,review_note=$3,reviewed_at=now() WHERE id=$4",
      [approve?"approved":"rejected",actor.id,note,id])
    await db.query("COMMIT");inTx=false
    return respond({message:approve?"Step evidence approved.":"Step evidence rejected with reason."})
  }catch(e){if(db&&inTx)await db.query("ROLLBACK").catch(()=>{});return failure(e)}
  finally{db?.release()}
}
export async function DELETE(req:Request){
  let db:PoolClient|null=null,inTx=false
  try{
    origin(req)
    const actor=await user(req)
    const body=await req.json().catch(()=>null),id=parse(uuid,body?.id)
    db=await getPool().connect()
    await db.query("BEGIN");inTx=true
    const row=await evidenceFor(db,id,actor.id,true)
    if(row.uploader_id!==actor.id)throw new EvidenceError(403,"Only the uploader may erase their proof")
    if(row.deleted_at||!row.blob_path)throw new EvidenceError(409,"Evidence already erased")
    await del(row.blob_path)
    await db.query("UPDATE assignment_step_evidence SET blob_path=NULL,deleted_at=now(),"+
      "status=CASE WHEN status='pending' THEN 'rejected' ELSE status END WHERE id=$1",[id])
    await db.query("COMMIT");inTx=false
    return respond({message:"Private evidence file erased. Audit metadata is retained."})
  }catch(e){if(db&&inTx)await db.query("ROLLBACK").catch(()=>{});return failure(e)}
  finally{db?.release()}
}
