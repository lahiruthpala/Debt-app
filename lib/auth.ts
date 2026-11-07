import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { getPool } from "./db"
import { getTrustedAuthOrigins, PRODUCTION_ORIGIN } from "./auth-origins"

function createInstance() {
  return betterAuth({
    database: getPool(),
    secret: process.env.BETTER_AUTH_SECRET!,
    // Pin the canonical origin. Vercel's automatic hostname can differ from
    // the production alias used by real browsers, causing INVALID_ORIGIN.
    baseURL: process.env.BETTER_AUTH_URL || PRODUCTION_ORIGIN,
    trustedOrigins: getTrustedAuthOrigins(process.env.BETTER_AUTH_URL, process.env.VERCEL_URL),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
    },
    session: { cookieCache: { enabled: true, maxAge: 60 * 5 } },
    plugins: [nextCookies()],
  })
}

let instance: ReturnType<typeof createInstance> | undefined

/** Deferred until request time so public pages can build without secrets. */
export function getAuth(): ReturnType<typeof createInstance> {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) {
    throw new Error("Authentication requires DATABASE_URL and BETTER_AUTH_SECRET")
  }
  if (!instance) instance = createInstance()
  return instance
}
