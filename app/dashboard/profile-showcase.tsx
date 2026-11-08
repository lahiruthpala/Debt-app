"use client"
import Link from "next/link"
import {useEffect,useState,type FormEvent,type ReactNode} from "react"
import type {ShowcaseSettings,ShowcaseStats,ShowcaseBadge} from "@/lib/showcase"

type PublicProfile={
  handle:string;role:"dom"|"sub";bio:string;displayName:string;tagline:string;
  likes:string[];dislikes:string[];dedication:string;boundaries:string;
  discoverable:boolean;showcaseEnabled:boolean;showStats:boolean;
  showAchievements:boolean;showActivity:boolean;updatedAt?:string
}
type ActivityItem={label:string;date:string}
type ShowcaseResponse={profile:PublicProfile;stats?:ShowcaseStats;badges?:ShowcaseBadge[];activity?:ActivityItem[]}
type ProfileTab="overview"|"activity"|"achievements"
const defaults:ShowcaseSettings={
  displayName:"",tagline:"",likes:[],dislikes:[],dedication:"",boundaries:"",
  showcaseEnabled:false,showStats:false,showAchievements:false,showActivity:false
}
const badgeSymbols:Record<string,string>={"first-agreement":"✦","consistent-partner":"◆","first-game":"⚄",
  "active-player":"✺","verified-task":"✓","verified-evidence":"◈","trusted-reviewer":"♢","creator":"✎"}
