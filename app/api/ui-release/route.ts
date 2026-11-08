import {UI_RELEASE} from "@/lib/ui-release"
export const dynamic="force-dynamic"
export function GET() {
  return Response.json({release:UI_RELEASE},{headers:{"Cache-Control":"no-store, max-age=0, must-revalidate"}})
}
