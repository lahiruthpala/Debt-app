import {randomInt,randomUUID} from "node:crypto"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {applyCredit} from "@/lib/ledger"
import {quickGameKeys,resolveQuickGame} from "@/lib/quick-games"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const gameSchema=z.enum(quickGameKeys)
const uuid=z.string().uuid()
const cooldownMs=24*60*60*1000
class QuickError extends Error{constructor(public status:number,message:string){super(message)}}
const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{"Cache-Control":"no-store"}})
function parse<T>(schema:z.ZodType<T>,value:unknown):T{
  const result=schema.safeParse(value)
  if(!result.success)throw new QuickError(400,result.error.issues[0]?.message||"Invalid input")
  return result.data
}
function verifyOrigin(req:Request){
  const origin=req.headers.get("origin")
  if(origin){
    try{
      const own=new URL(req.url)
      const host=req.headers.get("host")
      if([own.origin,...(host?[own.protocol+"//"+host]:[])].includes(new URL(origin).origin))return
    }catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new QuickError(403,"Request origin rejected")
}
async function identity(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new QuickError(503,"Quick games are not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new QuickError(401,"Please sign in")
  const profile=await getPool().query<{adult_confirmed:boolean,role:string}>(
    "SELECT adult_confirmed,role FROM profiles WHERE id=$1",[session.user.id])
  if(!profile.rows[0]?.adult_confirmed)throw new QuickError(403,"Complete your adult profile first")
  return {id:session.user.id,role:profile.rows[0].role}
}
function errorReply(error:unknown){
  if(error instanceof QuickError)return reply({error:error.message},error.status)
  console.error("Quick games:",error instanceof Error?error.message:"Unknown")
  return reply({error:"Game action failed"},500)
}
export async function GET(req:Request){
  try{
    const actor=await identity(req)
    const sceneId=parse(uuid,new URL(req.url).searchParams.get("sceneId"))
    const rows=await getPool().query(
      `SELECT p.game_key,p.played_at,p.outcome_label,p.delta FROM quick_game_plays p
        JOIN scenes s ON s.id=p.scene_id JOIN connections c ON c.id=s.connection_id
        WHERE p.scene_id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2)`,
      [sceneId,actor.id]
    )
    // The scene must belong to the actor, even when there have been no plays.
    const member=await getPool().query(
      "SELECT s.id FROM scenes s JOIN connections c ON c.id=s.connection_id WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2)",
      [sceneId,actor.id])
    if(!member.rowCount)throw new QuickError(404,"Scene not found")
    return reply({plays:rows.rows})
  }catch(error){return errorReply(error)}
}
export async function POST(req:Request){
  let db:Awaited<ReturnType<ReturnType<typeof getPool>["connect"]>>|null=null
  let started=false
  try{
    verifyOrigin(req)
    const actor=await identity(req)
    if(actor.role!=="sub")throw new QuickError(403,"Only the Sub can choose fictional-debt outcomes")
    const body=await req.json().catch(()=>{throw new QuickError(400,"Invalid JSON")})
    const input=parse(z.object({
      sceneId:uuid,
      game:gameSchema,
      choice:z.string().min(1).max(12),
    }),body)
    // Fail invalid choices before taking a database lock or consuming a cooldown.
    let sampled
    try{sampled=resolveQuickGame(input.game,input.choice,0)}catch(error){
      throw new QuickError(400,error instanceof Error?error.message:"Invalid game choice")
    }
    void sampled
    db=await getPool().connect()
    await db.query("BEGIN")
    started=true
    const {rows}=await db.query(
      `SELECT s.id,s.status,s.principal,s.interest,s.penalties,c.state AS connection_state
       FROM scenes s JOIN connections c ON c.id=s.connection_id
       WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2)
       FOR UPDATE OF s`,
      [input.sceneId,actor.id]
    )
    if(!rows.length)throw new QuickError(404,"Scene not found")
    const scene=rows[0] as {id:string;status:string;principal:number;interest:number;penalties:number;connection_state:string}
    if(scene.status!=="active"||scene.connection_state!=="active")
      throw new QuickError(409,"An active, approved scene is required to play")
    const prev=await db.query<{played_at:Date}>(
      "SELECT played_at FROM quick_game_plays WHERE scene_id=$1 AND game_key=$2",
      [input.sceneId,input.game]
    )
    if(prev.rows.length && Date.now()-new Date(prev.rows[0].played_at).getTime()<cooldownMs)
      throw new QuickError(429,"This game can be played once every 24 hours in this scene")
    const draw=randomInt(0,6)
    const outcome=resolveQuickGame(input.game,input.choice,draw)
    let delta=outcome.delta
    const next={principal:scene.principal,interest:scene.interest,penalties:scene.penalties}
    if(delta<0){
      const credit=applyCredit(next,-delta)
      delta=-credit.credited
      next.principal=credit.principal
      next.interest=credit.interest
      next.penalties=credit.penalties
    }else if(delta>0){
      if(next.penalties+delta>2000000)throw new QuickError(409,"Fictional penalty cap reached")
      next.penalties+=delta
    }
    await db.query(
      "UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
      [next.principal,next.interest,next.penalties,input.sceneId])
    const description=`${outcome.label} · ${outcome.detail} · ${delta===0?"No balance change":delta<0?"Credit "+Math.abs(delta).toLocaleString():"Penalty "+delta.toLocaleString()} fictional units`
    await db.query(
      `INSERT INTO quick_game_plays (scene_id,game_key,actor_id,played_at,outcome_label,delta)
       VALUES($1,$2,$3,now(),$4,$5)
       ON CONFLICT(scene_id,game_key)
       DO UPDATE SET actor_id=EXCLUDED.actor_id,played_at=EXCLUDED.played_at,outcome_label=EXCLUDED.outcome_label,delta=EXCLUDED.delta`,
      [input.sceneId,input.game,actor.id,outcome.label,delta]
    )
    await db.query(
      "INSERT INTO ledger_events(id,scene_id,actor_id,type,amount,detail) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(),input.sceneId,actor.id,"quick_"+input.game,delta,description])
    await db.query("COMMIT");started=false
    return reply({message:description,result:{game:input.game,label:outcome.label,detail:outcome.detail,delta}},201)
  }catch(error){
    if(started&&db)await db.query("ROLLBACK").catch(()=>{})
    return errorReply(error)
  }finally{db?.release()}
}
