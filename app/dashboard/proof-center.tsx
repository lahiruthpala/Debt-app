"use client"
import {useEffect,useRef,useState,type FormEvent} from "react"
import {maxProofBytes,type ProofKind,type ProofStatus} from "@/lib/proof-rules"

type Feedback=(type:"pending"|"success"|"error",message:string)=>void
type Proof={
 id:string;scene_id:string;kind:ProofKind;module_id:string|null;claim_id:string|null;
 challenge_id:string|null;amount:number|null;lock_request_id:string|null;note:string;status:ProofStatus;created_at:string;
 reviewed_at:string|null;review_note:string|null;deleted_at:string|null;submitter_handle:string;
 reviewer_handle:string|null;submitter_id:string
}
const message=(error:unknown)=>error instanceof Error?error.message:"Evidence request failed"
const titles:Record<ProofKind,string>={lock:"Lock-status proof",task:"Contract task proof",challenge:"Challenge proof",payment:"Simulated payment proof"}
function announceRefresh(){window.dispatchEvent(new Event("private-proofs-updated"))}
async function apiProof(input:Record<string,unknown>,method:"PATCH"|"DELETE"){
 const res=await fetch("/api/proofs",{
   method,headers:{"Content-Type":"application/json"},body:JSON.stringify(input)
 })
 const data=await res.json().catch(()=>({}))
 if(!res.ok)throw new Error(data.error||"Proof action failed")
 return data
}

/** Evidence is opt-in and non-explicit. No photo can override consent or stop a scene ending. */
export function ProofUploader({sceneId,kind,moduleId,claimId,challengeId,amount,onAmountChange,hideNote=false,onNotify,onUploaded}:{
 sceneId:string;kind:ProofKind;moduleId?:string;claimId?:string;challengeId?:string;amount?:number;
 onAmountChange?:(amount:number)=>void;hideNote?:boolean;onNotify:Feedback;onUploaded?:()=>Promise<void>|void
}){
 const [file,setFile]=useState<File|null>(null)
 const [note,setNote]=useState("")
 const [confirmed,setConfirmed]=useState(false)
 const [working,setWorking]=useState(false)
 const inputRef=useRef<HTMLInputElement|null>(null)
 const invalidPayment=kind==="payment"&&(amount===undefined||!Number.isInteger(amount)||amount<1||amount>100000)
 async function submit(event:FormEvent){
   event.preventDefault()
   if(working||!file||!confirmed)return
   if(invalidPayment){onNotify("error","Enter an amount between 1 and 100,000 simulated credits.");return}
   if(!["image/jpeg","image/png","image/webp"].includes(file.type)||file.size>maxProofBytes){
     onNotify("error","Choose a JPEG, PNG or WebP photo smaller than 3 MB.");return
   }
   setWorking(true)
   onNotify("pending","Working on your private upload…")
   try{
     const payload=new FormData()
     payload.set("file",file)
     payload.set("sceneId",sceneId)
     payload.set("kind",kind)
     payload.set("note",note)
     payload.set("consent","yes")
     if(moduleId)payload.set("moduleId",moduleId)
     if(claimId)payload.set("claimId",claimId)
     if(challengeId)payload.set("challengeId",challengeId)
     if(amount!==undefined)payload.set("amount",String(amount))
     const response=await fetch("/api/proofs",{method:"POST",body:payload})
     const data=await response.json().catch(()=>({}))
     if(!response.ok)throw Error(data.error||"Image upload failed")
     setFile(null);setNote("");setConfirmed(false)
     if(inputRef.current)inputRef.current.value=""
     announceRefresh()
     await onUploaded?.()
     onNotify("success",data.message||"Photo submitted for review")
   }catch(error){onNotify("error",message(error))}
   finally{setWorking(false)}
 }
 return <form className="proof-uploader" onSubmit={e=>void submit(e)}>
   {kind==="payment"&&<label className="proof-input-label">Simulated credit amount (LKR)
     <input aria-label="Simulated credit amount" type="number" min={1} max={100000} step={1} required
       value={amount??""} onChange={e=>onAmountChange?.(Number(e.target.value))}/>
   </label>}
   <label className="proof-input-label">{kind==="payment"?"Attach payment proof image":kind==="lock"?"Upload non-explicit lock photo":"Attach optional private photo"}
     <input ref={inputRef} aria-label={"Proof image for "+titles[kind]} type="file" required={kind==="payment"}
       accept="image/jpeg,image/png,image/webp"
       onChange={e=>setFile(e.target.files?.[0]||null)}/>
   </label>
   {!hideNote&&<label className="proof-input-label">Private note (optional)
     <input value={note} maxLength={500} placeholder="Brief context for your partner…"
       onChange={e=>setNote(e.target.value)}/>
   </label>}
   <label className="check-label proof-check">
     <input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     <span>I consent to sharing a non-explicit photo with this connected partner. No intimate body photos, identifying documents or location details.</span>
   </label>
   <div className="proof-uploader-footer">
     <span>JPEG / PNG / WebP · maximum 3 MB · stored privately, metadata removed</span>
     <button type="submit" className="btn btn-outline" disabled={!file||!confirmed||working||!sceneId||invalidPayment}>
       {working?"Uploading…":kind==="lock"?"Upload lock photo ↗":"Submit for review ↗"}
     </button>
   </div>
 </form>
}

