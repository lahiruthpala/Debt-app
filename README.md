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
ledger updates, challenges, Debt Dice, pause/resume, termination and blocking.
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
- All balances are **fictional**. Pressing "payment" only records imaginary credits and cannot send money.
- This prototype uses **self-declared** adult status, not independently verified age; it also does not yet provide email-based password recovery or automated account deletion. Those are important before promoting the service broadly.
- Never record real banking details, addresses, private images or intimate information in profile bios.

## Background

The original project terms (fictional LKR 250,000 initial principal, 12% monthly interest, LKR 15,000 weekly target and a LKR 5,000 late fee) serve as **editable example defaults**, not obligations. Personal names and locations from the project background are intentionally excluded from the public application.
