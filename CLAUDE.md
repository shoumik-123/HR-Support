# Veyra Talent — project notes for Claude

Read this instead of re-exploring the repo. Phases 1–3 are complete and pushed.

## Shape

pnpm monorepo. `apps/api` (NestJS 11, port 4000) · `apps/web` (Next.js 16 App Router, port 3000) ·
`scripts/dev-db.mjs` (embedded-postgres, port 5433 — no Docker on this machine).

Prisma 7, `prisma-client` generator → `apps/api/src/generated/prisma`, `@prisma/adapter-pg`.
`prisma.config.ts` calls `process.loadEnvFile(".env")` (Prisma 7 does not read `.env` itself).
`tsconfig.json` needs `rewriteRelativeImportExtensions: true`.

## Start it (3 terminals, from repo root unless noted)

```
node scripts/dev-db.mjs                 # Postgres :5433
cd apps/api && pnpm dev                 # tsc --watch + node --watch (NOT tsx: no decorator metadata)
cd apps/web && pnpm dev
```

Seed/reset: `cd apps/api && pnpm db:seed`. Login: `recruiter@veyra.test` / `Veyra12345`
(also admin@ / hiring@ / interviewer@ / hr@, same password).

## Rules that must not be broken

- **Tenant isolation:** `orgId` comes only from `AuthGuard` via membership lookup. Never from a request body.
- **RBAC:** check permission constants from `src/common/permissions.ts` with `@RequirePermission`, never role names.
- **AI is decision-support only.** No auto-reject. Identity + protected characteristics are stripped
  (`src/matching/redaction.ts`) before any model call. The overall match score is a deterministic
  weighted mean the API computes — not the model's number. Every AI output carries evidence,
  confidence and model version. Every AI feature has a rule-based fallback (no API key needed).
- **Anti-anchoring:** anyone who still owes interview feedback sees only their own scorecard.
- **Offer integrity:** editing an offer resets all approvals to PENDING.
- **Unmarked answers never score zero** — they count as `awaitingManual` and the percent stays null.
- **Coding assessments are deliberately absent.** The PRD requires isolated infrastructure; running
  untrusted code in the API process would be unsafe. Do not add them without a sandbox.
- `apps/api/.env` and `storage/` stay gitignored (real JWT secret, candidate resumes). Repo is public.

## Gotchas already paid for — don't rediscover

- Never edit an applied Prisma migration (checksum). New behaviour → new migration.
- Postgres treats NULLs as distinct, so a nullable column in a unique constraint allows duplicates.
  Fixed with a `NULLS NOT DISTINCT` index.
- Skill matching uses aliases only, never the canonical name ("Excel", "Spring" are English words).
- Tailwind v4: no `@apply btn` — spell out the base utilities per variant.
- Action POSTs need `@HttpCode(200)`.
- Login is rate-limited 10/min; e2e helpers retry.
- Candidate-facing assessment payloads key on `answerId`, not `questionId`.

## Tests

`cd apps/api && pnpm test` (146 unit tests, node:test). E2E: `pnpm test:e2e`,
`test:e2e:phase2`, `test:e2e:phase3` (236 HTTP checks total) — need all three servers up.

## Docs

`README.md` (English, technical) · `README.bn.md` (Bengali, end-user walkthrough).
Keep both in sync when a feature changes.

## Open items the user has not decided

- Commits are authored `Veyra <noreply@anthropic.com>`, not the user's identity. Fixing needs a
  history rewrite + force-push.
- No LICENCE file on a public repo.
