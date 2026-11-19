import assert from "node:assert/strict"
import {test} from "node:test"
import {validMcpBearer} from "../lib/ai-dom-mcp-auth.ts"

const secret="a".repeat(64)

test("MCP requires configured secret of at least 32 characters",()=>{
  assert.equal(validMcpBearer("Bearer "+secret,undefined),false)
  assert.equal(validMcpBearer("Bearer short","short"),false)
  assert.equal(validMcpBearer("Bearer "+secret,secret),true)
})
test("MCP rejects missing, malformed, and wrong bearer credentials",()=>{
  assert.equal(validMcpBearer(null,secret),false)
  assert.equal(validMcpBearer("Basic "+secret,secret),false)
  assert.equal(validMcpBearer("Bearer "+("b".repeat(64)),secret),false)
  assert.equal(validMcpBearer("Bearer "+secret+"x",secret),false)
  assert.equal(validMcpBearer("Bearer ",secret),false)
})
