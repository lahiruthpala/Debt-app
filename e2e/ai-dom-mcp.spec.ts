import {expect,test,type Page} from "@playwright/test"

const stamp=Math.random().toString(36).slice(2,10)
const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||"http://127.0.0.1:3000").origin
const password="E2eTestPass!2026"

async function createSub(page:Page){
  await page.goto("/login?mode=signup")
  await page.getByLabel("PUBLIC HANDLE").fill("aisub_"+stamp)
  await page.getByRole("button",{name:/^SUB /}).click()
  await page.getByLabel("EMAIL").fill("e2e-aisub-"+stamp+"@example.invalid")
  await page.getByLabel("PASSWORD").fill(password)
  await page.getByRole("checkbox").check()
  for(let retry=0;retry<3;retry++){
    const pending=page.waitForResponse(r=>r.url().includes("/api/auth/sign-up/email")&&r.request().method()==="POST")
    await page.getByRole("button",{name:/Create my account/}).click()
    const result=await pending
    if(result.status()===429){await page.waitForTimeout(11500);continue}
    expect(result.status()).toBeLessThan(400)
    break
  }
  await expect(page).toHaveURL(/\/dashboard/,{timeout:25000})
  await page.getByRole("checkbox",{name:/I confirm that I am 18/}).check()
  await page.getByRole("button",{name:/Complete setup/}).click()
  await expect(page.getByRole("heading",{name:"Your command center"})).toBeVisible()
}

test("Sub AI Dom flow requires opt-in and separate contract approval; disabling pauses it",async({page})=>{
  await createSub(page)
  await page.getByRole("button",{name:"AI Dom",exact:true}).click()
  await expect(page.getByRole("heading",{name:"Play with an AI Dom"})).toBeVisible()
  const create=page.getByRole("button",{name:"Create AI Dom scene"})
  await expect(create).toBeDisabled()
  await page.getByRole("checkbox",{name:/I understand this is AI roleplay/}).check()
  await create.click()
  await expect(page.getByText(/AI scene proposed\. Review and approve/)).toBeVisible()
  const records=await page.request.get("/api/ai-dom")
  expect(records.status()).toBe(200)
  const scenes=(await records.json()).scenes
  expect(scenes.length).toBeGreaterThan(0)
  const sceneId=scenes[0].sceneId
  expect(scenes[0].status).toBe("proposed")
  const current=await page.request.get("/api/scene-platform?view=safety&sceneId="+sceneId)
  expect(current.status()).toBe(200)
  expect((await current.json()).own.ai_opt_in).toBe(true)

  const approved=await page.request.post("/api/studio",{
    headers:{origin},data:{action:"scene",sceneId,operation:"approve"}
  })
  expect(approved.status()).toBe(200)
  const active=await page.request.get("/api/studio?view=scenes")
  expect((await active.json()).scenes.find((x:{id:string})=>x.id===sceneId).status).toBe("active")

  const disable=await page.request.post("/api/ai-dom",{
    headers:{origin},data:{action:"disable",sceneId}
  })
  expect(disable.status()).toBe(200)
  const disabled=await page.request.get("/api/ai-dom")
  const record=(await disabled.json()).scenes.find((x:{sceneId:string})=>x.sceneId===sceneId)
  expect(record.enabled).toBe(false)
  expect(record.status).toBe("paused")
  const safety=await page.request.get("/api/scene-platform?view=safety&sceneId="+sceneId)
  expect((await safety.json()).own.ai_opt_in).toBe(false)

  const reenable=await page.request.post("/api/ai-dom",{
    headers:{origin},data:{action:"enable",sceneId,confirmAI:true}
  })
  expect(reenable.status()).toBe(200)
  const after=await page.request.get("/api/ai-dom")
  const rerecord=(await after.json()).scenes.find((x:{sceneId:string})=>x.sceneId===sceneId)
  expect(rerecord.enabled).toBe(true)
  expect(rerecord.status).toBe("paused") // no automatic resumption
})
