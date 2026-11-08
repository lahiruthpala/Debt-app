import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {showcaseSchema,earnedBadges,activityLabel,type ShowcaseStats} from "@/lib/showcase"
import {z} from "zod"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const noStore={"Cache-Control":"private, no-store, max-age=0"}
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:noStore})
const handleSchema=z.string().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/)
async function identity(req:Request){
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)return null
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)return null
  const {rows}=await getPool().query<{id:string;adult_confirmed:boolean}>(
    "SELECT id,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  return rows[0]?.adult_confirmed?rows[0]:null
}
function checkOrigin(req:Request){
  const origin=req.headers.get("origin")
  if(!origin)return req.headers.get("sec-fetch-site")==="same-origin"
  try{
    const u=new URL(req.url),host=req.headers.get("host")
    return [u.origin,...(host?[u.protocol+"//"+host]:[])].includes(new URL(origin).origin)
  }catch{return false}
}
async function statsFor(id:string):Promise<ShowcaseStats>{
  const sql=[
    "SELECT",
    "(SELECT count(*)::int FROM scenes s JOIN connections c ON c.id=s.connection_id",
    "WHERE (c.sender_id=$1 OR c.recipient_id=$1) AND s.approved_at IS NOT NULL) AS \"acceptedAgreements\",",
    "(SELECT count(*)::int FROM contract_action_log a WHERE a.actor_id=$1",
    "AND a.action IN ('dice','wheel','random','checkin')) AS \"gameActions\",",
    "(SELECT count(*)::int FROM contract_task_claims q WHERE q.requested_by=$1 AND q.state='approved') AS \"tasksApproved\",",
    "(SELECT count(*)::int FROM proof_submissions p WHERE p.submitter_id=$1 AND p.status='approved') AS \"proofsApproved\",",
    "(SELECT count(*)::int FROM proof_submissions p WHERE p.reviewer_id=$1 AND p.status='approved') AS \"proofsReviewed\",",
    "(SELECT count(*)::int FROM debt_contract_templates t WHERE t.author_id=$1 AND t.published=true) AS \"publishedTemplates\""
  ].join(" ")
  const {rows}=await getPool().query<ShowcaseStats>(sql,[id])
  return rows[0]
}
const defaults={
  display_name:"",tagline:"",likes:[],dislikes:[],dedication:"",boundaries:"",
  showcase_enabled:false,show_stats:false,show_achievements:false,show_activity:false
}
export async function GET(req:Request){
  try{
    const actor=await identity(req)
    if(!actor)return respond({error:"Sign in with an adult profile to view member showcases"},401)
    const params=new URL(req.url).searchParams
    const own=params.get("me")==="1"
    const parsedHandle=own?null:handleSchema.safeParse(params.get("handle"))
    if(!own&&!parsedHandle?.success)return respond({error:"Invalid handle"},400)
    const {rows}=await getPool().query(
      "SELECT p.id,p.handle,p.role,p.bio,p.discoverable,p.adult_confirmed,p.updated_at,"+
      "s.display_name,s.tagline,s.likes,s.dislikes,s.dedication,s.boundaries,"+
      "s.showcase_enabled,s.show_stats,s.show_achievements,s.show_activity "+
      "FROM profiles p LEFT JOIN profile_showcases s ON s.user_id=p.id "+
      (own?"WHERE p.id=$1":"WHERE lower(p.handle)=lower($1)"),
      [own?actor.id:parsedHandle!.data])
    if(!rows.length)return respond({error:"Profile not found"},404)
    const p=rows[0],isOwn=p.id===actor.id
    if(!p.adult_confirmed)return respond({error:"Profile not found"},404)
    if(!isOwn){
      if(!p.discoverable||!p.showcase_enabled)return respond({error:"Profile not shared"},404)
      const blocked=await getPool().query(
        "SELECT 1 FROM connections WHERE state='blocked' AND "+
        "((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) LIMIT 1",
        [actor.id,p.id])
      if(blocked.rowCount)return respond({error:"Profile not available"},404)
    }
    const settings={...defaults,...p}
    const result:{profile:unknown;stats?:ShowcaseStats;badges?:unknown;activity?:unknown}={
      profile:{
        handle:p.handle,role:p.role,bio:p.bio,displayName:settings.display_name,
        tagline:settings.tagline,likes:settings.likes,dislikes:settings.dislikes,
        dedication:settings.dedication,boundaries:settings.boundaries,
        discoverable:p.discoverable,
        showcaseEnabled:settings.showcase_enabled,showStats:settings.show_stats,
        showAchievements:settings.show_achievements,showActivity:settings.show_activity,
        updatedAt:p.updated_at
      }
    }
    if(isOwn||settings.show_stats||settings.show_achievements){
      const stats=await statsFor(p.id)
      if(isOwn||settings.show_stats)result.stats=stats
      if(isOwn||settings.show_achievements)result.badges=earnedBadges(stats)
    }
    if(isOwn||settings.show_activity){
      const recent=await getPool().query<{action:string;created_at:string}>(
        "SELECT action,created_at FROM contract_action_log WHERE actor_id=$1 "+
        "AND action IN ('dice','wheel','random','checkin','boundary_req','proof_review') "+
        "ORDER BY created_at DESC LIMIT 6",[p.id])
      result.activity=recent.rows.map(row=>({
        label:activityLabel(row.action),
        // Only the date is shared; never partner names, balances, or private text.
        date:new Date(row.created_at).toISOString().slice(0,10)
      }))
    }
    return respond(result)
  }catch(error){
    console.error("Showcase read:",error instanceof Error?error.message:"Unknown error")
    return respond({error:"Unable to load profile showcase"},500)
  }
}
export async function POST(req:Request){
  try{
    if(!checkOrigin(req))return respond({error:"Request origin rejected"},403)
    const actor=await identity(req)
    if(!actor)return respond({error:"Complete your adult profile first"},403)
    const data=await req.json().catch(()=>null)
    const parsed=showcaseSchema.safeParse(data)
    if(!parsed.success)return respond({error:parsed.error.issues[0]?.message||"Invalid profile"},400)
    const v=parsed.data
    const {rows}=await getPool().query(
      "INSERT INTO profile_showcases(user_id,display_name,tagline,likes,dislikes,dedication,boundaries,"+
      "showcase_enabled,show_stats,show_achievements,show_activity) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) "+
      "ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,tagline=EXCLUDED.tagline,"+
      "likes=EXCLUDED.likes,dislikes=EXCLUDED.dislikes,dedication=EXCLUDED.dedication,"+
      "boundaries=EXCLUDED.boundaries,showcase_enabled=EXCLUDED.showcase_enabled,"+
      "show_stats=EXCLUDED.show_stats,show_achievements=EXCLUDED.show_achievements,"+
      "show_activity=EXCLUDED.show_activity,updated_at=now() RETURNING user_id",
      [actor.id,v.displayName,v.tagline,JSON.stringify(v.likes),JSON.stringify(v.dislikes),
        v.dedication,v.boundaries,v.showcaseEnabled,v.showStats,v.showAchievements,v.showActivity])
    if(!rows.length)return respond({error:"Could not save profile"},500)
    return respond({message:"Showcase preferences saved"})
  }catch(error){
    console.error("Showcase write:",error instanceof Error?error.message:"Unknown error")
    return respond({error:"Unable to save showcase"},500)
  }
}
