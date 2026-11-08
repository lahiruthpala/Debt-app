export type ProofKind="lock"|"task"|"challenge"|"payment"
export type ProofStatus="pending"|"approved"|"rejected"
export const maxProofBytes=3_000_000
// Stay below the Vercel request-body limit, including multipart overhead.
export const maxPaymentPdfBytes=4_000_000
export const paymentPdfType="application/pdf"
export const allowedImageTypes=["image/jpeg","image/png","image/webp"] as const

/** Declared MIME and actual decoder format must agree; all stored images are re-encoded. */
export function isAllowedImageType(value:string):boolean {
  return (allowedImageTypes as readonly string[]).includes(value)
}
/** PDFs are accepted for payment evidence only, not lock/task/challenge proofs. */
export function isAllowedProofType(kind:ProofKind,mime:string):boolean {
  return isAllowedImageType(mime)||(kind==="payment"&&mime===paymentPdfType)
}
/** Lightweight document signature check. PDFs are download-only, not interpreted in-page. */
export function isValidPaymentPdf(bytes:Uint8Array):boolean {
  if(bytes.length<40||bytes.length>maxPaymentPdfBytes)return false
  const decoder=new TextDecoder("latin1")
  const header=decoder.decode(bytes.subarray(0,9))
  if(!/^%PDF-[12]\.\d[\r\n]/.test(header))return false
  const tail=decoder.decode(bytes.subarray(Math.max(0,bytes.length-2048)))
  const eof=tail.lastIndexOf("%%EOF")
  const startXref=tail.lastIndexOf("startxref")
  return startXref>=0&&eof>startXref&&tail.slice(eof+5).trim().length===0
}
export function canReviewProof(role:string,state:string,status:ProofStatus,deleted:boolean):boolean {
  return role==="dom" && state==="active" && status==="pending" && !deleted
}
export function proofReviewOutcome(kind:ProofKind,approved:boolean):"none"|"apply_payment"|"approve_task"|"approve_challenge" {
  if(!approved)return "none"
  return kind==="payment"?"apply_payment":kind==="task"?"approve_task":kind==="challenge"?"approve_challenge":"none"
}
