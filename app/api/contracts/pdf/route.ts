import {getAuth} from "@/lib/auth"
import {getPool} from "@/lib/db"
import {contractModuleSchema} from "@/lib/contract-rules"
import {renderAgreementPdf} from "@/lib/contract-pdf"
import {z} from "zod"

export const runtime="nodejs"
export const dynamic="force-dynamic"
const uuid=z.string().uuid()
const noStore={"Cache-Control":"private, no-store, max-age=0"}
export async function GET(req:Request){
  try{
    if(!process.env.DATABASE_URL||!process.env.BETTER_AUTH_SECRET)
      return Response.json({error:"Service unavailable"},{status:503,headers:noStore})
    const session=await getAuth().api.getSession({headers:req.headers})
    if(!session)return Response.json({error:"Sign in required"},{status:401,headers:noStore})
    const id=uuid.safeParse(new URL(req.url).searchParams.get("sceneId"))
    if(!id.success)return Response.json({error:"Invalid contract ID"},{status:400,headers:noStore})
    const {rows:profiles}=await getPool().query<{adult_confirmed:boolean}>(
      "SELECT adult_confirmed FROM profiles WHERE id=$1",[session.user.id])
    if(!profiles[0]?.adult_confirmed)return Response.json({error:"Adult profile required"},{status:403,headers:noStore})
    const {rows}=await getPool().query(
      "SELECT s.id,s.status,s.created_at,s.approved_at,s.start_principal,s.monthly_rate,s.weekly_target,s.late_fee,"+
      "sc.title_snapshot,sc.description_snapshot,sc.category_snapshot,sc.modules_snapshot,"+
      "dom.handle AS dom_handle,sub.handle AS sub_handle "+
      "FROM scenes s LEFT JOIN scene_contracts sc ON sc.scene_id=s.id "+
      "JOIN connections c ON c.id=s.connection_id "+
      "JOIN profiles dom ON dom.id=CASE WHEN c.sender_id IN (SELECT id FROM profiles WHERE role='dom') THEN c.sender_id ELSE c.recipient_id END "+
      "JOIN profiles sub ON sub.id=CASE WHEN c.sender_id IN (SELECT id FROM profiles WHERE role='sub') THEN c.sender_id ELSE c.recipient_id END "+
      "WHERE s.id=$1 AND (c.sender_id=$2 OR c.recipient_id=$2) AND c.state<>'blocked' AND s.approved_at IS NOT NULL",
      [id.data,session.user.id])
    if(!rows.length)return Response.json({error:"Accepted contract unavailable"},{status:404,headers:noStore})
    const s=rows[0]
    const modules=z.array(contractModuleSchema).max(8).safeParse(s.modules_snapshot??[])
    if(!modules.success)return Response.json({error:"Invalid accepted contract data"},{status:500,headers:noStore})
    const pdf=await renderAgreementPdf({
      id:s.id,
      title:s.title_snapshot??"Fictional Ledger Agreement",
      description:s.description_snapshot??"A basic fictional ledger proposed by the Dom and expressly accepted by the Sub. No custom interactive game modules were included.",
      category:s.category_snapshot??"Basic Agreement",
      domHandle:s.dom_handle,subHandle:s.sub_handle,proposedAt:new Date(s.created_at).toISOString(),
      acceptedAt:new Date(s.approved_at).toISOString(),
      terms:{principal:s.start_principal,monthlyRate:s.monthly_rate,
        weeklyTarget:s.weekly_target,lateFee:s.late_fee},
      modules:modules.data
    })
    return new Response(new Uint8Array(pdf),{headers:{
      "Content-Type":"application/pdf",
      "Content-Disposition":'attachment; filename="accepted-contract-'+id.data.slice(0,8)+'.pdf"',
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
      ...noStore
    }})
  }catch(error){
    console.error("Accepted contract PDF:",error instanceof Error?error.message:"Unknown error")
    return Response.json({error:"Unable to generate contract PDF"},{status:500,headers:noStore})
  }
}
