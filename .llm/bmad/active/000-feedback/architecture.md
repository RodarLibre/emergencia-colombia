---
stepsCompleted: [1, 2]
inputDocuments:
  - '.llm/bmad/active/000-feedback/feedback-mechanism-analysis.md'
  - 'AGENTS.md'
  - 'CONVENTIONS.md'
  - 'README.md'
  - 'IMPLEMENTATION_PLAN.md'
  - 'docs/VOCABULARIO.md'
  - 'docs/DEPLOY-PROXMOX.md'
  - 'docs/HANDOFF-english-lint-tests.md'
workflowType: 'architecture'
project_name: 'emergencia-colombia'
user_name: 'mr.blurby'
date: '2026-08-14'
featureScope: 'Search answer feedback (thumbs up/down)'
requirementsBasis: 'feedback-mechanism-analysis.md — no PRD exists; confirmed with user at init'
baselineRef: 'main @ 8ae5097'
decisions:
  questionTextCapture: 'Option B — consented text on thumbs-down, SHIPPED DORMANT (flag off by default; obligations attach only on flip)'
  turnIdIntegrity: 'Signed/HMAC turnId is a precondition for text capture, not hardening'
  legalPages: '/terminos and /privacidad both shipped; flag flip now blocked only on a human owner for the mailbox'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Workflow state

**Feature:** Search answer feedback — thumbs up/down on a composed answer, with
trace id, structured reason chips, consent-gated question text, an operator-only
read surface, retention, and the accompanying legal pages.

**Requirements basis:** No PRD exists for this feature. `IMPLEMENTATION_PLAN.md`
is the project's approved baseline but does not mention feedback, ratings, or
thumbs — this feature is net-new and outside it. Confirmed with mr.blurby at
initialization: `feedback-mechanism-analysis.md` serves as the requirements
basis, with `AGENTS.md`, `CONVENTIONS.md` and `README.md` as binding project
constraints.

**Decision carried in from initialization:** **Option B** — question text is
stored on a consented thumbs-down. This makes the project a controller of
personal data under Ley 1581 and commits it to the four obligations enumerated
in `src/db/schema.ts:213-226`: privacy notice, consent, deletion rights, and a
data-subject channel. `/privacidad`, the retention job, and a monitored deletion
address are therefore in scope, not optional.

_Sections below are appended as each step completes._

---

## Project Context Analysis

_Enhanced through two elicitation passes: Security Audit Personas, then Challenge from Critical Perspective._

### Requirements Overview

**Functional Requirements** — 14, derived from `feedback-mechanism-analysis.md`.
No PRD exists; `IMPLEMENTATION_PLAN.md` does not cover this feature.

**Capture**

- **FR1** Rate a composed answer up or down. Only the `kind: "answer"` variant of `AskResult` is ratable.
- **FR2** Mint an unforgeable `turnId` server-side per `ask()` call and return it with the result.
- **FR3** Persist one metadata row per vote, on **both** ratings — filters, `interpretedBy`, `promptVersion`, `notes[]`, `resultIds[]`, `resultCount`. Ups are the denominator; without them rates are uninterpretable.
- **FR4** One vote per person per answer (idempotent).

**Trace identity — compliance-load-bearing**

- **FR5** Render a user-visible short code derived from `turnId`. This is the **only mechanism by which a data subject can identify their own row**, and therefore the channel through which deletion rights are exercised. Stable, legible over a phone call, present on every screen where text was submitted — not only at answer time.

**Consent-gated content**

- **FR6** On thumbs-down, expand an inline follow-up panel. Never a modal.
- **FR7** Structured reason chips, stored unconditionally — no personal data.
- **FR8** Consent checkbox, unchecked by default, gating `questionText` and optional free-text `comment`. Persist consent as evidence, with its version.
- **FR14** A reason chip for *"no entendió una palabra que usé."* Instrumentation, not merely diagnosis: its frequency is the evidence that decides the flag flip.

