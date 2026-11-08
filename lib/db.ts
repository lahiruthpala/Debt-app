import { Pool } from "pg"

declare global {
  // Reuse a small pool across dev reloads / warm serverless instances.
  // eslint-disable-next-line no-var
  var __debtPool: Pool | undefined
}

/** pg currently maps these legacy modes to verify-full; make that strict
 * certificate verification explicit before the pg-connection-string v3 change.
 * Do not downgrade TLS or turn off hostname verification.
 */
export function normalizedDatabaseUrl(url:string):string {
  try {
    const parsed=new URL(url)
    const mode=parsed.searchParams.get("sslmode")
    if(["prefer","require","verify-ca"].includes(mode||"")){
      parsed.searchParams.set("sslmode","verify-full")
      return parsed.toString()
    }
  }catch{
    // Keep any non-URL connection format unchanged and let pg validate it.
  }
  return url
}

export function getPool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not configured")
  if (!globalThis.__debtPool) {
    globalThis.__debtPool = new Pool({
      connectionString: normalizedDatabaseUrl(url),
      max: 3,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10000,
    })
  }
  return globalThis.__debtPool
}
