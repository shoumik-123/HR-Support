# Veyra Talent — কোডবেস ট্যুর (ডেভেলপারদের জন্য)

এই ফাইলটা কোড কীভাবে সাজানো, কোথায় কী আছে, আর কোন নিয়মগুলো ভাঙা যাবে না — সেটা বলে।
ব্যবহারকারীর গাইড চাইলে `README.bn.md`। ইংরেজি টেকনিক্যাল ডকের জন্য `README.md`।

---

## ১. চালানো

তিনটা আলাদা টার্মিনাল, রুট ফোল্ডার থেকে:

```bash
node scripts/dev-db.mjs            # embedded Postgres, :5433 (Docker লাগে না)
cd apps/api && pnpm dev            # NestJS, :4000
cd apps/web && pnpm dev            # Next.js, :3000
```

`apps/api/pnpm dev` আসলে `concurrently` দিয়ে `tsc --watch` + `node --watch` চালায়।
**`tsx` ব্যবহার করবেন না** — esbuild ডেকোরেটর মেটাডেটা emit করে না, তাই NestJS-এর DI ভেঙে যায়।

ডেটা রিসেট: `cd apps/api && pnpm db:seed`
লগইন: `recruiter@veyra.test` / `Veyra12345` (আরও আছে `admin@` `hiring@` `interviewer@` `hr@`)

---

## ২. ফোল্ডার ম্যাপ

```
apps/api/                NestJS 11 — সব বিজনেস লজিক এখানে
  prisma/schema.prisma   ~৪০টা model, সব tenant টেবিলে organizationId
  prisma/seed.ts         ডেমো ডেটা
  src/generated/prisma   Prisma client (generated, কমিট করা হয় না)
  src/common/            guard, permission, activity log, crypto, validation
  src/<module>/          ফিচার মডিউল (নিচে তালিকা)
  test/                  node:test, ২২৪টা ইউনিট টেস্ট
apps/web/src/app/        Next.js App Router — এক ফোল্ডার = এক রুট
scripts/dev-db.mjs       লোকাল Postgres
```

Prisma 7 নিজে `.env` পড়ে না — [prisma.config.ts](apps/api/prisma.config.ts)-এ
`process.loadEnvFile(".env")` ডাকা আছে। আর tsconfig-এ `rewriteRelativeImportExtensions: true`
লাগে, না হলে generated client-এর `./internal/class.ts` import-এ MODULE_NOT_FOUND হয়।

---

## ৩. একটা রিকোয়েস্ট কীভাবে যায়

```
browser → Next.js server action/fetch → NestJS controller
  → AuthGuard (global)   session যাচাই → membership দেখে orgId + role বসায় req.ctx-তে
  → @RequirePermission   permission constant মেলায়
  → service              প্রতিটা query-তে ctx.orgId
  → PrismaService
```

সব চোকপয়েন্ট একটাই ফাইল: [common/auth.guard.ts](apps/api/src/common/auth.guard.ts)।
সেখানে membership lookup করে `req.ctx = { userId, orgId, role }` সেট হয়।

> **নিয়ম:** `orgId` কখনো request body বা query থেকে নেবেন না। শুধু `ctx` থেকে।
> ক্লায়েন্ট orgId পাঠালে সেটা শুধু "কোন org-এ ঢুকতে চাই" — membership না থাকলে 403।

পারমিশন নাম নয়, **constant** দিয়ে চেক হয় — [common/permissions.ts](apps/api/src/common/permissions.ts)-এ
permission তালিকা + ৮টা role-এর ম্যাপ। `role === "ADMIN"` লিখবেন না কোথাও।

---

## ৪. API মডিউলগুলো

| মডিউল | কাজ | যে ফাইলটা আগে পড়বেন |
|---|---|---|
| `auth` | signup, login, invite, email verify, password reset | `auth.service.ts` |
| `orgs` | organization, membership, settings, team | `orgs.service.ts` |
| `jobs` | job requisition, approval, publish | `jobs.service.ts` |
| `candidates` | candidate profile, tags, notes | `candidates.service.ts` |
| `resumes` | upload → parse → skill extract | `skills.ts` |
| `matching` | candidate ↔ job স্কোরিং | `matching.service.ts` |
| `applications` | pipeline stage, reject, hire | `applications.service.ts` |
| `interviews` | শিডিউল, প্যানেল, scorecard | `scheduling.ts` |
| `assessments` | প্রশ্ন ব্যাংক, পেপার, মার্কিং | `scoring.ts` |
| `offers` | offer letter, approval chain, onboarding | `offers.service.ts` |
| `communications` | email template, automation | `template-render.ts` |
| `careers` | পাবলিক job board ও apply (auth ছাড়া) | `public-view.ts` |
| `talent` | প্রার্থী-ভাণ্ডারে ভাষাভিত্তিক সার্চ, জমানো সার্চ | `talent-query.ts` |
| `queue` | Postgres-ভিত্তিক job queue | `queue.service.ts` |
| `ai` | Claude API wrapper | `ai.service.ts` |
| `dashboard` | সংখ্যা, funnel | `dashboard.service.ts` |

