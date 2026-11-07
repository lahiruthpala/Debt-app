import { Pool } from "pg"

declare global {
  // Reuse a small pool across dev reloads / warm serverless instances.
  // eslint-disable-next-line no-var
  var __debtPool: Pool | undefined
}

export function getPool(): Pool {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error("DATABASE_URL is not configured")
  if (!globalThis.__debtPool) {
    globalThis.__debtPool = new Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10000,
    })
  }
  return globalThis.__debtPool
}
