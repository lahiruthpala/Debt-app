"use client"
import type { EngineConfig,Mechanic } from "@/lib/contract-modules"

const options=[
  {type:"wheel",icon:"◉",name:"Fortune wheel",desc:"Spin for a random fictional credit or penalty"},
  {type:"dice",icon:"⚄",name:"Dice duel",desc:"Roll against the house; difference changes the debt"},
  {type:"checkin",icon:"◷",name:"Timed check-ins",desc:"Earn credits for checking in, optionally incur a late penalty"},
] as const
const defaults:Record<Mechanic["type"],Mechanic>={
  wheel:{type:"wheel",cooldownMinutes:60,segments:[{label:"Bonus credit",delta:-1000},{label:"Small penalty",delta:500},{label:"Lucky break",delta:-2500},{label:"No change",delta:0}]},
  dice:{type:"dice",cooldownMinutes:1440,sides:6,stake:500},
  checkin:{type:"checkin",intervalHours:24,credit:500,latePenalty:500},
}
export function ContractBuilder({value,onChange}:{value:EngineConfig;onChange:(next:EngineConfig)=>void}){
  const modules=value.modules
  function change(module:Mechanic){
    onChange({modules:modules.map(m=>m.type===module.type?module:m)})
  }
  function toggle(type:Mechanic["type"]){
    const exists=modules.some(m=>m.type===type)
    onChange({modules:exists?modules.filter(m=>m.type!==type):[...modules,defaults[type]]})
  }
  return <div className="contract-builder">
    <div className="builder-head"><div><span className="eyebrow">CONFIGURABLE GAME MECHANICS</span><h4>Build the contract’s interactive rules</h4></div><span className="status">{modules.length} / 3 MODULES</span></div>
    <p className="muted">Choose the mechanics players can actually use. The numbers are fictional, capped and enforced by the server. Both partners must accept the complete contract before play starts.</p>
    <div className="builder-modules">
      {options.map(option=>{
        const module=modules.find(m=>m.type===option.type)
        return <div className={"builder-module "+(module?"enabled":"")} key={option.type}>
          <label className="builder-toggle"><input type="checkbox" checked={!!module} onChange={()=>toggle(option.type)}/>
            <span className="builder-icon">{option.icon}</span>
            <span><strong>{option.name}</strong><small>{option.desc}</small></span>
          </label>
          {module?.type==="wheel"&&<div className="builder-fields">
            <label>COOLDOWN (MINUTES)<input type="number" min={0} max={10080} value={module.cooldownMinutes} onChange={e=>change({...module,cooldownMinutes:Number(e.target.value)})}/></label>
            <div className="builder-segments"><span>Wheel segments / outcomes</span>
              {module.segments.map((segment,index)=><div className="segment-editor" key={index}>
                <input aria-label={"Wheel segment "+(index+1)+" label"} maxLength={60} value={segment.label} onChange={e=>change({...module,segments:module.segments.map((s,i)=>i===index?{...s,label:e.target.value}:s)})}/>
                <input aria-label={"Wheel segment "+(index+1)+" change"} type="number" min={-5000} max={5000} value={segment.delta} onChange={e=>change({...module,segments:module.segments.map((s,i)=>i===index?{...s,delta:Number(e.target.value)}:s)})}/>
                <button type="button" aria-label={"Delete wheel segment "+(index+1)} disabled={module.segments.length<=2} className="btn btn-quiet" onClick={()=>change({...module,segments:module.segments.filter((_,i)=>i!==index)})}>×</button>
              </div>)}
              <small>Negative amounts reduce the debt; positive amounts add penalties. Each outcome is equally likely.</small>
              <button type="button" className="btn btn-outline" disabled={module.segments.length>=12} onClick={()=>change({...module,segments:[...module.segments,{label:"New outcome",delta:0}]})}>＋ Add wheel segment</button>
            </div>
          </div>}
          {module?.type==="dice"&&<div className="builder-fields two-fields">
            <label>NUMBER OF SIDES<input type="number" min={2} max={20} value={module.sides} onChange={e=>change({...module,sides:Number(e.target.value)})}/></label>
            <label>CHANGE PER POINT<input type="number" min={1} max={1000} value={module.stake} onChange={e=>change({...module,stake:Number(e.target.value)})}/></label>
            <label>COOLDOWN (MINUTES)<input type="number" min={0} max={10080} value={module.cooldownMinutes} onChange={e=>change({...module,cooldownMinutes:Number(e.target.value)})}/></label>
            <p className="builder-note">A player and bot roll independently. Winning gives credits, losing adds fictional penalties, with a maximum swing of 5,000 units.</p>
          </div>}
          {module?.type==="checkin"&&<div className="builder-fields two-fields">
            <label>INTERVAL (HOURS)<input type="number" min={1} max={168} value={module.intervalHours} onChange={e=>change({...module,intervalHours:Number(e.target.value)})}/></label>
            <label>CHECK-IN CREDIT<input type="number" min={0} max={5000} value={module.credit} onChange={e=>change({...module,credit:Number(e.target.value)})}/></label>
            <label>LATE PENALTY<input type="number" min={0} max={5000} value={module.latePenalty} onChange={e=>change({...module,latePenalty:Number(e.target.value)})}/></label>
            <p className="builder-note">A check-in after more than two intervals incurs one agreed late penalty. No background deductions or real payment collection.</p>
          </div>}
        </div>
      })}
    </div>
  </div>
}
