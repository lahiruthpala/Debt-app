"use client"
import {useEffect,useMemo,useState} from "react"
import type {ContractModule} from "@/lib/contract-rules"
import {ProofUploader} from "./proof-center"

type Feedback=(type:"pending"|"success"|"error",message:string)=>void
type BoundaryStatus={
  module_id:string;locked_since:string|null;permission_status:"restricted"|"limited"|"allowed"|null;
  release_last_at:string|null
}
type BoundaryRequest={
  id:string;module_id:string;kind:"unlock"|"release"|"inspection";
  status:"pending"|"approved"|"declined"|"completed";note:string;response:string;
  created_at:string;requester_handle:string
}
type JournalEntry={
  id:string;module_id:string;body:string;reply:string|null;created_at:string;author_handle:string
}
type BoundaryData={status:string;state:BoundaryStatus[];requests:BoundaryRequest[];entries:JournalEntry[]}
const message=(error:unknown)=>error instanceof Error?error.message:"Unable to complete action"
const daysSince=(value:string|null):string=>value?
  String(Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/86400000))):"—"
const dayNames=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]

export default function BoundaryPlay({sceneId,sceneStatus,modules,role,onNotify,onChanged}:{
  sceneId:string;sceneStatus:string;modules:ContractModule[];role:"dom"|"sub";onNotify:Feedback;onChanged:()=>Promise<void>
}){
  const [data,setData]=useState<BoundaryData|null>(null)
  const [working,setWorking]=useState(false)
  const [note,setNote]=useState("")
  const [journalText,setJournalText]=useState("")
  const [replies,setReplies]=useState<Record<string,string>>({})
  const [statuses,setStatuses]=useState<Record<string,"restricted"|"limited"|"allowed">>({})
  const [requestResponses,setRequestResponses]=useState<Record<string,string>>({})
  const available=useMemo(()=>modules.filter(m=>["lock","permission","journal","calendar"].includes(m.type)),[modules])
  async function reload(){
    if(!sceneId)return
    const response=await fetch("/api/contract-boundaries?"+new URLSearchParams({sceneId}),{cache:"no-store"})
    const body=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(body.error||"Cannot load private contract status")
    setData(body)
  }
  useEffect(()=>{
    setData(null)
    if(!sceneId||!available.length)return
    let live=true
    fetch("/api/contract-boundaries?"+new URLSearchParams({sceneId}),{cache:"no-store"})
      .then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error||"Could not load");return body})
      .then(body=>{if(live)setData(body)})
      .catch(error=>{if(live)onNotify("error",message(error))})
    return ()=>{live=false}
  },[sceneId,sceneStatus,available.length])
  async function perform(payload:Record<string,unknown>){
    if(working)return
    setWorking(true);onNotify("pending","Updating private contract agreement…")
    try{
      const response=await fetch("/api/contract-boundaries",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({...payload,sceneId})
      })
      const body=await response.json().catch(()=>({}))
      if(!response.ok)throw new Error(body.error||"Could not update status")
      await Promise.all([reload(),onChanged()])
      onNotify("success",body.message||"Status updated")
      setNote("")
      if(payload.action==="journal")setJournalText("")
    }catch(error){onNotify("error",message(error))}
    finally{setWorking(false)}
  }
  if(!available.length)return null
  const active=sceneStatus==="active"
  const entryRows=data?.entries??[]
  const requestRows=data?.requests??[]
  return <section className="boundary-section" aria-label="Private contract controls">
    <header className="boundary-hero">
      <div><span className="eyebrow">PRIVATE · PARTNER-APPROVED EXTENSIONS</span>
        <h2>Trust is the only binding rule.</h2>
        <p>Track agreed statuses, private requests and creative journals. These are self-reported fictional agreement tools, not physical enforcement.</p>
      </div>
      <div className="boundary-consent"><span>◈</span><strong>Consent stays active</strong>
        <small>Either partner can pause or end the contract. No exit or withdrawal penalties.</small>
        {role==="sub"&&<button className="btn btn-quiet" disabled={working} onClick={()=>{
          if(window.confirm("Erase all your private counter data, journal entries and requests from this contract? This cannot be undone.")){
            void perform({action:"erase_private_data"})
          }
        }}>Erase my private data</button>}</div>
    </header>
    {available.map(module=>{
      const state=data?.state.find(s=>s.module_id===module.id)
      const requests=requestRows.filter(r=>r.module_id===module.id)
      const isLock=module.type==="lock"
      const isPermission=module.type==="permission"
      const isJournal=module.type==="journal"
      const isCalendar=module.type==="calendar"
      return <article key={module.id} className={"boundary-card boundary-"+module.type}>
        <header className="boundary-card-title">
          <div className="boundary-emblem" aria-hidden="true">{isLock?"♢":isPermission?"◈":isJournal?"✒":"▦"}</div>
          <div><span className="eyebrow">{isLock?"01 · LOCK STATUS":isPermission?"02 · PERSONAL PERMISSION":isJournal?"03 · PRIVATE JOURNAL":"04 · RESTRICTION CALENDAR"}</span><h3>{module.name}</h3></div>
          <span className={"boundary-state-pill "+(!active?"is-paused":"")}>{sceneStatus.toUpperCase()}</span>
        </header>
        {isLock&&<div className="boundary-content">
          <div className="boundary-metrics">
            <div><small>REPORTED LOCK STATE</small><strong>{state?.locked_since?"Locked":"Not locked"}</strong></div>
            <div><small>DAYS REPORTED</small><strong>{daysSince(state?.locked_since||null)}</strong></div>
            <div><small>PLANNED DURATION</small><strong>{module.suggestedDays} days</strong></div>
          </div>
          <p className="boundary-description">Keyholder label: <b>{module.keyholderLabel}</b>. An optional text check-in may be requested every {module.checkinHours} hours. No photo, location or device access is required.</p>
          {role==="sub"&&<div className="boundary-actions">
            <button className="btn btn-outline" disabled={!active||working} onClick={()=>void perform({action:"set_lock",moduleId:module.id,locked:!state?.locked_since})}>
              {state?.locked_since?"Mark unlocked":"Mark locked"}
            </button>
            <button className="btn btn-red" disabled={!active||working} onClick={()=>void perform({action:"request_unlock",moduleId:module.id,note})}>Request unlock review</button>
          </div>}
          {role==="dom"&&<button className="btn btn-outline" disabled={!active||working} onClick={()=>void perform({action:"request_inspection",moduleId:module.id,note})}>Request private text check-in</button>}
          {role==="sub"&&active&&Boolean(state?.locked_since)&&<div className="proof-inline">
            <p className="boundary-footnote">You may optionally send a non-explicit lock-status image for partner verification. This never controls unlocking or ending the contract.</p>
            <ProofUploader sceneId={sceneId} kind="lock" moduleId={module.id}
              onNotify={onNotify} onUploaded={async()=>{await reload();await onChanged()}}/>
          </div>}
          <p className="boundary-footnote">Self-reported status is voluntary. You can unlock or stop participation without permission or a debt charge.</p>
        </div>}
        {isPermission&&<div className="boundary-content">
          <div className="boundary-metrics">
            <div><small>CURRENT STATUS</small><strong>{(state?.permission_status||module.initialStatus).toUpperCase()}</strong></div>
            <div><small>DAYS SINCE LAST SELF-REPORT</small><strong>{daysSince(state?.release_last_at||null)}</strong></div>
            <div><small>REMINDER INTERVAL</small><strong>{module.reminderHours}h</strong></div>
          </div>
          {role==="dom"&&<div className="boundary-actions">
            <label className="boundary-select-label">PERMISSION STATUS
              <select aria-label="Agreement permission" value={statuses[module.id]||state?.permission_status||module.initialStatus}
                onChange={e=>setStatuses({...statuses,[module.id]:e.target.value as "restricted"|"limited"|"allowed"})}>
                <option value="restricted">Restricted</option><option value="limited">Limited</option><option value="allowed">Allowed</option>
              </select>
            </label>
            <button className="btn btn-red" disabled={!active||working} onClick={()=>void perform({
              action:"set_permission",moduleId:module.id,status:statuses[module.id]||state?.permission_status||module.initialStatus
            })}>Update permission</button>
          </div>}
          {role==="sub"&&<div className="boundary-actions">
            <button className="btn btn-red" disabled={!active||working} onClick={()=>void perform({action:"request_release",moduleId:module.id,note})}>Request permission review</button>
            <button className="btn btn-outline" disabled={!active||working} onClick={()=>void perform({action:"record_release",moduleId:module.id})}>Record personal counter</button>
            <button className="btn btn-quiet" disabled={!active||working} onClick={()=>void perform({action:"record_release",moduleId:module.id,clear:true})}>Clear counter</button>
          </div>}
          <p className="boundary-footnote">Self-reported, private and optional. No background penalties accumulate from time spent in a restricted status.</p>
        </div>}
        {(isLock||isPermission)&&<>
          <label className="boundary-note">OPTIONAL REQUEST NOTE
            <input maxLength={500} value={note} onChange={e=>setNote(e.target.value)}
              placeholder="Add context for your partner (optional)"/>
          </label>
          {requests.length>0&&<div className="boundary-requests">
            <h4>Requests & decisions</h4>
            {requests.slice(0,12).map(request=><div key={request.id} className="boundary-request">
              <div><strong>{request.kind.replace("_"," ")} · {request.status}</strong>
                <small>by @{request.requester_handle} · {new Date(request.created_at).toLocaleString("en-GB")}</small>
                {request.note&&<p>{request.note}</p>}{request.response&&<p>Reply: {request.response}</p>}
              </div>
              {request.status==="pending"&&role==="dom"&&request.kind!=="inspection"&&
                <div className="boundary-review">
                  <input aria-label={"Reply to "+request.id} maxLength={500} placeholder="Optional response"
                    value={requestResponses[request.id]||""} onChange={e=>setRequestResponses({...requestResponses,[request.id]:e.target.value})}/>
                  <button className="btn btn-red" disabled={!active||working} onClick={()=>void perform({
                    action:"review_request",requestId:request.id,approve:true,response:requestResponses[request.id]||""
                  })}>Approve</button>
                  <button className="btn btn-outline" disabled={!active||working} onClick={()=>void perform({
                    action:"review_request",requestId:request.id,approve:false,response:requestResponses[request.id]||""
                  })}>Decline</button>
                </div>}
              {request.status==="pending"&&role==="sub"&&request.kind==="inspection"&&
                <div className="boundary-review">
                  <input aria-label={"Inspection response "+request.id} maxLength={500}
                    placeholder="Text update (no photos)" value={requestResponses[request.id]||""}
                    onChange={e=>setRequestResponses({...requestResponses,[request.id]:e.target.value})}/>
                  <button className="btn btn-red" disabled={!active||working} onClick={()=>void perform({
                    action:"respond_inspection",requestId:request.id,completed:true,response:requestResponses[request.id]||""
                  })}>Acknowledge</button>
                  <button className="btn btn-quiet" disabled={!active||working} onClick={()=>void perform({
                    action:"respond_inspection",requestId:request.id,completed:false,response:"Not participating"
                  })}>Decline</button>
                </div>}
            </div>)}
          </div>}
        </>}
        {isJournal&&<div className="boundary-content">
          <p className="boundary-description">{module.prompt} — only members of this connection can read these entries. No automatic scoring.</p>
          {role==="sub"&&<div className="boundary-journal-form">
            <textarea aria-label="Private reflection" rows={3} maxLength={1000} value={journalText}
              onChange={e=>setJournalText(e.target.value)} placeholder="Write a private reflection for your partner…"/>
            <button className="btn btn-red" disabled={!active||working||!journalText.trim()}
              onClick={()=>void perform({action:"journal",moduleId:module.id,text:journalText})}>Share private entry</button>
          </div>}
          <div className="boundary-entries">
            {entryRows.filter(e=>e.module_id===module.id).length===0&&<p className="muted">No entries yet.</p>}
            {entryRows.filter(e=>e.module_id===module.id).map(entry=><div className="boundary-entry" key={entry.id}>
              <small>@{entry.author_handle} · {new Date(entry.created_at).toLocaleString("en-GB")}</small>
              <p>{entry.body}</p>{entry.reply&&<blockquote>Partner reply: {entry.reply}</blockquote>}
              {role==="sub"&&<button className="btn btn-quiet" disabled={working} onClick={()=>{
                if(window.confirm("Delete this private journal entry?"))void perform({action:"delete_journal",entryId:entry.id})
              }}>Delete my entry</button>}
              {!entry.reply&&role==="dom"&&<div className="boundary-review">
                <input aria-label={"Journal reply "+entry.id} value={replies[entry.id]||""}
                  onChange={e=>setReplies({...replies,[entry.id]:e.target.value})}
                  maxLength={700} placeholder="Private response"/>
                <button className="btn btn-outline" disabled={!active||working||!replies[entry.id]?.trim()}
                  onClick={()=>void perform({action:"reply_journal",entryId:entry.id,reply:replies[entry.id]})}>Reply</button>
              </div>}
            </div>)}
          </div>
        </div>}
        {isCalendar&&<div className="boundary-content">
          <p className="boundary-description">Agreed reminder windows are displayed here, not enforced with device restrictions or automatic charges.</p>
          <div className="boundary-calendar">{module.days.map(day=><span key={day}>{dayNames[day]}</span>)}</div>
          <div className="boundary-metrics"><div><small>LOCAL TIME WINDOW</small><strong>{String(module.startHour).padStart(2,"0")}:00–{String(module.endHour).padStart(2,"0")}:00</strong></div></div>
        </div>}
      </article>
    })}
  </section>
}
