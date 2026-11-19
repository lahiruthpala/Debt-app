"use client"

import {useEffect,useState} from "react"

type AiScene={sceneId:string;status:string;enabled:boolean;createdAt:string}
type Props={onChanged:()=>Promise<void>;onOpenScene:(id:string)=>void}

export default function AiDomHub({onChanged,onOpenScene}:Props){
  const [scenes,setScenes]=useState<AiScene[]>([])
  const [consent,setConsent]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState("")
  const [message,setMessage]=useState("")
  async function load(){
    const response=await fetch("/api/ai-dom",{cache:"no-store"})
    const payload=await response.json().catch(()=>({}))
    if(!response.ok)throw Error(payload.error||"Could not load AI Dom scenes")
    setScenes(payload.scenes||[])
  }
  useEffect(()=>{void load().catch(err=>setError(err instanceof Error?err.message:"Unable to load"))},[])
  async function act(payload:Record<string,unknown>){
    setBusy(true);setError("");setMessage("")
    try{
      const response=await fetch("/api/ai-dom",{
        method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)})
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw Error(result.error||"AI Dom action unavailable")
      setMessage(result.message||"AI scene updated")
      await load()
      await onChanged()
    }catch(err){setError(err instanceof Error?err.message:"Action failed")}
    finally{setBusy(false)}
  }
  return <div className="dash-card">
    <span className="eyebrow">DISCLOSED AUTOMATED PARTNER · OPTIONAL</span>
    <h2>Play with an AI Dom</h2>
    <p className="muted">Create a private fictional scene even when no human Dom is available.
      This partner is software, not a real person. It cannot require real payments, receive intimate
      pictures, control devices, approve consent for you, or resume your paused scene.</p>
    <p className="muted">Creating a scene does not start an AI conversation by itself:
      a trusted MCP agent must also be connected by the site operator.</p>
    {error&&<p role="alert" className="error-message">{error}</p>}
    {message&&<p role="status">{message}</p>}
    <label className="check-line"><input type="checkbox" checked={consent}
      onChange={event=>setConsent(event.target.checked)}/>
      I understand this is AI roleplay, all balances are fictional, and I can stop at any time.
    </label>
    <div className="action-row">
      <button type="button" className="btn btn-red" disabled={busy||!consent}
        onClick={()=>void act({action:"start",confirmAI:true})}>Create AI Dom scene</button>
    </div>
    <h3>Your AI scenes</h3>
    {!scenes.length?<p className="muted">No AI scenes created yet.</p>:
      <div className="people-list">{scenes.map(scene=><div className="person" key={scene.sceneId}>
        <span className="avatar">AI</span>
        <div className="person-info">
          <b>Velvet AI Dom <span className="mini-label">BOT</span></b>
          <small>Scene {scene.status} · AI access {scene.enabled?"enabled":"disabled"}</small>
          {scene.status==="proposed"&&<small>Review and approve the terms in Overview before play.</small>}
        </div>
        <div className="person-actions">
          <button type="button" className="btn btn-outline"
            onClick={()=>onOpenScene(scene.sceneId)}>Open scene</button>
          {scene.status!=="ended"&&<button type="button" className="btn btn-danger-soft"
            disabled={busy||!scene.enabled} onClick={()=>void act({action:"disable",sceneId:scene.sceneId})}>
            Disable AI
          </button>}
          {scene.status!=="ended"&&!scene.enabled&&<button type="button" className="btn btn-outline"
            disabled={busy||!consent}
            onClick={()=>void act({action:"enable",sceneId:scene.sceneId,confirmAI:true})}>
            Re-enable AI
          </button>}
        </div>
      </div>)}</div>}
  </div>
}
