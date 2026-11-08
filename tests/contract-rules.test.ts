import {test} from "node:test"
import assert from "node:assert/strict"
import {contractDefinitionSchema,duelDelta,availableAfterCooldown,weightedOutcome,checkinDelta} from "../lib/contract-rules.ts"

test("server accepts configurable dice, wheel, check-ins and tasks",()=>{
  const modules=[
    {id:"11111111-1111-4111-8111-111111111111",name:"Dice",type:"dice",sides:12,stake:500,cooldownHours:24},
    {id:"22222222-2222-4222-8222-222222222222",name:"Spin",type:"wheel",cooldownHours:2,outcomes:[{label:"credit",delta:-2000},{label:"penalty",delta:2000}]},
    {id:"33333333-3333-4333-8333-333333333333",name:"Attendance",type:"checkin",reward:500,cooldownHours:24},
    {id:"44444444-4444-4444-8444-444444444444",name:"Challenges",type:"tasks",tasks:[{id:"55555555-5555-4555-8555-555555555555",label:"Write a plan",reward:1000}]}
  ]
  const input={title:"A custom fantasy debt contract",description:"Agree on custom games and credits.",category:"Strategy",
    terms:{principal:50000,monthlyRate:5,weeklyTarget:2500,lateFee:1000},modules}
  assert.equal(contractDefinitionSchema.safeParse(input).success,true)
  assert.equal(contractDefinitionSchema.safeParse({...input,modules:[modules[0],modules[0]]}).success,false)
  assert.equal(contractDefinitionSchema.safeParse({...input,modules:[{...modules[0],stake:99999}]}).success,false)
})
test("dice rewards player wins and penalizes losses",()=>{
  assert.equal(duelDelta(6,2,500),-2000)
  assert.equal(duelDelta(3,6,500),1500)
  assert.equal(duelDelta(3,3,500),0)
})
test("cooldowns are computed from the server clock",()=>{
  const then="2026-11-07T00:00:00.000Z"
  assert.equal(availableAfterCooldown(then,24,Date.parse(then)+3600000).ready,false)
  assert.equal(availableAfterCooldown(then,24,Date.parse(then)+86400000).ready,true)
  assert.equal(availableAfterCooldown(then,0,Date.parse(then)+1000).ready,true)
})

test("weighted events honor odds and reject invalid tickets",()=>{
  const choices=[{weight:3,label:"credit"},{weight:2,label:"penalty"},{weight:5,label:"quiet"}]
  for(let value=0;value<10;value++){
    const expected=value<3?"credit":value<5?"penalty":"quiet"
    assert.equal(weightedOutcome(choices,value).label,expected)
  }
  assert.throws(()=>weightedOutcome(choices,10))
})
test("check-ins apply no late penalty before the grace interval",()=>{
  const now=Date.parse("2026-11-08T12:00:00Z")
  const start=new Date(now-36*3600000)
  assert.deepEqual(checkinDelta({previous:null,started:start,intervalHours:24,reward:500,latePenalty:1200},now),
    {overdue:false,latePenalty:0,delta:-500})
  assert.deepEqual(checkinDelta({previous:null,started:start,intervalHours:12,reward:500,latePenalty:1200},now),
    {overdue:true,latePenalty:1200,delta:700})
  assert.deepEqual(checkinDelta({previous:null,started:start,intervalHours:12,reward:500},now),
    {overdue:true,latePenalty:0,delta:-500})
})
test("user-defined weighted events obey server caps",()=>{
  const base={title:"Weighted contract",description:"Flexible, agreed fantasy mechanics.",category:"Chance",
    terms:{principal:10000,monthlyRate:0,weeklyTarget:1000,lateFee:0},
    modules:[{id:"77777777-7777-4777-8777-777777777777",name:"Random Surprise",type:"random",
      cooldownHours:1,outcomes:[{label:"Credit",delta:-500,weight:7},{label:"Penalty",delta:1000,weight:1}]}]}
  assert.equal(contractDefinitionSchema.safeParse(base).success,true)
  assert.equal(contractDefinitionSchema.safeParse({...base,modules:[{...base.modules[0],outcomes:[{label:"Test",delta:0,weight:0},{label:"Other",delta:0,weight:1}]}]}).success,false)
})
