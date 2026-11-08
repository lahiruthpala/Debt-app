import { z } from "zod"

/** Declarative mechanics only: no JavaScript, arbitrary expressions, or hidden side effects. */
const base = z.object({ cooldownMinutes: z.number().int().min(0).max(10080) })
const wheel = base.extend({
  type: z.literal("wheel"),
  segments: z.array(z.object({
    label: z.string().trim().min(1).max(60),
    // Negative gives a credit; positive adds a fictional penalty.
    delta: z.number().int().min(-5000).max(5000),
  })).min(2).max(12),
})
const dice = base.extend({
  type: z.literal("dice"),
  sides: z.number().int().min(2).max(20),
  stake: z.number().int().min(1).max(1000),
})
const checkin = z.object({
  type: z.literal("checkin"),
  intervalHours: z.number().int().min(1).max(168),
  credit: z.number().int().min(0).max(5000),
  latePenalty: z.number().int().min(0).max(5000),
})
export const moduleSchema=z.discriminatedUnion("type",[wheel,dice,checkin])
export const engineSchema=z.object({
  modules:z.array(moduleSchema).max(3).superRefine((items,ctx)=>{
    const types=new Set<string>()
    for (const [index,item] of items.entries()){
      if(types.has(item.type))ctx.addIssue({
        code:"custom",path:[index,"type"],message:"Use each mechanic at most once"
      })
      types.add(item.type)
    }
  })
})
export type EngineConfig=z.infer<typeof engineSchema>
export type Mechanic=EngineConfig["modules"][number]
export const EMPTY_ENGINE:EngineConfig={modules:[]}
export function parseEngine(value:unknown):EngineConfig {return engineSchema.parse(value??EMPTY_ENGINE)}
export function describeModule(module:Mechanic):string {
  switch(module.type){
    case "wheel":return "Wheel: "+module.segments.length+" possible outcomes, "+module.cooldownMinutes+"m cooldown"
    case "dice":return "Dice: d"+module.sides+" vs bot, "+module.stake+" units per point, "+module.cooldownMinutes+"m cooldown"
    case "checkin":return "Check-in: every "+module.intervalHours+"h; "+module.credit+" credit, up to "+module.latePenalty+" missed-action penalty"
  }
}
