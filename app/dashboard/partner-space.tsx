"use client"
import {useCallback,useEffect,useMemo,useRef,useState,type FormEvent} from "react"
import {interestGroups} from "@/lib/showcase"
import {safetyLimitOptions,type AdvancedTask} from "@/lib/scene-platform"

type Feedback=(type:"pending"|"success"|"error",message:string)=>void
type Scene={id:string;status:string;connection_state:string;other_handle:string}
type ChatMessage={id:string;sender_id:string;sender_handle:string;body:string|null;created_at:string;edited_at:string|null;deleted_at:string|null}
type Activity={id:number;event_type:string;summary:string;created_at:string;actor_id:string|null}
type Task={id:string;scene_id:string;title:string;description:string;steps:AdvancedTask["steps"];
  next_step:number;step_started_at:string|null;status:string;proposed_by:string;
  points:number;proposed_by_handle:string;current_submission:{
    step_number:number;note:string;status:string;review_note:string;submitted_at:string
  }|null}
type TimeSession={id:string;label:string;started_at:string;active_since:string|null;accumulated_seconds:number;
  status:string;ended_at:string|null}
type Safety={limits:string[];share_limits:boolean;ai_opt_in:boolean;aftercare:string;last_checkin:string|null}
type Interest={interest:string;level:number;public:boolean}
const tabs=[
  ["chat","Partner chat"],["tasks","Advanced tasks"],["tracking","Session tracker"],
  ["safety","Consent & safety"],["insights","Statistics"],["interests","Interest compatibility"],["ai","Creative assistant"]
] as const
type Tab=typeof tabs[number][0]
const end=(error:unknown)=>error instanceof Error?error.message:"Action failed"
const fmt=(time:string)=>new Date(time).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})
const initialSteps:AdvancedTask["steps"]=[{id:"step-1",title:"First milestone",
  instruction:"Write a short reflection or complete this agreed challenge.",requiresNote:true,timerMinutes:0}]
