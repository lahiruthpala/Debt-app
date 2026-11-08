import {z} from "zod"

export const showcaseSchema=z.object({
  displayName:z.string().trim().max(40),
  tagline:z.string().trim().max(120),
  likes:z.array(z.string().trim().min(1).max(36)).max(12)
    .refine(items=>new Set(items.map(i=>i.toLowerCase())).size===items.length,"Duplicate interests are not allowed"),
  dislikes:z.array(z.string().trim().min(1).max(36)).max(12)
    .refine(items=>new Set(items.map(i=>i.toLowerCase())).size===items.length,"Duplicate dislikes are not allowed"),
  dedication:z.string().trim().max(400),
  boundaries:z.string().trim().max(400),
  showcaseEnabled:z.boolean(),
  showStats:z.boolean(),
  showAchievements:z.boolean(),
  showActivity:z.boolean()
})
export type ShowcaseSettings=z.infer<typeof showcaseSchema>
export type ShowcaseStats={
  acceptedAgreements:number;gameActions:number;tasksApproved:number;
  proofsApproved:number;proofsReviewed:number;publishedTemplates:number
}
export type ShowcaseBadge={id:string;title:string;description:string}
export function earnedBadges(stats:ShowcaseStats):ShowcaseBadge[]{
  const badges:ShowcaseBadge[]=[]
  if(stats.acceptedAgreements>=1)badges.push({id:"first-agreement",title:"Mutual Agreement",description:"Participated in a mutually accepted contract"})
  if(stats.acceptedAgreements>=3)badges.push({id:"consistent-partner",title:"Consistent Partner",description:"Participated in three accepted contracts"})
  if(stats.gameActions>=1)badges.push({id:"first-game",title:"First Move",description:"Completed a server-recorded game action"})
  if(stats.gameActions>=10)badges.push({id:"active-player",title:"Active Player",description:"Completed ten recorded game actions"})
  if(stats.tasksApproved>=1)badges.push({id:"verified-task",title:"Task Achiever",description:"Had at least one submitted task approved"})
  if(stats.proofsApproved>=1)badges.push({id:"verified-evidence",title:"Evidence Contributor",description:"Had a proof submission approved"})
  if(stats.proofsReviewed>=1)badges.push({id:"trusted-reviewer",title:"Trusted Reviewer",description:"Approved at least one partner proof"})
  if(stats.publishedTemplates>=1)badges.push({id:"creator",title:"Contract Creator",description:"Published a contract template"})
  return badges
}
export function activityLabel(action:string):string{
  switch(action){
    case "dice":return "Played a dice game"
    case "wheel":return "Spun a game wheel"
    case "random":return "Completed a random-event game"
    case "checkin":return "Recorded a check-in"
    case "boundary_req":return "Submitted a consent/status request"
    case "proof_review":return "Reviewed private proof evidence"
    default:return "Participated in a contract activity"
  }
}
