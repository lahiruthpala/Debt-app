import {randomUUID} from "node:crypto"
import {z} from "zod"
import type {PoolClient} from "pg"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {dueToday,simulateLedger,validTimezone} from "@/lib/operations"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const uuid=z.string().uuid()
const label=(max:number)=>z.string().trim().min(3).max(max)
class OpsError extends Error {constructor(public status:number,message:string){super(message)}}
const reply=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}})
const validate=<T,>(schema:z.ZodType<T>,data:unknown):T=>{
  const result=schema.safeParse(data)
  if(!result.success)throw new OpsError(400,result.error.issues[0]?.message||"Invalid input")
  return result.data
}
function origin(req:Request){
  const from=req.headers.get("origin")
  if(from){
    const url=new URL(req.url),host=req.headers.get("host")
    let urlOrigin:string
    try{urlOrigin=new URL(from).origin}catch{throw new OpsError(403,"Request origin rejected")}
    if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(urlOrigin))return
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new OpsError(403,"Request origin rejected")
}
async function user(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new OpsError(503,"Operations are not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new OpsError(401,"Sign in required")
  const {rows}=await getPool().query<{id:string;role:"dom"|"sub";adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new OpsError(403,"Complete your adult profile first")
  return rows[0]
}
type Scene={id:string;status:string;connection_state:string;role:"dom"|"sub";
  principal:number;interest:number;penalties:number;monthly_rate:number;weekly_target:number;late_fee:number}
async function sceneFor(db:PoolClient,sceneId:string,actor:{id:string;role:string},lock=false):Promise<Scene>{
  const {rows}=await db.query(
    "SELECT s.id,s.status,c.state AS connection_state,s.principal,s.interest,s.penalties,"+
    "s.monthly_rate,s.weekly_target,s.late_fee "+
    "FROM scenes s JOIN connections c ON c.id=s.connection_id "+
    "WHERE s.id=$1 AND c.state='active' AND (c.sender_id=$2 OR c.recipient_id=$2) "+
    (lock?"FOR UPDATE OF s":""),
    [sceneId,actor.id])
  if(!rows.length)throw new OpsError(404,"Connection scene unavailable")
  return {...rows[0],role:actor.role}
}
function active(scene:Scene){
  if(scene.status!=="active"||scene.connection_state!=="active")throw new OpsError(409,"An active mutually approved scene is required")
}
function role(actor:{role:string},expected:string){
  if(actor.role!==expected)throw new OpsError(403,"This action is not available for your role")
}
async function ensureToday(db:PoolClient,sceneId:string){
  const {rows}=await db.query<{
    id:string;scene_id:string;repeat_days:number[];timezone:string;status:string
  }>("SELECT r.id,r.scene_id,r.repeat_days,r.timezone,r.status FROM scene_rituals r "+
    "JOIN scenes s ON s.id=r.scene_id WHERE r.scene_id=$1 AND r.status='active' AND s.status='active'",[sceneId])
  for(const ritual of rows){
    const day=dueToday(ritual.repeat_days,ritual.timezone)
    if(!day.scheduled)continue
    await db.query("INSERT INTO scene_ritual_occurrences(id,ritual_id,scene_id,local_date) "+
      "VALUES($1,$2,$3,$4::date) ON CONFLICT(ritual_id,local_date) DO NOTHING",
      [randomUUID(),ritual.id,ritual.scene_id,day.date])
  }
}
async function pointBalance(db:PoolClient,sceneId:string,uid:string){
  const {rows}=await db.query<{total:number}>(
    "SELECT COALESCE(sum(points),0)::int AS total FROM scene_point_events WHERE scene_id=$1 AND user_id=$2",
    [sceneId,uid])
  return rows[0].total
}
function failure(error:unknown){
  if(error instanceof OpsError)return reply({error:error.message},error.status)
  if((error as {code?:string})?.code==="23505")return reply({error:"This action was already recorded"},409)
  if((error as {code?:string})?.code==="23503")return reply({error:"Related record is unavailable"},409)
  console.error("Operations action:",error instanceof Error?error.message:"Unknown")
  return reply({error:"Unable to complete operations action"},500)
}
export async function GET(req:Request){
  try{
    const actor=await user(req)
    const url=new URL(req.url),view=url.searchParams.get("view")||"overview"
    const db=await getPool().connect()
    try{
      if(view==="notifications"){
        const {rows}=await db.query(
          "SELECT id,scene_id,kind,title,detail,created_at,read_at FROM activity_notifications "+
          "WHERE user_id=$1 ORDER BY created_at DESC LIMIT 80",[actor.id])
        return reply({notifications:rows,unread:rows.filter(row=>!row.read_at).length})
      }
      if(view==="overview"){
        const [scenes,games,proofs,rituals,points,activity]=await Promise.all([
          db.query<{status:string;total:number}>("SELECT s.status,count(*)::int AS total FROM scenes s "+
            "JOIN connections c ON c.id=s.connection_id WHERE c.state='active' AND "+
            "(c.sender_id=$1 OR c.recipient_id=$1) GROUP BY s.status",[actor.id]),
          db.query<{count:number}>("SELECT count(*)::int AS count FROM community_game_sessions g "+
            "JOIN scenes s ON s.id=g.scene_id JOIN connections c ON c.id=s.connection_id "+
            "WHERE c.sender_id=$1 OR c.recipient_id=$1",[actor.id]),
          db.query<{count:number}>("SELECT count(*)::int AS count FROM proof_submissions p "+
            "JOIN scenes s ON s.id=p.scene_id JOIN connections c ON c.id=s.connection_id "+
            "WHERE p.status='pending' AND p.deleted_at IS NULL AND c.state='active' AND "+
            "(c.sender_id=$1 OR c.recipient_id=$1)",[actor.id]),
          db.query<{count:number}>("SELECT count(*)::int AS count FROM scene_rituals r "+
            "JOIN scenes s ON s.id=r.scene_id JOIN connections c ON c.id=s.connection_id "+
            "WHERE r.status='active' AND c.state='active' AND (c.sender_id=$1 OR c.recipient_id=$1)",[actor.id]),
          db.query<{points:number}>("SELECT COALESCE(sum(points),0)::int AS points FROM scene_point_events WHERE user_id=$1",[actor.id]),
          db.query("SELECT to_char(date_trunc('day',e.created_at),'YYYY-MM-DD') AS day,"+
            "count(*)::int AS actions,COALESCE(sum(e.amount),0)::int AS net FROM ledger_events e "+
            "JOIN scenes s ON s.id=e.scene_id JOIN connections c ON c.id=s.connection_id "+
            "WHERE e.created_at>=now()-interval '30 days' AND (c.sender_id=$1 OR c.recipient_id=$1) "+
            "GROUP BY 1 ORDER BY 1",[actor.id])
        ])
        return reply({scenes:scenes.rows,games:games.rows[0].count,pendingProofs:proofs.rows[0].count,
          activeRituals:rituals.rows[0].count,points:points.rows[0].points,activity:activity.rows})
      }
      const sceneId=validate(uuid,url.searchParams.get("sceneId"))
      const scene=await sceneFor(db,sceneId,actor)
      if(view==="rituals"){
        if(scene.status==="active")await ensureToday(db,sceneId)
        const rituals=await db.query(
          "SELECT r.*,p.handle AS creator_handle FROM scene_rituals r "+
          "JOIN profiles p ON p.id=r.created_by WHERE r.scene_id=$1 ORDER BY r.created_at DESC LIMIT 80",[sceneId])
        const occurrences=await db.query(
          "SELECT o.*,r.title,r.requires_proof,r.points,r.local_hour,r.timezone,r.status AS ritual_status,"+
          "(SELECT p.id FROM proof_submissions p WHERE p.ritual_occurrence_id=o.id "+
          "AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS proof_id,"+
          "(SELECT p.status FROM proof_submissions p WHERE p.ritual_occurrence_id=o.id "+
          "AND p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT 1) AS proof_status "+
          "FROM scene_ritual_occurrences o JOIN scene_rituals r ON r.id=o.ritual_id "+
          "WHERE o.scene_id=$1 ORDER BY o.local_date DESC,o.created_at DESC LIMIT 100",[sceneId])
        return reply({rituals:rituals.rows,occurrences:occurrences.rows})
      }
      if(view==="queue"){
        role(actor,"dom")
        const proofs=await db.query(
          "SELECT p.id,'proof' AS kind,p.kind AS subtype,p.created_at,p.note,p.content_type,"+
          "u.handle AS member_handle,p.scene_id,p.ritual_occurrence_id "+
          "FROM proof_submissions p JOIN profiles u ON u.id=p.submitter_id "+
          "WHERE p.scene_id=$1 AND p.status='pending' AND p.deleted_at IS NULL "+
          "AND (p.kind<>'lock' OR p.lock_request_id IS NOT NULL) ORDER BY p.created_at DESC LIMIT 75",[sceneId])
        const claims=await db.query(
          "SELECT c.id,'claim' AS kind,'task' AS subtype,c.created_at,'' AS note,u.handle AS member_handle,c.scene_id "+
          "FROM contract_task_claims c JOIN profiles u ON u.id=c.requested_by "+
          "WHERE c.scene_id=$1 AND c.state='pending' "+
          "AND NOT EXISTS(SELECT 1 FROM proof_submissions p WHERE p.claim_id=c.id AND p.status='pending' AND p.deleted_at IS NULL) "+
          "ORDER BY c.created_at DESC LIMIT 50",[sceneId])
        const ritual=await db.query(
          "SELECT o.id,'ritual' AS kind,'ritual' AS subtype,o.created_at,o.note,u.handle AS member_handle,o.scene_id "+
          "FROM scene_ritual_occurrences o JOIN profiles u ON u.id=o.submitted_by "+
          "WHERE o.scene_id=$1 AND o.status='submitted' ORDER BY o.created_at DESC LIMIT 50",[sceneId])
        const queue=[...proofs.rows,...claims.rows,...ritual.rows]
          .sort((a,b)=>new Date(b.created_at).getTime()-new Date(a.created_at).getTime())
        return reply({queue})
      }
      if(view==="rewards"){
        const [options,redemptions,totals]=await Promise.all([
          db.query("SELECT id,title,description,cost_points,active,created_at FROM scene_reward_options WHERE scene_id=$1 ORDER BY created_at DESC LIMIT 40",[sceneId]),
          db.query("SELECT d.id,d.option_id,d.status,d.created_at,d.reviewed_at,o.title,o.cost_points,p.handle AS requester_handle "+
            "FROM scene_reward_redemptions d JOIN scene_reward_options o ON o.id=d.option_id "+
            "JOIN profiles p ON p.id=d.requested_by WHERE d.scene_id=$1 ORDER BY d.created_at DESC LIMIT 60",[sceneId]),
          db.query<{user_id:string;handle:string;balance:number}>(
            "SELECT e.user_id,p.handle,sum(e.points)::int AS balance FROM scene_point_events e "+
            "JOIN profiles p ON p.id=e.user_id WHERE e.scene_id=$1 GROUP BY e.user_id,p.handle",[sceneId])
        ])
        return reply({options:options.rows,redemptions:redemptions.rows,balances:totals.rows})
      }
      if(view==="signatures"){
        const {rows}=await db.query("SELECT p.handle,p.role,g.typed_name,g.acknowledged_at "+
          "FROM scene_signatures g JOIN profiles p ON p.id=g.user_id WHERE g.scene_id=$1 "+
          "ORDER BY g.acknowledged_at",[sceneId])
        const agreement=await db.query(
          "SELECT s.start_principal,s.monthly_rate,s.weekly_target,s.late_fee,"+
          "sc.title_snapshot,sc.description_snapshot,sc.modules_snapshot "+
          "FROM scenes s LEFT JOIN scene_contracts sc ON sc.scene_id=s.id WHERE s.id=$1",[sceneId])
        return reply({signatures:rows,agreement:agreement.rows[0]})
      }
      if(view==="forecast"){
        const weeks=validate(z.coerce.number().int().min(1).max(52),url.searchParams.get("weeks")||"12")
        const extraWeeklyCredit=validate(z.coerce.number().int().min(0).max(100000),url.searchParams.get("extra")||"0")
        const monthly=url.searchParams.get("interest")==="true"
        const lateWeeks=validate(z.array(z.number().int().min(1).max(52)).max(52),
          JSON.parse(url.searchParams.get("late")||"[]"))
        return reply({weeks:simulateLedger({
          principal:scene.principal,interest:scene.interest,penalties:scene.penalties,
          monthlyRate:scene.monthly_rate,weeklyTarget:scene.weekly_target,lateFee:scene.late_fee,
          weeks,extraWeeklyCredit,manualInterestEveryFourWeeks:monthly,hypotheticalLateWeeks:lateWeeks
        }),initial:scene})
      }
      throw new OpsError(400,"Unknown operations view")
    }finally{db.release()}
  }catch(error){return failure(error)}
}
export async function POST(req:Request){
  let db:PoolClient|null=null,inTx=false
  try{
    origin(req)
    const actor=await user(req)
    const body=await req.json().catch(()=>{throw new OpsError(400,"Invalid JSON")})
    const action=validate(z.string(),body?.action)
    if(action==="read"||action==="read-all"){
      if(action==="read"){
        const id=validate(uuid,body?.id)
        await getPool().query("UPDATE activity_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND user_id=$2",[id,actor.id])
      }else{
        await getPool().query("UPDATE activity_notifications SET read_at=now() WHERE user_id=$1 AND read_at IS NULL",[actor.id])
      }
      return reply({message:"Notifications updated"})
    }
    const sceneId=validate(uuid,body?.sceneId)
    db=await getPool().connect()
    await db.query("BEGIN");inTx=true
    const scene=await sceneFor(db,sceneId,actor,true)
    active(scene)
    if(action==="ritual-create"){
      role(actor,"dom")
      const payload=validate(z.object({
        title:label(100),description:z.string().trim().max(600).default(""),
        days:z.array(z.number().int().min(0).max(6)).min(1).max(7)
          .refine(items=>new Set(items).size===items.length,"Duplicate weekdays"),
        hour:z.number().int().min(0).max(23),timezone:z.string().trim().max(64),
        points:z.number().int().min(0).max(100),requiresProof:z.boolean()
      }),body)
      if(!validTimezone(payload.timezone))throw new OpsError(400,"Choose a valid IANA timezone")
      const {rows:count}=await db.query<{total:number}>("SELECT count(*)::int AS total FROM scene_rituals WHERE scene_id=$1",[sceneId])
      if(count[0].total>=30)throw new OpsError(429,"Limit of 30 rituals per scene reached")
      const id=randomUUID()
      await db.query("INSERT INTO scene_rituals(id,scene_id,created_by,title,description,repeat_days,local_hour,timezone,points,requires_proof) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)",
        [id,sceneId,actor.id,payload.title,payload.description,payload.days,payload.hour,payload.timezone,payload.points,payload.requiresProof])
      await db.query("COMMIT");inTx=false
      return reply({id,message:"Ritual proposed. Your partner must opt in before it becomes active."},201)
    }
    if(action==="ritual-decision"||action==="ritual-pause"||action==="ritual-resume"){
      const id=validate(uuid,body?.id)
      const {rows}=await db.query("SELECT * FROM scene_rituals WHERE id=$1 AND scene_id=$2 FOR UPDATE",[id,sceneId])
      if(!rows.length)throw new OpsError(404,"Ritual not found")
      const ritual=rows[0]
      let next:string
      if(action==="ritual-decision"){
        role(actor,"sub")
        if(ritual.status!=="proposed")throw new OpsError(409,"Ritual proposal already decided")
        next=validate(z.enum(["active","declined"]),body?.decision)
      }else if(action==="ritual-pause"){
        if(ritual.status!=="active")throw new OpsError(409,"Only active rituals can be paused")
        next="paused"
      }else{
        role(actor,"sub")
        if(ritual.status!=="paused")throw new OpsError(409,"Only paused rituals can resume")
        next="active"
      }
      await db.query("UPDATE scene_rituals SET status=$1,decided_at=now() WHERE id=$2",[next,id])
      await db.query("COMMIT");inTx=false
      return reply({message:"Ritual "+next+". This does not affect the fictional debt."})
    }
    if(action==="ritual-submit"){
      role(actor,"sub")
      await ensureToday(db,sceneId)
      const id=validate(uuid,body?.id),note=validate(z.string().trim().max(500),body?.note||"")
      const {rows}=await db.query(
        "SELECT o.id,o.status,r.requires_proof,r.status AS ritual_status "+
        "FROM scene_ritual_occurrences o JOIN scene_rituals r ON r.id=o.ritual_id "+
        "WHERE o.id=$1 AND o.scene_id=$2 FOR UPDATE OF o",[id,sceneId])
      if(!rows.length||rows[0].status!=="pending"||rows[0].ritual_status!=="active")
        throw new OpsError(409,"This scheduled occurrence is not available")
      if(rows[0].requires_proof){
        const attached=await db.query(
          "SELECT id FROM proof_submissions WHERE ritual_occurrence_id=$1 AND submitter_id=$2 "+
          "AND status='pending' AND deleted_at IS NULL",[id,actor.id])
        if(!attached.rowCount)throw new OpsError(409,"Upload private ritual evidence before submitting")
      }
      await db.query("UPDATE scene_ritual_occurrences SET status='submitted',note=$1,submitted_by=$2,submitted_at=now() WHERE id=$3",
        [note,actor.id,id])
      await db.query("COMMIT");inTx=false
      return reply({message:"Ritual submitted for your partner's review."})
    }
    if(action==="ritual-review"){
      role(actor,"dom")
      const id=validate(uuid,body?.id),approve=validate(z.boolean(),body?.approve)
      const {rows}=await db.query(
        "SELECT o.id,o.status,r.requires_proof FROM scene_ritual_occurrences o "+
        "JOIN scene_rituals r ON r.id=o.ritual_id WHERE o.id=$1 AND o.scene_id=$2 FOR UPDATE OF o",[id,sceneId])
      if(!rows.length||rows[0].status!=="submitted")throw new OpsError(409,"Ritual is not awaiting review")
      if(approve&&rows[0].requires_proof){
        const {rows:proofs}=await db.query(
          "SELECT status FROM proof_submissions WHERE ritual_occurrence_id=$1 "+
          "AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1",[id])
        if(proofs[0]?.status!=="approved")throw new OpsError(409,"Approve the ritual evidence in Proof Center first")
      }
      await db.query("UPDATE scene_ritual_occurrences SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3",
        [approve?"approved":"rejected",actor.id,id])
      await db.query("COMMIT");inTx=false
      return reply({message:approve?"Ritual approved. Separate reward points were awarded.":"Ritual rejected. No debt penalty was applied."})
    }
    if(action==="reward-create"){
      role(actor,"dom")
      const payload=validate(z.object({title:label(100),description:z.string().trim().max(400).default(""),
        cost:z.number().int().min(1).max(5000)}),body)
      const {rows:count}=await db.query<{total:number}>("SELECT count(*)::int AS total FROM scene_reward_options WHERE scene_id=$1",[sceneId])
      if(count[0].total>=30)throw new OpsError(429,"Limit of 30 rewards per scene reached")
      const id=randomUUID()
      await db.query("INSERT INTO scene_reward_options(id,scene_id,created_by,title,description,cost_points) "+
        "VALUES($1,$2,$3,$4,$5,$6)",[id,sceneId,actor.id,payload.title,payload.description,payload.cost])
      await db.query("COMMIT");inTx=false
      return reply({id,message:"Voluntary reward added. Points cannot be exchanged for real money."},201)
    }
    if(action==="reward-retire"){
      role(actor,"dom")
      const id=validate(uuid,body?.id)
      const {rowCount}=await db.query("UPDATE scene_reward_options SET active=false WHERE id=$1 AND scene_id=$2",[id,sceneId])
      if(!rowCount)throw new OpsError(404,"Reward not found")
      await db.query("COMMIT");inTx=false
      return reply({message:"Reward retired. Existing requests are still visible."})
    }
    if(action==="reward-redeem"){
      role(actor,"sub")
      const id=validate(uuid,body?.id)
      const {rows}=await db.query("SELECT id,cost_points FROM scene_reward_options WHERE id=$1 AND scene_id=$2 AND active=true",[id,sceneId])
      if(!rows.length)throw new OpsError(404,"Reward not available")
      const balance=await pointBalance(db,sceneId,actor.id)
      if(balance<rows[0].cost_points)throw new OpsError(409,"Not enough earned points")
      const redeemId=randomUUID()
      await db.query("INSERT INTO scene_reward_redemptions(id,scene_id,option_id,requested_by) VALUES($1,$2,$3,$4)",
        [redeemId,sceneId,id,actor.id])
      await db.query("INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id) "+
        "VALUES($1,$2,$3,$4,'redemption',$5)",
        [randomUUID(),sceneId,actor.id,-rows[0].cost_points,redeemId])
      await db.query("COMMIT");inTx=false
      return reply({message:"Reward requested. Your partner can approve or decline it."})
    }
    if(action==="reward-review"){
      role(actor,"dom")
      const id=validate(uuid,body?.id),approve=validate(z.boolean(),body?.approve)
      const {rows}=await db.query("SELECT d.id,d.status,d.requested_by,o.cost_points "+
        "FROM scene_reward_redemptions d JOIN scene_reward_options o ON o.id=d.option_id "+
        "WHERE d.id=$1 AND d.scene_id=$2 FOR UPDATE OF d",[id,sceneId])
      if(!rows.length||rows[0].status!=="pending")throw new OpsError(409,"Redemption already reviewed")
      await db.query("UPDATE scene_reward_redemptions SET status=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3",
        [approve?"fulfilled":"declined",actor.id,id])
      if(!approve){
        await db.query("INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id) "+
          "VALUES($1,$2,$3,$4,'refund',$5)",[randomUUID(),sceneId,rows[0].requested_by,rows[0].cost_points,id])
      }
      await db.query("COMMIT");inTx=false
      return reply({message:approve?"Reward marked fulfilled.":"Redemption declined and points returned."})
    }
    if(action==="sign"){
      const typedName=validate(label(80),body?.typedName)
      if(body?.acknowledged!==true)throw new OpsError(400,"Read and acknowledge the fictional terms before signing")
      await db.query("INSERT INTO scene_signatures(scene_id,user_id,typed_name) VALUES($1,$2,$3) "+
        "ON CONFLICT(scene_id,user_id) DO NOTHING",[sceneId,actor.id,typedName])
      await db.query("COMMIT");inTx=false
      return reply({message:"Optional personal acknowledgment saved. You may still pause or end the scene."})
    }
    throw new OpsError(400,"Unknown operations action")
  }catch(error){
    if(db&&inTx)await db.query("ROLLBACK").catch(()=>{})
    return failure(error)
  }finally{db?.release()}
}
