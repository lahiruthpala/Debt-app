import { randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { z } from "zod"
import { getAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"
import { engineSchema, EMPTY_ENGINE } from "@/lib/contract-modules"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

class GameError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
const respond = (payload: unknown, status=200) =>
  Response.json(payload, { status, headers: { "Cache-Control": "no-store" } })
const uuid = z.string().uuid()
const text = (min: number, max: number) => z.string().trim().min(min).max(max)
const gameInput = z.object({
  title: text(3,80),
  summary: text(10,240),
  category: text(3,30),
  rules: text(20,4000),
  openingPrompt: z.string().trim().max(1000),
  publish: z.boolean(),
  engineConfig: engineSchema.default(EMPTY_ENGINE),
})
function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data)
  if (!parsed.success) throw new GameError(400, parsed.error.issues[0]?.message || "Invalid input")
  return parsed.data
}
function originGuard(req: Request) {
  const origin = req.headers.get("origin")
  if (origin) {
    try {
      const url = new URL(req.url)
      const host = req.headers.get("host")
      const allowed = [url.origin, ...(host ? [url.protocol + "//" + host] : [])]
      if (allowed.includes(new URL(origin).origin)) return
    } catch {}
  } else if (req.headers.get("sec-fetch-site") === "same-origin") {
    return
  }
  throw new GameError(403,"Request origin rejected")
}
async function requirePlayer(req: Request): Promise<string> {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET)
    throw new GameError(503, "Game service is not configured")
  const session = await getAuth().api.getSession({headers:req.headers})
  if (!session) throw new GameError(401,"Please sign in")
  const { rows } = await getPool().query<{adult_confirmed:boolean}>(
    "SELECT adult_confirmed FROM profiles WHERE id=$1", [session.user.id]
  )
  if (!rows[0]?.adult_confirmed) throw new GameError(403,"Complete your adult profile first")
  return session.user.id
}
function fail(error:unknown) {
  if (error instanceof GameError) return respond({error:error.message},error.status)
  if ((error as {code?:string})?.code === "23505")
    return respond({error:"Finish the current game before starting another in this scene."},409)
  console.error("Community games:", error instanceof Error ? error.message : "Unknown error")
  return respond({error:"Unable to complete game action."},500)
}
async function playableScene(db:PoolClient, sceneId:string, actorId:string) {
  const {rows}=await db.query(
    "SELECT s.id,s.status,c.state AS connection_state FROM scenes s "+
    "JOIN connections c ON c.id=s.connection_id "+
    "WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) FOR UPDATE OF s",
    [sceneId,actorId]
  )
  if (!rows.length) throw new GameError(404,"Connection scene not found")
  if (rows[0].status !== "active" || rows[0].connection_state !== "active")
    throw new GameError(409,"An active, mutually approved scene is required")
}
async function sessionFor(db:PoolClient,id:string,actorId:string) {
  const {rows}=await db.query(
    "SELECT gs.*,s.status AS scene_status,c.state AS connection_state "+
    "FROM community_game_sessions gs JOIN scenes s ON s.id=gs.scene_id "+
    "JOIN connections c ON c.id=s.connection_id "+
    "WHERE gs.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) FOR UPDATE OF gs",
    [id,actorId]
  )
  if (!rows.length) throw new GameError(404,"Game session not found")
  return rows[0] as { id:string;scene_id:string;state:string;scene_status:string;connection_state:string }
}
export async function GET(req:Request) {
  try {
    const actorId=await requirePlayer(req)
    const url=new URL(req.url)
    const view=url.searchParams.get("view") || "library"
    if (view==="library") {
      const q=(url.searchParams.get("q") || "").trim().slice(0,80)
      const games=await getPool().query(
        "SELECT g.id,g.author_id,g.title,g.summary,g.category,g.rules,g.opening_prompt,g.engine_config,g.published,g.created_at,"+
        "p.handle AS author_handle,(SELECT count(*)::int FROM community_game_sessions gs WHERE gs.game_id=g.id) AS play_count "+
        "FROM community_games g JOIN profiles p ON p.id=g.author_id "+
        "WHERE g.published=true AND (g.title ILIKE $1 OR g.summary ILIKE $1 OR g.category ILIKE $1) "+
        "ORDER BY g.published_at DESC NULLS LAST,g.created_at DESC LIMIT 48",
        ["%"+q+"%"]
      )
      const mine=await getPool().query(
        "SELECT g.id,g.author_id,g.title,g.summary,g.category,g.rules,g.opening_prompt,g.engine_config,g.published,g.created_at,"+
        "p.handle AS author_handle,(SELECT count(*)::int FROM community_game_sessions gs WHERE gs.game_id=g.id) AS play_count "+
        "FROM community_games g JOIN profiles p ON p.id=g.author_id "+
        "WHERE g.author_id=$1 ORDER BY g.updated_at DESC LIMIT 50", [actorId]
      )
      return respond({games:games.rows,mine:mine.rows})
    }
    if (view==="sessions") {
      const sceneId=parse(uuid,url.searchParams.get("sceneId"))
      const {rows}=await getPool().query(
        "SELECT gs.id,gs.scene_id,gs.game_id,gs.title_snapshot,gs.state,gs.created_at,gs.finished_at,"+
        "p.handle AS started_by_handle FROM community_game_sessions gs "+
        "JOIN scenes s ON s.id=gs.scene_id JOIN connections c ON c.id=s.connection_id "+
        "JOIN profiles p ON p.id=gs.started_by "+
        "WHERE gs.scene_id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) "+
        "ORDER BY gs.created_at DESC LIMIT 25", [sceneId,actorId]
      )
      return respond({sessions:rows})
    }
    if (view==="session") {
      const id=parse(uuid,url.searchParams.get("id"))
      const {rows}=await getPool().query(
        "SELECT gs.id,gs.game_id,gs.scene_id,gs.title_snapshot,gs.rules_snapshot,gs.prompt_snapshot,"+
        "gs.state,gs.created_at,gs.finished_at,p.handle AS started_by_handle "+
        "FROM community_game_sessions gs JOIN scenes s ON s.id=gs.scene_id "+
        "JOIN connections c ON c.id=s.connection_id JOIN profiles p ON p.id=gs.started_by "+
        "WHERE gs.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2)", [id,actorId]
      )
      if (!rows.length) throw new GameError(404,"Game session not found")
      const turns=await getPool().query(
        "SELECT t.id,t.content,t.created_at,p.handle AS actor_handle,t.actor_id "+
        "FROM community_game_turns t JOIN profiles p ON p.id=t.actor_id "+
        "WHERE t.session_id=$1 ORDER BY t.created_at,t.id LIMIT 80", [id]
      )
      return respond({session:rows[0],turns:turns.rows})
    }
    throw new GameError(400,"Unknown game view")
  } catch(error) { return fail(error) }
}
export async function POST(req:Request) {
  let db:PoolClient|null=null
  let inTransaction=false
  try {
    originGuard(req)
    const actorId=await requirePlayer(req)
    const body=await req.json().catch(()=>{throw new GameError(400,"Invalid JSON")})
    if (!body || typeof body!=="object") throw new GameError(400,"Invalid request")
    const action:unknown=body.action
    if (action==="create" || action==="update") {
      const game=parse(gameInput,body)
      const {rows: countRows}=await getPool().query<{total:number}>(
        "SELECT count(*)::int AS total FROM community_games WHERE author_id=$1",[actorId]
      )
      if (action==="create") {
        if (countRows[0].total>=50) throw new GameError(429,"You may create up to 50 games")
        const id=randomUUID()
        await getPool().query(
          "INSERT INTO community_games(id,author_id,title,summary,category,rules,opening_prompt,engine_config,published,published_at) "+
          "VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,CASE WHEN $9 THEN now() ELSE NULL END)",
          [id,actorId,game.title,game.summary,game.category,game.rules,game.openingPrompt,JSON.stringify(game.engineConfig),game.publish]
        )
        return respond({id,message:game.publish?"Your game is published in Discover!":"Draft saved. Publish it when ready."},201)
      }
      const id=parse(uuid,body.gameId)
      const {rowCount}=await getPool().query(
        "UPDATE community_games SET title=$1,summary=$2,category=$3,rules=$4,opening_prompt=$5,engine_config=$6::jsonb,"+
        "published=$7,published_at=CASE WHEN $7 AND published=false THEN now() WHEN $7 THEN published_at ELSE NULL END,"+
        "updated_at=now() WHERE id=$8 AND author_id=$9",
        [game.title,game.summary,game.category,game.rules,game.openingPrompt,JSON.stringify(game.engineConfig),game.publish,id,actorId]
      )
      if (!rowCount) throw new GameError(404,"Only the creator can edit this game")
      return respond({message:"Game changes saved."})
    }
    if (action==="publish") {
      const id=parse(uuid,body.gameId)
      const publish=parse(z.boolean(),body.publish)
      const {rowCount}=await getPool().query(
        "UPDATE community_games SET published=$1,published_at=CASE WHEN $1 THEN now() ELSE NULL END,"+
        "updated_at=now() WHERE id=$2 AND author_id=$3", [publish,id,actorId]
      )
      if (!rowCount) throw new GameError(404,"Only the creator can change publication")
      return respond({message:publish?"Game published to Discover!":"Game unpublished. Existing sessions remain available."})
    }
    if (action==="report") {
      const id=parse(uuid,body.gameId)
      const reason=parse(text(10,500),body.reason)
      const {rows}=await getPool().query(
        "INSERT INTO community_game_reports(game_id,reporter_id,reason) "+
        "SELECT g.id,$2,$3 FROM community_games g WHERE g.id=$1 AND g.published=true AND g.author_id<>$2 "+
        "ON CONFLICT(game_id,reporter_id) DO UPDATE SET reason=EXCLUDED.reason,created_at=now() "+
        "RETURNING game_id", [id,actorId,reason]
      )
      if (!rows.length) throw new GameError(404,"This published game cannot be reported")
      return respond({message:"Report recorded. Thank you for flagging this game."})
    }
    if (!["start","turn","finish"].includes(String(action))) throw new GameError(400,"Unknown game action")
    db=await getPool().connect()
    await db.query("BEGIN")
    inTransaction=true
    if (action==="start") {
      const sceneId=parse(uuid,body.sceneId)
      const gameId=parse(uuid,body.gameId)
      await playableScene(db,sceneId,actorId)
      const {rows}=await db.query(
        "SELECT title,rules,opening_prompt FROM community_games WHERE id=$1 AND published=true",
        [gameId]
      )
      if (!rows.length) throw new GameError(404,"Game is not published")
      const game=rows[0] as {title:string;rules:string;opening_prompt:string}
      const {rows:created}=await db.query(
        "INSERT INTO community_game_sessions(id,game_id,scene_id,started_by,title_snapshot,rules_snapshot,prompt_snapshot) "+
        "VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [randomUUID(),gameId,sceneId,actorId,game.title,game.rules,game.opening_prompt]
      )
      await db.query("COMMIT");inTransaction=false
      return respond({id:created[0].id,message:"Game started! Both partners can now take turns."},201)
    }
    const id=parse(uuid,body.sessionId)
    const session=await sessionFor(db,id,actorId)
    if (action==="turn") {
      const content=parse(text(1,1200),body.content)
      if(session.state!=="active" || session.scene_status!=="active" || session.connection_state!=="active")
        throw new GameError(409,"This game cannot accept moves while the scene is paused or ended")
      const {rows}=await db.query<{total:number}>(
        "SELECT count(*)::int AS total FROM community_game_turns WHERE session_id=$1",[id]
      )
      if (rows[0].total>=80) throw new GameError(409,"This game has reached 80 turns. Finish and start a new game.")
      await db.query(
        "INSERT INTO community_game_turns(id,session_id,actor_id,content) VALUES ($1,$2,$3,$4)",
        [randomUUID(),id,actorId,content]
      )
      await db.query("COMMIT");inTransaction=false
      return respond({message:"Your move was added to the game."},201)
    }
    if (session.state!=="active") throw new GameError(409,"Game has already finished")
    await db.query("UPDATE community_game_sessions SET state='finished',finished_at=now() WHERE id=$1",[id])
    await db.query("COMMIT");inTransaction=false
    return respond({message:"Game finished. Its story remains in your shared history."})
  } catch(error) {
    if(db && inTransaction) await db.query("ROLLBACK").catch(()=>{})
    return fail(error)
  } finally { db?.release() }
}
