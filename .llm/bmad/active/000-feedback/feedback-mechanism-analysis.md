# Search Feedback (thumbs up/down) — Analysis & Plan

**Author:** Winston (System Architect) · **For:** mr.blurby · **Date:** 2026-08-14
**Status:** Analysis + proposed plan. Nothing implemented.
**Reconciled with:** `main` @ `8ae5097` (PR #3, *docs/consistency-pass*). Docs-only
merge, no source changes — every code-level finding below still holds. What the
merge *did* change is the privacy argument in §4, which is now grounded in the
repo's own stated legal position rather than in my inference. See §4.1.

---

## 1. The question

> A simple thumbs up/down on a search answer, where I can later see the query,
> the response, and the rating — so I can reproduce the case myself.
> Also: is there an admin user?

---

## 2. Is there an admin user?

**No. There is no authentication system in this codebase at all.**

| Concern | What exists today |
|---|---|
| Users / login / sessions | None. Nothing. |
| Roles | None. |
| Operator access | One shared bearer secret, `INGEST_SECRET` |
| Where it is checked | `src/app/api/ingest/auth.ts` → `authorized(request)`, constant-time compare |
| Who reuses it | `POST /api/ingest`, `GET|POST /api/reporte-uso` |
| Network exposure | `src/middleware.ts` — `/api/*` and `/salud` return **404** when the request arrives from the internet (detected by the `CF-Connecting-IP` header). Reachable only from inside the box. |
| Anonymous identity | `ayuda_cid` — HMAC-signed random UUID cookie, issued by middleware, 7-day expiry, `httpOnly` |

So "admin" today means: *a person holding the secret, executing from inside the
box (SSH, cron, or the healthcheck path)*.

**Recommendation: do not build an admin user for this feature.** Adding real
auth would be far larger than the feature itself, and it would introduce the
first credential store into a project that currently has none. Reuse
`authorized()` and the middleware's existing internet-facing 404. You read
feedback with `curl` over SSH, exactly like the usage report works today.

If a browsable UI later becomes genuinely necessary, that is its own decision
with its own threat model — not a rider on this ticket.

**Post-merge addition.** The reconciled README (§*Deployment*) states the
intended administration channel explicitly: *"A private network (Tailscale) is
for administration, not publication."* That settles the read-surface question —
if you ever want the feedback view in a browser rather than through `curl`, it
belongs on the Tailscale side, where it needs no login because the network is
the authentication. That is a far cheaper answer than building auth, and it is
already the project's stated pattern rather than something invented for this
feature.

---

## 3. How close are we?

**Infrastructure: close.** Roughly a day of work. Nearly every primitive needed
already exists.

### Already built and directly reusable

| Piece | Location | Why it matters here |
|---|---|---|
| Anonymous stable id | `middleware.ts` `ayuda_cid` + `clientKey()` | Dedupe "one vote per person per answer" without accounts |
| Server action pattern | `src/app/actions.ts` (`"use server"`) | Feedback needs **no new API route**. Server actions POST to the page path, so the middleware's `/api/*` 404 rule does not interfere |
| Rate limit / abuse | `src/lib/ratelimit.ts`, `src/lib/abuse.ts` | An unauthenticated write endpoint on a public site *will* be found |
| Migrations | `drizzle.config.ts` + `drizzle-kit` | One new table, standard flow |
| Table conventions | `src/db/schema.ts` (`abuseEvents` is the closest model) | serial id, tz-aware `createdAt`, indexes, doc comment explaining *why* |
| Operator read pattern | `api/reporte-uso/route.ts` | Copy verbatim for the read surface |
| Client state | `Chat.tsx` `View` union — holds `question`, `answer`, `filters` together | The UI already has everything the thumbs button needs to submit |

### Diagnostic metadata that already exists (this is the valuable part)

You are richer here than you probably realise. Every one of these is computed
today and thrown away:

- `interpretedBy: "cache" | "fallback" | "limited" | <model>` — from `intent.ts`
- `PROMPT_VERSION` — from `intent.ts`
- `AppliedFilters` — types, categories, municipality, text
- `Answer.notes: AnswerNote[]` — `guessed`, `widened`, `disagreement`, `stale`, `rate_limited`
- `Answer.results[]` — the actual record ids shown

**`interpretedBy` is the single most important field to capture.** Without it, a
thumbs-down is unattributable: you cannot tell whether the model misread the
question, the vocabulary lacked a word, or the underlying data was simply wrong.
Those are three different fixes owned by three different workflows.

### The gaps (the actual work)

1. No **turn id**. `ask()` returns an `AskResult` with no identifier, so a vote
   has nothing to point at.
2. No **feedback table**.
3. No **read surface**.
4. No **retention policy** — only needed if you store question text (§4).

---

## 4. The one real architectural conflict

**This project deliberately never stores a question.** This is not incidental;
it is stated repeatedly and enforced:

- `schema.ts` on `aiIntentCache`: *"Privacy: the question is NEVER stored. The
  key is an HMAC of the normalized text."*
- `schema.ts` on `aiUsageCounters`: *"Stores no IP and no question."*
- `Chat.tsx:23-30`: no history kept, explicitly *"because a question can contain
  a name, an address or a health detail."*
- `reporte.ts`: *"solo lleva agregados. Nunca preguntas, nunca usuarios."*
- `AGENTS.md` §*Before adding a source*: *"Do not ingest personal data.
  Institutional records only."* — note this rule governs **sources**, not user
  input, and invariant 6 now carves out a narrow consent-based exception for
  mirrored contacts. Neither the rule nor its exception covers what a user types
  into the search box. That case is simply unaddressed today, which is precisely
  why this decision needs making.

Your requirement — *see the query* — is the first feature that reverses this
stance. That is a legitimate product decision, but it should be made
deliberately, not discovered inside a migration.

### 4.1 What the merged docs PR changes here

PR #3 did not touch code, but it wrote down two things that move this section
from *my inference* to *the project's stated position*:

**1. The legal frame is now explicit.** README §*Data scope: the line that needs
no lawyer*: *"under Ley 1581 health data is sensitive and requires explicit
consent."* The project already applies this to ingested records. A user's typed
question is the other side of the same coin — `Chat.tsx` keeps no history
specifically because a question "can contain a name, an address or a health
detail." Storing that text silently would contradict the standard the project
applies to everyone else's data.

This does not kill option B. It sets a condition on it: if thumbs-down sends the
text, **the person has to know that at the moment they click**. An honest label
is no longer a nicety — it is what makes the capture consented rather than
covert. Note the shape of the interaction is already in your favour: the user is
taking a deliberate action, so consent is cheap to obtain here in a way it never
is for passive logging.

**2. There is an established pattern for exactly this.** `RECORD_TYPES_GATED`
(`src/lib/vocab.ts`) lists types that require a privacy review and/or a source
agreement before being enabled — and README §*Data scope* notes contact
mirroring shipped only once a source declared consent per person. The project's
existing answer to "this data is sensitive" is *gate it, ship it disabled, enable
it deliberately* — the same instruction as `AGENTS.md` §*Before adding a source*
step 4. Question-text capture should follow that pattern rather than invent one:
land the column, ship it **off** behind a config flag, turn it on as a separate
decision.

**Revised recommendation: still B, with two conditions promoted from
nice-to-have to required** — an explicit in-UI statement at the point of click,
and an off-by-default flag for the text capture. Option A remains a perfectly
respectable answer if you would rather not carry the obligation at all; it costs
you the *what was asked*, not the *how often and on which path*.

Standard caveat: the Ley 1581 reading above is the repo's own summary, not legal
advice from me. Since this feature would newly process user-supplied text, it is
worth confirming with whoever owns the project's data posture before enabling the
text column — not before building the rest.

### 4.2 The price is already written down in this repo

This is the most important finding in the document, and I found it only after
going looking for the terms-of-service question. `src/db/schema.ts:213-226`, on
`abuseEvents`, explains why raw IPs are not stored:

> *"Storing raw IPs would make this a controller of personal data under Ley
> 1581, **with a privacy notice, consent, deletion rights and a data-subject
> channel to answer for** — in exchange for knowing an address that serves no
> operational purpose here."*

So the project has already priced this exact decision and declined it once. The
four obligations are enumerated in its own words. **Storing question text buys
all four**, because a typed question in a crisis app is personal data at least as
readily as an IP — `Chat.tsx` says so itself.

This sharpens the consent checkbox you proposed (§5.2). The checkbox is
**necessary but not sufficient**: it discharges obligation 2 of 4. It does
nothing for the privacy notice, the deletion right, or the data-subject channel.
Those are the ones with ongoing operational cost — someone has to be reachable
and someone has to action a deletion request.

Which reframes the choice honestly:

- **Option A** (no text, ever) keeps the project a non-controller. Cost: zero,
  ongoing. This is the position the codebase currently holds on purpose.
- **Option B** (text on consented thumbs-down) makes it a controller of personal
  data and owes all four obligations from the first row stored.

That is not an argument against B. It is an argument that B's real cost is a
standing commitment, not a migration — and the visible trace id in §5.1 gets you
a surprising amount of B's value while staying in A.

### A finding that reduces the pressure

**You do not need to store the response prose.** `composeAnswer()` builds the
reply deterministically from records. Storing `filters + result ids + notes[]`
reconstructs what the person saw, at a small fraction of the exposure. Storing
prose would also be misleading over time — the catalog changes underneath it.

### Three options for the query text

| Option | What you store | Diagnosis power | Privacy cost |
|---|---|---|---|
| **A** | Metadata only: filters, `interpretedBy`, notes, result ids, rating. No text. | Tells you *how often* and *on which path* it fails, never *what was asked* | None. Consistent with every existing invariant. |
| **B** *(recommended)* | Metadata always + **question text only on thumbs-down**, with a fixed retention window (e.g. 30 days) and operator-only read | High where it matters. Positives need no text; negatives are the corpus. | Bounded and justifiable — only failures, only briefly. |
| **C** | Everything, always, indefinitely | Highest | Reverses the project's stated posture wholesale. A crisis-app query log is among the most sensitive datasets you could hold. |

**Recommendation: B.** It buys you almost all of A→C's diagnostic value for a
bounded cost, and the boundary is easy to explain to a contributor or a user.

Conditions attached to B:
- Label the control honestly in the UI, in Spanish, so a person knows a
  thumbs-down sends their text. Silent capture is the part that would be wrong.
- Cap stored text length (`AI_LIMITS.maxQuestionChars` = 800 is already the cap
  on input; reuse it).
- Write the deletion job **in the same PR as the write path**. Retention that is
  "added later" is retention that never arrives.
- Never route feedback to Discord. `reporte.ts` guarantees aggregates-only on a
  channel its own comment notes is shared and forwarded. Breaking that guarantee
  by adding per-item text would be a genuine incident.

---

## 5. Proposed plan

Three slices. Slice 1 and 2 are independently shippable and testable **with no
`DO_GRADIENT_API_KEY`** — with AI off, everything resolves through the
deterministic path and every thumbs-down there is a missing-vocabulary signal,
which `docs/VOCABULARIO.md` already treats as the highest-value non-code
contribution.

### 5.1 Trace id — yes, and make it visible

**Useful, and it is already the load-bearing piece of Slice 1** — `turnId` in the
schema below *is* a trace id. Without it a vote has nothing to point at. So:
confirmed, keep it.

Three distinct things share that name, and only two are worth building:

| | What it is | Verdict |
|---|---|---|
| **Correlation id** | `turnId`, uuid minted server-side in `ask()`, returned with the result, submitted back with the vote | **Build.** Non-optional; the feature does not work without it. |
| **User-visible short code** | The same id, rendered under the answer as e.g. `caso 7F3A-21` | **Build.** See below — this is the good idea. |
| **Distributed trace id** | OpenTelemetry span propagation | **Skip.** No tracing, no log aggregation, no Sentry — `package.json` has none of it. Nothing to correlate *with*. Pure YAGNI. |

**Why the visible code earns its place:** it gives you a support channel that
works *without storing anyone's text*. A person says "the answer for `7F3A-21`
was wrong" in Discord or a GitHub issue; you look up the row and get filters,
`interpretedBy`, `promptVersion`, notes, and the exact record ids they saw — the
full reproduction — while the question itself was never written to disk. That is
most of option B's diagnostic value at option A's legal cost. It is also the
only mechanism here that lets *you* reproduce a case, which was your original
requirement.

Render it quietly, in the same mono the footer uses for provenance. It is
provenance.

### 5.2 Recording on thumbs-down — one correction

You proposed recording the trace id and results **when the rating is down**. I
would record the **metadata row on both ratings**, and gate only the *text* on
down.

The reason is arithmetic: without the ups you have no denominator. Ten
thumbs-down is a crisis if there were twelve votes and noise if there were a
thousand. Worse, you could not tell whether a prompt change helped — the number
of complaints moves with traffic, not with quality. A metadata row is a few
hundred bytes and carries no personal data, so there is nothing to save by
dropping the ups.

So: **metadata on every vote; question text only on a consented thumbs-down.**

### 5.3 The follow-up panel and the consent checkbox

Good instinct — this is exactly what turns §4.1's "consent at the point of
click" from a slogan into a mechanism. Four design constraints, one of which I
feel strongly about:

1. **Not a modal.** Never put a dialog between a person and a shelter address.
   This is a crisis app used one-handed, possibly on a bad connection, possibly
   by someone frightened. Use an inline panel that expands *below* the answer
   bubble, leaving every result visible and interactive. A modal here is the
   kind of decision that is invisible in review and awful in use.
2. **Only on thumbs-down.** A thumbs-up needs no follow-up; asking anyway trains
   people to ignore the control.
3. **Checkbox unchecked by default**, and worded so it says what actually
   happens — that the text of the question gets stored, and for how long. A
   pre-ticked box is not consent under Ley 1581 and reads as a dark pattern.
   Everything else in the panel must work with the box unticked.
4. **Structured reasons first, free text second.** Offer chips that map to the
   failure modes you can actually act on — *no entendió mi pregunta* /
   *resultados de otro municipio* / *el lugar ya cerró* / *información
   desactualizada*. These are safe to store unconditionally: they carry no
   personal data and they are directly actionable. `interpretedBy` plus a reason
   chip is a near-complete diagnosis on its own.

   An optional free-text box may follow, behind the same consent gate as the
   question, capped at `AI_LIMITS.maxQuestionChars`. I softened my earlier "no
   free text in v1" position on the strength of your consent checkbox: gated and
   opt-in, it is defensible. Ungated it was not.

### Slice 1 — Capture (keyless-testable)

1. **`src/db/schema.ts`** — add `answerFeedback`:
   - `id` serial PK
   - `turnId` text — uuid minted server-side per `ask()` call
   - `rating` text — `up` | `down`
   - `clientKey` text — existing HMAC; never an IP
   - `interpretedBy` text, `promptVersion` text
   - `filters` jsonb, `notes` jsonb, `resultIds` jsonb, `resultCount` integer
   - `questionText` text **nullable** — populated per §4 option B, and only when
     the capture flag is on (§4.1). Column lands in this slice; the flag ships
     **off**, mirroring `RECORD_TYPES_GATED` and the "ship it disabled, enable it
     deliberately" rule in `AGENTS.md`
   - `reasons` jsonb — the structured chips from §5.3. No personal data, stored
     unconditionally
   - `comment` text **nullable** — optional free text, same consent gate and
     same retention as `questionText`
   - `textConsent` boolean not null default `false` — records *that* the person
     ticked the box, which is the evidence half of consent. Ley 1581 expects the
     controller to be able to demonstrate it, not merely assert it
   - `createdAt` timestamptz default now
   - Indexes on `(createdAt)` and `(rating, createdAt)`; unique on
     `(turnId, clientKey)` so a vote is idempotent
2. **Migration** via `drizzle-kit`.
3. **`src/app/actions.ts`** — mint `turnId` in `ask()`, return it in `AskResult`.
   Add `rateAnswer(turnId, rating)` server action; run it through the existing
   rate-limit key path.
4. **`src/components/Chat.tsx`** — two buttons under the answer bubble. Optimistic
   local state, no re-render of results, disabled after voting. Silent failure —
   a broken feedback write must never disturb someone looking for a shelter.

### Slice 2 — Read (operator only)

5. **`src/app/api/feedback/route.ts`** — `GET`, guarded by `authorized()`,
   returns JSON: recent rows plus a breakdown by `interpretedBy` and by `rating`.
   Inherits the middleware 404 automatically. Mirror `reporte-uso/route.ts`
   structure exactly.

   Read it with:
   ```bash
   ssh <box> 'curl -s -H "Authorization: Bearer $INGEST_SECRET" \
     localhost:3000/api/feedback' | jq
   ```

### Slice 3 — Retention (only if option B or C)

6. Deletion of `questionText` older than the window, driven by the same cron that
   already fires `reporte-uso`. Ship with Slice 1, not after.

   Confirmed against the reconciled docs: README §*Deployment* documents that
   cron as `0 * * * *` — hourly — hitting `POST /api/reporte-uso` with the
   operator bearer secret. Hourly is ample granularity for a 30-day retention
   sweep, so this adds no new scheduled job, only a step inside one that already
   runs. `docs/DEPLOY-PROXMOX.md` §7 notes the crontab is the single home for
   that schedule; if a retention step is added, that file is where it gets
   documented, not a second place.

### Tests

- Unit: rating validation, idempotency, no-text-on-thumbs-up (pure, no DB —
  matches the project's stated preference for testable-without-a-database logic).
- Integration: write + read-back, unique constraint, retention deletion.
- The existing `*.integration.test.ts` files show the pattern.

### Rough size

~6 files touched, one migration. The schema and the honest UI label deserve more
thought than the code does.

---

## 6. The legal surface — and a correction

You are right that there is nothing there. The only disclaimer in the product is
one line in the footer (`src/app/layout.tsx`):

> *"Proyecto comunitario, sin relación oficial con el 123, la UNGRD ni la Cruz
> Roja."*

That is an **affiliation** disclaimer. It says who you are not. It says nothing
about accuracy, nothing about liability, and nothing about data. There is no
terms page, no privacy notice, and no `/legal` route anywhere in `src/app`.

### The correction

> *"something simple that says we are not responsible for the prompt info sent
> in the search box, to decrease the risk of the legalities"*

**A disclaimer does not reduce data-protection exposure.** Under Ley 1581 the
obligations attach to whoever decides the purposes and means of processing — the
*responsable del tratamiento*. You cannot disclaim your way out of being that,
any more than a sign saying "not responsible for your data" would let a company
skip consent. Notice that the four obligations quoted in §4.2 are triggered by
*storing*, not by the absence of a notice. A disclaimer that says "we are not
responsible for what you type" while the system quietly stores what you type
would, if anything, read worse than saying nothing.

What actually reduces that exposure, in descending order of effect:

1. **Not storing the text** — option A. Complete, free, and already the
   project's position.
2. **Consent + minimization + retention** if you do store it — which is option B
   plus §5.3, and is a real reduction, not a fiction.
3. **A privacy notice** — a Ley 1581 *requirement* once you store, not a shield.

### But you do need documents — two of them, doing different jobs

The instinct is sound; it is aimed at the wrong risk. These are separate, and
the one you did not ask about is the one I would ship first.

**A. Terms / limitation of liability on the *results*** — *ship regardless of
whether this feature happens.*

This is the exposure that actually matters for this product, and it exists
today. The site tells people where shelters, water, and medical supplies are
during an earthquake. Someone will act on a stale record and find a closed door.
The mitigation is honesty about what the data is: aggregated from third-party
sources, timestamped, not verified in person, not an official channel, verify
before travelling, and in an emergency call 123.

Much of that copy already exists scattered through the UI — the source stamps,
the `stale` note, the `DataIntegrityBlock`, the footer line. A `/terminos` page
is largely a matter of collecting what the product already says and giving it
one home. That is cheap and it is the highest-value legal artifact here.

**B. Privacy notice (*aviso de privacidad*)** — *required only if you choose
option B, and then it is genuinely required.*

Obligation 1 of the four in §4.2. Must state what is collected, the purpose,
the retention window, and how to request deletion — and the deletion channel
has to be real, since obligations 3 and 4 are the data-subject rights and the
means of exercising them. An email address that someone monitors is an
acceptable minimum.

### Implementation

Both are static pages, no new machinery: `src/app/terminos/page.tsx` and
`src/app/privacidad/page.tsx`, linked from the existing footer beside *Código
fuente*. In Spanish, per `docs/HANDOFF-english-lint-tests.md` — *"UI copy,
labels, disclaimers — the audience is Spanish-speaking."* An hour of work; the
words deserve longer than the code.

**This is general guidance on structure, not legal advice, and the Ley 1581
readings are the repository's own.** Content that limits liability during an
emergency should be reviewed by someone qualified before it ships — the accuracy
disclaimer in (A) especially, since that is the one that would be tested in the
worst case. Get the shape right now; get the words checked before launch.

---

## 7. Open decisions for you

1. **Option A, B, or C** for question text. (I recommend B, under the two
   conditions in §4.1: consent stated at the point of click, and the capture
   flag off by default.)
2. **Retention window** if B — 30 days is a reasonable default; you own the call.
3. **Free-text comment box?** Position revised (§5.3): acceptable in v1 *behind
   the consent checkbox*, alongside structured reason chips. Ungated, still no.
4. **Does a thumbs-down on the out-of-scope / out-of-coverage paths count?**
   Those are `AskResult` variants with no `Answer`. Simplest v1: only rate the
   `kind: "answer"` case.
5. **Ship `/terminos` separately and first?** (§6A) It is independent of this
   feature, it addresses a risk that exists today, and it does not wait on the
   privacy decision. I would.

---

## 8. Note on scope

This document is analysis and a plan, as requested — no code has been written.
Points 1–5 above are genuine product decisions rather than technical ones. The
privacy trade-off in §4 and the legal surface in §6 are worth confirming with
whoever owns the project's data-handling posture before implementation. That is
general guidance on structure, not a legal opinion — and the Ley 1581 readings
throughout are the repository's own words, quoted, not my interpretation of the
statute.
