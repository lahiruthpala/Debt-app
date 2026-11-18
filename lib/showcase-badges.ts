/**
 * Role-specific achievements based solely on server-verified app actions.
 * The catalog is public, but member progress and unlocks follow profile visibility.
 */
export type BadgeRole = "dom" | "sub"
export type BadgeRarity = "common" | "rare" | "epic" | "legendary"
export type ShowcaseStats = {
  acceptedAgreements:number;gameActions:number;tasksApproved:number;
  proofsApproved:number;proofsReviewed:number;publishedTemplates:number;
  campaignsCreated:number;campaignsJoined:number;campaignContributions:number;campaignTasksApproved:number;
  adoptedTemplates:number;lockProofsReviewed:number;ritualsOversaw:number;
  reviewedTasks:number;reviewedTaskPartners:number;finishedPublishedStories:number;
  qualifiedCampaigns:number;reviewPartners:number;rewardsFulfilled:number;
  ritualsCompleted:number;lockProofsApproved:number;finishedStories:number;
  tributeCampaigns:number;challengePoints:number;challengeCampaigns:number
}
type Metric = keyof ShowcaseStats
export type ShowcaseBadge = {
  id:string;title:string;description:string;role:BadgeRole;rarity:BadgeRarity;
  symbol:string;earned:boolean;progress:number;target:number;
  secondaryProgress?:number;secondaryTarget?:number;unlockedAt?:string
}
type BadgeDefinition = {
  id:string;title:string;description:string;role:BadgeRole;rarity:BadgeRarity;
  symbol:string;metric:Metric;target:number;secondaryMetric?:Metric;secondaryTarget?:number
}
export const badgeDefinitions:readonly BadgeDefinition[] = [
  {id:"first-crown",role:"dom",title:"The First Crown",description:"Join your first mutually accepted contract.",rarity:"common",symbol:"♛",metric:"acceptedAgreements",target:1},
  {id:"pact-architect",role:"dom",title:"Pact Architect",description:"Create 3 published contract templates each used in a mutually accepted contract.",rarity:"rare",symbol:"✎",metric:"adoptedTemplates",target:3},
  {id:"keeper-keys",role:"dom",title:"Keeper of Keys",description:"Approve 5 voluntary lock-status proof submissions.",rarity:"rare",symbol:"⚿",metric:"lockProofsReviewed",target:5},
  {id:"ritual-master",role:"dom",title:"Ritual Master",description:"Approve 10 agreed ritual check-ins.",rarity:"rare",symbol:"✦",metric:"ritualsOversaw",target:10},
  {id:"taskmaster",role:"dom",title:"The Taskmaster",description:"Review 15 completed tasks involving at least 2 different Subs.",rarity:"epic",symbol:"⚔",metric:"reviewedTasks",target:15,secondaryMetric:"reviewedTaskPartners",secondaryTarget:2},
  {id:"master-fate",role:"dom",title:"Master of Fate",description:"Play 25 server-recorded game actions.",rarity:"epic",symbol:"⚄",metric:"gameActions",target:25},
  {id:"story-enchantress",role:"dom",title:"Story Enchantress",description:"Publish 2 distinct story games that each have a finished session.",rarity:"epic",symbol:"✧",metric:"finishedPublishedStories",target:2},
  {id:"campaign-sovereign",role:"dom",title:"Campaign Sovereign",description:"Create a published campaign with at least 3 active voluntary participants.",rarity:"epic",symbol:"⚑",metric:"qualifiedCampaigns",target:1},
  {id:"the-arbiter",role:"dom",title:"The Arbiter",description:"Approve 20 private proofs submitted by at least 2 different Subs.",rarity:"legendary",symbol:"◇",metric:"proofsReviewed",target:20,secondaryMetric:"reviewPartners",secondaryTarget:2},
  {id:"golden-throne",role:"dom",title:"The Golden Throne",description:"Fulfill 5 redeemed non-monetary rewards.",rarity:"legendary",symbol:"♕",metric:"rewardsFulfilled",target:5},

  {id:"inkbound",role:"sub",title:"Inkbound",description:"Accept your first mutually agreed contract.",rarity:"common",symbol:"❧",metric:"acceptedAgreements",target:1},
  {id:"devoted-one",role:"sub",title:"The Devoted One",description:"Complete 5 approved tasks.",rarity:"rare",symbol:"♥",metric:"tasksApproved",target:5},
  {id:"ritual-acolyte",role:"sub",title:"Ritual Acolyte",description:"Complete 10 approved, voluntary ritual check-ins.",rarity:"rare",symbol:"◷",metric:"ritualsCompleted",target:10},
  {id:"fortunes-servant",role:"sub",title:"Fortune's Servant",description:"Complete 20 recorded games, regardless of outcome.",rarity:"rare",symbol:"⚄",metric:"gameActions",target:20},
  {id:"bearer-proof",role:"sub",title:"Bearer of Proof",description:"Receive approval for 5 private proof submissions.",rarity:"rare",symbol:"◈",metric:"proofsApproved",target:5},
  {id:"keybound",role:"sub",title:"Keybound",description:"Receive approval for 5 voluntary lock-status proof submissions.",rarity:"epic",symbol:"⚿",metric:"lockProofsApproved",target:5},
  {id:"storybound",role:"sub",title:"The Storybound",description:"Participate in and finish 3 collaborative story-game sessions.",rarity:"epic",symbol:"✧",metric:"finishedStories",target:3},
  {id:"velvet-pilgrim",role:"sub",title:"Velvet Pilgrim",description:"Voluntarily join 3 distinct campaigns.",rarity:"rare",symbol:"◇",metric:"campaignsJoined",target:3},
  {id:"tribute-bearer",role:"sub",title:"Tribute Bearer",description:"Make 10 approved fictional contributions across at least 2 campaigns.",rarity:"epic",symbol:"◎",metric:"campaignContributions",target:10,secondaryMetric:"tributeCampaigns",secondaryTarget:2},
  {id:"crimson-champion",role:"sub",title:"Crimson Champion",description:"Earn 30 points from approved campaign tasks across at least 2 campaigns.",rarity:"legendary",symbol:"★",metric:"challengePoints",target:30,secondaryMetric:"challengeCampaigns",secondaryTarget:2}
]
export function badgesForRole(stats:ShowcaseStats,role:BadgeRole):ShowcaseBadge[] {
  return badgeDefinitions.filter(b=>b.role===role).map(b=>{
    const progress=Math.max(0,Number(stats[b.metric]||0))
    const secondaryProgress=b.secondaryMetric===undefined?undefined:Math.max(0,Number(stats[b.secondaryMetric]||0))
    return {
      id:b.id,title:b.title,description:b.description,role:b.role,rarity:b.rarity,symbol:b.symbol,
      earned:progress>=b.target&&(b.secondaryTarget===undefined||(secondaryProgress??0)>=b.secondaryTarget),
      progress,target:b.target,
      ...(secondaryProgress===undefined?{}:{secondaryProgress,secondaryTarget:b.secondaryTarget})
    }
  })
}
export function earnedBadges(stats:ShowcaseStats,role:BadgeRole):ShowcaseBadge[] {
  return badgesForRole(stats,role).filter(b=>b.earned)
}
export function normalizeFeaturedBadges(value:unknown,earned:readonly ShowcaseBadge[]):string[] {
  if(!Array.isArray(value))return []
  const allowed=new Set(earned.filter(b=>b.earned).map(b=>b.id))
  return Array.from(new Set(value.filter((v):v is string=>typeof v==="string"&&allowed.has(v)))).slice(0,3)
}