যে ফাইলগুলো `.service.ts` নয় সেগুলো **pure function** — DB বা Nest ছাড়া, সরাসরি টেস্টেবল।
লজিক বুঝতে চাইলে ওগুলো দিয়ে শুরু করুন:

- [matching/redaction.ts](apps/api/src/matching/redaction.ts) — AI-তে পাঠানোর আগে identity মুছে দেয়
- [matching/heuristic-matcher.ts](apps/api/src/matching/heuristic-matcher.ts) — API key না থাকলে এটাই চলে
- [interviews/scheduling.ts](apps/api/src/interviews/scheduling.ts) — টাইমজোন অঙ্ক, `Intl` দিয়ে, DST-সঠিক; `buildIcs` RFC 5545
- [interviews/scorecard-criteria.ts](apps/api/src/interviews/scorecard-criteria.ts) — weighted rating, unrated criteria-র weight পুনর্বণ্টন
- [assessments/scoring.ts](apps/api/src/assessments/scoring.ts) — মার্কিং নিয়ম
- [careers/public-view.ts](apps/api/src/careers/public-view.ts) — পাবলিক পেজে কোন চাকরি দেখানো যাবে আর
  প্রতিটা response-এ কোন কোন ফিল্ড যাবে; hiring ডেটা এখানেই ছেঁকে বাদ পড়ে
- [talent/talent-query.ts](apps/api/src/talent/talent-query.ts) — রিক্রুটারের বাক্য → মাপকাঠি; clause ধরে
  ধরে required / preferred / excluded আলাদা হয়, API key না থাকলে এটাই একমাত্র পার্সার
- [talent/talent-scoring.ts](apps/api/src/talent/talent-scoring.ts) — সার্চের র‍্যাঙ্কিং; ওজন নির্দিষ্ট,
  অনুপস্থিত মাপকাঠির ওজন পুনর্বণ্টিত, প্রতিটা দাবির সাথে CV-র লাইন

---

## ৫. AI পাইপলাইন

PRD-র শর্ত: **AI সিদ্ধান্ত নেয় না, শুধু সহায়তা করে।** এটা prompt-এ লিখে রাখা হয়নি, কোডের
গঠন দিয়েই নিশ্চিত করা:

```
resume text
  → redactResumeText()      নাম, ইমেইল, ফোন, বয়স, লিঙ্গ, ধর্ম, জাতি বাদ
  → aiMatcher               প্রতিটা criterion আলাদা স্কোর + quote করা evidence
  → matching.service        org-এর weight দিয়ে deterministic weighted mean
  → MatchResult             score, breakdown, confidence, promptVersion, blindMode
```

**overall score মডেল দেয় না** — API নিজে হিসাব করে। মডেল শুধু প্রতিটা criterion-এ
স্কোর আর প্রমাণ দেয়। `method: "HEURISTIC" | "AI"`, `promptVersion` প্রতিটা রো-তে সেভ হয়,
তাই পরে অডিট করা যায়।

`ANTHROPIC_API_KEY` না থাকলে প্রতিটা AI ফিচারের rule-based fallback আছে — অ্যাপ পুরোপুরি চলে।
মডেল: `claude-opus-5-5`, `client.beta.messages.parse` + `betaZodOutputFormat`।

auto-reject কোথাও নেই। stage change, reject, hire — সবই মানুষের action, আর
[common/activity.service.ts](apps/api/src/common/activity.service.ts) দিয়ে অডিট লগ হয়।

---

## ৬. যে নিয়মগুলো ভাঙলে বাগ হবে

এগুলো ইচ্ছাকৃত, দুর্ঘটনা নয়। পরিবর্তন করার আগে টেস্ট দেখুন।

**Anti-anchoring** — ইন্টারভিউয়ের ফিডব্যাক এখনো দেননি? তাহলে অন্যদের scorecard দেখতে পাবেন না,
আপনার role যা-ই হোক। [interviews.service.ts](apps/api/src/interviews/interviews.service.ts):

