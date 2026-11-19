# Velvet Ledger

**An 18+ consent-first fantasy debt and roleplay studio.** Next.js App Router, Better Auth, PostgreSQL, and server-side game mechanics. All balances are imaginary LKR figures; no real money is received, held, or transferred.

## AI Dom MCP gateway (opt-in)

A disclosed system AI Dom can be connected to an adult Sub's proposed, explicitly approved
scene. The Sub's **AI Dom** dashboard tab creates/disables AI scenes; a private
Streamable HTTP MCP gateway at `/api/mcp` exposes only scene-scoped chat,
optional text tasks and approved branching-story actions to trusted external
orchestrators. It cannot consent for the Sub, access proof files, modify fictional
balances, or make real payments. The MCP server does **not** run an AI model or
automatically reply by itself.

See **[docs/ai-dom-mcp.md](docs/ai-dom-mcp.md)** for setup, security, tool
definitions and required agent-runner integration.

## Features

## Community Campaigns (one Dom → many Subs)

**Campaigns** is an additive workspace alongside private Contracts, Story games and the
Game room. It uses an independent campaign ledger, never the one-to-one scene
balance. Every unit labelled LKR is **fictional**. No payment service, card
charge, bank connection, debt obligation, or real transfer exists.

Five authorable types are supported:

- **Open tribute:** voluntary fictional contributions without a required goal.
- **Goal:** collective fictional target and milestone notifications.
- **Challenge:** creator-reviewed tasks, private evidence, games and points.
- **Competition:** opt-in non-anonymous leaderboard based on verified points/contributions.
- **Timed event:** scheduled start/end; enrollment can happen ahead of the start.

### Creator workflow

1. Complete an adult Dom profile and open **Campaigns → Create**.
2. Choose type, public/unlisted/restricted visibility, open/approval/invite
   participation, dates, category and preset interest labels.
3. Configure explicit boundaries, fictional limits (per action, per person, member
   capacity), optional proof review, anonymity, leaderboards and comments.
4. Add milestone thresholds and tasks, chance games or polls.
5. Save a draft; optionally upload a private-Blob-backed, re-encoded WebP cover
   from the draft detail; then publish.
6. Approve join requests or invite discoverable Subs by handle; review
   contributions and tasks and moderate comments.
7. Publish announcements (followers/members receive in-app notifications),
   pause/resume or close. Published terms cannot be silently edited.

### Participant workflow

1. Discover public campaigns using text/type/preset-interest filters, or
   follow a direct link to an unlisted campaign; view the creator profile and terms.
2. Request access, accept an invitation, or join directly based on campaign rules.
   Choose optional anonymous display, leaderboard participation, and a personal
   fictional cap **before** consenting. No private connection is required.
3. Contribute voluntary fictional units within caps. If evidence is required,
   the submission remains pending until private proof upload and creator review.
4. Submit tasks with private proof, play secure-random coin/dice/wheel games
   with cooldowns, and vote once in polls. Campaign points never alter scene debt.
5. Follow updates, comment, react, report abuse, or leave at any time.
   No fees or penalties apply for declining or leaving.

### Privacy and limits

- Adult authentication and role checks are server-side; invitations require
  a discoverable, adult Sub profile. Existing account blocks are respected.
- Restricted campaigns are accessible only to their creator and invited,
  pending or active members. Unlisted campaigns need a direct link.
- Personal contributions, task reports, proof files and review notes are
  visible only to their creator and submitter. Leaderboards require explicit
  opt-in and exclude anonymous participants.
- Evidence uses the existing **Private** Vercel Blob integration. Images are
  re-encoded to WebP with metadata removed; PDFs are download-only.
  Files are uploader-erasable, with minimal audit metadata retained.
  Campaign covers are served through an authenticated no-cache proxy.
- Server-side rate limits, per-person contribution caps, transaction locks and
  contribution request-ID idempotency prevent duplicate or unbounded credits.
  Task approval awards separate, non-monetary points once.
- Notifications are in-app rather than offline push.
- Existing one-to-one scene permissions, contract ledger, private proofs,
  consent states and partner chat are unchanged.

