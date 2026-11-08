import { z } from "zod"

const id = z.string().uuid()
const title = z.string().trim().min(3).max(80)
const summary = z.string().trim().min(10).max(320)
const moduleBase = {id, name:z.string().trim().min(3).max(65)}
const interval = z.number().int().min(0).max(168) // 0 = unrestricted (daily safety cap still applies)
export const contractModuleSchema = z.discriminatedUnion("type",[
  z.object({...moduleBase,type:z.literal("dice"),sides:z.number().int().min(2).max(20),
    stake:z.number().int().min(100).max(5000),cooldownHours:interval}),
  z.object({...moduleBase,type:z.literal("wheel"),cooldownHours:interval,
    outcomes:z.array(z.object({label:z.string().trim().min(1).max(40),
      delta:z.number().int().min(-10000).max(10000)})).min(2).max(12)}),
  z.object({...moduleBase,type:z.literal("checkin"),
    reward:z.number().int().min(0).max(5000),
    latePenalty:z.number().int().min(0).max(5000).optional(),
    cooldownHours:z.number().int().min(1).max(168)}),
  z.object({...moduleBase,type:z.literal("random"),
    cooldownHours:interval,
    outcomes:z.array(z.object({
      label:z.string().trim().min(1).max(40),
      delta:z.number().int().min(-10000).max(10000),
      weight:z.number().int().min(1).max(20),
    })).min(2).max(12)}),
  z.object({...moduleBase,type:z.literal("tasks"),
    tasks:z.array(z.object({id,label:z.string().trim().min(3).max(140),
      reward:z.number().int().min(0).max(5000)})).min(1).max(12)})
])
export const termsSchema=z.object({
  principal:z.number().int().min(0).max(1000000),
  monthlyRate:z.number().int().min(0).max(30),
  weeklyTarget:z.number().int().min(0).max(100000),
  lateFee:z.number().int().min(0).max(10000)
})
export const contractDefinitionSchema=z.object({
  title,description:summary,category:z.string().trim().min(3).max(30),
  terms:termsSchema,
  modules:z.array(contractModuleSchema).min(1).max(8)
}).superRefine((input,ctx)=>{
  const used=new Set<string>()
  for(const module of input.modules){
    if(used.has(module.id))ctx.addIssue({code:"custom",message:"Each module needs a unique identifier",path:["modules"]})
    used.add(module.id)
    if(module.type==="tasks"){
      const tasks=new Set(module.tasks.map(task=>task.id))
      if(tasks.size!==module.tasks.length)ctx.addIssue({code:"custom",message:"Tasks must have unique identifiers",path:["modules"]})
    }
  }
})
export type ContractDefinition=z.infer<typeof contractDefinitionSchema>
export type ContractModule=z.infer<typeof contractModuleSchema>
export type ContractTerms=z.infer<typeof termsSchema>

/** Positive deltas add a fantasy charge. Negative deltas credit the ledger. */
export function duelDelta(player:number,computer:number,stake:number):number {
  return (computer-player)*stake
}
export function availableAfterCooldown(last:Date|string|null,hours:number,at=Date.now()) {
  if(!last || hours===0)return {ready:true,remainingSeconds:0}
  const left=Math.max(0,Math.ceil((new Date(last).getTime()+hours*3600000-at)/1000))
  return {ready:left===0,remainingSeconds:left}
}

/** Weighted outcomes are chosen on the server, never by the browser. */
export function weightedOutcome<T extends {weight:number}>(items:readonly T[],random:number):T {
  const total=items.reduce((sum,item)=>sum+item.weight,0)
  if(!items.length||total<=0||random<0||random>=total)throw new Error("Invalid random outcome")
  let ticket=random
  for(const item of items){
    ticket-=item.weight
    if(ticket<0)return item
  }
  return items[items.length-1]
}

/** Credits and missed-action penalties are netted once per manual check-in.
 * A one-interval grace period prevents immediately punishing a late click.
 * Never apply a scheduled penalty automatically in the background.
 */
export function checkinDelta(input:{previous:Date|string|null;started:Date|string|null;intervalHours:number;reward:number;latePenalty?:number},now=Date.now()) {
  const anchor=input.previous??input.started
  const overdue=Boolean(anchor && now-new Date(anchor).getTime()>input.intervalHours*2*3600000)
  const charged=overdue?(input.latePenalty??0):0
  return {overdue,latePenalty:charged,delta:charged-input.reward}
}
