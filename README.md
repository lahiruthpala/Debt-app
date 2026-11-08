# Velvet Ledger

**An 18+ consent-first fantasy debt and roleplay studio.** Next.js App Router, Better Auth, PostgreSQL, and server-side game mechanics. All balances are imaginary LKR figures; no real money is received, held, or transferred.

## Features

- Dom / sub email-and-password accounts with private email addresses and public handles
- 18+ self-attestation, optional opt-in discovery, role-filtered profile search
- Private invitations, recipient approval/decline, block and disconnect
- Dom-proposed terms that **only activate with the sub's explicit approval**
- Either party can pause or permanently end a scene at any time; only the sub may resume
- Persistent audit trail, penalties → interest → principal payment allocation
- Monthly compounded interest and weekly late fees are **manual** actions with cooldowns
- Interactive Contract Workshop: configure Dice Duel, Fortune Wheel, **weighted Random Events**, recurring Check-ins (with optional agreed late penalty), and verified Tasks. Customize probabilities, fictional credits/penalties, and cooldowns.
- **Private Contract Atelier** adds proof-backed, Dom-reviewed lock status, unlock requests, optional permission-status counters, text-only partner check-ins, private journals and agreed calendar windows. Nothing controls physical devices, requires intimate photos, or collects real payments.
- New modules are included across all 20 first-party published templates, which retain server validation and mutually accepted snapshots. Live preview includes a visual intensity meter and explicit consent preview.
- Self-reported personal data and journal entries can be erased by their author even after a contract ends. Audit metadata (without journal content) remains. No penalties apply for unlocking, declining an inspection, or withdrawing consent.
- Publish or keep contract templates private; discover and customize community templates, then propose one to an accepted connection. The Sub must explicitly approve the terms before gameplay and may always pause/end the scene
- Game effects are calculated and audited server-side (including limits), and every contract snapshots its terms and modules so template edits cannot retroactively alter agreements. Random events are **manually triggered** when available; this version does not execute unattended background events or charges.
- Separate **Contracts** workspace (contract builder, official/community template discovery, personal templates and live contracts), and **Story games** workspace (discover, author/publish and play collaborative stories)
- Focused **Game room** with seven instant games/tools: Debt Dice, Payoff Lab, Challenge Board, Coin Flip, High/Low, Mystery Cards and Vault Pick
- Four new 24-hour-cooldown quick games use server-side secure random outcomes and log fictional credits/penalties; the Sub explicitly starts each balance-changing mini-game
- Community Game Studio: write original rules and opening prompts, save drafts, publish to Discover, edit/unpublish your games, and play collaborative turn-based sessions inside approved scenes
- Game sessions preserve the original rules, support both participants' free-form turns, and can be finished by either partner. Game moves never change the fictional ledger
- Fixed-position action toasts show immediate progress, success and errors even when scrolled to the bottom of the dashboard
- Multiplayer Debt Dice (server-side RNG, 24-hour cooldown), cooperative challenge board, payoff simulator
- Standalone solo simulator at `/sandbox`, retained from v1 with generic example characters

This is roleplay software, not a financial service. It does **not** create an enforceable debt or legal agreement.

## Local development

Requires Node.js 22+, a PostgreSQL database (e.g. Neon), and these environment variables:

```bash
cp .env.example .env.local
# Populate DATABASE_URL and BETTER_AUTH_SECRET; never commit real values
npm install
# Set DATABASE_URL in the shell for the migration command (or source .env.local)
npm run db:migrate
npm run dev
```

Visit http://localhost:3000. The first account may choose either role. A Dom and a sub create separate accounts, opt into discovery, connect by invitation, then propose/approve a scene.

## Vercel production setup

The GitHub repository `lahiruthpala/Debt-app` is connected to `https://debt-app-ivory.vercel.app`.

1. In **Vercel → project debt-app → Storage / Marketplace**, provision and link a **Neon Postgres** database to Production (and Preview if desired). Ensure the project receives a **pooled** `DATABASE_URL`. A Vercel deployment alone does not provide a persistent database.
2. In project **Environment Variables**, add `BETTER_AUTH_SECRET` as a long randomly generated secret. Set `BETTER_AUTH_URL=https://debt-app-ivory.vercel.app` in **Production** only; leave it unset for Preview.
3. Redeploy the production branch. `npm run build` runs the idempotent `db/schema.sql` migration first, then `next build`. No database URL means the migration is skipped and account features return a configuration error, while public pages and the solo demo continue to work.
4. Verify `/api/auth/ok` and register two test accounts, then exercise discovery, invitation, approval, ledger and games.

The migration adds Better Auth's standard email/password tables and app-specific profiles, connections, scenes, challenges and ledger entries. If Better Auth's default schema changes after a dependency upgrade, run its official migration CLI and review the generated changes before deployment.

## Developer checks

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Playwright runs in Chromium against a real Next.js server. On every GitHub push, the CI job
starts disposable PostgreSQL 16, runs schema migrations and a production build, and
executes browser tests for both roles, sign-up/sign-in, discovery/invitations, consent,
ledger updates, challenges, Debt Dice, pause/resume, termination and blocking.\nThe expanded journey also covers separated Contracts/Story games navigation, quick-play game outcomes, cooldown and permission enforcement, publishing custom games, creator authorization, discovery,\nshared turns, game completion and confirming balances are unaffected.
Failures upload screenshots, Playwright traces and the HTML report to Actions artifacts.

