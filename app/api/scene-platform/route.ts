import {randomUUID} from "node:crypto"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getPool} from "@/lib/db"
import {getAuth} from "@/lib/auth"
import {isPresetInterest} from "@/lib/showcase"
import {narrativeSchema,assignmentInput,safetyInput,initialNarrativeState,narrativeStep,
  permittedChoices,capEventPoints,capabilityManifest} from "@/lib/scene-platform"

export const runtime="nodejs"
export const dynamic="force-dynamic"
class PlatformError extends Error{constructor(public status:number,message:string){super(message)}}
const respond=(data:unknown,status=200)=>Response.json(data,{status,headers:{"Cache-Control":"private, no-store"}})
const uuid=z.string().uuid(),text=(min:number,max:number)=>z.string().trim().min(min).max(max)
function parse<T>(schema:z.ZodType<T>,data:unknown):T{
  const out=schema.safeParse(data)
  if(!out.success)throw new PlatformError(400,out.error.issues[0]?.message||"Invalid input")
  return out.data
}
function guard(req:Request){
  const origin=req.headers.get("origin"),url=new URL(req.url),host=req.headers.get("host")
  if(origin){
    try{if([url.origin,...(host?[url.protocol+"//"+host]:[])].includes(new URL(origin).origin))return}catch{}
  }else if(req.headers.get("sec-fetch-site")==="same-origin")return
  throw new PlatformError(403,"Request origin rejected")
}
type Actor={id:string;role:"dom"|"sub"}
async function identity(req:Request):Promise<Actor>{
  if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
    throw new PlatformError(503,"Scene platform is not configured")
  const session=await getAuth().api.getSession({headers:req.headers})
  if(!session)throw new PlatformError(401,"Sign in required")
  const {rows}=await getPool().query<{id:string;role:"dom"|"sub";adult_confirmed:boolean}>(
    "SELECT id,role,adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
  if(!rows[0]?.adult_confirmed)throw new PlatformError(403,"Complete your 18+ profile first")
  return rows[0]
}
type Scene={id:string;status:string;connection_state:string;sender_id:string;recipient_id:string;other_id:string}
async function sceneFor(db:PoolClient,sceneId:string,actorId:string,lock=false):Promise<Scene>{
  const {rows}=await db.query(
    "SELECT s.id,s.status,c.state AS connection_state,c.sender_id,c.recipient_id,"+
    "CASE WHEN c.sender_id=$2 THEN c.recipient_id ELSE c.sender_id END AS other_id "+
    "FROM scenes s JOIN connections c ON c.id=s.connection_id "+
    "WHERE s.id=$1 AND c.state='active' AND (c.sender_id=$2 OR c.recipient_id=$2) "+
    (lock?"FOR UPDATE OF s":""),
    [sceneId,actorId])
  if(!rows.length)throw new PlatformError(404,"Active connection scene unavailable")
  return rows[0]
}
function active(scene:Scene){
  if(scene.status!=="active")throw new PlatformError(409,"Both participants must have an active, approved scene")
}
function requireRole(actor:Actor,role:"dom"|"sub"){
  if(actor.role!==role)throw new PlatformError(403,"Only the "+role+" role may perform this action")
}
function fail(error:unknown){
  if(error instanceof PlatformError)return respond({error:error.message},error.status)
  const pg=error as {code?:string}
  if(pg?.code==="23505")return respond({error:"This action already exists or is pending"},409)
  if(pg?.code==="23503")return respond({error:"The referenced record is not available"},409)
  console.error("Scene platform:",error instanceof Error?error.message:"Unknown error")
  return respond({error:"Unable to complete scene activity"},500)
}
async function emit(db:PoolClient,sceneId:string,actorId:string,type:string,ref:string,summary:string,
  payload:Record<string,unknown>={}){
  await db.query("INSERT INTO scene_events(scene_id,actor_id,event_type,ref_id,summary,payload) "+
    "VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scene_id,event_type,ref_id) DO NOTHING",
    [sceneId,actorId,type,ref,summary,JSON.stringify(payload)])
}
async function award(db:PoolClient,sceneId:string,userId:string,source:string,sourceId:string,points:number){
  if(points===0)return
  await db.query("INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id) "+
    "VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,source,source_id) DO NOTHING",
    [randomUUID(),sceneId,userId,points,source,sourceId])
}

export async function GET(req:Request){
  try{
    const actor=await identity(req)
    const url=new URL(req.url),view=url.searchParams.get("view")||"capabilities"
    if(view==="capabilities")return respond({capabilities:capabilityManifest})
    if(view==="library"){
      const q=(url.searchParams.get("q")||"").trim().slice(0,80)
      const [library,mine]=await Promise.all([
        getPool().query("SELECT t.id,t.title,t.summary,t.category,t.author_id,p.handle AS author_handle,"+
          "t.published,t.updated_at,(SELECT count(*)::int FROM narrative_sessions ns WHERE ns.template_id=t.id) AS plays "+
          "FROM narrative_templates t JOIN profiles p ON p.id=t.author_id WHERE t.published=true "+
          "AND (t.title ILIKE $1 OR t.summary ILIKE $1 OR t.category ILIKE $1) ORDER BY t.updated_at DESC LIMIT 40",
          ["%"+q+"%"]),
        getPool().query("SELECT id,title,summary,category,definition,published,updated_at FROM narrative_templates "+
          "WHERE author_id=$1 ORDER BY updated_at DESC LIMIT 40",[actor.id])
      ])
      return respond({library:library.rows,mine:mine.rows})
    }
    if(view==="interests"){
      const {rows:own}=await getPool().query(
        "SELECT interest,level,public FROM profile_interest_levels WHERE user_id=$1 ORDER BY interest",[actor.id])
      const sceneId=url.searchParams.get("sceneId")
      if(!sceneId)return respond({own,partner:[]})
      const db=await getPool().connect()
      try{
        const scene=await sceneFor(db,parse(uuid,sceneId),actor.id)
        const {rows:partner}=await db.query(
          "SELECT interest,level FROM profile_interest_levels WHERE user_id=$1 AND public=true ORDER BY interest",
          [scene.other_id])
        return respond({own,partner})
      }finally{db.release()}
    }
    const sceneId=parse(uuid,url.searchParams.get("sceneId"))
    const db=await getPool().connect()
    try{
      const scene=await sceneFor(db,sceneId,actor.id)
      if(view==="stories"){
        const {rows}=await db.query(
          "SELECT ns.id,ns.scene_id,ns.template_id,ns.status,ns.proposed_by,ns.approved_by,"+
          "ns.definition_snapshot,ns.state,ns.last_actor_id,ns.created_at,ns.finished_at,"+
          "(SELECT count(*)::int FROM narrative_turns nt WHERE nt.session_id=ns.id) AS turn_count "+
          "FROM narrative_sessions ns WHERE ns.scene_id=$1 ORDER BY ns.created_at DESC LIMIT 40",[sceneId])
        return respond({sessions:rows.map(row=>{
          const definition=narrativeSchema.safeParse(row.definition_snapshot)
          const state=row.state as {nodeId:string;flags:string[];decisions:number}
          const chapter=definition.success?definition.data.nodes.find(node=>node.id===state.nodeId):null
          return {...row,chapter:chapter?{...chapter,
            choices:definition.success?permittedChoices(definition.data,state):[]}:null}
        })})
      }
      if(view==="tasks"){
        const {rows}=await db.query(
          "SELECT t.*,p.handle AS proposed_by_handle,"+
          "(SELECT row_to_json(q) FROM (SELECT s.step_number,s.note,s.status,s.review_note,s.submitted_at "+
          "FROM assignment_step_submissions s WHERE s.assignment_id=t.id AND s.step_number=t.next_step LIMIT 1) q) AS current_submission "+
          "FROM scene_assignments t JOIN profiles p ON p.id=t.proposed_by "+
          "WHERE t.scene_id=$1 ORDER BY t.created_at DESC LIMIT 60",[sceneId])
        return respond({tasks:rows})
      }
      if(view==="chat"){
        const [messages,events,read]=await Promise.all([
          db.query("SELECT m.id,m.scene_id,m.sender_id,p.handle AS sender_handle,"+
            "CASE WHEN m.deleted_at IS NULL THEN m.body ELSE NULL END AS body,"+
            "m.created_at,m.edited_at,m.deleted_at FROM scene_messages m "+
            "JOIN profiles p ON p.id=m.sender_id WHERE m.scene_id=$1 "+
            "ORDER BY m.created_at DESC,m.id DESC LIMIT 80",[sceneId]),
          db.query("SELECT e.id,e.actor_id,e.event_type,e.summary,e.created_at FROM scene_events e "+
            "WHERE e.scene_id=$1 ORDER BY e.id DESC LIMIT 70",[sceneId]),
          db.query("SELECT last_read_at FROM scene_chat_receipts WHERE scene_id=$1 AND user_id=$2",[sceneId,actor.id]),
        ])
        return respond({messages:messages.rows.reverse(),events:events.rows.reverse(),lastRead:read.rows[0]?.last_read_at||null})
      }
      if(view==="activity"){
        const {rows}=await db.query(
          "SELECT id,event_type,summary,created_at,actor_id FROM scene_events WHERE scene_id=$1 ORDER BY id DESC LIMIT 100",[sceneId])
        return respond({events:rows})
      }
      if(view==="safety"){
        const {rows:own}=await db.query("SELECT limits,share_limits,ai_opt_in,aftercare,last_checkin "+
          "FROM scene_safety_prefs WHERE scene_id=$1 AND user_id=$2",[sceneId,actor.id])
        const {rows:partner}=await db.query("SELECT limits FROM scene_safety_prefs "+
          "WHERE scene_id=$1 AND user_id=$2 AND share_limits=true",[sceneId,scene.other_id])
        const {rows:history}=await db.query(
          "SELECT action,created_at FROM scene_safety_events WHERE scene_id=$1 ORDER BY created_at DESC LIMIT 12",[sceneId])
        return respond({status:scene.status,own:own[0]||{limits:[],share_limits:false,ai_opt_in:false,aftercare:"",last_checkin:null},
          partnerLimits:partner[0]?.limits||[],history})
      }
      if(view==="timers"){
        const {rows}=await db.query("SELECT id,label,user_id,started_at,active_since,accumulated_seconds,status,ended_at "+
          "FROM scene_time_sessions WHERE scene_id=$1 AND user_id=$2 ORDER BY started_at DESC LIMIT 75",
          [sceneId,actor.id])
        return respond({timers:rows})
      }
      if(view==="analytics"){
        const [counts,daily,taskStats]=await Promise.all([
          db.query("SELECT event_type,count(*)::int AS total FROM scene_events WHERE scene_id=$1 "+
            "GROUP BY event_type ORDER BY total DESC LIMIT 30",[sceneId]),
          db.query("SELECT to_char(date_trunc('day',created_at),'YYYY-MM-DD') AS day,count(*)::int AS actions "+
            "FROM scene_events WHERE scene_id=$1 AND created_at>=now()-interval '365 days' "+
            "GROUP BY 1 ORDER BY 1",[sceneId]),
          db.query("SELECT status,count(*)::int AS total FROM scene_assignments WHERE scene_id=$1 GROUP BY status",[sceneId])
        ])
        return respond({counts:counts.rows,daily:daily.rows,tasks:taskStats.rows})
      }
      throw new PlatformError(400,"Unknown view")
    }finally{db.release()}
  }catch(error){return fail(error)}
}

export async function POST(req:Request){
  let db:PoolClient|null=null,transaction=false
  try{
    guard(req)
    const actor=await identity(req)
    const body=await req.json().catch(()=>{throw new PlatformError(400,"Invalid JSON")})
    const action=parse(z.string(),body?.action)
    if(action==="story-save"){
      const definition=parse(narrativeSchema,body?.definition)
      const publish=parse(z.boolean(),body?.publish)
      const templateId=body?.id?parse(uuid,body.id):null
      if(templateId){
        const {rowCount}=await getPool().query("UPDATE narrative_templates "+
          "SET definition=$1,title=$2,summary=$3,category=$4,published=$5,updated_at=now() "+
          "WHERE id=$6 AND author_id=$7",
          [JSON.stringify(definition),definition.title,definition.summary,definition.category,publish,templateId,actor.id])
        if(!rowCount)throw new PlatformError(404,"Only the author can edit this story")
        return respond({id:templateId,message:"Story saved. Already-accepted sessions keep their original snapshots."})
      }
      const count=await getPool().query<{total:number}>(
        "SELECT count(*)::int AS total FROM narrative_templates WHERE author_id=$1",[actor.id])
      if(count.rows[0].total>=40)throw new PlatformError(429,"Maximum of 40 interactive stories per creator")
      const id=randomUUID()
      await getPool().query("INSERT INTO narrative_templates(id,author_id,definition,title,summary,category,published) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7)",[id,actor.id,JSON.stringify(definition),
        definition.title,definition.summary,definition.category,publish])
      return respond({id,message:publish?"Branching story published.":"Private branching story saved."},201)
    }
    if(action==="interest-save"){
      const items=parse(z.array(z.object({
        interest:z.string().refine(isPresetInterest,"Select a catalog interest"),
        level:z.number().int().min(0).max(4),public:z.boolean()
      }).strict()).max(24).refine(items=>new Set(items.map(i=>i.interest)).size===items.length,
        "Do not repeat an interest"),body?.items)
      const db0=await getPool().connect()
      try{
        await db0.query("BEGIN")
        await db0.query("DELETE FROM profile_interest_levels WHERE user_id=$1",[actor.id])
        for(const item of items){
          await db0.query("INSERT INTO profile_interest_levels(user_id,interest,level,public) "+
            "VALUES($1,$2,$3,$4)",[actor.id,item.interest,item.level,item.public])
        }
        await db0.query("COMMIT")
      }catch(e){await db0.query("ROLLBACK").catch(()=>{});throw e}
      finally{db0.release()}
      return respond({message:"Interest levels and visibility updated."})
    }
    const sceneId=parse(uuid,body?.sceneId)
    db=await getPool().connect()
    await db.query("BEGIN");transaction=true
    const scene=await sceneFor(db,sceneId,actor.id,true)
    if(action==="stop"){
      if(scene.status==="active"){
        await db.query("UPDATE scenes SET status='paused',updated_at=now() WHERE id=$1",[sceneId])
        // A paused scene cannot continue self-reported activity timers.
        await db.query("UPDATE scene_time_sessions SET status='finished',ended_at=now(),active_since=NULL,"+
          "accumulated_seconds=accumulated_seconds+CASE WHEN status='running' THEN "+
          "GREATEST(0,EXTRACT(EPOCH FROM(now()-active_since))::int) ELSE 0 END "+
          "WHERE scene_id=$1 AND status IN('running','paused')",[sceneId])
        await db.query("INSERT INTO scene_safety_events(id,scene_id,actor_id,action) VALUES($1,$2,$3,'stop')",
          [randomUUID(),sceneId,actor.id])
        await emit(db,sceneId,actor.id,"consent.stopped",randomUUID(),
          "Scene paused immediately by a participant")
      }
      await db.query("COMMIT");transaction=false
      return respond({message:"Scene paused immediately. No points or fictional penalties were applied."})
    }
    if(action==="safety-save"){
      const settings=parse(safetyInput,body?.settings)
      await db.query("INSERT INTO scene_safety_prefs(scene_id,user_id,limits,share_limits,ai_opt_in,aftercare) "+
        "VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(scene_id,user_id) DO UPDATE "+
        "SET limits=EXCLUDED.limits,share_limits=EXCLUDED.share_limits,ai_opt_in=EXCLUDED.ai_opt_in,"+
        "aftercare=EXCLUDED.aftercare,updated_at=now()",
        [sceneId,actor.id,JSON.stringify(settings.limits),settings.shareLimits,settings.aiOptIn,settings.aftercare])
      await db.query("COMMIT");transaction=false
      return respond({message:"Your safety and privacy preferences were saved."})
    }
    if(action==="checkin"){
      await db.query("INSERT INTO scene_safety_prefs(scene_id,user_id,last_checkin) VALUES($1,$2,now()) "+
        "ON CONFLICT(scene_id,user_id) DO UPDATE SET last_checkin=now()",
        [sceneId,actor.id])
      const id=randomUUID()
      await db.query("INSERT INTO scene_safety_events(id,scene_id,actor_id,action) VALUES($1,$2,$3,'consent-check')",
        [id,sceneId,actor.id])
      await emit(db,sceneId,actor.id,"consent.checkin",id,"Participant confirmed their ongoing consent")
      await db.query("COMMIT");transaction=false
      return respond({message:"Optional consent check-in recorded. You can pause or stop at any time."})
    }
    if(action==="story-propose"){
      active(scene)
      const id=parse(uuid,body?.id)
      const {rows}=await db.query("SELECT definition FROM narrative_templates "+
        "WHERE id=$1 AND (published=true OR author_id=$2)",[id,actor.id])
      if(!rows.length)throw new PlatformError(404,"Story not available")
      const definition=parse(narrativeSchema,rows[0].definition)
      const {rows:count}=await db.query<{total:number}>(
        "SELECT count(*)::int AS total FROM narrative_sessions WHERE scene_id=$1 AND status IN('proposed','active')",[sceneId])
      if(count[0].total>=5)throw new PlatformError(429,"Finish or decline a shared story before starting another")
      const sessionId=randomUUID()
      await db.query("INSERT INTO narrative_sessions(id,scene_id,template_id,proposed_by,definition_snapshot,state) "+
        "VALUES($1,$2,$3,$4,$5,$6)",[sessionId,sceneId,id,actor.id,JSON.stringify(definition),
        JSON.stringify(initialNarrativeState)])
      await emit(db,sceneId,actor.id,"story.proposed",sessionId,"New interactive story proposed")
      await db.query("COMMIT");transaction=false
      return respond({id:sessionId,message:"Story proposed. Your partner must accept the playbook before the first choice."},201)
    }
    if(action==="story-decision"||action==="story-choice"||action==="story-stop"){
      const id=parse(uuid,body?.id)
      const {rows}=await db.query(
        "SELECT * FROM narrative_sessions WHERE id=$1 AND scene_id=$2 FOR UPDATE",[id,sceneId])
      if(!rows.length)throw new PlatformError(404,"Story session not found")
      const story=rows[0]
      if(action==="story-decision"){
        active(scene)
        if(story.status!=="proposed")throw new PlatformError(409,"Story is not awaiting consent")
        if(story.proposed_by===actor.id)throw new PlatformError(403,"Your partner must accept the playbook")
        const approve=parse(z.boolean(),body?.approve)
        await db.query("UPDATE narrative_sessions SET status=$1,approved_by=$2,reviewed_at=now() WHERE id=$3",
          [approve?"active":"declined",actor.id,id])
        await emit(db,sceneId,actor.id,"story.decision",id,approve?
          "Interactive story accepted":"Interactive story declined")
        await db.query("COMMIT");transaction=false
        return respond({message:approve?"Story accepted. Both partners can now take turns.":"Story declined without penalty."})
      }
      if(action==="story-stop"){
        if(story.status==="active"||story.status==="proposed"){
          await db.query("UPDATE narrative_sessions SET status='stopped',finished_at=now() WHERE id=$1",[id])
          await emit(db,sceneId,actor.id,"story.stopped",id,"Story ended by a participant")
        }
        await db.query("COMMIT");transaction=false
        return respond({message:"Story stopped. The scene and consent controls remain available."})
      }
      active(scene)
      if(story.status!=="active")throw new PlatformError(409,"Story must be mutually accepted and active")
      if(story.last_actor_id===actor.id)throw new PlatformError(409,"Wait for your partner to choose next")
      const definition=parse(narrativeSchema,story.definition_snapshot)
      const state=parse(z.object({nodeId:z.string(),flags:z.array(z.string()),items:z.array(z.string()).max(12).default([]),decisions:z.number().int()}),story.state)
      const choiceId=parse(z.string(),body?.choiceId)
      let step:ReturnType<typeof narrativeStep>
      try{step=narrativeStep(definition,state,choiceId)}
      catch(e){throw new PlatformError(409,e instanceof Error?e.message:"Invalid story choice")}
      const eventId=randomUUID()
      const today=await db.query<{earned:number}>(
        "SELECT COALESCE(sum(points),0)::int AS earned FROM scene_point_events "+
        "WHERE scene_id=$1 AND user_id=$2 AND source='narrative' AND created_at>=date_trunc('day',now())",
        [sceneId,actor.id])
      const prior=await db.query<{earned:number}>(
        "SELECT COALESCE(sum(points_awarded),0)::int AS earned FROM narrative_turns WHERE session_id=$1",[id])
      const points=Math.max(0,Math.min(capEventPoints(step.choice.points,today.rows[0].earned),60-prior.rows[0].earned))
      await db.query("INSERT INTO narrative_turns(id,session_id,actor_id,chapter_id,choice_id,label,points_awarded) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7)",[eventId,id,actor.id,step.chapter.id,step.choice.id,step.choice.label,points])
      await db.query("UPDATE narrative_sessions SET state=$1,last_actor_id=$2,status=$3::text,"+
        "finished_at=CASE WHEN $3='finished' THEN now() ELSE NULL END WHERE id=$4",
        [JSON.stringify(step.state),actor.id,step.finished?"finished":"active",id])
      await award(db,sceneId,actor.id,"narrative",eventId,points)
      await emit(db,sceneId,actor.id,"story.choice",eventId,"Interactive story choice made",
        {sessionId:id,chapter:step.chapter.id,choice:step.choice.id,next:step.targetId,points})
      if(step.choice.proposeTask){
        const taskId=randomUUID()
        const task=assignmentInput.parse({title:step.choice.proposeTask,
          description:"Optional task proposed by a mutually accepted interactive story",
          steps:[{id:"step-1",title:step.choice.proposeTask,
            instruction:"Discuss and complete this optional story challenge together.",requiresNote:false,timerMinutes:0}],points:10})
        await db.query("INSERT INTO scene_assignments(id,scene_id,proposed_by,title,description,steps,points,story_session_id) "+
          "VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [taskId,sceneId,actor.id,task.title,task.description,JSON.stringify(task.steps),task.points,id])
        await emit(db,sceneId,actor.id,"story.task-proposed",taskId,"Optional story-linked task proposed")
      }
      await db.query("COMMIT");transaction=false
      return respond({message:step.finished?"Story finished! Your choices and points were saved.":
        "Choice recorded. Your partner can play the next chapter.",points})
    }
    if(action==="task-create"){
      active(scene)
      const task=parse(assignmentInput,body?.task)
      const {rows:count}=await db.query<{total:number}>(
        "SELECT count(*)::int AS total FROM scene_assignments WHERE scene_id=$1",[sceneId])
      if(count[0].total>=100)throw new PlatformError(429,"Task limit reached for this scene")
      const id=randomUUID()
      await db.query("INSERT INTO scene_assignments(id,scene_id,proposed_by,title,description,steps,points) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7)",[id,sceneId,actor.id,task.title,task.description,
        JSON.stringify(task.steps),task.points])
      await emit(db,sceneId,actor.id,"task.proposed",id,"Multi-step task proposed")
      await db.query("COMMIT");transaction=false
      return respond({id,message:"Task proposed. Your partner must explicitly accept it."},201)
    }
    if(action.startsWith("task-")){
      const id=parse(uuid,body?.id)
      const {rows}=await db.query("SELECT * FROM scene_assignments WHERE id=$1 AND scene_id=$2 FOR UPDATE",
        [id,sceneId])
      if(!rows.length)throw new PlatformError(404,"Task not found")
      const task=rows[0],steps=parse(z.array(z.object({
        id:z.string(),title:z.string(),instruction:z.string(),requiresNote:z.boolean(),timerMinutes:z.number().int()
      })),task.steps)
      if(action==="task-cancel"){
        if(task.status==="completed"||task.status==="cancelled"||task.status==="declined")
          throw new PlatformError(409,"Task is already closed")
        if(actor.id!==task.proposed_by&&actor.role!=="sub")
          throw new PlatformError(403,"Only the proposer or Sub may cancel a task")
        await db.query("UPDATE scene_assignments SET status='cancelled' WHERE id=$1",[id])
        await emit(db,sceneId,actor.id,"task.cancelled",id,"Optional task cancelled without penalty")
        await db.query("COMMIT");transaction=false
        return respond({message:"Optional task cancelled without penalty."})
      }
      active(scene)
      if(action==="task-decision"){
        if(task.status!=="proposed")throw new PlatformError(409,"This task has already been decided")
        if(task.proposed_by===actor.id)throw new PlatformError(403,"The other participant must accept")
        const accept=parse(z.boolean(),body?.accept)
        await db.query("UPDATE scene_assignments SET status=$1,accepted_by=$2,decided_at=now() WHERE id=$3",
          [accept?"active":"declined",actor.id,id])
        await emit(db,sceneId,actor.id,"task.decision",id,accept?"Task accepted":"Task declined")
        await db.query("COMMIT");transaction=false
        return respond({message:accept?"Task accepted. You can now work through the steps.":"Task declined without penalty."})
      }
      if(action==="task-start-step"){
        requireRole(actor,"sub")
        if(task.status!=="active")throw new PlatformError(409,"Task is not ready to start")
        const step=steps[task.next_step]
        if(!step)throw new PlatformError(409,"Task is already complete")
        await db.query("UPDATE scene_assignments SET step_started_at=COALESCE(step_started_at,now()) WHERE id=$1",[id])
        await db.query("COMMIT");transaction=false
        return respond({message:"Step timer started; it is informational and never prevents pausing."})
      }
      if(action==="task-submit"){
        requireRole(actor,"sub")
        if(task.status!=="active")throw new PlatformError(409,"This task is not accepting submissions")
        const step=steps[task.next_step]
        if(!step)throw new PlatformError(409,"No remaining steps")
        const note=parse(z.string().trim().max(1000),body?.note||"")
        if(step.requiresNote&&note.length<12)throw new PlatformError(400,"This step asks for a text report of at least 12 characters")
        if(step.timerMinutes){
          if(!task.step_started_at)throw new PlatformError(409,"Start this step's optional activity timer first")
          const elapsed=(Date.now()-new Date(task.step_started_at).getTime())/60000
          if(elapsed<step.timerMinutes)throw new PlatformError(409,"Wait until the agreed step timer finishes, or cancel the task freely")
        }
        const stepId=randomUUID()
        const {rowCount}=await db.query("INSERT INTO assignment_step_submissions(id,assignment_id,step_number,note,submitted_by) "+
          "VALUES($1,$2,$3,$4,$5) ON CONFLICT(assignment_id,step_number) DO UPDATE "+
          "SET id=EXCLUDED.id,note=EXCLUDED.note,status='submitted',submitted_by=EXCLUDED.submitted_by,"+
          "submitted_at=now(),reviewed_at=NULL,reviewed_by=NULL,review_note='' "+
          "WHERE assignment_step_submissions.status='rejected'",
          [stepId,id,task.next_step,note,actor.id])
        if(!rowCount)throw new PlatformError(409,"Step already awaits approval")
        await db.query("UPDATE scene_assignments SET status='submitted' WHERE id=$1",[id])
        await emit(db,sceneId,actor.id,"task.step-submitted",stepId,"Step submitted for review")
        await db.query("COMMIT");transaction=false
        return respond({message:"Step submitted. Your partner can approve or request changes."})
      }
      if(action==="task-review"){
        requireRole(actor,"dom")
        if(task.status!=="submitted")throw new PlatformError(409,"This task is not waiting for review")
        const approve=parse(z.boolean(),body?.approve)
        const note=parse(z.string().trim().max(500),body?.note||"")
        if(!approve&&note.length<5)throw new PlatformError(400,"Explain why the step needs revision")
        const {rows:submissions}=await db.query(
          "SELECT * FROM assignment_step_submissions WHERE assignment_id=$1 AND step_number=$2 "+
          "AND status='submitted' FOR UPDATE",[id,task.next_step])
        if(!submissions.length)throw new PlatformError(409,"Step submission unavailable")
        await db.query("UPDATE assignment_step_submissions SET status=$1,reviewed_by=$2,reviewed_at=now(),review_note=$3 "+
          "WHERE id=$4",[approve?"approved":"rejected",actor.id,note,submissions[0].id])
        const finished=approve&&task.next_step+1>=steps.length
        await db.query("UPDATE scene_assignments SET status=$1::text,next_step=$2,step_started_at=NULL,"+
          "completed_at=CASE WHEN $1='completed' THEN now() ELSE NULL END WHERE id=$3",
          [approve?(finished?"completed":"active"):"active",
          approve?task.next_step+1:task.next_step,id])
        if(finished){
          const {rows:participants}=await db.query(
            "SELECT p.id FROM profiles p WHERE p.id IN($1,$2) AND p.role='sub'",
            [scene.sender_id,scene.recipient_id])
          if(participants[0])await award(db,sceneId,participants[0].id,"advanced-task",id,task.points)
        }
        await emit(db,sceneId,actor.id,"task.step-reviewed",submissions[0].id,
          approve?"Task step approved":"Task step returned for revision",{finished})
        await db.query("COMMIT");transaction=false
        return respond({message:approve?(finished?"Multi-step task complete. Separate game points awarded.":"Step approved. Next step unlocked."):"Step returned for revision. No penalty applied."})
      }
    }
    if(action==="chat-send"){
      active(scene)
      const bodyText=parse(text(1,2000),body?.message)
      const {rows:daily}=await db.query<{total:number}>(
        "SELECT count(*)::int AS total FROM scene_messages WHERE sender_id=$1 AND created_at>now()-interval '24 hours'",
        [actor.id])
      if(daily[0].total>=150)throw new PlatformError(429,"Daily message limit reached")
      const id=randomUUID()
      await db.query("INSERT INTO scene_messages(id,scene_id,sender_id,body) VALUES($1,$2,$3,$4)",
        [id,sceneId,actor.id,bodyText])
      await emit(db,sceneId,actor.id,"chat.message",id,"Private partner message sent")
      await db.query("COMMIT");transaction=false
      return respond({id,message:"Private message sent."},201)
    }
    if(action==="chat-edit"||action==="chat-delete"){
      const id=parse(uuid,body?.id)
      const {rows}=await db.query("SELECT sender_id,deleted_at,created_at FROM scene_messages "+
        "WHERE id=$1 AND scene_id=$2 FOR UPDATE",[id,sceneId])
      if(!rows.length||rows[0].deleted_at)throw new PlatformError(404,"Message not available")
      if(rows[0].sender_id!==actor.id)throw new PlatformError(403,"Only the author may edit or erase a message")
      if(action==="chat-edit"){
        active(scene)
        if(Date.now()-new Date(rows[0].created_at).getTime()>15*60000)
          throw new PlatformError(409,"Messages can be edited for 15 minutes")
        const bodyText=parse(text(1,2000),body?.message)
        await db.query("UPDATE scene_messages SET body=$1,edited_at=now() WHERE id=$2",[bodyText,id])
      }else{
        await db.query("UPDATE scene_messages SET body='[deleted]',deleted_at=now() WHERE id=$1",[id])
      }
      await emit(db,sceneId,actor.id,action==="chat-edit"?"chat.edited":"chat.deleted",
        id,action==="chat-edit"?"Message edited":"Message deleted")
      await db.query("COMMIT");transaction=false
      return respond({message:action==="chat-edit"?"Message edited.":"Message deleted."})
    }
    if(action==="chat-read"){
      await db.query("INSERT INTO scene_chat_receipts(scene_id,user_id) VALUES($1,$2) "+
        "ON CONFLICT(scene_id,user_id) DO UPDATE SET last_read_at=now()",[sceneId,actor.id])
      await db.query("COMMIT");transaction=false
      return respond({message:"Conversation marked read."})
    }
    if(action.startsWith("timer-")){
      requireRole(actor,"sub")
      if(action==="timer-start"){
        active(scene)
        const label=parse(text(3,90),body?.label)
        const id=randomUUID()
        await db.query("INSERT INTO scene_time_sessions(id,scene_id,user_id,label,active_since) "+
          "VALUES($1,$2,$3,$4,now())",[id,sceneId,actor.id,label])
        await emit(db,sceneId,actor.id,"timer.started",id,"Self-reported session started")
        await db.query("COMMIT");transaction=false
        return respond({id,message:"Self-reported session started. You can stop it anytime."},201)
      }
      const id=parse(uuid,body?.id)
      const {rows}=await db.query("SELECT id,status FROM scene_time_sessions WHERE id=$1 AND scene_id=$2 "+
        "AND user_id=$3 FOR UPDATE",[id,sceneId,actor.id])
      if(!rows.length||rows[0].status==="finished")throw new PlatformError(404,"Open personal session unavailable")
      if(action==="timer-pause"||action==="timer-end"){
        await db.query("UPDATE scene_time_sessions SET "+
          "accumulated_seconds=accumulated_seconds+CASE WHEN status='running' THEN "+
          "GREATEST(0,EXTRACT(EPOCH FROM(now()-active_since))::int) ELSE 0 END,"+
          "active_since=NULL,status=$1::text,ended_at=CASE WHEN $1='finished' THEN now() ELSE NULL END WHERE id=$2",
          [action==="timer-pause"?"paused":"finished",id])
      }else if(action==="timer-resume"){
        active(scene)
        if(rows[0].status!=="paused")throw new PlatformError(409,"Only paused sessions can resume")
        await db.query("UPDATE scene_time_sessions SET status='running',active_since=now() WHERE id=$1",[id])
      }else throw new PlatformError(400,"Unknown timer action")
      await emit(db,sceneId,actor.id,action.replace("-","."),id,"Self-reported session updated")
      await db.query("COMMIT");transaction=false
      return respond({message:"Personal session updated. No physical restrictions applied."})
    }
    throw new PlatformError(400,"Unknown platform action")
  }catch(error){
    if(db&&transaction)await db.query("ROLLBACK").catch(()=>{})
    return fail(error)
  }finally{db?.release()}
}
