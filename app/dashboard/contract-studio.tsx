"use client"
import {useEffect,useState,type FormEvent} from "react"
import type {ContractDefinition,ContractModule} from "@/lib/contract-rules"

type Feedback=(type:"pending"|"success"|"error",message:string)=>void
type Connection={id:string;state:string;other_handle:string}
type Template=ContractDefinition & {id:string;author_id:string;author_handle:string;published:boolean}
type Scene={scene_id:string;connection_id:string;title_snapshot:string;description_snapshot:string;
 modules_snapshot:ContractModule[];status:string;connection_state:string;other_handle:string;
 principal:number;interest:number;penalties:number;start_principal:number}
type Action={id:string;module_id:string;action:string;delta:number;details:Record<string,unknown>;created_at:string;actor_handle:string}
type Claim={id:string;module_id:string;task_id:string;state:string;reward:number;requester_handle:string}
type Detail={scene:Scene & {id:string};actions:Action[];claims:Claim[]}
const id=()=>crypto.randomUUID()
const money=(n:number)=>"LKR "+Number(n||0).toLocaleString("en-US")
const starter=():ContractDefinition=>({
  title:"My custom debt challenge",
  description:"An agreed fictional ledger with chance games, challenges and rewards.",
  category:"Strategy",
  terms:{principal:250000,monthlyRate:0,weeklyTarget:15000,lateFee:0},
  modules:[
    {id:id(),type:"dice",name:"Debt Duel",sides:6,stake:500,cooldownHours:24},
    {id:id(),type:"wheel",name:"Fortune Wheel",cooldownHours:24,
      outcomes:[{label:"Credit 2,000",delta:-2000},{label:"Penalty 1,000",delta:1000},
      {label:"No change",delta:0},{label:"Credit 500",delta:-500}]}
  ]
})
const templates={
  dice:():ContractModule=>({id:id(),type:"dice",name:"Dice Duel",sides:6,stake:500,cooldownHours:24}),
  wheel:():ContractModule=>({id:id(),type:"wheel",name:"Fortune Wheel",cooldownHours:24,outcomes:
    [{label:"Lucky credit",delta:-2000},{label:"Extra penalty",delta:1000},{label:"No change",delta:0}]}),
  checkin:():ContractModule=>({id:id(),type:"checkin",name:"Daily Check-in",reward:1000,cooldownHours:24}),
  tasks:():ContractModule=>({id:id(),type:"tasks",name:"Verified Challenges",
    tasks:[{id:id(),label:"Create a plan for the shared fictional goal",reward:1000}]})
}
const icons={dice:"⚄",wheel:"✺",checkin:"◷",tasks:"☑"}
async function call(view:string,params:Record<string,string>={}){
  const res=await fetch("/api/contracts?"+new URLSearchParams({view,...params}),{cache:"no-store"})
  const data=await res.json().catch(()=>({}))
  if(!res.ok)throw Error(data.error||"Unable to load contracts")
  return data
}
async function submit(data:Record<string,unknown>,url="/api/contracts"){
  const res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)})
  const json=await res.json().catch(()=>({}))
  if(!res.ok)throw Error(json.error||"Unable to complete contract action")
  return json
}
const messageOf=(e:unknown)=>e instanceof Error?e.message:"Request failed"

