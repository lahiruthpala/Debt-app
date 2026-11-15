"use client"
import {useCallback,useEffect,useState} from "react"
import type {Narrative,NarrativeState} from "@/lib/scene-platform"

type Feedback=(type:"pending"|"success"|"error",message:string)=>void
type Scene={id:string;status:string;connection_state:string;other_handle:string}
type Template={id:string;title:string;summary:string;category:string;author_handle?:string;
  author_id?:string;published:boolean;definition?:Narrative;plays?:number}
type Session={id:string;scene_id:string;status:string;proposed_by:string;last_actor_id:string|null;
  definition_snapshot:Narrative;state:NarrativeState;chapter:(Narrative["nodes"][number])|null;
  turn_count:number;created_at:string}
const empty=():Narrative=>({title:"The Glass Labyrinth",summary:"Explore a puzzle together and choose your own ending.",
  category:"Adventure",nodes:[
    {id:"start",title:"The crossroads",text:"Two doors appear before you. One leads to the moonlit library, the other to the hidden garden.",
      choices:[{id:"library",label:"Explore the library",next:"end",points:0,proposeTask:""}]},
    {id:"end",title:"The final page",text:"You find a message about trust and teamwork. Together, you choose what happens beyond the last page.",choices:[]}
  ]})
async function api(view:string,args:Record<string,string>={}){
 const response=await fetch("/api/scene-platform?"+new URLSearchParams({view,...args}),{cache:"no-store"})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(data.error||"Cannot load narrative studio")
 return data
}
async function post(payload:Record<string,unknown>){
 const response=await fetch("/api/scene-platform",{method:"POST",
   headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
 const data=await response.json().catch(()=>({}))
 if(!response.ok)throw Error(data.error||"Story action failed")
 return data
}
function err(e:unknown){return e instanceof Error?e.message:"Action failed"}
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value))
export default function NarrativeStudio({scenes,selectedSceneId,meId,onNotify}:{
 scenes:Scene[];selectedSceneId:string;meId:string;onNotify:Feedback
}){
 const [sceneId,setSceneId]=useState(selectedSceneId)
 const [library,setLibrary]=useState<Template[]>([])
 const [mine,setMine]=useState<Template[]>([])
 const [sessions,setSessions]=useState<Session[]>([])
 const [editor,setEditor]=useState<Narrative>(empty())
 const [editId,setEditId]=useState<string|null>(null)
 const [selectedTemplate,setSelectedTemplate]=useState("")
 const [section,setSection]=useState<"library"|"editor"|"playing">("library")
 const [working,setWorking]=useState(false)
 const [localDraft,setLocalDraft]=useState(false)
 const scene=scenes.find(s=>s.id===sceneId)
 const canPlay=scene?.status==="active"&&scene?.connection_state==="active"
 useEffect(()=>{if(!scenes.some(s=>s.id===sceneId))setSceneId(selectedSceneId||scenes[0]?.id||"")},[scenes,selectedSceneId,sceneId])
 useEffect(()=>{try{setLocalDraft(localStorage.getItem("vl_story_draft_enabled")==="yes")}catch{}},[])
 const reload=useCallback(async()=>{
   try{
     const [b,s]=await Promise.all([
       api("library"),sceneId?api("stories",{sceneId}):Promise.resolve({sessions:[]})])
     setLibrary(b.library||[]);setMine(b.mine||[]);setSessions(s.sessions||[])
   }catch(e){onNotify("error",err(e))}
 // onNotify is deliberately not in the effect dependency list (dashboard renders a fresh handler).
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[sceneId])
 useEffect(()=>{void reload()},[reload])
 function updateEditor(next:Narrative){
   setEditor(next)
   if(localDraft)try{localStorage.setItem("vl_story_private_draft",JSON.stringify(next))}catch{}
 }
 function changeChapter(index:number,patch:Partial<Narrative["nodes"][number]>){
   const next=clone(editor);next.nodes[index]={...next.nodes[index],...patch};updateEditor(next)
 }
 function changeChoice(ni:number,ci:number,patch:Partial<Narrative["nodes"][number]["choices"][number]>){
   const next=clone(editor);next.nodes[ni].choices[ci]={...next.nodes[ni].choices[ci],...patch};updateEditor(next)
 }
 async function submit(input:Record<string,unknown>,success?:()=>void){
   if(working)return
   setWorking(true);onNotify("pending","Processing story action…")
   try{
     const result=await post(input)
     onNotify("success",result.message||"Story updated")
     await reload();success?.()
   }catch(e){onNotify("error",err(e))}
   finally{setWorking(false)}
 }
 function loadTemplate(template:Template){
   if(!template.definition)return
   updateEditor(clone(template.definition));setEditId(template.id);setSection("editor")
 }
 function addChapter(){
   if(editor.nodes.length>=24)return
   const ids=new Set(editor.nodes.map(n=>n.id))
   let index=editor.nodes.length+1,id="chapter-"+index
   while(ids.has(id)){index++;id="chapter-"+index}
   updateEditor({...editor,nodes:[...editor.nodes,{id,title:"New chapter",text:"Describe the next part of the shared story here.",choices:[]}]})
 }
 function addChoice(index:number){
   const node=editor.nodes[index]
   if(node.choices.length>=4)return
   const next=clone(editor),n=next.nodes[index]
   const id="option-"+(node.choices.length+1)
   n.choices.push({id,label:"Choose this path",next:"end",points:0,proposeTask:""})
   updateEditor(next)
 }
 function toggleLocal(value:boolean){
   setLocalDraft(value)
   try{localStorage.setItem("vl_story_draft_enabled",value?"yes":"no")
     if(value)localStorage.setItem("vl_story_private_draft",JSON.stringify(editor))
     else localStorage.removeItem("vl_story_private_draft")
   }catch{}
 }
 const chosen=library.find(t=>t.id===selectedTemplate)
 return <section className="scene-platform narrative-studio" aria-label="Branching story builder">
   <div className="scene-platform-head">
     <div><span className="eyebrow">ADVANCED STORY WORKSHOP</span><h2>Build interconnected adventures</h2>
       <p>Author multi-chapter interactive stories with hidden paths, flags, point rewards and optional task proposals. Every shared playbook needs partner approval before play.</p></div>
     <button type="button" className="btn btn-outline" onClick={()=>{setEditor(empty());setEditId(null);setSection("editor")}}>＋ Build a story</button>
   </div>
   <div className="ops-tabs">
     <button className={section==="library"?"chosen":""} onClick={()=>setSection("library")}>Discover playbooks</button>
     <button className={section==="editor"?"chosen":""} onClick={()=>setSection("editor")}>Story builder</button>
     <button className={section==="playing"?"chosen":""} onClick={()=>setSection("playing")}>Your shared stories</button>
   </div>
   {section==="library"&&<div className="ops-split">
     <div className="dash-card"><h3>Published interactive stories</h3>
       {!library.length?<p className="muted">No shared playbooks yet. Publish the first.</p>:
         library.map(t=><button type="button" key={t.id} className={"scene-template "+(selectedTemplate===t.id?"chosen":"")}
           onClick={()=>setSelectedTemplate(t.id)}><strong>{t.title}</strong><small>{t.category} · by @{t.author_handle} · {t.plays||0} plays</small>
           <p>{t.summary}</p></button>)}
     </div>
     <div className="dash-card"><h3>Play a story together</h3>
       {!chosen?<p className="muted">Choose a story to see its details.</p>:<>
         <h4>{chosen.title}</h4><p>{chosen.summary}</p>
         <p className="muted">Only the accepted snapshot is played. Changes to the original template cannot alter your active story. All rewards are separate game points.</p>
         <label>APPROVED CONNECTION
           <select aria-label="Narrative connection" value={sceneId} onChange={e=>setSceneId(e.target.value)}>
             {!scenes.length&&<option value="">No scenes yet</option>}
             {scenes.map(s=><option key={s.id} value={s.id}>@{s.other_handle} · {s.status}</option>)}
           </select>
         </label>
         <button className="btn btn-red" disabled={working||!canPlay} onClick={()=>void submit({
           action:"story-propose",sceneId,id:chosen.id},()=>setSection("playing"))}>Propose this story</button>
         {!canPlay&&<p className="muted">An active scene is required.</p>}
       </>}
       <hr/><h4>My created playbooks</h4>
       {!mine.length&&<p className="muted">No authored stories yet.</p>}
       {mine.map(t=><div className="scene-template" key={t.id}>
         <strong>{t.title}</strong><small>{t.published?"Published":"Private draft"}</small>
         <div className="person-actions"><button className="btn btn-outline" onClick={()=>loadTemplate(t)}>Edit chapters</button>
           <button className="btn btn-quiet" disabled={!canPlay||working} onClick={()=>void submit({action:"story-propose",sceneId,id:t.id},()=>setSection("playing"))}>Propose</button>
         </div></div>)}
     </div>
   </div>}
   {section==="editor"&&<div className="scene-builder-layout">
     <form className="dash-card form-stack" onSubmit={e=>{e.preventDefault();void submit({
       action:"story-save",definition:editor,publish:true,...(editId?{id:editId}:{})
     },()=>setSection("library"))}}>
       <h3>{editId?"Edit playbook":"Create a branching playbook"}</h3>
       <p className="muted">Node IDs must be unique slugs (letters, digits, hyphens). At least one ending and a reachable path from start are required. No executable code or ledger mutation is allowed.</p>
       <label>TITLE<input required minLength={3} maxLength={80} value={editor.title}
         onChange={e=>updateEditor({...editor,title:e.target.value})}/></label>
       <label>SUMMARY<input minLength={10} maxLength={240} required value={editor.summary}
         onChange={e=>updateEditor({...editor,summary:e.target.value})}/></label>
       <label>CATEGORY<input minLength={3} maxLength={30} required value={editor.category}
         onChange={e=>updateEditor({...editor,category:e.target.value})}/></label>
       <div className="person-actions">
         <button type="button" className="btn btn-outline" disabled={editor.nodes.length>=24} onClick={addChapter}>＋ Add chapter</button>
         <label className="check-label"><input type="checkbox" checked={localDraft}
           onChange={e=>toggleLocal(e.target.checked)}/>Save an offline draft on this device</label>
         <button type="button" className="btn btn-quiet" disabled={!localDraft} onClick={()=>{
           try{const stored=localStorage.getItem("vl_story_private_draft")
             if(stored)updateEditor(JSON.parse(stored))
           }catch{onNotify("error","No valid local draft found")}}}>Restore device draft</button>
       </div>
       {editor.nodes.map((node,i)=><fieldset key={i} className="scene-node-editor">
         <legend>Chapter {i+1} {node.id==="start"?"· Entry":""}</legend>
         <div className="form-grid">
           <label>NODE ID<input required pattern="[a-z][a-z0-9_-]*" maxLength={32} value={node.id}
             onChange={e=>changeChapter(i,{id:e.target.value})}/></label>
           <label>CHAPTER TITLE<input required minLength={3} maxLength={100} value={node.title}
             onChange={e=>changeChapter(i,{title:e.target.value})}/></label>
         </div>
         <label>CHAPTER TEXT<textarea required minLength={12} maxLength={1600} rows={3} value={node.text}
           onChange={e=>changeChapter(i,{text:e.target.value})}/></label>
         {node.choices.map((choice,j)=><div className="scene-choice-editor" key={j}>
           <div className="form-grid">
             <label>CHOICE ID<input pattern="[a-z][a-z0-9_-]*" maxLength={32} value={choice.id}
               onChange={e=>changeChoice(i,j,{id:e.target.value})}/></label>
             <label>BUTTON TEXT<input minLength={3} maxLength={140} value={choice.label}
               onChange={e=>changeChoice(i,j,{label:e.target.value})}/></label>
             <label>GO TO CHAPTER<select value={choice.next} onChange={e=>changeChoice(i,j,{next:e.target.value})}>
               {editor.nodes.map(n=><option key={n.id} value={n.id}>{n.title} · {n.id}</option>)}
             </select></label>
             <label>POINT REWARD (0–10)<input type="number" min={0} max={10} value={choice.points}
               onChange={e=>changeChoice(i,j,{points:Number(e.target.value)})}/></label>
             <label>REQUIRED FLAG<input placeholder="Optional flag" value={choice.requiresFlag||""}
               onChange={e=>changeChoice(i,j,{requiresFlag:e.target.value||undefined})}/></label>
             <label>SET FLAG<input placeholder="Optional flag" value={choice.setsFlag||""}
               onChange={e=>changeChoice(i,j,{setsFlag:e.target.value||undefined})}/></label>
             <label>REQUIRES ITEM<input placeholder="Optional inventory item" value={choice.requiresItem||""}
               onChange={e=>changeChoice(i,j,{requiresItem:e.target.value||undefined})}/></label>
             <label>GRANT ITEM<input placeholder="Optional new item" value={choice.grantItem||""}
               onChange={e=>changeChoice(i,j,{grantItem:e.target.value||undefined})}/></label>
             <label>CONSUME ITEM<input placeholder="Optional used item" value={choice.consumeItem||""}
               onChange={e=>changeChoice(i,j,{consumeItem:e.target.value||undefined})}/></label>
           </div>
           <label className="check-label"><input type="checkbox"
             checked={Boolean(choice.randomTargets?.length)}
             onChange={e=>changeChoice(i,j,{randomTargets:e.target.checked?[
               {next:choice.next,weight:50},
               {next:editor.nodes.find(x=>x.id!==choice.next)?.id||choice.next,weight:50}
             ]:undefined})}/>Use server-random weighted encounter destinations</label>
           {choice.randomTargets?.map((outcome,k)=><div className="scene-random-route" key={k}>
             <label>RANDOM DESTINATION<select value={outcome.next} onChange={e=>changeChoice(i,j,{
               randomTargets:choice.randomTargets?.map((item,index)=>index===k?{...item,next:e.target.value}:item)
             })}>{editor.nodes.map(n=><option key={n.id} value={n.id}>{n.title} · {n.id}</option>)}</select></label>
             <label>WEIGHT (1–100)<input type="number" min={1} max={100} value={outcome.weight}
               onChange={e=>changeChoice(i,j,{randomTargets:choice.randomTargets?.map((item,index)=>
                 index===k?{...item,weight:Number(e.target.value)}:item)})}/></label>
             <button className="btn btn-quiet" type="button" disabled={choice.randomTargets.length<=2}
               onClick={()=>changeChoice(i,j,{randomTargets:choice.randomTargets?.filter((_,index)=>index!==k)})}>Remove route</button>
           </div>)}
           {choice.randomTargets&&<button type="button" className="btn btn-outline" disabled={choice.randomTargets.length>=5}
             onClick={()=>changeChoice(i,j,{randomTargets:[...choice.randomTargets!,
               {next:choice.next,weight:10}]})}>＋ Weighted outcome</button>}
           <label>OPTIONAL TASK PROPOSAL<input maxLength={100} value={choice.proposeTask}
             placeholder="No task unless named" onChange={e=>changeChoice(i,j,{proposeTask:e.target.value})}/></label>
           <button type="button" className="btn btn-quiet" onClick={()=>changeChapter(i,{
             choices:node.choices.filter((_,index)=>index!==j)})}>Remove choice</button>
         </div>)}
         <div className="person-actions">
           <button type="button" className="btn btn-outline" disabled={node.choices.length>=4} onClick={()=>addChoice(i)}>＋ Choice</button>
           {node.id!=="start"&&<button type="button" className="btn btn-quiet" onClick={()=>
             updateEditor({...editor,nodes:editor.nodes.filter((_,j)=>i!==j)})}>Remove chapter</button>}
           {!node.choices.length&&<small className="muted">Ending chapter</small>}
         </div>
       </fieldset>)}
       <div className="person-actions">
         <button className="btn btn-outline" type="button" disabled={working} onClick={()=>void submit({
           action:"story-save",definition:editor,publish:false,...(editId?{id:editId}:{})
         })}>Save private draft</button>
         <button className="btn btn-red" type="submit" disabled={working}>Publish playbook</button>
       </div>
     </form>
     <aside className="dash-card"><h3>Story flow preview</h3>
       {editor.nodes.map((node,i)=><div className="scene-flow-node" key={i}><strong>{node.id} · {node.title}</strong>
         <small>{node.choices.length?node.choices.map(c=>c.label+" → "+c.next).join(" · "):"End"}</small></div>)}
       <p className="muted">Flags and inventory unlock or hide choices. Weighted encounters use secure server randomness. Story rewards are capped and never change fictional balances. Tasks stay proposals requiring partner consent.</p>
     </aside>
   </div>}
   {section==="playing"&&<div className="ops-stack">
     <label>SCENE<select aria-label="Story session scene" value={sceneId} onChange={e=>setSceneId(e.target.value)}>
       {!scenes.length&&<option value="">No scenes yet</option>}
       {scenes.map(s=><option key={s.id} value={s.id}>@{s.other_handle} · {s.status}</option>)}
     </select></label>
     <button className="btn btn-quiet" onClick={()=>void reload()}>↻ Refresh shared chapters</button>
     {!sessions.length&&<div className="dash-card"><p>No narrative sessions here. Discover a playbook to propose one.</p></div>}
     {sessions.map(session=>{
       const node=session.chapter,canChoose=canPlay&&session.status==="active"&&session.last_actor_id!==meId
       return <article key={session.id} className="dash-card scene-story-session">
         <div className="ops-item-head"><h3>{session.definition_snapshot.title}</h3>
           <span className={"status status-"+session.status}>{session.status}</span></div>
         <p className="muted">{session.definition_snapshot.summary}</p>
         <small>{session.turn_count} choices · {session.state.flags.length} story flags · {session.state.items?.length||0} inventory items</small>
         {session.state.items?.length>0&&<p className="scene-story-items">Inventory: {session.state.items.join(" · ")}</p>}
         {session.status==="proposed"&&<div className="person-actions">
           {session.proposed_by!==meId&&<><button className="btn btn-red" disabled={working||!canPlay}
             onClick={()=>void submit({action:"story-decision",sceneId,id:session.id,approve:true})}>Accept playbook</button>
             <button className="btn btn-outline" disabled={working||!canPlay}
               onClick={()=>void submit({action:"story-decision",sceneId,id:session.id,approve:false})}>Decline</button></>}
           {session.proposed_by===meId&&<p>Waiting for your partner's consent.</p>}
         </div>}
         {node&&["active","finished"].includes(session.status)&&<>
           <div className="story-chapter"><span className="eyebrow">CHAPTER {session.state.decisions+1} · {node.title}</span>
             <p>{node.text}</p>
             {session.status==="finished"?<p className="muted">✦ Story completed and saved.</p>:
               <div className="story-choice-grid">{node.choices.map(choice=><button className="story-choice" key={choice.id}
                 disabled={working||!canChoose} onClick={()=>void submit({
                   action:"story-choice",sceneId,id:session.id,choiceId:choice.id
                 })}>{choice.label} <span>→</span></button>)}
                 {!canChoose&&<p className="muted">{canPlay?"Waiting for the other participant.":"Scene is paused."}</p>}
               </div>}
           </div></>}
         {["active","proposed"].includes(session.status)&&<button className="btn btn-quiet"
           disabled={working} onClick={()=>void submit({action:"story-stop",sceneId,id:session.id})}>Stop this story</button>}
       </article>
     })}
   </div>}
 </section>
}
