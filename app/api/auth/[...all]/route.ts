import { getAuth } from "@/lib/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

async function handle(req: Request) {
  try {
    return await getAuth().handler(req)
  } catch (error) {
    console.error("Auth endpoint:", error instanceof Error ? error.message : "unknown")
    return Response.json(
      { error: "Authentication service is not configured or temporarily unavailable." },
      { status: 503 }
    )
  }
}

export const GET = handle
export const POST = handle
