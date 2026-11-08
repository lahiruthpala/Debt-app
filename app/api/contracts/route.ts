import {randomInt,randomUUID} from "node:crypto"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getPool} from "@/lib/db"
import {getAuth} from "@/lib/auth"
import {findOfficialTemplates,officialTemplates} from "@/lib/official-templates"
import {applyCredit} from "@/lib/ledger"
import {availableAfterCooldown,contractDefinitionSchema,contractModuleSchema,duelDelta,weightedOutcome,checkinDelta,type ContractModule} from "@/lib/contract-rules"

export const runtime="nodejs"
export const dynamic="force-dynamic"
class ContractError extends Error {constructor(public status:number,message:string){super(message)}}
const respond=(result:unknown,status=200)=>Response.json(result,{status,headers:{"Cache-Control":"no-store"}})
const uuid=z.string().uuid()
function parse<T>(schema:z.ZodType<T>,input:unknown):T{
  const result=schema.safeParse(input)
  if(!result.success)throw new ContractError(400,result.error.issues[0]?.message||"Invalid contract configuration")
  return result.data
}
function originGuard(req:Request){
  const origin=req.headers.get("origin")
  if(origin){
    try {
      const url=new URL(req.url),host=req.headers.get("host")
      const allowed=[url.origin,...(host?[url.protocol+"//"+host]:[])]
      if(allowed.includes(new URL(origin).origin))return
    }catch{}
  } else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new ContractError(403,"Request origin rejected")
}
async function player(req:Request){
  if(!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET)throw new ContractError(503,"Contract service is not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new ContractError(401,"Please sign in")
  const {rows}=await getPool().query<{id:string;role:"dom"|"sub";adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new ContractError(403,"Complete your adult profile first")
  return rows[0]
}
function failed(error:unknown){
  if(error instanceof ContractError)return respond({error:error.message},error.status)
  if((error as {code?:string})?.code==="23505")return respond({error:"An identical contract action or task already exists"},409)
  console.error("Contract API:",error instanceof Error?error.message:"Unexpected error")
  return respond({error:"Unable to perform contract action"},500)
}
async function ownedScene(db:PoolClient,id:string,userId:string,forUpdate=true){
  const {rows}=await db.query(
    "SELECT s.*,c.state AS connection_state,c.sender_id,c.recipient_id,"+
    "sc.title_snapshot,sc.description_snapshot,sc.modules_snapshot "+
    "FROM scenes s JOIN connections c ON c.id=s.connection_id "+
    "JOIN scene_contracts sc ON sc.scene_id=s.id "+
    "WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+
    (forUpdate?"FOR UPDATE OF s":""),
    [id,userId])
  if(!rows.length)throw new ContractError(404,"Debt contract not found")
  return rows[0]
}
function ensurePlaying(scene:{status:string;connection_state:string}){
  if(scene.status!=="active"||scene.connection_state!=="active")
    throw new ContractError(409,"Contract must be mutually approved and active")
}
function parseModules(raw:unknown):ContractModule[]{
  const data=z.array(contractModuleSchema).min(1).max(8).safeParse(raw)
  if(!data.success)throw new ContractError(500,"Stored contract configuration is invalid")
  return data.data
}
async function recordEvent(db:PoolClient,sceneId:string,actorId:string,amount:number,detail:string){
  await db.query("INSERT INTO ledger_events(id,scene_id,actor_id,type,amount,detail) VALUES($1,$2,$3,'contract_game',$4,$5)",
    [randomUUID(),sceneId,actorId,amount,detail.slice(0,400)])
}
async function applyDelta(db:PoolClient,scene:any,actorId:string,delta:number,detail:string){
  let applied=delta
  if(delta<0){
    const next=applyCredit(scene,-delta)
    applied=-next.credited
    await db.query("UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
      [next.principal,next.interest,next.penalties,scene.id])
  } else if(delta>0){
    if(scene.penalties+delta>2000000)throw new ContractError(409,"Fictional penalty cap reached")
    await db.query("UPDATE scenes SET penalties=penalties+$1,updated_at=now() WHERE id=$2",[delta,scene.id])
  }
  await recordEvent(db,scene.id,actorId,applied,detail)
  return applied
}

export async function GET(req:Request){
  try{
    const actor=await player(req)
    const url=new URL(req.url),view=url.searchParams.get("view")||"templates"
    if(view==="templates"){
      const q=(url.searchParams.get("q")||"").trim().slice(0,80)
      const common="SELECT t.id,t.author_id,t.title,t.description,t.category,t.terms,t.modules,t.published,t.created_at,p.handle AS author_handle "+
        "FROM debt_contract_templates t JOIN profiles p ON p.id=t.author_id "
      const [library,mine]=await Promise.all([
        getPool().query(common+"WHERE t.published=true AND (t.title ILIKE $1 OR t.description ILIKE $1 OR t.category ILIKE $1) "+
          "ORDER BY t.published_at DESC NULLS LAST LIMIT 45",["%"+q+"%"]),
        getPool().query(common+"WHERE t.author_id=$1 ORDER BY t.updated_at DESC LIMIT 50",[actor.id])
      ])
      return respond({library:[...findOfficialTemplates(q),...library.rows],mine:mine.rows,officialCount:officialTemplates.length})
    }
    if(view==="scenes"){
      const {rows}=await getPool().query(
        "SELECT sc.scene_id,sc.title_snapshot,sc.description_snapshot,sc.modules_snapshot,"+
        "s.status,s.principal,s.interest,s.penalties,s.start_principal,s.connection_id,c.state AS connection_state,"+
        "p.handle AS other_handle FROM scene_contracts sc JOIN scenes s ON s.id=sc.scene_id "+
        "JOIN connections c ON c.id=s.connection_id JOIN profiles p "+
        "ON p.id=CASE WHEN c.sender_id=$1 THEN c.recipient_id ELSE c.sender_id END "+
        "WHERE c.sender_id=$1 OR c.recipient_id=$1 ORDER BY s.created_at DESC LIMIT 40",[actor.id])
      return respond({scenes:rows})
    }
    if(view==="scene"){
      const sceneId=parse(uuid,url.searchParams.get("id"))
      const db=await getPool().connect()
      try{
        const scene=await ownedScene(db,sceneId,actor.id,false)
        const [actions,claims]=await Promise.all([
          db.query("SELECT a.id,a.module_id,a.action,a.delta,a.details,a.created_at,p.handle AS actor_handle "+
            "FROM contract_action_log a JOIN profiles p ON p.id=a.actor_id WHERE a.scene_id=$1 "+
            "ORDER BY a.created_at DESC LIMIT 80",[sceneId]),
          db.query("SELECT q.id,q.module_id,q.task_id,q.state,q.reward,q.created_at,q.reviewed_at,"+
            "p.handle AS requester_handle FROM contract_task_claims q "+
            "JOIN profiles p ON p.id=q.requested_by WHERE q.scene_id=$1 ORDER BY q.created_at DESC LIMIT 60",[sceneId])
        ])
        return respond({scene,actions:actions.rows,claims:claims.rows})
      }finally{db.release()}
    }
    throw new ContractError(400,"Unknown contract view")
  }catch(e){return failed(e)}
}

export async function POST(req:Request){
  let db:PoolClient|null=null,transaction=false
  try{
    originGuard(req)
    const actor=await player(req)
    const body=await req.json().catch(()=>{throw new ContractError(400,"Invalid JSON")})
    if(!body||typeof body!=="object")throw new ContractError(400,"Invalid request")
    const action=body.action
    if(action==="save"){
      const definition=parse(contractDefinitionSchema,body.definition)
      const publish=parse(z.boolean(),body.publish)
      const templateId=body.templateId?parse(uuid,body.templateId):null
      if(templateId){
        const {rowCount}=await getPool().query(
          "UPDATE debt_contract_templates SET title=$1,description=$2,category=$3,terms=$4,modules=$5,"+
          "published=$6,published_at=CASE WHEN $6 AND NOT published THEN now() WHEN $6 THEN published_at ELSE NULL END,"+
          "updated_at=now() WHERE id=$7 AND author_id=$8",
          [definition.title,definition.description,definition.category,definition.terms,
           JSON.stringify(definition.modules),publish,templateId,actor.id])
        if(!rowCount)throw new ContractError(404,"Only the creator can update this contract template")
        return respond({id:templateId,message:publish?"Contract template published.":"Private contract draft saved."})
      }
      const count=await getPool().query<{count:number}>("SELECT count(*)::int AS count FROM debt_contract_templates WHERE author_id=$1",[actor.id])
      if(count.rows[0].count>=50)throw new ContractError(429,"A user can have at most 50 templates")
      const id=randomUUID()
      await getPool().query(
        "INSERT INTO debt_contract_templates(id,author_id,title,description,category,terms,modules,published,published_at) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $8 THEN now() ELSE NULL END)",
        [id,actor.id,definition.title,definition.description,definition.category,
         JSON.stringify(definition.terms),JSON.stringify(definition.modules),publish])
      return respond({id,message:publish?"Debt contract published to discovery.":"Private contract draft saved."},201)
    }
    if(action==="publish"){
      const templateId=parse(uuid,body.templateId),publish=parse(z.boolean(),body.publish)
      const {rowCount}=await getPool().query(
        "UPDATE debt_contract_templates SET published=$1,published_at=CASE WHEN $1 THEN now() ELSE NULL END,"+
        "updated_at=now() WHERE id=$2 AND author_id=$3",[publish,templateId,actor.id])
      if(!rowCount)throw new ContractError(404,"Only the creator can change publication")
      return respond({message:publish?"Contract template is discoverable.":"Contract template unpublished."})
    }
    if(action==="propose"){
      if(actor.role!=="dom")throw new ContractError(403,"Only the Dom can propose debt contract terms")
      const connectionId=parse(uuid,body.connectionId),templateId=parse(uuid,body.templateId)
      db=await getPool().connect()
      await db.query("BEGIN");transaction=true
      const connection=await db.query(
        "SELECT id FROM connections WHERE id=$1 AND state='active' AND (sender_id=$2 OR recipient_id=$2) FOR UPDATE",
        [connectionId,actor.id])
      if(!connection.rows.length)throw new ContractError(409,"An active accepted connection is required")
      const source=await db.query(
        "SELECT * FROM debt_contract_templates WHERE id=$1 AND (published=true OR author_id=$2)",
        [templateId,actor.id])
      if(!source.rows.length)throw new ContractError(404,"Contract template not available")
      const t=source.rows[0]
      const definition=parse(contractDefinitionSchema,{title:t.title,description:t.description,
        category:t.category,terms:t.terms,modules:t.modules})
      const existing=await db.query("SELECT id FROM scenes WHERE connection_id=$1 AND status<>'ended' LIMIT 1",[connectionId])
      if(existing.rows.length)throw new ContractError(409,"Finish the current scene before proposing another contract")
      const id=randomUUID(),terms=definition.terms
      await db.query(
        "INSERT INTO scenes(id,connection_id,status,start_principal,principal,monthly_rate,weekly_target,late_fee) "+
        "VALUES($1,$2,'proposed',$3,$3,$4,$5,$6)",
        [id,connectionId,terms.principal,terms.monthlyRate,terms.weeklyTarget,terms.lateFee])
      await db.query(
        "INSERT INTO scene_contracts(scene_id,template_id,author_id,title_snapshot,description_snapshot,modules_snapshot) "+
        "VALUES($1,$2,$3,$4,$5,$6)",
        [id,templateId,actor.id,definition.title,definition.description,JSON.stringify(definition.modules)])
      await db.query("COMMIT");transaction=false
      return respond({id,message:"Debt contract proposed. Your partner must approve it before play starts."},201)
    }
    if(!["play","claim","review"].includes(String(action)))throw new ContractError(400,"Unknown contract action")
    const sceneId=parse(uuid,body.sceneId)
    db=await getPool().connect()
    await db.query("BEGIN");transaction=true
    const scene=await ownedScene(db,sceneId,actor.id)
    ensurePlaying(scene)
    const modules=parseModules(scene.modules_snapshot)
    if(action==="play"){
      const moduleId=parse(uuid,body.moduleId)
      const module=modules.find(m=>m.id===moduleId)
      if(!module||module.type==="tasks")throw new ContractError(404,"Interactive game module not available")
      if(module.type==="checkin" && actor.role!=="sub")
        throw new ContractError(403,"Only the Sub can check in for the reward")
      const {rows:count}=await db.query<{count:number}>(
        "SELECT count(*)::int AS count FROM contract_action_log WHERE scene_id=$1 AND created_at>now()-interval '24 hours'",[sceneId])
      if(count[0].count>=40)throw new ContractError(429,"Daily contract action safety limit reached")
      const {rows:history}=await db.query<{created_at:Date}>(
        "SELECT created_at FROM contract_action_log WHERE scene_id=$1 AND module_id=$2 "+
        "ORDER BY created_at DESC LIMIT 1",[sceneId,moduleId])
      const cooldown=availableAfterCooldown(history[0]?.created_at||null,module.cooldownHours)
      if(!cooldown.ready)throw new ContractError(429,"This module is cooling down. Try again later.")
      let requested=0,details:Record<string,unknown>={},description=""
      if(module.type==="dice"){
        const playerRoll=randomInt(1,module.sides+1),botRoll=randomInt(1,module.sides+1)
        requested=duelDelta(playerRoll,botRoll,module.stake)
        details={playerRoll,botRoll,sides:module.sides,stake:module.stake}
        description=module.name+": dice "+playerRoll+" vs "+botRoll
      }else if(module.type==="wheel"){
        const outcomeIndex=randomInt(module.outcomes.length),outcome=module.outcomes[outcomeIndex]
        requested=outcome.delta
        details={outcomeIndex,label:outcome.label,delta:outcome.delta}
        description=module.name+": "+outcome.label
      }else if(module.type==="random"){
        const totalWeight=module.outcomes.reduce((sum,item)=>sum+item.weight,0)
        const outcome=weightedOutcome(module.outcomes,randomInt(totalWeight))
        requested=outcome.delta
        details={label:outcome.label,weight:outcome.weight,totalWeight,delta:outcome.delta}
        description=module.name+": random event — "+outcome.label
      }else{
        const outcome=checkinDelta({
          previous:history[0]?.created_at||null,
          started:scene.approved_at||null,
          intervalHours:module.cooldownHours,
          reward:module.reward,
          latePenalty:module.latePenalty,
        })
        requested=outcome.delta
        details={reward:module.reward,overdue:outcome.overdue,latePenalty:outcome.latePenalty}
        description=module.name+(outcome.overdue?" — late check-in completed":" — check-in completed")
      }
      const applied=await applyDelta(db,scene,actor.id,requested,description)
      await db.query(
        "INSERT INTO contract_action_log(id,scene_id,module_id,actor_id,action,delta,details) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7)",
        [randomUUID(),sceneId,moduleId,actor.id,module.type,applied,JSON.stringify(details)])
      await db.query("COMMIT");transaction=false
      return respond({delta:applied,details,message:description+
        (applied<0?" · "+Math.abs(applied).toLocaleString()+" credits":
         applied>0?" · "+applied.toLocaleString()+" fictional penalties":" · no balance change")})
    }
    if(action==="claim"){
      if(actor.role!=="sub")throw new ContractError(403,"Only the Sub can submit task claims")
      const moduleId=parse(uuid,body.moduleId),taskId=parse(uuid,body.taskId)
      const module=modules.find(m=>m.id===moduleId&&m.type==="tasks")
      if(!module||module.type!=="tasks")throw new ContractError(404,"Tasks module unavailable")
      const task=module.tasks.find(t=>t.id===taskId)
      if(!task)throw new ContractError(404,"Task not found in the agreed contract")
      const claimId=randomUUID()
      await db.query(
        "INSERT INTO contract_task_claims(id,scene_id,module_id,task_id,requested_by,reward) "+
        "VALUES($1,$2,$3,$4,$5,$6)",[claimId,sceneId,moduleId,taskId,actor.id,task.reward])
      await db.query("COMMIT");transaction=false
      return respond({claimId,message:"Task submitted. Your partner must verify completion."},201)
    }
    if(actor.role!=="dom")throw new ContractError(403,"Only the Dom can review task claims")
    const claimId=parse(uuid,body.claimId),approve=parse(z.boolean(),body.approve)
    const {rows:claims}=await db.query(
      "SELECT * FROM contract_task_claims WHERE id=$1 AND scene_id=$2 FOR UPDATE",[claimId,sceneId])
    const claim=claims[0]
    if(!claim||claim.state!=="pending")throw new ContractError(409,"Task claim is unavailable or already reviewed")
    let applied=0
    if(approve)applied=await applyDelta(db,scene,actor.id,-claim.reward,
      "Completed agreed task ("+claim.reward+" credit reward)")
    await db.query(
      "UPDATE contract_task_claims SET state=$1,reviewed_by=$2,reviewed_at=now() WHERE id=$3",
      [approve?"approved":"rejected",actor.id,claimId])
    await db.query("COMMIT");transaction=false
    return respond({delta:applied,message:approve?"Task approved; "+Math.abs(applied).toLocaleString()+" imaginary credits applied.":"Task claim declined."})
  }catch(e){
    if(db && transaction)await db.query("ROLLBACK").catch(()=>{})
    return failed(e)
  }finally{db?.release()}
}
