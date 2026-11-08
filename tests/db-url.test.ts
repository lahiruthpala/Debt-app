import assert from "node:assert/strict"
import {test} from "node:test"
import {normalizedDatabaseUrl} from "../lib/db.ts"

test("legacy pg TLS modes become explicit verify-full without losing credentials",()=>{
  for(const mode of ["prefer","require","verify-ca"]){
    const url="postgresql://user:password@db.example.org:5432/ledger?sslmode="+mode+"&application_name=debt"
    const result=new URL(normalizedDatabaseUrl(url))
    assert.equal(result.searchParams.get("sslmode"),"verify-full")
    assert.equal(result.searchParams.get("application_name"),"debt")
    assert.equal(result.password,"password")
    assert.equal(result.hostname,"db.example.org")
  }
})
test("explicit TLS selection and local connection string remain unchanged",()=>{
  for(const url of [
    "postgresql://user:password@db.example.org/ledger?sslmode=verify-full",
    "postgresql://localhost:5432/debt",
    "postgresql://localhost:5432/debt?sslmode=disable"
  ])assert.equal(normalizedDatabaseUrl(url),url)
})