export default function ContractStudio({connections,role,onNotify,onChanged}:{
 connections:Connection[];role:"dom"|"sub";onNotify:Feedback;onChanged:()=>Promise<void>
}){
  const [section,setSection]=useState<"builder"|"library"|"active">("builder")
  const [definition,setDefinition]=useState<ContractDefinition|null>(null)
  const [editing,setEditing]=useState<string|null>(null)
  const [library,setLibrary]=useState<Template[]>([])
  const [mine,setMine]=useState<Template[]>([])
  const [search,setSearch]=useState("")
  const [scenes,setScenes]=useState<Scene[]>([])
  const [sceneId,setSceneId]=useState("")
  const [detail,setDetail]=useState<Detail|null>(null)
  const [connectionId,setConnectionId]=useState("")
  const [busy,setBusy]=useState(false)
  const [lastOutcome,setLastOutcome]=useState<{moduleId:string;delta:number;details:Record<string,unknown>}|null>(null)
  const activeConnections=connections.filter(c=>c.state==="active")
  const current=scenes.find(s=>s.scene_id===sceneId)
  const configured=current?.modules_snapshot||[]
  const total=current?current.principal+current.interest+current.penalties:0
  const isPlayable=current?.status==="active" && current.connection_state==="active"
  const existing=detail?.scene.id===sceneId?detail:null

  useEffect(()=>{setDefinition(starter())},[])
  useEffect(()=>{if(activeConnections.length && !activeConnections.some(c=>c.id===connectionId))setConnectionId(activeConnections[0].id)},[connections,connectionId])
  useEffect(()=>{void loadTemplates();void loadScenes()},[])
  useEffect(()=>{if(sceneId)void loadDetails(sceneId);else setDetail(null)},[sceneId])

  async function loadTemplates(q=""){
    try{const result=await call("templates",{q});setLibrary(result.library);setMine(result.mine)}
    catch(e){onNotify("error",messageOf(e))}
  }
  async function loadScenes(){
    try{
      const data=await call("scenes")
      const next=data.scenes as Scene[]
      setScenes(next)
      setSceneId(previous=>next.some(x=>x.scene_id===previous)?previous:next.find(x=>x.status==="active")?.scene_id||next[0]?.scene_id||"")
    }catch(e){onNotify("error",messageOf(e))}
  }
  async function loadDetails(scene:string){
    try{setDetail(await call("scene",{id:scene}))}
    catch(e){onNotify("error",messageOf(e))}
  }
  async function doAction(payload:Record<string,unknown>,after?:(value:any)=>void){
    if(busy)return
    setBusy(true);onNotify("pending","Processing contract action…")
    try{
      const result=await submit(payload)
      if(after)after(result)
      await Promise.all([loadTemplates(search),loadScenes(),sceneId?loadDetails(sceneId):Promise.resolve()])
      await onChanged()
      onNotify("success",result.message||"Contract updated")
      return result
    }catch(e){onNotify("error",messageOf(e))}
    finally{setBusy(false)}
  }
  function updateModule(moduleId:string,patch:Partial<ContractModule>){
    setDefinition(current=>current?{...current,modules:current.modules.map(module=>module.id===moduleId?
      {...module,...patch} as ContractModule:module)}:current)
  }
  function updateTerms(name:keyof ContractDefinition["terms"],value:number){
    setDefinition(current=>current?{...current,terms:{...current.terms,[name]:value}}:current)
  }
  function chooseTemplate(t:Template,edit=false){
    setDefinition({title:t.title,description:t.description,category:t.category,terms:t.terms,
      modules:structuredClone(t.modules)})
    setEditing(edit?t.id:null)
    setSection("builder")
  }
  async function save(publish:boolean,propose=false){
    if(!definition)return
    const result=await doAction({action:"save",definition,publish,...(editing?{templateId:editing}:{})},
      value=>setEditing(value.id))
    if(result?.id && propose && connectionId){
      await doAction({action:"propose",connectionId,templateId:result.id},()=>{
        setSection("active");setLastOutcome(null)
      })
    }
  }
  async function play(moduleId:string){
    await doAction({action:"play",sceneId,moduleId},result=>{
      setLastOutcome({moduleId,delta:result.delta,details:result.details})
      void loadDetails(sceneId)
    })
  }
  async function decide(operation:"approve"|"pause"|"resume"|"end"){
    if(operation==="end"&&!window.confirm("Permanently end this fantasy contract? It cannot be resumed."))return
    if(busy)return
    setBusy(true);onNotify("pending","Updating contract consent…")
    try{
      const result=await submit({action:"scene",sceneId,operation},"/api/studio")
      await Promise.all([loadScenes(),loadDetails(sceneId),onChanged()])
      onNotify("success",result.message||"Consent updated")
    }catch(e){onNotify("error",messageOf(e))}
    finally{setBusy(false)}
  }
  const moduleHeading=(module:ContractModule)=>icons[module.type]+" "+module.name
  if(!definition)return <div className="dash-card">Opening contract workshop…</div>
  return <section className="contract-workshop" aria-label="Interactive debt contracts">
    <div className="contract-hero">
      <div><div className="eyebrow">INTERACTIVE CONTRACT WORKSHOP · NEW</div>
        <h2>Build a debt game that actually plays.</h2>
        <p>Choose your terms, combine configurable game modules, publish your design, and propose it to a partner. Every credit or penalty is calculated by the server in your agreed fictional ledger.</p>
      </div>
      <div className="contract-hero-glyph" aria-hidden="true">⚄<span>✺</span></div>
    </div>
    <div className="contract-tabs" role="group" aria-label="Debt contract views">
      <button className={section==="builder"?"chosen":""} onClick={()=>setSection("builder")}>◈ Contract builder</button>
      <button className={section==="library"?"chosen":""} onClick={()=>setSection("library")}>✦ Discover templates <small>{library.length}</small></button>
      <button className={section==="active"?"chosen":""} onClick={()=>{setSection("active");void loadScenes()}}>◉ My contracts <small>{scenes.length}</small></button>
    </div>

    {section==="builder" && <div className="contract-layout">
      <div className="dash-card contract-builder">
        <div className="eyebrow">01 / CONTRACT IDENTITY</div>
        <div className="form-grid">
          <label>CONTRACT NAME<input aria-label="Contract name" minLength={3} maxLength={80} value={definition.title}
            onChange={e=>setDefinition({...definition,title:e.target.value})}/></label>
          <label>CATEGORY<input aria-label="Contract category" minLength={3} maxLength={30} value={definition.category}
            onChange={e=>setDefinition({...definition,category:e.target.value})}/></label>
        </div>
        <label className="contract-label">DESCRIPTION<textarea aria-label="Contract description" rows={2} maxLength={320}
          value={definition.description} onChange={e=>setDefinition({...definition,description:e.target.value})}/></label>
        <div className="eyebrow contract-step">02 / FICTIONAL DEBT TERMS</div>
        <div className="form-grid">
          {([["principal","Starting balance (LKR)",1000000],["monthlyRate","Monthly interest (%)",30],
            ["weeklyTarget","Weekly target (LKR)",100000],["lateFee","Late fee (LKR)",10000]] as const)
            .map(([field,label,max])=><label key={field}>{label}<input type="number" aria-label={label} min={0} max={max}
              value={definition.terms[field]} onChange={e=>updateTerms(field,Number(e.target.value))}/></label>)}
        </div>
        <div className="eyebrow contract-step">03 / ADD INTERACTIVE GAME MODULES</div>
        <p className="muted">Combine up to eight independent modules. Configure your chances, rewards, penalties, and cooldowns.</p>
        <div className="module-palette">
          {(["dice","wheel","checkin","tasks"] as const).map(kind=><button type="button" key={kind}
            disabled={definition.modules.length>=8} onClick={()=>setDefinition({...definition,
              modules:[...definition.modules,templates[kind]()]})}>
            <span>{icons[kind]}</span><b>{kind==="dice"?"Dice duel":kind==="wheel"?"Fortune wheel":kind==="checkin"?"Check-ins":"Verified tasks"}</b><small>＋ Add</small>
          </button>)}
        </div>
        <div className="module-editor-list">{definition.modules.map((module,index)=><div key={module.id} className="module-editor">
          <div className="module-editor-top"><span className="module-number">{String(index+1).padStart(2,"0")}</span>
            <b>{icons[module.type]} {module.type.toUpperCase()}</b>
            <button type="button" className="btn btn-quiet" aria-label={"Remove "+module.name} onClick={()=>
              setDefinition({...definition,modules:definition.modules.filter(m=>m.id!==module.id)})}>Remove ×</button>
          </div>
          <label className="contract-label">DISPLAY NAME<input value={module.name} maxLength={65}
            aria-label={"Module name "+index} onChange={e=>updateModule(module.id,{name:e.target.value})}/></label>
          {module.type!=="tasks" && <label className="contract-label">COOLDOWN HOURS (0 = no cooldown)
            <input type="number" min={0} max={168} value={module.cooldownHours}
              aria-label={"Cooldown "+index} onChange={e=>updateModule(module.id,{cooldownHours:Number(e.target.value)})}/>
          </label>}
          {module.type==="dice" && <div className="module-fields"><label>DIE SIDES
            <input aria-label={"Dice sides "+index} type="number" min={2} max={20} value={module.sides}
              onChange={e=>updateModule(module.id,{sides:Number(e.target.value)})}/></label>
            <label>STAKE PER POINT (LKR)<input aria-label={"Dice stake "+index} type="number" min={100} max={5000}
              value={module.stake} onChange={e=>updateModule(module.id,{stake:Number(e.target.value)})}/></label>
            <p className="contract-hint">Roll against the server. Your higher result removes fictional debt; a lower result adds a penalty.</p>
          </div>}
          {module.type==="wheel" && <div className="wheel-editor">
            <p className="contract-hint">Each segment has an equal chance. Negative amounts give credits; positive amounts add penalties.</p>
            {module.outcomes.map((outcome,j)=><div key={j} className="wheel-outcome">
              <input aria-label={"Wheel segment "+index+" label "+j} value={outcome.label} maxLength={40}
                onChange={e=>updateModule(module.id,{outcomes:module.outcomes.map((x,k)=>k===j?{...x,label:e.target.value}:x)})}/>
              <input aria-label={"Wheel segment "+index+" amount "+j} type="number" min={-10000} max={10000}
                value={outcome.delta} onChange={e=>updateModule(module.id,{outcomes:module.outcomes.map((x,k)=>k===j?{...x,delta:Number(e.target.value)}:x)})}/>
              <button type="button" aria-label={"Delete wheel segment "+j} disabled={module.outcomes.length<=2}
                onClick={()=>updateModule(module.id,{outcomes:module.outcomes.filter((_,k)=>k!==j)})}>×</button>
            </div>)}
            <button type="button" className="btn btn-quiet" disabled={module.outcomes.length>=12}
              onClick={()=>updateModule(module.id,{outcomes:[...module.outcomes,{label:"New segment",delta:0}]})}>＋ Add wheel segment</button>
          </div>}
          {module.type==="checkin" && <label className="contract-label">CREDIT PER CHECK-IN
            <input aria-label={"Checkin reward "+index} type="number" min={0} max={5000} value={module.reward}
              onChange={e=>updateModule(module.id,{reward:Number(e.target.value)})}/>
          </label>}
          {module.type==="tasks" && <div className="task-editor">
            <p className="contract-hint">The Sub submits a completion claim; the Dom approves before credits are awarded. One claim per task.</p>
            {module.tasks.map((task,j)=><div key={task.id} className="task-builder-row">
              <input aria-label={"Task "+index+" name "+j} value={task.label} maxLength={140}
                onChange={e=>updateModule(module.id,{tasks:module.tasks.map(t=>t.id===task.id?{...t,label:e.target.value}:t)})}/>
              <input aria-label={"Task "+index+" reward "+j} type="number" min={0} max={5000} value={task.reward}
                onChange={e=>updateModule(module.id,{tasks:module.tasks.map(t=>t.id===task.id?{...t,reward:Number(e.target.value)}:t)})}/>
              <button type="button" aria-label={"Remove task "+j} disabled={module.tasks.length<=1}
                onClick={()=>updateModule(module.id,{tasks:module.tasks.filter(t=>t.id!==task.id)})}>×</button>
            </div>)}
            <button className="btn btn-quiet" type="button" disabled={module.tasks.length>=12}
              onClick={()=>updateModule(module.id,{tasks:[...module.tasks,{id:id(),label:"New creative challenge",reward:1000}]})}>＋ Add a task</button>
          </div>}
        </div>)}</div>
        <div className="contract-publish-actions">
          <button className="btn btn-outline" disabled={busy} onClick={()=>void save(false)}>Save private draft</button>
          <button className="btn btn-red" disabled={busy} onClick={()=>void save(true)}>Publish template ↗</button>
          {editing && <button className="btn btn-quiet" disabled={busy} onClick={()=>{setDefinition(starter());setEditing(null)}}>New contract</button>}
        </div>
        <p className="contract-hint">Rules are frozen when proposed. Saving a draft does not activate an agreement or charge anyone.</p>
      </div>
      <aside className="contract-side">
        <div className="dash-card contract-preview">
          <div className="eyebrow">LIVE CONFIGURATION PREVIEW</div><h3>{definition.title}</h3>
          <p className="muted">{definition.description}</p>
          <div className="preview-debt-value">{money(definition.terms.principal)}</div>
          <div className="contract-preview-line"><span>Monthly rate</span><b>{definition.terms.monthlyRate}%</b></div>
          <div className="contract-preview-line"><span>Weekly goal</span><b>{money(definition.terms.weeklyTarget)}</b></div>
          <div className="contract-preview-line"><span>Late fee</span><b>{money(definition.terms.lateFee)}</b></div>
          <div className="contract-preview-modules">{definition.modules.map(m=><span key={m.id}>{moduleHeading(m)}</span>)}</div>
        </div>
        <div className="dash-card"><h3>Propose to a partner</h3><p className="muted">Choose an approved connection. The Sub must review and accept the contract before any game can affect its fictional ledger.</p>
          <label className="contract-label">CONNECTION<select aria-label="Contract connection" value={connectionId} onChange={e=>setConnectionId(e.target.value)}>
            {activeConnections.length===0&&<option value="">No approved connections</option>}
            {activeConnections.map(c=><option key={c.id} value={c.id}>@{c.other_handle}</option>)}
          </select></label>
          {role==="dom"?<button className="btn btn-red full" disabled={busy||!connectionId} onClick={()=>void save(false,true)}>Save & propose contract ↗</button>:
            <p className="contract-hint">You can design and publish templates. A Dom proposes one to an approved connection.</p>}
        </div>
      </aside>
    </div>}

    {section==="library" && <>
      <form className="search-row" onSubmit={(e:FormEvent)=>{e.preventDefault();void loadTemplates(search)}}>
        <input aria-label="Search debt contract templates" placeholder="Search interactive contracts, strategies, categories…" value={search} maxLength={80} onChange={e=>setSearch(e.target.value)}/>
        <button className="btn btn-red" type="submit">Search contracts</button>
      </form>
      <div className="section-title"><h2>Community contract templates</h2><span>CONFIGURE · ADAPT · SHARE</span></div>
      <div className="contract-template-grid">
        {library.length===0?<p className="muted">No templates published yet. Create the first one.</p>:
          library.map(t=><div className="contract-template" key={t.id}>
            <small className="eyebrow">{t.category} · BY @{t.author_handle}</small><h3>{t.title}</h3><p>{t.description}</p>
            <div className="contract-template-value">{money(t.terms.principal)} <small>FICTIONAL START</small></div>
            <div className="contract-module-chips">{t.modules.map(m=><span key={m.id}>{icons[m.type]} {m.name}</span>)}</div>
            <button className="btn btn-outline" onClick={()=>chooseTemplate(t,false)}>Customize this template ↗</button>
          </div>)}
      </div>
      <div className="section-title contract-mine-title"><h2>My saved templates</h2><span>{mine.length} CREATED</span></div>
      <div className="contract-template-grid">{mine.map(t=><div key={t.id} className="contract-template mine">
        <h3>{t.title}</h3><p>{t.published?"Published to discovery":"Private draft"} · {t.modules.length} modules</p>
        <div className="person-actions">
          <button className="btn btn-outline" onClick={()=>chooseTemplate(t,true)}>Edit</button>
          <button className="btn btn-quiet" disabled={busy} onClick={()=>void doAction({action:"publish",templateId:t.id,publish:!t.published})}>{t.published?"Unpublish":"Publish"}</button>
        </div></div>)}</div>
    </>}

    {section==="active" && <div className="contract-layout">
      <div className="contract-play-area">
        {scenes.length===0?<div className="empty-block"><h2>No interactive contracts yet.</h2><p>Create a template and propose it to an approved connection. A partner must accept before play starts.</p><button className="btn btn-red" onClick={()=>setSection("builder")}>Build a contract ↗</button></div>:<>
          <div className="scene-picker">{scenes.map(s=><button className={"scene-chip "+(sceneId===s.scene_id?"selected":"")} key={s.scene_id}
            onClick={()=>{setSceneId(s.scene_id);setLastOutcome(null)}}>@{s.other_handle} <span className={"status status-"+s.status}>{s.status}</span></button>)}</div>
          {current && <><div className="contract-active-banner">
            <div><div className="eyebrow">AGREED FICTIONAL DEBT CONTRACT</div><h2>{current.title_snapshot}</h2><p>@{current.other_handle} · {current.description_snapshot}</p></div>
            <div><small>LIVE FANTASY BALANCE</small><strong>{money(total)}</strong></div>
          </div>
          <div className="contract-consent">
            {current.status==="proposed"&&<><p>The contract is awaiting explicit Sub approval. No gameplay is available yet.</p>
              {role==="sub"&&<button className="btn btn-red" disabled={busy} onClick={()=>void decide("approve")}>Approve & activate contract</button>}
              <button className="btn btn-danger-soft" disabled={busy} onClick={()=>void decide("end")}>Decline or withdraw</button></>}
            {current.status==="active"&&<><p>Either partner may pause or stop. Module actions can change only the fictional ledger.</p>
              <button className="btn btn-outline" disabled={busy} onClick={()=>void decide("pause")}>Pause all games</button>
              <button className="btn btn-danger-soft" disabled={busy} onClick={()=>void decide("end")}>End contract</button></>}
            {current.status==="paused"&&<><p>Games are paused. Only the Sub may resume.</p>
              {role==="sub"&&<button className="btn btn-red" disabled={busy} onClick={()=>void decide("resume")}>Resume with consent</button>}
              <button className="btn btn-danger-soft" disabled={busy} onClick={()=>void decide("end")}>End contract</button></>}
            {current.status==="ended"&&<p>This contract has ended. Its audit history stays visible; no further actions are permitted.</p>}
          </div>
          <div className="section-title"><h2>Interactive extensions</h2><span>{configured.length} MODULES</span></div>
          <div className="contract-game-grid">{configured.map(module=>{
            const previous=existing?.actions.find(a=>a.module_id===module.id)
            const claimFor=(taskId:string)=>existing?.claims.find(c=>c.module_id===module.id&&c.task_id===taskId)
            const cooldown=module.type==="tasks"?0:module.cooldownHours
            const ms=previous&&cooldown?new Date(previous.created_at).getTime()+cooldown*3600000-Date.now():0
            const cooling=ms>0
            const outcome=lastOutcome?.moduleId===module.id?lastOutcome:null
            return <div key={module.id} className={"contract-game-card kind-"+module.type}>
              <div className="contract-game-title"><span className="contract-game-icon">{icons[module.type]}</span>
                <div><small>{module.type.toUpperCase()}</small><h3>{module.name}</h3></div></div>
              {module.type==="dice"&&<><p>Roll a d{module.sides} against the server. The difference changes the fictional balance by {money(module.stake)} per point.</p>
                <div className="dice-display"><div><small>YOU</small><strong>{outcome?.details.playerRoll===undefined?"?":String(outcome.details.playerRoll)}</strong></div><span>VS</span><div><small>SERVER</small><strong>{outcome?.details.botRoll===undefined?"?":String(outcome.details.botRoll)}</strong></div></div></>}
              {module.type==="wheel"&&<><p>Spin a wheel with {module.outcomes.length} equally likely custom outcomes.</p>
                <div className="wheel-live" style={{background:"conic-gradient("+module.outcomes.map((_,i)=>{
                  const colors=["#b84e69","#e0a970","#7b729d","#6d9a8b"]
                  return colors[i%colors.length]+" "+(i*100/module.outcomes.length)+"% "+((i+1)*100/module.outcomes.length)+"%"
                }).join(",")+")"}}><span>✦</span></div>
                <div className="wheel-summary">{module.outcomes.map((o,i)=><span key={i}>{o.label}: {o.delta>0?"+":""}{money(o.delta)}</span>)}</div></>}
              {module.type==="checkin"&&<><p>Complete a check-in to earn {money(module.reward)} in fictional debt credits. Repeat after the agreed cooldown.</p>
                <div className="contract-checkin-glyph">◷ <span>{module.cooldownHours}h interval</span></div></>}
              {module.type!=="tasks" && <><button className="btn btn-red full" disabled={!isPlayable||busy||cooling||(module.type==="checkin"&&role!=="sub")}
                onClick={()=>void play(module.id)}>{module.type==="dice"?"⚄ Roll dice":module.type==="wheel"?"✺ Spin the wheel":"✓ Check in"}</button>
                <small className="contract-availability">{cooling?"Cooldown · available later":!isPlayable?"Activate contract to play":cooldown===0?"Available (daily safety limit applies)":"Available · cooldown "+cooldown+"h"}</small></>}
              {outcome&&<div className="contract-result" role="status">
                <b>{outcome.delta<0?"− "+money(Math.abs(outcome.delta))+" credit":outcome.delta>0?"+ "+money(outcome.delta)+" penalty":"No balance change"}</b>
                {outcome.details.label!==undefined&&<small>{String(outcome.details.label)}</small>}
              </div>}
              {module.type==="tasks"&&<><p>Submit task completion for partner review. Credits are applied only after approval.</p>
                <div className="contract-task-list">{module.tasks.map(task=>{
                  const claim=claimFor(task.id)
                  return <div className="contract-task" key={task.id}><div><b>{task.label}</b><small>{money(task.reward)} reward · {claim?.state||"not submitted"}</small></div>
                    {!claim&&role==="sub"&&<button className="btn btn-outline" disabled={!isPlayable||busy}
                      onClick={()=>void doAction({action:"claim",sceneId,moduleId:module.id,taskId:task.id})}>Submit</button>}
                    {claim?.state==="pending"&&role==="dom"&&<div className="person-actions">
                      <button className="btn btn-red" disabled={!isPlayable||busy} onClick={()=>void doAction({action:"review",sceneId,claimId:claim.id,approve:true})}>Approve</button>
                      <button className="btn btn-quiet" disabled={!isPlayable||busy} onClick={()=>void doAction({action:"review",sceneId,claimId:claim.id,approve:false})}>Decline</button>
                    </div>}
                  </div>})}</div></>}
            </div>
          })}</div>
          <div className="dash-card contract-audit"><div className="section-title"><h2>Game action history</h2><button className="btn btn-quiet" onClick={()=>void loadDetails(sceneId)}>↻ Refresh</button></div>
            {!existing?.actions.length?<p className="muted">No game actions yet.</p>:existing.actions.map(a=><div key={a.id} className="timeline-row">
              <span className="event-icon">{a.delta<0?"−":a.delta>0?"+":"◇"}</span>
              <div className="event-copy"><b>{a.action} · @{a.actor_handle}</b><small>{new Date(a.created_at).toLocaleString("en-GB")}</small></div>
              <strong className={a.delta<0?"green":"gold"}>{a.delta>0?"+":""}{money(a.delta)}</strong>
            </div>)}</div>
          </>}
        </>}
      </div>
      <aside className="dash-card"><h3>How the contract works</h3>
        <p className="muted">Only a mutually accepted scene can run modules. Results are server-generated and recorded in the shared ledger.</p>
        <p className="muted">Either partner can pause or end at any time. Only the Sub can resume a paused scene. All amounts are imaginary.</p>
        <button className="btn btn-outline full" onClick={()=>setSection("library")}>Browse more designs ↗</button>
      </aside>
    </div>}
  </section>
}
