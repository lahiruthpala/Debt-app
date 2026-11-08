import { randomInt, randomUUID } from "node:crypto"
import type { PoolClient } from "pg"
import { z } from "zod"
import { getPool } from "@/lib/db"
import { getAuth } from "@/lib/auth"
import { applyCredit, QUESTS } from "@/lib/ledger"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

type Role = "dom" | "sub"
type Profile = { id: string; handle: string; role: Role; bio: string; discoverable: boolean; adult_confirmed: boolean }
type Actor = { id: string; profile: Profile | null }

const respond = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } })
const uuid = z.string().uuid()

function invalid(message: string): never { throw new ApiError(400, message) }

function originGuard(req: Request) {
  const origin = req.headers.get("origin")
  const secFetchSite = req.headers.get("sec-fetch-site")
  if (origin) {
    try {
      const url = new URL(req.url)
      const requestOrigin = new URL(origin).origin
      // Next.js may expose its internal hostname in req.url behind a proxy.
      // The Host header retains the requested public hostname.
      const host = req.headers.get("host")
      const allowed = [url.origin, ...(host ? [url.protocol + "//" + host] : [])]
      if (allowed.includes(requestOrigin)) return
    } catch {}
  } else if (secFetchSite === "same-origin") {
    return
  }
  throw new ApiError(403, "Request origin rejected")
}

async function actorFor(req: Request): Promise<Actor> {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) {
    throw new ApiError(503, "Database and authentication are not configured. See README.")
  }
  const session = await getAuth().api.getSession({ headers: req.headers })
  if (!session) throw new ApiError(401, "Please sign in")
  const { rows } = await getPool().query<Profile>(
    "SELECT id,handle,role,bio,discoverable,adult_confirmed FROM profiles WHERE id=$1",
    [session.user.id]
  )
  return { id: session.user.id, profile: rows[0] ?? null }
}
function requireProfile(actor: Actor): Profile {
  if (!actor.profile?.adult_confirmed) throw new ApiError(403, "Complete your 18+ profile first")
  return actor.profile
}
function errorResponse(error: unknown): Response {
  if (error instanceof ApiError) return respond({ error: error.message }, error.status)
  const pg = error as { code?: string }
  if (pg?.code === "23505") return respond({ error: "Handle already taken or request already exists" }, 409)
  console.error("Studio API:", error instanceof Error ? error.message : "Unknown error")
  return respond({ error: "An unexpected server error occurred." }, 500)
}
const profileSchema = z.object({
  handle: z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers or underscores"),
  role: z.enum(["dom", "sub"]), bio: z.string().max(280),
  discoverable: z.boolean(), adult: z.literal(true)
})
const proposalSchema = z.object({
  connectionId: uuid, principal: z.number().int().min(0).max(1000000),
  monthlyRate: z.number().int().min(0).max(30),
  weeklyTarget: z.number().int().min(0).max(100000),
  lateFee: z.number().int().min(0).max(10000)
})
function parse<T>(schema: z.ZodType<T>, payload: unknown): T {
  const result = schema.safeParse(payload)
  if (!result.success) return invalid(result.error.issues[0]?.message ?? "Invalid request")
  return result.data
}

async function getMyScene(db: PoolClient, id: string, actorId: string) {
  const { rows } = await db.query(
    `SELECT s.*,c.state AS connection_state,c.sender_id,c.recipient_id
     FROM scenes s JOIN connections c ON c.id=s.connection_id
     WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2)
     FOR UPDATE OF s`,
    [id, actorId]
  )
  if (!rows.length) throw new ApiError(404, "Scene not found")
  return rows[0] as {
    id: string; connection_id: string; status: string; connection_state: string;
    sender_id: string; recipient_id: string; principal: number; interest: number;
    penalties: number; monthly_rate: number; weekly_target: number; late_fee: number;
    last_interest_at: Date | null; last_fee_at: Date | null; last_roll_at: Date | null;
  }
}
async function event(db: PoolClient, sceneId: string, actorId: string, type: string, amount: number, detail: string) {
  await db.query(
    "INSERT INTO ledger_events (id,scene_id,actor_id,type,amount,detail) VALUES ($1,$2,$3,$4,$5,$6)",
    [randomUUID(), sceneId, actorId, type, amount, detail]
  )
}

