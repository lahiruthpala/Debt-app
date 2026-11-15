import {randomUUID} from "node:crypto"
import {del,list} from "@vercel/blob"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const noStore={"Cache-Control":"private, no-store"}
const respond=(body:unknown,status=200)=>Response.json(body,{status,headers:noStore})
class MaintenanceError extends Error {constructor(public status:number,message:string){super(message)}}
function guard(req:Request){
  const origin=req.headers.get("origin")
  if(origin){
    try{
      const url=new URL(req.url)
      const host=req.headers.get("host")
      if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(origin).origin))return
    }catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new MaintenanceError(403,"Request origin rejected")
}
async function admin(req:Request){
  const allow=(process.env.DEBT_ADMIN_EMAILS||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean)
  if(!allow.length)throw new MaintenanceError(403,"Administration is not configured")
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new MaintenanceError(503,"Administration is unavailable")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new MaintenanceError(401,"Sign in required")
  if(!allow.includes(session.user.email.trim().toLowerCase()))
    throw new MaintenanceError(403,"Administrative access required")
  const {rows}=await getPool().query<{adult_confirmed:boolean}>(
    "SELECT adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new MaintenanceError(403,"Complete your profile first")
  return session.user.id
}
function fail(error:unknown){
  if(error instanceof MaintenanceError)return respond({error:error.message},error.status)
  console.error("Maintenance:",error instanceof Error?error.message:"Unknown")
  return respond({error:"Maintenance operation failed"},500)
}
export async function GET(req:Request){
  try{
    await admin(req)
    const {rows}=await getPool().query("SELECT a.id,a.action,a.details,a.created_at,p.handle AS actor_handle "+
      "FROM operations_audit a LEFT JOIN profiles p ON p.id=a.actor_id "+
      "ORDER BY a.created_at DESC LIMIT 50")
    return respond({admin:true,blobConfigured:Boolean(process.env.BLOB_READ_WRITE_TOKEN),audit:rows})
  }catch(error){return fail(error)}
}
export async function POST(req:Request){
  try{
    guard(req)
    const actor=await admin(req)
    const body=await req.json().catch(()=>null)
    const valid=z.object({action:z.literal("cleanup-proofs"),dryRun:z.boolean()}).safeParse(body)
    if(!valid.success)throw new MaintenanceError(400,"Specify a cleanup action and dry-run flag")
    if(!process.env.BLOB_READ_WRITE_TOKEN)
      throw new MaintenanceError(503,"Private Blob storage is not configured")
    const dryRun=valid.data.dryRun
    const {rows}=await getPool().query<{blob_path:string}>(
      "SELECT blob_path FROM proof_submissions WHERE blob_path IS NOT NULL UNION ALL "+
      "SELECT blob_path FROM assignment_step_evidence WHERE blob_path IS NOT NULL")
    const referenced=new Set(rows.map(row=>row.blob_path))
    const threshold=Date.now()-48*3600000
    const candidates:string[]=[]
    let scanned=0,pages=0,cursor:string|undefined
    // Strict scan and delete budgets: never sweep the entire bucket without review.
    do{
      const page=await list({prefix:"private-proofs/",limit:250,cursor})
      for(const blob of page.blobs){
        scanned++
        if(!referenced.has(blob.pathname)&&new Date(blob.uploadedAt).getTime()<threshold)
          candidates.push(blob.pathname)
      }
      pages++
      cursor=page.hasMore?page.cursor:undefined
    }while(cursor&&pages<4)
    let deleted=0
    const errors:string[]=[]
    if(!dryRun){
      for(const path of candidates.slice(0,25)){
        // Recheck just before deletion so concurrent uploads are never erased.
        const verify=await getPool().query(
          "SELECT 1 FROM proof_submissions WHERE blob_path=$1 "+
          "UNION ALL SELECT 1 FROM assignment_step_evidence WHERE blob_path=$1 LIMIT 1",[path])
        if(verify.rowCount)continue
        try{await del(path);deleted++}
        catch(error){errors.push(error instanceof Error?error.message:"Deletion failed")}
      }
    }
    const result={dryRun,scanned,pages,orphanCandidates:candidates.length,
      deleted,remaining:Math.max(0,candidates.length-deleted),capped:pages===4||candidates.length>25,
      errors:errors.length}
    await getPool().query("INSERT INTO operations_audit(id,actor_id,action,details) VALUES($1,$2,$3,$4)",
      [randomUUID(),actor,dryRun?"proof-janitor-preview":"proof-janitor-apply",JSON.stringify(result)])
    return respond(result)
  }catch(error){return fail(error)}
}
