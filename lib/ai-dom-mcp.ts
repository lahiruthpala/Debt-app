import {randomInt,randomUUID} from "node:crypto"
import type {PoolClient} from "pg"
import {z} from "zod"
import {getPool} from "@/lib/db"
import {allowedAiText,normalizeAiText} from "@/lib/ai-dom-mcp-policy"
import {assignmentInput,initialNarrativeState,narrativeSchema,narrativeStep,
  permittedChoices,taskStepSchema} from "@/lib/scene-platform"

// AI agents have no general-purpose SQL, payment, consent, proof-image,
// campaign, or balance-changing capabilities. All writes are scene-scoped.
export const SYSTEM_AI_DOM_ID="vl-system-ai-dom-v1"
export class AiToolError extends Error{
  constructor(public status:number,message:string){super(message)}
}
const uuid=z.string().uuid()
export const toolInputs={
  list_ai_scenes:z.object({}).strict(),
  get_scene_context:z.object({sceneId:uuid}).strict(),
  send_message:z.object({sceneId:uuid,requestId:uuid,message:z.string().trim().min(1).max(1200)}).strict(),
  propose_task:z.object({sceneId:uuid,requestId:uuid,
    task:assignmentInput}).strict(),
  get_pending_reviews:z.object({sceneId:uuid}).strict(),
  review_text_submission:z.object({sceneId:uuid,requestId:uuid,assignmentId:uuid,
    approve:z.boolean(),note:z.string().trim().max(500).default("")}).strict(),
  list_story_templates:z.object({sceneId:uuid}).strict(),
  propose_story:z.object({sceneId:uuid,requestId:uuid,templateId:uuid}).strict(),
  get_story_state:z.object({sceneId:uuid,sessionId:uuid}).strict(),
  choose_story:z.object({sceneId:uuid,requestId:uuid,sessionId:uuid,choiceId:z.string().min(1).max(32)}).strict(),
}
export type AiToolName=keyof typeof toolInputs
type Scene={sceneId:string;subId:string;status:string}
function safeText(value:string){
  if(!allowedAiText(value))throw new AiToolError(400,
    "AI text must not request real payments, links or intimate images")
  return normalizeAiText(value)
}
async function sceneFor(db:PoolClient,sceneId:string,lock:boolean):Promise<Scene>{
  const {rows}=await db.query<{sceneId:string;subId:string;status:string}>(
    "SELECT s.id AS \"sceneId\",a.sub_id AS \"subId\",s.status FROM ai_dom_scenes a "+
    "JOIN scenes s ON s.id=a.scene_id JOIN connections c ON c.id=s.connection_id "+
    "JOIN profiles bot ON bot.id=a.dom_id JOIN profiles sub ON sub.id=a.sub_id "+
    "JOIN scene_safety_prefs prefs ON prefs.scene_id=s.id AND prefs.user_id=a.sub_id "+
    "WHERE a.scene_id=$1 AND a.dom_id=$2 AND a.enabled=true AND s.status='active' "+
    "AND c.state='active' AND prefs.ai_opt_in=true AND bot.is_ai=true AND bot.role='dom' "+
    "AND sub.role='sub' AND sub.adult_confirmed=true "+
    (lock?"FOR UPDATE OF a,s":""),
    [sceneId,SYSTEM_AI_DOM_ID])
  if(!rows.length)throw new AiToolError(403,"AI access is disabled, not opted in, or the scene is inactive")
  return rows[0]
}
async function recordWrite(db:PoolClient,sceneId:string,tool:AiToolName,requestId:string){
  const {rows}=await db.query<{count:number}>(
    "SELECT count(*)::int AS count FROM ai_dom_tool_actions "+
    "WHERE scene_id=$1 AND created_at>now()-interval '24 hours'",[sceneId])
  if(rows[0].count>=60)throw new AiToolError(429,"Daily AI action cap reached")
  const result=await db.query(
    "INSERT INTO ai_dom_tool_actions(id,scene_id,tool_name,request_id) "+
    "VALUES($1,$2,$3,$4) ON CONFLICT(scene_id,tool_name,request_id) DO NOTHING",
    [randomUUID(),sceneId,tool,requestId])
  if(!result.rowCount)throw new AiToolError(409,"Duplicate requestId; no action was repeated")
}
async function withScene<T>(sceneId:string,write:AiToolName|null,requestId:string|null,
  fn:(db:PoolClient,scene:Scene)=>Promise<T>):Promise<T>{
  const db=await getPool().connect()
  let tx=false
  try{
    if(write){await db.query("BEGIN");tx=true}
    const scene=await sceneFor(db,sceneId,Boolean(write))
    if(write)await recordWrite(db,sceneId,write,requestId!)
    const value=await fn(db,scene)
    if(tx){await db.query("COMMIT");tx=false}
    return value
  }catch(error){
    if(tx)await db.query("ROLLBACK").catch(()=>{})
    throw error
  }finally{db.release()}
}
async function emit(db:PoolClient,sceneId:string,type:string,id:string,summary:string){
  await db.query("INSERT INTO scene_events(scene_id,actor_id,event_type,ref_id,summary) "+
    "VALUES($1,$2,$3,$4,$5) ON CONFLICT(scene_id,event_type,ref_id) DO NOTHING",
    [sceneId,SYSTEM_AI_DOM_ID,type,id,summary])
}
export async function runAiDomTool(name:AiToolName,args:unknown):Promise<unknown>{
  // Validate even though the MCP SDK validates inputSchema: never trust model calls.
  const parsed=toolInputs[name].safeParse(args)
  if(!parsed.success)throw new AiToolError(400,"Invalid tool arguments")
  const input=parsed.data as Record<string,any>
  if(name==="list_ai_scenes"){
    const {rows}=await getPool().query(
      "SELECT a.scene_id AS \"sceneId\",p.handle AS \"subHandle\",s.created_at AS \"createdAt\" "+
      "FROM ai_dom_scenes a JOIN scenes s ON s.id=a.scene_id "+
      "JOIN connections c ON c.id=s.connection_id "+
      "JOIN profiles p ON p.id=a.sub_id "+
      "JOIN scene_safety_prefs prefs ON prefs.scene_id=s.id AND prefs.user_id=a.sub_id "+
      "WHERE a.dom_id=$1 AND a.enabled=true AND s.status='active' AND "+
      "c.state='active' AND prefs.ai_opt_in=true AND p.adult_confirmed=true "+
      "ORDER BY s.updated_at DESC LIMIT 50",[SYSTEM_AI_DOM_ID])
    return {scenes:rows}
  }
  const sceneId=input.sceneId as string
  const requestId=(input.requestId as string)||null
  if(name==="get_scene_context"){
    return withScene(sceneId,null,null,async(db,scene)=>{
      const [contract,messages,tasks,safety]=await Promise.all([
        db.query("SELECT title_snapshot,description_snapshot,modules_snapshot FROM scene_contracts WHERE scene_id=$1",
          [sceneId]),
        db.query("SELECT id,sender_id,body,created_at FROM scene_messages "+
          "WHERE scene_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20",[sceneId]),
        db.query("SELECT id,title,description,status,next_step,points FROM scene_assignments "+
          "WHERE scene_id=$1 ORDER BY created_at DESC LIMIT 20",[sceneId]),
        db.query("SELECT limits FROM scene_safety_prefs WHERE scene_id=$1 AND user_id=$2",
          [sceneId,scene.subId]),
      ])
      return {sceneId,fictionalOnly:true,partner:"AI Dom",status:scene.status,
        subLimits:safety.rows[0]?.limits||[],
        contract:contract.rows[0]||null,
        recentMessages:messages.rows.reverse(),tasks:tasks.rows}
    })
  }
  if(name==="send_message"){
    return withScene(sceneId,name,requestId,async(db)=>{
      const text=safeText(input.message)
      if(!text)throw new AiToolError(400,"Message cannot be empty")
      const {rows}=await db.query<{count:number}>(
        "SELECT count(*)::int AS count FROM scene_messages WHERE sender_id=$1 "+
        "AND scene_id=$2 AND created_at>now()-interval '24 hours'",[SYSTEM_AI_DOM_ID,sceneId])
      if(rows[0].count>=40)throw new AiToolError(429,"AI message cap reached")
      const id=randomUUID()
      await db.query("INSERT INTO scene_messages(id,scene_id,sender_id,body) VALUES($1,$2,$3,$4)",
        [id,sceneId,SYSTEM_AI_DOM_ID,text])
      await emit(db,sceneId,"chat.message",id,"AI partner message sent")
      return {id,created:true}
    })
  }
  if(name==="propose_task"){
    return withScene(sceneId,name,requestId,async(db)=>{
      const task=assignmentInput.parse(input.task)
      if(task.points>20||task.steps.some(step=>step.requiresPhoto||step.timerMinutes>30))
        throw new AiToolError(400,"AI tasks must be text-only, optional, <=20 points, with timers <=30 minutes")
      safeText(task.title);safeText(task.description)
      for(const step of task.steps){safeText(step.title);safeText(step.instruction)}
      const {rows}=await db.query<{count:number}>(
        "SELECT count(*)::int AS count FROM scene_assignments "+
        "WHERE scene_id=$1 AND proposed_by=$2 AND created_at>now()-interval '24 hours'",
        [sceneId,SYSTEM_AI_DOM_ID])
      if(rows[0].count>=6)throw new AiToolError(429,"AI task proposal limit reached")
      const id=randomUUID()
      await db.query("INSERT INTO scene_assignments(id,scene_id,proposed_by,title,description,steps,points) "+
        "VALUES($1,$2,$3,$4,$5,$6,$7)",
        [id,sceneId,SYSTEM_AI_DOM_ID,task.title,task.description,JSON.stringify(task.steps),task.points])
      await emit(db,sceneId,"task.proposed",id,"Optional AI task proposed")
      return {id,status:"proposed",requiresSubAcceptance:true}
    })
  }
  if(name==="get_pending_reviews"){
    return withScene(sceneId,null,null,async(db)=>{
      const {rows}=await db.query(
        "SELECT t.id AS \"assignmentId\",t.title,t.next_step AS \"stepNumber\","+
        "q.note,q.submitted_at AS \"submittedAt\" FROM scene_assignments t "+
        "JOIN assignment_step_submissions q ON q.assignment_id=t.id AND q.step_number=t.next_step "+
        "WHERE t.scene_id=$1 AND t.proposed_by=$2 AND t.status='submitted' "+
        "AND q.status='submitted' ORDER BY q.submitted_at LIMIT 30",[sceneId,SYSTEM_AI_DOM_ID])
      return {reviews:rows}
    })
  }
  if(name==="review_text_submission"){
    return withScene(sceneId,name,requestId,async(db,scene)=>{
      const {rows:tasks}=await db.query(
        "SELECT * FROM scene_assignments WHERE id=$1 AND scene_id=$2 "+
        "AND proposed_by=$3 FOR UPDATE",[input.assignmentId,sceneId,SYSTEM_AI_DOM_ID])
      const task=tasks[0]
      if(!task||task.status!=="submitted")throw new AiToolError(409,"Task not awaiting AI review")
      const steps=z.array(taskStepSchema).min(1).max(8).parse(task.steps)
      const step=steps[task.next_step]
      if(!step||step.requiresPhoto)throw new AiToolError(403,"AI cannot review photo-dependent tasks")
      const {rows:attachments}=await db.query(
        "SELECT id FROM assignment_step_evidence WHERE assignment_id=$1 "+
        "AND step_number=$2 AND deleted_at IS NULL LIMIT 1",[task.id,task.next_step])
      if(attachments.length)throw new AiToolError(403,"Private attached evidence requires human review")
      const {rows:submissions}=await db.query(
        "SELECT id FROM assignment_step_submissions WHERE assignment_id=$1 "+
        "AND step_number=$2 AND status='submitted' FOR UPDATE",[task.id,task.next_step])
      if(!submissions.length)throw new AiToolError(409,"Submission unavailable")
      const note=safeText(input.note)
      if(!input.approve&&note.length<5)
        throw new AiToolError(400,"A rejection needs an explanation of at least five characters")
      await db.query(
        "UPDATE assignment_step_submissions SET status=$1,reviewed_by=$2,reviewed_at=now(),review_note=$3 "+
        "WHERE id=$4",[input.approve?"approved":"rejected",SYSTEM_AI_DOM_ID,note,submissions[0].id])
      const finished=Boolean(input.approve)&&task.next_step+1>=steps.length
      await db.query(
        "UPDATE scene_assignments SET status=$1,next_step=$2,step_started_at=NULL,"+
        "completed_at=CASE WHEN $1='completed' THEN now() ELSE NULL END WHERE id=$3",
        [input.approve?(finished?"completed":"active"):"active",
          input.approve?task.next_step+1:task.next_step,task.id])
      if(finished&&task.points>0){
        await db.query(
          "INSERT INTO scene_point_events(id,scene_id,user_id,points,source,source_id) "+
          "VALUES($1,$2,$3,$4,'advanced-task',$5) ON CONFLICT(user_id,source,source_id) DO NOTHING",
          [randomUUID(),sceneId,scene.subId,task.points,task.id])
      }
      await emit(db,sceneId,"task.step-reviewed",submissions[0].id,
        input.approve?"AI approved text step":"AI returned text step for revision")
      return {approved:input.approve,finished,fictionalPoints:finished?task.points:0}
    })
  }
  if(name==="list_story_templates"){
    return withScene(sceneId,null,null,async(db)=>{
      const {rows}=await db.query(
        "SELECT id,title,summary,category FROM narrative_templates "+
        "WHERE published=true ORDER BY updated_at DESC LIMIT 30")
      return {templates:rows}
    })
  }
  if(name==="propose_story"){
    return withScene(sceneId,name,requestId,async(db)=>{
      const {rows:templates}=await db.query(
        "SELECT definition FROM narrative_templates WHERE id=$1 AND published=true",[input.templateId])
      if(!templates.length)throw new AiToolError(404,"Published story not found")
      const definition=narrativeSchema.parse(templates[0].definition)
      const {rows:count}=await db.query<{count:number}>(
        "SELECT count(*)::int AS count FROM narrative_sessions "+
        "WHERE scene_id=$1 AND status IN('proposed','active')",[sceneId])
      if(count[0].count>=3)throw new AiToolError(409,"Finish or decline an existing story first")
      const id=randomUUID()
      await db.query(
        "INSERT INTO narrative_sessions(id,scene_id,template_id,proposed_by,definition_snapshot,state) "+
        "VALUES($1,$2,$3,$4,$5,$6)",
        [id,sceneId,input.templateId,SYSTEM_AI_DOM_ID,
          JSON.stringify(definition),JSON.stringify(initialNarrativeState)])
      await emit(db,sceneId,"story.proposed",id,"AI proposed an optional story")
      return {sessionId:id,status:"proposed",requiresSubAcceptance:true}
    })
  }
  if(name==="get_story_state"){
    return withScene(sceneId,null,null,async(db)=>{
      const {rows}=await db.query(
        "SELECT id,status,definition_snapshot,state,last_actor_id FROM narrative_sessions "+
        "WHERE id=$1 AND scene_id=$2",[input.sessionId,sceneId])
      if(!rows.length)throw new AiToolError(404,"Story not found")
      const story=rows[0],definition=narrativeSchema.parse(story.definition_snapshot)
      const state=story.state as {nodeId:string;flags:string[];items:string[];decisions:number}
      const chapter=definition.nodes.find(n=>n.id===state.nodeId)
      return {sessionId:story.id,status:story.status,title:definition.title,
        chapter:chapter?{id:chapter.id,title:chapter.title,text:chapter.text}:null,
        choices:permittedChoices(definition,state).map(c=>({id:c.id,label:c.label})),
        aiTurn:story.last_actor_id!==SYSTEM_AI_DOM_ID}
    })
  }
  if(name==="choose_story"){
    return withScene(sceneId,name,requestId,async(db)=>{
      const {rows}=await db.query(
        "SELECT * FROM narrative_sessions WHERE id=$1 AND scene_id=$2 FOR UPDATE",
        [input.sessionId,sceneId])
      const story=rows[0]
      if(!story||story.status!=="active")throw new AiToolError(409,"Story must be accepted and active")
      if(story.last_actor_id===SYSTEM_AI_DOM_ID)throw new AiToolError(409,"Wait for the Sub's turn")
      const definition=narrativeSchema.parse(story.definition_snapshot)
      const state=story.state as {nodeId:string;flags:string[];items:string[];decisions:number}
      const choice=permittedChoices(definition,state).find(c=>c.id===input.choiceId)
      if(!choice)throw new AiToolError(400,"Story choice unavailable")
      const total=(choice.randomTargets||[]).reduce((sum,x)=>sum+x.weight,0)
      const step=narrativeStep(definition,state,input.choiceId,total?randomInt(total):undefined)
      const id=randomUUID()
      await db.query(
        "INSERT INTO narrative_turns(id,session_id,actor_id,chapter_id,choice_id,label,points_awarded) "+
        "VALUES($1,$2,$3,$4,$5,$6,0)",
        [id,story.id,SYSTEM_AI_DOM_ID,step.chapter.id,step.choice.id,step.choice.label])
      await db.query(
        "UPDATE narrative_sessions SET state=$1,last_actor_id=$2,status=$3,"+
        "finished_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$5",
        [JSON.stringify(step.state),SYSTEM_AI_DOM_ID,step.finished?"finished":"active",step.finished,story.id])
      await emit(db,sceneId,"story.choice",id,"AI completed its story turn")
      return {choiceId:step.choice.id,nextChapterId:step.targetId,finished:step.finished,
        note:"AI turns never award points or change fictional balances; story-linked task proposals are not automatic."}
    })
  }
  throw new AiToolError(404,"Unknown AI Dom MCP tool")
}