Run the project's existing npm test, npm run typecheck, npm run build and
npm run test:e2e checks. Added unit coverage in tests/campaigns.test.ts and
live browser journeys in e2e/campaigns.spec.ts.


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
- Five first-party interactive story games appear in Story games → Discover: **The Midnight Ledger**, **Escape the Velvet Vault**, **The Crimson Court**, **Neon City Courier** and **The Secret Auction**. They use three server-validated branching choices, alternating partner turns and automatically saved endings; no fictional ledger changes.
- Game sessions preserve the original rules, support both participants' free-form turns, and can be finished by either partner. Game moves never change the fictional ledger
- Fixed-position action toasts show immediate progress, success and errors even when scrolled to the bottom of the dashboard
- Multiplayer Debt Dice (server-side RNG, 24-hour cooldown), cooperative challenge board, payoff simulator
- Standalone solo simulator at `/sandbox`, retained from v1 with generic example characters
- **Activity hub** unifies private notifications, cross-scene activity analytics, recurring rituals, a review queue, independent points and agreed non-monetary rewards, a read-only ledger forecast, optional acknowledgement, and allowlisted maintenance.
- **Notifications** are created from committed events for invitations, scene proposals, contract claims, proof reviews, story turns and endings, ritual actions and reward requests. The unread bell polls when the app is open. Browser alerts are explicitly opt-in and in-tab only (not offline push notifications), with sensitive details hidden from the alert.
- **Rituals** are proposed by the Dom, activated only after the Sub opts in, and evaluated in an explicit IANA timezone. A scheduled occurrence appears when a participant opens its scene on that local date. The Sub may pause; only the Sub can re-activate. Missed rituals never charge balances. Optional private non-explicit photo evidence goes through the existing proof storage and review policy.
- **Review queue** aggregates pending proofs, contract task claims, and scheduled ritual submissions for one authorized scene. Bulk actions reuse individual server authorization and balance-safety checks and return partial failures; attached proof must be reviewed through the proof endpoint.
- **Points & rewards** use their own event ledger. Verified actions and eligible completed stories award bounded points; Dom-defined voluntary rewards can be redeemed by the Sub, then fulfilled or declined/refunded. Points cannot be converted into money or fictional debt credits.
- **Forecast** is a read-only 1–52 week scenario. Extra weekly credits, hypothetical fees and monthly interest are explicit what-if inputs; forecasts **never** schedule or apply charges. **Agreement acknowledgment** records an optional typed personal name only after reading clauses; it is appended to the accepted PDF but cannot replace scene consent.
- **Maintenance** can be enabled for configured account emails only: a dry-run checks up to 1,000 private proof blobs, and explicit cleanup can remove at most 25 unreferenced objects older than 48 hours, with an audit record.

This is roleplay software, not a financial service. It does **not** create an enforceable debt or legal agreement.


## Scene Platform v3: contracts + games + stories in one experience

This release is additive. Existing agreements, public story games, lock status records, the Proof Center and fictional payments continue through their existing endpoints.

- **Shared event stream:** `scene_events` captures server-authenticated ledger events, contract claims, private proof status, story turns, points and rituals. New narratives, task steps, chat and consent actions join the same per-scene stream. Events include minimal summaries, not private proof/chat content. The capability registry in `lib/scene-platform.ts` deliberately has no direct ledger-write capability.
- **Branching Story Builder:** Story games → Branching story builder. Authors create up to 24 linked chapters, conditional choices, flags, bounded game-point awards and optional task proposals. Published playbooks are immutable snapshots **per approved session**. The other partner must accept before choices begin. Participants alternate moves, and anyone can stop the story.
- **Advanced tasks:** Partner space → Advanced tasks. Up to eight ordered steps with optional timers and private text reports. Tasks are proposed and accepted by different partners. A Sub submits each step; the Dom approves or returns it. Completing a task awards separate points, not fictional debt credits. Either the proposing participant or the Sub can cancel without penalty.
- **Private text chat:** Partner space → Partner chat. Authenticated scene participants only; new messages require an active scene, deletions are author-only, edits are limited to 15 minutes. A shared system-activity feed is visible alongside messages. This server-private chat is **not end-to-end encrypted**. It is not ingested by the AI service.
- **Consent & safety:** Personal limits, optional partner-visible limits, private comfort notes, explicit AI opt-in and repeatable consent check-ins. **Stop scene** is visible globally for active scenes. It pauses scene activity immediately and finishes personal session timers without charging debt or points. Existing Sub-only consent-to-resume remains authoritative.
- **Personal tracking:** Voluntary self-reported timers with pause/resume/end and duration history. No physical-device control, forced unlocking or hardware access restrictions.
- **Insights & interests:** Scene activity heatmap, event counts, CSV export without private text/media and preset-only interest levels. Individual interest visibility defaults to private.
- **Optional AI creative assistant:** Uses a configured OpenAI-compatible `chat/completions` endpoint to provide *suggestions only*. Not available until enabled in scene safety settings. Only the explicitly typed prompt is sent; never chat history, proof files, private preferences or contract balances. 15 requests/user per 24 hours. No AI-invoked scene mutations.
- **Installable PWA:** Public manifest and offline fallback, plus an opt-in device-local story draft. Private API responses, partner messages, contract data and proof images are never service-worker cached. Any agreement, game choice, ledger action or task approval still requires the server.
- **Proof UX:** Existing private, non-explicit photo evidence upload now supports drag/drop, file previews and an enlarged review view. Payments still support PDF uploads.