Locally, set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=http://127.0.0.1:3000`,
run `npm run build`, install Chromium with `npx playwright install chromium` and run
`npm run test:e2e`. Playwright starts `npm run start` automatically.

The health check at `GET /api/health` returns `{"status":"ready"}` only with
the required server configuration and initialized tables. If Vercel signup
is unavailable, check this endpoint first. The CI database is **not** the production database.

## Data and safety

- Email is used to authenticate; it is **never** returned by search. Profiles appear only when users opt into discovery.
- The role is locked after profile creation. Handles and public bios can be edited.
- Accepted connection is required before a scene can be proposed; a separate sub approval is required to activate it.
- All scene writes are server-authenticated, validated, and scoped to participants. Ledger mutations use row locks and transactions.
- Blocking ends active scenes and prevents future invitations from that account. Scene termination never requires the other party's approval.
- All balances are **fictional**. Payment credits require non-explicit photo evidence and Dom approval; no money is sent or transferred.
- Public game content is user-authored text, displayed as escaped text, not executable code. Game sessions are restricted to approved scene participants; a paused scene rejects new moves. Publication changes are creator-only and game reports are recorded for review.
- Community games currently support flexible human-written rules and manually entered turns, not arbitrary executable rule engines, automatic scoring, or real-time chat delivery. Players can refresh turns to see their partner's updates.
- This prototype uses **self-declared** adult status, not independently verified age; it also does not yet provide email-based password recovery or automated account deletion. Those are important before promoting the service broadly.
- Never record real banking details, addresses, private images or intimate information in profile bios.

## Background

The original project terms (fictional LKR 250,000 initial principal, 12% monthly interest, LKR 15,000 weekly target and a LKR 5,000 late fee) serve as **editable example defaults**, not obligations. Personal names and locations from the project background are intentionally excluded from the public application.

## Interactive debt contracts (first release)
Go to **Game room → Contract builder**, configure fictional starting terms, then add one or more game modules (up to eight). Dice Duels roll against a server-generated rival and credit or charge the point difference. Fortune Wheels select uniformly from user-defined outcomes. Check-ins earn agreed fantasy credits. Tasks require Sub submission and Dom approval before the credit is applied.

Templates can be published, discovered and adapted by anyone with an adult profile. Only Dom accounts propose a configured contract to an active connection; the Sub must explicitly approve it. Paused and ended scenes reject module actions. All amounts are imaginary and no real money moves.

Module cooldowns use server time; zero cooldown is available for dice/wheels but a 40-action-per-day safety cap still applies. Charges are capped, all outcomes are server-generated, and actions are logged. No arbitrary user code, external payments, background punishments or public visitor control is implemented. This is not a legal debt contract or financial service.

## Private photo proofs

Connect a **Private** Vercel Blob store to this project. The store must provide
`BLOB_READ_WRITE_TOKEN` or project-scoped Vercel Blob OIDC access at runtime.
**A public Blob store is intentionally unsupported** because proof images may
contain sensitive personal information. Do not place Blob credentials in client code.

From **Contracts → My contracts**, a Sub uploads a non-explicit JPEG, PNG or
WebP photo before Request lock becomes enabled. Upload alone does not mark
anything locked: pressing Request lock links the photo to a pending request.
The Dom approves or declines it in Proof Center; only approval sets the
self-reported status to locked. Subs can request unlock review, and Dom
approval clears the reported status. Task images remain optional.
From **Overview**, a Sub enters the simulated credit amount and attaches a
non-explicit payment proof image. The Dom must approve the submission before
the fictional balance changes; there is no direct Apply credit button. From **Game room**, a Sub may attach evidence for
an open challenge. The connected Dom reviews photos in **Proof Center**.

- Only approved, active scene participants can upload. Only the uploader and
  connected partner may view the image; ex-partners lose access. Uploaders retain
  access to delete their own photos after ending a connection.
- Each image is limited to 3 MB, decoded and re-encoded as WebP to remove
  image metadata; there are daily and pending-submission rate limits.
- The Sub confirms consent and that the photo is non-explicit. Do not upload
  intimate images, IDs, address details, or images of anyone without permission.
- Approval of a photo-backed task, challenge, or simulated payment applies the
  corresponding fictional credit **once**; rejecting an upload applies nothing.
  Lock evidence updates self-reported status only after Dom approval; it never
  imposes penalties or restricts someone's ability to physically unlock, pause,
  end the scene, or erase their private status data.
- Direct no-photo payments are rejected by the API. Task completions retain
  their existing behavior.
  Lock requests display a three-step progress panel (photo, request, Dom review).
  The lock card refreshes partner decisions automatically while the page is active.
  If an older tab is open when a new release ships, the dashboard offers a refresh.
  If a photo has been attached to a task or challenge, review must happen through
  Proof Center rather than bypassing the attachment.
- Only the uploader can erase the private Blob image. A small audit record and
  any settled fictional ledger event remain, without the image's Blob pathname.

The API never returns a raw Blob URL; images are streamed through an
authenticated, no-cache endpoint. The server upload is deliberately capped
below Vercel Functions' request-size limit. If the store was created as
**Public**, create/connect a **Private** store before using this feature.
