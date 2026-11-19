import {randomUUID} from "node:crypto"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"

export const runtime="nodejs"
export const dynamic="force-dynamic"

// A dedicated, uncredentialed system principal. Never give it a login/password.
export const AI_DOM_ID="vl-system-ai-dom-v1"
const AI_DOM_EMAIL="ai-dom@users.invalid"
const AI_DOM_HANDLE="Velvet_AI_Dom"
const uuid=z.string().uuid()
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}})

class AiDomError extends Error {
  constructor(public status:number,message:string){super(message)}
}
function originGuard(req:Request) {
  const origin=req.headers.get("origin"),url=new URL(req.url),host=req.headers.get("host")
  if(origin){
    try {
      if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(origin).origin))return
    }catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new AiDomError(403,"Request origin rejected")
}
async function subFor(req:Request) {
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new AiDomError(503,"AI Dom mode is not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new AiDomError(401,"Sign in required")
  const {rows}=await getPool().query<{id:string;role:string;adult_confirmed:boolean;is_ai:boolean}>(
    "SELECT id,role,adult_confirmed,is_ai FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed||rows[0].role!=="sub"||rows[0].is_ai)
    throw new AiDomError(403,"Only adult Sub accounts can start AI Dom scenes")
  return rows[0].id
}
async function provisionBot(db:PoolClient){
  // Serialize first-time initialization across simultaneous first users.
  await db.query("SELECT pg_advisory_xact_lock(hashtext('velvet-ledger-ai-dom-v1'))")
  await db.query(
    'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true) ON CONFLICT(id) DO NOTHING',
    [AI_DOM_ID,"Velvet AI Dom",AI_DOM_EMAIL])
  const {rows:users}=await db.query<{email:string}>(
    'SELECT email FROM "user" WHERE id=$1',[AI_DOM_ID])
  if(users[0]?.email!==AI_DOM_EMAIL)throw new AiDomError(409,"AI Dom system identity is reserved")
  await db.query(
    "INSERT INTO profiles(id,handle,role,bio,discoverable,adult_confirmed,is_ai) "+
    "VALUES($1,$2,'dom',$3,false,true,true) ON CONFLICT(id) DO NOTHING",
    [AI_DOM_ID,AI_DOM_HANDLE,"Clearly labeled AI roleplay partner. No real payments or physical control."])
  const {rows}=await db.query<{role:string;is_ai:boolean;handle:string}>(
    "SELECT role,is_ai,handle FROM profiles WHERE id=$1",[AI_DOM_ID])
  if(!rows[0]?.is_ai||rows[0].role!=="dom"||rows[0].handle!==AI_DOM_HANDLE)
    throw new AiDomError(409,"AI Dom system profile is inconsistent")
}
function failure(error:unknown){
  if(error instanceof AiDomError)return respond({error:error.message},error.status)
  console.error("AI Dom:",error instanceof Error?error.message:"Unknown error")
  return respond({error:"AI Dom operation failed"},500)
}
export async function GET(req:Request){
  try{
    const subId=await subFor(req)
    const {rows}=await getPool().query(
      "SELECT a.scene_id AS \"sceneId\",a.enabled,s.status,s.created_at AS \"createdAt\" "+
      "FROM ai_dom_scenes a JOIN scenes s ON s.id=a.scene_id WHERE a.sub_id=$1 "+
      "ORDER BY s.created_at DESC LIMIT 30",[subId])
    return respond({scenes:rows,botHandle:AI_DOM_HANDLE})
  }catch(error){return failure(error)}
}
export async function POST(req:Request){
  let db:PoolClient|null=null
  try{
    originGuard(req)
    const subId=await subFor(req)
    const body=await req.json().catch(()=>null)
    const input=z.discriminatedUnion("action",[
      z.object({action:z.literal("start"),confirmAI:z.literal(true)}).strict(),
      z.object({action:z.literal("enable"),sceneId:uuid,confirmAI:z.literal(true)}).strict(),
      z.object({action:z.literal("disable"),sceneId:uuid}).strict(),
    ]).safeParse(body)
    if(!input.success)throw new AiDomError(400,"Provide a valid action and explicit AI consent")
    db=await getPool().connect()
    await db.query("BEGIN")
    if(input.data.action==="start"){
      await provisionBot(db)
      const pair=[AI_DOM_ID,subId].sort().join(":")
      const {rows:links}=await db.query<{id:string;state:string}>(
        "SELECT id,state FROM connections WHERE pair_key=$1 FOR UPDATE",[pair])
      let connectionId=links[0]?.id
      if(links.length){
        if(links[0].state==="blocked"||links[0].state==="pending")
          throw new AiDomError(409,"This AI connection has been blocked or is pending")
        if(links[0].state!=="active"){
          await db.query("UPDATE connections SET state='active',blocked_by=NULL,updated_at=now() WHERE id=$1",[connectionId])
        }
      }else{
        connectionId=randomUUID()
        await db.query(
          "INSERT INTO connections(id,pair_key,sender_id,recipient_id,state) "+
          "VALUES($1,$2,$3,$4,'active')",[connectionId,pair,AI_DOM_ID,subId])
      }
      const {rows:old}=await db.query<{id:string;status:string;enabled:boolean}>(
        "SELECT s.id,s.status,COALESCE(a.enabled,false) AS enabled FROM scenes s "+
        "LEFT JOIN ai_dom_scenes a ON a.scene_id=s.id "+
        "WHERE s.connection_id=$1 AND s.status<>'ended' ORDER BY s.created_at DESC LIMIT 1 FOR UPDATE OF s",
        [connectionId])
      if(old.length){
        await db.query("COMMIT")
        return respond({sceneId:old[0].id,status:old[0].status,enabled:old[0].enabled,
          message:"An AI Dom scene already exists. Its current consent state has not changed."})
      }
      const sceneId=randomUUID()
      await db.query(
        "INSERT INTO scenes(id,connection_id,status,start_principal,principal,monthly_rate,weekly_target,late_fee) "+
        "VALUES($1,$2,'proposed',0,0,0,0,0)",[sceneId,connectionId])
      const modules=[{id:randomUUID(),name:"Optional creative tasks",type:"tasks",
        tasks:[{id:randomUUID(),label:"Complete a voluntary fictional challenge",reward:0}]}]
      await db.query(
        "INSERT INTO scene_contracts(scene_id,author_id,title_snapshot,description_snapshot,category_snapshot,modules_snapshot) "+
        "VALUES($1,$2,$3,$4,$5,$6)",
        [sceneId,AI_DOM_ID,"AI Dom — voluntary roleplay",
          "AI-generated text roleplay. No payments, mandatory tasks, real debt or automatic charges. You can stop at any time.",
          "AI Roleplay",JSON.stringify(modules)])
      await db.query("INSERT INTO ai_dom_scenes(scene_id,sub_id,dom_id) VALUES($1,$2,$3)",
        [sceneId,subId,AI_DOM_ID])
      await db.query(
        "INSERT INTO scene_safety_prefs(scene_id,user_id,limits,ai_opt_in) VALUES($1,$2,$3,true)",
        [sceneId,subId,JSON.stringify(["no-real-money","no-intimate-images","no-device-control",
          "no-public-sharing","no-location-sharing","no-unexpected-tasks"])])
      await db.query("COMMIT")
      return respond({sceneId,status:"proposed",enabled:true,
        message:"AI scene proposed. Review and approve its fictional contract before play begins."},201)
    }
    const sceneId=input.data.sceneId
    const {rows}=await db.query<{status:string;enabled:boolean}>(
      "SELECT s.status,a.enabled FROM ai_dom_scenes a JOIN scenes s ON s.id=a.scene_id "+
      "WHERE a.scene_id=$1 AND a.sub_id=$2 FOR UPDATE OF s,a",[sceneId,subId])
    if(!rows.length)throw new AiDomError(404,"AI Dom scene not found")
    if(rows[0].status==="ended")throw new AiDomError(409,"Ended scenes cannot be reactivated")
    const enabled=input.data.action==="enable"
    await db.query("UPDATE ai_dom_scenes SET enabled=$1,updated_at=now() WHERE scene_id=$2",
      [enabled,sceneId])
    await db.query("UPDATE scene_safety_prefs SET ai_opt_in=$1,updated_at=now() "+
      "WHERE scene_id=$2 AND user_id=$3",[enabled,sceneId,subId])
    if(!enabled){
      await db.query("UPDATE scenes SET status='paused',updated_at=now() WHERE id=$1 AND status='active'",
        [sceneId])
    }
    await db.query("COMMIT")
    return respond({sceneId,enabled,
      message:enabled?"AI access enabled. A paused scene still requires your explicit resume.":
        "AI access disabled and active scene paused."})
  }catch(error){
    if(db)await db.query("ROLLBACK").catch(()=>{})
    return failure(error)
  }finally{db?.release()}
}