export async function GET(req: Request) {
  try {
    const actor = await actorFor(req)
    const view = new URL(req.url).searchParams.get("view") || "me"
    if (view === "me") {
      return respond({ id: actor.id, profile: actor.profile })
    }
    const profile = requireProfile(actor)
    if (view === "discover") {
      const q = (new URL(req.url).searchParams.get("q") || "").trim().slice(0, 50)
      const { rows } = await getPool().query(
        `SELECT id,handle,role,bio FROM profiles p WHERE p.id<>$1 AND p.role<>$2
          AND p.discoverable=true AND (p.handle ILIKE $3 OR p.bio ILIKE $3)
          AND NOT EXISTS (SELECT 1 FROM connections c
            WHERE c.pair_key=$4 || ':' || p.id AND c.state IN ('pending','active','blocked'))
          AND NOT EXISTS (SELECT 1 FROM connections c
            WHERE c.pair_key=p.id || ':' || $4 AND c.state IN ('pending','active','blocked'))
          ORDER BY p.updated_at DESC LIMIT 24`,
        [actor.id, profile.role, "%" + q + "%", actor.id]
      )
      return respond({ profiles: rows })
    }
    if (view === "connections") {
      const { rows } = await getPool().query(
        `SELECT c.id,c.sender_id,c.recipient_id,c.state,c.created_at,
         p.handle AS other_handle,p.role AS other_role,p.bio AS other_bio
         FROM connections c JOIN profiles p ON p.id=CASE WHEN c.sender_id=$1 THEN c.recipient_id ELSE c.sender_id END
         WHERE (c.sender_id=$1 OR c.recipient_id=$1) AND c.state IN ('pending','active')
         ORDER BY c.updated_at DESC LIMIT 60`, [actor.id]
      )
      return respond({ connections: rows })
    }
    if (view === "scenes") {
      const { rows } = await getPool().query(
        `SELECT s.*,c.state AS connection_state,p.handle AS other_handle,p.role AS other_role
         FROM scenes s JOIN connections c ON c.id=s.connection_id
         JOIN profiles p ON p.id=CASE WHEN c.sender_id=$1 THEN c.recipient_id ELSE c.sender_id END
         WHERE c.sender_id=$1 OR c.recipient_id=$1 ORDER BY s.updated_at DESC LIMIT 50`, [actor.id]
      )
      return respond({ scenes: rows })
    }
    if (view === "scene") {
      const id = parse(uuid, new URL(req.url).searchParams.get("id"))
      const { rows } = await getPool().query(
        `SELECT s.*,c.state AS connection_state,p.handle AS other_handle,p.role AS other_role
         FROM scenes s JOIN connections c ON c.id=s.connection_id
         JOIN profiles p ON p.id=CASE WHEN c.sender_id=$2 THEN c.recipient_id ELSE c.sender_id END
         WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2)`, [id, actor.id]
      )
      if (!rows.length) throw new ApiError(404, "Scene not found")
      const [events, challenges] = await Promise.all([
        getPool().query(
          `SELECT e.id,e.type,e.amount,e.detail,e.created_at,p.handle AS actor
           FROM ledger_events e JOIN profiles p ON p.id=e.actor_id
           WHERE e.scene_id=$1 ORDER BY e.created_at DESC LIMIT 60`, [id]
        ),
        getPool().query(
          "SELECT id,title,reward,state,created_at,completed_at FROM challenges WHERE scene_id=$1 ORDER BY created_at DESC LIMIT 50", [id]
        )
      ])
      return respond({ scene: rows[0], events: events.rows, challenges: challenges.rows })
    }
    throw new ApiError(400, "Unknown view")
  } catch (error) { return errorResponse(error) }
}

