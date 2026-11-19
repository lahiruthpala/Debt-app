import {timingSafeEqual} from "node:crypto"

/** Constant-time comparison for the server-owned MCP credential. Never log tokens. */
export function validMcpBearer(header:string|null,secret:string|undefined){
  if(!secret||secret.length<32||!header?.startsWith("Bearer "))return false
  const supplied=header.slice(7)
  if(supplied.length!==secret.length)return false
  return timingSafeEqual(Buffer.from(supplied,"utf8"),Buffer.from(secret,"utf8"))
}
