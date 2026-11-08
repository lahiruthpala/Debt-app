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

const liveProofs=process.env.PLAYWRIGHT_SKIP_WEBSERVER==="1"
const testPhoto=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b2S8AAAAASUVORK5CYII=","base64")
async function uploadProof(page:Page,selector:string) {
  const form=page.locator(selector).first()
  await form.locator('input[type="file"]').setInputFiles({name:"synthetic-pixel.png",mimeType:"image/png",buffer:testPhoto})
  await form.getByRole("checkbox").check()
  await form.getByRole("button",{name:/Submit for review/}).click()
  await expect(page.locator(".action-toast")).toContainText("Private proof submitted",{timeout:30000})
}
async function approveProof(page:Page,kind:string){
  const card=page.locator(".proof-center .proof-item").filter({hasText:kind}).first()
  await expect(card).toBeVisible({timeout:15000})
  await card.getByRole("button",{name:"View private image"}).click()
  const img=card.locator("img")
  await expect(img).toBeVisible()
  await expect.poll(()=>img.evaluate(el=>(el as HTMLImageElement).naturalWidth>0),{timeout:15000}).toBe(true)
  await card.getByRole("button",{name:"Approve proof"}).click()
  await expect(page.locator(".action-toast")).toContainText("Proof approved")
}

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
    await tab(dom.page,"Contracts")
    await dom.page.getByLabel("Contract name").fill("Dice and Wheel "+stamp)
    await dom.page.locator(".module-palette button").filter({hasText:"Check-ins"}).click()
    await dom.page.locator(".module-palette button").filter({hasText:"Verified tasks"}).click()
    await dom.page.locator(".module-palette button").filter({hasText:"Random events"}).click()
    await dom.page.getByLabel("Event weight 4 option 0").fill("7")
    await dom.page.getByLabel("Checkin late penalty 2").fill("1200")
    await dom.page.getByLabel("Checkin reward 2").fill("700")
    await dom.page.getByLabel("Task 3 name 0").fill("Complete an imaginary balance review together")
    await dom.page.getByRole("button",{name:/Publish template/}).click()
    await expect(dom.page.getByRole("status")).toContainText("published to discovery")
    const list=await json(dom.page,"/api/contracts?view=templates")
    const created=list.mine.find((x:{title:string})=>x.title==="Dice and Wheel "+stamp)
    expect(created).toBeTruthy()
    templateId=created.id
    expect(created.modules).toHaveLength(5)
    expect(list.officialCount).toBe(20)
    expect(list.library.filter((x:{is_official?:boolean})=>x.is_official)).toHaveLength(20)
    const findOfficial=await json(dom.page,"/api/contracts?view=templates&q=Labyrinth")
    expect(findOfficial.library.filter((x:{is_official?:boolean})=>x.is_official).map((x:{title:string})=>x.title))
      .toEqual(["Labyrinth of Clues"])

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
    const random=scene.modules_snapshot.find((m:{type:string})=>m.type==="random")
    expect(dice&&wheel&&checkin&&tasks&&random).toBeTruthy()
    const beforeConsent=await dom.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:dice.id}
    })
    expect(beforeConsent.status()).toBe(409)

    await sub.page.reload()
    await tab(sub.page,"Contracts")
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
    await sub.page.locator(".contract-game-card.kind-random").getByRole("button",{name:/Reveal event/}).click()
    await expect(sub.page.getByRole("status")).toContainText("random event")
    const afterRandom=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
    const selected=afterRandom.actions.find((a:{module_id:string})=>a.module_id===random.id)
    expect(random.outcomes.some((o:{label:string})=>o.label===selected.details.label)).toBe(true)
    const repeatedRandom=await sub.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:random.id}
    })
    expect(repeatedRandom.status()).toBe(429)
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

    if(liveProofs){
      await uploadProof(sub.page,".contract-task .proof-uploader")
      const direct=await dom.page.request.post("/api/contracts",{
        headers:{origin},data:{action:"review",sceneId:scene.scene_id,claimId:claim.id,approve:true}
      })
      expect(direct.status()).toBe(409)
    }
    await dom.page.reload()
    await tab(dom.page,"Contracts")
    await dom.page.getByRole("button",{name:/My contracts/}).click()
    if(liveProofs){
      await approveProof(dom.page,"Contract task proof")
      const repeat=await dom.page.request.patch("/api/proofs",{
        headers:{origin},data:{id:(await json(dom.page,"/api/proofs?sceneId="+scene.scene_id)).proofs[0].id,approve:true}
      })
      expect(repeat.status()).toBe(409)
    }else{
      await dom.page.locator(".contract-task").getByRole("button",{name:"Approve",exact:true}).click()
      await expect(dom.page.getByRole("status")).toContainText("Task approved")
    }
    const reviewed=await json(dom.page,"/api/contracts?view=scene&id="+scene.scene_id)
    expect(reviewed.claims.find((c:{id:string})=>c.id===claim.id).state).toBe("approved")

    if(liveProofs){
      await tab(sub.page,"Overview")
      const beforePayment=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
      const paymentForm=sub.page.locator('.dash-card:has-text("Simulated payments") .proof-uploader')
       await paymentForm.getByLabel("Simulated credit amount").fill("12000")
       await uploadProof(sub.page,'.dash-card:has-text("Simulated payments") .proof-uploader')
      const waiting=await json(sub.page,"/api/contracts?view=scene&id="+scene.scene_id)
      expect(total(waiting.scene)).toBe(total(beforePayment.scene))
      await tab(dom.page,"Overview")
      await approveProof(dom.page,"Simulated payment proof")
      const paid=await json(dom.page,"/api/contracts?view=scene&id="+scene.scene_id)
      expect(total(paid.scene)).toBe(total(beforePayment.scene)-Math.min(12000,total(beforePayment.scene)))
      await tab(dom.page,"Contracts")
      await dom.page.getByRole("button",{name:/My contracts/}).click()
    }
    await dom.page.getByRole("button",{name:/Pause all games/}).click()
    await expect(dom.page.getByRole("status")).toContainText("Scene paused")
    const paused=await sub.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"play",sceneId:scene.scene_id,moduleId:wheel.id}
    })
    expect(paused.status()).toBe(409)
    await sub.page.reload()
    await tab(sub.page,"Contracts")
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

    // Curated contract recipes are visible to every signed-in user, copyable,
    // and can be proposed and played after the previous contract ends.
    await dom.page.reload()
    await tab(dom.page,"Contracts")
    await dom.page.getByRole("button",{name:/Discover templates/}).click()
    await dom.page.getByRole("button",{name:/Official \(20\)/}).click()
    await expect(dom.page.locator(".contract-template.official-template")).toHaveCount(20)
    await expect(dom.page.getByText("Velvet Roulette")).toBeVisible()
    await dom.page.locator(".contract-template.official-template").filter({hasText:"Velvet Roulette"})
      .getByRole("button",{name:/Customize & play/}).click()
    await expect(dom.page.getByLabel("Contract name")).toHaveValue("Velvet Roulette")
    await expect(dom.page.locator(".module-editor")).toHaveCount(6)
    await expect(dom.page.locator(".contract-pressure")).toBeVisible()
    await expect(dom.page.getByText("THE FINAL WORD IS CONSENT.")).toBeVisible()
    await expect(dom.page.getByLabel("Lock suggested days 3")).toHaveValue("7")
    await expect(dom.page.getByLabel("Initial permission 4")).toHaveValue("limited")
    await dom.page.getByRole("button",{name:/Save & propose contract/}).click()
    await expect(dom.page.getByRole("status")).toContainText("must approve")
    const recent=await json(dom.page,"/api/contracts?view=scenes")
    const curatedScene=recent.scenes.find((x:{title_snapshot:string;status:string})=>
      x.title_snapshot==="Velvet Roulette"&&x.status==="proposed")
    expect(curatedScene).toBeTruthy()
    await sub.page.reload()
    await tab(sub.page,"Contracts")
    await sub.page.getByRole("button",{name:/My contracts/}).click()
    await sub.page.locator(".scene-chip").filter({hasText:"proposed"}).first().click()
    await sub.page.getByRole("button",{name:/Approve & activate contract/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Scene activated")
    // Lock status is proof-gated and Dom reviewed; the old direct write must fail.
    await expect(sub.page.locator(".boundary-lock")).toBeVisible()
    await expect(sub.page.locator(".boundary-permission")).toBeVisible()
    await expect(sub.page.locator(".boundary-journal")).toBeVisible()
    const beforeStatus=await json(sub.page,"/api/contracts?view=scene&id="+curatedScene.scene_id)
    const lockModule=curatedScene.modules_snapshot.find((m:{type:string})=>m.type==="lock")
    const requestLock=sub.page.getByRole("button",{name:"Request lock",exact:true})
    await expect(requestLock).toBeDisabled()
    const directLock=await sub.page.request.post("/api/contract-boundaries",{
      headers:{origin},data:{action:"set_lock",sceneId:curatedScene.scene_id,moduleId:lockModule.id,locked:true}
    })
    expect(directLock.status()).toBe(409)
    const noPhoto=await sub.page.request.post("/api/contract-boundaries",{
      headers:{origin},data:{action:"request_lock",sceneId:curatedScene.scene_id,moduleId:lockModule.id,proofId:crypto.randomUUID()}
    })
    expect(noPhoto.status()).toBe(409)
    if(liveProofs){
      const form=sub.page.locator(".boundary-lock .proof-uploader")
      await form.locator('input[type="file"]').setInputFiles({name:"synthetic-pixel.png",mimeType:"image/png",buffer:testPhoto})
      await expect(requestLock).toBeDisabled()
      await form.getByRole("checkbox").check()
      await form.getByRole("button",{name:/Upload lock photo/}).click()
      await expect(sub.page.locator(".action-toast")).toContainText("Lock photo uploaded",{timeout:30000})
      await expect(requestLock).toBeEnabled()
      const staged=(await json(sub.page,"/api/proofs?sceneId="+curatedScene.scene_id)).proofs
        .find((p:{kind:string;status:string})=>p.kind==="lock"&&p.status==="pending")
      expect(staged.lock_request_id).toBeNull()
      const earlyReview=await dom.page.request.patch("/api/proofs",{
        headers:{origin},data:{id:staged.id,approve:true}
      })
      expect(earlyReview.status()).toBe(409)
      await requestLock.click()
      await expect(sub.page.getByRole("status")).toContainText("Lock request sent")
      const pending=await json(sub.page,"/api/contract-boundaries?sceneId="+curatedScene.scene_id)
      expect(pending.state.find((x:{module_id:string})=>x.module_id===lockModule.id)?.locked_since??null).toBeNull()
      const lockRequest=pending.requests.find((r:{kind:string;status:string})=>r.kind==="lock"&&r.status==="pending")
      expect(lockRequest).toBeTruthy()
      const bypass=await dom.page.request.post("/api/contract-boundaries",{
        headers:{origin},data:{action:"review_request",sceneId:curatedScene.scene_id,requestId:lockRequest.id,approve:true}
      })
      expect(bypass.status()).toBe(409)
      await dom.page.reload()
      await tab(dom.page,"Contracts")
      await dom.page.getByRole("button",{name:/My contracts/}).click()
      await approveProof(dom.page,"Lock-status proof")
      const afterLock=await json(dom.page,"/api/contract-boundaries?sceneId="+curatedScene.scene_id)
      expect(afterLock.state.find((x:{module_id:string;locked_since:string|null})=>x.module_id===lockModule.id)?.locked_since).toBeTruthy()
      const lockedEvidence=(await json(sub.page,"/api/proofs?sceneId="+curatedScene.scene_id)).proofs
        .find((p:{kind:string})=>p.kind==="lock")
      expect(lockedEvidence.status).toBe("approved")
      // Removing a reviewed photo cannot revert the accepted status.
      const remove=await sub.page.request.delete("/api/proofs",{
        headers:{origin},data:{id:lockedEvidence.id}
      })
      expect(remove.status()).toBe(200)
      expect((await sub.page.request.get("/api/proofs?view=image&id="+lockedEvidence.id)).status()).toBe(404)
      await expect(sub.page.getByRole("button",{name:"Request unlock review"})).toBeVisible()
      await sub.page.getByRole("button",{name:"Request unlock review"}).click()
      await expect(sub.page.getByRole("status")).toContainText("Request sent")
      await dom.page.reload()
      await tab(dom.page,"Contracts")
      await dom.page.getByRole("button",{name:/My contracts/}).click()
      const review=dom.page.locator(".boundary-lock .boundary-review")
      await review.getByRole("button",{name:"Decline"}).click()
      await expect(dom.page.getByRole("status")).toContainText("Request declined")
      const stillLocked=await json(dom.page,"/api/contract-boundaries?sceneId="+curatedScene.scene_id)
      expect(stillLocked.state.find((x:{module_id:string;locked_since:string|null})=>x.module_id===lockModule.id)?.locked_since).toBeTruthy()
      await sub.page.reload()
      await tab(sub.page,"Contracts")
      await sub.page.getByRole("button",{name:/My contracts/}).click()
      await sub.page.getByRole("button",{name:"Request unlock review"}).click()
      await expect(sub.page.getByRole("status")).toContainText("Request sent")
      await dom.page.reload()
      await tab(dom.page,"Contracts")
      await dom.page.getByRole("button",{name:/My contracts/}).click()
      await dom.page.locator(".boundary-lock .boundary-review").getByRole("button",{name:"Approve"}).click()
      await expect(dom.page.getByRole("status")).toContainText("Request approved")
      const afterUnlock=await json(sub.page,"/api/contract-boundaries?sceneId="+curatedScene.scene_id)
      expect(afterUnlock.state.find((x:{module_id:string;locked_since:string|null})=>x.module_id===lockModule.id)?.locked_since).toBeNull()
      await expect(sub.page.getByRole("button",{name:"Request lock",exact:true})).toBeDisabled()
    }
    await sub.page.getByRole("button",{name:"Request permission review"}).click()
    await expect(sub.page.getByRole("status")).toContainText("Request sent")
    await dom.page.reload()
    await tab(dom.page,"Contracts")
    await dom.page.getByRole("button",{name:/My contracts/}).click()
    await dom.page.locator(".boundary-permission .boundary-review").getByRole("button",{name:"Approve"}).click()
    await expect(dom.page.getByRole("status")).toContainText("Request approved")
    await sub.page.getByLabel("Private reflection").fill("The next challenge is a fictional treasure hunt.")
    await sub.page.getByRole("button",{name:"Share private entry"}).click()
    await expect(sub.page.getByRole("status")).toContainText("Private journal entry saved")
    await dom.page.reload()
    await tab(dom.page,"Contracts")
    await dom.page.getByRole("button",{name:/My contracts/}).click()
    await dom.page.locator(".boundary-journal").getByPlaceholder("Private response").fill("The clue has been received.")
    await dom.page.locator(".boundary-journal").getByRole("button",{name:"Reply"}).click()
    await expect(dom.page.getByRole("status")).toContainText("Private reply saved")
    const statusState=await json(sub.page,"/api/contract-boundaries?sceneId="+curatedScene.scene_id)
    expect(statusState.entries.some((entry:{reply:string|null})=>entry.reply==="The clue has been received.")).toBe(true)
    const afterStatus=await json(sub.page,"/api/contracts?view=scene&id="+curatedScene.scene_id)
    expect(total(afterStatus.scene)).toBe(total(beforeStatus.scene))
    await sub.page.locator(".contract-game-card.kind-wheel").getByRole("button",{name:/Spin the wheel/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Velvet Wheel")
    const curatedGame=await json(sub.page,"/api/contracts?view=scene&id="+curatedScene.scene_id)
    expect(curatedGame.actions.length).toBeGreaterThanOrEqual(1)
    sub.page.once("dialog",dialog=>dialog.accept())
    await sub.page.getByRole("button",{name:/End contract/}).click()
    await expect(sub.page.getByRole("status")).toContainText("Scene ended")
    const erase=await sub.page.request.post("/api/contract-boundaries",{
      headers:{origin},data:{action:"erase_private_data",sceneId:curatedScene.scene_id}
    })
    expect(erase.status()).toBe(200)
    const erasedState=await json(sub.page,"/api/contract-boundaries?sceneId="+curatedScene.scene_id)
    expect(erasedState.entries).toHaveLength(0)
    expect(erasedState.state).toHaveLength(0)
  }finally{
    // Never leave a synthetic published template in public discovery.
    if(templateId)await dom.page.request.post("/api/contracts",{
      headers:{origin},data:{action:"publish",templateId,publish:false}
    }).catch(()=>{})
    await dom.context.close()
    await sub.context.close()
  }
})
