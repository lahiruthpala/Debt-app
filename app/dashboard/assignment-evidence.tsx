"use client"
import {useCallback,useEffect,useRef,useState} from "react"
type Evidence={id:string;assignment_id:string;step_number:number;status:string;
  bytes:number;created_at:string;reviewed_at:string|null;review_note:string|null;deleted_at:string|null;uploader_id:string}
type Feedback=(type:"pending"|"success"|"error",message:string)=>void
const err=(e:unknown)=>e instanceof Error?e.message:"Evidence request failed"
async function list(assignmentId:string){
  const response=await fetch("/api/assignment-evidence?"+new URLSearchParams({assignmentId}),{cache:"no-store"})
  const json=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(json.error||"Private evidence is unavailable")
  return json.evidence as Evidence[]
}
async function mutate(method:"PATCH"|"DELETE",body:Record<string,unknown>){
  const response=await fetch("/api/assignment-evidence",{
    method,headers:{"Content-Type":"application/json"},body:JSON.stringify(body)
  })
  const json=await response.json().catch(()=>({}))
  if(!response.ok)throw Error(json.error||"Evidence action failed")
  return json
}
export default function AssignmentEvidencePanel({assignmentId,stepNumber,role,active,taskStatus,onNotify,onChanged}:{
  assignmentId:string;stepNumber:number;role:"dom"|"sub";active:boolean;taskStatus:string;
  onNotify:Feedback;onChanged?:()=>Promise<void>|void
}){
  const [evidence,setEvidence]=useState<Evidence[]>([])
  const [selected,setSelected]=useState<File[]>([])
  const [consent,setConsent]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState("")
  const [preview,setPreview]=useState<string|null>(null)
  const [notes,setNotes]=useState<Record<string,string>>({})
  const notifyRef=useRef(onNotify)
  useEffect(()=>{notifyRef.current=onNotify},[onNotify])
  const refresh=useCallback(async()=>{
    try{const result=await list(assignmentId);setEvidence(result.filter(x=>x.step_number===stepNumber))}
    catch(e){notifyRef.current("error",err(e))}
  },[assignmentId,stepNumber])
  useEffect(()=>{void refresh()},[refresh])
  const uploaded=evidence.filter(x=>!x.deleted_at)
  async function run(fn:()=>Promise<unknown>){
    if(busy)return
    setBusy(true)
    try{await fn();await refresh();await onChanged?.()}
    catch(e){notifyRef.current("error",err(e))}
    finally{setBusy(false)}
  }
  async function upload(){
    if(!selected.length||!consent)return
    await run(async()=>{
      for(const file of selected){
        if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size<1||file.size>3_000_000)
          throw Error("All images must be JPEG, PNG or WebP and smaller than 3MB each")
      }
      if(selected.length+uploaded.length>5)throw Error("A task step may have at most five active images")
      let accepted=0
      for(const file of selected){
        const form=new FormData()
        form.set("assignmentId",assignmentId);form.set("file",file);form.set("consent","yes")
        const response=await fetch("/api/assignment-evidence",{method:"POST",body:form})
        const json=await response.json().catch(()=>({}))
        if(!response.ok)throw Error(json.error||"Upload failed after "+accepted+" image(s)")
        accepted++
      }
      setSelected([]);setConsent(false)
      notifyRef.current("success",accepted+" private image(s) uploaded for partner review.")
    })
  }
  const current=uploaded.filter(x=>x.step_number===stepNumber)
  return <section className="assignment-evidence" aria-label="Private task-step photos">
    <h4>Private step evidence · {current.length}/5</h4>
    <p className="muted">These photos are only available to this scene's connected participants. Image metadata is stripped. You can delete your own photo at any time, and stopping a scene is never blocked.</p>
    <div className="proof-gallery">
      {current.map(item=><figure key={item.id}>
        <button type="button" className="btn btn-quiet" onClick={()=>setPreview(item.id)}>
          <img src={"/api/assignment-evidence?view=image&id="+encodeURIComponent(item.id)} alt="Private task proof thumbnail"/>
        </button>
        <figcaption>{item.status} · {Math.ceil(item.bytes/1024)}KB</figcaption>
        {item.review_note&&<p className="muted">{item.review_note}</p>}
        {role==="dom"&&item.status==="pending"&&active&&["active","submitted"].includes(taskStatus)&&<>
          <input aria-label={"Evidence review reason "+item.id} placeholder="Reason for rejection" maxLength={500}
            value={notes[item.id]||""} onChange={e=>setNotes({...notes,[item.id]:e.target.value})}/>
          <button className="btn btn-outline" type="button" disabled={busy}
            onClick={()=>void run(async()=>{await mutate("PATCH",{id:item.id,approve:true,note:notes[item.id]||""});
              notifyRef.current("success","Step photo approved.")})}>Approve photo</button>
          <button className="btn btn-quiet" type="button" disabled={busy||!notes[item.id]||notes[item.id].trim().length<5}
            onClick={()=>void run(async()=>{await mutate("PATCH",{id:item.id,approve:false,note:notes[item.id]});
              notifyRef.current("success","Step photo rejected with reason.")})}>Reject</button>
        </>}
        {role==="sub"&&<button className="btn btn-quiet" type="button" disabled={busy}
          onClick={()=>{if(window.confirm("Permanently erase your private photo?"))
            void run(async()=>{await mutate("DELETE",{id:item.id});
              notifyRef.current("success","Private photo erased.")})}}>Erase photo</button>}
      </figure>)}
    </div>
    {role==="sub"&&taskStatus==="active"&&active&&<div className="proof-upload-zone">
      <label>CHOOSE UP TO {5-current.length} OPTIONAL PRIVATE PHOTOS
        <input type="file" accept="image/jpeg,image/png,image/webp" multiple
          onChange={e=>setSelected(Array.from(e.target.files||[]).slice(0,5))}/>
      </label>
      {selected.length>0&&<p className="muted">{selected.map(f=>f.name).join(" · ")}</p>}
      <label className="check-label"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
        I voluntarily share these non-explicit images. No identity documents, intimate images or location details.</label>
      <button className="btn btn-outline" type="button" disabled={busy||!consent||!selected.length||current.length+selected.length>5}
        onClick={()=>void upload()}>{busy?"Uploading…":"Upload "+selected.length+" private image(s)"}</button>
    </div>}
    {preview&&<div className="proof-lightbox" role="dialog" aria-modal="true" aria-label="Private task-step image"
      onClick={()=>setPreview(null)}>
      <div className="proof-lightbox-panel" onClick={e=>e.stopPropagation()}>
        <button className="btn btn-outline" type="button" onClick={()=>setPreview(null)}>Close</button>
        <img src={"/api/assignment-evidence?view=image&id="+encodeURIComponent(preview)} alt="Enlarged private task proof"/>
      </div>
    </div>}
    <button type="button" className="btn btn-quiet" onClick={()=>void refresh()}>↻ Refresh photos</button>
  </section>
}
