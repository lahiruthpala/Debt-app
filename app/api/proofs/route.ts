import {randomUUID} from "node:crypto"
import {del,get,put} from "@vercel/blob"
import sharp from "sharp"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {applyCredit} from "@/lib/ledger"
import {canReviewProof,isAllowedImageType,maxProofBytes,proofReviewOutcome,type ProofKind,type ProofStatus} from "@/lib/proof-rules"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const uuid=z.string().uuid()
const proofKind=z.enum(["lock","task","challenge","payment"])
const noteSchema=z.string().trim().max(500)
class ProofError extends Error{constructor(public status:number,message:string){super(message)}}
const json=(result:unknown,status=200)=>Response.json(result,{status,headers:{"Cache-Control":"private, no-store"}})
function parsed<T>(schema:z.ZodType<T>,value:unknown):T{
  const result=schema.safeParse(value)
  if(!result.success)throw new ProofError(400,result.error.issues[0]?.message||"Invalid evidence")
  return result.data
}
function sameOrigin(req:Request){
  const origin=req.headers.get("origin")
  if(origin){
    try{
      const url=new URL(req.url)
      const host=req.headers.get("host")
      if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(origin).origin))return
    }catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new ProofError(403,"Request origin rejected")
}
async function identity(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new ProofError(503,"Proof service is not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new ProofError(401,"Please sign in")
  const result=await getPool().query<{id:string;role:"dom"|"sub";adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!result.rows[0]?.adult_confirmed)throw new ProofError(403,"Complete your adult profile first")
  return result.rows[0]
}
type Scene={id:string;status:string;connection_state:string;principal:number;interest:number;penalties:number;modules_snapshot:unknown|null}
async function sceneFor(db:PoolClient,sceneId:string,userId:string,lock=false):Promise<Scene>{
  const {rows}=await db.query(
    "SELECT s.id,s.status,s.principal,s.interest,s.penalties,c.state AS connection_state,sc.modules_snapshot "+
    "FROM scenes s JOIN connections c ON c.id=s.connection_id LEFT JOIN scene_contracts sc ON sc.scene_id=s.id "+
    "WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+(lock?"FOR UPDATE OF s":""),
    [sceneId,userId])
  if(!rows.length)throw new ProofError(404,"Scene not found")
  return rows[0]
}
function active(scene:Scene){
  if(scene.status!=="active"||scene.connection_state!=="active")
    throw new ProofError(409,"An active, approved connection and scene are required")
}
async function validateTarget(db:PoolClient,scene:Scene,actorId:string,kind:ProofKind,moduleId:string|null,claimId:string|null,challengeId:string|null,amount:number|null){
  active(scene)
  if(kind==="payment"){
    if(amount===null||!Number.isInteger(amount)||amount<1||amount>100000||moduleId||claimId||challengeId)
      throw new ProofError(400,"Select a simulated credit amount of 1–100,000")
    if(scene.principal+scene.interest+scene.penalties<=0)throw new ProofError(409,"The fictional ledger is already clear")
  }else if(kind==="task"){
    if(!claimId||moduleId||challengeId||amount!==null)throw new ProofError(400,"Select a pending task claim")
    const {rows}=await db.query(
      "SELECT id,state FROM contract_task_claims WHERE id=$1 AND scene_id=$2 AND requested_by=$3",
      [claimId,scene.id,actorId])
    if(!rows.length||rows[0].state!=="pending")throw new ProofError(409,"Task claim must be pending and belong to you")
    const pending=await db.query(
      "SELECT id FROM proof_submissions WHERE claim_id=$1 AND status='pending' AND deleted_at IS NULL LIMIT 1",
      [claimId])
    if(pending.rowCount)throw new ProofError(409,"A proof is already pending review for this task")
  }else if(kind==="challenge"){
    if(!challengeId||moduleId||claimId||amount!==null)throw new ProofError(400,"Select a challenge")
    const {rows}=await db.query("SELECT id,state FROM challenges WHERE id=$1 AND scene_id=$2",[challengeId,scene.id])
    if(!rows.length||rows[0].state!=="open")throw new ProofError(409,"Challenge is no longer open")
    const pending=await db.query("SELECT id FROM proof_submissions WHERE challenge_id=$1 AND status='pending' AND deleted_at IS NULL LIMIT 1",[challengeId])
    if(pending.rowCount)throw new ProofError(409,"Evidence already pending review for this challenge")
  }else{
    if(!moduleId||claimId||challengeId||amount!==null)throw new ProofError(400,"Select a lock-status module")
    const raw=scene.modules_snapshot
    const modules=Array.isArray(raw)?raw:typeof raw==="string"?JSON.parse(raw):[]
    if(!modules.some((m:{id?:string;type?:string})=>m.id===moduleId&&m.type==="lock"))
      throw new ProofError(404,"Lock-status module not available for this scene")
    const state=await db.query("SELECT locked_since FROM contract_boundary_state WHERE scene_id=$1 AND module_id=$2",
      [scene.id,moduleId])
    if(!state.rows[0]?.locked_since)throw new ProofError(409,"Report locked status before submitting optional photo evidence")
  }
}
function failed(error:unknown){
  if(error instanceof ProofError)return json({error:error.message},error.status)
  if((error as {code?:string})?.code==="23505")return json({error:"Proof already pending for this task"},409)
  console.error("Private proof service:",error instanceof Error?error.message:"Unknown error")
  return json({error:"Could not complete the private proof action"},500)
}
type ProofRow={
 id:string;scene_id:string;submitter_id:string;kind:ProofKind;module_id:string|null;
 claim_id:string|null;challenge_id:string|null;amount:number|null;blob_path:string|null;status:ProofStatus;deleted_at:string|null
}
async function findProof(db:PoolClient,id:string,userId:string,lock=false):Promise<ProofRow>{
  const {rows}=await db.query(
    "SELECT p.id,p.scene_id,p.submitter_id,p.kind,p.module_id,p.claim_id,p.challenge_id,p.amount,p.blob_path,p.status,p.deleted_at "+
    "FROM proof_submissions p JOIN scenes s ON s.id=p.scene_id "+
    "JOIN connections c ON c.id=s.connection_id "+
    "WHERE p.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+(lock?"FOR UPDATE OF p":""),
    [id,userId])
  if(!rows.length)throw new ProofError(404,"Proof not found")
  return rows[0]
}
export async function GET(req:Request){
  try{
    const actor=await identity(req)
    const url=new URL(req.url)
    if(url.searchParams.get("view")==="image"){
      const id=parsed(uuid,url.searchParams.get("id"))
      const db=await getPool().connect()
      let path:string
      try{
        const proof=await findProof(db,id,actor.id)
        const scene=await sceneFor(db,proof.scene_id,actor.id)
        if(scene.connection_state!=="active"||proof.deleted_at||!proof.blob_path)
          throw new ProofError(404,"Image is no longer available")
        path=proof.blob_path
      }finally{db.release()}
      const result=await get(path,{access:"private"})
      if(!result||result.statusCode!==200)throw new ProofError(404,"Image is no longer available")
      return new Response(result.stream,{
        status:200,headers:{
          "Content-Type":"image/webp","Content-Disposition":"inline; filename=proof.webp",
          "Cache-Control":"private, no-store, max-age=0",
          "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"
        }
      })
    }
    const sceneId=parsed(uuid,url.searchParams.get("sceneId"))
    const db=await getPool().connect()
    try{
      const scene=await sceneFor(db,sceneId,actor.id)
      if(scene.connection_state!=="active")throw new ProofError(403,"This connection is not active")
      const {rows}=await db.query(
        "SELECT p.id,p.scene_id,p.kind,p.module_id,p.claim_id,p.challenge_id,p.amount,p.note,p.status,"+
        "p.created_at,p.reviewed_at,p.review_note,p.deleted_at,u.handle AS submitter_handle,"+
        "r.handle AS reviewer_handle,p.submitter_id "+
        "FROM proof_submissions p JOIN profiles u ON u.id=p.submitter_id "+
        "LEFT JOIN profiles r ON r.id=p.reviewer_id WHERE p.scene_id=$1 "+
        "ORDER BY p.created_at DESC LIMIT 100",
        [sceneId])
      return json({proofs:rows})
    }finally{db.release()}
  }catch(error){return failed(error)}
}
export async function POST(req:Request){
  let uploaded:string|null=null
  let inserted=false
  let db:PoolClient|null=null
  let transaction=false
  try{
    sameOrigin(req)
    const actor=await identity(req)
    if(actor.role!=="sub")throw new ProofError(403,"Only the Sub can submit private evidence")
    const form=await req.formData().catch(()=>{throw new ProofError(400,"Provide an image upload")})
    const sceneId=parsed(uuid,form.get("sceneId"))
    const kind=parsed(proofKind,form.get("kind"))
    const moduleId=kind==="lock"?parsed(uuid,form.get("moduleId")):null
    const claimId=kind==="task"?parsed(uuid,form.get("claimId")):null
    const challengeId=kind==="challenge"?parsed(uuid,form.get("challengeId")):null
    const amount=kind==="payment"?parsed(z.coerce.number().int().min(1).max(100000),form.get("amount")):null
    const note=parsed(noteSchema,form.get("note")||"")
    if(form.get("consent")!=="yes")throw new ProofError(400,"Confirm that your image is non-explicit and shared voluntarily")
    const file=form.get("file")
    if(!(file instanceof File)||file.size<1||file.size>maxProofBytes)
      throw new ProofError(400,"Select an image smaller than 3 MB")
    if(!isAllowedImageType(file.type))throw new ProofError(400,"Only JPEG, PNG and WebP images are allowed")

    // Check authorization and rate limits before processing and uploading bytes.
    const pre=await getPool().connect()
    try{
      const scene=await sceneFor(pre,sceneId,actor.id)
      await validateTarget(pre,scene,actor.id,kind,moduleId,claimId,challengeId,amount)
      const daily=await pre.query<{count:number}>(
        "SELECT count(*)::int AS count FROM proof_submissions WHERE submitter_id=$1 AND created_at>now()-interval '24 hours'",[actor.id])
      if(daily.rows[0].count>=12)throw new ProofError(429,"You can upload at most 12 proofs per day")
    }finally{pre.release()}

    // Re-encoding removes location/EXIF metadata, strips active or embedded
    // payloads and normalizes images to one private WebP representation.
    const source=Buffer.from(await file.arrayBuffer())
    const image=sharp(source,{limitInputPixels:20_000_000})
    const metadata=await image.metadata().catch(()=>{throw new ProofError(400,"Image could not be decoded")})
    if(!["jpeg","png","webp"].includes(metadata.format||""))
      throw new ProofError(400,"The file is not a supported image")
    const data=await image.rotate().resize(1600,1600,{fit:"inside",withoutEnlargement:true})
      .webp({quality:82}).toBuffer()
    if(data.length<1||data.length>maxProofBytes)throw new ProofError(400,"Processed image exceeds the 3 MB limit")
    const proofId=randomUUID()
    const blob=await put("private-proofs/"+proofId+".webp",data,{
      access:"private",contentType:"image/webp",addRandomSuffix:false
    })
    uploaded=blob.pathname

    db=await getPool().connect()
    await db.query("BEGIN");transaction=true
    const scene=await sceneFor(db,sceneId,actor.id,true)
    await validateTarget(db,scene,actor.id,kind,moduleId,claimId,challengeId,amount)
    const daily=await db.query<{count:number}>(
      "SELECT count(*)::int AS count FROM proof_submissions WHERE submitter_id=$1 AND created_at>now()-interval '24 hours'",[actor.id])
    if(daily.rows[0].count>=12)throw new ProofError(429,"Daily private proof limit reached")
    const pending=await db.query<{count:number}>(
      "SELECT count(*)::int AS count FROM proof_submissions WHERE scene_id=$1 AND status='pending' AND deleted_at IS NULL",[sceneId])
    if(pending.rows[0].count>=20)throw new ProofError(429,"Too many proofs are waiting for review")
    await db.query(
      "INSERT INTO proof_submissions(id,scene_id,submitter_id,kind,module_id,claim_id,challenge_id,amount,note,blob_path,bytes) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [proofId,sceneId,actor.id,kind,moduleId,claimId,challengeId,amount,note,uploaded,data.length])
    await db.query("COMMIT");transaction=false
    inserted=true
    return json({id:proofId,message:"Private proof submitted. Your connected partner can review it."},201)
  }catch(error){
    if(db&&transaction)await db.query("ROLLBACK").catch(()=>{})
    // Best-effort cleanup for files uploaded before a failed database insert.
    if(uploaded&&!inserted)await del(uploaded).catch(e=>console.error("Orphan proof cleanup failed:",e instanceof Error?e.message:"Unknown"))
    return failed(error)
  }finally{db?.release()}
}
export async function PATCH(req:Request){
  let db:PoolClient|null=null
  let transaction=false
  try{
    sameOrigin(req)
    const actor=await identity(req)
    if(actor.role!=="dom")throw new ProofError(403,"Only the connected Dom can review proofs")
    const body=await req.json().catch(()=>{throw new ProofError(400,"Invalid JSON")})
    const id=parsed(uuid,body?.id)
    const approve=parsed(z.boolean(),body?.approve)
    const note=parsed(noteSchema,body?.note||"")
    if(!approve&&note.length<5)throw new ProofError(400,"Add a reason of at least five characters when rejecting")
    db=await getPool().connect()
    await db.query("BEGIN");transaction=true
    const {rows:where}=await db.query<{scene_id:string}>("SELECT scene_id FROM proof_submissions WHERE id=$1",[id])
    if(!where.length)throw new ProofError(404,"Proof not found")
    const scene=await sceneFor(db,where[0].scene_id,actor.id,true)
    active(scene)
    const proof=await findProof(db,id,actor.id,true)
    if(!canReviewProof(actor.role,scene.connection_state,proof.status,Boolean(proof.deleted_at)))
      throw new ProofError(409,"This proof cannot be reviewed")
    let credited=0
    const outcome=proofReviewOutcome(proof.kind,approve)
    if(outcome==="apply_payment"){
      const next=applyCredit(scene,proof.amount||0)
      if(!next.credited)throw new ProofError(409,"The fictional ledger is already clear")
      credited=next.credited
      await db.query(
        "UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
        [next.principal,next.interest,next.penalties,scene.id])
      await db.query(
        "INSERT INTO ledger_events(id,scene_id,actor_id,type,amount,detail) VALUES($1,$2,$3,'payment_proof',$4,$5)",
        [randomUUID(),scene.id,actor.id,-credited,"Approved submitted evidence for a simulated payment (no money sent)"]
      )
    }
    if(outcome==="approve_task"){
      const {rows}=await db.query(
        "SELECT * FROM contract_task_claims WHERE id=$1 AND scene_id=$2 FOR UPDATE",[proof.claim_id,scene.id])
      const claim=rows[0]
      if(!claim||claim.state!=="pending")throw new ProofError(409,"Task claim is no longer pending")
      const next=applyCredit(scene,claim.reward)
      credited=next.credited
      await db.query(
        "UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
        [next.principal,next.interest,next.penalties,scene.id])
      await db.query(
        "UPDATE contract_task_claims SET state='approved',reviewed_by=$1,reviewed_at=now() WHERE id=$2",
        [actor.id,claim.id])
      await db.query(
        "INSERT INTO ledger_events(id,scene_id,actor_id,type,amount,detail) VALUES($1,$2,$3,'task_proof',$4,$5)",
        [randomUUID(),scene.id,actor.id,-credited,"Verified agreed task with private photo evidence"]
      )
      await db.query(
        "INSERT INTO contract_action_log(id,scene_id,module_id,actor_id,action,delta,details) "+
        "VALUES($1,$2,$3,$4,'proof_review',$5,$6)",
        [randomUUID(),scene.id,claim.module_id,actor.id,-credited,JSON.stringify({proofId:id,kind:"task",approved:true})])
    }
    if(outcome==="approve_challenge"){
      const {rows}=await db.query(
        "SELECT * FROM challenges WHERE id=$1 AND scene_id=$2 FOR UPDATE",[proof.challenge_id,scene.id])
      const challenge=rows[0]
      if(!challenge||challenge.state!=="open")throw new ProofError(409,"Challenge is no longer open")
      const next=applyCredit(scene,challenge.reward)
      credited=next.credited
      await db.query("UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
        [next.principal,next.interest,next.penalties,scene.id])
      await db.query("UPDATE challenges SET state='completed',completed_at=now() WHERE id=$1",[challenge.id])
      await db.query(
        "INSERT INTO ledger_events(id,scene_id,actor_id,type,amount,detail) VALUES($1,$2,$3,'challenge_proof',$4,$5)",
        [randomUUID(),scene.id,actor.id,-credited,"Approved challenge completion with private photo evidence"]
      )
    }
    if(proof.kind==="lock"){
      await db.query(
        "INSERT INTO contract_action_log(id,scene_id,module_id,actor_id,action,delta,details) "+
        "VALUES($1,$2,$3,$4,'proof_review',0,$5)",
        [randomUUID(),scene.id,proof.module_id,actor.id,JSON.stringify({proofId:id,kind:"lock",approved:approve})])
    }
    await db.query(
      "UPDATE proof_submissions SET status=$1,reviewer_id=$2,review_note=$3,reviewed_at=now() WHERE id=$4",
      [approve?"approved":"rejected",actor.id,note,id])
    await db.query("COMMIT");transaction=false
    return json({credited,message:approve?
      (credited?"Proof approved: "+credited.toLocaleString()+" fictional credits applied.":"Proof approved. Status verified; no balance change."):
      "Proof rejected. No credit or penalty was applied."})
  }catch(error){
    if(db&&transaction)await db.query("ROLLBACK").catch(()=>{})
    return failed(error)
  }finally{db?.release()}
}
export async function DELETE(req:Request){
  let db:PoolClient|null=null
  let transaction=false
  try{
    sameOrigin(req)
    const actor=await identity(req)
    const body=await req.json().catch(()=>{throw new ProofError(400,"Invalid JSON")})
    const id=parsed(uuid,body?.id)
    db=await getPool().connect()
    await db.query("BEGIN");transaction=true
    const proof=await findProof(db,id,actor.id,true)
    if(proof.submitter_id!==actor.id)throw new ProofError(403,"Only the uploader can erase the image")
    if(proof.deleted_at||!proof.blob_path)throw new ProofError(409,"Image is already erased")
    await del(proof.blob_path)
    await db.query(
      "UPDATE proof_submissions SET blob_path=NULL,deleted_at=now() WHERE id=$1",[id])
    await db.query("COMMIT");transaction=false
    return json({message:"Your private image was erased. The audit record and any settled credits remain."})
  }catch(error){
    if(db&&transaction)await db.query("ROLLBACK").catch(()=>{})
    return failed(error)
  }finally{db?.release()}
}
