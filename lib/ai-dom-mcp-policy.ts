/**
 * Lightweight, deterministic first gate for AI-generated text. A trusted model
 * runner still needs moderation; string matching is not a complete safety system.
 */
export function normalizeAiText(value:string){
  return value.replace(/[\u0000-\u001f\u007f]/g," ").trim()
}
export function allowedAiText(value:string){
  const text=normalizeAiText(value)
  return !/https?:\/\/|www\.|(?:bank|wire|crypto)\s+(?:transfer|payment)|(?:send|pay)\s+(?:real|actual)\s+(?:money|cash)|(?:nude|intimate)\s+(?:photo|image|picture)/i.test(text)
}
