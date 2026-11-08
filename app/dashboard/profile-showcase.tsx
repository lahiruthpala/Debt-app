"use client"
import Link from "next/link"
import {useEffect,useState,type FormEvent} from "react"
import type {ShowcaseSettings,ShowcaseStats,ShowcaseBadge} from "@/lib/showcase"

type PublicProfile={
  handle:string;role:"dom"|"sub";bio:string;displayName:string;tagline:string;
  likes:string[];dislikes:string[];dedication:string;boundaries:string;
  discoverable:boolean;showcaseEnabled:boolean;showStats:boolean;
  showAchievements:boolean;showActivity:boolean;updatedAt?:string
}
type ActivityItem={label:string;date:string}
type ShowcaseResponse={profile:PublicProfile;stats?:ShowcaseStats;badges?:ShowcaseBadge[];activity?:ActivityItem[]}
const defaults:ShowcaseSettings={
  displayName:"",tagline:"",likes:[],dislikes:[],dedication:"",boundaries:"",
  showcaseEnabled:false,showStats:false,showAchievements:false,showActivity:false
}
const badges:Record<string,string>={"first-agreement":"✦","consistent-partner":"◆","first-game":"⚄",
  "active-player":"✺","verified-task":"✓","verified-evidence":"◈","trusted-reviewer":"♢","creator":"✎"}
const statLabels:Record<keyof ShowcaseStats,string>={
  acceptedAgreements:"Accepted contracts",gameActions:"Game actions",
  tasksApproved:"Approved tasks",proofsApproved:"Proofs approved",
  proofsReviewed:"Reviews completed",publishedTemplates:"Published templates"
}
async function fetchShowcase(query:string):Promise<ShowcaseResponse>{
  const response=await fetch("/api/showcase?"+query,{cache:"no-store"})
  const body=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(body.error||"Unable to load member profile")
  return body as ShowcaseResponse
}
function MemberCard({data,preview=false}:{data:ShowcaseResponse;preview?:boolean}){
  const p=data.profile
  return <div className="showcase-card">
    <div className="showcase-cover" aria-hidden="true"><span>◆</span><span>✦</span><span>◇</span></div>
    <div className="showcase-identity">
      <div className="showcase-avatar">{(p.displayName||p.handle).slice(0,1).toUpperCase()}</div>
      <div><span className="eyebrow">MEMBER SHOWCASE {preview?"· OWNER PREVIEW":""}</span>
        <h2>{p.displayName||p.handle}</h2>
        <p className="showcase-handle">@{p.handle} <span className="mini-label">{p.role.toUpperCase()}</span></p>
        <p className="showcase-tagline">{p.tagline||"Building thoughtful, consensual connections."}</p>
      </div>
    </div>
    {p.bio&&<p className="showcase-about">{p.bio}</p>}
    <div className="showcase-sections">
      <section className="showcase-section"><h3>Likes & interests</h3>
        {p.likes.length?<div className="showcase-chips">{p.likes.map((tag,i)=><span key={i} className="showcase-chip">{tag}</span>)}</div>:
          <p className="muted">No public interests yet.</p>}
      </section>
      <section className="showcase-section"><h3>Dislikes & boundaries</h3>
        {p.dislikes.length?<div className="showcase-chips">{p.dislikes.map((tag,i)=><span key={i} className="showcase-chip negative">{tag}</span>)}</div>:
          <p className="muted">No dislikes listed.</p>}
        {p.boundaries&&<p className="showcase-note"><strong>Personal limits</strong>{p.boundaries}</p>}
      </section>
      {p.dedication&&<section className="showcase-section showcase-wide"><h3>Dedication</h3>
        <p className="showcase-dedication">{p.dedication}</p>
        <small>Written by this member; not independently verified.</small>
      </section>}
      {data.stats&&<section className="showcase-section showcase-wide">
        <h3>Recorded statistics</h3>
        <div className="showcase-stats">{(Object.keys(statLabels) as (keyof ShowcaseStats)[]).map(k=>
          <div key={k} className="showcase-stat"><strong>{data.stats?.[k]??0}</strong><small>{statLabels[k]}</small></div>)}</div>
        <p className="showcase-footnote">Counts come from in-app records, not self-reported claims. No partner identities or balances are shared.</p>
      </section>}
      {data.badges&&<section className="showcase-section showcase-wide"><h3>Achievements</h3>
        {data.badges.length?<div className="showcase-achievements">{data.badges.map(b=>
          <div className="showcase-achievement" key={b.id}><span aria-hidden="true">{badges[b.id]||"✦"}</span>
            <div><strong>{b.title}</strong><small>{b.description}</small></div></div>)}</div>:
          <p className="muted">Earned achievements will appear as activities are completed.</p>}
      </section>}
      {data.activity&&<section className="showcase-section showcase-wide"><h3>Recent activity</h3>
        {data.activity.length?<div className="showcase-timeline">{data.activity.map((a,i)=>
          <div key={i}><span>{a.label}</span><time dateTime={a.date}>{a.date}</time></div>)}</div>:
          <p className="muted">No recorded activity yet.</p>}
        <p className="showcase-footnote">Only generic activity descriptions and dates are shown.</p>
      </section>}
    </div>
    <div className="showcase-disclaimer">Profile details are member-submitted. Activity and achievements reflect in-app records only.
      Connections and contracts still require explicit mutual consent.</div>
  </div>
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
    <div className="showcase-nav"><Link href="/dashboard">← Back to dashboard</Link><span>MEMBER IDENTITY · OPT-IN</span></div>
    {loading?<div className="dash-card">Loading member showcase…</div>:
      data?<MemberCard data={data}/>:
      <div className="dash-card"><h2>Profile unavailable</h2>
        <p className="muted">{error}. The member may have disabled their showcase or discovery.</p>
        <Link className="btn btn-outline" href="/login">Sign in to view member profiles</Link>
      </div>}
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
