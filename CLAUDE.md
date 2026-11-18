# Veyra Talent — project notes for Claude

Read this instead of re-exploring the repo. Phases 1–4 are complete; phase 5 is in progress
(talent-pool search, the copilot and WhatsApp are done; billing is the only one left).

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
(the seed creates exactly owner@ / hr@ / recruiter@ / manager@ / viewer@ `veyra.test`, same
password — there is no admin@, hiring@ or interviewer@ account).

## Rules that must not be broken

- **Tenant isolation:** `orgId` comes only from `AuthGuard` via membership lookup. Never from a request body.
- **RBAC:** check permission constants from `src/common/permissions.ts` with `@RequirePermission`, never role names.
- **AI is decision-support only.** No auto-reject. Identity + protected characteristics are stripped
  (`src/matching/redaction.ts`) before any model call. The overall match score is a deterministic
  weighted mean the API computes — not the model's number. Every AI output carries evidence,
  confidence and model version. Every AI feature has a rule-based fallback (no API key needed).
- **Anti-anchoring:** anyone who still owes interview feedback sees only their own scorecard.
- **Offer integrity:** editing an offer resets all approvals to PENDING.
- **The careers portal is the one place the tenant comes from the URL** (`src/careers/`), because a
  public visitor has no membership. It stays safe by containment: reads are filtered to published,
  `publicApply` jobs and shaped by `careers/public-view.ts`; the only write is the visitor's own
  application. Never add an endpoint there that takes an orgId, candidateId or stageId.
- **A hidden vacancy is a 404, not a 403** — the portal must not confirm that a draft, closed,
  expired or unlisted job exists.
- **Unmarked answers never score zero** — they count as `awaitingManual` and the percent stays null.
  The same principle holds in talent search: a figure the parser could not read scores 40 with the
  reason stated, and someone just short of the asked experience ranks lower rather than vanishing.
- **Talent search sends the model the recruiter's phrase and nothing else.** No candidate, resume or
  profile reaches it; `talent-ai.ts` only turns a sentence into criteria. Ranking is fixed arithmetic
  in `talent-scoring.ts`, so the same criteria always give the same order. In blind mode the resume
  is redacted *before* it is searched, or a name typed into the box would reveal which masked card
  is whose.
- **Saved searches are private to their author** (`@@unique([organizationId, createdById, name])`);
  re-running one searches the criteria that were saved, not whatever the parser would say today.
- **The copilot answers a fixed list of questions, never free-form SQL.** `copilot-intents.ts` is
  that list; each entry has one deterministic query and one permission, and a member is only routed
  to questions their role allows. A model does two narrow things: route the question (it sees the
  question and the list, no data) and phrase the reply from `Findings` — the figures the API already
  computed. It may not produce a number. Asked to judge a person, the copilot answers with a
  refusal **and no figures**, so declining cannot leak a hint.
- **WhatsApp is a channel on the existing `Communication` log, not a second system.** Same
  placeholders, same append-only history, same permissions as email; `channel` tells them apart and
  one `EmailAutomation` row can carry both templates. Every reason a message is not sent (feature
  off, template off, consent withdrawn, no usable number, **unfilled placeholders**) is recorded as
  a skip with its reason and the full text — never a silent nothing, and never a claim that
  something was sent when it was not: without provider credentials the row says so.
- **A WhatsApp message with a gap is not sent.** `render()` leaves an empty placeholder as blank
  text; on a phone, from an employer, that reads as careless and the missing part is usually the
  point of the message. An interview invitation therefore has to be sent from the interview.
- **No automated WhatsApp rejection template ships.** Deliberate: a rejection on a personal phone
  is worse than an email opened when the person is ready. CUSTOM exists for anyone who disagrees.
- **The WhatsApp webhook is the only public route that writes tenant data.** It is safe by
  construction: Meta's signature over the exact bytes (hence `rawBody: true` in `main.ts`), only a
  provider message id and a status are read from it, statuses only move forward, and an unknown id
  is accepted and ignored rather than reported, so it cannot be used as an oracle.
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
- After `prisma migrate dev`, the running dev server can still hold a stale client: `dist/generated`
  lags behind `src/generated` and you get `Unknown argument ...` at runtime while `pnpm typecheck`
  passes. Re-run `pnpm exec tsc -p tsconfig.build.json`.
- Publishing a job needs a description of 50+ characters, at least one required skill, and an expiry
  that is not in the past — relevant when a test wants an expired job (publish, then backdate).
- Anonymous requests all share one throttle bucket (`ip:`) behind the Next proxy, so a tight limit
  on a public route locks out real users. Guard public writes by data instead: the careers portal
  caps applications per email per hour and leans on `@@unique([jobId, candidateId])`.
- In a JS template literal `` `${x}` `` is a backspace, not a word boundary — it needs `\b`.
  Cost an afternoon in `talent-query.ts`; the regex silently matched nothing.
- `clauses()` in talent search must not split on a full stop unless whitespace follows, or "Node.js"
  breaks in two and the stray "js" is read as a requirement for JavaScript.
- Words left over from a negative clause follow that clause's modality. "no WordPress" has to become
  an exclusion; left as a plain keyword it turns into something the search looks *for*.
- The analytics routes live under `/analytics`, not `/dashboard`, though the module is `dashboard/`.
- `/auth/me` returns the user's fields at the top level (`id`, not `user.id`) plus `organizations[]`.
- The seed's VIEWER role holds every *view* permission, so it is not a useful stand-in for a
  low-privilege member. INTERVIEWER is (no analytics, offers or assessments).
- RECRUITER cannot manage templates (`email:template:manage` starts at HR_MANAGER) — a test that
  edits wording has to sign in as owner@ or hr@.
- `Communication.toEmail` is nullable now: a WhatsApp row carries `toPhone` instead. Anything
  reading a recipient needs `toEmail ?? toPhone`.
- WhatsApp credentials are env-only (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
  `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`), so one deployment sends from one business
  number. Per-tenant credentials need encryption at rest first.

## Tests

`cd apps/api && pnpm test` (283 unit tests, node:test). E2E: `pnpm test:e2e`,
`test:e2e:phase2`, `test:e2e:phase3`, `test:e2e:phase4`, `test:e2e:phase5` (415 HTTP checks total) —
need all three servers up, and a fresh `pnpm db:seed` before each suite. The phase 4 and phase 5
suites need blind mode off and set it themselves; both leave it off. The phase 5 suite also moves
the viewer account to INTERVIEWER to prove the copilot's catalogue shrinks, and moves it back; it
switches WhatsApp on and off again, and briefly withdraws one candidate's consent and restores it.

## Docs

`README.md` (English, technical) · `README.bn.md` (Bengali, end-user walkthrough).
Keep both in sync when a feature changes.

## Open items the user has not decided

- Commits are authored `Veyra <noreply@anthropic.com>`, not the user's identity. Fixing needs a
  history rewrite + force-push.
- No LICENCE file on a public repo.
