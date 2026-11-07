import { expect, test, type Browser, type Page } from "@playwright/test"

const id = () => Math.random().toString(36).slice(2, 10)
const stamp = id()
const password = "E2eTestPass!2026"
const apiOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000").origin

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
  await page.getByRole("button", { name: /Create my account/ }).click()
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
    await target.getByRole("button", { name: /Invite/ }).click()
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

    await subPage.reload()
    await expect(subPage.getByRole("button", { name: "Approve & begin scene" })).toBeVisible()
    await subPage.getByRole("button", { name: "Approve & begin scene" }).click()
    await expect(subPage.getByRole("status")).toContainText("Scene activated")
    await expect(subPage.locator(".big-balance")).toHaveText("LKR 250,000")

    // Publish an original game and play it as both members of the approved scene.
    const creativeTitle = "Story_" + stamp
    await visit(domPage, "Game room")
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
    await visit(subPage, "Game room")
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
    await visit(subPage, "Overview")

    // All simulated credits are recorded, never real payments.
    await subPage.getByRole("button", { name: "Apply credit" }).click()
    await expect(subPage.getByRole("status")).toContainText("Applied 15,000 simulated credits")
    await expect(subPage.locator(".big-balance")).toHaveText("LKR 235,000", { timeout: 30_000 })
    await expect(subPage.getByText(/Fictional payment credit applied/)).toBeVisible()
    const scenesResponse = await subPage.request.get("/api/studio?view=scenes")
    expect(scenesResponse.status()).toBe(200)
    const sceneId = (await scenesResponse.json()).scenes[0].id
    expect(sceneId).toBeTruthy()

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

    // Safe words are operational: either partner may pause or end, only the sub resumes.
    await domPage.reload()
    await domPage.getByRole("button", { name: /Pause scene/ }).click()
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
  expect((await request.post("/api/studio", { data: { action: "profile" } })).status()).toBe(403)
  const blocked = await request.post("/api/studio", {
    headers: { origin: apiOrigin }, data: { action: "profile" },
  })
  expect(blocked.status()).toBe(401)
  expect((await request.get("/api/games?view=library")).status()).toBe(401)
  expect((await request.post("/api/games", {data: {action:"create"}})).status()).toBe(403)

  // Authentication must reject cross-origin signup requests (CSRF).
  const crossSiteSignup = await request.post("/api/auth/sign-up/email", {
    headers: { origin: "https://untrusted-attacker.example" },
    data: { email: `e2e-untrusted-${stamp}@example.invalid`, name: "untrusted", password },
  })
  expect(crossSiteSignup.status()).toBe(403)
})
