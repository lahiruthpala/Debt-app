import {expect,test,type Browser,type Page} from "@playwright/test"

const stamp=Math.random().toString(36).slice(2,10)
const password="E2eTestPass!2026"
const origin=new URL(process.env.PLAYWRIGHT_BASE_URL||"http://127.0.0.1:3000").origin

async function submitSignup(page: Page) {
  for(let attempt=0;attempt<3;attempt++){
    const response=page.waitForResponse(r=>r.url().includes("/api/auth/sign-up/email")&&r.request().method()==="POST")
    await page.getByRole("button",{name:/Create my account/}).click()
    const result=await response
    if(result.status()===429){
      // Respect Better Auth's per-IP signup rate limit between CI browser journeys.
      await page.waitForTimeout(11500)
      continue
    }
    if(!result.ok()){
      const body=await result.json().catch(()=>({}))
      throw new Error("Signup failed ("+result.status()+"): "+(body.code||body.message||body.error||"Unknown error"))
    }
    return
  }
  throw new Error("Signup remains rate-limited after retry")
}

async function makeUser(browser:Browser,role:"DOM"|"SUB",handle:string){
  const context=await browser.newContext()
  const page=await context.newPage()
  await page.goto("/login?mode=signup")
  await page.getByLabel("PUBLIC HANDLE").fill(handle)
  await page.getByRole("button",{name:new RegExp("^"+role+" ")}).click()
  await page.getByLabel("EMAIL").fill("e2e-"+handle+"@example.invalid")
  await page.getByLabel("PASSWORD").fill(password)
  await page.getByRole("checkbox").check()
  await submitSignup(page)
  await expect(page).toHaveURL(/\/dashboard/,{timeout:25000})
  await page.getByRole("checkbox",{name:/I confirm that I am 18/}).check()
  await page.getByRole("button",{name:/Complete setup/}).click()
  await expect(page.getByRole("heading",{name:"Your command center"})).toBeVisible()
  return {page,context,handle}
}
async function tab(page:Page,name:string){await page.getByRole("button",{name,exact:true}).click()}
async function json(page:Page,url:string){
  const response=await page.request.get(url)
  expect(response.status()).toBe(200)
  return response.json()
}
function total(scene:any){return scene.principal+scene.interest+scene.penalties}
test("interactive debt contract: publish, propose, consent, random modules, task review and exit",async({browser})=>{
  const dom=await makeUser(browser,"DOM","domc_"+stamp)
  const sub=await makeUser(browser,"SUB","subc_"+stamp)
  let templateId=""
  try{
    await tab(dom.page,"Discover")
    await dom.page.getByPlaceholder(/Search sub handles or bios/).fill(sub.handle)
    await dom.page.getByRole("button",{name:"Search",exact:true}).click()
    const profileResult=dom.page.locator(".person").filter({hasText:"@"+sub.handle})
    await expect(profileResult).toBeVisible({timeout:15000})
    await profileResult.getByRole("button",{name:/Invite/}).click()
    await expect(dom.page.getByRole("status")).toContainText("Invitation sent")
    await tab(sub.page,"Connections")
    await sub.page.locator(".person").filter({hasText:"@"+dom.handle}).getByRole("button",{name:"Accept",exact:true}).click()
    await expect(sub.page.getByRole("status")).toContainText("Connection accepted")

    await dom.page.reload()
    await tab(dom.page,"Game room")
    await dom.page.getByLabel("Contract name").fill("Dice and Wheel "+stamp)
    await dom.page.locator(".module-palette button").filter({hasText:"Check-ins"}).click()
    await dom.page.locator(".module-palette button").filter({hasText:"Verified tasks"}).click()
    await dom.page.getByLabel("Checkin reward 2").fill("700")
    await dom.page.getByLabel("Task 3 name 0").fill("Complete an imaginary balance review together")
    await dom.page.getByRole("button",{name:/Publish template/}).click()
    await expect(dom.page.getByRole("status")).toContainText("published to discovery")
    const list=await json(dom.page,"/api/contracts?view=templates")
    const created=list.mine.find((x:{title:string})=>x.title==="Dice and Wheel "+stamp)
    expect(created).toBeTruthy()
    templateId=created.id
    expect(created.modules).toHaveLength(4)

    // Another account can discover the public template but cannot change it.
    const discovered=await json(sub.page,"/api/contracts?view=templates&q="+stamp)
    expect(discovered.library.some((x:{id:string})=>x.id===templateId)).toBe(true)
    const forbiddenEdit=await sub.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"publish",templateId,publish:false}
    })
    expect(forbiddenEdit.status()).toBe(404)
    const invalid=await dom.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"save",publish:false,definition:{...created,terms:{...created.terms,principal:2000000}}}
    })
    expect(invalid.status()).toBe(400)

    await dom.page.getByRole("button",{name:/Save & propose contract/}).click()
    await expect(dom.page.getByRole("status")).toContainText("must approve")
    const domScenes=await json(dom.page,"/api/contracts?view=scenes")
    const scene=domScenes.scenes.find((x:{title_snapshot:string})=>x.title_snapshot==="Dice and Wheel "+stamp)
    expect(scene).toBeTruthy()
    expect(scene.status).toBe("proposed")
    const dice=scene.modules_snapshot.find((m:{type:string})=>m.type==="dice")
    const wheel=scene.modules_snapshot.find((m:{type:string})=>m.type==="wheel")
    const checkin=scene.modules_snapshot.find((m:{type:string})=>m.type==="checkin")
    const tasks=scene.modules_snapshot.find((m:{type:string})=>m.type==="tasks")
    expect(dice&&wheel&&checkin&&tasks).toBeTruthy()
    const beforeConsent=await dom.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:dice.id}
    })
    expect(beforeConsent.status()).toBe(409)

    await sub.page.reload()
    await tab(sub.page,"Game room")
    await sub.page.getByRole("button",{name:/My contracts/}).click()
    await expect(sub.page.getByRole("button",{name:/Approve & activate contract/})).toBeVisible()
    await sub.page.getByRole("button",{name:/Approve & activate contract/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Scene activated")
    const approved=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
    expect(approved.scene.status).toBe("active")

    // A real dice roll changes the balance by the server-computed delta.
    const beforeDice=total(approved.scene)
    await sub.page.locator(".contract-game-card.kind-dice").getByRole("button",{name:/Roll dice/}).click()
    await expect(sub.page.getByRole("status")).toContainText("dice")
    const afterDice=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
    const diceAction=afterDice.actions.find((a:{module_id:string})=>a.module_id===dice.id)
    expect(diceAction.details.playerRoll).toBeGreaterThanOrEqual(1)
    expect(diceAction.details.botRoll).toBeLessThanOrEqual(dice.sides)
    expect(total(afterDice.scene)-beforeDice).toBe(diceAction.delta)
    const cooldown=await sub.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:dice.id}
    })
    expect(cooldown.status()).toBe(429)

    await sub.page.locator(".contract-game-card.kind-wheel").getByRole("button",{name:/Spin the wheel/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Fortune Wheel")
    const afterWheel=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
    expect(afterWheel.actions.some((a:{module_id:string})=>a.module_id===wheel.id)).toBe(true)
    await sub.page.locator(".contract-game-card.kind-checkin").getByRole("button",{name:/Check in/}).click()
    await expect(sub.page.getByRole("status")).toContainText("check-in completed")

    await sub.page.locator(".contract-game-card.kind-tasks").getByRole("button",{name:"Submit",exact:true}).click()
    await expect(sub.page.getByRole("status")).toContainText("Task submitted")
    const pending=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
    const claim=pending.claims.find((c:{task_id:string})=>c.task_id===tasks.tasks[0].id)
    expect(claim.state).toBe("pending")
    const subReview=await sub.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"review",sceneId:scene.scene_id,claimId:claim.id,approve:true}
    })
    expect(subReview.status()).toBe(403)

    await dom.page.reload()
    await tab(dom.page,"Game room")
    await dom.page.getByRole("button",{name:/My contracts/}).click()
    await dom.page.locator(".contract-task").getByRole("button",{name:"Approve",exact:true}).click()
    await expect(dom.page.getByRole("status")).toContainText("Task approved")
    const reviewed=await json(dom.page,"/api/contracts?view=scene&id="+scene.scene_id)
    expect(reviewed.claims.find((c:{id:string})=>c.id===claim.id).state).toBe("approved")

    await dom.page.getByRole("button",{name:/Pause all games/}).click()
    await expect(dom.page.getByRole("status")).toContainText("Scene paused")
    const paused=await sub.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:wheel.id}
    })
    expect(paused.status()).toBe(409)
    await sub.page.reload()
    await tab(sub.page,"Game room")
    await sub.page.getByRole("button",{name:/My contracts/}).click()
    await sub.page.getByRole("button",{name:/Resume with consent/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Scene resumed")
    sub.page.once("dialog",dialog=>dialog.accept())
    await sub.page.getByRole("button",{name:/End contract/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Scene ended")
    const ended=await dom.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:wheel.id}
    })
    expect(ended.status()).toBe(409)
  }finally{
    // Never leave a synthetic published template in public discovery.
    if(templateId)await dom.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"publish",templateId,publish:false}
    }).catch(()=>{})
    await dom.context.close()
    await sub.context.close()
  }
})