export default function ProofCenter({sceneId,role,actorId,onNotify,onChanged}:{
 sceneId:string;role:"dom"|"sub";actorId:string;onNotify:Feedback;onChanged?:()=>Promise<void>|void
}){
 const [proofs,setProofs]=useState<Proof[]>([])
 const [loading,setLoading]=useState(false)
 const [working,setWorking]=useState<string|null>(null)
 const [opened,setOpened]=useState<string[]>([])
 const [notes,setNotes]=useState<Record<string,string>>({})
 async function refresh(){
   if(!sceneId){setProofs([]);return}
   setLoading(true)
   try{
     const response=await fetch("/api/proofs?"+new URLSearchParams({sceneId}),{cache:"no-store"})
     const body=await response.json().catch(()=>({}))
     if(!response.ok)throw Error(body.error||"Unable to load proof reviews")
     setProofs(body.proofs||[])
   }catch(error){onNotify("error",message(error))}
   finally{setLoading(false)}
 }
 useEffect(()=>{
   if(!sceneId){setProofs([]);return}
   let alive=true
   async function initial(){
     try{
       const response=await fetch("/api/proofs?"+new URLSearchParams({sceneId}),{cache:"no-store"})
       const data=await response.json().catch(()=>({}))
       if(!response.ok)throw Error(data.error||"Unable to load private proofs")
       if(alive)setProofs(data.proofs||[])
     }catch(error){if(alive)onNotify("error",message(error))}
   }
   const handle=()=>{void initial()}
   void initial()
   window.addEventListener("private-proofs-updated",handle)
   return ()=>{alive=false;window.removeEventListener("private-proofs-updated",handle)}
   // Only reload when the scene identity changes, not on unrelated toast changes.
   // eslint-disable-next-line react-hooks/exhaustive-deps
 },[sceneId])
 async function review(proof:Proof,approve:boolean){
   if(working)return
   const note=notes[proof.id]?.trim()||""
   if(!approve&&note.length<5){onNotify("error","Provide a rejection reason (at least 5 characters).");return}
   setWorking(proof.id)
   onNotify("pending","Working on the proof review…")
   try{
     const data=await apiProof({id:proof.id,approve,note},"PATCH")
     await refresh()
     announceRefresh()
     await onChanged?.()
     onNotify("success",data.message)
   }catch(error){onNotify("error",message(error))}
   finally{setWorking(null)}
 }
 async function erase(proof:Proof){
   if(working)return
   if(!window.confirm("Permanently erase this photo? Settled credits and the audit record remain."))return
   setWorking(proof.id)
   onNotify("pending","Working on secure image deletion…")
   try{
     const data=await apiProof({id:proof.id},"DELETE")
     await refresh()
     announceRefresh()
     onNotify("success",data.message)
   }catch(error){onNotify("error",message(error))}
   finally{setWorking(null)}
 }
 const pending=proofs.filter(p=>p.status==="pending"&&!p.deleted_at&&(p.kind!=="lock"||Boolean(p.lock_request_id))).length
 return <section id="proof-center" className="dash-card proof-center" aria-label="Private proof review">
   <div className="proof-center-heading">
     <div><span className="eyebrow">PRIVATE · MUTUAL REVIEW</span><h3>Proof Center <span className="mini-label">{pending} PENDING</span></h3>
       <p className="muted">Photos are visible only to the uploader and their connected partner. An approval verifies the photo; it never restricts the Sub from ending participation.</p>
     </div>
     <button type="button" className="btn btn-quiet" disabled={loading} onClick={()=>void refresh()}>↻ Refresh</button>
   </div>
   {!proofs.length?<div className="empty-inner">No images submitted for this scene yet.</div>:
     <div className="proof-list">{proofs.map(proof=><article className="proof-item" key={proof.id}>
       <div className="proof-header">
         <div><strong>{titles[proof.kind]}</strong>
           <small>Submitted by @{proof.submitter_handle} · {new Date(proof.created_at).toLocaleString("en-GB")}
             {proof.amount!==null?" · "+proof.amount.toLocaleString()+" simulated credits":""}</small></div>
         <span className={"proof-status status-"+proof.status}>{proof.deleted_at?"Erased":proof.kind==="lock"&&proof.status==="pending"&&!proof.lock_request_id?"Ready for lock request":proof.status}</span>
       </div>
       {proof.note&&<p className="proof-note">{proof.note}</p>}
       {!proof.deleted_at && <div className="proof-media">
         <button type="button" className="btn btn-quiet" onClick={()=>setOpened(current=>current.includes(proof.id)?
           current.filter(x=>x!==proof.id):[...current,proof.id])}>
           {opened.includes(proof.id)?"Hide private image":"View private image"}
         </button>
         {opened.includes(proof.id)&&<img loading="lazy"
           src={"/api/proofs?view=image&id="+encodeURIComponent(proof.id)}
           alt={"Private proof for "+titles[proof.kind]}/>}
       </div>}
       {proof.review_note&&<p className="proof-note"><b>Review:</b> {proof.review_note}</p>}
       {proof.status!=="pending"&&<small className="proof-history">Reviewed by @{proof.reviewer_handle||"partner"}
         {proof.reviewed_at?" · "+new Date(proof.reviewed_at).toLocaleString("en-GB"):""}</small>}
       {role==="dom"&&proof.status==="pending"&&!proof.deleted_at&&(proof.kind!=="lock"||Boolean(proof.lock_request_id))&&<div className="proof-review">
         <label>Review note / rejection reason
           <input aria-label={"Review note for "+proof.id} maxLength={500} value={notes[proof.id]||""}
             placeholder="Optional for approval; required when rejecting"
             onChange={e=>setNotes(current=>({...current,[proof.id]:e.target.value}))}/>
         </label>
         <div className="person-actions">
           <button type="button" className="btn btn-red" disabled={Boolean(working)}
             onClick={()=>void review(proof,true)}>{proof.kind==="lock"?"Approve lock request":"Approve proof"}</button>
           <button type="button" className="btn btn-outline" disabled={Boolean(working)}
             onClick={()=>void review(proof,false)}>{proof.kind==="lock"?"Reject lock request":"Reject with reason"}</button>
         </div>
       </div>}
       {proof.submitter_id===actorId&&!proof.deleted_at&&<button type="button"
         className="btn btn-quiet proof-erase" disabled={Boolean(working)}
         onClick={()=>void erase(proof)}>Erase my photo</button>}
     </article>)}</div>}
 </section>
}