export async function POST(req: Request) {
  try {
    originGuard(req)
    const actor = await actorFor(req)
    const body = await req.json().catch(() => invalid("Invalid JSON"))
    if (typeof body !== "object" || body === null) invalid("Invalid request")
    const action: string = body.action
    if (action === "profile") {
      const input = parse(profileSchema, body)
      if (actor.profile && actor.profile.role !== input.role) throw new ApiError(409, "Roles cannot be changed after profile creation")
      const { rows } = await getPool().query(
        `INSERT INTO profiles (id,handle,role,bio,discoverable,adult_confirmed)
          VALUES ($1,$2,$3,$4,$5,true) ON CONFLICT (id) DO UPDATE
          SET handle=EXCLUDED.handle,bio=EXCLUDED.bio,discoverable=EXCLUDED.discoverable,updated_at=now()
          RETURNING id,handle,role,bio,discoverable`,
        [actor.id, input.handle, input.role, input.bio, input.discoverable]
      )
      return respond({ profile: rows[0] })
    }
    const profile = requireProfile(actor)
    if (action === "invite") {
      const targetId = parse(z.string().min(1).max(128), body.targetId)
      const target = await getPool().query<{ id: string; role: Role }>(
        "SELECT id,role FROM profiles WHERE id=$1 AND id<>$2 AND discoverable=true AND adult_confirmed=true",
        [targetId, actor.id]
      )
      if (!target.rows.length || target.rows[0].role === profile.role) throw new ApiError(404, "Matching roleplay profile not available")
      const pair = [actor.id, targetId].sort().join(":")
      const { rows } = await getPool().query(
        `INSERT INTO connections(id,pair_key,sender_id,recipient_id,state)
          VALUES ($1,$2,$3,$4,'pending')
          ON CONFLICT(pair_key) DO UPDATE SET
            sender_id=EXCLUDED.sender_id,recipient_id=EXCLUDED.recipient_id,
            state='pending',blocked_by=NULL,updated_at=now()
          WHERE connections.state IN ('declined','ended')
          RETURNING id`, [randomUUID(), pair, actor.id, targetId]
      )
      if (!rows.length) throw new ApiError(409, "A request or connection already exists, or this account is blocked")
      return respond({ message: "Invitation sent. They must accept before play begins." }, 201)
    }
    if (action === "connection") {
      const { id, decision } = parse(z.object({
        id: uuid, decision: z.enum(["accept","decline","end","block"])
      }), body)
      const db = await getPool().connect()
      try {
        await db.query("BEGIN")
        let result
        if (decision === "accept" || decision === "decline") {
          result = await db.query(
            "UPDATE connections SET state=$1,updated_at=now() WHERE id=$2 AND recipient_id=$3 AND state='pending' RETURNING id",
            [decision === "accept" ? "active" : "declined", id, actor.id]
          )
        } else {
          result = await db.query(
            `UPDATE connections SET state=$1,blocked_by=$2,updated_at=now()
             WHERE id=$3 AND (sender_id=$4 OR recipient_id=$4) AND state IN ('active','pending')
             RETURNING id`,
            [decision === "block" ? "blocked" : "ended", decision === "block" ? actor.id : null, id, actor.id]
          )
          if (result.rowCount) {
            await db.query("UPDATE scenes SET status='ended',updated_at=now() WHERE connection_id=$1 AND status<>'ended'", [id])
          }
        }
        if (!result.rowCount) throw new ApiError(409, "This request is no longer actionable")
        await db.query("COMMIT")
        return respond({ message: "Connection " + decision + "ed." })
      } catch (error) { await db.query("ROLLBACK"); throw error } finally { db.release() }
    }
    if (action === "propose") {
      if (profile.role !== "dom") throw new ApiError(403, "Only Dom accounts can propose scene terms")
      const input = parse(proposalSchema, body)
      const id = randomUUID()
      const { rows } = await getPool().query(
        `INSERT INTO scenes (id,connection_id,status,start_principal,principal,monthly_rate,weekly_target,late_fee)
          SELECT $1,c.id,'proposed',$3,$3,$4,$5,$6 FROM connections c
          JOIN profiles other ON other.id=CASE WHEN c.sender_id=$2 THEN c.recipient_id ELSE c.sender_id END
          WHERE c.id=$7 AND c.state='active' AND (c.sender_id=$2 OR c.recipient_id=$2)
            AND other.role='sub'
            AND NOT EXISTS (SELECT 1 FROM scenes s WHERE s.connection_id=c.id AND s.status<>'ended')
          RETURNING id`,
        [id, actor.id, input.principal, input.monthlyRate, input.weeklyTarget, input.lateFee, input.connectionId]
      )
      if (!rows.length) throw new ApiError(409, "Active connection required; finish any existing scene first")
      return respond({ id, message: "Terms proposed. The sub must approve." }, 201)
    }
    if (action === "scene" || action === "quest" || action === "complete") {
      const sceneId = parse(uuid, body.sceneId)
      const db = await getPool().connect()
      try {
        await db.query("BEGIN")
        const scene = await getMyScene(db, sceneId, actor.id)
        const sub = profile.role === "sub"
        const dom = profile.role === "dom"
        let message = ""
        if (action === "scene") {
          const operation = parse(z.enum(["approve","pause","resume","end","payment","late_fee","interest","roll"]), body.operation)
          if (operation === "end") {
            if (scene.status === "ended") throw new ApiError(409, "Already ended")
            await db.query("UPDATE scenes SET status='ended',updated_at=now() WHERE id=$1", [sceneId])
            message = "Scene ended. No further debt actions are permitted."
          } else if (operation === "approve") {
            if (!sub || scene.status !== "proposed" || scene.connection_state !== "active") throw new ApiError(403, "Only the sub can accept proposed terms")
            await db.query("UPDATE scenes SET status='active',approved_at=now(),last_interest_at=now(),updated_at=now() WHERE id=$1", [sceneId])
            message = "Scene activated by mutual consent."
          } else if (operation === "pause") {
            if (scene.status !== "active") throw new ApiError(409, "Scene is not active")
            await db.query("UPDATE scenes SET status='paused',updated_at=now() WHERE id=$1", [sceneId])
            message = "Scene paused. All game actions are disabled."
          } else if (operation === "resume") {
            if (!sub || scene.status !== "paused" || scene.connection_state !== "active") throw new ApiError(403, "The sub must approve resuming")
            await db.query("UPDATE scenes SET status='active',updated_at=now() WHERE id=$1", [sceneId])
            message = "Scene resumed."
          } else {
            if (scene.status !== "active" || scene.connection_state !== "active") throw new ApiError(409, "Scene must be active")
            if (operation === "payment") {
              if (!sub) throw new ApiError(403, "Only the sub can submit a simulated payment")
              throw new ApiError(409, "Simulated payments require photo proof and Dom approval. Submit evidence from Overview.")
            } else if (operation === "late_fee") {
              if (!dom) throw new ApiError(403, "Only the Dom can apply a scheduled fictional late fee")
              if (scene.last_fee_at && Date.now() - new Date(scene.last_fee_at).getTime() < 7*86400000) throw new ApiError(429, "Late fee can be used at most once every seven days")
              if (scene.penalties + scene.late_fee > 2000000) throw new ApiError(409, "Penalty cap reached")
              await db.query("UPDATE scenes SET penalties=penalties+late_fee,last_fee_at=now(),updated_at=now() WHERE id=$1", [sceneId])
              await event(db, sceneId, actor.id, "late_fee", scene.late_fee, "Agreed imaginary late fee")
              message = "Agreed late fee applied."
            } else if (operation === "interest") {
              if (!dom) throw new ApiError(403, "Only the Dom can apply monthly fictional interest")
              if (!scene.last_interest_at || Date.now() - new Date(scene.last_interest_at).getTime() < 30*86400000) throw new ApiError(429, "Monthly interest is not due yet")
              const charge = Math.round((scene.principal + scene.interest) * scene.monthly_rate / 100)
              if (scene.interest + charge > 2000000) throw new ApiError(409, "Interest cap reached")
              await db.query("UPDATE scenes SET interest=interest+$1,last_interest_at=now(),updated_at=now() WHERE id=$2", [charge,sceneId])
              await event(db,sceneId,actor.id,"interest",charge,"Scheduled imaginary monthly interest")
              message = "Monthly fictional interest applied."
            } else if (operation === "roll") {
              if (!sub) throw new ApiError(403, "Only the sub can play Debt Dice")
              if (scene.last_roll_at && Date.now() - new Date(scene.last_roll_at).getTime() < 24*3600000) throw new ApiError(429, "Debt Dice resets every 24 hours")
              const dice = randomInt(1,7)
              const outcomes = [-5000,-2500,-1000,0,1000,2000]
              let change = outcomes[dice-1]
              let newBalance = { principal: scene.principal, interest: scene.interest, penalties: scene.penalties }
              if (change < 0) {
                const credited = applyCredit(newBalance, -change)
                change = -credited.credited
                newBalance = credited
              } else if (change > 0) {
                if (newBalance.penalties + change > 2000000) throw new ApiError(409, "Penalty cap reached")
                newBalance.penalties += change
              }
              await db.query("UPDATE scenes SET principal=$1,interest=$2,penalties=$3,last_roll_at=now(),updated_at=now() WHERE id=$4",
                [newBalance.principal,newBalance.interest,newBalance.penalties,sceneId])
              await event(db,sceneId,actor.id,"dice",change,"Debt Dice rolled " + dice + " of 6")
              message = "Rolled " + dice + " · " + (change <= 0 ? "credit " : "added ") + Math.abs(change).toLocaleString() + " fantasy units"
            }
          }
        } else if (action === "quest") {
          if (!dom || scene.status !== "active" || scene.connection_state !== "active") throw new ApiError(403, "Only Dom accounts can issue challenges in active scenes")
          const index = parse(z.number().int().min(0).max(QUESTS.length-1), body.index)
          const count = await db.query("SELECT count(*)::integer AS n FROM challenges WHERE scene_id=$1 AND state='open'", [sceneId])
          if (count.rows[0].n >= 5) throw new ApiError(409, "Complete existing challenges before issuing more")
          const quest = QUESTS[index]
          await db.query("INSERT INTO challenges (id,scene_id,title,reward) VALUES ($1,$2,$3,$4)",
            [randomUUID(),sceneId,quest.title,quest.reward])
          await event(db,sceneId,actor.id,"challenge",0,"Issued challenge: " + quest.title)
          message = "Challenge posted."
        } else {
          if (!sub || scene.status !== "active" || scene.connection_state !== "active") throw new ApiError(403, "Only the sub can complete a challenge")
          const challengeId = parse(uuid, body.challengeId)
          const result = await db.query(
            "SELECT * FROM challenges WHERE id=$1 AND scene_id=$2 FOR UPDATE", [challengeId,sceneId]
          )
          const challenge = result.rows[0]
          if (!challenge || challenge.state !== "open") throw new ApiError(409, "Challenge is unavailable")
          const attached = await db.query(
            "SELECT id FROM proof_submissions WHERE challenge_id=$1 AND deleted_at IS NULL LIMIT 1",
            [challengeId]
          )
          if (attached.rowCount) throw new ApiError(409, "Review the attached image in Proof Center before settling this challenge")

          const next = applyCredit(scene, challenge.reward)
          await db.query("UPDATE scenes SET principal=$1,interest=$2,penalties=$3,updated_at=now() WHERE id=$4",
            [next.principal,next.interest,next.penalties,sceneId])
          await db.query("UPDATE challenges SET state='completed',completed_at=now() WHERE id=$1", [challengeId])
          await event(db,sceneId,actor.id,"challenge_reward",-next.credited,"Completed: " + challenge.title)
          message = "Challenge completed. " + next.credited.toLocaleString() + " credits earned."
        }
        await db.query("COMMIT")
        return respond({ message })
      } catch (error) { await db.query("ROLLBACK"); throw error } finally { db.release() }
    }
    throw new ApiError(400, "Unknown action")
  } catch (error) { return errorResponse(error) }
}
