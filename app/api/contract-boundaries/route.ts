import {randomUUID} from "node:crypto"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {contractModuleSchema,type ContractModule} from "@/lib/contract-rules"

export const runtime="nodejs"
export const dynamic="force-dynamic"
class BoundaryError extends Error{constructor(public status:number,message:string){super(message)}}
const uuid=z.string().uuid()
const noteSchema=z.string().trim().max(500)
const replySchema=z.string().trim().min(1).max(700)
function checked<T>(schema:z.ZodType<T>,input:unknown):T{
  const result=schema.safeParse(input)
  if(!result.success)throw new BoundaryError(400,result.error.issues[0]?.message||"Invalid request")
  return result.data
}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}})
function sameOrigin(req:Request){
  const origin=req.headers.get("origin")
  if(origin){
    try{
      const url=new URL(req.url),host=req.headers.get("host")
      if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(origin).origin))return
    }catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new BoundaryError(403,"Request origin rejected")
}
async function identity(req:Request){
  if(!process.env.BETTER_AUTH_SECRET||!process.env.DATABASE_URL)throw new BoundaryError(503,"Service not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new BoundaryError(401,"Sign in to continue")
  const {rows}=await getPool().query<{id:string;role:"dom"|"sub";adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new BoundaryError(403,"Complete your adult profile first")
  return rows[0]
}
async function access(db:PoolClient,sceneId:string,userId:string,lock=false){
  const {rows}=await db.query(
    "SELECT s.id,s.status,c.state AS connection_state,sc.modules_snapshot "+
    "FROM scenes s JOIN scene_contracts sc ON sc.scene_id=s.id "+
    "JOIN connections c ON c.id=s.connection_id "+
    "WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+(lock?"FOR UPDATE OF s":""),
    [sceneId,userId])
  if(!rows.length)throw new BoundaryError(404,"Contract not found")
  const scene=rows[0] as {id:string;status:string;connection_state:string;modules_snapshot:unknown}
  const modules=z.array(contractModuleSchema).min(1).max(8).safeParse(scene.modules_snapshot)
  if(!modules.success)throw new BoundaryError(500,"Stored contract configuration is invalid")
  return {scene,modules:modules.data}
}
function active(scene:{status:string;connection_state:string}){
  if(scene.status!=="active"||scene.connection_state!=="active")
    throw new BoundaryError(409,"This contract is not active. Either partner may pause or end it.")
}
function requireModule(modules:ContractModule[],id:string,kind:"lock"|"permission"|"journal"){
  const item=modules.find(m=>m.id===id&&m.type===kind)
  if(!item||item.type!==kind)throw new BoundaryError(404,"Module not included in this contract")
  return item
}
async function writeAudit(db:PoolClient,sceneId:string,moduleId:string,actorId:string,action:string,details:Record<string,unknown>={}){
  await db.query(
    "INSERT INTO contract_action_log(id,scene_id,module_id,actor_id,action,delta,details) "+
    "VALUES($1,$2,$3,$4,$5,0,$6)",
    [randomUUID(),sceneId,moduleId,actorId,action,JSON.stringify(details)])
}
function failure(error:unknown){
  if(error instanceof BoundaryError)return json({error:error.message},error.status)
  if((error as {code?:string})?.code==="23505")return json({error:"An identical pending request already exists"},409)
  console.error("Private contract status:",error instanceof Error?error.message:"Unexpected error")
  return json({error:"Unable to perform contract action"},500)
}
export async function GET(req:Request){
  let db:PoolClient|null=null
  try{
    const player=await identity(req)
    const sceneId=checked(uuid,new URL(req.url).searchParams.get("sceneId"))
    db=await getPool().connect()
    const {scene,modules}=await access(db,sceneId,player.id)
    // A pg PoolClient can only execute one query at a time. Parallel calls here
    // caused pg's "client.query() while already executing" deprecation warning
    // and will stop working under pg 9. Serialize on the checked-out client.
    const state=await db.query(
      "SELECT module_id,locked_since,permission_status,release_last_at,updated_at FROM contract_boundary_state WHERE scene_id=$1",[sceneId])
    const requests=await db.query(
      "SELECT r.id,r.module_id,r.kind,r.status,r.note,r.response,r.created_at,r.reviewed_at,p.handle AS requester_handle "+
      "FROM contract_boundary_requests r JOIN profiles p ON p.id=r.requester_id "+
      "WHERE r.scene_id=$1 ORDER BY r.created_at DESC LIMIT 50",[sceneId])
    const entries=await db.query(
      "SELECT j.id,j.module_id,j.body,j.reply,j.created_at,j.replied_at,p.handle AS author_handle "+
      "FROM contract_private_journal j JOIN profiles p ON p.id=j.author_id "+
      "WHERE j.scene_id=$1 ORDER BY j.created_at DESC LIMIT 40",[sceneId])
    const readyLockProofs=await db.query(
      "SELECT id,module_id FROM proof_submissions WHERE scene_id=$1 AND submitter_id=$2 "+
      "AND kind='lock' AND status='pending' AND lock_request_id IS NULL "+
      "AND deleted_at IS NULL AND blob_path IS NOT NULL ORDER BY created_at DESC",[sceneId,player.id])
    const approvedLocks=await db.query<{module_id:string}>(
      "SELECT DISTINCT module_id FROM contract_boundary_requests "+
      "WHERE scene_id=$1 AND kind='lock' AND status='approved'",[sceneId])
    return json({status:scene.status,state:state.rows,requests:requests.rows,entries:entries.rows,
      readyLockProofs:readyLockProofs.rows,
      approvedLockModules:approvedLocks.rows.map(row=>row.module_id),
      modules:modules.filter(m=>["lock","permission","journal","calendar"].includes(m.type))})
  }catch(e){return failure(e)}finally{db?.release()}
}
export async function POST(req:Request){
  let db:PoolClient|null=null,transaction=false
  try{
    sameOrigin(req)
    const player=await identity(req)
    const body=await req.json().catch(()=>{throw new BoundaryError(400,"Invalid JSON")})
    const action=checked(z.enum([
      "set_lock","request_lock","set_permission","record_release","request_unlock","request_release",
      "request_inspection","review_request","respond_inspection","journal","reply_journal","erase_private_data","delete_journal"
    ]),body?.action)
    const sceneId=checked(uuid,body.sceneId)
    db=await getPool().connect()
    await db.query("BEGIN");transaction=true
    const {scene,modules}=await access(db,sceneId,player.id,true)
    // Personal data can be removed by its owner even after a scene has ended.
    if(action==="erase_private_data"){
      if(player.role!=="sub")throw new BoundaryError(403,"Only the Sub may erase their private counter data")
      await db.query("UPDATE proof_submissions SET status='rejected' "+
        "WHERE scene_id=$1 AND submitter_id=$2 AND kind='lock' AND status='pending'",[sceneId,player.id])
      await db.query("DELETE FROM contract_boundary_state WHERE scene_id=$1",[sceneId])
      await db.query("DELETE FROM contract_private_journal WHERE scene_id=$1 AND author_id=$2",[sceneId,player.id])
      await db.query("DELETE FROM contract_boundary_requests WHERE scene_id=$1 AND requester_id=$2",[sceneId,player.id])
      await db.query("UPDATE contract_boundary_requests SET response='' WHERE scene_id=$1 AND reviewed_by=$2",[sceneId,player.id])
      await db.query("COMMIT");transaction=false
      return json({message:"Private self-reports and journal entries erased. Audit metadata remains."})
    }
    if(action==="delete_journal"){
      if(player.role!=="sub")throw new BoundaryError(403,"Only the entry author may delete their private journal")
      const entryId=checked(uuid,body.entryId)
      const {rowCount}=await db.query(
        "DELETE FROM contract_private_journal WHERE id=$1 AND scene_id=$2 AND author_id=$3",
        [entryId,sceneId,player.id])
      if(!rowCount)throw new BoundaryError(404,"Your journal entry was not found")
      await db.query("COMMIT");transaction=false
      return json({message:"Journal entry deleted. Audit metadata remains."})
    }
    active(scene)
    const subOnly=()=>{if(player.role!=="sub")throw new BoundaryError(403,"Only the Sub may make this self-report")}
    const domOnly=()=>{if(player.role!=="dom")throw new BoundaryError(403,"Only the Dom may review this request")}
    let message="Contract status updated",moduleId=""
    if(action==="review_request"||action==="respond_inspection"){
      const requestId=checked(uuid,body.requestId)
      const {rows}=await db.query(
        "SELECT * FROM contract_boundary_requests WHERE id=$1 AND scene_id=$2 FOR UPDATE",[requestId,sceneId])
      const request=rows[0]
      if(!request||request.status!=="pending")throw new BoundaryError(409,"Request is unavailable or already reviewed")
      moduleId=request.module_id
      if(action==="review_request"){
        domOnly()
        if(request.kind==="inspection")throw new BoundaryError(400,"Only the Sub can respond to an inspection")
        if(request.kind==="lock")throw new BoundaryError(409,"Review the linked lock photo in Proof Center")
        const approved=checked(z.boolean(),body.approve)
        const response=checked(noteSchema,body.response??"")
        const status=approved?"approved":"declined"
        await db.query("UPDATE contract_boundary_requests SET status=$1,response=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4",
          [status,response,player.id,requestId])
        if(approved&&request.kind==="unlock"){
          const current=await db.query("SELECT locked_since FROM contract_boundary_state WHERE scene_id=$1 AND module_id=$2",
            [sceneId,moduleId])
          if(!current.rows[0]?.locked_since)throw new BoundaryError(409,"Lock state is no longer active")
          await db.query("INSERT INTO contract_boundary_state(scene_id,module_id,locked_since) VALUES($1,$2,NULL) "+
            "ON CONFLICT(scene_id,module_id) DO UPDATE SET locked_since=NULL,updated_at=now()",[sceneId,moduleId])
        }else if(approved&&request.kind==="release"){
          await db.query("INSERT INTO contract_boundary_state(scene_id,module_id,permission_status) VALUES($1,$2,'allowed') "+
            "ON CONFLICT(scene_id,module_id) DO UPDATE SET permission_status='allowed',updated_at=now()",[sceneId,moduleId])
        }
        await writeAudit(db,sceneId,moduleId,player.id,"request_review",{kind:request.kind,status})
        message=approved?"Request approved.":"Request declined without a penalty."
      }else{
        subOnly()
        if(request.kind!=="inspection")throw new BoundaryError(400,"Only inspection requests can be acknowledged")
        const completed=checked(z.boolean(),body.completed)
        const response=checked(noteSchema,body.response??"")
        const status=completed?"completed":"declined"
        await db.query("UPDATE contract_boundary_requests SET status=$1,response=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$4",
          [status,response,player.id,requestId])
        await writeAudit(db,sceneId,moduleId,player.id,"inspection_ack",{status})
        message=completed?"Check-in acknowledged.":"Inspection request declined. No penalty applied."
      }
    }else if(action==="reply_journal"){
      domOnly()
      const entryId=checked(uuid,body.entryId)
      const reply=checked(replySchema,body.reply)
      const {rows}=await db.query("UPDATE contract_private_journal SET reply=$1,replied_by=$2,replied_at=now() "+
        "WHERE id=$3 AND scene_id=$4 AND reply IS NULL RETURNING module_id",[reply,player.id,entryId,sceneId])
      if(!rows.length)throw new BoundaryError(409,"Entry already answered or not found")
      moduleId=rows[0].module_id
      await writeAudit(db,sceneId,moduleId,player.id,"journal_reply",{entryId})
      message="Private reply saved."
    }else{
      moduleId=checked(uuid,body.moduleId)
      if(action==="set_lock"){
        throw new BoundaryError(409,"Direct lock status changes are disabled. Upload a photo and request lock or unlock review.")
      }else if(action==="request_lock"){
        subOnly();requireModule(modules,moduleId,"lock")
        const proofId=checked(uuid,body.proofId)
        const note=checked(noteSchema,body.note??"")
        const state=await db.query("SELECT locked_since FROM contract_boundary_state WHERE scene_id=$1 AND module_id=$2",[sceneId,moduleId])
        if(state.rows[0]?.locked_since)throw new BoundaryError(409,"This module is already marked locked")
        const pending=await db.query("SELECT id FROM contract_boundary_requests WHERE scene_id=$1 AND module_id=$2 AND kind='lock' AND status='pending'",[sceneId,moduleId])
        if(pending.rowCount)throw new BoundaryError(409,"A lock request already awaits Dom review")
        const {rows:images}=await db.query("SELECT id FROM proof_submissions WHERE id=$1 AND scene_id=$2 AND module_id=$3 "+
          "AND submitter_id=$4 AND kind='lock' AND status='pending' AND lock_request_id IS NULL "+
          "AND deleted_at IS NULL AND blob_path IS NOT NULL FOR UPDATE",[proofId,sceneId,moduleId,player.id])
        if(!images.length)throw new BoundaryError(409,"Upload a valid lock photo before requesting a lock")
        const {rows:recent}=await db.query<{count:number}>(
          "SELECT count(*)::int AS count FROM contract_boundary_requests "+
          "WHERE scene_id=$1 AND requester_id=$2 AND created_at>now()-interval '24 hours'",[sceneId,player.id])
        if(recent[0].count>=12)throw new BoundaryError(429,"Daily request limit reached")
        const requestId=randomUUID()
        await db.query("INSERT INTO contract_boundary_requests(id,scene_id,module_id,requester_id,kind,note) "+
          "VALUES($1,$2,$3,$4,'lock',$5)",[requestId,sceneId,moduleId,player.id,note])
        await db.query("UPDATE proof_submissions SET lock_request_id=$1 WHERE id=$2",[requestId,proofId])
        await writeAudit(db,sceneId,moduleId,player.id,"boundary_req",{kind:"lock",requestId})
        message="Lock request sent with photo. Status remains unlocked until Dom approval."
      }else if(action==="set_permission"){
        domOnly();requireModule(modules,moduleId,"permission")
        const status=checked(z.enum(["restricted","limited","allowed"]),body.status)
        await db.query("INSERT INTO contract_boundary_state(scene_id,module_id,permission_status) VALUES($1,$2,$3) "+
          "ON CONFLICT(scene_id,module_id) DO UPDATE SET permission_status=$3,updated_at=now()",[sceneId,moduleId,status])
        await writeAudit(db,sceneId,moduleId,player.id,"perm_status",{status})
        message="Permission state updated. Your partner may pause or end at any time."
      }else if(action==="record_release"){
        subOnly();requireModule(modules,moduleId,"permission")
        const clear=checked(z.boolean(),body.clear??false)
        await db.query("INSERT INTO contract_boundary_state(scene_id,module_id,release_last_at) VALUES($1,$2,CASE WHEN $3 THEN NULL ELSE now() END) "+
          "ON CONFLICT(scene_id,module_id) DO UPDATE SET release_last_at=CASE WHEN $3 THEN NULL ELSE now() END,updated_at=now()",
          [sceneId,moduleId,clear])
        await writeAudit(db,sceneId,moduleId,player.id,"release_log",{cleared:clear})
        message=clear?"Private counter cleared.":"Private counter updated."
      }else if(action==="request_unlock"||action==="request_release"||action==="request_inspection"){
        const kind=action==="request_unlock"?"unlock":action==="request_release"?"release":"inspection"
        if(kind==="inspection"){domOnly();requireModule(modules,moduleId,"lock")}
        else {subOnly();requireModule(modules,moduleId,kind==="unlock"?"lock":"permission")}
        const note=checked(noteSchema,body.note??"")
        if(kind==="unlock"){
          const state=await db.query("SELECT locked_since FROM contract_boundary_state WHERE scene_id=$1 AND module_id=$2",[sceneId,moduleId])
          if(!state.rows[0]?.locked_since)throw new BoundaryError(409,"Only an active reported lock can be requested for unlock review")
        }
        const {rows:recent}=await db.query<{count:number}>(
          "SELECT count(*)::int AS count FROM contract_boundary_requests "+
          "WHERE scene_id=$1 AND requester_id=$2 AND created_at>now()-interval '24 hours'",[sceneId,player.id])
        if(recent[0].count>=12)throw new BoundaryError(429,"Daily request limit reached")
        await db.query("INSERT INTO contract_boundary_requests(id,scene_id,module_id,requester_id,kind,note) "+
          "VALUES($1,$2,$3,$4,$5,$6)",[randomUUID(),sceneId,moduleId,player.id,kind,note])
        await writeAudit(db,sceneId,moduleId,player.id,"boundary_req",{kind})
        message=kind==="inspection"?"Optional text check-in requested.": "Request sent. The partner can approve or decline."
      }else if(action==="journal"){
        subOnly();requireModule(modules,moduleId,"journal")
        const bodyText=checked(z.string().trim().min(1).max(1000),body.text)
        const {rows:count}=await db.query<{count:number}>(
          "SELECT count(*)::int AS count FROM contract_private_journal WHERE scene_id=$1",[sceneId])
        if(count[0].count>=200)throw new BoundaryError(429,"Journal entry cap reached")
        const entryId=randomUUID()
        await db.query("INSERT INTO contract_private_journal(id,scene_id,module_id,author_id,body) VALUES($1,$2,$3,$4,$5)",
          [entryId,sceneId,moduleId,player.id,bodyText])
        await writeAudit(db,sceneId,moduleId,player.id,"journal_write",{entryId})
        message="Private journal entry saved."
      }
    }
    await db.query("COMMIT");transaction=false
    return json({message})
  }catch(e){
    if(db&&transaction)await db.query("ROLLBACK").catch(()=>{})
    return failure(e)
  }finally{db?.release()}
}
