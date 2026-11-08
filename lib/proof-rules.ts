export type ProofKind="lock"|"task"|"payment"
export type ProofStatus="pending"|"approved"|"rejected"
export const maxProofBytes=3_000_000
export const allowedImageTypes=["image/jpeg","image/png","image/webp"] as const

/** Declared MIME and actual decoder format must agree; all stored images are re-encoded. */
export function isAllowedImageType(value:string):boolean {
  return (allowedImageTypes as readonly string[]).includes(value)
}
export function canReviewProof(role:string,state:string,status:ProofStatus,deleted:boolean):boolean {
  return role==="dom" && state==="active" && status==="pending" && !deleted
}
export function proofReviewOutcome(kind:ProofKind,approved:boolean):"none"|"apply_payment"|"approve_task" {
  if(!approved)return "none"
  return kind==="payment"?"apply_payment":kind==="task"?"approve_task":"none"
}
