import { expect, test, type Browser, type Page } from "@playwright/test"
import {PDFDocument} from "pdf-lib"

const id = () => Math.random().toString(36).slice(2, 10)
const stamp = id()
const password = "E2eTestPass!2026"
const apiOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").origin
const liveProofs=process.env.PLAYWRIGHT_SKIP_WEBSERVER==="1"
const testPhoto=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+b2S8AAAAASUVORK5CYII=","base64")

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


async function signUp(browser: Browser, role: "DOM" | "SUB", handle: string) {
  const context = await browser.newContext()
  const page = await context.newPage()
  const email = `e2e-${handle}@example.invalid`
  await page.goto("/login?mode=signup")
  await expect(page.getByRole("heading", { name: "Enter the story." })).toBeVisible()
  await page.getByLabel("PUBLIC HANDLE").fill(handle)
  await page.getByRole("button", { name: new RegExp("^" + role + " ") }).click()
  await page.getByLabel("EMAIL").fill(email)
  await page.getByLabel("PASSWORD").fill(password)
  await page.getByRole("checkbox").check()
  await submitSignup(page)
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 25_000 })
  await expect(page.getByRole("heading", { name: "Choose how you participate." })).toBeVisible()
  await expect(page.getByLabel("PUBLIC HANDLE")).toHaveValue(handle)
  await page.getByRole("checkbox", { name: /I confirm that I am 18/ }).check()
  await page.getByRole("button", { name: /Complete setup/ }).click()
  await expect(page.getByRole("heading", { name: "Your command center" })).toBeVisible()
  await expect(page.getByText("No scenes yet.")).toBeVisible()
  return { context, page, email, handle }
}

async function visit(page: Page, label: string) {
  await page.getByRole("button", { name: label, exact: true }).click()
}