### Optional AI provider variables

```dotenv
SCENE_AI_BASE_URL=https://your-openai-compatible-provider.example/v1
SCENE_AI_MODEL=your-model
SCENE_AI_API_KEY=your-secret
```

Leaving these unset disables the AI capability. Set them only on the server. The application does not ship with a paid or default AI provider.

### Verification and release safety

Run `npm test`, `npm run typecheck`, `npm run build` (with PostgreSQL for migrations) and `npm run test:e2e`. The full multiplayer journey tests story approval, irreversible published-session snapshots, limited points, partner roles, task-step approval, chat privacy, consent and balance isolation.

The code from external projects was not copied wholesale: their stacks, licenses and device-control assumptions do not apply to our consent-first, fictional-only product.

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

For administrative proof cleanup, optionally set `DEBT_ADMIN_EMAILS` to a comma-separated list of exact authenticated account email addresses (empty disables maintenance). Use Vercel's Blob integration to provide `BLOB_READ_WRITE_TOKEN` for the existing private proof storage. Never commit those secrets. No extra environment value is needed for ordinary activity hub features.

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
- Community-created games support flexible human-written rules and manually entered turns; the five curated examples use a fixed branching-choice engine instead. Neither mode executes arbitrary code, automatically scores debts, or delivers real-time chat. Players can refresh turns to see their partner's updates.
- This prototype uses **self-declared** adult status, not independently verified age; it also does not yet provide email-based password recovery or automated account deletion. Those are important before promoting the service broadly.
- Never record real banking details, addresses, private images or intimate information in profile bios.

## Background

The original project terms (fictional LKR 250,000 initial principal, 12% monthly interest, LKR 15,000 weekly target and a LKR 5,000 late fee) serve as **editable example defaults**, not obligations. Personal names and locations from the project background are intentionally excluded from the public application.

## Interactive debt contracts (first release)
Go to **Game room → Contract builder**, configure fictional starting terms, then add one or more game modules (up to eight). Dice Duels roll against a server-generated rival and credit or charge the point difference. Fortune Wheels select uniformly from user-defined outcomes. Check-ins earn agreed fantasy credits. Tasks require Sub submission and Dom approval before the credit is applied.

Templates can be published, discovered and adapted by anyone with an adult profile. Only Dom accounts propose a configured contract to an active connection; the Sub must explicitly approve it. Paused and ended scenes reject module actions. All amounts are imaginary and no real money moves.

Module cooldowns use server time; zero cooldown is available for dice/wheels but a 40-action-per-day safety cap still applies. Charges are capped, all outcomes are server-generated, and actions are logged. No arbitrary user code, external payments, background punishments or public visitor control is implemented. This is not a legal debt contract or financial service.

## Private proof files

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
non-explicit payment proof image (JPEG, PNG, WebP; max 3 MB) or PDF (max 4 MB).
The Dom downloads PDFs through an authenticated, no-cache endpoint;
PDFs are forced downloads, not rendered inline. The Dom must approve the submission before
the fictional balance changes; there is no direct Apply credit button. From **Game room**, a Sub may attach evidence for
an open challenge. The connected Dom reviews evidence in **Proof Center**.

- Only approved, active scene participants can upload. Only the uploader and
  connected partner may view the image; ex-partners lose access. Uploaders retain
  access to delete their own photos after ending a connection.
