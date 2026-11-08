import assert from "node:assert/strict"
import {test} from "node:test"
import {isAllowedImageType,isAllowedProofType,isValidPaymentPdf,maxPaymentPdfBytes,paymentPdfType,canReviewProof,proofReviewOutcome,maxProofBytes} from "../lib/proof-rules.ts"

test("private proof uploads permit only re-encoded image formats",()=>{
  for(const mime of ["image/jpeg","image/png","image/webp"])assert.ok(isAllowedImageType(mime))
  for(const mime of ["image/svg+xml","image/gif","text/html","application/pdf"])assert.equal(isAllowedImageType(mime),false)
  assert.equal(maxProofBytes,3000000)
})
test("payment PDFs require correct MIME and structural markers",()=>{
  assert.equal(paymentPdfType,"application/pdf")
  for(const kind of ["lock","task","challenge"] as const)
    assert.equal(isAllowedProofType(kind,paymentPdfType),false)
  assert.equal(isAllowedProofType("payment",paymentPdfType),true)
  assert.equal(isAllowedProofType("payment","image/png"),true)
  assert.equal(isAllowedProofType("payment","text/html"),false)
  assert.equal(maxPaymentPdfBytes,4_000_000)
  const valid=Buffer.from(["%PDF-1.4","1 0 obj","<< /Type /Catalog >>","endobj","startxref","9","%%EOF",""].join("\n"))
  assert.equal(isValidPaymentPdf(valid),true)
  assert.equal(isValidPaymentPdf(Buffer.from("<html><script>alert(1)</script></html>")),false)
  assert.equal(isValidPaymentPdf(Buffer.from(["%PDF-1.4","1 0 obj","endobj","%%EOF"].join("\n"))),false)
  assert.equal(isValidPaymentPdf(Buffer.from(["%PDF-1.4","1 0 obj","endobj","startxref","9","%%EOF","INJECTED"].join("\n"))),false)
  assert.equal(isValidPaymentPdf(new Uint8Array(maxPaymentPdfBytes+1)),false)
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
  assert.equal(proofReviewOutcome("challenge",true),"approve_challenge")
  assert.equal(proofReviewOutcome("lock",true),"none")
  assert.equal(proofReviewOutcome("payment",false),"none")
})
