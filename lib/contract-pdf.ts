import {PDFDocument,StandardFonts,rgb,type PDFFont,type PDFPage} from "pdf-lib"
import {contractModuleSchema,type ContractModule} from "./contract-rules.ts"
import {z} from "zod"

const modulesSchema=z.array(contractModuleSchema).min(1).max(8)
export type AgreementPdfInput={
  id:string;title:string;description:string;category:string;
  domHandle:string;subHandle:string;proposedAt:string;acceptedAt:string;
  terms:{principal:number;monthlyRate:number;weeklyTarget:number;lateFee:number};
  modules:ContractModule[]
}
export type AgreementPdfSection={heading:string;paragraphs:string[]}
const money=(n:number)=>"LKR "+n.toLocaleString("en-US")+" (fictional)"
const value=(n:number)=>n>0?"+ "+money(n):n<0?"Credit "+money(-n):"No ledger change"
const week=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]

/** Every accepted module and outcome is transcribed from the immutable proposal snapshot. */
export function agreementSections(input:AgreementPdfInput):AgreementPdfSection[]{
  const parsed=modulesSchema.parse(input.modules)
  const sections:AgreementPdfSection[]=[
    {heading:"The parties and their acceptance",paragraphs:[
      "Dom: @"+input.domHandle+" | Sub: @"+input.subHandle,
      "Proposed: "+new Date(input.proposedAt).toISOString(),
      "Accepted by the Sub: "+new Date(input.acceptedAt).toISOString(),
      "Proposal record: "+input.id,
      "The Dom proposed the terms shown below; the Sub expressly accepted them. The accepted configuration is preserved for this document."
    ]},
    {heading:"Agreed fictional ledger terms",paragraphs:[
      "Starting balance: "+money(input.terms.principal),
      "Monthly interest rate: "+input.terms.monthlyRate+"% (applied only by an explicit permitted action)",
      "Weekly target: "+money(input.terms.weeklyTarget),
      "Agreed late fee: "+money(input.terms.lateFee)+" (never automatically charged)",
      "Credits reduce penalties first, then interest, then principal. Payment evidence is reviewed by the Dom; approval applies simulated credits once. No real payment is processed."
    ]},
    {heading:"Agreement summary and scope",paragraphs:[
      "Title: "+input.title,
      "Category: "+input.category,
      input.description,
      "The modules below are a snapshot of the agreed games, rules, tasks and conditions. The PDF is a record of terms, not a live balance statement."
    ]}
  ]
  parsed.forEach((module,index)=>{
    const body:string[]=[]
    switch(module.type){
      case "dice":
        body.push("Game: player rolls d"+module.sides+" against a server roll. Each point of difference changes the fictional ledger by "+money(module.stake)+".")
        body.push("Rule: (server roll - player roll) x stake; positive is a fictional charge and negative is a credit. Cooldown: "+module.cooldownHours+" hours.")
        break
      case "wheel":
        body.push("Game: uniformly selected wheel segment. Cooldown: "+module.cooldownHours+" hours.")
        module.outcomes.forEach((o,n)=>body.push("Segment "+(n+1)+": "+o.label+" - "+value(o.delta)))
        break
      case "random":
        body.push("Game: server-selected weighted outcomes. Cooldown: "+module.cooldownHours+" hours; higher weights are more likely.")
        module.outcomes.forEach((o,n)=>body.push("Outcome "+(n+1)+": "+o.label+" - "+value(o.delta)+"; weight "+o.weight))
        break
      case "checkin":
        body.push("Check-in interval: "+module.cooldownHours+" hours. Reward: "+money(module.reward)+".")
        body.push("Late check-in penalty: "+money(module.latePenalty||0)+", only when the Sub manually checks in after more than two intervals; no unattended charge.")
        break
      case "tasks":
        body.push("The Sub submits each agreed task; the Dom must review and approve before credits are awarded.")
        module.tasks.forEach((task,n)=>body.push("Task "+(n+1)+": "+task.label+" | reward "+money(task.reward)))
        break
      case "lock":
        body.push("Suggested duration: "+module.suggestedDays+" days. Private check-in interval: "+module.checkinHours+" hours. Keyholder label: "+module.keyholderLabel+".")
        body.push("Lock status is self-reported. The Sub uploads a non-explicit photo, requests a lock, and only Dom approval marks it locked. The Sub may request an unlock review; the Dom may accept or decline that reported change.")
        body.push("Neither the application nor this agreement controls hardware, requires physical confinement, or prevents the Sub from physically unlocking, withdrawing consent or ending the scene.")
        break
      case "permission":
        body.push("Initial permission label: "+module.initialStatus+". Optional reminder interval: "+module.reminderHours+" hours.")
        body.push("Permission requests require review. These labels are voluntary, informational, and do not affect real-world consent or the right to leave.")
        break
      case "journal":
        body.push("Private reflection prompt: "+module.prompt)
        body.push("Entries are private to the two participants. No automatic financial, physical or consent consequence is attached.")
        break
      case "calendar":
        body.push("Scheduled days: "+module.days.map((d:number)=>week[d]).join(", ")+". Local time window: "+
          String(module.startHour).padStart(2,"0")+":00 to "+String(module.endHour).padStart(2,"0")+":00.")
        body.push("The window is informational; it does not restrict participants from leaving, pausing or ending the agreement.")
        break
    }
    sections.push({heading:(index+1)+". "+module.name+" ["+module.type.toUpperCase()+"]",paragraphs:body})
  })
  sections.push({heading:"Conditions, consent and safety",paragraphs:[
    "All balances, rewards, interest, charges and penalties are fictional role-play values. This is not a loan, invoice, financial product, legally enforceable debt, or authorization for real-world payments.",
    "Both adults participate voluntarily. Consent can be withdrawn at any time. Either partner may pause or end the scene at any time. No fictional charges or other penalties apply to withdrawing consent or physically unlocking.",
    "Only approved connected participants may perform contract actions. Server-generated game outcomes are logged and subject to configured cooldowns and a 40-action-per-day safety limit.",
    "Submitted private evidence is optional except where the agreed module requires a non-explicit lock image or a proof-backed payment; only the connected reviewer can approve it. Users retain deletion options for their private media.",
    "This agreement contains no real-world signature or identity verification. The timestamp records in-app acceptance only. Material changes require a new mutual agreement."
  ]})
  return sections
}
function ascii(s:string):string{
  return String(s).normalize("NFKD").replace(/[\u0300-\u036f]/g,"")
    .replace(/[\r\n\t]+/g," ").replace(/[^\x20-\x7e]/g,"?").trim()
}
function wrap(value:string,font:PDFFont,size:number,width:number):string[]{
  const input=ascii(value)
  if(!input)return [""]
  const result:string[]=[],words=input.split(/\s+/);let current=""
  for(const word of words){
    const proposal=current?current+" "+word:word
    if(font.widthOfTextAtSize(proposal,size)<=width){current=proposal;continue}
    if(current)result.push(current)
    if(font.widthOfTextAtSize(word,size)<=width){current=word;continue}
    let fragment=""
    for(const letter of word){
      if(font.widthOfTextAtSize(fragment+letter,size)>width&&fragment){result.push(fragment);fragment=""}
      fragment+=letter
    }
    current=fragment
  }
  if(current)result.push(current)
  return result
}
export async function renderAgreementPdf(input:AgreementPdfInput):Promise<Uint8Array>{
  const sections=agreementSections(input)
  const pdf=await PDFDocument.create()
  pdf.setTitle("Accepted fantasy contract - "+ascii(input.title))
  pdf.setSubject("Consensual fictional contract agreement - no legal debt")
  pdf.setCreator("Velvet Ledger")
  const regular=await pdf.embedFont(StandardFonts.Helvetica)
  const bold=await pdf.embedFont(StandardFonts.HelveticaBold)
  const W=595,H=842,pad=52,contentWidth=W-pad*2
  const ink=rgb(.19,.15,.22),muted=rgb(.44,.4,.45),rose=rgb(.63,.22,.38),white=rgb(1,1,1)
  let page!:PDFPage
  let y=0
  function nextPage(){
    page=pdf.addPage([W,H]);y=H-72
    page.drawRectangle({x:0,y:H-54,width:W,height:54,color:ink})
    page.drawText("VELVET LEDGER  /  MUTUAL AGREEMENT",{x:pad,y:H-34,size:12,font:bold,color:white})
  }
  function ensure(height:number){if(y-height<68)nextPage()}
  function lines(text:string,font:PDFFont,size:number,lineHeight:number,color=ink,indent=0){
    const result=wrap(text,font,size,contentWidth-indent)
    for(const line of result){ensure(lineHeight);page.drawText(line,{x:pad+indent,y,font,size,color});y-=lineHeight}
  }
  nextPage()
  lines("ACCEPTED CONTRACT RECORD",bold,18,24,rose)
  lines(input.title,bold,22,28)
  y-=8
  lines("Agreed by two participants on "+new Date(input.acceptedAt).toISOString(),regular,10,15,muted)
  y-=20
  page.drawRectangle({x:pad,y:y-60,width:contentWidth,height:66,color:rgb(.96,.94,.95)})
  page.drawText("AGREED TERMS  -  FICTIONAL, VOLUNTARY, NON-ENFORCEABLE",{
    x:pad+14,y:y-18,size:10,font:bold,color:rose
  })
  const banner=wrap("No real debt, obligation or payment is created. Consent can be withdrawn at any time.",regular,9,contentWidth-28)
  banner.forEach((line,index)=>page.drawText(line,{x:pad+14,y:y-35-index*12,font:regular,size:9,color:ink}))
  y-=87
  for(const section of sections){
    ensure(48)
    page.drawRectangle({x:pad,y:y-5,width:5,height:16,color:rose})
    lines("  "+section.heading.toUpperCase(),bold,12,17,ink)
    y-=8
    for(const paragraph of section.paragraphs){lines(paragraph,regular,10,15,ink,6);y-=8}
    y-=10
  }
  const all=pdf.getPages()
  all.forEach((p,i)=>{
    p.drawLine({start:{x:pad,y:48},end:{x:W-pad,y:48},thickness:.7,color:muted,opacity:.35})
    p.drawText("PRIVATE COPY  |  Fictional role-play agreement",{
      x:pad,y:32,size:8,font:regular,color:muted
    })
    p.drawText((i+1)+" / "+all.length,{x:W-pad-37,y:32,size:8,font:regular,color:muted})
  })
  return pdf.save()
}
