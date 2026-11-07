import { betterAuth } from "better-auth"
import { nextCookies } from "better-auth/next-js"
import { getPool } from "./db"

let instance: ReturnType<typeof betterAuth> | undefined

/** Deferred until request time so public pages can build without secrets. */
export function getAuth() {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) {
    throw new Error("Authentication requires DATABASE_URL and BETTER_AUTH_SECRET")
  }
  if (!instance) {
    instance = betterAuth({
      database: getPool(),
      secret: process.env.BETTER_AUTH_SECRET,
      emailAndPassword: {
        enabled: true,
        minPasswordLength: 10,
        maxPasswordLength: 128,
      },
      session: { cookieCache: { enabled: true, maxAge: 60 * 5 } },
      plugins: [nextCookies()],
    })
  }
  return instance
}
