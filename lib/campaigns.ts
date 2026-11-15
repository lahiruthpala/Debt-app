import {z} from "zod"
import {isPresetInterest} from "./showcase"

export const campaignKinds=["tribute","goal","challenge","competition","event"] as const
export const campaignVisibilities=["public","unlisted","restricted"] as const
export const campaignJoinPolicies=["open","approval","invite"] as const
export type CampaignKind=typeof campaignKinds[number]

const name=z.string().trim().min(3).max(100)
const timestamp=z.string().datetime({offset:true})
const milestone=z.object({
  title:z.string().trim().min(3).max(100),
  threshold:z.number().int().min(1).max(100000000)
})
const activityBase={title:name}
export const campaignActivitySchema=z.discriminatedUnion("type",[
  z.object({...activityBase,type:z.literal("task"),points:z.number().int().min(0).max(1000),
    proofRequired:z.boolean(),maxCompletionsPerMember:z.number().int().min(1).max(20)}),
  z.object({...activityBase,type:z.literal("game"),game:z.enum(["coin","dice","wheel"]),
    pointsWin:z.number().int().min(0).max(500),pointsLose:z.number().int().min(0).max(500),
    cooldownHours:z.number().int().min(1).max(168),
    wheelLabels:z.array(z.string().trim().min(1).max(40)).min(2).max(12).optional()}),
  z.object({...activityBase,type:z.literal("poll"),choices:z.array(z.string().trim().min(1).max(90)).min(2).max(8)
    .refine(items=>new Set(items.map(x=>x.toLowerCase())).size===items.length,"Poll answers must be distinct")})
])
export const campaignDefinition=z.object({
  title:name,description:z.string().trim().min(20).max(2000),rules:z.string().trim().min(20).max(5000),
  kind:z.enum(campaignKinds),visibility:z.enum(campaignVisibilities),
  joinPolicy:z.enum(campaignJoinPolicies),
  category:z.string().trim().min(3).max(40),
  tags:z.array(z.string().refine(isPresetInterest,"Use an existing interest label")).max(8)
    .refine(items=>new Set(items).size===items.length,"Duplicate interest labels"),
  startAt:timestamp.nullable(),endAt:timestamp.nullable(),
  goal:z.number().int().min(0).max(100000000),
  minContribution:z.number().int().min(1).max(1000000),
  maxContribution:z.number().int().min(1).max(1000000),
  maxPerMember:z.number().int().min(1).max(100000000),
  memberLimit:z.number().int().min(1).max(10000),
  requireContributionProof:z.boolean(),
  allowAnonymous:z.boolean(),leaderboardEnabled:z.boolean(),allowComments:z.boolean(),
  milestones:z.array(milestone).max(12),
  activities:z.array(campaignActivitySchema).max(20)
}).superRefine((x,ctx)=>{
  const issue=(path:(string|number)[],message:string)=>ctx.addIssue({code:"custom",path,message})
  if(x.maxContribution<x.minContribution)issue(["maxContribution"],"Maximum must be at least minimum")
  if(x.maxPerMember<x.minContribution)issue(["maxPerMember"],"Per-person cap is below minimum")
  if(["goal","competition"].includes(x.kind)&&x.goal===0)issue(["goal"],"This campaign type requires a goal")
  if(x.kind==="event"&&(!x.startAt||!x.endAt))issue(["endAt"],"Timed events need a start and an end")
  if(x.startAt&&x.endAt&&Date.parse(x.endAt)<=Date.parse(x.startAt))issue(["endAt"],"End must follow start")
  if(x.endAt&&Date.parse(x.endAt)<=Date.now())issue(["endAt"],"End time must be in the future")
  if(x.milestones.some(m=>x.goal>0&&m.threshold>x.goal))issue(["milestones"],"Milestones cannot exceed the target")
  if(new Set(x.milestones.map(m=>m.threshold)).size!==x.milestones.length)issue(["milestones"],"Milestones need distinct thresholds")
  if(x.kind==="challenge"&&!x.activities.some(a=>a.type==="task"||a.type==="game"))issue(["activities"],"Challenge campaigns need a task or game")
})
export type CampaignDefinition=z.infer<typeof campaignDefinition>
export type CampaignActivity=z.infer<typeof campaignActivitySchema>
export const contributionInput=z.object({campaignId:z.string().uuid(),amount:z.number().int().min(1).max(1000000),
  note:z.string().trim().max(400),requestId:z.string().uuid()})
export const postInput=z.object({campaignId:z.string().uuid(),content:z.string().trim().min(1).max(2000),
  parentId:z.string().uuid().nullable().optional()})
export const membershipPreferences=z.object({anonymous:z.boolean(),showOnLeaderboard:z.boolean(),
  personalCap:z.number().int().min(1).max(100000000)})
export function progressPercent(total:number,goal:number):number {
  if(goal<=0)return 0
  return Math.min(100,Math.max(0,Math.round(total/goal*1000)/10))
}
export function openForActions(status:string,startAt:string|Date|null,endAt:string|Date|null,now=Date.now()):boolean {
  return status==="published" && (!startAt || new Date(startAt).getTime()<=now)
    && (!endAt || new Date(endAt).getTime()>now)
}
export function canJoinCampaign(status:string,policy:string,startAt:string|Date|null,endAt:string|Date|null,now=Date.now()):boolean {
  return policy!=="invite"&&openForActions(status,startAt,endAt,now)
}
export function contributionAllowed(amount:number,min:number,max:number,total:number,cap:number,personalCap:number):boolean {
  return Number.isInteger(amount)&&amount>=min&&amount<=max&&amount+total<=Math.min(cap,personalCap)
}