- Images are limited to 3 MB, decoded and re-encoded as WebP to remove
  image metadata. Payment PDFs are limited to 4 MB and checked for basic PDF
  structure; unlike images, PDFs retain their original contents and metadata.
  PDF files are download-only to avoid executing untrusted content in-page.
  Daily and pending-submission rate limits still apply.
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
  Previously manually reported lock states remain visible but are labelled unverified
  if no Dom-approved lock request is recorded. Historical data is not silently erased.
  The lock card refreshes partner decisions automatically while the page is active.
  If an older tab is open when a new release ships, the dashboard offers a refresh.
  If a photo has been attached to a task or challenge, review must happen through
  Proof Center rather than bypassing the attachment.
- Only the uploader can erase the private Blob image. A small audit record and
  any settled fictional ledger event remain, without the image's Blob pathname.

The API never returns a raw Blob URL; private proof files are streamed through an
authenticated, no-cache endpoint. The server upload is deliberately capped
below Vercel Functions' request-size limit. If the store was created as
**Public**, create/connect a **Private** store before using this feature.


## Mutually accepted contract PDF

When a Dom proposes an interactive contract and the Sub accepts it, both participants
can select **Download accepted contract (PDF)** from **Contracts → My contracts**.
For a basic ledger agreement created through **Connections**, both participants
can select **Download agreed terms (PDF)** in **Overview** after acceptance.
Basic documents include the original fictional terms and consent conditions and
explicitly state that no custom interactive game modules were part of the agreement.
The authenticated PDF shows both user handles and the in-app acceptance timestamp,
the original fictional ledger terms, agreement description and category, every
configured game/module and its exact options (including wheel outcomes, random
weights, task rewards, cooldowns, check-ins, lock-status review, and consent rules).

- The PDF is generated on demand from the **original accepted snapshot**, not a
  later edited template or changing balance.
- The document is accessible only to contract participants, after acceptance.
  Proposals cannot be downloaded as accepted agreements.
- The PDF is a private, non-cacheable download. It is an in-app consent record,
  **not a legally binding contract**, verified signature, or real financial debt.
- Ending participation does not make the agreement enforceable or remove either
  person's right to withdraw consent.

## Member showcases

Visit **My profile → Personal showcase** to edit a display name, headline, likes,
dislikes, dedication, and voluntary boundaries. Members can preview their own
showcase. Four independent sharing controls allow adult account holders to
choose whether to reveal the showcase, aggregated statistics, earned achievements
and broad recent activity (date only). Sharing is **off by default**. Discovery
must also be enabled for other members to see the showcase.

- Adults can select **View profile** from **Discover** before inviting a partner,
  or view an opt-in /u/{handle} page when signed in.
- Achievements and statistics are computed from recorded application events and
  cannot be directly edited or self-awarded. No email addresses, partner handles,
  balances, private notes, or documents are included in showcase responses.
- Users can turn off sharing at any time; blocked accounts cannot view one
  another's showcases. No public anonymous directory is created.
- Profile likes, dislikes, dedication and boundaries are **self-reported**;
  earned badges reflect only recorded application actions, not personal identity.

## Redesigned member profiles and Discover preview

The profile view uses a cover header, large member identity, overview/statistics,
activity timeline, and earned-achievement tabs. It shows optional interests,
dislikes, dedication and boundaries in visually distinct cards. The same layout
appears as the owner's live preview in **My profile**.

**Discover → View profile** opens the member's profile in an accessible in-page
preview, with **Back to results** and **Send invitation** actions; no navigation
away from Discover is needed. Direct invitations remain available from results.
Only a complementary adult role can be invited, and an invitation does not
start a contract until the other account accepts.

Any discoverable member can be previewed. When their extended showcase is off,
the preview returns only their existing public handle, role and account bio.
Private likes, dislikes, dedication, boundaries, statistics and activity are
never exposed. The public profile route /u/{handle} uses the same privacy rules.

## Predefined likes/dislikes and Discover matching

Under **My profile → Personal showcase**, likes and dislikes are selected from
a fixed, searchable, categorized catalog. Users cannot create arbitrary labels,
and the same label cannot be both liked and disliked. The catalog covers
communication, games, consensual dynamics, and lifestyle interests. Previously
stored free-text labels outside the catalog are ignored when displaying choices;
members can reselect from the available catalog and save.

Discover has a **Match by likes** filter using the same preset labels. Select
up to eight labels; results must match **all** selected labels. Free-text
handle/bio search can be combined with the filters. Results show only public
likes from adult members who have enabled both discoverability and their
showcase; private or unpublished interests cannot be used to match members.
The API rejects unknown labels and uses a JSONB GIN index for lookup.
