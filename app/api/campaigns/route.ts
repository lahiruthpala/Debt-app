import {randomInt,randomUUID} from "node:crypto"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {campaignDefinition,campaignActivitySchema,contributionInput,postInput,membershipPreferences,
  openForActions,canJoinCampaign,contributionAllowed,progressPercent} from "@/lib/campaigns"

export const runtime="nodejs"
export const dynamic="force-dynamic"
type Role="dom"|"sub"
type User={id:string;role:Role;handle:string}
type CampaignRow={id:string;creator_id:string;status:string;kind:string;visibility:string;join_policy:string;
 starts_at:string|null;ends_at:string|null;goal:string|number;min_contribution:number;max_contribution:number;
 max_per_member:string|number;member_limit:number;require_contribution_proof:boolean;allow_anonymous:boolean;
 leaderboard_enabled:boolean;allow_comments:boolean;terms_version:number}
class CampaignError extends Error{constructor(public statusCode:number,message:string){super(message)}}
const uuid=z.string().uuid(),str=(n:number)=>z.string().trim().min(1).max(n)
const res=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}})
function parse<T>(schema:z.ZodType<T>,value:unknown):T {
  const parsed=schema.safeParse(value)
  if(!parsed.success)throw new CampaignError(400,parsed.error.issues[0]?.message||"Invalid campaign input")
  return parsed.data
}
function origin(req:Request){
  const from=req.headers.get("origin"),url=new URL(req.url),host=req.headers.get("host")
  if(from){try{if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(from).origin))return}catch{}}
  else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new CampaignError(403,"Request origin rejected")
}
async function user(req:Request):Promise<User>{
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)throw new CampaignError(503,"Campaign service not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new CampaignError(401,"Sign in first")
  const {rows}=await getPool().query<User&{adult_confirmed:boolean}>(
    "SELECT id,role,handle,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new CampaignError(403,"Complete your adult profile first")
  return rows[0]
}
function failure(e:unknown){
  if(e instanceof CampaignError)return res({error:e.message},e.statusCode)
  const code=(e as {code?:string})?.code
  if(code==="23505")return res({error:"This action has already been recorded"},409)
  if(code==="23503")return res({error:"Referenced item not found"},404)
  console.error("Campaign API:",e instanceof Error?e.message:"Unknown error")
  return res({error:"Unable to process campaign request"},500)
}
async function campaign(db:PoolClient,id:string,actor:User,lock=false):Promise<CampaignRow>{
  const {rows}=await db.query<CampaignRow>("SELECT * FROM campaigns WHERE id=$1 "+(lock?"FOR UPDATE":""),[id])
  if(!rows[0])throw new CampaignError(404,"Campaign not found")
  const c=rows[0]
  if(c.creator_id===actor.id)return c
  if(c.status==="draft")throw new CampaignError(404,"Campaign not found")
  const member=await db.query<{status:string}>("SELECT status FROM campaign_memberships WHERE campaign_id=$1 AND member_id=$2",[id,actor.id])
  if(c.visibility==="restricted"&&!["invited","pending","active"].includes(member.rows[0]?.status||""))throw new CampaignError(404,"Campaign not available")
  const blocked=await db.query("SELECT 1 FROM connections WHERE state='blocked' AND "+
    "((sender_id=$1 AND recipient_id=$2) OR (sender_id=$2 AND recipient_id=$1)) LIMIT 1",[c.creator_id,actor.id])
  if(blocked.rowCount)throw new CampaignError(404,"Campaign not available")
  if(member.rows[0]?.status==="removed")throw new CampaignError(403,"You cannot access this campaign")
  return c
}
function ensureCreator(c:CampaignRow,u:User){if(c.creator_id!==u.id||u.role!=="dom")throw new CampaignError(403,"Only the campaign creator can do this")}
function ensureOpen(c:CampaignRow){if(!openForActions(c.status,c.starts_at,c.ends_at))throw new CampaignError(409,"Campaign is not open for new actions")}
async function membership(db:PoolClient,id:string,userId:string,lock=false){
  const {rows}=await db.query("SELECT * FROM campaign_memberships WHERE campaign_id=$1 AND member_id=$2 "+
    (lock?"FOR UPDATE":""),[id,userId])
  return rows[0] as {id:string;status:string;personal_cap:string|number;anonymous:boolean;leaderboard_opt_in:boolean;accepted_version:number}|undefined
}
async function activeMember(db:PoolClient,c:CampaignRow,u:User){
  if(u.role!=="sub")throw new CampaignError(403,"Only Sub profiles can participate")
  const m=await membership(db,c.id,u.id,true)
  if(!m||m.status!=="active")throw new CampaignError(403,"Join the campaign before participating")
  if(m.accepted_version!==c.terms_version)throw new CampaignError(409,"Accept the updated campaign terms first")
  return m
}
async function log(db:PoolClient,id:string,u:string,kind:string,subject:string|null=null){
  await db.query("INSERT INTO campaign_events(id,campaign_id,actor_id,event_type,subject_id) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(),id,u,kind,subject])
}
async function notice(db:PoolClient,id:string,userId:string,kind:string,title:string){
  await db.query("INSERT INTO campaign_notifications(id,campaign_id,recipient_id,kind,title) VALUES($1,$2,$3,$4,$5)",
    [randomUUID(),id,userId,kind,title.slice(0,140)])
}
async function creatorsNotice(db:PoolClient,c:CampaignRow,u:User,kind:string,title:string){
  if(c.creator_id!==u.id)await notice(db,c.id,c.creator_id,kind,title)
}
async function campaignTotals(db:PoolClient,id:string){
  const {rows}=await db.query<{total:string;contributors:number;members:number}>(
    "SELECT (SELECT COALESCE(sum(amount),0)::text FROM campaign_contributions WHERE campaign_id=$1 AND status='approved') AS total,"+
    "(SELECT count(DISTINCT member_id)::int FROM campaign_contributions WHERE campaign_id=$1 AND status='approved') AS contributors,"+
    "(SELECT count(*)::int FROM campaign_memberships WHERE campaign_id=$1 AND status='active') AS members",[id])
  return {total:Number(rows[0].total),contributors:rows[0].contributors,members:rows[0].members}
}
async function milestoneNotify(db:PoolClient,c:CampaignRow,oldTotal:number,newTotal:number,levels:{title:string;threshold:number}[]){
  for(const m of levels){
    if(oldTotal<m.threshold&&newTotal>=m.threshold){
      await db.query("INSERT INTO campaign_notifications(id,campaign_id,recipient_id,kind,title) "+
        "SELECT gen_random_uuid(),$1,member_id,'milestone',$2 FROM campaign_memberships "+
        "WHERE campaign_id=$1 AND status='active' LIMIT 10000",[c.id,"Milestone reached: "+m.title])
    }
  }
}
export async function GET(req:Request){
  try{
    const u=await user(req),url=new URL(req.url),view=url.searchParams.get("view")||"discover"
    const db=await getPool().connect()
    try{
      if(view==="discover"){
        const q=(url.searchParams.get("q")||"").trim().slice(0,80)
        const kind=url.searchParams.get("kind")||"all"
        if(kind!=="all"&&!["tribute","goal","challenge","competition","event"].includes(kind))
          throw new CampaignError(400,"Invalid campaign type")
        const tag=(url.searchParams.get("tag")||"").trim().slice(0,80)
        const {rows}=await db.query(
          "SELECT c.id,c.title,c.description,c.kind,c.category,c.tags,c.goal,c.ends_at,c.published_at,"+
          "c.join_policy,c.visibility,(c.cover_blob_path IS NOT NULL) AS has_cover,p.handle AS creator_handle, "+
          "(SELECT COALESCE(sum(amount),0)::bigint FROM campaign_contributions x WHERE x.campaign_id=c.id AND x.status='approved') AS total,"+
          "(SELECT count(*)::int FROM campaign_memberships m WHERE m.campaign_id=c.id AND m.status='active') AS members "+
          "FROM campaigns c JOIN profiles p ON p.id=c.creator_id WHERE c.status='published' AND c.visibility='public' "+
          "AND (c.ends_at IS NULL OR c.ends_at>now()) AND (c.title ILIKE $1 OR c.description ILIKE $1 OR p.handle ILIKE $1) "+
          "AND ($2::text='all' OR c.kind=$2::text) AND ($3::text='' OR c.tags ? $3::text) "+
          "AND NOT EXISTS (SELECT 1 FROM connections b WHERE b.state='blocked' AND "+
          "((b.sender_id=c.creator_id AND b.recipient_id=$4) OR (b.recipient_id=c.creator_id AND b.sender_id=$4))) "+
          "ORDER BY c.published_at DESC LIMIT 40",["%"+q+"%",kind,tag,u.id])
        return res({campaigns:rows.map(r=>({...r,total:Number(r.total),goal:Number(r.goal)}))})
      }
      if(view==="mine"){
        const {rows}=await db.query(
          "SELECT c.id,c.title,c.kind,c.status,c.visibility,c.goal,c.ends_at,c.creator_id,p.handle AS creator_handle,(c.cover_blob_path IS NOT NULL) AS has_cover,"+
          "m.status AS membership_status,m.anonymous,m.leaderboard_opt_in,"+
          "CASE WHEN f.follower_id IS NULL THEN false ELSE true END AS following "+
          "FROM campaigns c JOIN profiles p ON p.id=c.creator_id "+
          "LEFT JOIN campaign_memberships m ON m.campaign_id=c.id AND m.member_id=$1 "+
          "LEFT JOIN campaign_follows f ON f.campaign_id=c.id AND f.follower_id=$1 "+
          "WHERE c.creator_id=$1 OR m.member_id=$1 OR f.follower_id=$1 OR "+
          "(c.status='published' AND c.visibility='public' AND EXISTS(SELECT 1 FROM campaign_creator_follows cf "+
          "WHERE cf.creator_id=c.creator_id AND cf.follower_id=$1)) ORDER BY c.updated_at DESC LIMIT 100",[u.id])
        return res({campaigns:rows.map(r=>({...r,goal:Number(r.goal)}))})
      }
      if(view==="notifications"){
        const {rows}=await db.query("SELECT id,campaign_id,kind,title,created_at,read_at FROM campaign_notifications "+
          "WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 50",[u.id])
        return res({notifications:rows})
      }
      if(view!=="detail")throw new CampaignError(400,"Unknown campaign view")
      const id=parse(uuid,url.searchParams.get("id"))
      const c=await campaign(db,id,u)
      const isCreator=c.creator_id===u.id
      const m=await membership(db,id,u.id)
      const [details,totals,activities,posts,leaderboard,contributions,claims,pollVotes,following,creatorFollowing]=await Promise.all([
        db.query("SELECT c.*,p.handle AS creator_handle FROM campaigns c JOIN profiles p ON p.id=c.creator_id WHERE c.id=$1",[id]),
        campaignTotals(db,id),
        db.query("SELECT id,kind,config,state,created_at FROM campaign_activities WHERE campaign_id=$1 ORDER BY created_at ASC LIMIT 30",[id]),
        db.query("SELECT t.id,t.kind,t.parent_id,t.content,t.created_at,t.author_id,"+
          "CASE WHEN t.author_id=c.creator_id THEN p.handle WHEN m.anonymous=true THEN 'Anonymous participant' ELSE p.handle END AS display_handle,"+
          "(SELECT count(*)::int FROM campaign_reactions r WHERE r.post_id=t.id) AS reactions,"+
          "EXISTS(SELECT 1 FROM campaign_reactions r WHERE r.post_id=t.id AND r.member_id=$2) AS reacted "+
          "FROM campaign_posts t JOIN campaigns c ON c.id=t.campaign_id JOIN profiles p ON p.id=t.author_id "+
          "LEFT JOIN campaign_memberships m ON m.campaign_id=t.campaign_id AND m.member_id=t.author_id "+
          "WHERE t.campaign_id=$1 AND t.deleted_at IS NULL ORDER BY t.created_at DESC LIMIT 80",[id,u.id]),
        db.query("SELECT p.handle,m.member_id,coalesce(sum(x.amount),0)::bigint AS total,"+
          "coalesce((SELECT sum(pt.points) FROM campaign_point_events pt WHERE pt.campaign_id=$1 AND pt.member_id=m.member_id),0)::bigint AS points "+
          "FROM campaign_memberships m JOIN profiles p ON p.id=m.member_id "+
          "LEFT JOIN campaign_contributions x ON x.member_id=m.member_id AND x.campaign_id=m.campaign_id AND x.status='approved' "+
          "WHERE m.campaign_id=$1 AND m.status='active' AND m.leaderboard_opt_in=true AND m.anonymous=false "+
          "GROUP BY p.handle,m.member_id ORDER BY points DESC,total DESC LIMIT 30",[id]),
        db.query("SELECT x.id,x.member_id,x.amount,x.note,x.status,x.created_at,x.review_note,x.reviewed_at,"+
          "p.handle AS member_handle,m.anonymous, "+
          "(SELECT count(*)::int FROM campaign_evidence e WHERE e.contribution_id=x.id AND e.deleted_at IS NULL) AS evidence_count "+
          "FROM campaign_contributions x JOIN profiles p ON p.id=x.member_id "+
          "JOIN campaign_memberships m ON m.campaign_id=x.campaign_id AND m.member_id=x.member_id "+
          "WHERE x.campaign_id=$1 AND ($2::boolean OR x.member_id=$3) ORDER BY x.created_at DESC LIMIT 100",[id,isCreator,u.id]),
        db.query("SELECT t.id,t.activity_id,t.member_id,t.note,t.status,t.points,t.review_note,t.created_at,"+
          "p.handle AS member_handle, "+
          "(SELECT count(*)::int FROM campaign_evidence e WHERE e.claim_id=t.id AND e.deleted_at IS NULL) AS evidence_count "+
          "FROM campaign_task_claims t JOIN profiles p ON p.id=t.member_id WHERE t.campaign_id=$1 "+
          "AND ($2::boolean OR t.member_id=$3) ORDER BY t.created_at DESC LIMIT 100",[id,isCreator,u.id]),
        db.query("SELECT activity_id,choice_index,count(*)::int AS votes FROM campaign_votes WHERE campaign_id=$1 "+
          "GROUP BY activity_id,choice_index",[id]),
        db.query("SELECT 1 FROM campaign_follows WHERE campaign_id=$1 AND follower_id=$2",[id,u.id]),
        db.query("SELECT 1 FROM campaign_creator_follows WHERE creator_id=$1 AND follower_id=$2",[c.creator_id,u.id])
      ])
      const row=details.rows[0]
      const visiblePosts=posts.rows.map(p=>({id:p.id,kind:p.kind,parent_id:p.parent_id,content:p.content,
        created_at:p.created_at,display_handle:p.display_handle,reactions:p.reactions,reacted:p.reacted,
        is_mine:p.author_id===u.id}))
      const safeContributions=contributions.rows.map(x=>({id:x.id,amount:x.amount,status:x.status,created_at:x.created_at,
        note:isCreator||x.member_id===u.id?x.note:"",
        review_note:isCreator||x.member_id===u.id?x.review_note:"",
        member_handle:isCreator?x.member_handle:(x.member_id===u.id?"You":null),
        evidence_count:x.evidence_count}))
      const safeClaims=claims.rows.map(x=>({id:x.id,activity_id:x.activity_id,status:x.status,
        points:x.points,note:x.note,created_at:x.created_at,review_note:x.review_note,
        member_handle:isCreator?x.member_handle:"You",evidence_count:x.evidence_count}))
      let members:unknown[]=[]
      if(isCreator){
        const {rows}=await db.query("SELECT m.id,m.member_id,m.status,m.anonymous,m.leaderboard_opt_in,m.personal_cap,"+
          "m.accepted_version,m.created_at,p.handle FROM campaign_memberships m JOIN profiles p ON p.id=m.member_id "+
          "WHERE m.campaign_id=$1 ORDER BY m.created_at DESC LIMIT 200",[id])
        members=rows
      }
      const {cover_blob_path,...publicRow}=row
      return res({campaign:{...publicRow,has_cover:Boolean(cover_blob_path),goal:Number(row.goal),max_per_member:Number(row.max_per_member)},
        totals:{...totals,progress:progressPercent(totals.total,Number(c.goal))},
        isCreator,membership:m?{status:m.status,anonymous:m.anonymous,leaderboard_opt_in:m.leaderboard_opt_in,
          personal_cap:Number(m.personal_cap),accepted_version:m.accepted_version}:null,
        following:Boolean(following.rowCount),creatorFollowing:Boolean(creatorFollowing.rowCount),activities:activities.rows,posts:visiblePosts,
        leaderboard:c.leaderboard_enabled?leaderboard.rows.map(x=>({handle:x.handle,points:Number(x.points),total:Number(x.total)})):[],
        contributions:safeContributions,claims:safeClaims,memberQueue:members,votes:pollVotes.rows})
    }finally{db.release()}
  }catch(e){return failure(e)}
}
export async function POST(req:Request){
  let db:PoolClient|null=null,tx=false
  try{
    origin(req)
    const u=await user(req)
    const body=await req.json().catch(()=>{throw new CampaignError(400,"Invalid JSON")})
    const action=parse(str(40),body?.action)
    db=await getPool().connect()
    await db.query("BEGIN");tx=true
    let result:unknown={message:"Action completed"}
    let status=200
    if(action==="create"){
      if(u.role!=="dom")throw new CampaignError(403,"Only Dom profiles can create campaigns")
      const d=parse(campaignDefinition,body.definition)
      const count=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaigns WHERE creator_id=$1 AND status!='closed'",[u.id])
      if(count.rows[0].n>=30)throw new CampaignError(429,"Limit of 30 open or draft campaigns reached")
      const id=randomUUID()
      await db.query("INSERT INTO campaigns(id,creator_id,title,description,rules,kind,category,visibility,join_policy,tags,"+
        "milestones,starts_at,ends_at,goal,min_contribution,max_contribution,max_per_member,member_limit,"+
        "require_contribution_proof,allow_anonymous,leaderboard_enabled,allow_comments) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)",
        [id,u.id,d.title,d.description,d.rules,d.kind,d.category,d.visibility,d.joinPolicy,JSON.stringify(d.tags),
          JSON.stringify(d.milestones),d.startAt,d.endAt,d.goal,d.minContribution,d.maxContribution,d.maxPerMember,
          d.memberLimit,d.requireContributionProof,d.allowAnonymous,d.leaderboardEnabled,d.allowComments])
      for(const a of d.activities)await db.query("INSERT INTO campaign_activities(id,campaign_id,kind,config) VALUES($1,$2,$3,$4::jsonb)",
        [randomUUID(),id,a.type,JSON.stringify(a)])
      await log(db,id,u.id,"campaign.created")
      result={id,message:"Campaign draft created"};status=201
    } else {
      const id=parse(uuid,body.campaignId)
      const c=await campaign(db,id,u,true)
      if(action==="publish"||action==="pause"||action==="resume"||action==="close"){
        ensureCreator(c,u)
        const allowed:Record<string,string[]>={publish:["draft"],pause:["published"],resume:["paused"],close:["published","paused"]}
        if(!allowed[action]?.includes(c.status))throw new CampaignError(409,"Campaign cannot make this transition")
        if(action==="publish"&&c.ends_at&&Date.parse(String(c.ends_at))<=Date.now())
          throw new CampaignError(409,"Campaign end time has passed")
        const next=action==="publish"||action==="resume"?"published":action==="pause"?"paused":"closed"
        await db.query("UPDATE campaigns SET status=$1,updated_at=now(),published_at=CASE WHEN $1::text='published' "+
          "THEN coalesce(published_at,now()) ELSE published_at END,closed_at=CASE WHEN $1::text='closed' THEN now() ELSE closed_at END "+
          "WHERE id=$2",[next,id])
        await log(db,id,u.id,"campaign."+action)
        if(action==="publish"&&c.visibility==="public"){
          await db.query("INSERT INTO campaign_notifications(id,campaign_id,recipient_id,kind,title) "+
            "SELECT gen_random_uuid(),$1,follower_id,'creator',$2 FROM campaign_creator_follows "+
            "WHERE creator_id=$3 LIMIT 10000",[id,"New campaign from @"+u.handle,u.id])
        }
        result={message:"Campaign "+next}
      }else if(action==="edit"){
        ensureCreator(c,u)
        if(c.status!=="draft")throw new CampaignError(409,"Published rules are immutable; create a new campaign for changed terms")
        const d=parse(campaignDefinition,body.definition)
        await db.query("UPDATE campaigns SET title=$1,description=$2,rules=$3,kind=$4,category=$5,visibility=$6,join_policy=$7,"+
          "tags=$8::jsonb,milestones=$9::jsonb,starts_at=$10,ends_at=$11,goal=$12,min_contribution=$13,max_contribution=$14,"+
          "max_per_member=$15,member_limit=$16,require_contribution_proof=$17,allow_anonymous=$18,leaderboard_enabled=$19,"+
          "allow_comments=$20,updated_at=now() WHERE id=$21",
          [d.title,d.description,d.rules,d.kind,d.category,d.visibility,d.joinPolicy,JSON.stringify(d.tags),
           JSON.stringify(d.milestones),d.startAt,d.endAt,d.goal,d.minContribution,d.maxContribution,d.maxPerMember,
           d.memberLimit,d.requireContributionProof,d.allowAnonymous,d.leaderboardEnabled,d.allowComments,id])
        await db.query("DELETE FROM campaign_activities WHERE campaign_id=$1",[id])
        for(const a of d.activities)await db.query("INSERT INTO campaign_activities(id,campaign_id,kind,config) VALUES($1,$2,$3,$4::jsonb)",
          [randomUUID(),id,a.type,JSON.stringify(a)])
        await log(db,id,u.id,"campaign.edited")
        result={message:"Draft saved"}
      }else if(action==="join"||action==="accept_invite"){
        if(u.role!=="sub")throw new CampaignError(403,"Only Sub profiles can join")
        if(c.status!=="published"||(c.ends_at&&new Date(c.ends_at).getTime()<=Date.now()))
          throw new CampaignError(409,"Campaign is not accepting participants")
        const m=await membership(db,id,u.id,true)
        if(m?.status==="removed")throw new CampaignError(403,"Participation was revoked by the creator")
        if(action==="accept_invite"&&m?.status!=="invited")throw new CampaignError(409,"No invitation exists")
        if(action==="join"&&!canJoinCampaign(c.status,c.join_policy,c.starts_at,c.ends_at))
          throw new CampaignError(403,"Campaign requires an invitation")
        if(m?.status==="active"||m?.status==="pending")throw new CampaignError(409,"Already participating or awaiting approval")
        if(c.join_policy==="invite"&&m?.status!=="invited")throw new CampaignError(403,"Invitation required")
        const prefs=parse(membershipPreferences,body.preferences)
        if(prefs.anonymous&&!c.allow_anonymous)throw new CampaignError(400,"Anonymous participation is disabled")
        if(prefs.anonymous&&prefs.showOnLeaderboard)throw new CampaignError(400,"Anonymous users cannot appear on the leaderboard")
        const count=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_memberships "+
          "WHERE campaign_id=$1 AND status='active'",[id])
        if(count.rows[0].n>=c.member_limit)throw new CampaignError(409,"Campaign is full")
        const next=c.join_policy==="approval"&&action!=="accept_invite"?"pending":"active"
        await db.query("INSERT INTO campaign_memberships(id,campaign_id,member_id,status,accepted_version,anonymous,"+
          "leaderboard_opt_in,personal_cap,joined_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $4::text='active' THEN now() END) "+
          "ON CONFLICT(campaign_id,member_id) DO UPDATE SET status=EXCLUDED.status,accepted_version=EXCLUDED.accepted_version,"+
          "anonymous=EXCLUDED.anonymous,leaderboard_opt_in=EXCLUDED.leaderboard_opt_in,personal_cap=EXCLUDED.personal_cap,"+
          "joined_at=EXCLUDED.joined_at,left_at=NULL,updated_at=now()",
          [randomUUID(),id,u.id,next,c.terms_version,prefs.anonymous,prefs.showOnLeaderboard,prefs.personalCap])
        await log(db,id,u.id,"membership."+next)
        await creatorsNotice(db,c,u,"join",next==="pending"?"A participant requested to join":"A participant joined")
        result={message:next==="pending"?"Request sent for approval":"You joined the campaign",status:next}
      }else if(action==="invite"){
        ensureCreator(c,u)
        if(!["published","paused"].includes(c.status)||c.join_policy!=="invite")
          throw new CampaignError(409,"Only published invitation campaigns support invitations")
        const handle=parse(str(24),body.handle)
        const target=await db.query<{id:string}>("SELECT id FROM profiles WHERE lower(handle)=lower($1) AND role='sub' "+
          "AND adult_confirmed=true AND discoverable=true",[handle])
        if(!target.rows[0])throw new CampaignError(404,"Discoverable Sub not found")
        const targetId=target.rows[0].id
        const blocked=await db.query("SELECT 1 FROM connections WHERE state='blocked' AND "+
          "((sender_id=$1 AND recipient_id=$2) OR (recipient_id=$1 AND sender_id=$2)) LIMIT 1",[u.id,targetId])
        if(blocked.rowCount)throw new CampaignError(403,"Invitation unavailable")
        const existing=await membership(db,id,targetId,true)
        if(existing&&existing.status!=="left")throw new CampaignError(409,"Participant already has an invitation or status")
        await db.query("INSERT INTO campaign_memberships(id,campaign_id,member_id,status,accepted_version) "+
          "VALUES($1,$2,$3,'invited',$4) ON CONFLICT(campaign_id,member_id) DO UPDATE "+
          "SET status='invited',accepted_version=EXCLUDED.accepted_version,updated_at=now()",
          [randomUUID(),id,targetId,c.terms_version])
        await notice(db,id,targetId,"invite","You've been invited to a campaign")
        await log(db,id,u.id,"membership.invited")
        result={message:"Invitation sent"}
      }else if(action==="approve_member"||action==="remove_member"){
        ensureCreator(c,u)
        const targetId=parse(str(200),body.memberId)
        const member=await membership(db,id,targetId,true)
        if(!member)throw new CampaignError(404,"Participant not found")
        if(action==="approve_member"){
          if(member.status!=="pending")throw new CampaignError(409,"No pending request")
          const n=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_memberships WHERE campaign_id=$1 AND status='active'",[id])
          if(n.rows[0].n>=c.member_limit)throw new CampaignError(409,"Campaign is full")
        }else if(member.status==="removed")throw new CampaignError(409,"Already removed")
        const next=action==="approve_member"?"active":"removed"
        await db.query("UPDATE campaign_memberships SET status=$1,joined_at=CASE WHEN $1::text='active' THEN now() ELSE joined_at END,"+
          "left_at=CASE WHEN $1::text='removed' THEN now() ELSE left_at END,updated_at=now() WHERE campaign_id=$2 AND member_id=$3",
          [next,id,targetId])
        await notice(db,id,targetId,"membership",next==="active"?"Your campaign request was approved":"Campaign access was removed")
        await log(db,id,u.id,"membership."+next)
        result={message:"Participant "+next}
      }else if(action==="leave"||action==="decline_invite"){
        if(u.role!=="sub")throw new CampaignError(403,"Sub profile required")
        const m=await membership(db,id,u.id,true)
        if(!m||!["active","pending","invited"].includes(m.status))
          throw new CampaignError(409,"No active participation to exit")
        await db.query("UPDATE campaign_memberships SET status='left',left_at=now(),updated_at=now() "+
          "WHERE campaign_id=$1 AND member_id=$2",[id,u.id])
        await log(db,id,u.id,"membership.left")
        result={message:"You left the campaign. No penalty was applied."}
      }else if(action==="preferences"){
        const m=await activeMember(db,c,u)
        const prefs=parse(membershipPreferences,body.preferences)
        if(prefs.anonymous&&!c.allow_anonymous)throw new CampaignError(400,"Anonymous participation is disabled")
        if(prefs.anonymous&&prefs.showOnLeaderboard)throw new CampaignError(400,"Anonymous leaderboard display is not supported")
        const total=await db.query<{sum:string}>("SELECT coalesce(sum(amount),0)::text AS sum FROM campaign_contributions "+
          "WHERE campaign_id=$1 AND member_id=$2 AND status!='rejected'",[id,u.id])
        if(prefs.personalCap<Number(total.rows[0].sum))
          throw new CampaignError(409,"Your cap cannot be below existing and pending contributions")
        await db.query("UPDATE campaign_memberships SET anonymous=$1,leaderboard_opt_in=$2,personal_cap=$3,"+
          "updated_at=now() WHERE campaign_id=$4 AND member_id=$5",
          [prefs.anonymous,prefs.showOnLeaderboard,prefs.personalCap,id,u.id])
        await log(db,id,u.id,"membership.preferences")
        result={message:"Participation privacy and limits updated"}
      }else if(action==="follow"){
        if(c.creator_id===u.id)throw new CampaignError(409,"You already own this campaign")
        if(c.status==="draft"||c.visibility==="restricted")throw new CampaignError(403,"This campaign cannot be followed")
        if(body.follow===true)await db.query("INSERT INTO campaign_follows(campaign_id,follower_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,u.id])
        else await db.query("DELETE FROM campaign_follows WHERE campaign_id=$1 AND follower_id=$2",[id,u.id])
        result={message:body.follow===true?"Following campaign":"Unfollowed campaign"}
      }else if(action==="follow_creator"){
        if(c.creator_id===u.id)throw new CampaignError(409,"Cannot follow yourself")
        if(c.status==="draft"||c.visibility!=="public")throw new CampaignError(403,"Follow creators from public campaigns")
        if(body.follow===true)await db.query("INSERT INTO campaign_creator_follows(creator_id,follower_id) "+
          "VALUES($1,$2) ON CONFLICT DO NOTHING",[c.creator_id,u.id])
        else await db.query("DELETE FROM campaign_creator_follows WHERE creator_id=$1 AND follower_id=$2",[c.creator_id,u.id])
        result={message:body.follow===true?"Following creator":"Unfollowed creator"}
      }else if(action==="contribute"){
        ensureOpen(c)
        const m=await activeMember(db,c,u)
        const input=parse(contributionInput,body)
        if(input.campaignId!==id)throw new CampaignError(400,"Campaign mismatch")
        const prior=await db.query("SELECT id,status FROM campaign_contributions WHERE member_id=$1 AND request_id=$2",[u.id,input.requestId])
        if(prior.rows[0]){result={id:prior.rows[0].id,status:prior.rows[0].status,message:"Contribution already recorded"}}
        else{
          const daily=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_contributions "+
            "WHERE member_id=$1 AND created_at>now()-interval '24 hours'",[u.id])
          if(daily.rows[0].n>=20)throw new CampaignError(429,"Daily contribution limit reached")
          const priorTotal=await db.query<{amount:string}>("SELECT coalesce(sum(amount),0)::text AS amount FROM campaign_contributions "+
            "WHERE campaign_id=$1 AND member_id=$2 AND status!='rejected'",[id,u.id])
          if(!contributionAllowed(input.amount,c.min_contribution,c.max_contribution,Number(priorTotal.rows[0].amount),
            Number(c.max_per_member),Number(m.personal_cap)))throw new CampaignError(409,"Contribution is outside your agreed limits")
          const before=await campaignTotals(db,id)
          const state=c.require_contribution_proof?"pending":"approved",contributionId=randomUUID()
          await db.query("INSERT INTO campaign_contributions(id,request_id,campaign_id,member_id,amount,note,status) "+
            "VALUES($1,$2,$3,$4,$5,$6,$7)",[contributionId,input.requestId,id,u.id,input.amount,input.note,state])
          await log(db,id,u.id,"contribution."+state,contributionId)
          await creatorsNotice(db,c,u,"contribution",state==="pending"?"A fictional contribution awaits review":"New fictional contribution")
          if(state==="approved"){
            const levels=await db.query<{milestones:{title:string;threshold:number}[]}>("SELECT milestones FROM campaigns WHERE id=$1",[id])
            await milestoneNotify(db,c,before.total,before.total+input.amount,levels.rows[0].milestones)
          }
          result={id:contributionId,status:state,message:state==="pending"?"Contribution pending private proof and review":"Fictional contribution recorded"}
          status=201
        }
      }else if(action==="review_contribution"){
        ensureCreator(c,u)
        const xId=parse(uuid,body.contributionId),approve=parse(z.boolean(),body.approve)
        const note=parse(z.string().trim().max(500),body.note||"")
        if(!approve&&note.length<5)throw new CampaignError(400,"Rejection requires a reason")
        const q=await db.query("SELECT * FROM campaign_contributions WHERE id=$1 AND campaign_id=$2 FOR UPDATE",[xId,id])
        if(!q.rows[0]||q.rows[0].status!=="pending")throw new CampaignError(409,"Contribution no longer pending")
        const x=q.rows[0]
        if(approve&&c.require_contribution_proof){
          const proof=await db.query("SELECT 1 FROM campaign_evidence WHERE contribution_id=$1 AND deleted_at IS NULL LIMIT 1",[xId])
          if(!proof.rowCount)throw new CampaignError(409,"Private proof is required before approval")
        }
        if(approve){
          const total=await db.query<{amount:string;cap:string}>("SELECT coalesce(sum(x.amount),0)::text AS amount,m.personal_cap::text AS cap "+
            "FROM campaign_memberships m LEFT JOIN campaign_contributions x ON x.campaign_id=m.campaign_id "+
            "AND x.member_id=m.member_id AND x.status='approved' WHERE m.campaign_id=$1 AND m.member_id=$2 "+
            "GROUP BY m.personal_cap",[id,x.member_id])
          if(Number(total.rows[0]?.amount||0)+x.amount>Math.min(Number(c.max_per_member),Number(total.rows[0]?.cap||0)))
            throw new CampaignError(409,"Approval would exceed participant cap")
        }
        const before=await campaignTotals(db,id)
        await db.query("UPDATE campaign_contributions SET status=$1,review_note=$2,reviewed_at=now(),reviewed_by=$3 WHERE id=$4",
          [approve?"approved":"rejected",note,u.id,xId])
        if(approve){
          const milestones=await db.query<{milestones:{title:string;threshold:number}[]}>("SELECT milestones FROM campaigns WHERE id=$1",[id])
          await milestoneNotify(db,c,before.total,before.total+x.amount,milestones.rows[0].milestones)
        }
        await notice(db,id,x.member_id,"review",approve?"Your fictional contribution was approved":"Your contribution was declined")
        await log(db,id,u.id,"contribution."+(approve?"approved":"rejected"),xId)
        result={message:approve?"Contribution approved":"Contribution rejected"}
      }else if(action==="submit_task"){
        ensureOpen(c)
        await activeMember(db,c,u)
        const activityId=parse(uuid,body.activityId),note=parse(str(1000),body.note)
        const a=await db.query("SELECT * FROM campaign_activities WHERE id=$1 AND campaign_id=$2 AND kind='task' AND state='active'",
          [activityId,id])
        if(!a.rows[0])throw new CampaignError(404,"Task not found")
        const config=parse(campaignActivitySchema,a.rows[0].config)
        if(config.type!=="task")throw new CampaignError(409,"Not a task")
        const n=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_task_claims "+
          "WHERE activity_id=$1 AND member_id=$2 AND status IN ('pending','approved')",[activityId,u.id])
        if(n.rows[0].n>=config.maxCompletionsPerMember)throw new CampaignError(409,"Task completion limit reached")
        const claimId=randomUUID()
        await db.query("INSERT INTO campaign_task_claims(id,activity_id,campaign_id,member_id,note,points) "+
          "VALUES($1,$2,$3,$4,$5,$6)",[claimId,activityId,id,u.id,note,config.points])
        await creatorsNotice(db,c,u,"task","A campaign task awaits review")
        await log(db,id,u.id,"task.submitted",claimId)
        result={id:claimId,message:"Task submitted for review"};status=201
      }else if(action==="review_task"){
        ensureCreator(c,u)
        const claimId=parse(uuid,body.claimId),approve=parse(z.boolean(),body.approve)
        const note=parse(z.string().trim().max(500),body.note||"")
        if(!approve&&note.length<5)throw new CampaignError(400,"Rejection needs a reason")
        const q=await db.query("SELECT t.*,a.config FROM campaign_task_claims t JOIN campaign_activities a ON a.id=t.activity_id "+
          "WHERE t.id=$1 AND t.campaign_id=$2 FOR UPDATE OF t",[claimId,id])
        if(!q.rows[0]||q.rows[0].status!=="pending")throw new CampaignError(409,"Task is no longer pending")
        const x=q.rows[0],config=parse(campaignActivitySchema,x.config)
        if(config.type!=="task")throw new CampaignError(409,"Not a task")
        if(approve&&config.proofRequired){
          const proof=await db.query("SELECT 1 FROM campaign_evidence WHERE claim_id=$1 AND deleted_at IS NULL LIMIT 1",[claimId])
          if(!proof.rowCount)throw new CampaignError(409,"Task evidence required")
        }
        await db.query("UPDATE campaign_task_claims SET status=$1,reviewer_id=$2,review_note=$3,reviewed_at=now() WHERE id=$4",
          [approve?"approved":"rejected",u.id,note,claimId])
        if(approve)await db.query("INSERT INTO campaign_point_events(id,campaign_id,member_id,points,source_type,source_id) "+
          "VALUES($1,$2,$3,$4,'task',$5) ON CONFLICT(source_type,source_id) DO NOTHING",
          [randomUUID(),id,x.member_id,x.points,claimId])
        await notice(db,id,x.member_id,"task",approve?"Your task was approved":"Your task was returned")
        await log(db,id,u.id,"task."+(approve?"approved":"rejected"),claimId)
        result={message:approve?"Task approved; campaign points awarded":"Task returned"}
      }else if(action==="play_game"){
        ensureOpen(c)
        await activeMember(db,c,u)
        const activityId=parse(uuid,body.activityId)
        const q=await db.query("SELECT config FROM campaign_activities WHERE id=$1 AND campaign_id=$2 AND kind='game' AND state='active'",
          [activityId,id])
        if(!q.rows[0])throw new CampaignError(404,"Game not found")
        const config=parse(campaignActivitySchema,q.rows[0].config)
        if(config.type!=="game")throw new CampaignError(409,"Not a game")
        const last=await db.query<{created_at:Date}>("SELECT created_at FROM campaign_game_plays "+
          "WHERE activity_id=$1 AND member_id=$2 ORDER BY created_at DESC LIMIT 1",[activityId,u.id])
        if(last.rows[0]&&Date.now()-new Date(last.rows[0].created_at).getTime()<config.cooldownHours*3600000)
          throw new CampaignError(409,"Game cooldown is still active")
        const roll=config.game==="dice"?randomInt(1,7):config.game==="coin"?randomInt(0,2):randomInt(0,(config.wheelLabels?.length||6))
        const win=config.game==="dice"?roll>=4:roll%2===0
        const points=win?config.pointsWin:config.pointsLose,playId=randomUUID()
        const outcome={game:config.game,roll,win,label:config.game==="wheel"?(config.wheelLabels?.[roll]||"Slot "+(roll+1)):null}
        await db.query("INSERT INTO campaign_game_plays(id,campaign_id,activity_id,member_id,outcome,points) "+
          "VALUES($1,$2,$3,$4,$5::jsonb,$6)",[playId,id,activityId,u.id,JSON.stringify(outcome),points])
        if(points>0)await db.query("INSERT INTO campaign_point_events(id,campaign_id,member_id,points,source_type,source_id) "+
          "VALUES($1,$2,$3,$4,'game',$5) ON CONFLICT DO NOTHING",[randomUUID(),id,u.id,points,playId])
        await log(db,id,u.id,"game.played",playId)
        result={outcome,points,message:win?"Game won":"Game completed"}
      }else if(action==="vote"){
        ensureOpen(c)
        await activeMember(db,c,u)
        const activityId=parse(uuid,body.activityId),choice=parse(z.number().int().min(0).max(7),body.choice)
        const a=await db.query("SELECT config FROM campaign_activities WHERE id=$1 AND campaign_id=$2 AND kind='poll' AND state='active'",
          [activityId,id])
        if(!a.rows[0])throw new CampaignError(404,"Poll not found")
        const config=parse(campaignActivitySchema,a.rows[0].config)
        if(config.type!=="poll"||choice>=config.choices.length)throw new CampaignError(400,"Invalid poll choice")
        await db.query("INSERT INTO campaign_votes(activity_id,campaign_id,member_id,choice_index) VALUES($1,$2,$3,$4)",
          [activityId,id,u.id,choice])
        await log(db,id,u.id,"poll.voted",activityId)
        result={message:"Vote recorded"}
      }else if(action==="post"){
        ensureOpen(c)
        const data=parse(postInput,body)
        if(data.campaignId!==id)throw new CampaignError(400,"Campaign mismatch")
        const creator=c.creator_id===u.id
        if(!creator){
          await activeMember(db,c,u)
          if(!c.allow_comments)throw new CampaignError(403,"Comments disabled")
        }
        if(data.parentId){
          const parent=await db.query("SELECT 1 FROM campaign_posts WHERE id=$1 AND campaign_id=$2 AND deleted_at IS NULL",[data.parentId,id])
          if(!parent.rowCount)throw new CampaignError(404,"Original post not found")
        }
        const daily=await db.query<{n:number}>("SELECT count(*)::int AS n FROM campaign_posts "+
          "WHERE author_id=$1 AND created_at>now()-interval '24 hours'",[u.id])
        if(daily.rows[0].n>=30)throw new CampaignError(429,"Posting limit reached")
        const postId=randomUUID(),kind=creator&&!data.parentId?"update":"comment"
        await db.query("INSERT INTO campaign_posts(id,campaign_id,author_id,kind,parent_id,content) "+
          "VALUES($1,$2,$3,$4,$5,$6)",[postId,id,u.id,kind,data.parentId||null,data.content])
        await log(db,id,u.id,"post.created",postId)
        if(kind==="update"){
          await db.query("INSERT INTO campaign_notifications(id,campaign_id,recipient_id,kind,title) "+
            "SELECT gen_random_uuid(),$1,member_id,'update',$2 FROM campaign_memberships "+
            "WHERE campaign_id=$1 AND status='active' AND member_id<>$3 LIMIT 10000",[id,"Campaign update: "+data.content.slice(0,75),u.id])
          await db.query("INSERT INTO campaign_notifications(id,campaign_id,recipient_id,kind,title) "+
            "SELECT gen_random_uuid(),$1,follower_id,'update',$2 FROM campaign_follows WHERE campaign_id=$1 "+
            "AND NOT EXISTS(SELECT 1 FROM campaign_memberships m WHERE m.campaign_id=$1 AND m.member_id=follower_id AND m.status='active') "+
            "LIMIT 10000",[id,"Campaign update: "+data.content.slice(0,75)])
        }
        result={id:postId,message:kind==="update"?"Campaign update posted":"Comment posted"};status=201
      }else if(action==="delete_post"){
        const postId=parse(uuid,body.postId)
        const q=await db.query("SELECT author_id FROM campaign_posts WHERE id=$1 AND campaign_id=$2 AND deleted_at IS NULL",[postId,id])
        if(!q.rows[0])throw new CampaignError(404,"Post not found")
        if(q.rows[0].author_id!==u.id&&c.creator_id!==u.id)throw new CampaignError(403,"Cannot moderate this post")
        await db.query("UPDATE campaign_posts SET deleted_at=now(),content='[removed]' WHERE id=$1",[postId])
        result={message:"Post removed"}
      }else if(action==="react"){
        const postId=parse(uuid,body.postId),emoji=parse(z.enum(["heart","clap","star"]),body.emoji)
        if(c.creator_id!==u.id)await activeMember(db,c,u)
        const post=await db.query("SELECT 1 FROM campaign_posts WHERE id=$1 AND campaign_id=$2 AND deleted_at IS NULL",[postId,id])
        if(!post.rowCount)throw new CampaignError(404,"Post unavailable")
        if(body.enabled===true)await db.query("INSERT INTO campaign_reactions(post_id,member_id,emoji) VALUES($1,$2,$3) "+
          "ON CONFLICT(post_id,member_id) DO UPDATE SET emoji=EXCLUDED.emoji",[postId,u.id,emoji])
        else await db.query("DELETE FROM campaign_reactions WHERE post_id=$1 AND member_id=$2",[postId,u.id])
        result={message:"Reaction updated"}
      }else if(action==="report"){
        const reason=parse(z.string().trim().min(10).max(500),body.reason)
        if(c.creator_id===u.id)throw new CampaignError(400,"Cannot report your own campaign")
        await db.query("INSERT INTO campaign_reports(campaign_id,reporter_id,reason) VALUES($1,$2,$3)",[id,u.id,reason])
        result={message:"Report submitted privately"}
      }else if(action==="mark_read"){
        const noticeId=parse(uuid,body.notificationId)
        await db.query("UPDATE campaign_notifications SET read_at=now() WHERE id=$1 AND campaign_id=$2 AND recipient_id=$3",
          [noticeId,id,u.id])
        result={message:"Notification marked as read"}
      }else throw new CampaignError(400,"Unsupported campaign action")
    }
    await db.query("COMMIT");tx=false
    return res(result,status)
  }catch(e){
    if(db&&tx)await db.query("ROLLBACK").catch(()=>{})
    return failure(e)
  }finally{db?.release()}
}
