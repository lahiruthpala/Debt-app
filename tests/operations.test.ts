import assert from "node:assert/strict"
import {test} from "node:test"
import {applyCredit} from "../lib/ledger.ts"
import {
  simulateLedger,sceneLocalDay,dueToday,validTimezone,balanceFromEvents,POINT_REWARDS
} from "../lib/operations.ts"

test("fictional forecast never mutates source balance and matches existing credit order",()=>{
  const input={principal:10000,interest:1000,penalties:400,monthlyRate:5,
    weeklyTarget:800,lateFee:100,weeks:8,manualInterestEveryFourWeeks:false,
    hypotheticalLateWeeks:[],extraWeeklyCredit:0}
  const snapshot=structuredClone(input)
  const projection=simulateLedger(input)
  assert.deepEqual(input,snapshot)
  assert.equal(projection.length,8)
  const first=applyCredit(input,800)
  assert.equal(projection[0].principal,first.principal)
  assert.equal(projection[0].interest,first.interest)
  assert.equal(projection[0].penalties,first.penalties)
  assert.ok(projection.every(row=>row.simulatedInterest===0&&row.simulatedLateFee===0))
  assert.ok(projection.every((row,i)=>i===0||row.total<=projection[i-1].total))
})

test("manual interest and late events affect previews only when selected",()=>{
  const input={principal:10000,interest:0,penalties:0,monthlyRate:5,weeklyTarget:0,
    lateFee:200,weeks:8,manualInterestEveryFourWeeks:true,
    hypotheticalLateWeeks:[2,6],extraWeeklyCredit:0}
  const rows=simulateLedger(input)
  assert.equal(rows[1].simulatedLateFee,200)
  assert.equal(rows[5].simulatedLateFee,200)
  assert.equal(rows[3].simulatedInterest,500)
  assert.equal(rows[7].simulatedInterest,500)
  assert.equal(rows[7].total,11400)
  assert.equal(rows[0].simulatedInterest,0)
})

test("scenario input rejects invalid intervals, negative values and malicious late weeks",()=>{
  const scenario={principal:10,interest:0,penalties:0,monthlyRate:0,weeklyTarget:10,
    lateFee:0,weeks:4,manualInterestEveryFourWeeks:false,hypotheticalLateWeeks:[],extraWeeklyCredit:0}
  assert.throws(()=>simulateLedger({...scenario,weeks:53}))
  assert.throws(()=>simulateLedger({...scenario,principal:-1}))
  assert.throws(()=>simulateLedger({...scenario,hypotheticalLateWeeks:[-1]}))
  assert.throws(()=>simulateLedger({...scenario,extraWeeklyCredit:100001}))
  assert.equal(simulateLedger(scenario)[3].total,0)
})

test("recurring dates use an explicitly supplied IANA timezone",()=>{
  assert.equal(validTimezone("UTC"),true)
  assert.equal(validTimezone("Asia/Colombo"),true)
  assert.equal(validTimezone("Not/A_Timezone"),false)
  const moment=new Date("2026-11-15T20:00:00.000Z")
  const inColombo=sceneLocalDay(moment,"Asia/Colombo")
  assert.equal(inColombo.date,"2026-11-16")
  assert.equal(inColombo.weekday,1)
  assert.equal(inColombo.hour,1)
  const inUTC=dueToday([0],"UTC",moment)
  assert.equal(inUTC.scheduled,true)
  assert.equal(dueToday([0],"Asia/Colombo",moment).scheduled,false)
})

test("reward points remain separate from all fictional monetary values",()=>{
  const points=[{points:POINT_REWARDS.verifiedTask},{points:POINT_REWARDS.finishedStory},{points:-25}]
  assert.equal(balanceFromEvents(points),40)
  assert.equal(POINT_REWARDS.approvedRitual,20)
})