async function load(view:string,sceneId:string){
  const response=await fetch("/api/scene-platform?"+new URLSearchParams({view,sceneId}),{cache:"no-store"})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(data.error||"Could not load partner space")
  return data
}
async function post(input:Record<string,unknown>){
  const response=await fetch("/api/scene-platform",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(input)
  })
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(data.error||"Action failed")
  return data
}
export default function PartnerSpace({scenes,selectedSceneId,meId,role,onNotify,onChanged}:{
  scenes:Scene[];selectedSceneId:string;meId:string;role:"dom"|"sub";onNotify:Feedback;onChanged:()=>Promise<void>
}){
  const [sceneId,setSceneId]=useState(selectedSceneId)
  const [tab,setTab]=useState<Tab>("chat")
  const [data,setData]=useState<any>(null)
  const [working,setWorking]=useState(false)
  const [loading,setLoading]=useState(false)
  const [message,setMessage]=useState("")
  const [taskForm,setTaskForm]=useState<AdvancedTask>({title:"Weekly creative challenge",
    description:"A voluntary collaborative challenge.",steps:initialSteps,points:20})
  const [notes,setNotes]=useState<Record<string,string>>({})
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({})
  const [timerLabel,setTimerLabel]=useState("Self-reported focus session")
  const [settings,setSettings]=useState<{limits:string[];shareLimits:boolean;aiOptIn:boolean;aftercare:string}>({
    limits:["no-real-money","no-intimate-images","no-device-control"],shareLimits:false,aiOptIn:false,aftercare:""})
  const [interests,setInterests]=useState<Interest[]>([])
  const [newInterest,setNewInterest]=useState("Story games")
  const [aiKind,setAiKind]=useState<"story"|"task"|"creative-prompt">("story")
  const [aiPrompt,setAiPrompt]=useState("")
  const [suggestion,setSuggestion]=useState("")
  const [aiAvailable,setAiAvailable]=useState<boolean|null>(null)
  const [installPrompt,setInstallPrompt]=useState<any>(null)
  const [now,setNow]=useState(Date.now())
  const seq=useRef(0),notifyRef=useRef(onNotify)
  useEffect(()=>{notifyRef.current=onNotify},[onNotify])
  const scene=scenes.find(s=>s.id===sceneId)
  const canPlay=scene?.status==="active"&&scene.connection_state==="active"
  useEffect(()=>{if(!scenes.some(s=>s.id===sceneId))setSceneId(
    scenes.some(s=>s.id===selectedSceneId)?selectedSceneId:scenes[0]?.id||"")},[scenes,selectedSceneId,sceneId])
  const reload=useCallback(async()=>{
    if(!sceneId){setData(null);return}
    const request=++seq.current
    setLoading(true)
    try{
      const result=await load(tab==="tracking"?"timers":tab==="insights"?"analytics":tab==="interests"?"interests":
        tab==="ai"?"safety":tab,sceneId)
      if(request!==seq.current)return
      setData(result)
      if(tab==="safety"||tab==="ai"){
        const own:Safety=result.own
        setSettings({limits:own.limits||[],shareLimits:own.share_limits||false,
          aiOptIn:own.ai_opt_in||false,aftercare:own.aftercare||""})
      }
      if(tab==="interests")setInterests((result.own||[]).map((item:Interest)=>({...item})))
    }catch(e){if(request===seq.current)notifyRef.current("error",end(e))}
    finally{if(request===seq.current)setLoading(false)}
  },[sceneId,tab])
  useEffect(()=>{void reload()},[reload])
  useEffect(()=>{
    if(tab!=="chat"||!sceneId)return
    const interval=window.setInterval(()=>{void reload()},20000)
    return ()=>window.clearInterval(interval)
  },[tab,sceneId,reload])
  useEffect(()=>{
    if(tab!=="tracking")return
    const interval=window.setInterval(()=>setNow(Date.now()),1000)
    return ()=>window.clearInterval(interval)
  },[tab])
  useEffect(()=>{
    const onInstall=(event:Event)=>{event.preventDefault();setInstallPrompt(event)}
    window.addEventListener("beforeinstallprompt",onInstall)
    fetch("/api/scene-ai").then(r=>r.json()).then(x=>setAiAvailable(Boolean(x.available))).catch(()=>{})
    return ()=>window.removeEventListener("beforeinstallprompt",onInstall)
  },[])
  async function act(input:Record<string,unknown>,after?:()=>void){
    if(working)return
    setWorking(true);notifyRef.current("pending","Processing partner-space action…")
    try{
      const response=await post({...input,sceneId})
      notifyRef.current("success",response.message||"Saved")
      await Promise.all([reload(),onChanged()])
      after?.()
      return true
    }catch(e){notifyRef.current("error",end(e));return false}
    finally{setWorking(false)}
  }
  async function emergencyStop(){
    if(working||!canPlay)return
    setWorking(true)
    try{
      const result=await post({action:"stop",sceneId})
      await Promise.all([reload(),onChanged()])
      notifyRef.current("success",result.message)
    }catch(e){notifyRef.current("error",end(e))}
    finally{setWorking(false)}
  }
  const feed=useMemo(()=>{
    if(tab!=="chat"||!data)return []
    const messages=(data.messages||[]).map((m:ChatMessage)=>({...m,type:"message" as const,key:"m"+m.id}))
    const events=(data.events||[]).map((e:Activity)=>({...e,type:"event" as const,key:"e"+e.id}))
    return [...messages,...events].sort((a,b)=>new Date(a.created_at).getTime()-new Date(b.created_at).getTime()).slice(-130)
  },[tab,data])
  function taskStepChange(index:number,patch:Partial<AdvancedTask["steps"][number]>){
    setTaskForm(old=>({...old,steps:old.steps.map((x,i)=>i===index?{...x,...patch}:x)}))
  }
  function addStep(){
    if(taskForm.steps.length>=8)return
    const id="step-"+(taskForm.steps.length+1)
    setTaskForm(old=>({...old,steps:[...old.steps,{id,title:"Next milestone",instruction:"Describe the next optional step.",requiresNote:false,timerMinutes:0}]}))
  }
  function onChatSubmit(e:FormEvent){
    e.preventDefault()
    if(!message.trim())return
    void act({action:"chat-send",message:message.trim()},()=>setMessage(""))
  }
  const currentSafety=data?.own as Safety|undefined
  const tasks=(data?.tasks||[]) as Task[]
  const timers=(data?.timers||[]) as TimeSession[]
  const annual=(data?.daily||[]) as {day:string;actions:number}[]
  const pointsByDay=new Map(annual.map(x=>[x.day,x.actions]))
  const chart=Array.from({length:91},(_,i)=>{
    const day=new Date();day.setUTCHours(12,0,0,0);day.setUTCDate(day.getUTCDate()-(90-i))
    const iso=day.toISOString().slice(0,10)
    return {iso,count:pointsByDay.get(iso)||0}
  })
  function exportAnalytics(){
    if(!annual.length)return
    const csv="date,activity_actions\n"+annual.map(x=>x.day+","+x.actions).join("\n")
    const url=URL.createObjectURL(new Blob([csv],{type:"text/csv;charset=utf-8"}))
    const link=document.createElement("a");link.href=url;link.download="scene-activity.csv";link.click()
    URL.revokeObjectURL(url)
  }
  function duration(timer:TimeSession){
    const seconds=timer.accumulated_seconds+(timer.status==="running"&&timer.active_since?
      Math.max(0,Math.floor((now-new Date(timer.active_since).getTime())/1000)):0)
    return Math.floor(seconds/3600)+"h "+String(Math.floor((seconds%3600)/60)).padStart(2,"0")+"m"
  }
  async function askAI(e:FormEvent){
    e.preventDefault()
    if(working)return
    setWorking(true);setSuggestion("")
    try{
      const response=await fetch("/api/scene-ai",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({sceneId,kind:aiKind,prompt:aiPrompt})})
      const answer=await response.json().catch(()=>({}))
      if(!response.ok)throw Error(answer.error||"AI suggestion failed")
      setSuggestion(answer.suggestion||"")
      notifyRef.current("success","Creative suggestion generated. It has not changed any scene rules.")
    }catch(e){notifyRef.current("error",end(e))}
    finally{setWorking(false)}
  }
  return <section className="scene-platform partner-space" aria-label="Partner space">
    <div className="scene-platform-head"><div>
      <span className="eyebrow">SHARED PARTNER WORKSPACE</span><h2>Keep your scene in one place</h2>
      <p>Private conversation, agreed multi-step tasks, self-reported tracking and safety controls, all linked to the same authorized scene.</p>
    </div>{canPlay&&<button className="btn btn-danger-soft" disabled={working}
      onClick={()=>void emergencyStop()}>Stop scene immediately</button>}</div>
    <label className="ops-scene-pick">CURRENT CONNECTION
      <select aria-label="Partner space connection" value={sceneId} onChange={e=>{setData(null);setSceneId(e.target.value)}}>
        {!scenes.length&&<option value="">No scenes available</option>}
        {scenes.map(s=><option key={s.id} value={s.id}>@{s.other_handle} · {s.status}</option>)}
      </select>
    </label>
    <nav className="ops-tabs">{tabs.map(([key,title])=><button key={key}
      className={tab===key?"chosen":""} onClick={()=>{setData(null);setTab(key)}}>{title}</button>)}</nav>
    {!canPlay&&sceneId&&<p className="ops-note">This scene is {scene?.status}. New messages, choices and tasks are suspended; history and safety controls remain available.</p>}
    {loading&&<p className="muted">Refreshing {tab}…</p>}
    {tab==="chat"&&<div className="ops-split">
      <div className="dash-card"><div className="section-title"><h2>Private conversation</h2>
        <button className="btn btn-quiet" type="button" onClick={()=>void reload()}>↻ Refresh</button></div>
        <p className="muted">Messages stay inside this connection, and are not passed to the AI assistant. Each participant can delete their own messages. Chat is server-private, not end-to-end encrypted.</p>
        <div className="scene-chat-feed" role="log" aria-label="Partner messages and scene activity">
          {!feed.length&&<p className="empty-inner">No messages or activity yet.</p>}
          {feed.map(row=>row.type==="event"?
            <div key={row.key} className="scene-chat-event"><small>{fmt(row.created_at)}</small><span>{row.summary}</span></div>:
            <div key={row.key} className={"scene-chat-msg "+(row.sender_id===meId?"own":"")}>
              <div className="ops-item-head"><b>@{row.sender_handle}</b><small>{fmt(row.created_at)}{row.edited_at?" · edited":""}</small></div>
              <p>{row.deleted_at?"Message deleted":row.body}</p>
              {!row.deleted_at&&row.sender_id===meId&&<div className="person-actions">
                <button className="btn btn-quiet" type="button" disabled={working} onClick={()=>{
                  const text=window.prompt("Edit your message",row.body||"")
                  if(text!==null)void act({action:"chat-edit",id:row.id,message:text})}}>Edit</button>
                <button className="btn btn-quiet" type="button" disabled={working}
                  onClick={()=>{if(window.confirm("Delete your message?"))void act({action:"chat-delete",id:row.id})}}>Delete</button>
              </div>}
            </div>)}
        </div>
        <form onSubmit={onChatSubmit} className="form-stack">
          <label>MESSAGE<textarea rows={3} aria-label="Private partner message" maxLength={2000}
            placeholder="Write to your connected partner…" value={message} onChange={e=>setMessage(e.target.value)}/></label>
          <div className="person-actions"><button className="btn btn-red" disabled={working||!canPlay||!message.trim()}>Send message</button>
            <button type="button" className="btn btn-outline" onClick={()=>void act({action:"chat-read"})}>Mark read</button></div>
        </form>
      </div>
      <aside className="dash-card"><h3>Actionable scene activity</h3>
        <p className="muted">Contract games, approved task actions, private proof updates and story events appear in this shared feed without exposing proof files or private notes.</p>
        <button className="btn btn-outline" onClick={()=>setTab("tasks")}>See advanced tasks</button>
        <button className="btn btn-outline" onClick={()=>setTab("safety")}>Review consent controls</button>
      </aside>
    </div>}

    {tab==="tasks"&&<div className="ops-split">
      <form className="dash-card form-stack" onSubmit={e=>{e.preventDefault();void act({action:"task-create",task:taskForm})}}>
        <span className="eyebrow">MUTUAL TASK AGREEMENT</span><h3>Propose a multi-step task</h3>
        <p className="muted">Each task needs the other participant's approval. Completion is reviewed, and points remain separate from fictional debt. Skips and cancellations have no penalty.</p>
        <label>TITLE<input required minLength={3} maxLength={100} value={taskForm.title}
          onChange={e=>setTaskForm({...taskForm,title:e.target.value})}/></label>
        <label>DESCRIPTION<textarea maxLength={600} rows={2} value={taskForm.description}
          onChange={e=>setTaskForm({...taskForm,description:e.target.value})}/></label>
        <label>GAME POINTS WHEN COMPLETE<input type="number" min={0} max={60} value={taskForm.points}
          onChange={e=>setTaskForm({...taskForm,points:Number(e.target.value)})}/></label>
        {taskForm.steps.map((step,i)=><div className="scene-node-editor" key={step.id}>
          <div className="ops-item-head"><strong>Step {i+1}</strong>{i>0&&<button type="button"
            className="btn btn-quiet" onClick={()=>setTaskForm({...taskForm,steps:taskForm.steps.filter((_,j)=>i!==j)})}>Remove</button>}</div>
          <label>STEP TITLE<input required maxLength={100} value={step.title}
            onChange={e=>taskStepChange(i,{title:e.target.value})}/></label>
          <label>INSTRUCTIONS<textarea rows={2} maxLength={400} value={step.instruction}
            onChange={e=>taskStepChange(i,{instruction:e.target.value})}/></label>
          <label>OPTIONAL TIMER (MINUTES, 0–120)<input type="number" min={0} max={120} value={step.timerMinutes}
            onChange={e=>taskStepChange(i,{timerMinutes:Number(e.target.value)})}/></label>
          <label className="check-label"><input type="checkbox" checked={step.requiresNote}
            onChange={e=>taskStepChange(i,{requiresNote:e.target.checked})}/>Require a private written report</label>
        </div>)}
        <button type="button" className="btn btn-outline" disabled={taskForm.steps.length>=8} onClick={addStep}>＋ Add step</button>
        <button className="btn btn-red" disabled={!canPlay||working}>Propose to partner</button>
      </form>
      <div className="dash-card"><div className="section-title"><h2>Shared task board</h2>
        <button className="btn btn-quiet" onClick={()=>void reload()}>↻ Refresh</button></div>
        {!tasks.length?<p className="muted">No advanced tasks here yet. Existing contract tasks remain in Contracts.</p>:
          tasks.map(task=>{
            const step=task.steps[task.next_step],isProposer=task.proposed_by===meId
            return <article className="ops-item scene-task-item" key={task.id}>
              <div className="ops-item-head"><strong>{task.title}</strong><span className={"status status-"+task.status}>{task.status}</span></div>
              <small>by @{task.proposed_by_handle} · {task.next_step}/{task.steps.length} steps · {task.points} pts</small>
              {task.description&&<p>{task.description}</p>}
              {task.status==="proposed"&&<div className="person-actions">
                {isProposer?<p className="muted">Waiting for partner approval.</p>:<>
                  <button className="btn btn-red" disabled={working||!canPlay}
                    onClick={()=>void act({action:"task-decision",id:task.id,accept:true})}>Accept</button>
                  <button className="btn btn-outline" disabled={working||!canPlay}
                    onClick={()=>void act({action:"task-decision",id:task.id,accept:false})}>Decline</button>
                </>}
              </div>}
              {step&&["active","submitted"].includes(task.status)&&<div className="scene-task-step">
                <strong>Current step: {step.title}</strong><p>{step.instruction}</p>
                {step.timerMinutes>0&&<small>Optional activity timer: {step.timerMinutes} min · {task.step_started_at?"Started "+fmt(task.step_started_at):"Not started"}</small>}
                {task.current_submission?.note&&<p><b>Report:</b> {task.current_submission.note}</p>}
                {task.current_submission?.review_note&&<p><b>Review:</b> {task.current_submission.review_note}</p>}
                {role==="sub"&&task.status==="active"&&<>
                  {step.timerMinutes>0&&!task.step_started_at&&<button className="btn btn-outline"
                    disabled={working||!canPlay} onClick={()=>void act({action:"task-start-step",id:task.id})}>Start timer</button>}
                  <label>COMPLETION REPORT<textarea rows={2} maxLength={1000} value={notes[task.id]||""}
                    onChange={e=>setNotes({...notes,[task.id]:e.target.value})}
                    placeholder={step.requiresNote?"Text report required":"Optional context"}/></label>
                  <button className="btn btn-red" disabled={working||!canPlay}
                    onClick={()=>void act({action:"task-submit",id:task.id,note:notes[task.id]||""})}>Submit step</button>
                </>}
                {role==="dom"&&task.status==="submitted"&&<>
                  <label>REVIEW NOTE<input maxLength={500} value={reviewNotes[task.id]||""}
                    onChange={e=>setReviewNotes({...reviewNotes,[task.id]:e.target.value})}/></label>
                  <div className="person-actions">
                    <button className="btn btn-red" disabled={working||!canPlay}
                      onClick={()=>void act({action:"task-review",id:task.id,approve:true,note:reviewNotes[task.id]||""})}>Approve</button>
                    <button className="btn btn-quiet" disabled={working||!canPlay}
                      onClick={()=>void act({action:"task-review",id:task.id,approve:false,note:reviewNotes[task.id]||""})}>Request revision</button>
                  </div>
                </>}
              </div>}
              {["proposed","active","submitted"].includes(task.status)&&
                (isProposer||role==="sub")&&<button className="btn btn-quiet" disabled={working}
                  onClick={()=>void act({action:"task-cancel",id:task.id})}>Cancel without penalty</button>}
            </article>
          })}
      </div>
    </div>}

    {tab==="tracking"&&<div className="ops-split">
      <form className="dash-card form-stack" onSubmit={e=>{e.preventDefault();void act({action:"timer-start",label:timerLabel})}}>
        <span className="eyebrow">SELF-REPORTED ONLY</span><h3>Personal session timer</h3>
        <p className="muted">Log voluntary routines or symbolic lock-status sessions. This records time; it never controls a physical device or prevents you from stopping.</p>
        <label>SESSION LABEL<input maxLength={90} minLength={3} value={timerLabel}
          onChange={e=>setTimerLabel(e.target.value)}/></label>
        <button className="btn btn-red" disabled={role!=="sub"||working||!canPlay||
          timers.some(t=>t.status==="running"||t.status==="paused")}>Start personal timer</button>
        {role!=="sub"&&<p className="muted">Personal timers are started by the Sub only.</p>}
      </form>
      <div className="dash-card"><h3>Session history</h3>
        {!timers.length?<p className="muted">No self-reported sessions.</p>:
          timers.map(item=><article key={item.id} className="ops-item">
            <div className="ops-item-head"><strong>{item.label}</strong><span className={"status status-"+item.status}>{item.status}</span></div>
            <span className="scene-session-clock">{duration(item)}</span><small>{fmt(item.started_at)}</small>
            {item.status!=="finished"&&<div className="person-actions">
              {item.status==="running"&&<button className="btn btn-outline" disabled={working}
                onClick={()=>void act({action:"timer-pause",id:item.id})}>Pause</button>}
              {item.status==="paused"&&<button className="btn btn-outline" disabled={working||!canPlay}
                onClick={()=>void act({action:"timer-resume",id:item.id})}>Resume</button>}
              <button className="btn btn-quiet" disabled={working} onClick={()=>void act({action:"timer-end",id:item.id})}>End now</button>
            </div>}
          </article>)}
      </div>
    </div>}

    {tab==="safety"&&<div className="ops-split">
      <form className="dash-card form-stack" onSubmit={e=>{e.preventDefault();void act({action:"safety-save",settings})}}>
        <span className="eyebrow">CONSENT ALWAYS TAKES PRECEDENCE</span><h3>Your scene boundaries</h3>
        <p className="muted">Personal boundaries and optional sharing. Limits cannot authorize actions the app prohibits. Your partner sees selected limits only if you explicitly enable sharing.</p>
        <div className="scene-limits">{safetyLimitOptions.map(label=><label key={label} className="check-label">
          <input type="checkbox" checked={settings.limits.includes(label)}
            onChange={e=>setSettings(current=>({...current,limits:e.target.checked?[...current.limits,label]:
              current.limits.filter(x=>x!==label)}))}/>
          {label.replaceAll("-"," ")}</label>)}</div>
        <label className="check-label"><input type="checkbox" checked={settings.shareLimits}
          onChange={e=>setSettings({...settings,shareLimits:e.target.checked})}/>Share selected limits with this partner</label>
        <label className="check-label"><input type="checkbox" checked={settings.aiOptIn}
          onChange={e=>setSettings({...settings,aiOptIn:e.target.checked})}/>Allow optional read-only AI creative suggestions</label>
        <label>PRIVATE AFTERCARE / COMFORT NOTES<textarea rows={3} maxLength={500}
          value={settings.aftercare} onChange={e=>setSettings({...settings,aftercare:e.target.value})}/></label>
        <button className="btn btn-red" disabled={working}>Save safety settings</button>
        <p className="muted">These settings are recorded separately for each participant and never authorize deductions or physical restrictions.</p>
      </form>
      <div className="dash-card ops-stack"><h3>Stop and consent check-in</h3>
        <button className="btn btn-danger-soft" disabled={!canPlay||working}
          onClick={()=>void emergencyStop()}>STOP SCENE IMMEDIATELY</button>
        <p className="muted">Stops current scene play and timers immediately. No points or fictional debt penalties; the Sub alone may choose to resume using the existing scene controls.</p>
        <button className="btn btn-outline" disabled={working||!canPlay}
          onClick={()=>void act({action:"checkin"})}>I consent to continue</button>
        {currentSafety?.last_checkin&&<small>Last personal check-in: {fmt(currentSafety.last_checkin)}</small>}
        {currentSafety?.last_checkin&&Date.now()-new Date(currentSafety.last_checkin).getTime()>14*86400000&&
          <p className="ops-note">Your last check-in was more than 14 days ago. Review whether this scene still feels right.</p>}
        <h4>Shared partner boundaries</h4>
        {data?.partnerLimits?.length?<p>{data.partnerLimits.join(" · ").replaceAll("-"," ")}</p>:
          <p className="muted">Your partner has not shared any optional boundaries.</p>}
        <h4>Recent consent events</h4>
        {(data?.history||[]).map((x:{action:string;created_at:string},i:number)=>
          <small key={i}>{x.action} · {fmt(x.created_at)}</small>)}
      </div>
    </div>}

    {tab==="insights"&&<div className="ops-split">
      <div className="dash-card"><div className="section-title"><h2>Scene activity heatmap</h2>
        <button className="btn btn-outline" disabled={!annual.length} onClick={exportAnalytics}>Export CSV</button></div>
        <p className="muted">91 days of recorded actions across the contract ledger, story choices, submitted tasks, games and rewards. No chat content or proof images are exported.</p>
        <div className="scene-heatmap" role="img" aria-label="Scene activity by day for the past 91 days">
          {chart.map(day=><span key={day.iso} title={day.iso+": "+day.count+" actions"}
            className={"scene-heat-"+Math.min(4,day.count===0?0:Math.ceil(Math.log2(day.count+1)))}/>)}
        </div><small>Less activity · More activity</small>
      </div>
      <div className="dash-card"><h3>Activity categories</h3>
        {!data?.counts?.length?<p className="muted">No events recorded yet.</p>:
          (data.counts as {event_type:string;total:number}[]).map(row=>
            <div className="ops-item-head" key={row.event_type}><span>{row.event_type.replaceAll("."," · ")}</span>
              <strong>{row.total}</strong></div>)}
        <h4>Task outcomes</h4>
        {(data?.tasks||[]).map((row:{status:string;total:number})=>
          <div className="ops-item-head" key={row.status}><span>{row.status}</span><b>{row.total}</b></div>)}
      </div>
    </div>}

    {tab==="interests"&&<div className="ops-split">
      <div className="dash-card ops-stack"><h3>Preset interest compatibility</h3>
        <p className="muted">Choose existing labels only. The public toggle controls whether partners can see each interest level; everything else remains private.</p>
        <label>ADD AN INTEREST<select value={newInterest} onChange={e=>setNewInterest(e.target.value)}>
          {interestGroups.map(group=><optgroup key={group.name} label={group.name}>
            {group.labels.map(item=><option key={item} value={item}>{item}</option>)}</optgroup>)}
        </select></label>
        <button className="btn btn-outline" disabled={interests.length>=24||interests.some(x=>x.interest===newInterest)}
          onClick={()=>setInterests(previous=>[...previous,{interest:newInterest,level:2,public:false}])}>Add selected label</button>
        {interests.map(item=><div className="scene-interest-row" key={item.interest}>
          <strong>{item.interest}</strong><select aria-label={item.interest+" interest level"} value={item.level}
            onChange={e=>setInterests(items=>items.map(x=>x.interest===item.interest?{...x,level:Number(e.target.value)}:x))}>
            <option value={0}>Hard limit</option><option value={1}>Not interested</option>
            <option value={2}>Curious</option><option value={3}>Enjoy</option><option value={4}>Favorite</option>
          </select>
          <label className="check-label"><input type="checkbox" checked={item.public}
            onChange={e=>setInterests(items=>items.map(x=>x.interest===item.interest?{...x,public:e.target.checked}:x))}/>Share</label>
          <button className="btn btn-quiet" onClick={()=>setInterests(items=>items.filter(x=>x.interest!==item.interest))}>Remove</button>
        </div>)}
        <button className="btn btn-red" disabled={working} onClick={()=>void act({action:"interest-save",items:interests})}>Save my interests</button>
      </div>
      <div className="dash-card"><h3>Partner's shared interest levels</h3>
        {!data?.partner?.length?<p className="muted">No interest levels have been made visible to you.</p>:
          (data.partner as Interest[]).map(item=><div className="ops-item-head" key={item.interest}>
            <span>{item.interest}</span><b>{["Hard limit","No","Curious","Enjoy","Favorite"][item.level]}</b>
          </div>)}
      </div>
    </div>}

    {tab==="ai"&&<div className="ops-split">
      <form className="dash-card form-stack" onSubmit={e=>void askAI(e)}>
        <span className="eyebrow">EXPLICIT OPT-IN · READ-ONLY</span><h3>Optional creative game master</h3>
        <p className="muted">Only the text you write in the prompt is sent to the configured AI provider. Existing private chats, proofs, partner limits and contract balances are not sent.</p>
        <label>IDEA TYPE<select value={aiKind} onChange={e=>setAiKind(e.target.value as typeof aiKind)}>
          <option value="story">Story plot</option><option value="task">Voluntary task idea</option>
          <option value="creative-prompt">Game or writing prompt</option></select></label>
        <label>YOUR PROMPT<textarea required minLength={12} maxLength={800} rows={4}
          value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)}
          placeholder="A mystery in a moonlit library with cooperative choices…"/></label>
        <button className="btn btn-red" disabled={working||!canPlay||!settings.aiOptIn||!aiAvailable}>
          Generate suggestion</button>
        {aiAvailable===false&&<p className="muted">The administrator has not configured an AI provider.</p>}
        {!settings.aiOptIn&&<p className="muted">Enable AI assistance in Consent & safety first.</p>}
      </form>
      <div className="dash-card"><h3>Creative suggestion</h3>
        {!suggestion?<p className="muted">No suggestion generated yet. AI cannot create contracts, assign tasks, change debt, or accept consent.</p>:
          <><p className="scene-ai-output">{suggestion}</p><button className="btn btn-outline" onClick={()=>
            navigator.clipboard.writeText(suggestion).catch(()=>notifyRef.current("error","Could not copy suggestion"))}>Copy for editing</button></>}
        <hr/><h4>Mobile and offline use</h4>
        <p className="muted">Install this site as a PWA to access the offline landing screen and save explicitly opted-in local story drafts. New financial actions and approvals always require an online connection.</p>
        {installPrompt&&<button className="btn btn-outline" onClick={async()=>{
          await installPrompt.prompt();setInstallPrompt(null)
        }}>Install app on this device</button>}
      </div>
    </div>}
  </section>
}
