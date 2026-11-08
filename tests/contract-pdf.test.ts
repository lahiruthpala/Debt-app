import assert from "node:assert/strict"
import {test} from "node:test"
import {randomUUID} from "node:crypto"
import {PDFDocument} from "pdf-lib"
import {agreementSections,renderAgreementPdf,type AgreementPdfInput} from "../lib/contract-pdf.ts"

const id=()=>randomUUID()
const input:AgreementPdfInput={
  id:id(),title:"Mutual Game Agreement",description:"Private consensual agreement with all configured rules.",
  category:"Creative game",domHandle:"dom_demo",subHandle:"sub_demo",
  proposedAt:"2026-11-08T10:00:00.000Z",acceptedAt:"2026-11-08T11:00:00.000Z",
  terms:{principal:85000,monthlyRate:3,weeklyTarget:12000,lateFee:1000},
  modules:[
    {id:id(),type:"dice",name:"Dice Decisions",sides:12,stake:500,cooldownHours:24},
    {id:id(),type:"wheel",name:"Fate Wheel",cooldownHours:4,outcomes:[
      {label:"Credit",delta:-500},{label:"Charge",delta:800}]},
    {id:id(),type:"random",name:"Surprises",cooldownHours:12,outcomes:[
      {label:"Bonus",delta:-1000,weight:5},{label:"Reset",delta:200,weight:1}]},
    {id:id(),type:"checkin",name:"Reflection Check-in",reward:750,latePenalty:300,cooldownHours:24},
    {id:id(),type:"tasks",name:"Tasks",tasks:[
      {id:id(),label:"Share a weekly plan",reward:500},{id:id(),label:"Complete a joint puzzle",reward:600}]},
    {id:id(),type:"lock",name:"Optional Lock Report",suggestedDays:14,checkinHours:24,keyholderLabel:"Trusted partner"},
    {id:id(),type:"permission",name:"Consent Status",initialStatus:"limited",reminderHours:24},
    {id:id(),type:"calendar",name:"Meeting Window",days:[1,3,5],startHour:9,endHour:15}
  ]
}

test("agreement transcription preserves accepted terms, game rules and consent",()=>{
  const sections=agreementSections(input)
  const text=sections.flatMap(s=>[s.heading,...s.paragraphs]).join("\n")
  for(const token of [
    "dom_demo","sub_demo","2026-11-08T11:00:00.000Z",
    "85,000","Monthly interest rate: 3%","Weekly target","12,000",
    "Share a weekly plan","d12","weight 5","Credit","Charge",
    "Check-in interval: 24","14 days","Trusted partner","limited",
    "Monday, Wednesday, Friday","09:00","15:00",
    "withdrawn at any time","No real payment is processed"
  ])assert.ok(text.includes(token),"Missing agreed detail: "+token)
  assert.equal(sections.filter(s=>s.heading.includes("[")).length,8)
  assert.ok(text.includes("The Sub uploads a non-explicit photo"))
})
test("journal prompt is included when a journal module is agreed",()=>{
  const changed={...input,modules:[{id:id(),name:"Private Journal",type:"journal" as const,prompt:"Reflect on your boundaries and next step."}]}
  const text=agreementSections(changed).flatMap(s=>s.paragraphs).join(" ")
  assert.ok(text.includes("Reflect on your boundaries"))
})
test("generated agreement parses as a valid multipage PDF",async()=>{
  const bytes=await renderAgreementPdf(input)
  assert.ok(Buffer.from(bytes).subarray(0,8).toString("ascii").startsWith("%PDF-"))
  const document=await PDFDocument.load(bytes)
  assert.ok(document.getPageCount()>=2)
  assert.equal(document.getTitle(),"Accepted fantasy contract - Mutual Game Agreement")
  assert.ok(bytes.length<500_000)
})
