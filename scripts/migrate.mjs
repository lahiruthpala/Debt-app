import { readFileSync } from "node:fs"
import { Pool } from "pg"

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL not set; skipping schema migration. Multiplayer requires database setup.")
  process.exit(0)
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 10000 })
try {
  const sql = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8")
  await pool.query(sql)
  console.log("Database schema is ready.")
} catch (err) {
  console.error("Database migration failed:", err instanceof Error ? err.message : err)
  process.exitCode = 1
} finally {
  await pool.end()
}
