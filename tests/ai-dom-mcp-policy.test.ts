import assert from "node:assert/strict"
import {test} from "node:test"
import {allowedAiText,normalizeAiText} from "../lib/ai-dom-mcp-policy.ts"

test("AI generated text blocks obvious off-platform and real payment requests",()=>{
  assert.equal(allowedAiText("Complete an imaginary challenge"),true)
  assert.equal(allowedAiText("Transfer money by bank transfer"),false)
  assert.equal(allowedAiText("Send real money now"),false)
  assert.equal(allowedAiText("Send an intimate photo"),false)
  assert.equal(allowedAiText("See https://example.com"),false)
})
test("AI text normalizer removes control characters without mutating safe prose",()=>{
  assert.equal(normalizeAiText("  First\nsecond\u0000 "), "First second")
  assert.equal(normalizeAiText("Creative story"),"Creative story")
})