test("database-backed signup, matchmaking, consent, ledger, games and exit", async ({ browser }) => {
  const domHandle = "dom_" + stamp
  const subHandle = "sub_" + stamp
  const dom = await signUp(browser, "DOM", domHandle)
  const sub = await signUp(browser, "SUB", subHandle)
  const domPage = dom.page
  const subPage = sub.page
  try {
    // A returning user must be able to sign out and sign back in.
    await domPage.getByRole("button", { name: /Sign out/ }).click()
    await expect(domPage).toHaveURL(/\/$/)
    await domPage.goto("/login")
    await domPage.getByLabel("EMAIL").fill(dom.email)
    await domPage.getByLabel("PASSWORD").fill(password)
    await domPage.locator("form").getByRole("button", { name: "Sign in" }).click()
    await expect(domPage).toHaveURL(/\/dashboard/, { timeout: 25_000 })
    await expect(domPage.locator(".user-pill")).toContainText("@" + domHandle)

    await visit(domPage, "Discover")
    await domPage.getByPlaceholder(/Search sub handles or bios/).fill(subHandle)
    await domPage.getByRole("button", { name: "Search", exact: true }).click()
    const target = domPage.locator(".person").filter({ hasText: "@" + subHandle })
    await expect(target).toBeVisible()
    // An unpublished showcase exposes only the public handle, role and bio.
    await target.getByRole("button",{name:"View profile"}).click()
    const preview=domPage.getByRole("dialog",{name:"Profile of @"+subHandle})
    await expect(preview).toBeVisible()
    await expect(preview.getByText("This member has not published their extended showcase.")).toBeVisible()
    await preview.getByRole("button",{name:"Send invitation"}).click()
    await expect(domPage.getByRole("status")).toContainText("Invitation sent")

    // Cannot accept your own invitation.
    const pending = await domPage.request.get("/api/studio?view=connections")
    expect(pending.status()).toBe(200)
    const connection = (await pending.json()).connections[0]
    expect(connection.state).toBe("pending")
    const senderAccept = await domPage.request.post("/api/studio", {
      headers: { origin: apiOrigin },
      data: { action: "connection", id: connection.id, decision: "accept" },
    })
    expect(senderAccept.status()).toBe(409)

    await visit(subPage, "Connections")
    const invite = subPage.locator(".person").filter({ hasText: "@" + domHandle })
    await expect(invite).toBeVisible()
    await invite.getByRole("button", { name: "Accept", exact: true }).click()
    await expect(subPage.getByRole("status")).toContainText("Connection accepted")

    await domPage.reload()
    await visit(domPage, "Connections")
    await expect(domPage.getByRole("heading", { name: "Propose terms to @" + subHandle })).toBeVisible()
    await domPage.getByRole("button", { name: /Send scene proposal/ }).click()
    await expect(domPage.getByRole("status")).toContainText("Terms proposed")
    const proposedScenes=await domPage.request.get("/api/studio?view=scenes")
    expect(proposedScenes.status()).toBe(200)
    const proposedId=(await proposedScenes.json()).scenes[0].id
    expect((await domPage.request.get("/api/contracts/pdf?sceneId="+proposedId)).status()).toBe(404)

    await subPage.reload()
    await expect(subPage.getByRole("button", { name: "Approve & begin scene" })).toBeVisible()
    await subPage.getByRole("button", { name: "Approve & begin scene" }).click()
    await expect(subPage.getByRole("status")).toContainText("Scene activated")
    await expect(subPage.locator(".big-balance")).toHaveText("LKR 250,000")
    const contractLink=subPage.getByRole("link",{name:/Download agreed terms/})
    await expect(contractLink).toBeVisible()
    const basicPdf=await subPage.request.get("/api/contracts/pdf?sceneId="+proposedId)
    expect(basicPdf.status()).toBe(200)
    expect(basicPdf.headers()["content-type"]).toMatch(/^application\/pdf/)
    expect(basicPdf.headers()["content-disposition"]).toContain("attachment")
    expect(basicPdf.headers()["cache-control"]).toContain("no-store")
    const basicDocument=await PDFDocument.load(await basicPdf.body())
    expect(basicDocument.getTitle()).toContain("Fictional Ledger Agreement")
    expect((await domPage.request.get("/api/contracts/pdf?sceneId="+proposedId)).status()).toBe(200)

    // Operations integration: scene-aware alerts, opt-in schedules and separate reward points.
    const notifications=await subPage.request.get("/api/operations?view=notifications")
    expect(notifications.status()).toBe(200)
    expect((await notifications.json()).notifications.some((x:{kind:string})=>x.kind==="invitation")).toBe(true)
    expect((await subPage.request.get("/api/maintenance")).status()).toBe(403)

    await visit(domPage,"Activity hub")
    await expect(domPage.getByRole("heading",{name:"Stay in sync with every scene."})).toBeVisible()
    await domPage.getByRole("button",{name:"Rituals & schedules"}).click()
    await expect(domPage.getByRole("heading",{name:"New recurring ritual"})).toBeVisible()
    const created=await domPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"ritual-create",sceneId:proposedId,
        title:"Voluntary progress "+stamp,description:"A creative daily check-in.",
        days:[0,1,2,3,4,5,6],hour:20,timezone:"UTC",requiresProof:false,points:20}
    })
    expect(created.status()).toBe(201)
    const ritualId=(await created.json()).id
    const forbidden=await domPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"ritual-decision",sceneId:proposedId,id:ritualId,decision:"active"}
    })
    expect(forbidden.status()).toBe(403)
    const accepted=await subPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"ritual-decision",sceneId:proposedId,id:ritualId,decision:"active"}
    })
    expect(accepted.status()).toBe(200)
    const scheduled=(await (await subPage.request.get("/api/operations?view=rituals&sceneId="+proposedId)).json())
    const occurrence=scheduled.occurrences.find((x:{ritual_id:string})=>x.ritual_id===ritualId)
    expect(occurrence.status).toBe("pending")
    const submitted=await subPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"ritual-submit",sceneId:proposedId,id:occurrence.id,note:"Completed."}
    })
    expect(submitted.status()).toBe(200)
    const queued=(await (await domPage.request.get("/api/operations?view=queue&sceneId="+proposedId)).json()).queue
    expect(queued.some((x:{id:string})=>x.id===occurrence.id)).toBe(true)
    const subReview=await subPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"ritual-review",sceneId:proposedId,id:occurrence.id,approve:true}
    })
    expect(subReview.status()).toBe(403)
    const approved=await domPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"ritual-review",sceneId:proposedId,id:occurrence.id,approve:true}
    })
    expect(approved.status()).toBe(200)
    const points=(await (await subPage.request.get("/api/operations?view=rewards&sceneId="+proposedId)).json())
    expect(points.balances.find((b:{handle:string})=>b.handle===subHandle)?.balance).toBe(20)
    const added=await domPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"reward-create",sceneId:proposedId,
        title:"Choose the next story",description:"A voluntary fictional game reward.",cost:10}
    })
    expect(added.status()).toBe(201)
    const rewardId=(await added.json()).id
    const redeem=await subPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"reward-redeem",sceneId:proposedId,id:rewardId}
    })
    expect(redeem.status()).toBe(200)
    const redemptions=(await (await domPage.request.get("/api/operations?view=rewards&sceneId="+proposedId)).json()).redemptions
    const redemption=redemptions.find((x:{option_id:string})=>x.option_id===rewardId)
    expect(redemption.status).toBe("pending")
    const fulfilled=await domPage.request.post("/api/operations",{
      headers:{origin:apiOrigin},data:{action:"reward-review",sceneId:proposedId,id:redemption.id,approve:true}
    })
    expect(fulfilled.status()).toBe(200)
    for(const [page,name] of [[domPage,domHandle],[subPage,subHandle]] as const){
      const response=await page.request.post("/api/operations",{
        headers:{origin:apiOrigin},data:{action:"sign",sceneId:proposedId,typedName:name,acknowledged:true}
      })
      expect(response.status()).toBe(200)
    }
    const signatures=(await (await subPage.request.get("/api/operations?view=signatures&sceneId="+proposedId)).json()).signatures
    expect(signatures).toHaveLength(2)
    const projected=await subPage.request.get("/api/operations?view=forecast&sceneId="+proposedId+
      "&weeks=6&interest=false&extra=100&late=%5B%5D")
    expect(projected.status()).toBe(200)
    expect((await projected.json()).weeks).toHaveLength(6)
    const postOps=(await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    expect([postOps.principal,postOps.interest,postOps.penalties]).toEqual([250000,0,0])
    const newPdf=await subPage.request.get("/api/contracts/pdf?sceneId="+proposedId)
    expect(newPdf.status()).toBe(200)
    await PDFDocument.load(await newPdf.body())
    await visit(domPage,"Overview")


    // Scene Platform v3: versioned playbooks, consent-gated choices, linked tasks,
    // private partner messages, safe timers and read-only creativity assistance.
    await visit(domPage,"Story games")
    await domPage.getByRole("button",{name:/Branching story builder/}).click()
    await expect(domPage.getByRole("heading",{name:"Build interconnected adventures"})).toBeVisible()
    await visit(domPage,"Partner space")
    await expect(domPage.getByRole("heading",{name:"Keep your scene in one place"})).toBeVisible()
    const aiInfo=await domPage.request.get("/api/scene-ai")
    expect(aiInfo.status()).toBe(200)
    expect((await aiInfo.json()).available).toBe(false)
    expect((await domPage.request.get("/manifest.webmanifest")).status()).toBe(200)
    expect((await domPage.request.get("/offline")).status()).toBe(200)

    const playbook={title:"The Glass Archive "+stamp,summary:"A cooperative adventure with consented game points.",
      category:"Mystery",nodes:[
        {id:"start",title:"At the archive",text:"Two partners discover a sealed archive with a mysterious lock.",
          choices:[{id:"enter",label:"Open the archive together",next:"middle",setsFlag:"trusted",
            points:5,proposeTask:"Solve the archive riddle"}]},
        {id:"middle",title:"The hidden chapter",text:"A hidden message asks the explorers to finish their adventure.",
          choices:[{id:"finish",label:"Complete the adventure",next:"end",requiresFlag:"trusted",points:3,proposeTask:""}]},
        {id:"end",title:"The final discovery",text:"Both explorers return safely with their final answers.",choices:[]}
      ]}
    const savedStory=await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-save",definition:playbook,publish:true}
    })
    expect(savedStory.status()).toBe(201)
    const playbookId=(await savedStory.json()).id
    const proposedStory=await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-propose",sceneId:proposedId,id:playbookId}
    })
    expect(proposedStory.status()).toBe(201)
    const storySession=(await proposedStory.json()).id
    expect((await (await subPage.request.get("/api/scene-platform?view=stories&sceneId="+proposedId)).json())
      .sessions.find((x:{id:string})=>x.id===storySession).status).toBe("proposed")
    const selfApproveStory=await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-decision",sceneId:proposedId,id:storySession,approve:true}
    })
    expect(selfApproveStory.status()).toBe(403)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-decision",sceneId:proposedId,id:storySession,approve:true}
    })).status()).toBe(200)
    const firstChoice=await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-choice",sceneId:proposedId,id:storySession,choiceId:"enter"}
    })
    expect(firstChoice.status()).toBe(200)
    const repeatedChoice=await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-choice",sceneId:proposedId,id:storySession,choiceId:"finish"}
    })
    expect(repeatedChoice.status()).toBe(409)
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"story-choice",sceneId:proposedId,id:storySession,choiceId:"finish"}
    })).status()).toBe(200)
    const finishedStory=(await (await subPage.request.get("/api/scene-platform?view=stories&sceneId="+proposedId)).json())
      .sessions.find((x:{id:string})=>x.id===storySession)
    expect(finishedStory.status).toBe("finished")
    expect(finishedStory.state.flags).toContain("trusted")
    const storyTask=(await (await domPage.request.get("/api/scene-platform?view=tasks&sceneId="+proposedId)).json())
      .tasks.find((x:{story_session_id:string})=>x.story_session_id===storySession)
    expect(storyTask.status).toBe("proposed")
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-decision",sceneId:proposedId,id:storyTask.id,accept:true}
    })).status()).toBe(200)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-submit",sceneId:proposedId,id:storyTask.id,note:"Completed the shared riddle."}
    })).status()).toBe(200)
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-review",sceneId:proposedId,id:storyTask.id,approve:true,note:"Approved"}
    })).status()).toBe(200)

    const advanced=await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-create",sceneId:proposedId,
        task:{title:"Two-step detective challenge",description:"A voluntary shared creative assignment.",
          points:20,steps:[
            {id:"write",title:"Write the clue",instruction:"Record a descriptive clue for the detective.",
              requiresNote:true,timerMinutes:0},
            {id:"reflect",title:"Reflect on the result",instruction:"Write a brief scene reflection.",
              requiresNote:false,timerMinutes:0}
          ]}
      }
    })
    expect(advanced.status()).toBe(201)
    const taskId=(await advanced.json()).id
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-decision",sceneId:proposedId,id:taskId,accept:true}
    })).status()).toBe(403)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-decision",sceneId:proposedId,id:taskId,accept:true}
    })).status()).toBe(200)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-submit",sceneId:proposedId,id:taskId,note:"Too short"}
    })).status()).toBe(400)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-submit",sceneId:proposedId,id:taskId,note:"The first clue is hidden in the archive."}
    })).status()).toBe(200)
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-review",sceneId:proposedId,id:taskId,approve:true,note:"Clear"}
    })).status()).toBe(200)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-submit",sceneId:proposedId,id:taskId,note:"We found the answer together."}
    })).status()).toBe(200)
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"task-review",sceneId:proposedId,id:taskId,approve:true,note:"Good"}
    })).status()).toBe(200)

    const sent=await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"chat-send",sceneId:proposedId,message:"A private scene message."}
    })
    expect(sent.status()).toBe(201)
    const messageId=(await sent.json()).id
    const conversation=(await (await subPage.request.get("/api/scene-platform?view=chat&sceneId="+proposedId)).json())
    expect(conversation.messages.some((m:{id:string;body:string})=>m.id===messageId&&m.body==="A private scene message.")).toBe(true)
    expect(conversation.events.some((e:{event_type:string})=>e.event_type==="story.choice")).toBe(true)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"chat-edit",sceneId:proposedId,id:messageId,message:"Forged edit"}
    })).status()).toBe(403)
    expect((await domPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"chat-delete",sceneId:proposedId,id:messageId}
    })).status()).toBe(200)

    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"interest-save",items:[
        {interest:"Story games",level:4,public:true},{interest:"Communication",level:3,public:false}
      ]}
    })).status()).toBe(200)
    const interestView=(await (await domPage.request.get("/api/scene-platform?view=interests&sceneId="+proposedId)).json())
    expect(interestView.partner.some((v:{interest:string})=>v.interest==="Story games")).toBe(true)
    expect(interestView.partner.some((v:{interest:string})=>v.interest==="Communication")).toBe(false)
    expect((await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"safety-save",sceneId:proposedId,
        settings:{limits:["no-real-money","no-intimate-images"],shareLimits:true,aiOptIn:true,aftercare:"Take a short break"}}
    })).status()).toBe(200)
    expect((await domPage.request.get("/api/scene-platform?view=safety&sceneId="+proposedId)).then(r=>r.json())
      .then(v=>v.partnerLimits)).toContain("no-real-money")
    expect((await subPage.request.post("/api/scene-ai",{
      headers:{origin:apiOrigin},data:{sceneId:proposedId,kind:"story",
        prompt:"Suggest a non-explicit mystery puzzle for two cooperative players."}
    })).status()).toBe(503)
    const timer=await subPage.request.post("/api/scene-platform",{
      headers:{origin:apiOrigin},data:{action:"timer-start",sceneId:proposedId,label:"Self-reported voluntary focus"}
    })
    expect(timer.status()).toBe(201)
    const timerId=(await timer.json()).id
    for(const operation of ["timer-pause","timer-resume","timer-end"]){
      expect((await subPage.request.post("/api/scene-platform",{
        headers:{origin:apiOrigin},data:{action:operation,sceneId:proposedId,id:timerId}
      })).status()).toBe(200)
    }
    const stats=(await (await domPage.request.get("/api/scene-platform?view=analytics&sceneId="+proposedId)).json())
    expect(stats.counts.some((r:{event_type:string})=>r.event_type==="story.choice")).toBe(true)
    const balanceAfterPlatform=(await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    expect([balanceAfterPlatform.principal,balanceAfterPlatform.interest,balanceAfterPlatform.penalties])
      .toEqual([250000,0,0])
    await visit(domPage,"Overview")

    // Publish an original game and play it as both members of the approved scene.
    const creativeTitle = "Story_" + stamp
    await visit(domPage, "Story games")
    await domPage.getByRole("button", { name: /Create a game/ }).click()
    await domPage.getByLabel("GAME TITLE").fill(creativeTitle)
    await domPage.getByLabel("SHORT DESCRIPTION").fill("A collaborative mystery with a different ending every time.")
    await domPage.getByLabel("CATEGORY",{exact:true}).fill("Mystery")
    await domPage.getByLabel("RULES AND HOW TO PLAY").fill(
      "Each partner adds one scene-setting clue or a possible solution. Build on each other, never write a move for the other player. Either partner can finish the game."
    )
    await domPage.getByLabel("OPENING PROMPT (OPTIONAL)").fill("A locked letter appears on the doorstep.")
    await domPage.getByRole("button", { name: /Publish to Discover/ }).click()
    await expect(domPage.getByRole("status")).toContainText("published in Discover")
    const listResponse = await domPage.request.get("/api/games?view=library")
    expect(listResponse.status()).toBe(200)
    const game = (await listResponse.json()).games.find((g: {title:string}) => g.title === creativeTitle)
    expect(game).toBeTruthy()
    const forbiddenUnpublish = await subPage.request.post("/api/games", {
      headers: { origin: apiOrigin },
      data: { action: "publish", gameId: game.id, publish: false },
    })
    expect(forbiddenUnpublish.status()).toBe(404)

    const before = (await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    await visit(subPage, "Story games")
    await subPage.getByLabel("Search community games").fill(creativeTitle)
    await subPage.getByRole("button", { name: "Explore library" }).click()
    await subPage.getByRole("button", { name: "View game " + creativeTitle }).click()
    await expect(subPage.getByText("A locked letter appears on the doorstep.")).toBeVisible()
    await subPage.getByRole("button", { name: /Start with your partner/ }).click()
    await expect(subPage.getByRole("status")).toContainText("Game started")
    await subPage.getByLabel("Your game move").fill("I find a silver key.")
    await subPage.getByRole("button", { name: /Post move/ }).click()
    await expect(subPage.getByRole("status")).toContainText("Your move was added")

    await domPage.getByRole("button", { name: /Shared sessions/ }).click()
    await domPage.getByRole("button", { name: /Refresh game list/ }).click()
    await domPage.locator(".session-list-item").filter({hasText:creativeTitle}).click()
    await expect(domPage.getByText("I find a silver key.")).toBeVisible()
    await domPage.getByLabel("Your game move").fill("The key opens a hidden journal.")
    await domPage.getByRole("button", { name: /Post move/ }).click()
    await expect(domPage.getByRole("status")).toContainText("Your move was added")
    await subPage.getByRole("button", { name: /Refresh turns/ }).click()
    await expect(subPage.getByText("The key opens a hidden journal.")).toBeVisible()
    subPage.once("dialog", dialog => dialog.accept())
    await subPage.getByRole("button", { name: /Finish game/ }).click()
    await expect(subPage.getByRole("status")).toContainText("Game finished")
    await expect(subPage.getByLabel("Your game move")).toHaveCount(0)
    const after = (await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    expect([after.principal,after.interest,after.penalties]).toEqual([before.principal,before.interest,before.penalties])
    const toastVisibleHere = await subPage.getByRole("status").evaluate(element => {
      const rect=element.getBoundingClientRect()
      return rect.top>=0 && rect.bottom<=window.innerHeight
    })
    expect(toastVisibleHere).toBe(true)
    // Keep synthetic production test games out of the public library.
    const unpublish = await domPage.request.post("/api/games", {
      headers: { origin: apiOrigin },
      data: { action: "publish", gameId: game.id, publish: false },
    })
    expect(unpublish.status()).toBe(200)
    const hidden = await subPage.request.get("/api/games?view=library&q=" + creativeTitle)
    expect((await hidden.json()).games).toHaveLength(0)

    // Built-in branching adventures appear in Discover without a creator account.
    await subPage.getByRole("button",{name:/Discover games/}).click()
    await subPage.getByLabel("Search community games").fill("The Midnight Ledger")
    await subPage.getByRole("button",{name:"Explore library"}).click()
    await subPage.getByRole("button",{name:"View game The Midnight Ledger"}).click()
    await expect(subPage.locator(".game-inspector .eyebrow")).toContainText("OFFICIAL INTERACTIVE STORY")
    const storyBefore=(await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    await subPage.getByRole("button",{name:/Start with your partner/}).click()
    await expect(subPage.getByRole("status")).toContainText("Game started")
    const officialSessions=(await (await subPage.request.get("/api/games?view=sessions&sceneId="+proposedId)).json()).sessions
    const officialId=officialSessions.find((s:{title_snapshot:string})=>s.title_snapshot==="The Midnight Ledger").id
    await expect(subPage.getByText(/At midnight, the library clock/).first()).toBeVisible()
    await subPage.getByRole("button",{name:/Follow the torn receipt/}).click()
    await expect(subPage.getByRole("status")).toContainText("Choice saved")

    const repeated = await subPage.request.post("/api/games",{
      headers:{origin:apiOrigin},data:{action:"choice",sessionId:officialId,choiceId:"beat-0"}
    })
    expect(repeated.status()).toBe(409)
    const forged = await subPage.request.post("/api/games",{
      headers:{origin:apiOrigin},data:{action:"turn",sessionId:officialId,content:"Skip the whole adventure"}
    })
    expect(forged.status()).toBe(400)

    await domPage.getByRole("button",{name:/Shared sessions/}).click()
    await domPage.getByRole("button",{name:/Refresh game list/}).click()
    await domPage.locator(".session-list-item").filter({hasText:"The Midnight Ledger"}).click()
    await expect(domPage.getByText(/The receipt leads beneath/)).toBeVisible()
    await domPage.getByRole("button",{name:/Compare the secret records/}).click()
    await expect(domPage.getByRole("status")).toContainText("Choice saved")
    await subPage.getByRole("button",{name:/Refresh turns/}).click()
    await subPage.getByRole("button",{name:/Reveal the evidence to the court/}).click()
    await expect(subPage.getByText(/By dawn, the court sees/)).toBeVisible()
    await expect(subPage.getByText(/The end · Your shared adventure is saved/)).toBeVisible()
    const officialDone=(await (await subPage.request.get("/api/games?view=session&id="+officialId)).json())
    expect(officialDone.session.state).toBe("finished")
    expect(officialDone.turns).toHaveLength(3)
    expect(officialDone.story.complete).toBe(true)
    const storyAfter=(await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    expect([storyAfter.principal,storyAfter.interest,storyAfter.penalties])
      .toEqual([storyBefore.principal,storyBefore.interest,storyBefore.penalties])

    await visit(subPage, "Overview")

    // Payments require image evidence and Dom approval, even for direct API calls.
    await expect(subPage.getByRole("button", { name: "Apply credit" })).toHaveCount(0)
    const paymentForm = subPage.locator('.dash-card:has-text("Simulated payments") .proof-uploader')
    await expect(paymentForm.getByLabel("Simulated credit amount")).toHaveValue("15000")
    await expect(paymentForm.getByRole("button", { name: /Submit for review/ })).toBeDisabled()
    const scenesResponse = await subPage.request.get("/api/studio?view=scenes")
    expect(scenesResponse.status()).toBe(200)
    const originalScene = (await scenesResponse.json()).scenes[0]
    const sceneId = originalScene.id
    expect(sceneId).toBeTruthy()
    const noProofPayment = await subPage.request.post("/api/studio", {
      headers: { origin: apiOrigin },
      data: { action: "scene", sceneId, operation: "payment", amount: 15000 },
    })
    expect(noProofPayment.status()).toBe(409)
    expect((await noProofPayment.json()).error).toMatch(/photo proof and Dom approval/)
    const unchangedScene = (await (await subPage.request.get("/api/studio?view=scenes")).json()).scenes[0]
    expect([unchangedScene.principal,unchangedScene.interest,unchangedScene.penalties])
      .toEqual([originalScene.principal,originalScene.interest,originalScene.penalties])

    // Dom-only operation and cooldown: a second fee is rejected.
    await domPage.reload()
    await expect(domPage.getByRole("button", { name: /Agreed late fee/ })).toBeEnabled()
    await domPage.getByRole("button", { name: /Agreed late fee/ }).click()
    await expect(domPage.getByRole("status")).toContainText("Agreed late fee applied")
    await domPage.getByRole("button", { name: /Agreed late fee/ }).click()
    await expect(domPage.locator(".error-notice")).toContainText(/seven days/)

    // The sub cannot propose new terms, and the Dom cannot submit simulated payments.
    const illegalProposal = await subPage.request.post("/api/studio", {
      headers: { origin: apiOrigin },
      data: { action: "propose", connectionId: connection.id, principal: 100, monthlyRate: 1, weeklyTarget: 10, lateFee: 1 },
    })
    expect(illegalProposal.status()).toBe(403)
    const illegalPayment = await domPage.request.post("/api/studio", {
      headers: { origin: apiOrigin },
      data: { action: "scene", sceneId, operation: "payment", amount: 1000 },
    })
    expect(illegalPayment.status()).toBe(403)

    await subPage.reload()
    await visit(subPage, "Game room")
    // Game Room is intentionally quick-play only, not an embedded editor.
    await expect(subPage.locator(".contract-workshop")).toHaveCount(0)
    await expect(subPage.locator(".community-studio")).toHaveCount(0)
    await expect(subPage.getByRole("heading", { name: "Coin Flip" })).toBeVisible()
    await expect(subPage.getByRole("heading", { name: "High or Low" })).toBeVisible()
    await expect(subPage.getByRole("heading", { name: "Mystery Cards" })).toBeVisible()
    await expect(subPage.getByRole("heading", { name: "Vault Pick" })).toBeVisible()

    // Every quick game is resolved by the server and has its own cooldown.
    for (const [key,label] of [
      ["coin","Play Coin Flip"],["highlow","Play High or Low"],
      ["cards","Draw mystery card"],["vault","Play Vault Pick"]
    ] as const) {
      const card = subPage.locator(".quick-mini-card.theme-"+key)
      await card.getByRole("button", {name:label}).click()
      await expect(card.locator(".quick-mini-result")).toBeVisible()
      await expect(card.locator(".quick-mini-availability")).toContainText("Next round")
      const repeat = await subPage.request.post("/api/quick-games",{
        headers:{origin:apiOrigin},
        data:{sceneId,game:key,choice:key==="coin"?"heads":key==="highlow"?"high":key==="cards"?"draw":"1"}
      })
      expect(repeat.status()).toBe(429)
    }
    const quickStatus = await subPage.request.get("/api/quick-games?sceneId="+sceneId)
    expect(quickStatus.status()).toBe(200)
    expect((await quickStatus.json()).plays).toHaveLength(4)
    const illegalQuick = await domPage.request.post("/api/quick-games",{
      headers:{origin:apiOrigin}, data:{sceneId,game:"coin",choice:"heads"}
    })
    expect(illegalQuick.status()).toBe(403)

    await expect(subPage.getByRole("heading", { name: "Debt Dice" })).toBeVisible()
    await subPage.getByRole("button", { name: /Roll the dice/ }).click()
    await expect(subPage.getByRole("status")).toContainText("Rolled")
    await subPage.getByRole("button", { name: /Roll the dice/ }).click()
    await expect(subPage.locator(".error-notice")).toContainText(/24 hours/)

    await domPage.reload()
    await visit(domPage, "Game room")
    await domPage.getByRole("button", { name: "Issue challenge" }).click()
    await expect(domPage.getByRole("status")).toContainText("Challenge posted")

    await subPage.reload()
    await visit(subPage, "Game room")
    const quest = subPage.locator(".quest").filter({ hasText: "Balance audit" })
    await expect(quest).toBeVisible()
    await quest.getByRole("button", { name: "Complete" }).click()
    await expect(subPage.getByRole("status")).toContainText("Challenge completed")
    await expect(quest).toContainText("Completed")
    if(liveProofs){
      await domPage.getByRole("button",{name:"Issue challenge"}).click()
      await expect(domPage.locator(".action-toast")).toContainText("Challenge posted")
      await subPage.reload()
      await visit(subPage,"Game room")
      const nextChallenge=subPage.locator(".quest").filter({hasText:"Balance audit"}).filter({has:subPage.getByRole("button",{name:"Complete"})}).first()
      await expect(nextChallenge).toBeVisible()
      const form=nextChallenge.locator(".proof-uploader")
      await form.locator('input[type="file"]').setInputFiles({name:"synthetic-pixel.png",mimeType:"image/png",buffer:testPhoto})
      await form.getByRole("checkbox").check()
      await form.getByRole("button",{name:/Submit for review/}).click()
      await expect(subPage.locator(".action-toast")).toContainText("Private proof submitted")
      const second=await subPage.request.get("/api/studio?view=scene&id="+sceneId)
      const proofList=(await (await subPage.request.get("/api/proofs?sceneId="+sceneId)).json()).proofs
      const challengeProof=proofList.find((p:{kind:string})=>p.kind==="challenge")
      expect(challengeProof).toBeTruthy()
      const directComplete=await subPage.request.post("/api/studio",{
        headers:{origin:apiOrigin},
        data:{action:"complete",sceneId,challengeId:challengeProof.challenge_id}
      })
      expect(directComplete.status()).toBe(409)
      await domPage.reload()
      await visit(domPage,"Game room")
      const card=domPage.locator(".proof-center .proof-item").filter({hasText:"Challenge proof"}).first()
      await expect(card).toBeVisible()
      await card.getByRole("button",{name:"Approve proof"}).click()
      await expect(domPage.locator(".action-toast")).toContainText("Proof approved")
    }

    // Safe words are operational: either partner may pause or end, only the sub resumes.
    await domPage.reload()
    await domPage.getByRole("button", { name: "Stop scene", exact:true }).click()
    await expect(domPage.getByRole("status")).toContainText("Scene paused")
    await subPage.reload()
    await expect(subPage.getByRole("button", { name: /Resume with consent/ })).toBeVisible()
    await subPage.getByRole("button", { name: /Resume with consent/ }).click()
    await expect(subPage.getByRole("status")).toContainText("Scene resumed")
    subPage.once("dialog", dialog => dialog.accept())
    await subPage.getByRole("button", { name: /End scene permanently/ }).click()
    await expect(subPage.getByRole("status")).toContainText("Scene ended")
    const afterEnd = await subPage.request.post("/api/studio", {
      headers: { origin: apiOrigin },
      data: { action: "scene", sceneId, operation: "payment", amount: 100 },
    })
    expect(afterEnd.status()).toBe(409)

    await visit(subPage, "Connections")
    const domConnection = subPage.locator(".person").filter({ hasText: "@" + domHandle })
    subPage.once("dialog", dialog => dialog.accept())
    await domConnection.getByRole("button", { name: "Block" }).click()
    await expect(subPage.getByRole("status")).toContainText("Connection blocked")
    // A blocked ex-partner cannot keep downloading the private accepted agreement.
    expect((await domPage.request.get("/api/contracts/pdf?sceneId="+sceneId)).status()).toBe(404)
    await visit(domPage, "Discover")
    await domPage.getByPlaceholder(/Search sub handles or bios/).fill(subHandle)
    await domPage.getByRole("button", { name: "Search", exact: true }).click()
    await expect(domPage.locator(".person").filter({ hasText: "@" + subHandle })).toHaveCount(0)
  } finally {
    await dom.context.close()
    await sub.context.close()
  }
})

test("public routes load; unauthenticated studio operations are denied", async ({ page, request }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: /Make the rules/ })).toBeVisible()
  await page.getByRole("link", { name: /Try solo simulator/ }).click()
  await expect(page.getByRole("heading", { name: /Debt Servitude Agreement/ }).first()).toBeVisible()
  const health = await request.get("/api/health")
  expect(health.status()).toBe(200)
  expect((await health.json()).status).toBe("ready")
  expect((await request.get("/api/studio?view=connections")).status()).toBe(401)
  expect((await request.get("/api/contracts/pdf?sceneId=11111111-1111-4111-8111-111111111111")).status()).toBe(401)
  expect((await request.post("/api/studio", { data: { action: "profile" } })).status()).toBe(403)
  const blocked = await request.post("/api/studio", {
    headers: { origin: apiOrigin }, data: { action: "profile" },
  })
  expect(blocked.status()).toBe(401)
  expect((await request.get("/api/scene-platform?view=library")).status()).toBe(401)
  expect((await request.get("/api/scene-ai")).status()).toBe(401)
  expect((await request.post("/api/scene-platform",{headers:{origin:apiOrigin},
    data:{action:"chat-send",sceneId:"11111111-1111-4111-8111-111111111111",message:"hello"}})).status()).toBe(401)
    expect((await request.get("/api/games?view=library")).status()).toBe(401)
  expect((await request.get("/api/proofs?sceneId=11111111-1111-4111-8111-111111111111")).status()).toBe(401)
  expect((await request.post("/api/proofs",{headers:{origin:apiOrigin},multipart:{sceneId:"11111111-1111-4111-8111-111111111111"}})).status()).toBe(401)
  expect((await request.patch("/api/proofs",{headers:{origin:apiOrigin},data:{id:"11111111-1111-4111-8111-111111111111",approve:true}})).status()).toBe(401)

  expect((await request.get("/api/quick-games?sceneId=123")).status()).toBe(401)
  expect((await request.post("/api/quick-games", {data:{game:"coin",choice:"heads"}})).status()).toBe(403)
  expect((await request.post("/api/games", {data: {action:"create"}})).status()).toBe(403)

  // Authentication must reject cross-origin signup requests (CSRF).
  const crossSiteSignup = await request.post("/api/auth/sign-up/email", {
    headers: { origin: "https://untrusted-attacker.example" },
    data: { email: `e2e-untrusted-${stamp}@example.invalid`, name: "untrusted", password },
  })
  expect(crossSiteSignup.status()).toBe(403)
})
