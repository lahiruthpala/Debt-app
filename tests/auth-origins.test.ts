import assert from "node:assert/strict"
import { test } from "node:test"
import { getTrustedAuthOrigins, PRODUCTION_ORIGIN } from "../lib/auth-origins.ts"

test("production domain remains trusted when Vercel's deployment hostname differs", () => {
  const origins = getTrustedAuthOrigins(
    "https://debt-app-ivory.vercel.app/",
    "debt-4ebinuh4r-lahiru-jayathilakes-projects.vercel.app",
  )
  assert.deepEqual(origins, [
    PRODUCTION_ORIGIN,
    "https://debt-4ebinuh4r-lahiru-jayathilakes-projects.vercel.app",
  ])
  assert.equal(origins.includes("https://attacker.vercel.app"), false)
})

test("CI/local app origin is trusted without trusting every Vercel hostname", () => {
  const origins = getTrustedAuthOrigins("http://127.0.0.1:3000")
  assert.deepEqual(origins, [PRODUCTION_ORIGIN, "http://127.0.0.1:3000"])
})

test("canonical production origin is trusted even if BETTER_AUTH_URL is omitted", () => {
  assert.deepEqual(getTrustedAuthOrigins(), [PRODUCTION_ORIGIN])
})
