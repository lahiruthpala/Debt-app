export {badgeDefinitions,badgesForRole,earnedBadges,normalizeFeaturedBadges} from "./showcase-badges.ts"
export type {ShowcaseStats,ShowcaseBadge,BadgeRole,BadgeRarity} from "./showcase-badges.ts"
import {z} from "zod"

// One versioned, server-validated catalog. Members select existing labels only.
export const interestGroups=[
  {name:"Communication & trust",labels:[
    "Communication","Clear boundaries","Check-ins","Respect","Trust","Consistency",
    "Planning","Aftercare","Accountability","Honesty","Consent discussions",
    "Unclear rules","Pressure","Surprises"
  ]},
  {name:"Games & creativity",labels:[
    "Dice games","Puzzle games","Wheel games","Trivia","Story games",
    "Roleplay","Creative challenges","Daily quests","Cooperative games",
    "Competition","Writing","Brain teasers","Random challenges"
  ]},
  {name:"Dynamics & interests",labels:[
    "Chastity","Keyholding","Teasing","Power exchange","Rules and rituals",
    "Service","Rewards and penalties","Task-based play","Protocol",
    "Collars","Blindfolds","Restraints","Sensation play","Gentle dominance",
    "Gentle submission","Dedication","Training","Long-term challenges"
  ]},
  {name:"Hobbies & lifestyle",labels:[
    "Music","Movies","Reading","Gaming","Fitness","Sports","Photography",
    "Art","Technology","Travel","Nature","Cooking","Pets","Badminton",
    "Learning","Volunteering","Conversation","Humor"
  ]}
] as const

export const interestLabels:readonly string[]=interestGroups.flatMap(group=>group.labels)
const interestLabelSet=new Set<string>(interestLabels)
export const MAX_PROFILE_LABELS=24
export const MAX_DISCOVER_LIKES=8
export function isPresetInterest(value:string):boolean {
  return interestLabelSet.has(value)
}
export function normalizeInterests(input:unknown):string[]{
  if(!Array.isArray(input))return []
  return Array.from(new Set(input.filter((x):x is string=>typeof x==="string"&&isPresetInterest(x)))).slice(0,MAX_PROFILE_LABELS)
}

export const showcaseSchema=z.object({
  displayName:z.string().trim().max(40),
  tagline:z.string().trim().max(120),
  likes:z.array(z.string().refine(isPresetInterest,"Select a label from the preset catalog")).max(MAX_PROFILE_LABELS)
    .refine(items=>new Set(items).size===items.length,"Duplicate interests are not allowed"),
  dislikes:z.array(z.string().refine(isPresetInterest,"Select a label from the preset catalog")).max(MAX_PROFILE_LABELS)
    .refine(items=>new Set(items).size===items.length,"Duplicate dislikes are not allowed"),
  dedication:z.string().trim().max(400),
  boundaries:z.string().trim().max(400),
  showcaseEnabled:z.boolean(),
  showStats:z.boolean(),
  showAchievements:z.boolean(),
  showActivity:z.boolean(),
  featuredBadges:z.array(z.string().regex(/^[a-z0-9-]+$/)).max(3)
    .refine(items=>new Set(items).size===items.length,"Duplicate featured badges are not allowed").default([])
}).superRefine((data,ctx)=>{
  const likes=new Set(data.likes)
  for(const value of data.dislikes){
    if(likes.has(value))ctx.addIssue({code:"custom",path:["dislikes"],message:"A label cannot be both liked and disliked"})
  }
})
export type ShowcaseSettings=z.infer<typeof showcaseSchema>
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
