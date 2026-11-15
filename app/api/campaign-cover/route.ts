import {randomUUID} from "node:crypto"
import {put,get,del} from "@vercel/blob"
import sharp from "sharp"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"

export const runtime="nodejs"
export const dynamic="force-dynamic"
class CoverError extends Error{constructor(public statusCode:number,message:string){super(message)}}
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}})
function origin(req:Request){
  const a=req.headers.get("origin"),u=new URL(req.url),host=req.headers.get("host")
  if(a){try{if([u.origin,...(host?[u.protocol+"//"+host]:[])].includes(new URL(a).origin))return}catch{}}
  else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new CoverError(403,"Origin rejected")
}
async function who(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)throw new CoverError(503,"Cover storage unavailable")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new CoverError(401,"Sign in")
  const {rows}=await getPool().query<{id:string;role:string;adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new CoverError(403,"Adult account required")
  return rows[0]
}
function failed(e:unknown){
  if(e instanceof CoverError)return respond({error:e.message},e.statusCode)
  console.error("Campaign cover:",e instanceof Error?e.message:"Unknown error")
  return respond({error:"Campaign cover operation failed"},500)
}
async function accessible(id:string,viewerId:string){
  const {rows}=await getPool().query("SELECT c.id,c.creator_id,c.status,c.visibility,c.cover_blob_path "+
    "FROM campaigns c WHERE c.id=$1",[id])
  if(!rows[0])throw new CoverError(404,"Campaign not found")
  const c=rows[0]
  if(c.creator_id===viewerId)return c
  if(c.status==="draft")throw new CoverError(404,"Campaign not found")
  const blocked=await getPool().query("SELECT 1 FROM connections WHERE state='blocked' "+
    "AND ((sender_id=$1 AND recipient_id=$2) OR (recipient_id=$1 AND sender_id=$2))",[c.creator_id,viewerId])
  if(blocked.rowCount)throw new CoverError(404,"Cover unavailable")
  if(c.visibility==="restricted"){
    const member=await getPool().query("SELECT 1 FROM campaign_memberships WHERE campaign_id=$1 AND member_id=$2 "+
      "AND status IN ('invited','pending','active')",[id,viewerId])
    if(!member.rowCount)throw new CoverError(404,"Cover unavailable")
  }
  return c
}
export async function GET(req:Request){
  try{
    const user=await who(req),id=z.string().uuid().parse(new URL(req.url).searchParams.get("id"))
    const c=await accessible(id,user.id)
    if(!c.cover_blob_path)throw new CoverError(404,"No cover uploaded")
    const blob=await get(c.cover_blob_path,{access:"private"})
    if(!blob||blob.statusCode!==200)throw new CoverError(404,"Cover file no longer available")
    return new Response(blob.stream,{headers:{
      "Content-Type":"image/webp","Content-Disposition":'inline; filename="campaign-cover.webp"',
      "Content-Security-Policy":"sandbox; default-src 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer",
      "Cache-Control":"private, no-store"
    }})
  }catch(e){return failed(e)}
}
export async function POST(req:Request){
  let uploaded:string|null=null,persisted=false
  try{
    origin(req)
    const user=await who(req)
    if(user.role!=="dom")throw new CoverError(403,"Creator account required")
    if(!process.env.BLOB_READ_WRITE_TOKEN)throw new CoverError(503,"Blob storage is not configured")
    const data=await req.formData().catch(()=>null)
    const id=z.string().uuid().safeParse(data?.get("campaignId"))
    if(!id.success)throw new CoverError(400,"Invalid campaign")
    if(data?.get("consent")!=="yes")throw new CoverError(400,"Confirm the image is safe to publish")
    const file=data?.get("file")
    if(!(file instanceof File)||!["image/jpeg","image/png","image/webp"].includes(file.type)||
      file.size<1||file.size>3000000)throw new CoverError(400,"Select a JPEG/PNG/WebP image under 3MB")
    const c=await accessible(id.data,user.id)
    if(c.creator_id!==user.id||c.status!=="draft")throw new CoverError(403,"Only draft owners may upload covers")
    const image=sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:20000000})
    const meta=await image.metadata().catch(()=>{throw new CoverError(400,"Image is unreadable")})
    const expected:Record<string,string>={"image/jpeg":"jpeg","image/png":"png","image/webp":"webp"}
    if(meta.format!==expected[file.type])throw new CoverError(400,"Mismatched image type")
    const bytes=await image.rotate().resize(1600,900,{fit:"cover"}).webp({quality:82}).toBuffer()
    if(bytes.length>3000000)throw new CoverError(400,"Processed cover exceeds size cap")
    const blob=await put("private-proofs/campaign-cover-"+randomUUID()+".webp",bytes,{
      access:"private",contentType:"image/webp",addRandomSuffix:false
    })
    uploaded=blob.pathname
    const result=await getPool().query("UPDATE campaigns SET cover_blob_path=$1,updated_at=now() "+
      "WHERE id=$2 AND creator_id=$3 AND status='draft' RETURNING id",[uploaded,id.data,user.id])
    if(!result.rowCount)throw new CoverError(409,"Campaign was published or removed during upload")
    persisted=true
    if(c.cover_blob_path)await del(c.cover_blob_path).catch(()=>{})
    return respond({message:"Campaign cover saved"})
  }catch(e){
    if(uploaded&&!persisted)await del(uploaded).catch(()=>{})
    return failed(e)
  }
}
