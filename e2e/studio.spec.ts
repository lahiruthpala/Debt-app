import { expect, test, type Browser, type Page } from "@playwright/test"

const id = () => Math.random().toString(36).slice(2, 10)
const stamp = id()
const password = "E2eTestPass!2026"

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
      headers: { origin: "http://127.0.0.1:3000" },
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

    // All simulated credits are recorded, never real payments.
    await subPage.getByRole("button", { name: "Apply credit" }).click()
    await expect(subPage.locator(".big-balance")).toHaveText("LKR 235,000")
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
      headers: { origin: "http://127.0.0.1:3000" },
      data: { action: "propose", connectionId: connection.id, principal: 100, monthlyRate: 1, weeklyTarget: 10, lateFee: 1 },
    })
    expect(illegalProposal.status()).toBe(403)
    const illegalPayment = await domPage.request.post("/api/studio", {
      headers: { origin: "http://127.0.0.1:3000" },
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
      headers: { origin: "http://127.0.0.1:3000" },
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
    headers: { origin: "http://127.0.0.1:3000" }, data: { action: "profile" },
  })
  expect(blocked.status()).toBe(401)
})
