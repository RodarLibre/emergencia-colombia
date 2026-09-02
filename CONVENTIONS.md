# Conventions

**https://emergenciacolombia.org** · MIT

## Language

**English** for everything a developer reads:

- Identifiers, types, file names
- Comments and JSDoc
- Commit messages
- Log messages and internal error strings

**Spanish** for everything a user reads. The audience is people in Valle del
Cauca during an emergency; translating the interface would make it worse.

- UI copy, labels, disclaimers
- User-facing URLs and query params (`/?p=`, `/fuentes`, `/salud`, `?fuente=`)
- Vocabulary display labels (`CATEGORY_LABELS`, `STATUS_LABELS`)
- The model's system prompt, and the JSON keys it emits — the prompt is Spanish
  because the questions are Spanish
- **Docs written for people who are not developers.** `docs/VOCABULARIO.md` asks
  someone in Buga to tell us they say "remesa" and not "mercado"; asking that in
  English gets no answer. Same for the "Aportar sin programar" section of the
  README.

Everything else under `docs/` is developer- or operator-facing and follows the
English rule. `docs/DOMINIO-CLOUDFLARE.md` is still Spanish, from before this
rule; it is not being retrofitted, but the next substantial edit should move it
over.

Anything written before this file follows the old convention (Spanish comments).
It is not being retrofitted; new and modified code uses English.

## Comments

Explain **why**, not what. The code says what it does.

Comments here carry a lot of weight because several decisions look wrong
without their reason. Examples worth preserving in that style:

- Why `para` and `hacia` are excluded from locative prepositions (they mark the
  beneficiary, not the location).
- Why out-of-scope detection is deterministic only (the model flagged it at
  random, and a false positive denies someone an answer).
- Why search results are never cached (serving "open" after it closed is the
  failure this project exists to prevent).

When a decision is measured, put the number in the comment. `reasoning_effort:
low` is a requirement, not a tweak, and the comment says why: at medium the
model spends the whole token budget reasoning and emits nothing.

## Non-negotiables

These are product invariants, not style preferences. Changing one is a product
decision, not a refactor.

**They are maintained in `AGENTS.md`, which is the single copy.** It carries the
full wording, including the reasoning that makes 2 and 6 make sense. The list is
summarized here so this file reads on its own; if the two ever disagree,
`AGENTS.md` wins and this summary is the bug.

1. Every public result names its source, with a timestamp and a link.
2. Observations are immutable. A change creates a new one. Contact data is not
   an observation: it lives in the record's current state and is overwritten on
   every read.
3. Records are never deleted because they stopped appearing in a listing. Only
   an explicit withdrawal by the source removes one.
4. Nothing is merged. Conflicting sources are shown side by side.
5. Location precision is never upgraded by inference.
6. Contact data is mirrored **only** from sources that collect consent per
   person, declared per source with `mirrorsContacts`. Scraping a number off a
   site that never consented stays forbidden.
7. `robots.txt` and source terms are respected, with no workaround.
8. The model translates the question, never the answer. It never sees a record.
9. Any AI failure degrades to deterministic search, never to an error page.
10. Sources start disabled and are enabled one at a time.

## Testing

```bash
pnpm lint && pnpm test        # no database needed
pnpm test:integration         # needs Postgres (docker compose up -d db)
```

ESLint (flat config, `eslint.config.mjs`) and Prettier are configured, and the
suite covers the four areas that were once listed here as gaps: the text logic
(`fold`, `resolveMunicipality` across ambiguous department names,
`findMunicipalityInText` for beneficiary-vs-location, `extractCategories`,
`buildTextQuery`, `redactContact`), the adapters against the sanitized fixtures
in `fixtures/`, the guards (count-collapse quarantine, demo-data wall, rate
limit windows), and the vocabulary file's own rules.

Tests live next to what they test. `*.integration.test.ts` needs a database and
runs under a separate config; everything else must stay runnable without one —
that is why `src/lib/scope.ts` has no imports.

The suite exists because verification used to be manual (throwaway `tsx`
scripts, `curl`, real container runs). That found real bugs, but none of it was
repeatable. New edge cases discovered against real data belong in a test, not
in a commit message.

## Contacts

Invariant 6 changed on 2026-08-14, when a source appeared (CORAG) whose whole
model is connecting people over WhatsApp, and which collects authorization per
person.

Before: contacts were never copied. That rule was written when the only way to
have a phone number was to scrape it off a site that never consented to it.

Now: they are mirrored **only** from sources that declare it (`mirrorsContacts`),
and they live in the record's current state, never in the history. A phone
number is not a fact about the place over time; it is a live pointer to a
person. If the source removes it, it disappears on the next read, with no
migration and no manual deletion.

What did **not** change: redaction still runs over every adapter's free text,
contacts never enter the indexed text — nobody should be findable *by* their
number — and they are always shown citing the source.
