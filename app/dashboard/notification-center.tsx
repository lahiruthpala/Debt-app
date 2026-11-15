"use client"

import {useEffect,useRef,useState} from "react"

type NotificationItem={id:string;scene_id:string|null;kind:string;title:string;detail:string;created_at:string;read_at:string|null}
type Notify=(type:"pending"|"success"|"error",message:string)=>void
async function fetchNotifications(){
  const response=await fetch("/api/operations?view=notifications",{cache:"no-store"})
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw new Error(data.error||"Notifications unavailable")
  return data as {notifications:NotificationItem[];unread:number}
}
export default function NotificationCenter({onNotify}:{onNotify:Notify}){
  const [open,setOpen]=useState(false)
  const [items,setItems]=useState<NotificationItem[]>([])
  const [allowBrowser,setAllowBrowser]=useState(false)
  const [busy,setBusy]=useState(false)
  const [unread,setUnread]=useState(0)
  const initial=useRef(true)
  const latest=useRef<string>("")
  const notifyRef=useRef(onNotify)
  useEffect(()=>{notifyRef.current=onNotify},[onNotify])
  useEffect(()=>{
    let alive=true
    setAllowBrowser(localStorage.getItem("debt-browser-alerts")==="on")
    async function refresh(){
      try{
        const data=await fetchNotifications()
        if(!alive)return
        const fresh=data.notifications.filter(n=>!n.read_at)
        if(initial.current)latest.current=data.notifications[0]?.created_at||""
        else if(localStorage.getItem("debt-browser-alerts")==="on"&&
          typeof Notification!=="undefined"&&Notification.permission==="granted"){
          const newer=fresh.filter(n=>n.created_at>latest.current)
          if(newer.length) {
            // Never disclose private proof, debt or relationship details on the lock screen.
            new Notification("Velvet Ledger activity",{body:"You have a new private update.",tag:"debt-private-update"})
          }
        }
        latest.current=data.notifications[0]?.created_at||latest.current
        initial.current=false
        setItems(data.notifications);setUnread(data.unread)
      }catch{/* Keep notifications unobtrusive if temporarily offline. */}
    }
    void refresh()
    const interval=window.setInterval(refresh,30000)
    const onFocus=()=>{void refresh()}
    window.addEventListener("focus",onFocus)
    return ()=>{alive=false;window.clearInterval(interval);window.removeEventListener("focus",onFocus)}
  },[])
  async function mark(id?:string){
    if(busy)return
    setBusy(true)
    try{
      const response=await fetch("/api/operations",{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(id?{action:"read",id}:{action:"read-all"})})
      const result=await response.json().catch(()=>({}))
      if(!response.ok)throw Error(result.error||"Could not update notification")
      setItems(previous=>previous.map(item=>(!id||item.id===id)?{...item,read_at:item.read_at||new Date().toISOString()}:item))
      setUnread(previous=>id?Math.max(0,previous-(items.find(x=>x.id===id&&!x.read_at)?1:0)):0)
    }catch(error){notifyRef.current("error",error instanceof Error?error.message:"Notification action failed")}
    finally{setBusy(false)}
  }
  async function toggleBrowser(){
    if(allowBrowser){localStorage.removeItem("debt-browser-alerts");setAllowBrowser(false);return}
    if(typeof Notification==="undefined"){notifyRef.current("error","This browser does not support page notifications");return}
    const permission=await Notification.requestPermission()
    if(permission==="granted"){localStorage.setItem("debt-browser-alerts","on");setAllowBrowser(true)}
    else notifyRef.current("error","Browser notification permission was not granted")
  }
  return <div className="notification-hub">
    <button className="notification-trigger" type="button" aria-label={"Notifications, "+unread+" unread"} aria-expanded={open}
      onClick={()=>setOpen(previous=>!previous)}>♧ <span>Alerts</span>
      {unread>0&&<b className="notification-count">{unread>99?"99+":unread}</b>}
    </button>
    {open&&<div className="notification-panel" role="region" aria-label="Notifications">
      <div className="notification-panel-head"><h3>Recent activity</h3>
        <button type="button" aria-label="Close notifications" onClick={()=>setOpen(false)}>×</button></div>
      <div className="notification-panel-actions">
        <button className="btn btn-quiet" type="button" disabled={busy||!unread}
          onClick={()=>void mark()}>Mark all read</button>
        <button className="btn btn-quiet" type="button" onClick={()=>void toggleBrowser()}>
          {allowBrowser?"Disable page alerts":"Enable page alerts"}
        </button>
      </div>
      <p className="notification-privacy-note">Page alerts work while the app is open and never display sensitive details.</p>
      <div className="notification-list">
        {!items.length?<p className="muted">No notifications yet.</p>:items.map(item=>
          <button type="button" key={item.id} className={"notification-entry "+(!item.read_at?"unread":"")}
            onClick={()=>{void mark(item.id);setOpen(false);
              if(item.scene_id)window.dispatchEvent(new CustomEvent("debt-scene-activity",{detail:{sceneId:item.scene_id}}))
            }}>
            <small>{item.kind.toUpperCase()} · {new Date(item.created_at).toLocaleString("en-GB")}</small>
            <strong>{item.title}</strong><span>{item.detail}</span>
          </button>)}
      </div>
    </div>}
  </div>
}