```ts
const mine = interview.scorecards.find((s) => s.interviewerId === ctx.userId);
const owesFeedback = !!mine && !mine.submittedAt;
const canSeeOthers = !owesFeedback;
```

**Offer approval reset** — approved offer এডিট করা যায়, কিন্তু যেকোনো পরিবর্তনে সব approval
`PENDING` হয়ে যায়। অনুমোদনকারীরা পুরোনো শর্তে সই করেছিলেন।

**Unmarked ≠ zero** — `pointsAwarded == null` হলে সেটা `awaitingManual`, আর `percent` থাকে `null`।
আগে একবার answer key মুছে গেলে MCQ চুপচাপ শূন্য পেয়ে "complete" দেখাত।

**Cancelled interview round নম্বর খায় না** — round count-এ `status: CANCELLED` বাদ।

**Automation শুধু unattended send নিয়ন্ত্রণ করে** — "notify candidate" চাপলে template দিয়ে
সরাসরি যায়, automation toggle যা-ই থাকুক।

**Coding assessment নেই — ইচ্ছাকৃত।** PRD বলে isolated infrastructure লাগবে। API process-এ
অবিশ্বস্ত কোড চালানো অনিরাপদ। sandbox না বানিয়ে যোগ করবেন না।

---

## ৭. Candidate-facing টোকেন ফ্লো

প্রার্থীর অ্যাকাউন্ট লাগে না। assessment আর offer দুটোই টোকেন লিংকে চলে:

- টোকেন random, **শুধু sha256 hash** DB-তে থাকে (`accessTokenHash`)
- রুট public কিন্তু throttled: `apps/web/src/app/assessment/[token]/` ও `offer/[token]/`
- পরীক্ষার পেজে countdown, ২.৫ সেকেন্ড debounce-এ autosave, সময় শেষে auto-submit, `beforeunload` guard
- candidate payload-এ `questionId` নেই, আছে `answerId` — কারণ question ডিলিট হলে `SetNull` হয়,
  আর answer রো-তে প্রশ্নের টেক্সট snapshot করা থাকে

---

## ৮. যে ফাঁদগুলোতে আমি একবার পড়েছি

- **applied migration কখনো এডিট করবেন না** — checksum mismatch। নতুন behaviour = নতুন migration।
- Postgres NULL-গুলো আলাদা গোনে, তাই nullable কলাম unique constraint-এ থাকলে ডুপ্লিকেট ঢোকে।
  `NULLS NOT DISTINCT` index দিয়ে ঠিক করা।
- Skill matching-এ **শুধু alias** regex হয়, canonical নাম নয় — "Excel", "Spring", "REST" সাধারণ
  ইংরেজি শব্দ, না হলে false positive।
- Redaction-এ "race condition" / "single-page app" বাঁচাতে regex দুই ভাগ: অস্পষ্ট শব্দ শুধু
  `Label:` ফর্মে ম্যাচ করে, স্পষ্ট phrase যেকোনো জায়গায়।
- Tailwind v4-এ `@apply btn` চলে না — প্রতিটা variant selector-এ base utility লিখতে হয়।
- Action POST (move, reject, publish, run) গুলোতে `@HttpCode(200)` দিতে হয়, নইলে 201।
- Login rate limit ১০/মিনিট — e2e helper retry করে।

---

## ৯. নতুন ফিচার যোগ করার রাস্তা

1. `prisma/schema.prisma`-এ model, **`organizationId` সহ** → `pnpm prisma migrate dev --name <নাম>`
2. `common/permissions.ts`-এ নতুন permission constant + role ম্যাপে বসানো
3. `src/<module>/` — pure logic আলাদা ফাইলে, service-এ DB, controller-এ রুট
4. `test/<module>.test.ts` — pure function-এর টেস্ট (node:test)
5. `apps/web/src/app/<route>/page.tsx` — **লিংক দিলে পেজটা আছে কি না মিলিয়ে দেখুন**
6. `pnpm test` → `pnpm test:e2e*` → দুই README আপডেট

---

## ১০. টেস্ট

```bash
cd apps/api && pnpm test        # ২২৪ ইউনিট টেস্ট, কোনো সার্ভার লাগে না
pnpm test:e2e                   # Phase 1 — ৫২ HTTP চেক
pnpm test:e2e:phase2            # ৮৬
pnpm test:e2e:phase3            # ৯৮
pnpm test:e2e:phase4            # ৫১
pnpm test:e2e:phase5            # ৫৯
```

e2e-র জন্য তিনটা সার্ভার চালু থাকতে হবে। প্রতিটা suite শুরুতেই নিজের আগের ডেটা পরিষ্কার করে,
তাই বারবার চালানো যায়।
