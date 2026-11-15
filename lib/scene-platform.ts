import {z} from "zod"

/**
 * Deterministic scene capabilities. No user-authored scripts and no automatic
 * fictional-ledger effects: changing balances stays in the original consented
 * contract endpoints.
 */
export const capabilityManifest={
  "narrative.choice":{mutates:"story",needs:"approved-story"},
  "narrative.task-proposal":{mutates:"task-proposal",needs:"approved-story"},
  "narrative.points":{mutates:"reward-points",needs:"approved-story"},
  "task.complete":{mutates:"task-progress",needs:"task-consent"},
  "chat.message":{mutates:"chat",needs:"active-scene"},
  "scene.stop":{mutates:"consent",needs:"participant"},
} as const
export const slug=z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/)
const choiceSchema=z.object({
  id:slug,label:z.string().trim().min(3).max(140),next:slug,
  requiresFlag:slug.optional(),setsFlag:slug.optional(),
  requiresItem:slug.optional(),grantItem:slug.optional(),consumeItem:slug.optional(),
  randomTargets:z.array(z.object({next:slug,weight:z.number().int().min(1).max(100)}).strict()).min(2).max(5).optional(),
  points:z.number().int().min(0).max(10).default(0),
  proposeTask:z.string().trim().max(100).refine(s=>!s||s.length>=3,
    "Story task titles must contain at least three characters").default(""),
}).strict()
const nodeSchema=z.object({
  id:slug,title:z.string().trim().min(3).max(100),
  text:z.string().trim().min(12).max(1600),
  choices:z.array(choiceSchema).max(4),
}).strict()
export const narrativeSchema=z.object({
  title:z.string().trim().min(3).max(80),
  summary:z.string().trim().min(10).max(240),
  category:z.string().trim().min(3).max(30),
  nodes:z.array(nodeSchema).min(2).max(24),
}).strict().superRefine((definition,ctx)=>{
  const nodes=new Map(definition.nodes.map(node=>[node.id,node]))
  if(!nodes.has("start"))ctx.addIssue({code:"custom",message:"The story needs a node with ID start"})
  let endings=0,choices=0
  for(const node of definition.nodes){
    if(node.choices.length===0)endings++
    const ids=new Set<string>()
    for(const choice of node.choices){
      if(!nodes.has(choice.next))ctx.addIssue({code:"custom",message:"Choice "+choice.id+" points to a missing chapter"})
      for(const target of choice.randomTargets||[]){
        if(!nodes.has(target.next))ctx.addIssue({code:"custom",message:"Random encounter points to a missing chapter"})
      }
      if(ids.has(choice.id))ctx.addIssue({code:"custom",message:"Choice IDs must be unique within a chapter"})
      ids.add(choice.id);choices++
    }
  }
  if(nodes.size!==definition.nodes.length)ctx.addIssue({code:"custom",message:"Chapter IDs must be unique"})
  if(!endings)ctx.addIssue({code:"custom",message:"At least one chapter must finish the story"})
  if(choices<1)ctx.addIssue({code:"custom",message:"Add at least one story choice"})
  // Every chapter must be reachable; avoids unreachable surprises in published works.
  const seen=new Set<string>(),todo=["start"]
  while(todo.length){
    const next=todo.pop()!
    if(seen.has(next))continue
    seen.add(next)
    for(const choice of nodes.get(next)?.choices||[]){
      if(!seen.has(choice.next))todo.push(choice.next)
      for(const target of choice.randomTargets||[])if(!seen.has(target.next))todo.push(target.next)
    }
  }
  if(seen.size!==nodes.size)ctx.addIssue({code:"custom",message:"Every chapter must be reachable from start"})
})
export type Narrative=z.infer<typeof narrativeSchema>
export type NarrativeState={nodeId:string;flags:string[];items:string[];decisions:number}
export const initialNarrativeState: NarrativeState={nodeId:"start",flags:[],items:[],decisions:0}

export function narrativeStep(definition:Narrative,state:NarrativeState,choiceId:string,roll?:number){
  const chapter=definition.nodes.find(node=>node.id===state.nodeId)
  if(!chapter)throw Error("Story chapter is missing")
  if(state.decisions>=60)throw Error("The story has reached its 60-choice safety limit")
  const choice=permittedChoices(definition,state).find(c=>c.id===choiceId)
  if(!choice)throw Error("This choice is unavailable")
  let next=choice.next
  if(choice.randomTargets?.length){
    const total=choice.randomTargets.reduce((sum,item)=>sum+item.weight,0)
    // The server supplies a cryptographically secure draw; pure helper remains browser-safe.
    if(roll===undefined)throw Error("Random encounter requires a server-generated draw")
    let draw=roll
    if(!Number.isInteger(draw)||draw<0||draw>=total)throw Error("Invalid encounter roll")
    for(const item of choice.randomTargets){
      if(draw<item.weight){next=item.next;break}
      draw-=item.weight
    }
  }
  const target=definition.nodes.find(node=>node.id===next)
  if(!target)throw Error("Next chapter is missing")
  const currentItems=Array.isArray(state.items)?state.items:[]
  const withoutConsumed=choice.consumeItem?currentItems.filter(item=>item!==choice.consumeItem):currentItems
  const items=choice.grantItem&&!withoutConsumed.includes(choice.grantItem)&&withoutConsumed.length<12?
    [...withoutConsumed,choice.grantItem]:withoutConsumed
  return {
    state:{nodeId:target.id,flags:choice.setsFlag?Array.from(new Set([...state.flags,choice.setsFlag])):state.flags,
      items,decisions:state.decisions+1},
    choice,chapter,targetId:target.id,finished:target.choices.length===0,
  }
}

export const taskStepSchema=z.object({
  id:slug,title:z.string().trim().min(3).max(100),
  instruction:z.string().trim().min(5).max(400),
  requiresNote:z.boolean().default(false),
  timerMinutes:z.number().int().min(0).max(120).default(0),
}).strict()
export const assignmentInput=z.object({
  title:z.string().trim().min(3).max(100),
  description:z.string().trim().max(600).default(""),
  steps:z.array(taskStepSchema).min(1).max(8).refine(
    steps=>new Set(steps.map(s=>s.id)).size===steps.length,
    "Each step needs a unique ID"
  ),
  points:z.number().int().min(0).max(60).default(20),
}).strict()
export type AdvancedTask=z.infer<typeof assignmentInput>
export const safetyLimitOptions=[
  "no-real-money","no-intimate-images","no-device-control","no-public-sharing",
  "no-location-sharing","no-unexpected-tasks","no-night-notifications",
] as const
export const safetyInput=z.object({
  limits:z.array(z.enum(safetyLimitOptions)).max(safetyLimitOptions.length),
  shareLimits:z.boolean(),
  aiOptIn:z.boolean(),
  aftercare:z.string().trim().max(500),
}).strict()

export function permittedChoices(definition:Narrative,state:NarrativeState){
  const node=definition.nodes.find(n=>n.id===state.nodeId)
  return node?node.choices.filter(c=>
    (!c.requiresFlag||state.flags.includes(c.requiresFlag))&&
    (!c.requiresItem||state.items?.includes(c.requiresItem))&&
    (!c.consumeItem||state.items?.includes(c.consumeItem))):[]
}
export function capEventPoints(points:number,earnedToday:number){
  if(!Number.isInteger(points)||points<0||points>10)throw Error("Invalid points effect")
  return Math.max(0,Math.min(points,60-Math.max(0,earnedToday)))
}
