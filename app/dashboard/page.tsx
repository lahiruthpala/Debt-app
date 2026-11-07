"use client"
import Link from "next/link"
import { FormEvent, useEffect, useState } from "react"
import { authClient } from "@/lib/auth-client"
import { QUESTS } from "@/lib/ledger"

type Role = "dom" | "sub"
type Profile = { id:string; handle:string; role:Role; bio:string; discoverable:boolean }
type Connection = { id:string; sender_id:string; recipient_id:string; state:string; other_handle:string; other_role:Role; other_bio:string }
type Scene = { id:string; connection_id:string; status:string; connection_state:string; other_handle:string; other_role:Role; start_principal:number; principal:number; interest:number; penalties:number; monthly_rate:number; weekly_target:number; late_fee:number; last_roll_at:string|null }
type Event = {id:string; type:string; amount:number; detail:string; actor:string; created_at:string}
type Challenge = {id:string; title:string; reward:number; state:string; created_at:string}
type Details = { scene:Scene; events:Event[]; challenges:Challenge[] }
type Tab = "overview"|"discover"|"connections"|"games"|"profile"

const money=(n:number)=>"LKR "+Number(n || 0).toLocaleString("en-US")
const date=(d:string)=>new Date(d).toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})
async function api(view:string,params:Record<string,string>={}) {
  const q = new URLSearchParams({view,...params})
  const response = await fetch("/api/studio?"+q.toString(), {cache:"no-store"})
  const data = await response.json().catch(()=>({}))
  if (!response.ok) throw new Error(data.error || "Request failed")
  return data
}
async function mutate(body:Record<string,unknown>) {
  const response = await fetch("/api/studio",{
    method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),
  })
  const data = await response.json().catch(()=>({}))
  if (!response.ok) throw new Error(data.error || "Request failed")
  return data
}

