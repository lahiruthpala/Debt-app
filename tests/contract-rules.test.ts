import {test} from "node:test"
import assert from "node:assert/strict"
import {contractDefinitionSchema,duelDelta,availableAfterCooldown} from "../lib/contract-rules.ts"

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
