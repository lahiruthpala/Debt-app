"use client"
import {useCallback,useEffect,useState,type FormEvent} from "react"
import {campaignKinds,campaignActivitySchema,type CampaignActivity,type CampaignDefinition,progressPercent} from "@/lib/campaigns"
import {interestGroups} from "@/lib/showcase"

type Role="dom"|"sub"
type Feedback=(kind:"pending"|"success"|"error",message:string)=>void
type Summary={id:string;title:string;description?:string;kind:string;category?:string;status?:string;visibility?:string;
  creator_handle:string;creator_id?:string;has_cover?:boolean;goal:number;total?:number;members?:number;ends_at?:string|null;membership_status?:string;following?:boolean}
type Member={id:string;member_id:string;status:string;anonymous:boolean;leaderboard_opt_in:boolean;personal_cap:number;handle:string;created_at:string}
type Activity={id:string;kind:string;config:CampaignActivity;state:string}
type Contribution={id:string;amount:number;status:string;created_at:string;note:string;review_note:string;member_handle:string|null;evidence_count:number}
type Claim={id:string;activity_id:string;status:string;note:string;points:number;review_note:string;member_handle:string;evidence_count:number}
type Post={id:string;kind:string;content:string;parent_id:string|null;display_handle:string;created_at:string;reactions:number;reacted:boolean;is_mine:boolean}
type Detail={campaign:CampaignDefinition & {id:string;creator_id:string;creator_handle:string;status:string;published_at:string|null;
  starts_at:string|null;ends_at:string|null;join_policy:string;terms_version:number;min_contribution:number;max_contribution:number;
  max_per_member:number;member_limit:number;require_contribution_proof:boolean;allow_anonymous:boolean;leaderboard_enabled:boolean;
  allow_comments:boolean;milestones:{title:string;threshold:number}[];tags:string[];has_cover?:boolean};
  totals:{total:number;members:number;contributors:number;progress:number};
  isCreator:boolean;membership:{status:string;anonymous:boolean;leaderboard_opt_in:boolean;personal_cap:number}|null;
  following:boolean;creatorFollowing:boolean;activities:Activity[];posts:Post[];leaderboard:{handle:string;points:number;total:number}[];
  contributions:Contribution[];claims:Claim[];memberQueue:Member[];votes:{activity_id:string;choice_index:number;votes:number}[]}
type Props={role:Role;onNotify:Feedback}
const types:{id:string;title:string;summary:string;icon:string}[]=[
  {id:"tribute",title:"Open Tribute",summary:"Voluntary fictional contributions",icon:"◇"},
  {id:"goal",title:"Goal Campaign",summary:"Collective milestones and progress",icon:"◎"},
  {id:"challenge",title:"Challenge Campaign",summary:"Tasks and games for points",icon:"✦"},
  {id:"competition",title:"Competition",summary:"Opt-in ranked achievements",icon:"♕"},
  {id:"event",title:"Timed Event",summary:"Scheduled community activity",icon:"◷"}]
const initial=():CampaignDefinition=>({
  title:"The Velvet Treasury",description:"A voluntary campaign for shared fictional milestones, tasks and creative play.",
  rules:"All contributions are fictional, voluntary and irreversible as simulation records only. Participation can end at any time without penalty. No real payments or physical restrictions.",
  kind:"goal",visibility:"public",joinPolicy:"open",category:"Community",
  tags:[],startAt:null,endAt:null,goal:100000,minContribution:100,maxContribution:10000,
  maxPerMember:100000,memberLimit:1000,requireContributionProof:false,allowAnonymous:true,
  leaderboardEnabled:true,allowComments:true,milestones:[{title:"First milestone",threshold:25000},
  {title:"Community achievement",threshold:50000}],activities:[]
})
const shortDate=(v:string|null|undefined)=>v?new Date(v).toLocaleString(undefined,{day:"numeric",month:"short",year:"numeric"}):"Open-ended"
const credit=(v:number)=>Number(v||0).toLocaleString()+" fictional LKR"
const localDate=(iso:string|null)=>{if(!iso)return "";const d=new Date(iso),p=(n:number)=>String(n).padStart(2,"0")
  return d.getFullYear()+"-"+p(d.getMonth()+1)+"-"+p(d.getDate())+"T"+p(d.getHours())+":"+p(d.getMinutes())}