export default function Dashboard() {
  const { data: session, isPending } = authClient.useSession()
  const [tab,setTab]=useState<Tab>("overview")
  const [me,setMe]=useState<{id:string;profile:Profile|null}|null>(null)
  const [connections,setConnections]=useState<Connection[]>([])
  const [scenes,setScenes]=useState<Scene[]>([])
  const [selected,setSelected]=useState("")
  const [details,setDetails]=useState<Details|null>(null)
  const [profiles,setProfiles]=useState<Profile[]>([])
  const [search,setSearch]=useState("")
  const [busy,setBusy]=useState(false)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState("")
  const [message,setMessage]=useState("")
  const [pf,setPf]=useState({handle:"",role:"sub" as Role,bio:"",discoverable:true,adult:false})
  const [terms,setTerms]=useState({principal:250000,monthlyRate:12,weeklyTarget:15000,lateFee:5000})
  const [credit,setCredit]=useState(15000)
  const [challengeIndex,setChallengeIndex]=useState(0)
  const [forecast,setForecast]=useState(15000)

  async function loadDetails(id:string) {
    try {const data=await api("scene",{id});setDetails(data)}
    catch(err){setDetails(null);setError(err instanceof Error ? err.message : "Could not load scene")}
  }
  async function refresh() {
    setError("")
    try {
      const own=await api("me")
      setMe(own)
      if(own.profile) {
        const [c,s]=await Promise.all([api("connections"),api("scenes")])
        setConnections(c.connections);setScenes(s.scenes)
        setPf({handle:own.profile.handle,role:own.profile.role,bio:own.profile.bio,discoverable:own.profile.discoverable,adult:true})
        const next = selected && s.scenes.some((x:Scene)=>x.id===selected)
          ? selected
          : (s.scenes.find((x:Scene)=>x.status==="active")?.id || s.scenes[0]?.id || "")
        setSelected(next)
        if (next) await loadDetails(next)
        else setDetails(null)
      } else {
        setConnections([]);setScenes([])
        setPf(current=>({...current,handle:sessionStorage.getItem("vl_signup_handle")||"",role:(sessionStorage.getItem("vl_signup_role")==="dom"?"dom":"sub") as Role}))
      }
    } catch(err){setError(err instanceof Error ? err.message : "Unable to connect")}
    finally{setLoading(false)}
  }
  useEffect(()=>{
    if(!isPending && session) { void refresh() }
    else if(!isPending) setLoading(false)
    // Initial session; later mutations call refresh explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[isPending,session?.user.id])
  useEffect(()=>{
    if(tab==="discover" && me?.profile) {void searchProfiles()}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[tab,me?.profile?.id])

  async function searchProfiles() {
    try {const data=await api("discover",{q:search});setProfiles(data.profiles)}
    catch(err){setError(err instanceof Error?err.message:"Search failed")}
  }
  async function act(payload:Record<string,unknown>) {
    setBusy(true);setError("");setMessage("")
    try {
      const outcome=await mutate(payload)
      setMessage(outcome.message || "Saved")
      await refresh()
      if(tab==="discover") await searchProfiles()
    } catch(err){setError(err instanceof Error ? err.message : "Action failed")}
    finally{setBusy(false)}
  }
  function saveProfile(e:FormEvent) {
    e.preventDefault()
    void act({action:"profile",...pf,adult:me?.profile ? true : pf.adult})
  }
  function propose(e:FormEvent,connectionId:string) {
    e.preventDefault();void act({action:"propose",connectionId,...terms})
  }
  function sceneAction(operation:string,amount?:number) {
    if(!selected) return
    if(operation==="end" && !window.confirm("End this fictional scene? It cannot be resumed.")) return
    void act({action:"scene",sceneId:selected,operation,...(amount!==undefined?{amount}:{})})
  }
  const profile=me?.profile
  const ownRole=profile?.role
  const scene=details?.scene && details.scene.id===selected ? details.scene : scenes.find(s=>s.id===selected)
  const total=scene ? scene.principal+scene.interest+scene.penalties : 0
  const progress=scene ? Math.min(100,Math.max(0,100*(scene.start_principal-total)/Math.max(scene.start_principal,1))) : 0
  const active=scene?.status==="active" && scene.connection_state==="active"
  const activeConnections=connections.filter(c=>c.state==="active")
  const initialRole=ownRole==="dom"?"DOM":"SUB"

  if(isPending || loading) return <div className="load-screen"><div className="brand">◆ VELVET LEDGER</div><p>Opening your private studio...</p></div>
  if(!session) return <div className="guest-screen"><div className="eyebrow">PRIVATE STUDIO</div><h1>Your ledger is waiting.</h1><p>Sign in to access your connections and fictional scenes.</p><Link href="/login" className="btn btn-red">Sign in ↗</Link></div>

  return <main className="app-shell">
    <div className="app-rail">
      <Link href="/" className="brand"><span className="brand-symbol">◆</span> VELVET LEDGER <small>PRIVATE STUDIO</small></Link>
      <div className="rail-caption">WORKSPACE</div>
      {([
        ["overview","▦","Overview"],["discover","⌕","Discover"],["connections","◇","Connections"],
        ["games","♢","Game room"],["profile","◎","My profile"],
      ] as const).map(([id,icon,label])=><button key={id} className={"rail-link "+(tab===id?"active":"")} onClick={()=>setTab(id)}>
        <span className="rail-icon">{icon}</span>{label}{id==="connections" && connections.some(c=>c.state==="pending" && c.recipient_id===me?.id) && <span className="notification-dot"/>}
      </button>)}
      <div className="rail-bottom"><div className="rail-legal">18+ CONSENSUAL ROLEPLAY<br/>ALL BALANCES ARE FICTIONAL</div>
        <button className="logout" onClick={async()=>{await authClient.signOut();window.location.assign("/")}}>↪ Sign out</button>
      </div>
    </div>
    <section className="app-main">
      <div className="app-topline">
        <div><span className="eyebrow">THE PRIVATE STUDIO / {tab.toUpperCase()}</span>
          <h1>{tab==="overview"?"Your command center":tab==="discover"?"Find your counterpart":tab==="connections"?"Mutual connections":tab==="games"?"The game room":"Your identity"}</h1></div>
        <div className="user-pill"><span className="avatar">{profile?.handle?.slice(0,1).toUpperCase()||"?"}</span><div><b>@{profile?.handle || session.user.name}</b><small>{profile?initialRole:"SETUP REQUIRED"}</small></div></div>
      </div>
      {error && <div className="notice error-notice" role="alert">{error}<button onClick={()=>setError("")} aria-label="Dismiss">×</button></div>}
      {message && <div className="notice success-notice" role="status">{message}<button onClick={()=>setMessage("")} aria-label="Dismiss">×</button></div>}

      {!profile ? <div className="dash-card profile-setup">
        <div className="eyebrow">STEP 01 · PERSONAL IDENTITY</div><h2>Choose how you participate.</h2>
        <p className="muted">Finish your private account setup. Your email is never published. Only your handle is visible when you opt into discovery.</p>
        <form className="form-stack" onSubmit={saveProfile}>
          <label>PUBLIC HANDLE<input required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" value={pf.handle} onChange={e=>setPf({...pf,handle:e.target.value})}/></label>
          <div className="form-label">ROLE (LOCKED AFTER SETUP)</div>
          <div className="role-choices">
            <button type="button" className={"role "+(pf.role==="dom"?"selected":"")} onClick={()=>setPf({...pf,role:"dom"})}><b>DOM</b><span>Propose & guide scenes</span></button>
            <button type="button" className={"role "+(pf.role==="sub"?"selected":"")} onClick={()=>setPf({...pf,role:"sub"})}><b>SUB</b><span>Approve & play scenes</span></button>
          </div>
          <label>BIO (OPTIONAL)<textarea maxLength={280} rows={3} placeholder="A few words about your roleplay preferences..." value={pf.bio} onChange={e=>setPf({...pf,bio:e.target.value})}/></label>
          <label className="check-label"><input type="checkbox" checked={pf.discoverable} onChange={e=>setPf({...pf,discoverable:e.target.checked})}/><span>Allow other adults with complementary roles to find me</span></label>
          <label className="check-label"><input type="checkbox" required checked={pf.adult} onChange={e=>setPf({...pf,adult:e.target.checked})}/><span>I confirm that I am 18+ and understand consent can be withdrawn at any time.</span></label>
          <button className="btn btn-red" type="submit" disabled={busy}>Complete setup ↗</button>
        </form></div>
      : <>
        {tab==="overview" && <>
          <div className="metric-grid">
            <div className="metric"><span>CONNECTED PARTNERS</span><strong>{activeConnections.length.toString().padStart(2,"0")}</strong><small>Mutual approvals</small></div>
            <div className="metric"><span>YOUR ACTIVE SCENES</span><strong>{scenes.filter(s=>s.status==="active").length.toString().padStart(2,"0")}</strong><small>Consent-enabled</small></div>
            <div className="metric"><span>IMAGINARY BALANCE</span><strong>{total?money(total):"—"}</strong><small>Selected scene · LKR fictional</small></div>
          </div>
          {scenes.length===0 ? <div className="empty-block"><div className="empty-glyph">◇</div><h2>No scenes yet.</h2><p>{ownRole==="dom"?"Discover a sub, connect, then propose a fictional ledger.":"Find a Dom, accept a connection, then approve any proposed scene terms."}</p><button className="btn btn-red" onClick={()=>setTab("discover")}>Explore profiles ↗</button></div> : <>
            <div className="section-title"><h2>Shared fantasy ledger</h2><span>SELECT A SCENE</span></div>
            <div className="scene-picker">{scenes.map(item=><button key={item.id} className={"scene-chip "+(selected===item.id?"selected":"")} onClick={()=>{setSelected(item.id);void loadDetails(item.id)}}><b>@{item.other_handle}</b><span className={"status status-"+item.status}>{item.status}</span></button>)}</div>
            {scene && <><div className="balance-panel">
              <div className="balance-top"><span className="eyebrow">FICTIONAL OBLIGATION · {scene.status.toUpperCase()}</span><span>PARTNER / @{scene.other_handle}</span></div>
              <span className="balance-label">TOTAL FANTASY BALANCE</span>
              <div className="big-balance">{money(total)}</div>
              <div className="balance-breakdown">
                <div><small>Principal</small><b>{money(scene.principal)}</b></div>
                <div><small>Interest</small><b>{money(scene.interest)}</b></div>
                <div><small>Penalties</small><b>{money(scene.penalties)}</b></div>
              </div>
              <div className="progress-head"><span>Progress vs. starting balance</span><b>{Math.round(progress)}%</b></div>
              <div className="progress-track"><div style={{width:progress+"%"}}/></div>
              <div className="terms-line"><span>{scene.monthly_rate}% monthly rate</span><span>{money(scene.weekly_target)} weekly target</span><span>{money(scene.late_fee)} late fee</span></div>
            </div>
            <div className="two-col">
              <div className="dash-card">
                <h3>Scene controls <span className="mini-label">CONSENT STATUS</span></h3>
                <p className="muted">{scene.status==="proposed"?"Proposed terms require the sub's explicit approval before tracking begins.":scene.status==="paused"?"All credits and games are frozen. The sub can choose to resume.":scene.status==="ended"?"This scene has ended permanently. Its history remains visible.":"Either participant may pause or end at any moment."}</p>
                <div className="stack-buttons">
                  {scene.status==="proposed" && ownRole==="sub" && <button disabled={busy} className="btn btn-red" onClick={()=>sceneAction("approve")}>Approve & begin scene</button>}
                  {scene.status==="active" && <button disabled={busy} className="btn btn-outline" onClick={()=>sceneAction("pause")}>Ⅱ Pause scene</button>}
                  {scene.status==="paused" && ownRole==="sub" && <button disabled={busy} className="btn btn-red" onClick={()=>sceneAction("resume")}>Resume with consent</button>}
                  {scene.status!=="ended" && <button disabled={busy} className="btn btn-danger-soft" onClick={()=>sceneAction("end")}>End scene permanently</button>}
                </div>
              </div>
              <div className="dash-card">
                <h3>Simulated payments <span className="mini-label">NO MONEY SENT</span></h3>
                <p className="muted">Credits clear penalties first, then interest, then principal. The ledger is imaginary.</p>
                <div className="input-with-button"><input type="number" min={1} max={100000} value={credit} onChange={e=>setCredit(Number(e.target.value))} disabled={!active||ownRole!=="sub"}/>
                  <button className="btn btn-red" disabled={busy||!active||ownRole!=="sub"} onClick={()=>sceneAction("payment",credit)}>Apply credit</button></div>
                {ownRole==="dom" && active && <div className="action-inline"><button disabled={busy} className="btn btn-quiet" onClick={()=>sceneAction("late_fee")}>+ Agreed late fee</button><button disabled={busy} className="btn btn-quiet" onClick={()=>sceneAction("interest")}>+ Monthly interest</button></div>}
              </div>
            </div>
            <div className="dash-card"><h3>Ledger activity <span className="mini-label">AUDIT TRAIL</span></h3>
              {!details?.events?.length?<p className="muted">No recorded actions yet.</p>:<div className="timeline">{details.events.map(item=><div className="timeline-row" key={item.id}><span className="event-icon">{item.amount<0?"−":item.amount>0?"+":"◇"}</span><div className="event-copy"><b>{item.detail}</b><small>@{item.actor} · {date(item.created_at)}</small></div><strong className={item.amount<0?"green":"gold"}>{item.amount===0?"—":(item.amount>0?"+":"−")+money(Math.abs(item.amount))}</strong></div>)}</div>}
            </div></>}
          </>}
        </>}

        {tab==="discover" && <div className="dash-card"><h3>Explore opt-in profiles</h3><p className="muted">Only adult profiles with the complementary role and discoverability enabled appear here. A connection starts only after they accept.</p>
          <form className="search-row" onSubmit={e=>{e.preventDefault();void searchProfiles()}}><input value={search} maxLength={50} placeholder={"Search "+(ownRole==="dom"?"sub":"Dom")+" handles or bios..."} onChange={e=>setSearch(e.target.value)}/><button className="btn btn-red" type="submit">Search</button></form>
          {profiles.length===0?<div className="empty-inner">No available profiles found. Try another search.</div>:<div className="people-list">{profiles.map(p=><div className="person" key={p.id}><span className="avatar">{p.handle[0].toUpperCase()}</span><div className="person-info"><b>@{p.handle}</b><small>{p.role.toUpperCase()} · {p.bio||"Exploring fictional scenes"}</small></div><button className="btn btn-outline" disabled={busy} onClick={()=>act({action:"invite",targetId:p.id})}>Invite ↗</button></div>)}</div>}
        </div>}

        {tab==="connections" && <>
          <div className="dash-card"><h3>Your connections</h3><p className="muted">Invitations are private. You can decline, disconnect or block another account at any time.</p>
            {!connections.length?<div className="empty-inner">No connections yet. Visit Discover to send an invitation.</div>:<div className="people-list">{connections.map(c=><div className="person" key={c.id}><span className="avatar">{c.other_handle[0]?.toUpperCase()}</span><div className="person-info"><b>@{c.other_handle} <span className={"status status-"+c.state}>{c.state}</span></b><small>{c.other_role.toUpperCase()} · {c.state==="pending"?(c.recipient_id===me.id?"Awaiting your response":"Invitation sent"):"Mutually connected"}</small></div><div className="person-actions">
              {c.state==="pending" && c.recipient_id===me.id && <><button className="btn btn-red" disabled={busy} onClick={()=>act({action:"connection",id:c.id,decision:"accept"})}>Accept</button><button className="btn btn-outline" disabled={busy} onClick={()=>act({action:"connection",id:c.id,decision:"decline"})}>Decline</button></>}
              <button className="btn btn-quiet" disabled={busy} onClick={()=>{if(window.confirm("End this connection?"))void act({action:"connection",id:c.id,decision:"end"})}}>Disconnect</button>
              <button className="btn btn-danger-soft" disabled={busy} onClick={()=>{if(window.confirm("Block this account? They will not be able to invite you again."))void act({action:"connection",id:c.id,decision:"block"})}}>Block</button>
            </div></div>)}</div>}</div>
          {ownRole==="dom" && activeConnections.map(c=><form key={c.id} className="dash-card propose-card" onSubmit={e=>propose(e,c.id)}><div className="eyebrow">NEW SCENE PROPOSAL</div><h3>Propose terms to @{c.other_handle}</h3><p className="muted">These figures are imaginary and require the sub's approval. Interest is recorded only through explicit scene actions.</p>
            <div className="form-grid"><label>Starting principal (LKR)<input type="number" min={0} max={1000000} value={terms.principal} onChange={e=>setTerms({...terms,principal:Number(e.target.value)})}/></label>
              <label>Monthly interest (%)<input type="number" min={0} max={30} value={terms.monthlyRate} onChange={e=>setTerms({...terms,monthlyRate:Number(e.target.value)})}/></label>
              <label>Weekly target (LKR)<input type="number" min={0} max={100000} value={terms.weeklyTarget} onChange={e=>setTerms({...terms,weeklyTarget:Number(e.target.value)})}/></label>
              <label>Agreed late fee (LKR)<input type="number" min={0} max={10000} value={terms.lateFee} onChange={e=>setTerms({...terms,lateFee:Number(e.target.value)})}/></label>
            </div><button className="btn btn-red" type="submit" disabled={busy}>Send scene proposal ↗</button>
          </form>)}
        </>}

        {tab==="games" && <>
          {!scene?<div className="empty-block"><h2>Start a scene to unlock the game room.</h2><p>Connect with a partner and activate a consensual fictional ledger first.</p><button className="btn btn-red" onClick={()=>setTab("discover")}>Find a partner ↗</button></div>:<>
            <div className="scene-picker">{scenes.map(s=><button className={"scene-chip "+(selected===s.id?"selected":"")} key={s.id} onClick={()=>{setSelected(s.id);void loadDetails(s.id)}}>@{s.other_handle} <span className={"status status-"+s.status}>{s.status}</span></button>)}</div>
            <div className="game-grid">
              <div className="game-card dice-card"><div className="eyebrow">GAME 01 / LUCK</div><div className="game-symbol">⚄</div><h2>Debt Dice</h2><p>Once per 24 hours, the sub may roll a six-sided die. Outcomes range from 5,000 imaginary credits off the ledger to 2,000 added. Results are server-generated and recorded.</p><button className="btn btn-red" disabled={busy||!active||ownRole!=="sub"} onClick={()=>sceneAction("roll")}>Roll the dice ⚄</button>{!active&&<small>Activate the scene to play.</small>}</div>
              <div className="game-card planner-card"><div className="eyebrow">GAME 02 / STRATEGY</div><div className="game-symbol">▥</div><h2>The payoff lab</h2><p>Experiment with weekly fictional credits and see how long clearing the current balance would take—without changing the real ledger.</p><div className="planner-input"><span>WEEKLY CREDIT</span><strong>{money(forecast)}</strong></div><input type="range" min={1000} max={50000} step={1000} value={forecast} onChange={e=>setForecast(Number(e.target.value))}/><div className="planner-result"><b>{Math.ceil(total/forecast)}</b><span>estimated weeks<br/>ignoring future charges</span></div></div>
            </div>
            <div className="dash-card"><div className="section-title"><h2>Challenge board</h2><span>GAME 03 / CO-OP</span></div>
              <p className="muted">Doms issue preset non-financial tasks. Subs mark them complete to earn imaginary balance reductions. No real-world obligations are created.</p>
              {ownRole==="dom" && <div className="quest-compose"><select value={challengeIndex} onChange={e=>setChallengeIndex(Number(e.target.value))} disabled={!active}>{QUESTS.map((q,i)=><option key={q.title} value={i}>{q.title} · {q.reward.toLocaleString()} credits</option>)}</select><button className="btn btn-red" disabled={busy||!active} onClick={()=>act({action:"quest",sceneId:selected,index:challengeIndex})}>Issue challenge</button></div>}
              {!details?.challenges.length?<div className="empty-inner">No challenges issued yet.</div>:<div className="quest-list">{details.challenges.map(c=><div className="quest" key={c.id}><div className="quest-symbol">◇</div><div className="quest-info"><b>{c.title}</b><small>{c.state==="completed"?"Completed · reward applied":"Open · pending sub completion"}</small></div><strong>−{money(c.reward)}</strong>{ownRole==="sub" && c.state==="open" && <button className="btn btn-outline" disabled={busy||!active} onClick={()=>act({action:"complete",sceneId:selected,challengeId:c.id})}>Complete</button>}</div>)}</div>}
            </div>
          </>}
        </>}

        {tab==="profile" && <div className="dash-card profile-setup"><div className="eyebrow">YOUR PUBLIC IDENTITY</div><h2>@{profile.handle} <span className="status status-active">{initialRole}</span></h2><p className="muted">Only your handle and optional bio are visible to people searching. Your role is permanent for this account.</p>
          <form className="form-stack" onSubmit={saveProfile}><label>HANDLE<input value={pf.handle} required minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" onChange={e=>setPf({...pf,handle:e.target.value})}/></label>
            <label>BIO<textarea rows={3} maxLength={280} value={pf.bio} onChange={e=>setPf({...pf,bio:e.target.value})}/></label>
            <label className="check-label"><input type="checkbox" checked={pf.discoverable} onChange={e=>setPf({...pf,discoverable:e.target.checked})}/><span>Show my profile in discovery</span></label>
            <button className="btn btn-red" type="submit" disabled={busy}>Save profile</button></form>
        </div>}
      </>}
      <footer className="dash-footer">◆ VELVET LEDGER <span>CONSTRUCTED FANTASY · NOT A LOAN, PAYMENT SERVICE OR LEGAL CONTRACT · CONSENT CAN BE WITHDRAWN ANYTIME</span></footer>
    </section>
  </main>
}