const stats: {key:keyof ShowcaseStats;label:string;symbol:string}[]=[
  {key:"acceptedAgreements",label:"Agreements",symbol:"◇"},
  {key:"gameActions",label:"Game actions",symbol:"⚄"},
  {key:"tasksApproved",label:"Verified tasks",symbol:"✓"},
  {key:"proofsApproved",label:"Approved proofs",symbol:"◈"},
  {key:"proofsReviewed",label:"Proof reviews",symbol:"♢"},
  {key:"publishedTemplates",label:"Creations",symbol:"✦"}
]
async function fetchShowcase(query:string):Promise<ShowcaseResponse>{
  const response=await fetch("/api/showcase?"+query,{cache:"no-store"})
  const body=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(body.error||"Unable to load member profile")
  return body as ShowcaseResponse
}
function SectionTitle({eyebrow,title}:{eyebrow:string;title:string}){
  return <div className="profile-v2-section-title">
    <span className="profile-v2-eyebrow">{eyebrow}</span>
    <h3>{title}</h3>
  </div>
}
function TagGroup({items,negative=false}:{items:string[];negative?:boolean}){
  return items.length?<div className="profile-v2-tags">{items.map((item,i)=>
    <span key={i} className={"profile-v2-tag"+(negative?" is-negative":"")}>{item}</span>)}</div>:
    <p className="profile-v2-empty">Nothing listed yet.</p>
}
function MemberCard({data,preview=false,actions}:{data:ShowcaseResponse;preview?:boolean;actions?:ReactNode}){
  const [active,setActive]=useState<ProfileTab>("overview")
  const p=data.profile
  const full=p.showcaseEnabled||preview
  const display=p.displayName||p.handle
  const initials=display.trim().slice(0,2).toUpperCase()
  const hasActivity=Boolean(data.activity)
  const hasBadges=Boolean(data.badges)
  return <article className="profile-v2" aria-label={"Member profile for @"+p.handle}>
    <div className="profile-v2-cover">
      <div className="profile-v2-cover-pattern" aria-hidden="true"><span>✦</span><span>◇</span><span>◈</span></div>
      <span className="profile-v2-cover-caption">VELVET LEDGER <span>/ MEMBER DIRECTORY</span></span>
      <span className="profile-v2-cover-tag">VOLUNTARY CONNECTIONS</span>
    </div>
    <div className="profile-v2-head">
      <div className="profile-v2-avatar" aria-hidden="true">{initials}</div>
      <div className="profile-v2-identity">
        <div className="profile-v2-identity-label">{preview?"YOUR LIVE PREVIEW":"MEMBER PROFILE"}</div>
        <h2>{display}</h2>
        <div className="profile-v2-identity-meta">
          <span className="profile-v2-username">@{p.handle}</span>
          <span className={"profile-v2-role is-"+p.role}>{p.role==="dom"?"Dom":"Sub"}</span>
          <span className="profile-v2-visibility">{p.discoverable?"Discoverable":"Private profile"}</span>
        </div>
        {full&&p.tagline?<p className="profile-v2-headline">{p.tagline}</p>:
          <p className="profile-v2-headline">{p.bio||"Discover more about this member before deciding to connect."}</p>}
      </div>
      {actions&&<div className="profile-v2-head-actions">{actions}</div>}
    </div>
    <nav className="profile-v2-tabs" aria-label="Member profile sections">
      {([
        ["overview","Overview"],["activity","Activity"],["achievements","Achievements"]
      ] as [ProfileTab,string][]).map(([key,label])=>
        <button key={key} type="button" aria-pressed={active===key}
          className={active===key?"is-selected":""} onClick={()=>setActive(key)}>{label}
          {key==="achievements"&&data.badges&&<span className="profile-v2-tab-count">{data.badges.length}</span>}
        </button>)}
    </nav>
    {active==="overview"&&<div className="profile-v2-content">
      {data.stats&&<section className="profile-v2-stat-section" aria-label="Member statistics">
        <div className="profile-v2-section-bar"><SectionTitle eyebrow="VERIFIED APP DATA" title="At a glance"/>
          <span className="profile-v2-sublabel">Based on recorded activity</span></div>
        <div className="profile-v2-stat-grid">{stats.map(stat=>
          <div className="profile-v2-stat" key={stat.key}>
            <span aria-hidden="true" className="profile-v2-stat-icon">{stat.symbol}</span>
            <strong>{data.stats?.[stat.key]??0}</strong><span>{stat.label}</span>
          </div>)}</div>
      </section>}
      <div className="profile-v2-columns">
        <div className="profile-v2-main">
          <section className="profile-v2-panel">
            <SectionTitle eyebrow="INTRODUCTION" title="About me"/>
            <p className="profile-v2-paragraph">{p.bio||"This member hasn't written an introduction yet."}</p>
            {!full&&<p className="profile-v2-private-message">This member has not published their extended showcase. You can still decide whether to send an invitation using their public handle and introduction.</p>}
          </section>
          {full&&<>
            <section className="profile-v2-panel">
              <SectionTitle eyebrow="PREFERENCES" title="Likes & interests"/>
              <TagGroup items={p.likes}/>
            </section>
            <section className="profile-v2-panel">
              <SectionTitle eyebrow="PREFERENCES" title="Dislikes"/>
              <TagGroup items={p.dislikes} negative/>
            </section>
          </>}
        </div>
        <aside className="profile-v2-side">
          {full&&<section className="profile-v2-panel profile-v2-dedication">
            <SectionTitle eyebrow="PERSONAL STATEMENT" title="Dedication"/>
            <span className="profile-v2-quote-mark" aria-hidden="true">“</span>
            <p>{p.dedication||"No dedication statement shared yet."}</p>
            <small>Written by this member · not independently verified</small>
          </section>}
          {full&&<section className="profile-v2-panel profile-v2-boundaries">
            <SectionTitle eyebrow="CONSENT FIRST" title="Boundaries & expectations"/>
            <p className="profile-v2-paragraph">{p.boundaries||"No additional boundaries listed."}</p>
          </section>}
          <section className="profile-v2-panel profile-v2-connection-info">
            <SectionTitle eyebrow="GETTING CONNECTED" title="Before you invite"/>
            <p>Review their interests and limits. An invitation creates no contract: the other member must accept, and any proposed terms require separate consent.</p>
          </section>
        </aside>
      </div>
    </div>}
    {active==="activity"&&<div className="profile-v2-content">
      <section className="profile-v2-panel profile-v2-tab-panel">
        <SectionTitle eyebrow="RECENT PARTICIPATION" title="Activity timeline"/>
        {hasActivity?(data.activity?.length?<ol className="profile-v2-activity-list">{data.activity.map((item,i)=>
          <li key={i}><span className="profile-v2-activity-dot" aria-hidden="true"/>
            <div><strong>{item.label}</strong><small>Recorded app action</small></div>
            <time dateTime={item.date}>{item.date}</time></li>)}</ol>:
          <p className="profile-v2-empty">No recorded activity yet.</p>):
          <div className="profile-v2-private-panel"><span aria-hidden="true">◇</span>
            <strong>Activity is private</strong><p>This member has not chosen to share their activity history.</p></div>}
        <p className="profile-v2-fineprint">When visible, activity shows only generic actions and dates. No partner identities, balances, or private notes.</p>
      </section>
    </div>}
    {active==="achievements"&&<div className="profile-v2-content">
      <section className="profile-v2-panel profile-v2-tab-panel">
        <SectionTitle eyebrow="EARNED IN THE APP" title="Achievements"/>
        {hasBadges?(data.badges?.length?<div className="profile-v2-badge-grid">{data.badges.map(b=>
          <div className="profile-v2-badge" key={b.id}>
            <span className="profile-v2-badge-icon" aria-hidden="true">{badgeSymbols[b.id]||"✦"}</span>
            <div><strong>{b.title}</strong><small>{b.description}</small></div></div>)}</div>:
          <p className="profile-v2-empty">No achievements earned yet.</p>):
          <div className="profile-v2-private-panel"><span aria-hidden="true">✦</span>
            <strong>Achievements are private</strong><p>This member has chosen not to share their earned badges.</p></div>}
        <p className="profile-v2-fineprint">Achievements are calculated from recorded app events. They cannot be awarded manually.</p>
      </section>
    </div>}
    <footer className="profile-v2-footer">Profile information is self-reported unless marked as verified app activity. All connections require mutual consent.</footer>
  </article>
}
export function ShowcaseViewer({handle}:{handle:string}){
  const [data,setData]=useState<ShowcaseResponse|null>(null)
  const [error,setError]=useState("")
  const [loading,setLoading]=useState(true)
  useEffect(()=>{
    let alive=true;setLoading(true);setError("");setData(null)
    void fetchShowcase(new URLSearchParams({handle}).toString()).then(value=>{if(alive)setData(value)})
      .catch(e=>{if(alive)setError(e instanceof Error?e.message:"Unable to show profile")})
      .finally(()=>{if(alive)setLoading(false)})
    return ()=>{alive=false}
  },[handle])
  return <div className="showcase-view">
    <div className="showcase-nav"><Link href="/dashboard">← Back to dashboard</Link><span>MEMBER PROFILE / VERIFIED PRIVACY</span></div>
    {loading?<div className="dash-card">Loading member profile…</div>:
      data?<MemberCard data={data}/>:
      <div className="dash-card"><h2>Profile unavailable</h2>
        <p className="muted">{error}. This member may be undiscoverable, blocked, or no longer available.</p>
        <Link className="btn btn-outline" href="/dashboard">Back to dashboard</Link>
      </div>}
  </div>
}
export function ShowcasePreviewModal({handle,onClose,onInvite,busy}:{handle:string;onClose:()=>void;onInvite:()=>void;busy:boolean}){
  const [data,setData]=useState<ShowcaseResponse|null>(null)
  const [error,setError]=useState("")
  useEffect(()=>{
    let alive=true;setData(null);setError("")
    void fetchShowcase(new URLSearchParams({handle}).toString())
      .then(value=>{if(alive)setData(value)})
      .catch(e=>{if(alive)setError(e instanceof Error?e.message:"Could not load this profile")})
    return ()=>{alive=false}
  },[handle])
  useEffect(()=>{
    function dismiss(event:KeyboardEvent){if(event.key==="Escape")onClose()}
    window.addEventListener("keydown",dismiss)
    return ()=>window.removeEventListener("keydown",dismiss)
  },[onClose])
  return <div className="profile-v2-modal-backdrop" onClick={onClose}>
    <div className="profile-v2-modal" role="dialog" aria-modal="true" aria-label={"Profile of @"+handle}
      onClick={event=>event.stopPropagation()}>
      <div className="profile-v2-modal-toolbar">
        <button type="button" className="btn btn-quiet" onClick={onClose}>← Back to results</button>
        <span>DISCOVER / MEMBER PROFILE</span>
        <button type="button" className="profile-v2-close" onClick={onClose} aria-label="Close profile preview">×</button>
      </div>
      {data?<MemberCard data={data} actions={<>
        <button type="button" className="btn btn-red" disabled={busy} onClick={onInvite}>Send invitation ↗</button>
        <span className="profile-v2-action-hint">They must accept before connecting.</span>
      </>}/>:
      <div className="profile-v2-modal-message">{error?
        <><h2>Profile unavailable</h2><p>{error}</p></>:
        <><h2>Loading profile…</h2><p>Checking what this member has chosen to share.</p></>}
      </div>}
    </div>
  </div>
}

