"use client"
import {useEffect,useState} from "react"
import type {QuickGameKey} from "@/lib/quick-games"

type Feedback=(type:"pending"|"success"|"error",message:string)=>void
type LastPlay={game_key:QuickGameKey;played_at:string;outcome_label:string;delta:number}
type LastResult={game:QuickGameKey;label:string;detail:string;delta:number}
type Game={
 key:QuickGameKey;icon:string;title:string;genre:string;description:string;
 win:string;lose:string;choices:{value:string;label:string}[]
}
const choices={
 coin:[{value:"heads",label:"Heads"},{value:"tails",label:"Tails"}],
 highlow:[{value:"high",label:"High · 4–6"},{value:"low",label:"Low · 1–3"}],
 cards:[{value:"draw",label:"Draw a card"}],
 vault:[{value:"1",label:"Vault 1"},{value:"2",label:"Vault 2"},{value:"3",label:"Vault 3"}],
}
const games:Game[]=[
 {key:"coin",icon:"◐",title:"Coin Flip",genre:"PREDICTION",description:"Call heads or tails before a fair virtual coin lands.",win:"Correct: −1,000",lose:"Miss: +500",choices:choices.coin},
 {key:"highlow",icon:"⚅",title:"High or Low",genre:"DICE",description:"Will a six-sided die show high (4–6) or low (1–3)?",win:"Correct: −1,250",lose:"Miss: +600",choices:choices.highlow},
 {key:"cards",icon:"▣",title:"Mystery Cards",genre:"SURPRISE",description:"Draw one of six hidden cards: credits, twists and a blank card.",win:"Best: −2,000",lose:"Worst: +1,000",choices:choices.cards},
 {key:"vault",icon:"◇",title:"Vault Pick",genre:"TREASURE",description:"Pick one of three vaults. Only one hides the imaginary prize.",win:"Found: −1,800",lose:"Empty: +350",choices:choices.vault},
]
const defaultChoices:Record<QuickGameKey,string>={coin:"heads",highlow:"high",cards:"draw",vault:"1"}
const money=(value:number)=>Number(value).toLocaleString("en-US")
const errorMessage=(e:unknown)=>e instanceof Error?e.message:"Could not play the game"
function cooldown(play?:LastPlay){
 if(!play)return null
 const remaining=Date.parse(play.played_at)+24*60*60*1000-Date.now()
 if(remaining<=0)return null
 const hours=Math.floor(remaining/3600000)
 const minutes=Math.ceil((remaining%3600000)/60000)
 return `Next round in ${hours}h ${minutes}m`
}
export default function QuickGameGallery({sceneId,active,role,onNotify,onChanged}:{
 sceneId:string;active:boolean;role:"dom"|"sub";onNotify:Feedback;onChanged:()=>Promise<void>
}){
 const [lastPlays,setLastPlays]=useState<LastPlay[]>([])
 const [choice,setChoice]=useState<Record<QuickGameKey,string>>(defaultChoices)
 const [running,setRunning]=useState<QuickGameKey|null>(null)
 const [lastResult,setLastResult]=useState<LastResult|null>(null)
 const [loading,setLoading]=useState(false)
 useEffect(()=>{
   let cancelled=false
   setLastPlays([])
   setLastResult(null)
   if(!sceneId)return
   setLoading(true)
   void fetch("/api/quick-games?"+new URLSearchParams({sceneId}),{cache:"no-store"})
     .then(async r=>{
       const data=await r.json().catch(()=>({}))
       if(!r.ok)throw Error(data.error||"Cannot load mini-game availability")
       if(!cancelled)setLastPlays(data.plays||[])
     }).catch(e=>{if(!cancelled)onNotify("error",errorMessage(e))})
     .finally(()=>{if(!cancelled)setLoading(false)})
   return ()=>{cancelled=true}
 // Notification callback intentionally uses the parent dispatcher; only refetch for scene change.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[sceneId])
 async function play(game:QuickGameKey){
   if(!sceneId||running)return
   setRunning(game)
   onNotify("pending","Resolving your "+games.find(g=>g.key===game)?.title+" round…")
   try {
     const response=await fetch("/api/quick-games",{
       method:"POST",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({sceneId,game,choice:choice[game]}),
     })
     const data=await response.json().catch(()=>({}))
     if(!response.ok)throw Error(data.error||"Game unavailable")
     setLastResult(data.result)
     setLastPlays(old=>[...old.filter(p=>p.game_key!==game),{
       game_key:game,played_at:new Date().toISOString(),outcome_label:data.result.label,delta:data.result.delta,
     }])
     onNotify("success",data.message)
     await onChanged()
   } catch(error){onNotify("error",errorMessage(error))}
   finally{setRunning(null)}
 }
 return <section className="quick-mini-section" aria-label="Instant mini games">
   <div className="section-title"><h2>Instant mini-games</h2><span>4 MORE WAYS TO PLAY</span></div>
   <p className="quick-mini-explainer">Server-generated results, one round per game every 24 hours per scene. Each game adjusts only fictional credits and penalties, and records the outcome in the ledger.</p>
   <div className="quick-mini-grid">
     {games.map((game,index)=>{
       const previous=lastPlays.find(x=>x.game_key===game.key)
       const waiting=cooldown(previous)
       const enabled=active&&role==="sub"&&!waiting&&!loading&&!running
       const result=lastResult?.game===game.key?lastResult:null
       return <article className={"quick-mini-card theme-"+game.key} key={game.key}>
         <div className="quick-mini-top"><span className="quick-mini-tag">GAME {String(index+4).padStart(2,"0")} / {game.genre}</span><span className="quick-mini-glyph" aria-hidden="true">{game.icon}</span></div>
         <h3>{game.title}</h3><p>{game.description}</p>
         <div className="quick-mini-stakes"><span className="quick-credit">{game.win}</span><span className="quick-penalty">{game.lose}</span></div>
         {game.choices.length>1 && <div className="quick-mini-pick" role="group" aria-label={"Choose for "+game.title}>
           {game.choices.map(item=><button key={item.value} type="button"
             aria-pressed={choice[game.key]===item.value}
             className={choice[game.key]===item.value?"chosen":""}
             onClick={()=>setChoice(old=>({...old,[game.key]:item.value}))}>{item.label}</button>)}
         </div>}
         <button className="btn btn-red quick-mini-play" type="button"
           disabled={!enabled} onClick={()=>void play(game.key)}>
           {running===game.key?"Resolving…":game.key==="cards"?"Draw mystery card":"Play "+game.title+" ↗"}
         </button>
         <small className="quick-mini-availability">{waiting||(!active?"Activate a scene to play.":role!=="sub"?"Sub initiates ledger-changing rounds.":"Ready when you are.")}</small>
         {result && <div className="quick-mini-result" role="status">
           <b>{result.label}</b>
           <span>{result.delta<0?"Credit −"+money(-result.delta):result.delta>0?"Penalty +"+money(result.delta):"No change"}</span>
         </div>}
       </article>
     })}
   </div>
 </section>
}