**Operator**

- **FR9** `GET /api/feedback`, operator-authenticated, returning rows plus breakdowns by `rating` and `interpretedBy`.
- **FR10** Scheduled deletion of consented text after a fixed retention window.
- **FR13** Operator delete-by-id. Immediate, targeted removal — answers both a data-subject request and an illegal-content takedown. Distinct from FR10 in mechanism and urgency.

**Legal surface**

- **FR11** `/terminos` — accuracy and liability disclaimer on results. **Independent of this feature; addresses a risk that exists today.**
- **FR12** `/privacidad` — Ley 1581 notice with a monitored deletion channel. **Flag-flip prerequisite, not a launch blocker.**

**Non-Functional Requirements:**

- **NFR-1** Ley 1581 compliance — privacy notice, consent, deletion rights, data-subject channel (`src/db/schema.ts:213-226` enumerates the price).
- **NFR-2** Never degrade the search path. Feedback failure is silent. Inherits `AGENTS.md` #9.
- **NFR-3** Crisis-context UX — one-handed, poor connectivity, distressed users. No modal between a person and a shelter address.
- **NFR-4** Abuse resistance via existing `ratelimit.ts` / `abuse.ts`, not a parallel scheme.
- **NFR-5** Data minimization — no IP storage, no text on thumbs-up, bounded length, bounded retention.
- **NFR-6** Spanish for UI copy, disclaimers, user-facing URLs; English for identifiers, comments, commits.
- **NFR-7** Non-integration tests must not require Postgres.
- **NFR-8** Fully exercisable with `AI_ENABLED` off.
- **NFR-9** Ship disabled — text capture behind a flag defaulting off (`AGENTS.md` #10, `RECORD_TYPES_GATED` precedent).
- **NFR-10** Untrusted-input containment — `answer_feedback` holds attacker-controllable content. Never rendered as HTML, never routed to Discord. A hostile-data zone for the life of the project.
- **NFR-11** Consent evidence integrity — requires `consentVersion`, following the `promptVersion` precedent.
- **NFR-12** No decay-mode obligations — any duty created must remain dischargeable after the acute phase. An unanswered deletion request is a worse posture than never having collected.

**Decision carried in:** **Option B, shipped dormant.** The capture flag defaults
off; with it off no personal data is processed and the four Ley 1581 obligations
do not attach at launch. Schema, consent plumbing, signed `turnId` and operator
paths all ship and are exercised. The flag is flipped on evidence, not intent.

**Evaluated at flip time — Option A+:** store only unmatched tokens (present in
the question, absent from the vocabulary, not a municipality, not a stopword).
Retains the vocabulary-gap signal while discarding sentence structure.
*Limitation stated honestly: a person's name is also an unmatched token* — this
reduces exposure substantially, it does not eliminate it.

**Scale & Complexity:**

- Primary domain: full-stack web — Next.js 16 App Router, React 19, server actions, Postgres via Drizzle
- Complexity: **medium-high** by design surface; **medium** at launch scope, since dormancy removes the obligations from the critical path
- Components: 5 (schema/migration, capture action, feedback UI panel, operator read + delete, retention job) plus 2 static legal pages

### Technical Constraints & Dependencies

- **No auth system.** One shared bearer secret plus middleware 404 on internet-origin `/api/*`. Reuse it; building auth is out of scope.
- **Server actions bypass the `/api` middleware branch** — they POST to the page path. Capture needs no API route, but abuse/rate-limit wiring must be explicit rather than inherited.
- **`turnId` integrity is assumed, not enforced.** Minted server-side, accepted back unvalidated, nothing persisted to check against. Until it is unforgeable, `rateAnswer` is an unauthenticated arbitrary-write endpoint into a table that stores text on request. **Precondition for Option B.** The `middleware.ts` HMAC pattern is the house solution.
- **`clientKey` is conditionally present** — no `RATE_LIMIT_SECRET` → no cookie → NULL `clientKey`, and a unique constraint over a nullable column does not constrain in Postgres. Reclassified as a **security control point**: no cookie identity → accept the rating, refuse the text.
- **Credential scope expansion.** Granting `INGEST_SECRET` PII read access retroactively widens the blast radius of every place it already lives — the LXC crontab, `config/deploy.yml`, any machine that ran a manual ingest. Splitting it is in scope.
- **Deletion does not reach backups.** README documents daily database backups; the privacy notice must not claim otherwise.
- **No observability stack** — no Sentry, OTel, or logger in `package.json`. The trace id is a correlation key, not a span.
- **Record ids are stable** (`AGENTS.md` #3), so stored `resultIds` remain resolvable.
- **Migrations via `drizzle-kit`**; `next build` must not connect to Postgres.

### Cross-Cutting Concerns Identified

1. **Privacy and data protection** — the defining concern. The potential corpus is not search analytics: `src/lib/scope.ts` documents that people arrive asking about morgues and Medicina Legal, its own comments calling that referral *"a cruel thing to put in front of someone."* Out-of-scope questions produce no ratable answer and self-exclude, but that is a filter, not a guarantee. This sensitivity — not abstract compliance risk — is why capture is dormant by default.
2. **Consent lifecycle** — capture, evidence, versioning, expiry. Precedent: invariant 6 treats contacts as "a live pointer to a person," held in current state and never in history. `questionText` follows that shape.
3. **Retention and deletion** — ships with the write path, never after it.
4. **Moderation and takedown** — distinct from retention; immediate and targeted.
5. **Consent versioning** — copy changes must not silently reinterpret historical consent.
6. **Abuse and rate limiting** — shared with search, must not throttle search as a side effect.
7. **Degradation** — feedback failure, AI-off, and cookie-absent states are all non-events for the person searching.
8. **Language split** — Spanish UI / English code, enforced per file.
9. **Flag gating** — text capture off by default; flag state visible to operators.

---

## Architecture (lazy pass)

6 files + 1 migration. No new dependencies. Cuts are listed at the end.

### Schema — one table, `src/db/schema.ts`

```ts
/**
 * Feedback on a composed answer.
 *
 * `turnId` is signed (see `lib/feedback.ts`), so a row can only exist for an
 * answer this server actually produced. It is also the whole identity: one
 * turn is issued to one person for one answer, so UNIQUE on it alone gives
 * vote-once without storing who voted.
 *
 * `questionText` and `comment` are the only personal data here and both are
 * null unless FEEDBACK_TEXT=on AND the person ticked the box. Everything else
 * is machine-generated and safe to keep.
 */
export const answerFeedback = pgTable(
  "answer_feedback",
  {
    id: serial("id").primaryKey(),
    turnId: text("turn_id").notNull().unique(),
    rating: text("rating").notNull(),           // up | down
    reasons: text("reasons").array().notNull().default([]),
    /** filters, interpretedBy, promptVersion, notes, resultIds, resultCount */
    context: jsonb("context").notNull(),
    questionText: text("question_text"),
    comment: text("comment"),
    /** Which consent wording was shown. Null when nothing was consented to. */
    consentVersion: text("consent_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("answer_feedback_created_idx").on(t.createdAt)],
);
```

### Signing + recording — `src/lib/feedback.ts` (new)

```ts
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

/** Consent wording version. Bump when the checkbox copy changes (NFR-11). */
export const CONSENT_VERSION = "2026-08-14";

/** Days a consented question survives. One home for this number (NFR-5). */
export const RETENTION_DAYS = 30;

export const textCaptureEnabled = () => process.env.FEEDBACK_TEXT === "on";

const sign = (id: string) =>
  createHmac("sha256", process.env.RATE_LIMIT_SECRET!).update(id).digest("hex").slice(0, 16);

/** `<uuid>.<sig>`. Unforgeable without the secret, and needs no lookup table. */
export function mintTurnId(): string {
  const id = randomUUID();
  return `${id}.${sign(id)}`;
}

export function validTurnId(turnId: string): boolean {
  const [id, sig] = turnId.split(".");
  if (!id || sig?.length !== 16) return false;
  return timingSafeEqual(Buffer.from(sign(id)), Buffer.from(sig));
}

/** What the person sees and quotes back to us. Not separate state. */
export const caseCode = (turnId: string) => turnId.slice(0, 8).toUpperCase();
```

### Capture — `src/app/actions.ts`

`ask()` gains `turnId: mintTurnId()` on the `kind: "answer"` result. Plus:

```ts
export async function rateAnswer(input: {
  turnId: string;
  rating: "up" | "down";
  reasons?: string[];
  context: unknown;
  questionText?: string;
  comment?: string;
  consented?: boolean;
}): Promise<void> {
  if (!validTurnId(input.turnId)) return;              // forged: drop, silently
  if (input.rating !== "up" && input.rating !== "down") return;

  // Text only when the flag is on, the box was ticked, and it is a thumbs-down.
  const keepText = textCaptureEnabled() && input.consented && input.rating === "down";

  await db.insert(answerFeedback).values({
    turnId: input.turnId,
    rating: input.rating,
    reasons: (input.reasons ?? []).slice(0, 5),
    context: input.context,
    questionText: keepText ? input.questionText?.slice(0, AI_LIMITS.maxQuestionChars) : null,
    comment: keepText ? input.comment?.slice(0, AI_LIMITS.maxQuestionChars) : null,
    consentVersion: keepText ? CONSENT_VERSION : null,
  }).onConflictDoNothing();                            // vote-once, in the DB
}
```

Wrapped in `try {} catch {}` at the call site: a failed write is a non-event
(NFR-2). No rate-limit call of its own — `middleware.ts` already sheds floods on
every non-`/api` path, which includes server actions.

### UI — `src/components/Chat.tsx`

Two buttons under the bubble. On `down`, `useState` reveals an inline block —
reason chips, an unticked checkbox, an optional textarea. No modal, no dialog
library, no new component file. The case code renders in the existing `stamp`
class beside the answer.

### Operator — `src/app/api/feedback/route.ts` (new)

```ts
export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });
  return Response.json(await db.select().from(answerFeedback)
    .orderBy(desc(answerFeedback.createdAt)).limit(200));
}

/** Takedown and data-subject deletion. Same call, quoted case code. */
export async function DELETE(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const code = new URL(request.url).searchParams.get("caso");
  if (!code) return new Response(null, { status: 400 });
  await db.delete(answerFeedback)
    .where(like(answerFeedback.turnId, `${code.toLowerCase()}%`));
  return new Response(null, { status: 204 });
}
```

Aggregation by `rating` / `interpretedBy` is left to `jq` over the JSON.

### Retention — `src/app/api/reporte-uso/route.ts`

One statement added to the handler that already runs hourly. No new cron, no new
route, no scheduler:

```ts
// Consented text expires; the metadata row stays. Rides the hourly report
// so there is one schedule to know about (docs/DEPLOY-PROXMOX.md §7).
await db.update(answerFeedback)
  .set({ questionText: null, comment: null })
  .where(lt(answerFeedback.createdAt, sql`now() - interval '${RETENTION_DAYS} days'`));
```

### Legal — `src/app/terminos/page.tsx`, `src/app/privacidad/page.tsx`

Two static server components, Spanish prose, linked from the existing footer.
No markdown pipeline, no CMS. `/privacidad` renders `RETENTION_DAYS` rather than
restating it, so the notice cannot drift from the code.

### Test — `src/lib/feedback.test.ts`

Pure, no database (NFR-7): a minted id validates, a tampered one does not, a
foreign-signed one does not, `caseCode` is stable.

---

## What was cut, and when to add it

| Cut | Why | Add when |
|---|---|---|
| `clientKey` column | `turnId` is issued to one person for one answer, so `UNIQUE(turn_id)` already gives vote-once. The nullable-unique hole disappears with the column. | Never, unless per-person analysis across turns is wanted |
| Separate `FEEDBACK_SECRET` | Nothing personal exists at launch — capture is dormant | **At flag flip.** `ponytail:` comment on the route |
| Separate retention cron | The hourly report already runs with operator auth | Never |
| Aggregation endpoint | `jq` over 200 rows | When rows outgrow one screen |
| `resultIds`/`filters`/`notes` as columns | One `context` jsonb, no migration when `Answer` changes | When something needs indexing |
| Rate-limit call in `rateAnswer` | Middleware already sheds floods on this path | If votes prove abusable despite signed ids |
| Separate short-code generator | First 8 chars of the uuid | Never |
| Modal / dialog component | `useState` and a conditional block | Never (NFR-3 forbids it) |

## Implementation order

1. `lib/feedback.ts` + its test — pure, no database, verifiable immediately
2. Schema + `drizzle-kit` migration
3. `actions.ts` — mint and record
4. `Chat.tsx` — buttons, panel, case code
5. `api/feedback/route.ts` + the retention line
6. `/terminos` — shippable alone, no dependency on any of the above

Steps 1–5 are exercisable with `AI_ENABLED` off and `FEEDBACK_TEXT` unset
(NFR-8). `/privacidad` is written only when the flag is flipped.

---

## Implementation record

Built on `000-feedback` at baseline `e9c2393`. Verified: `tsc --noEmit` clean,
`eslint` clean, `prettier` clean, **354/354 unit tests** (was 352 + 2 new
regression tests). No new dependencies.

### Departures from the lazy pass above

| Planned | Shipped | Why |
|---|---|---|
| `drizzle-kit` migration | `src/db/answer-feedback.sql`, applied with `psql -f` | `push` diffs the whole schema; production drift would put `observations` and `source_records` in the blast radius. Follows the existing `indexes.sql` pattern. |
| `onConflictDoNothing` | `onConflictDoNothing` for the thumb, `onConflictDoUpdate` for the panel | Two writes race for one row. Only the panel may revise it, or a late-landing thumb blanks a comment somebody just consented to. |
| `clientKey` column | dropped entirely | `turnId` is issued to one person for one answer, so `UNIQUE(turn_id)` already is one-vote-per-answer. |
| `resultCount` in context | dropped | It is `resultIds.length`. Two fields that can disagree. |
| index on `(rating, createdAt)` | dropped | No query filters by rating; `jq` does the breakdown. |

### What the review layers found

Three parallel layers ran: Blind Hunter (diff only), Edge Case Hunter (diff +
project), Acceptance Auditor (diff + spec + invariants). 16 findings actioned.

**The Critical.** `validTurnId` destructured `turnId.split(".")` and ignored
anything past the second segment, while the *whole string* was what got stored.
So `<uuid>.<sig>.1`, `.2`, `.3` all verified — the signature only ever covered
the uuid — and each landed as its own row past `UNIQUE`. One legitimate search
bought unlimited writes into a table that keeps text on request. Fixed by
requiring exactly two segments; two regression tests pin it.

The lesson is narrow and worth keeping: the signature covered the id, the
uniqueness constraint covered the string, and nothing checked that those were
the same thing.

**The consent defect.** `<Feedback>` sat at a fixed position in `AnswerView`
with no `key`, so React would preserve its state across answers — a tick given
for one question carrying onto the text of the next. The two hunters disagreed
on whether it was reachable; Edge Case Hunter was right that `pending` swaps in
`<Loading/>` and unmounts the tree, so it was not. Keyed anyway: consent holding
by accident of an unrelated loading state is not a property worth resting on.

**The sink nobody described as text.** `context` round-trips through the browser
and was written to `jsonb` unvalidated and unbounded — a free-text field that
never asked for consent and that the retention sweep does not clear. Now rebuilt
server-side from known keys with every value capped.

**And then the same sink again, found by reading one row of real data.** The
hardening above bounded what a *client* could put in `context`. It did not stop
the server putting the question there itself: `ask()` set `text: query.q`, and on
the deterministic path `query.q` is the trimmed question, verbatim. So every
vote — up or down, flag off, nothing ticked — stored the person's words in the
one column the sweep never clears, because `purgeExpiredText` only touches rows
with a `consent_version`. Three defences read correctly while the data walked
past all of them, because none was looking at `context`.

Fixed at both ends: `ask()` no longer puts it there (what was searched is already
recorded by `types`, `categories`, `municipality` — enums and DANE codes), and
`safeContext` has no `text` key at all, so a caller can send it and it still
cannot land. Four regression tests in `context.test.ts` assert the question
cannot appear however it is shaped.

The lesson is worth more than the fix: reviewing the design said the gate held;
reading one stored row said it did not. `mr.blurby` found this by looking at the
data.

### Known, accepted

- A tampering client can still write *wrong* (not unbounded) metadata into its
  own row. Reconstructing server-side would cost a write on every search.
- `INGEST_SECRET` is shared with the feedback reader. Marked `ponytail:` in the
  route; splitting it is a flag-flip prerequisite, not a launch blocker, because
  nothing personal exists while capture is dormant.
- `?caso=` is a prefix match over 32 bits, so collisions are possible. The delete
  refuses with `409` and lists candidates rather than guessing.

### Shipped after the review rounds

- **`/privacidad`** — the notice the consent checkbox links to. Imports
  `RETENTION_DAYS` rather than restating it, so the promised window cannot drift
  from the sweep enforcing it. Discloses that questions are sent to DigitalOcean
  Gradient for interpretation, which is a flow that already existed and that a
  privacy notice made impossible to leave unsaid. That paragraph needs review by
  somebody qualified — it describes an international transfer.
- **Placement.** The control moved from the very bottom of `AnswerView` to above
  the result cards. At the bottom the only people who reached it were the ones
  patient enough to scroll past twenty shelter listings — the opposite of the
  people whose answer failed. A follow-up review then caught what the move
  broke: focus fell to `<body>` on vote (now moves to the block, with
  `aria-live`), and the top rule read as attaching the case code to the first
  card (rule moved to the bottom).
- **`Enviar` is a filled CTA** — `bg-accent text-bg`, matching the search submit.
  Measured, not eyeballed: 6.38:1 light, 10.13:1 dark, both past WCAG AA.
- **`cap` and `safeContext` moved into `src/lib/feedback.ts`.** A `"use server"`
  module drags the database in, so their tests could not run without Postgres
  (NFR-7). The pure module was the right home anyway.

### Test status at hand-off

Unit: **358 pass**. Typecheck, ESLint, Prettier clean.

Integration: **6 of 33 fail** — in `search.integration.test.ts` and
`search-fallback.integration.test.ts`. Verified pre-existing: the identical six
fail on baseline `e9c2393` with this branch stashed. Nothing here touches
`search.ts`. They cover relevance ranking and latest-observation semantics,
which decide which shelter somebody sees first, so they deserve their own
investigation.

### Docs updated

`README.md` — Answer feedback section, `db/` layout, deploy steps, and the two
operational facts (apply `answer-feedback.sql` by hand; retention rides the
hourly report). `.env.example` — `FEEDBACK_TEXT` with its flip preconditions.

`docs/DEPLOY-PROXMOX.md` is marked **superseded**: the deployment moved to
DigitalOcean, so it is the wrong home for anything operational. Nothing about
this feature was left there. Its Kamal, cron and Cloudflare Tunnel steps still
describe how the app is wired, which is why it is annotated rather than deleted
— that call is the owner's.

`/terminos` now carries a real contact: `hola@rodarlibre.co`, beside the
repository issues link. The erasure channel FR13 documents is reachable, so
NFR-12 no longer rests on a placeholder.