function tags(input:string):string[]{
  return input.split(",").map(s=>s.trim()).filter(Boolean)
}
export function ProfileShowcaseEditor({handle,onNotify}:{handle:string;onNotify:(type:"pending"|"success"|"error",message:string)=>void}){
  const [data,setData]=useState<ShowcaseResponse|null>(null)
  const [fields,setFields]=useState<ShowcaseSettings>(defaults)
  const [likes,setLikes]=useState("")
  const [dislikes,setDislikes]=useState("")
  const [busy,setBusy]=useState(false)
  const [ready,setReady]=useState(false)
  const [savedVisible,setSavedVisible]=useState(false)
  useEffect(()=>{
    let alive=true
    void fetchShowcase("me=1").then(result=>{
      if(!alive)return
      setData(result)
      const p=result.profile
      setFields({
        displayName:p.displayName||"",tagline:p.tagline||"",likes:p.likes||[],
        dislikes:p.dislikes||[],dedication:p.dedication||"",boundaries:p.boundaries||"",
        showcaseEnabled:p.showcaseEnabled||false,showStats:p.showStats||false,
        showAchievements:p.showAchievements||false,showActivity:p.showActivity||false
      })
      setLikes((p.likes||[]).join(", "));setDislikes((p.dislikes||[]).join(", "))
      setSavedVisible(Boolean(p.showcaseEnabled&&p.discoverable))
      setReady(true)
    }).catch(error=>{if(alive)onNotify("error",error instanceof Error?error.message:"Unable to load showcase")})
    return ()=>{alive=false}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[handle])
  async function save(event:FormEvent){
    event.preventDefault()
    if(busy)return
    setBusy(true);onNotify("pending","Saving your showcase preferences…")
    try{
      const body={...fields,likes:tags(likes),dislikes:tags(dislikes)}
      const response=await fetch("/api/showcase",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
      })
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw Error(result.error||"Could not save showcase")
      const fresh=await fetchShowcase("me=1")
      setData(fresh);setFields(body);setSavedVisible(Boolean(body.showcaseEnabled&&fresh.profile.discoverable))
      onNotify("success",result.message||"Showcase saved")
    }catch(e){onNotify("error",e instanceof Error?e.message:"Could not save showcase")}
    finally{setBusy(false)}
  }
  function set<K extends keyof ShowcaseSettings>(name:K,value:ShowcaseSettings[K]){
    setFields(current=>({...current,[name]:value}))
  }
  return <div className="showcase-editor">
    <div className="showcase-editor-title"><div><span className="eyebrow">02 / PERSONAL SHOWCASE</span>
      <h2>Show who you are before connecting.</h2>
      <p className="muted">Share likes, dislikes, boundaries and your approach to collaboration. Verified badges come from app activity, not manually claimed rankings.</p></div>
      {savedVisible&&<Link className="btn btn-outline" href={"/u/"+encodeURIComponent(handle)}>View my member page ↗</Link>}
    </div>
    {!ready?<div className="dash-card">Loading your profile customization…</div>:
    <div className="showcase-editor-grid">
      <form className="dash-card form-stack showcase-edit-form" onSubmit={e=>void save(e)}>
        <label>DISPLAY NAME<input maxLength={40} value={fields.displayName}
          placeholder="How you'd like others to address you" onChange={e=>set("displayName",e.target.value)}/></label>
        <label>PROFILE HEADLINE<input maxLength={120} value={fields.tagline}
          placeholder="A short introduction to your interests and style" onChange={e=>set("tagline",e.target.value)}/></label>
        <label>LIKES / INTERESTS (COMMA-SEPARATED)<textarea rows={2} maxLength={450} value={likes}
          placeholder="Cooperative games, creative challenges, clear communication"
          onChange={e=>setLikes(e.target.value)}/></label>
        <label>DISLIKES (COMMA-SEPARATED)<textarea rows={2} maxLength={450} value={dislikes}
          placeholder="Unclear expectations, disrespect, pressure"
          onChange={e=>setDislikes(e.target.value)}/></label>
        <label>DEDICATION / APPROACH<textarea rows={3} maxLength={400} value={fields.dedication}
          placeholder="What you value in a consensual partnership…"
          onChange={e=>set("dedication",e.target.value)}/></label>
        <label>BOUNDARIES & EXPECTATIONS<textarea rows={3} maxLength={400} value={fields.boundaries}
          placeholder="Boundaries, expectations, or deal-breakers you choose to share"
          onChange={e=>set("boundaries",e.target.value)}/></label>
        <div className="showcase-privacy">
          <strong>Visibility controls</strong>
          <label className="check-label"><input type="checkbox" checked={fields.showcaseEnabled}
            onChange={e=>set("showcaseEnabled",e.target.checked)}/>
            <span>Show my profile details to other signed-in adult members when discovery is enabled</span></label>
          <label className="check-label"><input type="checkbox" checked={fields.showStats}
            onChange={e=>set("showStats",e.target.checked)}/>
            <span>Share my aggregated app statistics</span></label>
          <label className="check-label"><input type="checkbox" checked={fields.showAchievements}
            onChange={e=>set("showAchievements",e.target.checked)}/>
            <span>Share automatically earned achievements</span></label>
          <label className="check-label"><input type="checkbox" checked={fields.showActivity}
            onChange={e=>set("showActivity",e.target.checked)}/>
            <span>Share recent generic activities (date only)</span></label>
        </div>
        {!data?.profile.discoverable&&<p className="showcase-visibility-warning">
          Your account is hidden from discovery. Enable "Show my profile in discovery" in the identity form above to make this showcase visible.</p>}
        <button className="btn btn-red" type="submit" disabled={busy}>Save showcase preferences</button>
      </form>
      <div><div className="eyebrow showcase-preview-label">YOUR PRIVATE PREVIEW</div>
        {data&&<MemberCard preview data={{...data,profile:{
          ...data.profile,displayName:fields.displayName,tagline:fields.tagline,
          likes:tags(likes),dislikes:tags(dislikes),
          dedication:fields.dedication,boundaries:fields.boundaries
        }}}/>}
      </div>
    </div>}
  </div>
}
