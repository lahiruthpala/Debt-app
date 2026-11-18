import assert from "node:assert/strict"
import {test} from "node:test"
import {showcaseSchema,earnedBadges,badgesForRole,normalizeFeaturedBadges,badgeDefinitions,activityLabel,interestGroups,interestLabels,isPresetInterest,normalizeInterests,MAX_PROFILE_LABELS,type ShowcaseStats} from "../lib/showcase.ts"

const settings={
  displayName:"Sample",tagline:"Creative collaboration",likes:["Dice games","Check-ins"],
  dislikes:["Pressure"],dedication:"Clear communication and consistency.",
  boundaries:"Consent can be withdrawn",showcaseEnabled:true,showStats:false,
  showAchievements:false,showActivity:false
}
test("showcase settings enforce bounded, unique interest labels and privacy flags",()=>{
  assert.ok(showcaseSchema.safeParse(settings).success)
  assert.equal(showcaseSchema.safeParse({...settings,likes:["Dice games","dice games"]}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,likes:Array(13).fill("bad")}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,displayName:"x".repeat(41)}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,showActivity:"yes"}).success,false)
})
test("member labels come from a fixed categorized catalog",()=>{
  assert.equal(interestGroups.length,4)
  assert.ok(interestLabels.length>=45)
  assert.equal(new Set(interestLabels).size,interestLabels.length)
  assert.ok(isPresetInterest("Puzzle games"))
  assert.equal(isPresetInterest("A made up label"),false)
  assert.equal(showcaseSchema.safeParse({...settings,likes:["A made up label"]}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,dislikes:["A made up label"]}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,likes:["Pressure"],dislikes:["Pressure"]}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,likes:Array(MAX_PROFILE_LABELS+1).fill("Music")}).success,false)
  assert.deepEqual(normalizeInterests(["Music","Custom old label","Music","Dice games"]),["Music","Dice games"])
})
const emptyStats:ShowcaseStats={
  acceptedAgreements:0,gameActions:0,tasksApproved:0,proofsApproved:0,
  proofsReviewed:0,publishedTemplates:0,campaignsCreated:0,campaignsJoined:0,
  campaignContributions:0,campaignTasksApproved:0,adoptedTemplates:0,
  lockProofsReviewed:0,ritualsOversaw:0,reviewedTasks:0,reviewedTaskPartners:0,
  finishedPublishedStories:0,qualifiedCampaigns:0,reviewPartners:0,
  rewardsFulfilled:0,ritualsCompleted:0,lockProofsApproved:0,
  finishedStories:0,tributeCampaigns:0,challengePoints:0,challengeCampaigns:0
}
test("exactly ten unique role badges each, no achievements without verified activity",()=>{
  const ids=badgeDefinitions.map(b=>b.id)
  assert.equal(ids.length,20)
  assert.equal(new Set(ids).size,20)
  assert.equal(badgesForRole(emptyStats,"dom").length,10)
  assert.equal(badgesForRole(emptyStats,"sub").length,10)
  assert.deepEqual(earnedBadges(emptyStats,"dom"),[])
  assert.deepEqual(earnedBadges(emptyStats,"sub"),[])
  assert.ok(badgesForRole(emptyStats,"sub").every(b=>!b.earned&&b.progress===0))
})
test("role-separated thresholds enforce both count and partner/campaign diversity",()=>{
  const dom=badgesForRole({...emptyStats,acceptedAgreements:1,reviewedTasks:15,
    reviewedTaskPartners:1,proofsReviewed:20,reviewPartners:2},"dom")
  assert.ok(dom.find(b=>b.id==="first-crown")?.earned)
  assert.equal(dom.find(b=>b.id==="taskmaster")?.earned,false)
  assert.ok(dom.find(b=>b.id==="the-arbiter")?.earned)
  assert.equal(dom.some(b=>b.id==="devoted-one"),false)
  assert.ok(earnedBadges({...emptyStats,reviewedTasks:15,reviewedTaskPartners:2},"dom")
    .some(b=>b.id==="taskmaster"))
  const sub=badgesForRole({...emptyStats,gameActions:20,campaignContributions:10,
    tributeCampaigns:1,challengePoints:30,challengeCampaigns:2},"sub")
  assert.ok(sub.find(b=>b.id==="fortunes-servant")?.earned)
  assert.equal(sub.find(b=>b.id==="tribute-bearer")?.earned,false)
  assert.ok(sub.find(b=>b.id==="crimson-champion")?.earned)
  assert.equal(sub.some(b=>b.id==="master-fate"),false)
})
test("featured badges must be earned and unique, and never accept arbitrary IDs",()=>{
  const earned=earnedBadges({...emptyStats,acceptedAgreements:1,gameActions:25,
    lockProofsReviewed:5,ritualsOversaw:10},"dom")
  assert.deepEqual(normalizeFeaturedBadges(["first-crown","master-fate","master-fate",
    "keeper-keys","ritual-master","inkbound","fake-badge"],earned),
    ["first-crown","master-fate","keeper-keys"])
  assert.deepEqual(normalizeFeaturedBadges(["inkbound"],earned),[])
  assert.ok(showcaseSchema.safeParse({...settings,featuredBadges:["first-crown"]}).success)
  assert.equal(showcaseSchema.safeParse({...settings,featuredBadges:["same","same"]}).success,false)
  assert.equal(showcaseSchema.safeParse({...settings,featuredBadges:["a","b","c","d"]}).success,false)
  assert.equal(activityLabel("dice"),"Played a dice game")
})