async function get(view:string,args:Record<string,string>={}):Promise<any>{
  const r=await fetch("/api/campaigns?"+new URLSearchParams({view,...args}),{cache:"no-store"})
  const d=await r.json().catch(()=>({}))
  if(!r.ok)throw Error(d.error||"Campaign request failed")
  return d
}
async function post(action:string,args:Record<string,unknown>):Promise<any>{
  const r=await fetch("/api/campaigns",{method:"POST",headers:{"Content-Type":"application/json"},
    body:JSON.stringify({action,...args})})
  const d=await r.json().catch(()=>({}))
  if(!r.ok)throw Error(d.error||"Campaign action failed")
  return d
}
function Evidence({campaignId,kind,targetId,isOwner,onNotify}:{campaignId:string;kind:"task"|"contribution";
  targetId:string;isOwner:boolean;onNotify:Feedback}){
  const [items,setItems]=useState<{id:string;content_type:string;bytes:number}[]>([])
  const [file,setFile]=useState<File|null>(null)
  const [consent,setConsent]=useState(false)
  const [busy,setBusy]=useState(false)
  const load=useCallback(async()=>{
    const r=await fetch("/api/campaign-evidence?"+new URLSearchParams({view:"list",campaignId,kind,targetId}),{cache:"no-store"})
    const d=await r.json().catch(()=>({}));if(r.ok)setItems(d.evidence||[])
  },[campaignId,kind,targetId])
  useEffect(()=>{void load()},[load])
  async function upload(e:FormEvent){
    e.preventDefault();if(!file||!consent)return
    setBusy(true)
    try{
      const data=new FormData()
      data.set("campaignId",campaignId);data.set("kind",kind);data.set("targetId",targetId)
      data.set("file",file);data.set("consent","yes")
      const r=await fetch("/api/campaign-evidence",{method:"POST",body:data})
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw Error(d.error||"Upload rejected")
      setFile(null);setConsent(false);await load();onNotify("success",d.message)
    }catch(e){onNotify("error",e instanceof Error?e.message:"Unable to upload evidence")}
    finally{setBusy(false)}
  }
  async function erase(id:string){
    try{
      const r=await fetch("/api/campaign-evidence",{method:"DELETE",headers:{"Content-Type":"application/json"},body:JSON.stringify({id})})
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw Error(d.error||"Delete failed")
      await load();onNotify("success","Evidence erased")
    }catch(e){onNotify("error",e instanceof Error?e.message:"Delete failed")}
  }
  return <section className="campaign-evidence">
    <small className="muted">Private evidence · only the creator and uploader can access files</small>
    {items.map(item=><div className="campaign-evidence-file" key={item.id}>
      <a href={"/api/campaign-evidence?"+new URLSearchParams({view:"file",id:item.id})}
        target="_blank" rel="noopener noreferrer">{item.content_type==="application/pdf"?"Download PDF":"View image"} ({Math.ceil(item.bytes/1024)} KB)</a>
      {isOwner&&<button type="button" className="btn btn-outline" onClick={()=>void erase(item.id)}>Erase</button>}
    </div>)}
    {isOwner&&items.length<3&&<form className="campaign-proof-form" onSubmit={e=>void upload(e)}>
      <input aria-label="Private proof image or PDF" type="file" accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={e=>setFile(e.target.files?.[0]||null)}/>
      <label className="campaign-check"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        <span>I voluntarily share non-explicit evidence with the creator. No IDs, intimate images or third-party photos.</span></label>
      <button type="submit" className="btn btn-outline" disabled={!file||!consent||busy}>{busy?"Uploading...":"Upload private proof"}</button>
    </form>}
  </section>
}

