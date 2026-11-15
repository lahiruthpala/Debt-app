import { applyCredit, type Balance } from "./ledger.ts"

/** Simulations are previews, never side effects or automatic payment schedules. */
export type ScenarioInput = Balance & {
  monthlyRate: number
  weeklyTarget: number
  lateFee: number
  weeks: number
  manualInterestEveryFourWeeks: boolean
  hypotheticalLateWeeks: number[]
  extraWeeklyCredit: number
}
export type ScenarioWeek = {
  week: number
  principal: number
  interest: number
  penalties: number
  total: number
  simulatedInterest: number
  simulatedLateFee: number
  credited: number
}
export function simulateLedger(input: ScenarioInput): ScenarioWeek[] {
  if (![input.principal,input.interest,input.penalties,input.monthlyRate,input.weeklyTarget,input.lateFee,
    input.weeks,input.extraWeeklyCredit].every(Number.isInteger)) throw new Error("Whole fictional units required")
  if (input.weeks < 1 || input.weeks > 52 || input.monthlyRate < 0 || input.monthlyRate > 30 ||
      input.weeklyTarget < 0 || input.weeklyTarget > 100000 || input.lateFee < 0 || input.lateFee > 10000 ||
      input.extraWeeklyCredit < 0 || input.extraWeeklyCredit > 100000 ||
      input.principal < 0 || input.interest < 0 || input.penalties < 0) throw new Error("Invalid scenario limits")
  if (input.hypotheticalLateWeeks.length > 52 ||
      input.hypotheticalLateWeeks.some(week => !Number.isInteger(week) || week < 1 || week > input.weeks))
    throw new Error("Invalid hypothetical late weeks")
  let {principal,interest,penalties} = input
  const result:ScenarioWeek[]=[]
  for (let week=1;week<=input.weeks;week++) {
    // The real product applies interest and fees ONLY through explicit actions.
    const simulatedInterest = input.manualInterestEveryFourWeeks && week%4===0
      ? Math.floor(principal*input.monthlyRate/100) : 0
    const simulatedLateFee = input.hypotheticalLateWeeks.includes(week) ? input.lateFee : 0
    interest+=simulatedInterest
    penalties+=simulatedLateFee
    const next=applyCredit({principal,interest,penalties},input.weeklyTarget+input.extraWeeklyCredit)
    principal=next.principal;interest=next.interest;penalties=next.penalties
    result.push({week,principal,interest,penalties,total:principal+interest+penalties,
      simulatedInterest,simulatedLateFee,credited:next.credited})
  }
  return result
}

/** Calendar dates are evaluated in the participants' agreed IANA timezone. */
export function sceneLocalDay(now:Date, timezone:string) {
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit",weekday:"short",hour:"2-digit",
    hourCycle:"h23"
  }).formatToParts(now)
  const get=(part:string)=>parts.find(p=>p.type===part)?.value||""
  const days:Record<string,number>={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}
  if (!(get("weekday") in days))throw new Error("Unsupported calendar weekday")
  return {date:`${get("year")}-${get("month")}-${get("day")}`,
    weekday:days[get("weekday")],hour:Number(get("hour"))}
}
export function validTimezone(timezone:string) {
  try { sceneLocalDay(new Date("2026-01-15T12:00:00Z"), timezone); return true }
  catch { return false }
}
export function dueToday(days:number[],timezone:string,at=new Date()) {
  const local=sceneLocalDay(at,timezone)
  return { ...local, scheduled:days.includes(local.weekday) }
}
/** Points stay separate from fictional ledger credits and cannot become currency. */
export const POINT_REWARDS = Object.freeze({
  verifiedTask: 40,
  verifiedChallenge: 30,
  approvedProof: 10,
  finishedStory: 25,
  approvedRitual: 20,
})
export function balanceFromEvents(events:readonly {points:number}[]):number {
  return events.reduce((sum,event)=>sum+event.points,0)
}
