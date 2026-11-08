import { randomInt } from "node:crypto"
import type { PoolClient } from "pg"
import { z } from "zod"
import { getAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"
import { applyCredit } from "@/lib/ledger"
import { parseEngine, type Mechanic } from "@/lib/contract-modules"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const idSchema=z.string().uuid()
const moduleName=z.enum(["wheel","dice","checkin"])
class ContractError extends Error {constructor(public status:number,message:string){super(message)}}
function respond(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}})}
function guard(req:Request){
  const origin=req.headers.get("origin")
  if (origin){
    try {
      const url=new URL(req.url)
      const host=req.headers.get("host")
      if ([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(origin).origin))return
    } catch {}
  } else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new ContractError(403,"Request origin rejected")
}
async function actor(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)throw new ContractError(503,"Not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new ContractError(401,"Please sign in")
  const p=await getPool().query("SELECT adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!p.rows[0]?.adult_confirmed)throw new ContractError(403,"Complete your profile first")
  return session.user.id
}
function validated<T>(schema:z.ZodType<T>,value:unknown):T{
  const result=schema.safeParse(value)
  if(!result.success)throw new ContractError(400,"Invalid contract request")
  return result.data
}
async function getScene(db:PoolClient,sceneId:string,user:string,lock=false){
  const r=await db.query(
    "SELECT s.id,s.status,s.engine_snapshot,s.principal,s.interest,s.penalties,s.approved_at,"+
    "c.state AS connection_state FROM scenes s JOIN connections c ON c.id=s.connection_id "+
    "WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+(lock?"FOR UPDATE OF s":""),
    [sceneId,user]
  )
  if(!r.rows.length)throw new ContractError(404,"Contract not found")
  return r.rows[0] as {
    id:string;status:string;engine_snapshot:unknown;principal:number;interest:number;penalties:number;
    approved_at:Date|null;connection_state:string
  }
}
function fail(error:unknown){
  if(error instanceof ContractError)return respond({error:error.message},error.status)
  console.error("Contract module:",error instanceof Error?error.message:"Unknown error")
  return respond({error:"Unable to play this contract module."},500)
}
export async function GET(req:Request){
  try{
    const user=await actor(req)
    const id=validated(idSchema,new URL(req.url).searchParams.get("sceneId"))
    const db=await getPool().connect()
    try{
      const scene=await getScene(db,id,user)
      const engine=parseEngine(scene.engine_snapshot)
      const actions=await db.query(
        "SELECT module_id,last_used_at,uses FROM contract_module_actions WHERE scene_id=$1",[id]
      )
      return respond({
        status:scene.status,connectionState:scene.connection_state,
        modules:engine.modules,
        history:actions.rows,
      })
    }finally{db.release()}
  }catch(error){return fail(error)}
}
export async function POST(req:Request){
  let db:PoolClient|null=null
  try{
    guard(req)
    const user=await actor(req)
    const body=await req.json().catch(()=>{throw new ContractError(400,"Invalid JSON")})
    const id=validated(idSchema,body?.sceneId)
    const moduleType=validated(moduleName,body?.moduleType)
    db=await getPool().connect()
    await db.query("BEGIN")
    const scene=await getScene(db,id,user,true)
    if(scene.status!=="active"||scene.connection_state!=="active")
      throw new ContractError(409,"This contract must be active and mutually approved")
    const config=parseEngine(scene.engine_snapshot)
    const module=config.modules.find(item=>item.type===moduleType)
    if(!module)throw new ContractError(404,"This module is not part of the approved contract")
    const existing=await db.query(
      "SELECT last_used_at,uses FROM contract_module_actions WHERE scene_id=$1 AND module_id=$2",
      [id,moduleType]
    )
    const last=existing.rows[0]?.last_used_at?new Date(existing.rows[0].last_used_at).getTime():null
    const now=Date.now()
    const interval=module.type==="checkin"?module.intervalHours*3600000:module.cooldownMinutes*60000
    if(last!==null&&now-last<interval)
      throw new ContractError(429,"Next "+moduleType+" action is available after "+new Date(last+interval).toISOString())
    let delta=0
    let result=""
    if(module.type==="wheel"){
      const item=module.segments[randomInt(module.segments.length)]
      delta=item.delta
      result="Wheel landed on "+item.label
    }else if(module.type==="dice"){
      const player=randomInt(1,module.sides+1)
      const rival=randomInt(1,module.sides+1)
      delta=Math.max(-5000,Math.min(5000,(rival-player)*module.stake))
      result="You rolled "+player+", bot rolled "+rival
    }else{
      const previous=last??(scene.approved_at?new Date(scene.approved_at).getTime():now)
      const overdue=now-previous>module.intervalHours*3600000*2
      delta=(overdue?module.latePenalty:0)-module.credit
      result=overdue?"Late check-in recorded":"On-time check-in recorded"
    }
    // All positive effects are bounded fictional penalties; negative effects
    // are credits allocated against penalties, interest and principal.
    const positive=Math.max(0,delta)
    if(scene.penalties+positive>2000000)
      throw new ContractError(409,"Fictional penalty cap reached")
    let balance={principal:scene.principal,interest:scene.interest,penalties:scene.penalties+positive}
    let applied=positive
    if(delta<0){
      const resultCredit=applyCredit(balance,-delta)
      applied=-resultCredit.credited
      balance=resultCredit
    }
    await db.query(
      "UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
      [balance.principal,balance.interest,balance.penalties,id]
    )
    await db.query(
      "INSERT INTO ledger_events(id,scene_id,actor_id,type,amount,detail) "+
      "VALUES (gen_random_uuid(),$1,$2,$3,$4,$5)",
      [id,user,"module_"+moduleType,applied,result]
    )
    await db.query(
      "INSERT INTO contract_module_actions(scene_id,module_id,last_used_at,uses) VALUES ($1,$2,now(),1) "+
      "ON CONFLICT(scene_id,module_id) DO UPDATE SET last_used_at=now(),uses=contract_module_actions.uses+1",
      [id,moduleType]
    )
    await db.query("COMMIT")
    return respond({
      message:result+(applied<0?" · "+Math.abs(applied)+" fictional credits":applied>0?" · +"+applied+" fictional penalties":" · no balance change"),
      result,delta:applied,nextAvailableAt:new Date(now+interval).toISOString(),
    })
  }catch(error){
    if(db)await db.query("ROLLBACK").catch(()=>{})
    return fail(error)
  }finally{db?.release()}
}