export default function CampaignHub({role,onNotify}:Props){
  const [view,setView]=useState<"discover"|"mine"|"create"|"notifications"|"detail">("discover")
  const [list,setList]=useState<Summary[]>([])
  const [mine,setMine]=useState<Summary[]>([])
  const [notifications,setNotifications]=useState<{id:string;campaign_id:string;title:string;read_at:string|null}[]>([])
  const [selected,setSelected]=useState("")
  const [detail,setDetail]=useState<Detail|null>(null)
  const [form,setForm]=useState<CampaignDefinition>(initial)
  const [editing,setEditing]=useState<string|null>(null)
  const [q,setQ]=useState("")
  const [kindFilter,setKindFilter]=useState("all")
  const [tag,setTag]=useState("")
  const [busy,setBusy]=useState(false)
  const [anonymous,setAnonymous]=useState(true)
  const [leaderboard,setLeaderboard]=useState(false)
  const [personalCap,setPersonalCap]=useState(100000)
  const [amount,setAmount]=useState(1000)
  const [contributionNote,setContributionNote]=useState("")
  const [taskNotes,setTaskNotes]=useState<Record<string,string>>({})
  const [feedText,setFeedText]=useState("")
  const [replyTo,setReplyTo]=useState<string|null>(null)
  const [inviteHandle,setInviteHandle]=useState("")
  const [reportText,setReportText]=useState("")
  const [reviewNotes,setReviewNotes]=useState<Record<string,string>>({})
  const [gameResult,setGameResult]=useState("")
  const [coverFile,setCoverFile]=useState<File|null>(null)
  const [coverConsent,setCoverConsent]=useState(false)
  const [openProofs,setOpenProofs]=useState<string[]>([])
  const refreshLists=useCallback(async()=>{
    const [a,b]=await Promise.all([get("discover",{q,kind:kindFilter,tag}),get("mine")])
    setList(a.campaigns||[]);setMine(b.campaigns||[])
  },[q,kindFilter,tag])
  const loadDetail=useCallback(async(id:string)=>{
    const d=await get("detail",{id})
    setDetail(d);setSelected(id)
    setAnonymous(d.membership?.anonymous??d.campaign.allow_anonymous)
    setLeaderboard(d.membership?.leaderboard_opt_in??false)
    setPersonalCap(d.membership?.personal_cap??Math.min(100000,d.campaign.max_per_member))
    setAmount(d.campaign.min_contribution)
  },[])
  useEffect(()=>{
    void refreshLists().catch(e=>onNotify("error",e instanceof Error?e.message:"Campaigns unavailable"))
  },[refreshLists]) // Search requests are scoped to the current adult account.
  useEffect(()=>{
    const id=new URLSearchParams(window.location.search).get("campaign")
    if(id&&/^[a-f0-9-]{36}$/i.test(id)){
      void loadDetail(id).then(()=>setView("detail")).catch(()=>{})
    }
  },[loadDetail])
  async function run(action:string,data:Record<string,unknown>={},reload=true):Promise<any>{
    setBusy(true)
    try{
      const result=await post(action,{campaignId:selected,...data})
      onNotify("success",result.message||"Campaign updated")
      if(reload){
        if(selected)await loadDetail(selected)
        await refreshLists()
      }
      return result
    }catch(e){onNotify("error",e instanceof Error?e.message:"Campaign action failed");return null}
    finally{setBusy(false)}
  }
  async function open(id:string){
    try{
      setBusy(true);await loadDetail(id);setView("detail");setGameResult("")
      const url=new URL(window.location.href);url.searchParams.set("campaign",id)
      window.history.replaceState(null,"",url.toString())
    }catch(e){onNotify("error",e instanceof Error?e.message:"Campaign unavailable")}
    finally{setBusy(false)}
  }
  function show(viewName:"discover"|"mine"|"create"|"notifications"){
    const url=new URL(window.location.href);url.searchParams.delete("campaign")
    window.history.replaceState(null,"",url.toString());setView(viewName);setDetail(null);setSelected("")
  }
  async function save(e:FormEvent){
    e.preventDefault();setBusy(true)
    try{
      const d=await post(editing?"edit":"create",editing?{campaignId:editing,definition:form}:{definition:form})
      onNotify("success",d.message)
      const id=editing||d.id
      await refreshLists();setEditing(null);await open(id)
    }catch(e){onNotify("error",e instanceof Error?e.message:"Invalid campaign configuration")}
    finally{setBusy(false)}
  }
  async function uploadCover(e:FormEvent){
    e.preventDefault();if(!coverFile||!coverConsent||!selected)return
    setBusy(true)
    try{
      const form=new FormData()
      form.set("campaignId",selected);form.set("file",coverFile);form.set("consent","yes")
      const r=await fetch("/api/campaign-cover",{method:"POST",body:form})
      const d=await r.json().catch(()=>({}))
      if(!r.ok)throw Error(d.error||"Cover upload rejected")
      setCoverFile(null);setCoverConsent(false)
      await loadDetail(selected);onNotify("success",d.message)
    }catch(e){onNotify("error",e instanceof Error?e.message:"Unable to upload cover")}
    finally{setBusy(false)}
  }
  function editCurrent(){
    if(!detail||detail.campaign.status!=="draft")return
    const c=detail.campaign
    setForm({title:c.title,description:c.description,rules:c.rules,kind:c.kind,visibility:c.visibility,
      joinPolicy:c.join_policy as CampaignDefinition["joinPolicy"],category:c.category,tags:c.tags||[],
      startAt:c.starts_at,endAt:c.ends_at,goal:Number(c.goal),minContribution:c.min_contribution,
      maxContribution:c.max_contribution,maxPerMember:Number(c.max_per_member),memberLimit:c.member_limit,
      requireContributionProof:c.require_contribution_proof,allowAnonymous:c.allow_anonymous,
      leaderboardEnabled:c.leaderboard_enabled,allowComments:c.allow_comments,
      milestones:c.milestones||[],activities:detail.activities.map(a=>a.config)})
    setEditing(c.id);setView("create")
  }
  function addActivity(type:CampaignActivity["type"]){
    const activity:CampaignActivity=type==="task"?{type:"task",title:"Complete a community task",points:100,
      proofRequired:false,maxCompletionsPerMember:1}:type==="game"?{type:"game",title:"Daily chance game",
      game:"coin",pointsWin:50,pointsLose:10,cooldownHours:24}:{
        type:"poll",title:"Community vote",choices:["Option A","Option B"]}
    setForm(s=>({...s,activities:[...s.activities,activity]}))
  }
  function changeActivity(i:number,x:CampaignActivity){
    setForm(s=>({...s,activities:s.activities.map((a,j)=>j===i?x:a)}))
  }
  function toggleProof(key:string){setOpenProofs(v=>v.includes(key)?v.filter(x=>x!==key):[...v,key])}
  const campaign=detail?.campaign,member=detail?.membership
  const participating=member?.status==="active"
  return <div className="campaign-hub">
    <div className="campaign-toolbar">
      <div><span className="eyebrow">COMMUNITY · CONSENT FIRST</span>
        <h2>Campaigns</h2><p className="muted">One Dom, many voluntary Subs. Social challenges and fictional contributions, never real payments.</p></div>
      <div className="campaign-tabs">
        <button className={"btn "+(view==="discover"?"btn-red":"btn-outline")} onClick={()=>show("discover")}>Discover</button>
        <button className={"btn "+(view==="mine"?"btn-red":"btn-outline")} onClick={()=>{show("mine");void refreshLists()}}>My campaigns</button>
        {role==="dom"&&<button className={"btn "+(view==="create"?"btn-red":"btn-outline")}
          onClick={()=>{setEditing(null);setForm(initial());show("create")}}>+ Create</button>}
        <button className={"btn "+(view==="notifications"?"btn-red":"btn-outline")}
          onClick={()=>{show("notifications");void get("notifications").then(d=>setNotifications(d.notifications||[])).catch(e=>onNotify("error",e.message))}}>
          Alerts</button>
      </div>
    </div>

    {view==="discover"&&<>
      <form className="campaign-filters" onSubmit={e=>{e.preventDefault();void refreshLists()}}>
        <input aria-label="Search campaigns" placeholder="Search campaigns or creators" value={q} onChange={e=>setQ(e.target.value)}/>
        <select aria-label="Campaign type" value={kindFilter} onChange={e=>setKindFilter(e.target.value)}>
          <option value="all">All types</option>{types.map(t=><option key={t.id} value={t.id}>{t.title}</option>)}
        </select>
        <select aria-label="Interest filter" value={tag} onChange={e=>setTag(e.target.value)}>
          <option value="">All interests</option>{interestGroups.flatMap(g=>g.labels.map(t=><option key={t} value={t}>{t}</option>))}
        </select>
        <button className="btn btn-outline">Search</button>
      </form>
      <div className="campaign-grid">{list.map(c=><button key={c.id} className="campaign-discovery-card" onClick={()=>void open(c.id)}>
        <span className="campaign-kind">{types.find(t=>t.id===c.kind)?.icon||"◇"} {types.find(t=>t.id===c.kind)?.title||c.kind}</span>
        {c.has_cover&&<img className="campaign-card-cover" src={"/api/campaign-cover?id="+c.id} alt={"Campaign artwork for "+c.title}/>}
        <strong>{c.title}</strong><small>by @{c.creator_handle}</small><p>{c.description}</p>
        <div className="campaign-meter"><div style={{width:progressPercent(Number(c.total),c.goal)+"%"}}/></div>
        <div className="campaign-card-footer"><span>{credit(Number(c.total||0))}</span><span>{c.members||0} joined</span></div>
        <span className="campaign-card-footer muted">Ends: {shortDate(c.ends_at)}</span>
      </button>)}</div>
      {list.length===0&&<div className="dash-card"><h3>No campaigns found</h3><p className="muted">Try removing search filters or checking again later.</p></div>}
    </>}

    {view==="mine"&&<div className="campaign-grid">{mine.map(c=><button key={c.id} className="campaign-discovery-card" onClick={()=>void open(c.id)}>
      <span className="campaign-kind">{c.kind} · {c.status||c.membership_status}</span><strong>{c.title}</strong>
      <small>by @{c.creator_handle}</small><p>{c.creator_id?"Manage your campaign or participation.":"View campaign activity."}</p>
      <div className="campaign-card-footer"><span>{c.membership_status?"Participation: "+c.membership_status:"Creator"}</span>
      {c.following&&<span>Following</span>}</div>
    </button>)}
      {mine.length===0&&<div className="dash-card">You have not created, joined or followed any campaigns.</div>}
    </div>}

    {view==="notifications"&&<div className="dash-card">
      <h3>Campaign notifications</h3>
      {notifications.length===0?<p className="muted">No alerts yet.</p>:notifications.map(n=><div className="campaign-notice" key={n.id}>
        <button className="campaign-text-btn" onClick={()=>void open(n.campaign_id)}>{n.title}</button>
        {!n.read_at&&<button className="btn btn-outline" disabled={busy} onClick={()=>void post("mark_read",{campaignId:n.campaign_id,notificationId:n.id})
          .then(()=>get("notifications")).then(d=>setNotifications(d.notifications||[])).catch(e=>onNotify("error",e.message))}>Mark read</button>}
      </div>)}
    </div>}

    {view==="create"&&<form className="campaign-editor" onSubmit={e=>void save(e)}>
      <div className="dash-card">
        <div className="eyebrow">{editing?"EDIT DRAFT":"CAMPAIGN CREATOR"}</div><h3>Design your campaign</h3>
        <p className="muted">Drafts can change before publishing. Published rules become immutable and participation always requires individual consent.</p>
        <div className="campaign-type-grid">{types.map(t=><button type="button" key={t.id}
          className={"campaign-type "+(form.kind===t.id?"selected":"")}
          onClick={()=>setForm(s=>({...s,kind:t.id as CampaignDefinition["kind"],goal:s.goal||100000}))}>
          <strong>{t.icon} {t.title}</strong><small>{t.summary}</small>
        </button>)}</div>
        <div className="campaign-field-grid">
          <label>Campaign name<input required minLength={3} maxLength={100} value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></label>
          <label>Category<input required maxLength={40} value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label>
        </div>
        <label>Description<textarea required rows={3} maxLength={2000} value={form.description}
          onChange={e=>setForm({...form,description:e.target.value})}/></label>
        <label>Participation rules and boundaries<textarea required rows={5} maxLength={5000} value={form.rules}
          onChange={e=>setForm({...form,rules:e.target.value})}/></label>
        <div className="campaign-field-grid">
          <label>Visibility<select value={form.visibility} onChange={e=>setForm(s=>({...s,visibility:e.target.value as CampaignDefinition["visibility"],
            joinPolicy:e.target.value==="restricted"?"invite":s.joinPolicy}))}>
            <option value="public">Public discovery</option><option value="unlisted">Unlisted · link only</option>
            <option value="restricted">Restricted · invitees only</option></select></label>
          <label>Joining<select value={form.joinPolicy} onChange={e=>setForm({...form,joinPolicy:e.target.value as CampaignDefinition["joinPolicy"]})}>
            <option value="open" disabled={form.visibility==="restricted"}>Open participation</option>
            <option value="approval" disabled={form.visibility==="restricted"}>Creator approval</option>
            <option value="invite">Invitation only</option></select></label>
          <label>Start date and time (optional)<input type="datetime-local" value={localDate(form.startAt)}
            onChange={e=>setForm({...form,startAt:e.target.value?new Date(e.target.value).toISOString():null})}/></label>
          <label>End date and time (optional)<input type="datetime-local" value={localDate(form.endAt)}
            onChange={e=>setForm({...form,endAt:e.target.value?new Date(e.target.value).toISOString():null})}/></label>
        </div>
        <label>Interests (up to 8)<select value="" onChange={e=>{const v=e.target.value;if(v&&!form.tags.includes(v)&&form.tags.length<8)
          setForm({...form,tags:[...form.tags,v]})}}><option value="">Select from predefined labels</option>
          {interestGroups.flatMap(g=>g.labels.map(t=><option key={t} value={t}>{t}</option>))}</select></label>
        <div className="campaign-chips">{form.tags.map(t=><button key={t} type="button" className="campaign-chip"
          onClick={()=>setForm({...form,tags:form.tags.filter(x=>x!==t)})}>{t} ×</button>)}</div>
      </div>
      <div className="dash-card"><h3>Goal, contribution limits and audience</h3>
        <p className="muted">All amounts represent imaginary LKR only. This app neither receives nor sends money.</p>
        <div className="campaign-field-grid">
          {([["goal","Collective goal (0 means no goal)"],["minContribution","Minimum per contribution"],["maxContribution","Maximum per contribution"],
            ["maxPerMember","Maximum per member"],["memberLimit","Participant capacity"]] as const).map(([key,label])=>
            <label key={key}>{label}<input type="number" min={key==="goal"?0:1} max={key==="memberLimit"?10000:key==="goal"||key==="maxPerMember"?100000000:1000000}
              value={form[key]} onChange={e=>setForm({...form,[key]:Number(e.target.value)})}/></label>)}
        </div>
        <div className="campaign-checks">
          {([["requireContributionProof","Require reviewable proof before contribution approval"],
            ["allowAnonymous","Permit anonymous contribution displays"],["leaderboardEnabled","Enable opt-in leaderboard"],
            ["allowComments","Enable member comments"]] as const).map(([key,label])=>
            <label className="campaign-check" key={key}><input type="checkbox" checked={form[key]}
              onChange={e=>setForm({...form,[key]:e.target.checked})}/><span>{label}</span></label>)}
        </div>
      </div>
      <div className="dash-card"><h3>Collective milestones</h3>
        {form.milestones.map((m,i)=><div className="campaign-field-grid" key={i}>
          <label>Milestone title<input value={m.title} maxLength={100} onChange={e=>setForm({...form,milestones:form.milestones.map((x,j)=>j===i?{...x,title:e.target.value}:x)})}/></label>
          <label>Fictional target<input type="number" min={1} value={m.threshold}
            onChange={e=>setForm({...form,milestones:form.milestones.map((x,j)=>j===i?{...x,threshold:Number(e.target.value)}:x)})}/></label>
          <button className="btn btn-outline" type="button" onClick={()=>setForm({...form,milestones:form.milestones.filter((_,j)=>j!==i)})}>Remove</button>
        </div>)}
        <button className="btn btn-outline" type="button" disabled={form.milestones.length>=12}
          onClick={()=>setForm({...form,milestones:[...form.milestones,{title:"New milestone",threshold:form.goal||10000}]})}>+ Milestone</button>
      </div>
      <div className="dash-card"><h3>Tasks, games and polls</h3>
        <p className="muted">Activities are server-validated. Game points are independent of contract debts.</p>
        {form.activities.map((a,i)=><div className="campaign-activity-editor" key={i}>
          <div className="campaign-row-between"><strong>{a.type.toUpperCase()} #{i+1}</strong>
            <button type="button" className="btn btn-outline" onClick={()=>setForm({...form,activities:form.activities.filter((_,j)=>i!==j)})}>Remove</button></div>
          <label>Title<input value={a.title} maxLength={100} onChange={e=>changeActivity(i,{...a,title:e.target.value})}/></label>
          {a.type==="task"&&<>
            <div className="campaign-field-grid"><label>Points<input type="number" min={0} max={1000} value={a.points}
              onChange={e=>changeActivity(i,{...a,points:Number(e.target.value)})}/></label>
              <label>Completions per member<input type="number" min={1} max={20} value={a.maxCompletionsPerMember}
                onChange={e=>changeActivity(i,{...a,maxCompletionsPerMember:Number(e.target.value)})}/></label></div>
            <label className="campaign-check"><input type="checkbox" checked={a.proofRequired}
              onChange={e=>changeActivity(i,{...a,proofRequired:e.target.checked})}/>Require private task evidence</label>
          </>}
          {a.type==="game"&&<>
            <div className="campaign-field-grid">
              <label>Game<select value={a.game} onChange={e=>changeActivity(i,{...a,game:e.target.value as "coin"|"dice"|"wheel"})}>
                <option value="coin">Coin flip</option><option value="dice">Dice roll</option><option value="wheel">Fortune wheel</option></select></label>
              <label>Hours between plays<input type="number" min={1} max={168} value={a.cooldownHours}
                onChange={e=>changeActivity(i,{...a,cooldownHours:Number(e.target.value)})}/></label>
              <label>Winning points<input type="number" min={0} max={500} value={a.pointsWin}
                onChange={e=>changeActivity(i,{...a,pointsWin:Number(e.target.value)})}/></label>
              <label>Other result points<input type="number" min={0} max={500} value={a.pointsLose}
                onChange={e=>changeActivity(i,{...a,pointsLose:Number(e.target.value)})}/></label>
            </div>
            {a.game==="wheel"&&<label>Wheel labels (comma-separated, 2–12)<input
              value={(a.wheelLabels||["Lucky","Bonus","Try again","Surprise"]).join(",")}
              onChange={e=>changeActivity(i,{...a,wheelLabels:e.target.value.split(",").map(x=>x.trim()).filter(Boolean)})}/></label>}
          </>}
          {a.type==="poll"&&<label>Poll choices (one per line, 2–8)<textarea rows={4} value={a.choices.join("\n")}
            onChange={e=>changeActivity(i,{...a,choices:e.target.value.split("\n").map(x=>x.trim()).filter(Boolean)})}/></label>}
        </div>)}
        <div className="campaign-actions">
          <button type="button" className="btn btn-outline" disabled={form.activities.length>=20} onClick={()=>addActivity("task")}>+ Task</button>
          <button type="button" className="btn btn-outline" disabled={form.activities.length>=20} onClick={()=>addActivity("game")}>+ Game</button>
          <button type="button" className="btn btn-outline" disabled={form.activities.length>=20} onClick={()=>addActivity("poll")}>+ Poll</button>
        </div>
      </div>
      <div className="campaign-actions"><button className="btn btn-red" disabled={busy}>{busy?"Saving...":editing?"Save draft changes":"Create draft"}</button>
        <button className="btn btn-outline" type="button" onClick={()=>show("mine")}>Cancel</button></div>
    </form>}

    {view==="detail"&&detail&&campaign&&<div className="campaign-detail">
      <div className="dash-card campaign-hero">
        <div className="campaign-row-between"><span className="campaign-kind">{campaign.kind.toUpperCase()} · {campaign.status.toUpperCase()}</span>
          <button className="btn btn-outline" onClick={()=>{void navigator.clipboard.writeText(window.location.origin+"/dashboard?campaign="+campaign.id)
            .then(()=>onNotify("success","Campaign URL copied"))
            .catch(()=>onNotify("error","Unable to copy campaign URL"))}}>Share link</button></div>
        {campaign.has_cover&&<img className="campaign-hero-cover" src={"/api/campaign-cover?id="+campaign.id} alt={"Campaign artwork for "+campaign.title}/>}
        <h2>{campaign.title}</h2><p className="muted">by <a href={"/u/"+encodeURIComponent(campaign.creator_handle)}>@{campaign.creator_handle}</a> · {campaign.visibility} · {campaign.join_policy} joining</p>
        <p>{campaign.description}</p><div className="campaign-rule-box"><strong>Rules and consent boundaries</strong><p>{campaign.rules}</p></div>
        <div className="campaign-metrics">
          <div><small>Collective fictional total</small><strong>{credit(detail.totals.total)}</strong></div>
          <div><small>Members</small><strong>{detail.totals.members}</strong></div>
          <div><small>Contributors</small><strong>{detail.totals.contributors}</strong></div>
          <div><small>Ends</small><strong>{shortDate(campaign.ends_at)}</strong></div>
        </div>
        {Number(campaign.goal)>0&&<><div className="campaign-meter large"><div style={{width:detail.totals.progress+"%"}}/></div>
          <small className="muted">{detail.totals.progress}% of {credit(Number(campaign.goal))}</small></>}
        <div className="campaign-milestones">{campaign.milestones?.map((m,i)=><span className="campaign-chip" key={i}>
          {detail.totals.total>=m.threshold?"✓ ":"○ "}{m.title} · {credit(m.threshold)}</span>)}</div>
        {detail.isCreator?<div className="campaign-actions">
          {campaign.status==="draft"&&<form className="campaign-proof-form" onSubmit={e=>void uploadCover(e)}>
            <label>Optional campaign cover image (JPEG/PNG/WebP, max 3 MB)
              <input type="file" accept="image/jpeg,image/png,image/webp"
                onChange={e=>setCoverFile(e.target.files?.[0]||null)}/></label>
            <label className="campaign-check"><input type="checkbox" checked={coverConsent}
              onChange={e=>setCoverConsent(e.target.checked)}/>I have permission to publish this non-explicit image.</label>
            <button className="btn btn-outline" disabled={busy||!coverFile||!coverConsent}>Upload cover</button>
          </form>}
          {campaign.status==="draft"&&<><button className="btn btn-outline" onClick={editCurrent}>Edit draft</button>
            <button className="btn btn-red" disabled={busy} onClick={()=>void run("publish")}>Publish campaign</button></>}
          {campaign.status==="published"&&<button className="btn btn-outline" disabled={busy} onClick={()=>void run("pause")}>Pause campaign</button>}
          {campaign.status==="paused"&&<button className="btn btn-red" disabled={busy} onClick={()=>void run("resume")}>Resume campaign</button>}
          {["published","paused"].includes(campaign.status)&&<button className="btn btn-outline" disabled={busy}
            onClick={()=>{if(window.confirm("Close this campaign permanently?"))void run("close")}}>Close permanently</button>}
        </div>:<>
          {role==="sub"&&(!member||member.status==="left")&&campaign.status==="published"&&<div className="campaign-participation">
            <h3>Join voluntarily</h3><p className="muted">Read the published rules above. Joining creates no private contract or real payment obligation.</p>
            <label className="campaign-check"><input type="checkbox" checked={anonymous} disabled={!campaign.allow_anonymous}
              onChange={e=>{setAnonymous(e.target.checked);if(e.target.checked)setLeaderboard(false)}}/>Use anonymous display</label>
            {campaign.leaderboard_enabled&&<label className="campaign-check"><input type="checkbox" checked={leaderboard}
              disabled={anonymous} onChange={e=>setLeaderboard(e.target.checked)}/>Opt in to public leaderboard</label>}
            <label>My personal fictional contribution cap<input type="number" min={1} max={Number(campaign.max_per_member)}
              value={personalCap} onChange={e=>setPersonalCap(Number(e.target.value))}/></label>
            {campaign.join_policy!=="invite"?<button className="btn btn-red" disabled={busy}
              onClick={()=>void run("join",{preferences:{anonymous,showOnLeaderboard:leaderboard,personalCap}})}>I agree to join</button>:
              <p className="muted">This campaign requires an invitation.</p>}
          </div>}
          {role==="sub"&&member?.status==="invited"&&<div className="campaign-actions">
            <button className="btn btn-red" disabled={busy}
              onClick={()=>void run("accept_invite",{preferences:{anonymous,showOnLeaderboard:leaderboard,personalCap}})}>Accept invitation & rules</button>
            <button className="btn btn-outline" disabled={busy} onClick={()=>void run("decline_invite")}>Decline</button></div>}
          {role==="sub"&&member?.status==="pending"&&<p className="muted">Your request is awaiting creator approval. You can withdraw it at any time.</p>}
          {role==="sub"&&["active","pending"].includes(member?.status||"")&&<div className="campaign-actions">
            <button className="btn btn-outline" disabled={busy} onClick={()=>void run("leave")}>Leave campaign without penalty</button>
            {participating&&<button className="btn btn-outline" disabled={busy}
              onClick={()=>void run("preferences",{preferences:{anonymous,showOnLeaderboard:leaderboard,personalCap}})}>Save privacy & limits</button>}
          </div>}
          {member?.status==="left"&&<p className="muted">You previously left this campaign; rejoining requires fresh consent.</p>}
          {campaign.visibility==="public"&&!detail.creatorFollowing&&<button className="btn btn-outline" disabled={busy}
            onClick={()=>void run("follow_creator",{follow:true})}>Follow creator @{campaign.creator_handle}</button>}
          {campaign.visibility==="public"&&detail.creatorFollowing&&<button className="btn btn-outline" disabled={busy}
            onClick={()=>void run("follow_creator",{follow:false})}>Unfollow creator</button>}
          {role==="sub"&&!detail.following&&<button className="btn btn-outline" disabled={busy}
            onClick={()=>void run("follow",{follow:true})}>Follow updates</button>}
          {role==="sub"&&detail.following&&<button className="btn btn-outline" disabled={busy}
            onClick={()=>void run("follow",{follow:false})}>Unfollow</button>}
        </>}
      </div>

      {participating&&campaign.status==="published"&&<div className="dash-card">
        <h3>Make a voluntary fictional contribution</h3>
        <p className="muted">No real money is transferred. {campaign.require_contribution_proof?
          "A private proof upload and creator review are required before the total changes.":"Credits are added immediately to this campaign's separate fictional total."}</p>
        <div className="campaign-field-grid">
          <label>Fictional amount<input type="number" min={campaign.min_contribution} max={campaign.max_contribution}
            value={amount} onChange={e=>setAmount(Number(e.target.value))}/></label>
          <label>Optional note<input maxLength={400} value={contributionNote} onChange={e=>setContributionNote(e.target.value)}/></label>
        </div>
        <button className="btn btn-red" disabled={busy} onClick={()=>void run("contribute",
          {amount,note:contributionNote,requestId:crypto.randomUUID()}).then(r=>{if(r){setContributionNote("");if(r.status==="pending")
            onNotify("success","Contribution pending: upload proof below, then request creator review.")}})}>Record fictional contribution</button>
      </div>}

      {(detail.isCreator||participating||detail.contributions.length>0)&&<div className="dash-card">
        <h3>{detail.isCreator?"Contribution review queue":"My contribution history"}</h3>
        {detail.contributions.length===0?<p className="muted">No contributions yet.</p>:detail.contributions.map(x=><div className="campaign-record" key={x.id}>
          <div className="campaign-row-between"><strong>{credit(x.amount)} · {x.status}</strong>
            <small className="muted">{x.member_handle||"Your contribution"} · {shortDate(x.created_at)}</small></div>
          {x.note&&<p>{x.note}</p>}{x.review_note&&<p className="muted">Review: {x.review_note}</p>}
          <button className="campaign-text-btn" onClick={()=>toggleProof(x.id)}>Private evidence ({x.evidence_count}) ▾</button>
          {openProofs.includes(x.id)&&<Evidence campaignId={campaign.id} kind="contribution" targetId={x.id}
            isOwner={!detail.isCreator&&x.status==="pending"} onNotify={onNotify}/>}
          {detail.isCreator&&x.status==="pending"&&<div className="campaign-actions">
            <input aria-label="Contribution review note" placeholder="Reason required if rejecting" maxLength={500}
              value={reviewNotes[x.id]||""} onChange={e=>setReviewNotes(s=>({...s,[x.id]:e.target.value}))}/>
            <button className="btn btn-red" disabled={busy} onClick={()=>void run("review_contribution",
              {contributionId:x.id,approve:true,note:reviewNotes[x.id]||""})}>Approve</button>
            <button className="btn btn-outline" disabled={busy} onClick={()=>void run("review_contribution",
              {contributionId:x.id,approve:false,note:reviewNotes[x.id]||""})}>Reject</button>
          </div>}
        </div>)}
      </div>}

      <div className="dash-card">
        <h3>Community activities</h3>
        {detail.activities.length===0?<p className="muted">No tasks, games or polls were added.</p>:detail.activities.map(a=><div className="campaign-activity" key={a.id}>
          <span className="campaign-kind">{a.kind.toUpperCase()}</span><strong>{a.config.title}</strong>
          {a.config.type==="task"&&<><p className="muted">Earn {a.config.points} campaign points per approved completion. Max {a.config.maxCompletionsPerMember} completion(s).</p>
            {participating&&campaign.status==="published"&&<div className="campaign-field-grid"><label>Completion report
              <textarea maxLength={1000} value={taskNotes[a.id]||""} rows={2}
                onChange={e=>setTaskNotes(s=>({...s,[a.id]:e.target.value}))}/></label>
              <button className="btn btn-outline" disabled={busy||!(taskNotes[a.id]||"").trim()}
                onClick={()=>void run("submit_task",{activityId:a.id,note:taskNotes[a.id]}).then(r=>{if(r)setTaskNotes(s=>({...s,[a.id]:""}))})}>Submit task</button></div>}</>}
          {a.config.type==="game"&&<><p className="muted">{a.config.game} · {a.config.pointsWin} win points · {a.config.cooldownHours}h cooldown</p>
            {participating&&campaign.status==="published"&&<button className="btn btn-outline" disabled={busy}
              onClick={()=>void run("play_game",{activityId:a.id}).then(r=>{if(r?.outcome)
                setGameResult(a.config.title+": "+(r.outcome.label||String(r.outcome.roll))+" · "+r.points+" points")})}>Play now</button>}</>}
          {a.config.type==="poll"&&<><p>Community poll</p><div className="campaign-poll-options">{a.config.choices.map((choice,i)=>
            <button className="btn btn-outline" key={i} disabled={busy||!participating||campaign.status!=="published"}
              onClick={()=>void run("vote",{activityId:a.id,choice:i})}>{choice} · {detail.votes.find(v=>v.activity_id===a.id&&v.choice_index===i)?.votes||0}</button>)}</div></>}
        </div>)}
        {gameResult&&<p className="campaign-game-result" role="status">{gameResult}</p>}
      </div>

      {(detail.isCreator||detail.claims.length>0)&&<div className="dash-card">
        <h3>{detail.isCreator?"Task approvals":"My submitted tasks"}</h3>
        {detail.claims.length===0&&<p className="muted">No submissions yet.</p>}
        {detail.claims.map(x=><div className="campaign-record" key={x.id}>
          <strong>{x.member_handle} · {x.status} · {x.points} points</strong><p>{x.note}</p>
          {x.review_note&&<small className="muted">{x.review_note}</small>}
          <button className="campaign-text-btn" onClick={()=>toggleProof(x.id)}>Private task evidence ({x.evidence_count}) ▾</button>
          {openProofs.includes(x.id)&&<Evidence campaignId={campaign.id} kind="task" targetId={x.id}
            isOwner={!detail.isCreator&&x.status==="pending"} onNotify={onNotify}/>}
          {detail.isCreator&&x.status==="pending"&&<div className="campaign-actions">
            <input aria-label="Task review note" maxLength={500} placeholder="Reason required for rejection"
              value={reviewNotes[x.id]||""} onChange={e=>setReviewNotes(s=>({...s,[x.id]:e.target.value}))}/>
            <button className="btn btn-red" disabled={busy} onClick={()=>void run("review_task",
              {claimId:x.id,approve:true,note:reviewNotes[x.id]||""})}>Approve</button>
            <button className="btn btn-outline" disabled={busy} onClick={()=>void run("review_task",
              {claimId:x.id,approve:false,note:reviewNotes[x.id]||""})}>Reject</button>
          </div>}
        </div>)}
      </div>}

      {detail.isCreator&&<div className="dash-card"><h3>Creator moderation & participants</h3>
        {campaign.join_policy==="invite"&&<div className="campaign-actions"><input placeholder="Discoverable Sub handle"
          value={inviteHandle} onChange={e=>setInviteHandle(e.target.value)}/>
          <button className="btn btn-outline" disabled={busy||!inviteHandle.trim()} onClick={()=>void run("invite",{handle:inviteHandle})
            .then(r=>{if(r)setInviteHandle("")})}>Send invitation</button></div>}
        {detail.memberQueue.length===0&&<p className="muted">No participant records yet.</p>}
        {detail.memberQueue.map(m=><div className="campaign-member-row" key={m.id}>
          <span>@{m.handle} · {m.status} {m.anonymous?"· anonymous":""}</span>
          <div className="campaign-actions">{m.status==="pending"&&<button className="btn btn-red" disabled={busy}
            onClick={()=>void run("approve_member",{memberId:m.member_id})}>Approve join</button>}
          {!["removed","left"].includes(m.status)&&<button className="btn btn-outline" disabled={busy}
            onClick={()=>void run("remove_member",{memberId:m.member_id})}>Remove access</button>}</div>
        </div>)}
      </div>}

      <div className="campaign-lower-grid">
        <div className="dash-card"><h3>Campaign feed</h3>
          {((participating&&campaign.status==="published")||(detail.isCreator&&campaign.status==="published"))&&
            <div className="campaign-post-editor">
              <textarea rows={3} maxLength={2000} placeholder={replyTo?"Write a reply...":detail.isCreator?"Publish a campaign update...":"Comment on the campaign..."}
                value={feedText} onChange={e=>setFeedText(e.target.value)}/>
              <div className="campaign-actions">{replyTo&&<button className="btn btn-outline" onClick={()=>setReplyTo(null)}>Cancel reply</button>}
                <button className="btn btn-red" disabled={busy||!feedText.trim()} onClick={()=>void run("post",
                  {content:feedText,parentId:replyTo}).then(r=>{if(r){setFeedText("");setReplyTo(null)}})}>Post</button></div>
            </div>}
          {detail.posts.length===0&&<p className="muted">No updates yet.</p>}
          {detail.posts.map(p=><article className="campaign-feed-post" key={p.id}>
            <div className="campaign-row-between"><strong>@{p.display_handle} <small>{p.kind}</small></strong>
              <small className="muted">{shortDate(p.created_at)}</small></div>
            {p.parent_id&&<small className="muted">Reply to a previous post</small>}
            <p>{p.content}</p><div className="campaign-actions">
              {(participating||detail.isCreator)&&<button className="campaign-text-btn" disabled={busy}
                onClick={()=>void run("react",{postId:p.id,emoji:"heart",enabled:!p.reacted})}>{p.reacted?"♥":"♡"} {p.reactions}</button>}
              {(participating||detail.isCreator)&&campaign.allow_comments&&<button className="campaign-text-btn"
                onClick={()=>{setReplyTo(p.id);setFeedText("")}}>Reply</button>}
              {(p.is_mine||detail.isCreator)&&<button className="campaign-text-btn"
                onClick={()=>void run("delete_post",{postId:p.id})}>Remove</button>}
            </div>
          </article>)}
        </div>
        <div><div className="dash-card"><h3>Campaign leaderboard</h3>
          {!campaign.leaderboard_enabled?<p className="muted">Leaderboards are disabled by the creator.</p>:
            detail.leaderboard.length===0?<p className="muted">No participants have opted in.</p>:
              detail.leaderboard.map((x,i)=><div className="campaign-leader" key={x.handle}><strong>#{i+1} @{x.handle}</strong>
                <span>{x.points} pts · {credit(x.total)}</span></div>)}
          <p className="muted">Only active, non-anonymous members who explicitly opt in appear here.</p>
        </div>
        {!detail.isCreator&&<div className="dash-card"><h3>Report campaign</h3>
          <textarea rows={2} maxLength={500} minLength={10} placeholder="Describe a safety or rules concern (private)"
            value={reportText} onChange={e=>setReportText(e.target.value)}/>
          <button className="btn btn-outline" disabled={busy||reportText.trim().length<10}
            onClick={()=>void run("report",{reason:reportText}).then(r=>{if(r)setReportText("")})}>Submit private report</button>
        </div>}</div>
      </div>
    </div>}
  </div>
}
