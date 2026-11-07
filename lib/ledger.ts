export type Balance = { principal: number; interest: number; penalties: number }

/** Fictional payment credits penalties before interest before principal. */
export function applyCredit(balance: Balance, requested: number): Balance & { credited: number } {
  let remaining = Math.min(Math.max(0, Math.trunc(requested)), balance.principal + balance.interest + balance.penalties)
  const credited = remaining
  const penalties = Math.max(0, balance.penalties - remaining)
  remaining -= balance.penalties - penalties
  const interest = Math.max(0, balance.interest - remaining)
  remaining -= balance.interest - interest
  const principal = Math.max(0, balance.principal - remaining)
  return { principal, interest, penalties, credited }
}

export const QUESTS = [
  { title: "Balance audit", description: "Review the fictional ledger and describe the current balance.", reward: 1200 },
  { title: "Three-step plan", description: "Draft a three-step imaginary repayment plan.", reward: 2400 },
  { title: "Creative pledge", description: "Write a short, consensual roleplay pledge.", reward: 1800 },
  { title: "Forecast challenge", description: "Estimate how many weekly credits clear the fictional balance.", reward: 3200 },
  { title: "Reflection round", description: "Share one boundary and one positive goal for the scene.", reward: 4000 },
] as const
