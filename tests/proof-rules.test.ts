import assert from "node:assert/strict"
import {test} from "node:test"
import {isAllowedImageType,canReviewProof,proofReviewOutcome,maxProofBytes} from "../lib/proof-rules.ts"

test("private proof uploads permit only re-encoded image formats",()=>{
  for(const mime of ["image/jpeg","image/png","image/webp"])assert.ok(isAllowedImageType(mime))
  for(const mime of ["image/svg+xml","image/gif","text/html","application/pdf"])assert.equal(isAllowedImageType(mime),false)
  assert.equal(maxProofBytes,3000000)
})
test("only an active connected Dom can review pending non-deleted submissions",()=>{
  assert.equal(canReviewProof("dom","active","pending",false),true)
  assert.equal(canReviewProof("sub","active","pending",false),false)
  assert.equal(canReviewProof("dom","blocked","pending",false),false)
  assert.equal(canReviewProof("dom","active","approved",false),false)
  assert.equal(canReviewProof("dom","active","pending",true),false)
})
test("approved task and payment proofs have distinct ledger outcomes; lock has none",()=>{
  assert.equal(proofReviewOutcome("payment",true),"apply_payment")
  assert.equal(proofReviewOutcome("task",true),"approve_task")
  assert.equal(proofReviewOutcome("lock",true),"none")
  assert.equal(proofReviewOutcome("payment",false),"none")
})
