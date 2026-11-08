"use client"
import { useEffect, useState } from "react"
import type { EngineConfig,Mechanic } from "@/lib/contract-modules"
import { describeModule } from "@/lib/contract-modules"

type Data={status:string;connectionState:string;modules:Mechanic[];history:{module_id:string;last_used_at:string;uses:number}[]}
export function ContractPlay({sceneId,onNotify,onApplied}:{sceneId:string;onNotify:(type:"pending"|"success"|"error",message:string)=>void;onApplied:()=>Promise<void>}){
 const [data,setData]=useState<Data|null>(null)
 const [busy,setBusy]=useState("")
 const [outcome,setOutcome]=useState("")
 async function load(){
   const r=await fetch("/api/contract-modules?"+new URLSearchParams({sceneId}),{cache:"no-store"})
   const j=await r.json()
   if(!r.ok)throw new Error(j.error||"Could not load contract mechanics")
   setData(j)
 }
 useEffect(()=>{if(sceneId)void load().catch(()=>{})},[sceneId])
 async function play(type:Mechanic["type"]){
   if(busy)return
   setBusy(type);setOutcome("");onNotify("pending","Running "+type+"…")
   try{
     const r=await fetch("/api/contract-modules",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({sceneId,moduleType:type})})
     const j=await r.json().catch(()=>({}))
     if(!r.ok)throw new Error(j.error||"Game action failed")
     setOutcome(j.message)
     onNotify("success",j.message)
     await Promise.all([load(),onApplied()])
   }catch(error){onNotify("error",error instanceof Error?error.message:"Action failed")}
   finally{setBusy("")}
 }
 if(!data||!data.modules.length)return null
 return <div className="dash-card contract-play">
   <div className="eyebrow">YOUR ACCEPTED DEBT GAME CONTRACT</div>
   <h3>Interactive mechanics <span className="mini-label">SERVER-VERIFIED OUTCOMES</span></h3>
   <p className="muted">These mechanics were frozen when your partner received the proposal. Their outcomes update only this imaginary ledger and are visible in its audit history.</p>
   {data.status!=="active"&&<p className="community-hint">{data.status==="proposed"?"Awaiting the sub's approval before any game can run.":"The scene is paused or ended. Game actions are disabled."}</p>}
   <div className="contract-play-grid">
     {data.modules.map(module=>{
       const history=data.history.find(x=>x.module_id===module.type)
       const period=module.type==="checkin"?module.intervalHours*3600000:module.cooldownMinutes*60000
       const next=history?new Date(history.last_used_at).getTime()+period:0
       const waiting=next>Date.now()
       return <div className="contract-play-card" key={module.type}>
         <div className="contract-play-symbol">{module.type==="wheel"?"◉":module.type==="dice"?"⚄":"◷"}</div>
         <strong>{module.type==="wheel"?"Fortune wheel":module.type==="dice"?"Dice duel":"Timed check-in"}</strong>
         <p>{describeModule(module)}</p>
         {module.type==="wheel"&&<div className="outcome-chips">{module.segments.map((s,i)=><span key={i}>{s.label} ({s.delta>0?"+":""}{s.delta})</span>)}</div>}
         <button type="button" className="btn btn-red" disabled={!!busy||waiting||data.status!=="active"||data.connectionState!=="active"} onClick={()=>void play(module.type)}>
           {waiting?"Next "+new Date(next).toLocaleString("en-GB"):module.type==="wheel"?"Spin wheel":module.type==="dice"?"Roll dice":"Check in"}
         </button>
       </div>
     })}
   </div>
   {outcome&&<div className="contract-result" role="status">{outcome}</div>}
 </div>
}
