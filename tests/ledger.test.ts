import { test } from "node:test"
import assert from "node:assert/strict"
import { applyCredit, QUESTS } from "../lib/ledger.ts"

test("credits pay penalties before interest and principal", () => {
  assert.deepEqual(applyCredit({ principal: 250000, interest: 25000, penalties: 5000 }, 15000), {
    principal: 250000, interest: 15000, penalties: 0, credited: 15000
  })
})
test("credits reduce principal after charges clear", () => {
  assert.deepEqual(applyCredit({ principal: 10000, interest: 2000, penalties: 1000 }, 5000), {
    principal: 8000, interest: 0, penalties: 0, credited: 5000
  })
})
test("overpay cannot create negative debt", () => {
  assert.deepEqual(applyCredit({ principal: 100, interest: 0, penalties: 0 }, 99999), {
    principal: 0, interest: 0, penalties: 0, credited: 100
  })
})
test("invalid negative credits cannot affect the ledger", () => {
  assert.deepEqual(applyCredit({ principal: 100, interest: 20, penalties: 10 }, -500), {
    principal: 100, interest: 20, penalties: 10, credited: 0
  })
})
test("curated challenges stay within the reward cap", () => {
  assert.ok(QUESTS.length >= 3)
  for (const q of QUESTS) assert.ok(q.reward >= 0 && q.reward <= 5000)
})
