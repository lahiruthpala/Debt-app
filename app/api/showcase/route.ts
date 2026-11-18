import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {showcaseSchema,earnedBadges,badgesForRole,normalizeFeaturedBadges,activityLabel,normalizeInterests,type ShowcaseStats,type ShowcaseBadge,type BadgeRole} from "@/lib/showcase"
import {showcaseStatsSql} from "@/lib/showcase-stats"
import {randomUUID} from "node:crypto"
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
  const {rows}=await getPool().query<ShowcaseStats>(showcaseStatsSql,[id])
  return rows[0]
}
// Persist first unlocks; the notification is added once when the member next
// opens their showcase, without exposing private activities to other members.
async function syncBadgeUnlocks(id:string,earned:ShowcaseBadge[]):Promise<Record<string,string>> {
  if(earned.length){
    const {rows}=await getPool().query<{badge_id:string}>(
      "INSERT INTO profile_badge_unlocks(user_id,badge_id) "+
      "SELECT $1, b.id FROM unnest($2::text[]) AS b(id) "+
      "ON CONFLICT(user_id,badge_id) DO NOTHING RETURNING badge_id",
      [id,earned.map(b=>b.id)])
    for(const row of rows){
      const badge=earned.find(b=>b.id===row.badge_id)
      if(!badge)continue
      await getPool().query(
        "INSERT INTO activity_notifications(id,user_id,event_key,kind,title,detail) "+
        "VALUES($1,$2,$3,'achievement',$4,$5) ON CONFLICT(user_id,event_key) DO NOTHING",
        [randomUUID(),id,"badge:"+badge.id,"Achievement unlocked: "+badge.title,badge.description])
    }
  }
  const {rows}=await getPool().query<{badge_id:string;unlocked_at:string}>(
    "SELECT badge_id,unlocked_at FROM profile_badge_unlocks WHERE user_id=$1",[id])
  return Object.fromEntries(rows.map(row=>[row.badge_id,new Date(row.unlocked_at).toISOString()]))
}
const defaults={
  display_name:"",tagline:"",likes:[],dislikes:[],dedication:"",boundaries:"",
  showcase_enabled:false,show_stats:false,show_achievements:false,show_activity:false,featured_badges:[]
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
      "s.showcase_enabled,s.show_stats,s.show_achievements,s.show_activity,s.featured_badges "+
      "FROM profiles p LEFT JOIN profile_showcases s ON s.user_id=p.id "+
      (own?"WHERE p.id=$1":"WHERE lower(p.handle)=lower($1)"),
      [own?actor.id:parsedHandle!.data])
    if(!rows.length)return respond({error:"Profile not found"},404)
    const p=rows[0],isOwn=p.id===actor.id
    if(!p.adult_confirmed)return respond({error:"Profile not found"},404)
    if(!isOwn){
      // Discoverable members may show their public handle, role and bio even when
      // the optional showcase is unpublished; never expose its private fields.
      if(!p.discoverable)return respond({error:"Profile not shared"},404)
      const blocked=await getPool().query(
        "SELECT 1 FROM connections WHERE state='blocked' AND "+
        "((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) LIMIT 1",
        [actor.id,p.id])
      if(blocked.rowCount)return respond({error:"Profile not available"},404)
    }
    const settings={...defaults,...p}
    const showcaseVisible=isOwn||Boolean(p.showcase_enabled)
    const result:{profile:unknown;stats?:ShowcaseStats;badges?:ShowcaseBadge[];catalog?:ShowcaseBadge[];featuredBadges?:string[];activity?:unknown}={
      profile:{
        handle:p.handle,role:p.role,bio:p.bio,
        displayName:showcaseVisible?(settings.display_name??""):"",
        tagline:showcaseVisible?(settings.tagline??""):"",
        likes:showcaseVisible?normalizeInterests(settings.likes):[],
        dislikes:showcaseVisible?normalizeInterests(settings.dislikes):[],
        dedication:showcaseVisible?(settings.dedication??""):"",
        boundaries:showcaseVisible?(settings.boundaries??""):"",
        discoverable:p.discoverable,
        showcaseEnabled:Boolean(settings.showcase_enabled),
        showStats:showcaseVisible&&Boolean(settings.show_stats),
        showAchievements:showcaseVisible&&Boolean(settings.show_achievements),
        showActivity:showcaseVisible&&Boolean(settings.show_activity),
        updatedAt:p.updated_at
      }
    }
    if(isOwn||(showcaseVisible&&(settings.show_stats||settings.show_achievements))){
      const stats=await statsFor(p.id)
      const role=p.role as BadgeRole
      const earned=earnedBadges(stats,role)
      const unlocked=isOwn?await syncBadgeUnlocks(p.id,earned):{}
      if(isOwn||settings.show_stats)result.stats=stats
      if(isOwn){
        result.catalog=badgesForRole(stats,role).map(b=>({...b,unlockedAt:unlocked[b.id]}))
      }
      if(isOwn||settings.show_achievements){
        result.badges=earned.map(b=>({...b,unlockedAt:unlocked[b.id]}))
        result.featuredBadges=normalizeFeaturedBadges(settings.featured_badges,earned)
      }
    }
    if(isOwn||(showcaseVisible&&settings.show_activity)){
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
    if(v.featuredBadges.length){
      const [{rows:roles},stats]=await Promise.all([
        getPool().query<{role:BadgeRole}>("SELECT role FROM profiles WHERE id=$1",[actor.id]),statsFor(actor.id)
      ])
      const earned=earnedBadges(stats,roles[0]?.role||"sub")
      if(normalizeFeaturedBadges(v.featuredBadges,earned).length!==v.featuredBadges.length){
        return respond({error:"Only badges earned in your current role may be featured"},400)
      }
    }
    const {rows}=await getPool().query(
      "INSERT INTO profile_showcases(user_id,display_name,tagline,likes,dislikes,dedication,boundaries,"+
      "showcase_enabled,show_stats,show_achievements,show_activity,featured_badges) "+
      "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) "+
      "ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,tagline=EXCLUDED.tagline,"+
      "likes=EXCLUDED.likes,dislikes=EXCLUDED.dislikes,dedication=EXCLUDED.dedication,"+
      "boundaries=EXCLUDED.boundaries,featured_badges=EXCLUDED.featured_badges,showcase_enabled=EXCLUDED.showcase_enabled,"+
      "show_stats=EXCLUDED.show_stats,show_achievements=EXCLUDED.show_achievements,"+
      "show_activity=EXCLUDED.show_activity,updated_at=now() RETURNING user_id",
      [actor.id,v.displayName,v.tagline,JSON.stringify(v.likes),JSON.stringify(v.dislikes),
        v.dedication,v.boundaries,v.showcaseEnabled,v.showStats,v.showAchievements,v.showActivity,JSON.stringify(v.featuredBadges)])
    if(!rows.length)return respond({error:"Could not save profile"},500)
    return respond({message:"Showcase preferences saved"})
  }catch(error){
    console.error("Showcase write:",error instanceof Error?error.message:"Unknown error")
    return respond({error:"Unable to save showcase"},500)
  }
}
