import assert from "node:assert/strict"
import {test} from "node:test"
import {campaignDefinition,campaignActivitySchema,openForActions,canJoinCampaign,
 contributionAllowed,progressPercent,campaignKinds} from "../lib/campaigns.ts"

const base={
 title:"Community goal campaign",description:"A clear voluntary community roleplay activity.",
 rules:"This is a fictional, voluntary game with no real payments or penalties for withdrawing.",
 kind:"goal",visibility:"public",joinPolicy:"open",category:"Community",tags:["Dice games"],
 startAt:null,endAt:null,goal:100000,minContribution:100,maxContribution:10000,
 maxPerMember:50000,memberLimit:100,requireContributionProof:false,
 allowAnonymous:true,leaderboardEnabled:true,allowComments:true,
 milestones:[{title:"First step",threshold:25000}],activities:[]
} as const
test("all five campaign types are in the allowlist",()=>{
 assert.deepEqual([...campaignKinds],["tribute","goal","challenge","competition","event"])
})
test("valid campaign definition permits only catalog labels, bounded amounts and milestones",()=>{
 assert.equal(campaignDefinition.safeParse(base).success,true)
 assert.equal(campaignDefinition.safeParse({...base,tags:["Unknown"]}).success,false)
 assert.equal(campaignDefinition.safeParse({...base,minContribution:20000}).success,false)
 assert.equal(campaignDefinition.safeParse({...base,memberLimit:0}).success,false)
 assert.equal(campaignDefinition.safeParse({...base,milestones:[{title:"Impossible",threshold:100001}]}).success,false)
 assert.equal(campaignDefinition.safeParse({...base,goal:0}).success,false)
})
test("private invitation-only campaigns cannot accidentally permit open joining",()=>{
 assert.equal(campaignDefinition.safeParse({...base,visibility:"restricted",joinPolicy:"open"}).success,false)
 assert.equal(campaignDefinition.safeParse({...base,visibility:"restricted",joinPolicy:"invite"}).success,true)
 assert.equal(canJoinCampaign("published","invite",null,null),false)
 assert.equal(canJoinCampaign("published","open",null,null),true)
 assert.equal(canJoinCampaign("published","open",new Date(Date.now()+3600000).toISOString(),null),true)
 assert.equal(canJoinCampaign("paused","open",null,null),false)
})
test("timed events enforce start/end and open windows",()=>{
 const now=Date.now()
 assert.equal(campaignDefinition.safeParse({...base,kind:"event",startAt:null,endAt:null}).success,false)
 assert.equal(openForActions("published",new Date(now+60000).toISOString(),null,now),false)
 assert.equal(openForActions("published",null,new Date(now-60000).toISOString(),now),false)
 assert.equal(openForActions("published",null,new Date(now+60000).toISOString(),now),true)
})
test("task, game and poll inputs are constrained and checked server-side",()=>{
 assert.equal(campaignActivitySchema.safeParse({type:"task",title:"A task",points:100,proofRequired:true,maxCompletionsPerMember:2}).success,true)
 assert.equal(campaignActivitySchema.safeParse({type:"game",title:"Dice duel",game:"dice",pointsWin:100,pointsLose:5,cooldownHours:24}).success,true)
 assert.equal(campaignActivitySchema.safeParse({type:"poll",title:"Choose a path",choices:["A","B"]}).success,true)
 assert.equal(campaignActivitySchema.safeParse({type:"poll",title:"Choose a path",choices:["A","a"]}).success,false)
 assert.equal(campaignActivitySchema.safeParse({type:"game",title:"Dice duel",game:"dice",pointsWin:-100,pointsLose:5,cooldownHours:0}).success,false)
 assert.equal(campaignDefinition.safeParse({...base,kind:"challenge",activities:[]}).success,false)
})
test("fictional contributions are bounded by campaign AND private participant caps",()=>{
 assert.equal(contributionAllowed(100,100,1000,500,5000,700),true)
 assert.equal(contributionAllowed(201,100,1000,500,5000,700),false)
 assert.equal(contributionAllowed(99,100,1000,0,5000,700),false)
 assert.equal(contributionAllowed(1001,100,1000,0,5000,700),false)
 assert.equal(progressPercent(750,1000),75)
 assert.equal(progressPercent(1200,1000),100)
 assert.equal(progressPercent(0,0),0)
})
