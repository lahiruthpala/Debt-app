import {expect,test,type Browser,type Page} from "@playwright/test"
import {randomUUID} from "node:crypto"

const stamp=Math.random().toString(36).slice(2,10)
const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||"http://127.0.0.1:3000").origin
async function account(browser:Browser,role:"DOM"|"SUB",handle:string){
  const context=await browser.newContext(),page=await context.newPage()
  await page.goto("/login?mode=signup")
  await page.getByLabel("PUBLIC HANDLE").fill(handle)
  await page.getByRole("button",{name:new RegExp("^"+role+" ")}).click()
  await page.getByLabel("EMAIL").fill("campaigns-"+handle+"@example.invalid")
  await page.getByLabel("PASSWORD").fill("E2eTestPass!2026")
  await page.getByRole("checkbox").check()
  for(let i=0;i<3;i++){
    const response=page.waitForResponse(r=>r.url().includes("/api/auth/sign-up/email")&&r.request().method()==="POST")
    await page.getByRole("button",{name:/Create my account/}).click()
    const result=await response
    if(result.status()===429){await page.waitForTimeout(11500);continue}
    expect(result.ok()).toBe(true);break
  }
  await expect(page).toHaveURL(/\/dashboard/,{timeout:25000})
  await page.getByRole("checkbox",{name:/I confirm that I am 18/}).check()
  await page.getByRole("button",{name:/Complete setup/}).click()
  await expect(page.getByRole("heading",{name:"Your command center"})).toBeVisible()
  return {page,context}
}
async function act(page:Page,action:string,data:Record<string,unknown>,expected=200){
  const r=await page.request.post("/api/campaigns",{headers:{origin},data:{action,...data}})
  expect(r.status(),await r.text()).toBe(expected)
  return r.json()
}
async function detail(page:Page,id:string){
  const r=await page.request.get("/api/campaigns?view=detail&id="+id)
  expect(r.status()).toBe(200)
  return r.json()
}
const definition={
 title:"Consensual shared treasure "+stamp,
 description:"A voluntary fictional contribution and community task campaign for consenting adults.",
 rules:"All contributions are imaginary; no real money moves. Leaving or declining is always allowed without penalties.",
 kind:"goal",visibility:"public",joinPolicy:"open",category:"Community",tags:["Dice games"],
 startAt:null,endAt:null,goal:10000,minContribution:100,maxContribution:2000,maxPerMember:3000,
 memberLimit:100,requireContributionProof:false,allowAnonymous:true,leaderboardEnabled:true,allowComments:true,
 milestones:[{title:"First checkpoint",threshold:1000}],
 activities:[
  {type:"task",title:"Write a progress report",points:60,proofRequired:false,maxCompletionsPerMember:1},
  {type:"game",title:"Daily chance",game:"dice",pointsWin:50,pointsLose:10,cooldownHours:24},
  {type:"poll",title:"Next challenge",choices:["Stories","Puzzles"]}
 ]
}
test("one Dom and one Sub: discover, join, contribute, games, task approval, privacy and exit",async({browser})=>{
  const dom=await account(browser,"DOM","domcamp_"+stamp)
  const sub=await account(browser,"SUB","subcamp_"+stamp)
  try{
    const created=await act(dom.page,"create",{definition},201),id=created.id
    let d=await detail(dom.page,id)
    expect(d.campaign.status).toBe("draft")
    await act(dom.page,"publish",{campaignId:id})
    const search=await sub.page.request.get("/api/campaigns?view=discover&q="+encodeURIComponent(stamp))
    expect(search.status()).toBe(200)
    expect((await search.json()).campaigns.some((c:{id:string})=>c.id===id)).toBe(true)
    // A participant can inspect the published rules before consenting.
    d=await detail(sub.page,id)
    expect(d.membership).toBeNull()
    expect(d.campaign.rules).toContain("no real money")
    await expect(dom.page.getByRole("button",{name:"Campaigns",exact:true})).toBeVisible()
    await dom.page.getByRole("button",{name:"Campaigns",exact:true}).click()
    await expect(dom.page.getByRole("heading",{name:"Campaigns",exact:true})).toBeVisible()
    await act(sub.page,"join",{campaignId:id,preferences:{anonymous:false,showOnLeaderboard:true,personalCap:1500}})
    d=await detail(sub.page,id)
    expect(d.membership.status).toBe("active")
    expect(d.memberQueue).toEqual([])
    const requestId=randomUUID()
    await act(sub.page,"contribute",{campaignId:id,amount:1000,note:"Fictional first contribution",requestId},201)
    const replay=await act(sub.page,"contribute",{campaignId:id,amount:1000,note:"Fictional first contribution",requestId})
    expect(replay.status).toBe("approved")
    d=await detail(dom.page,id)
    expect(d.totals.total).toBe(1000)
    expect(d.contributions).toHaveLength(1)
    const cap=await sub.page.request.post("/api/campaigns",{headers:{origin},data:{
      action:"contribute",campaignId:id,amount:600,note:"Cannot exceed personal cap",requestId:randomUUID()}})
    expect(cap.status()).toBe(409)
    await act(sub.page,"follow",{campaignId:id,follow:true})
    const activity=d.activities
    const taskId=activity.find((x:{kind:string})=>x.kind==="task").id
    const gameId=activity.find((x:{kind:string})=>x.kind==="game").id
    const pollId=activity.find((x:{kind:string})=>x.kind==="poll").id
    await act(sub.page,"vote",{campaignId:id,activityId:pollId,choice:1})
    const played=await act(sub.page,"play_game",{campaignId:id,activityId:gameId})
    expect(played.points).toBeGreaterThanOrEqual(0)
    const playAgain=await sub.page.request.post("/api/campaigns",{headers:{origin},data:{action:"play_game",campaignId:id,activityId:gameId}})
    expect(playAgain.status()).toBe(409)
    const claim=await act(sub.page,"submit_task",{campaignId:id,activityId:taskId,note:"Completed the community writing task"},201)
    await act(dom.page,"review_task",{campaignId:id,claimId:claim.id,approve:true})
    const published=await act(dom.page,"post",{campaignId:id,content:"A new community announcement",parentId:null},201)
    await act(sub.page,"react",{campaignId:id,postId:published.id,emoji:"heart",enabled:true})
    await act(sub.page,"post",{campaignId:id,content:"Thanks for the update",parentId:published.id},201)
    d=await detail(sub.page,id)
    expect(d.totals.total).toBe(1000)
    expect(d.leaderboard.some((x:{handle:string})=>x.handle==="subcamp_"+stamp)).toBe(true)
    expect(d.leaderboard[0].points).toBeGreaterThanOrEqual(60)
    expect(d.posts.some((x:{content:string})=>x.content==="Thanks for the update")).toBe(true)
    expect(d.votes.find((x:{activity_id:string;choice_index:number})=>x.activity_id===pollId&&x.choice_index===1).votes).toBe(1)
    await act(sub.page,"leave",{campaignId:id})
    expect((await detail(sub.page,id)).membership.status).toBe("left")
    const afterLeave=await sub.page.request.post("/api/campaigns",{headers:{origin},data:{
      action:"contribute",campaignId:id,amount:100,note:"Should reject",requestId:randomUUID()}})
    expect(afterLeave.status()).toBe(403)
    expect((await detail(dom.page,id)).totals.total).toBe(1000)
    await act(dom.page,"close",{campaignId:id})
    expect((await detail(dom.page,id)).campaign.status).toBe("closed")
  }finally{await dom.context.close();await sub.context.close()}
})
test("restricted invitations and approval-gated campaigns preserve voluntary acceptance",async({browser})=>{
  const dom=await account(browser,"DOM","domgate_"+stamp)
  const sub=await account(browser,"SUB","subgate_"+stamp)
  try{
    const gated=await act(dom.page,"create",{definition:{...definition,title:"Private event "+stamp,
      kind:"event",visibility:"restricted",joinPolicy:"invite",startAt:new Date(Date.now()-3600000).toISOString(),
      endAt:new Date(Date.now()+86400000).toISOString()}},201)
    await act(dom.page,"publish",{campaignId:gated.id})
    const hidden=await sub.page.request.get("/api/campaigns?view=detail&id="+gated.id)
    expect(hidden.status()).toBe(404)
    await act(dom.page,"invite",{campaignId:gated.id,handle:"subgate_"+stamp})
    expect((await detail(sub.page,gated.id)).membership.status).toBe("invited")
    await act(sub.page,"accept_invite",{campaignId:gated.id,preferences:{
      anonymous:true,showOnLeaderboard:false,personalCap:1000}})
    expect((await detail(sub.page,gated.id)).membership.status).toBe("active")
    await act(sub.page,"leave",{campaignId:gated.id})
    const approval=await act(dom.page,"create",{definition:{...definition,title:"Approve access "+stamp,
      visibility:"unlisted",joinPolicy:"approval"}},201)
    await act(dom.page,"publish",{campaignId:approval.id})
    await act(sub.page,"join",{campaignId:approval.id,preferences:{
      anonymous:true,showOnLeaderboard:false,personalCap:1000}})
    expect((await detail(sub.page,approval.id)).membership.status).toBe("pending")
    const blocked=await sub.page.request.post("/api/campaigns",{headers:{origin},data:{
      action:"contribute",campaignId:approval.id,amount:100,note:"Before approval",requestId:randomUUID()}})
    expect(blocked.status()).toBe(403)
    const members=(await detail(dom.page,approval.id)).memberQueue
    await act(dom.page,"approve_member",{campaignId:approval.id,memberId:members[0].member_id})
    expect((await detail(sub.page,approval.id)).membership.status).toBe("active")
  }finally{await dom.context.close();await sub.context.close()}
})
