import assert from "node:assert/strict"
import {test} from "node:test"
import {showcaseSchema,earnedBadges,activityLabel,interestGroups,interestLabels,isPresetInterest,normalizeInterests,MAX_PROFILE_LABELS,type ShowcaseStats} from "../lib/showcase.ts"

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
test("achievement titles derive only from recorded stats, not a self-reported profile",()=>{
  const empty:ShowcaseStats={acceptedAgreements:0,gameActions:0,tasksApproved:0,
    proofsApproved:0,proofsReviewed:0,publishedTemplates:0}
  assert.deepEqual(earnedBadges(empty),[])
  const earned=earnedBadges({...empty,acceptedAgreements:3,gameActions:10,tasksApproved:1,
    proofsApproved:1,proofsReviewed:1,publishedTemplates:1}).map(x=>x.id)
  assert.ok(earned.includes("first-agreement"))
  assert.ok(earned.includes("active-player"))
  assert.ok(earned.includes("creator"))
  assert.equal(activityLabel("dice"),"Played a dice game")
  assert.equal(activityLabel("unknown"),"Participated in a contract activity")
})
