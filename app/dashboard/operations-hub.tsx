"use client"

import {useCallback,useEffect,useRef,useState} from "react"
import {ProofUploader} from "./proof-center"

type Role="dom"|"sub"
type Notify=(type:"pending"|"success"|"error",message:string)=>void
export type OpsScene={id:string;status:string;connection_state:string;other_handle:string;
  principal:number;interest:number;penalties:number;monthly_rate:number;weekly_target:number;late_fee:number}
type PointBalance={user_id:string;handle:string;balance:number}
type Ritual={id:string;title:string;description:string;repeat_days:number[];local_hour:number;
  timezone:string;requires_proof:boolean;points:number;status:string;creator_handle:string}
type Occurrence={id:string;ritual_id:string;title:string;local_date:string;status:string;note:string;
  requires_proof:boolean;proof_id:string|null;proof_status:string|null;points:number}
type QueueItem={id:string;kind:"proof"|"claim"|"ritual";subtype:string;created_at:string;
  note:string;member_handle:string;scene_id:string}
type Reward={id:string;title:string;description:string;cost_points:number;active:boolean}
type Redemption={id:string;title:string;cost_points:number;requester_handle:string;status:string;created_at:string}
type Signer={handle:string;role:string;typed_name:string;acknowledged_at:string}
type ScenarioWeek={week:number;principal:number;interest:number;penalties:number;
  total:number;simulatedInterest:number;simulatedLateFee:number;credited:number}
const weekDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
const money=(n:number)=>"LKR "+Number(n||0).toLocaleString("en-US")
const stamp=(value:string)=>new Date(value).toLocaleString("en-GB",{dateStyle:"medium",timeStyle:"short"})
const errorText=(error:unknown)=>error instanceof Error?error.message:"Request failed"
async function requestOps(view:string,params:Record<string,string>={}){
  const response=await fetch("/api/operations?"+new URLSearchParams({view,...params}),{cache:"no-store"})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||"Cannot load operations")
  return data
}
async function changeOps(payload:Record<string,unknown>){
  const response=await fetch("/api/operations",{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||"Action failed")
  return data
}
async function changeOther(path:string,method:"POST"|"PATCH",payload:Record<string,unknown>){
  const response=await fetch(path,{method,headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||"Review failed")
  return data
}
const tabs=[
  ["dashboard","Activity & analytics"],["rituals","Rituals & schedules"],
  ["reviews","Review queue"],["rewards","Points & rewards"],["simulator","Contract simulator"],
  ["signatures","Agreement signing"],["maintenance","Administration"],
] as const
type Tab=typeof tabs[number][0]

export default function OperationsHub({scenes,selectedSceneId,role,meId,onNotify,onChanged}:{
  scenes:OpsScene[];selectedSceneId:string;role:Role;meId:string;onNotify:Notify;onChanged:()=>Promise<void>
}){
  const [tab,setTab]=useState<Tab>("dashboard")
  const [sceneId,setSceneId]=useState(selectedSceneId)
  const [data,setData]=useState<any>(null)
  const [loading,setLoading]=useState(false)
  const [busy,setBusy]=useState(false)
  const [selectedQueue,setSelectedQueue]=useState<string[]>([])
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({})
  const [failureRows,setFailureRows]=useState<string[]>([])
  const [ritualForm,setRitualForm]=useState({
    title:"Daily progress reflection",description:"Write a short progress update.",days:[0,1,2,3,4,5,6],
    hour:20,timezone:"UTC",requiresProof:false,points:20
  })
  const [ritualNotes,setRitualNotes]=useState<Record<string,string>>({})
  const [rewardForm,setRewardForm]=useState({title:"Choose the next story",description:"Pick the next collaborative adventure.",cost:50})
  const [weeks,setWeeks]=useState(12)
  const [extra,setExtra]=useState(0)
  const [interest,setInterest]=useState(false)
  const [lateWeek,setLateWeek]=useState(0)
  const [scenario,setScenario]=useState<ScenarioWeek[]>([])
  const [ack,setAck]=useState(false)
  const [signerName,setSignerName]=useState("")
  const [viewAdmin,setViewAdmin]=useState(false)
  const [cleanup,setCleanup]=useState<any>(null)
  const requestId=useRef(0)
  const activeScenes=scenes.filter(s=>s.status==="active"&&s.connection_state==="active")
  const scene=scenes.find(s=>s.id===sceneId)
  const playing=scene?.status==="active"&&scene?.connection_state==="active"
  const focusScene=sceneId?{sceneId}:{}
  const view=tab==="dashboard"?"overview":tab==="reviews"?"queue":
    tab==="simulator"?"forecast":tab==="signatures"?"signatures":tab==="maintenance"?"":tab

  useEffect(()=>{
    if(!scenes.some(s=>s.id===sceneId))setSceneId(
      scenes.find(s=>s.id===selectedSceneId)?.id||activeScenes[0]?.id||scenes[0]?.id||"")
  },[scenes,selectedSceneId,sceneId])
  useEffect(()=>{
    const timezone=Intl.DateTimeFormat().resolvedOptions().timeZone
    if(timezone)setRitualForm(previous=>({...previous,timezone}))
  },[])
  const load=useCallback(async()=>{
    if(tab==="maintenance")return
    if(tab!=="dashboard"&&!sceneId){setData(null);return}
    const sequence=++requestId.current
    setLoading(true)
    try{
      const response=await requestOps(view,view==="forecast"?
        {...focusScene,weeks:String(weeks),extra:String(extra),interest:String(interest),
        late:JSON.stringify(lateWeek?[lateWeek]:[])}:focusScene)
      if(sequence===requestId.current){
        if(view==="forecast")setScenario(response.weeks||[])
        else setData(response)
      }
    }catch(error){if(sequence===requestId.current)onNotify("error",errorText(error))}
    finally{if(sequence===requestId.current)setLoading(false)}
  },[tab,sceneId,view,weeks,extra,interest,lateWeek,onNotify])
  // Keep hooks unconditional; data requests are scoped to the selected view.
  useEffect(()=>{void load()},[load])

  async function act(payload:Record<string,unknown>,after?:()=>Promise<void>|void){
    if(busy)return
    setBusy(true);onNotify("pending","Processing your operations action…")
    try{
      const result=await changeOps({...payload,sceneId})
      await Promise.all([load(),onChanged()])
      await after?.()
      onNotify("success",result.message||"Updated")
      return true
    }catch(error){onNotify("error",errorText(error));return false}
    finally{setBusy(false)}
  }
  async function review(item:QueueItem,approve:boolean){
    const note=reviewNotes[item.id]||""
    if(!approve&&item.kind==="proof"&&note.trim().length<5)
      throw new Error("Provide at least five characters explaining a rejected proof")
    if(item.kind==="proof")return changeOther("/api/proofs","PATCH",{id:item.id,approve,note})
    if(item.kind==="claim")return changeOther("/api/contracts","POST",{
      action:"review",sceneId,claimId:item.id,approve
    })
    return changeOps({action:"ritual-review",sceneId,id:item.id,approve})
  }
  async function processQueue(approve:boolean,items:QueueItem[]){
    if(busy||!items.length)return
    setBusy(true);setFailureRows([]);onNotify("pending","Reviewing selected items…")
    let completed=0
    const failed:string[]=[]
    for(const item of items){
      try{await review(item,approve);completed++}
      catch(error){failed.push(item.kind+" "+item.id.slice(0,8)+": "+errorText(error))}
    }
    setFailureRows(failed)
    setSelectedQueue([])
    await Promise.all([load(),onChanged()])
    if(failed.length)onNotify("error",completed+" reviewed, "+failed.length+" failed. See review details.")
    else onNotify("success",completed+" item(s) reviewed")
    setBusy(false)
  }
  async function maintenance(dryRun:boolean){
    if(busy)return
    setBusy(true)
    try{
      const response=await fetch("/api/maintenance",{method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"cleanup-proofs",dryRun})})
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(result.error||"Maintenance failed")
      setCleanup(result);onNotify("success",dryRun?"Cleanup dry-run completed.":"Cleanup applied.")
    }catch(error){onNotify("error",errorText(error))}
    finally{setBusy(false)}
  }
  useEffect(()=>{
    fetch("/api/maintenance",{cache:"no-store"}).then(result=>{
      if(result.ok)setViewAdmin(true)
    }).catch(()=>{})
  },[])
  const queue:QueueItem[]=data?.queue||[]
  const occurrenceList:Occurrence[]=data?.occurrences||[]
  const balanceList:PointBalance[]=data?.balances||[]
  const ownBalance=balanceList.find(row=>row.user_id===meId)?.balance||0
  const activeQueue=queue.filter(item=>selectedQueue.includes(item.id))

  return <section className="ops-hub" aria-label="Engagement and operations">
    <div className="community-hero ops-hero"><div>
      <span className="eyebrow">SHARED STUDIO · CONSENT-FIRST OPERATIONS</span>
      <h2>Stay in sync with every scene.</h2>
      <p>Scheduled creative rituals, private approvals, reward points, fictional forecasts and voluntary signatures—together with the stories and game contracts you already use.</p>
    </div><span className="ops-hero-mark" aria-hidden="true">✦</span></div>
    <nav className="ops-tabs" aria-label="Engagement workspace sections">
      {tabs.filter(([id])=>id!=="maintenance"||viewAdmin).map(([id,name])=>
        <button type="button" key={id} className={tab===id?"chosen":""} onClick={()=>{setData(null);setTab(id)}}>{name}</button>)}
    </nav>
    {tab!=="dashboard"&&tab!=="maintenance"&&<label className="ops-scene-pick">
      ACTIVE SHARED SCENE
      <select value={sceneId} aria-label="Operations scene" onChange={e=>{setSceneId(e.target.value);setData(null)}}>
        {scenes.length===0&&<option value="">No scenes</option>}
        {scenes.map(s=><option key={s.id} value={s.id}>@{s.other_handle} · {s.status}</option>)}
      </select>
    </label>}
    {tab!=="maintenance"&&tab!=="dashboard"&&!playing&&
      <p className="ops-note">An active, mutually approved scene is required for new submissions. Paused scenes keep their records but cannot process new actions.</p>}
    {loading&&<p className="ops-loading" role="status">Loading {tab}…</p>}

    {tab==="dashboard"&&data&&<div className="ops-stack">
      <div className="ops-stats">
        {[
          ["Active scenes",data.scenes?.find((s:{status:string})=>s.status==="active")?.total||0],
          ["Shared stories played",data.games||0],
          ["Pending evidence",data.pendingProofs||0],
          ["Recurring rituals",data.activeRituals||0],
          ["Your earned points",data.points||0],
        ].map(([label,value])=><div className="dash-card ops-stat" key={String(label)}>
          <span>{label}</span><strong>{Number(value).toLocaleString()}</strong>
        </div>)}
      </div>
      <div className="dash-card">
        <div className="section-title"><h2>Fictional ledger activity</h2><span>PAST 30 DAYS</span></div>
        <p className="muted">Recorded events across your mutual scenes. This is activity history, not real-world spending or money owed.</p>
        <div className="ops-bar-chart" role="img" aria-label="Daily logged fictional ledger actions">
          {data.activity?.length?data.activity.map((item:{day:string;actions:number;net:number})=>{
            const maximum=Math.max(1,...data.activity.map((x:{actions:number})=>x.actions))
            return <div className="ops-bar-column" key={item.day} title={item.day+": "+item.actions+" actions"}>
              <span style={{height:(12+item.actions/maximum*90)+"%"}}/><small>{item.day.slice(5)}</small>
            </div>
          }):<div className="empty-inner">No ledger actions recorded in the past 30 days.</div>}
        </div>
      </div>
      <div className="dash-card"><h3>How points work</h3>
        <p className="muted">Verified tasks, approved challenges and proofs, completed stories and approved rituals earn separate game points. Points never increase or decrease debt, and cannot be exchanged for money.</p>
      </div>
    </div>}

    {tab==="rituals"&&<div className="ops-split">
      <div className="ops-stack">
        {role==="dom"&&<form className="dash-card form-stack" onSubmit={e=>{e.preventDefault();void act({action:"ritual-create",...ritualForm})}}>
          <span className="eyebrow">PROPOSE A VOLUNTARY SCHEDULE</span><h3>New recurring ritual</h3>
          <label>TITLE<input required minLength={3} maxLength={100} value={ritualForm.title} onChange={e=>setRitualForm({...ritualForm,title:e.target.value})}/></label>
          <label>DESCRIPTION<textarea rows={3} maxLength={600} value={ritualForm.description} onChange={e=>setRitualForm({...ritualForm,description:e.target.value})}/></label>
          <div className="ops-day-pick" aria-label="Scheduled weekdays">
            {weekDays.map((name,day)=><label key={name}><input type="checkbox" checked={ritualForm.days.includes(day)} onChange={e=>
              setRitualForm({...ritualForm,days:e.target.checked?[...ritualForm.days,day].sort():ritualForm.days.filter(x=>x!==day)})}/>{name}</label>)}
          </div>
          <div className="form-grid">
            <label>LOCAL DUE HOUR (0–23)<input type="number" min={0} max={23} value={ritualForm.hour}
              onChange={e=>setRitualForm({...ritualForm,hour:Number(e.target.value)})}/></label>
            <label>IANA TIMEZONE<input value={ritualForm.timezone} maxLength={64}
              onChange={e=>setRitualForm({...ritualForm,timezone:e.target.value})}/></label>
            <label>POINTS WHEN APPROVED<input type="number" min={0} max={100} value={ritualForm.points}
              onChange={e=>setRitualForm({...ritualForm,points:Number(e.target.value)})}/></label>
          </div>
          <label className="check-label"><input type="checkbox" checked={ritualForm.requiresProof}
            onChange={e=>setRitualForm({...ritualForm,requiresProof:e.target.checked})}/><span>Optional non-explicit photo proof required for completion</span></label>
          <button className="btn btn-red" type="submit" disabled={busy||!playing||!ritualForm.days.length}>Propose schedule</button>
          <p className="contract-hint">The Sub must consent to the schedule. Missed rituals never trigger debt charges or restrict exit.</p>
        </form>}
        <div className="dash-card"><div className="section-title"><h2>Agreed schedules</h2>
          <button className="btn btn-quiet" onClick={()=>void load()}>↻ Refresh</button></div>
          {!data?.rituals?.length?<p className="muted">No scheduled rituals yet.</p>:
            (data.rituals as Ritual[]).map(ritual=><article className="ops-item" key={ritual.id}>
              <div className="ops-item-head"><strong>{ritual.title}</strong><span className={"status status-"+ritual.status}>{ritual.status}</span></div>
              <p>{ritual.description}</p><small>{ritual.repeat_days.map(d=>weekDays[d]).join(", ")} · {String(ritual.local_hour).padStart(2,"0")}:00 {ritual.timezone} · {ritual.points} points</small>
              {ritual.requires_proof&&<small> · Private photo proof required</small>}
              <div className="person-actions">
                {role==="sub"&&ritual.status==="proposed"&&<>
                  <button className="btn btn-red" disabled={busy||!playing} onClick={()=>void act({action:"ritual-decision",id:ritual.id,decision:"active"})}>Accept</button>
                  <button className="btn btn-outline" disabled={busy||!playing} onClick={()=>void act({action:"ritual-decision",id:ritual.id,decision:"declined"})}>Decline</button>
                </>}
                {ritual.status==="active"&&<button className="btn btn-quiet" disabled={busy||!playing} onClick={()=>void act({action:"ritual-pause",id:ritual.id})}>Pause ritual</button>}
                {role==="sub"&&ritual.status==="paused"&&<button className="btn btn-outline" disabled={busy||!playing} onClick={()=>void act({action:"ritual-resume",id:ritual.id})}>Resume voluntarily</button>}
              </div>
            </article>)}
        </div>
      </div>
      <div className="dash-card">
        <h3>Scheduled occurrences</h3><p className="muted">Today's tasks appear on their scheduled local day. Review is required to earn points.</p>
        {!occurrenceList.length?<p className="muted">No occurrences generated yet. New ones appear on scheduled days.</p>:
          occurrenceList.map(item=><article key={item.id} className="ops-item">
            <div className="ops-item-head"><strong>{item.title}</strong><span className={"status status-"+item.status}>{item.status}</span></div>
            <small>{String(item.local_date).slice(0,10)} · {item.points} points</small>
            {item.note&&<p>{item.note}</p>}
            {role==="sub"&&item.status==="pending"&&<div className="ops-stack">
              {item.requires_proof&&<ProofUploader sceneId={sceneId} kind="ritual"
                ritualOccurrenceId={item.id} onNotify={onNotify} onUploaded={load}/>}
              <label>OPTIONAL COMPLETION NOTE<textarea value={ritualNotes[item.id]||""} rows={2} maxLength={500}
                onChange={e=>setRitualNotes({...ritualNotes,[item.id]:e.target.value})}/></label>
              <button className="btn btn-red" disabled={busy||!playing||(item.requires_proof&&!item.proof_id)}
                onClick={()=>void act({action:"ritual-submit",id:item.id,note:ritualNotes[item.id]||""})}>Submit completion</button>
            </div>}
            {item.proof_id&&<small>Evidence: {item.proof_status} · Review privately in Proof Center</small>}
            {role==="dom"&&item.status==="submitted"&&<div className="person-actions">
              <button className="btn btn-red" disabled={busy||!playing||(item.requires_proof&&item.proof_status!=="approved")}
                onClick={()=>void act({action:"ritual-review",id:item.id,approve:true})}>Approve</button>
              <button className="btn btn-quiet" disabled={busy||!playing}
                onClick={()=>void act({action:"ritual-review",id:item.id,approve:false})}>Reject</button>
            </div>}
          </article>)}
      </div>
    </div>}

    {tab==="reviews"&&<div className="dash-card ops-stack">
      <div className="section-title"><h2>Unified review queue</h2><button className="btn btn-quiet" onClick={()=>void load()}>↻ Refresh</button></div>
      {role!=="dom"?<p className="muted">Your connected Dom can review pending submissions. Check Rituals and Proof Center for individual statuses.</p>:<>
        <p className="muted">Reviews share the same authorization and financial caps as their original contract and proof flows.</p>
        <div className="ops-review-controls">
          <button className="btn btn-outline" disabled={busy||!activeQueue.length||!playing}
            onClick={()=>void processQueue(true,activeQueue)}>Approve selected ({activeQueue.length})</button>
          <button className="btn btn-danger-soft" disabled={busy||!activeQueue.length||!playing}
            onClick={()=>{if(window.confirm("Reject selected submissions? Proofs require individual reasons."))void processQueue(false,activeQueue)}}>Reject selected</button>
        </div>
        {failureRows.map((error,i)=><p className="ops-error" key={i}>{error}</p>)}
        {!queue.length?<p className="muted">No pending approvals in this scene.</p>:
          queue.map(item=><article key={item.id} className="ops-review-row">
            <input type="checkbox" aria-label={"Select "+item.kind+" "+item.id.slice(0,8)}
              checked={selectedQueue.includes(item.id)}
              onChange={e=>setSelectedQueue(current=>e.target.checked?[...current,item.id]:current.filter(x=>x!==item.id))}/>
            <div><strong>{item.subtype} · @{item.member_handle}</strong><small>{stamp(item.created_at)} · {item.kind}</small>
              {item.note&&<p>{item.note}</p>}
              {item.kind==="proof"&&<a href={"/api/proofs?view=image&id="+item.id} target="_blank" rel="noopener noreferrer">Open private evidence (images only)</a>}
              <input aria-label={"Review note "+item.id.slice(0,8)} placeholder="Rejection reason (for proofs)"
                maxLength={500} value={reviewNotes[item.id]||""}
                onChange={e=>setReviewNotes({...reviewNotes,[item.id]:e.target.value})}/>
            </div>
            <div className="person-actions"><button className="btn btn-red" disabled={busy||!playing}
              onClick={()=>void processQueue(true,[item])}>Approve</button>
              <button className="btn btn-quiet" disabled={busy||!playing}
                onClick={()=>void processQueue(false,[item])}>Reject</button></div>
          </article>)}
        <p className="ops-note">A rejected proof needs a reason. Rituals requiring proof must have their photo approved first. Bulk actions show individual failures rather than skipping validation.</p>
      </>}
    </div>}

    {tab==="rewards"&&<div className="ops-split">
      <div className="ops-stack">
        <div className="dash-card"><span className="eyebrow">SEPARATE GAME CURRENCY</span>
          <h3>Points balance</h3><strong className="ops-big-points">{ownBalance.toLocaleString()}</strong>
          <p className="muted">Earn from verified tasks, challenges, stories, proof reviews, and accepted rituals. Points never change the fictional ledger.</p>
          {balanceList.map(item=><div className="ops-item-head" key={item.user_id}><span>@{item.handle}</span><strong>{item.balance} pts</strong></div>)}
        </div>
        {role==="dom"&&<form className="dash-card form-stack" onSubmit={e=>{e.preventDefault();void act({action:"reward-create",...rewardForm})}}>
          <h3>Create a voluntary reward</h3>
          <label>TITLE<input required minLength={3} maxLength={100} value={rewardForm.title}
            onChange={e=>setRewardForm({...rewardForm,title:e.target.value})}/></label>
          <label>DESCRIPTION<textarea maxLength={400} rows={2} value={rewardForm.description}
            onChange={e=>setRewardForm({...rewardForm,description:e.target.value})}/></label>
          <label>POINT COST<input type="number" min={1} max={5000} value={rewardForm.cost}
            onChange={e=>setRewardForm({...rewardForm,cost:Number(e.target.value)})}/></label>
          <button className="btn btn-red" disabled={busy||!playing}>Add reward</button>
        </form>}
        <div className="dash-card"><h3>Reward catalog</h3>
          {!data?.options?.length?<p className="muted">No rewards have been defined.</p>:
            (data.options as Reward[]).map(option=><article className="ops-item" key={option.id}>
              <div className="ops-item-head"><strong>{option.title}</strong><b>{option.cost_points} pts</b></div>
              {option.description&&<p>{option.description}</p>}
              {role==="sub"?<button className="btn btn-outline" disabled={busy||!playing||!option.active||ownBalance<option.cost_points}
                onClick={()=>void act({action:"reward-redeem",id:option.id})}>{option.active?"Redeem points":"Unavailable"}</button>:
                <button className="btn btn-quiet" disabled={busy||!playing||!option.active}
                  onClick={()=>void act({action:"reward-retire",id:option.id})}>Retire reward</button>}
            </article>)}
        </div>
      </div>
      <div className="dash-card"><h3>Redemption history</h3>
        {!data?.redemptions?.length?<p className="muted">No redemption requests yet.</p>:
          (data.redemptions as Redemption[]).map(item=><article className="ops-item" key={item.id}>
            <div className="ops-item-head"><strong>{item.title}</strong><span className={"status status-"+item.status}>{item.status}</span></div>
            <small>@{item.requester_handle} · {item.cost_points} pts · {stamp(item.created_at)}</small>
            {role==="dom"&&item.status==="pending"&&<div className="person-actions">
              <button className="btn btn-red" disabled={busy||!playing} onClick={()=>void act({action:"reward-review",id:item.id,approve:true})}>Mark fulfilled</button>
              <button className="btn btn-quiet" disabled={busy||!playing} onClick={()=>void act({action:"reward-review",id:item.id,approve:false})}>Decline & refund</button>
            </div>}
          </article>)}
      </div>
    </div>}

    {tab==="simulator"&&<div className="dash-card ops-stack">
      <span className="eyebrow">HYPOTHETICAL ONLY · NEVER APPLIES CHARGES</span><h3>Fictional contract what-if calculator</h3>
      <p className="muted">Based on the current scene snapshot. Weekly target assumes a voluntary hypothetical credit. Manual interest and late fees are off by default, reflecting the app's explicit-action rules.</p>
      <div className="form-grid">
        <label>WEEKS<input type="number" min={1} max={52} value={weeks} onChange={e=>setWeeks(Number(e.target.value))}/></label>
        <label>EXTRA WEEKLY CREDIT (LKR)<input type="number" min={0} max={100000} value={extra} onChange={e=>setExtra(Number(e.target.value))}/></label>
        <label>HYPOTHETICAL LATE WEEK<input type="number" min={0} max={weeks} value={lateWeek} onChange={e=>setLateWeek(Number(e.target.value))}/></label>
      </div>
      <label className="check-label"><input type="checkbox" checked={interest} onChange={e=>setInterest(e.target.checked)}/>
        <span>Assume monthly interest is explicitly applied every 4 weeks (hypothetical)</span></label>
      <button className="btn btn-outline" disabled={loading||!sceneId} onClick={()=>void load()}>Recalculate projection</button>
      <div className="ops-scenario-bars" aria-label="Projected fictional balance by week">
        {scenario.map(x=><div key={x.week} title={"Week "+x.week+": "+money(x.total)}>
          <span style={{height:(x.total/Math.max(1,...scenario.map(p=>p.total))*100)+"%"}}/><small>{x.week}</small>
        </div>)}
      </div>
      <div className="ops-table-wrap"><table className="ops-table"><thead><tr><th>Week</th><th>Credits</th><th>Hypothetical interest</th><th>Hypothetical fee</th><th>Remaining</th></tr></thead>
        <tbody>{scenario.map(x=><tr key={x.week}><td>{x.week}</td><td>{money(x.credited)}</td><td>{money(x.simulatedInterest)}</td><td>{money(x.simulatedLateFee)}</td><td>{money(x.total)}</td></tr>)}</tbody>
      </table></div>
    </div>}

    {tab==="signatures"&&<div className="ops-split">
      <div className="dash-card ops-stack"><span className="eyebrow">OPTIONAL PERSONAL ACKNOWLEDGMENT</span>
        <h3>Review the mutually accepted agreement</h3>
        <p className="muted">The underlying contract acceptance is still controlled by the existing scene approval process. This additional record is voluntary and not a legal signature.</p>
        <div className="ops-clause"><b>01 · Fictional terms</b><p>Current starting terms and game modules were explicitly proposed and accepted. All ledger balances are fictional.</p></div>
        <div className="ops-clause"><b>02 · Real-world consent</b><p>Either participant may pause or end the scene at any time. No withdrawal of consent can create a penalty or block a real-world action.</p></div>
        <div className="ops-clause"><b>03 · Private records</b><p>Proofs, journals, rituals, game turns and reward events may be stored for this scene. Private proof files may be erased by their uploader.</p></div>
        <label className="check-label"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>
          <span>I read these terms and understand this is non-binding roleplay.</span></label>
        <label>TYPE YOUR ACKNOWLEDGMENT NAME<input minLength={3} maxLength={80} value={signerName}
          onChange={e=>setSignerName(e.target.value)} placeholder="Your chosen roleplay name"/></label>
        <button className="btn btn-red" disabled={busy||!playing||!ack||signerName.trim().length<3}
          onClick={()=>void act({action:"sign",typedName:signerName.trim(),acknowledged:true})}>Record my acknowledgment</button>
        {sceneId&&<a className="btn btn-outline" href={"/api/contracts/pdf?sceneId="+encodeURIComponent(sceneId)}>Download contract PDF</a>}
      </div>
      <div className="dash-card"><h3>Recorded acknowledgments</h3>
        {!data?.signatures?.length?<p className="muted">No optional acknowledgments yet.</p>:
          (data.signatures as Signer[]).map(row=><div className="ops-item" key={row.handle}>
            <div className="ops-item-head"><strong>@{row.handle}</strong><span>{row.role.toUpperCase()}</span></div>
            <p>{row.typed_name}</p><small>{stamp(row.acknowledged_at)}</small>
          </div>)}
        <p className="ops-note">This acknowledgment cannot replace consent, prevent ending a scene, or create a real payment obligation.</p>
      </div>
    </div>}

    {tab==="maintenance"&&viewAdmin&&<div className="ops-split">
      <div className="dash-card ops-stack"><h3>Private proof janitor</h3>
        <p className="muted">Check for storage objects with no database reference. A dry-run previews candidates. Deletion requires explicit administrative confirmation and a grace period.</p>
        <div className="person-actions">
          <button className="btn btn-outline" disabled={busy} onClick={()=>void maintenance(true)}>Preview cleanup</button>
          <button className="btn btn-danger-soft" disabled={busy} onClick={()=>{if(window.confirm("Delete orphaned private files older than 48 hours?"))void maintenance(false)}}>Delete verified orphans</button>
        </div>
        {cleanup&&<pre className="ops-audit-json">{JSON.stringify(cleanup,null,2)}</pre>}
      </div>
      <div className="dash-card"><h3>Administration & audit</h3>
        <p className="muted">Maintenance actions are permission-gated and audited. No administrative action may change fictional agreement terms or restrict a participant's ability to withdraw consent.</p>
      </div>
    </div>}
  </section>
}
