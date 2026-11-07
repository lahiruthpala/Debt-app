import { getPool } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) {
    return Response.json({ status: "unconfigured", message: "Account creation is unavailable until server storage and authentication are configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } })
  }
  try {
    const { rows } = await getPool().query<{ auth_table: string | null; profile_table: string | null }>(
      `SELECT to_regclass('"user"')::text AS auth_table, to_regclass('profiles')::text AS profile_table`
    )
    if (!rows[0]?.auth_table || !rows[0]?.profile_table) {
      return Response.json({ status: "unconfigured", message: "The database schema has not been initialized." },
        { status: 503, headers: { "Cache-Control": "no-store" } })
    }
    return Response.json({ status: "ready" }, { headers: { "Cache-Control": "no-store" } })
  } catch {
    return Response.json({ status: "unavailable", message: "The database is not reachable." },
      { status: 503, headers: { "Cache-Control": "no-store" } })
  }
}
