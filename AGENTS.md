<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Project orientation

Read `CONVENTIONS.md` before writing code. `README.md` has the full picture.

## What this is

A read-only federation layer over the community and official websites that
sprang up after the Colombia earthquake of 2026-08-10. One question box in
Spanish searches across all connected sources; every result names where it came
from, when the source last updated it, and links back to the original.

It does **not** accept new reports, verify information, or replace emergency
services. Real people use this to decide where to drive with a truck of water.

## Ten invariants

Breaking one of these is a product decision, not a refactor. Do not do it
incidentally.

1. Every public result names its source, with a timestamp and a link.
2. Observations are immutable. A change creates a new one; the history stays.
3. A record is never deleted because it stopped appearing in a listing. Only an
   explicit withdrawal by the source removes it.
4. Nothing is merged. Conflicting sources appear side by side, and disagreement
   is labeled.
5. Location precision is never upgraded by inference.
6. Contact data is not copied. Link to the source instead.
7. `robots.txt` and source terms are respected, with no workaround.
8. The model translates the question, never the answer. It never sees a record.
9. Any AI failure degrades to deterministic search, never to an error page.
10. Sources start disabled and are enabled one at a time.

## Architecture in one paragraph

Single Next.js app — not a monorepo. `src/ingest` reads sources and writes
immutable observations; `src/lib/search.ts` is the only path that queries the
catalog; `src/lib/intent.ts` is the whole bot. The model converts a Spanish
question into a validated filter object and never receives a catalog record, so
it cannot invent one. `src/lib/vocab.ts` is the single source of truth for every
enumerated value, including what the model is allowed to emit.

## Where the traps are

Things that look wrong until you know why:

- **`para` / `hacia` / `con` are excluded from locative prepositions.**
  "Recolección para Tuluá" names the beneficiary, not the location.
- **Out-of-scope detection is deterministic only**, and lives in `src/lib/scope.ts`
  with no imports so it stays testable without a database. The model flagged
  legitimate questions at random, and a false positive denies someone an answer.
- **Questions about a person are detected compositionally** — a person AND a
  question about their condition — never by listing phrasings. Both halves are
  required, which is what keeps "agua para mi hijo" searchable.
- **`\b` is ASCII in JavaScript.** There is no word boundary after an accented
  vowel, so `/mam[áa]\b/` never matches "mamá".
- **`reasoning_effort: low` is a requirement.** `gpt-oss` models bill reasoning
  as output; at medium they spend the whole budget reasoning and emit nothing.
- **The vocabulary lives in `src/lib/data/vocabulario.json`,** not in code, so
  people who know how their town speaks can extend it without TypeScript. Terms
  are matched as substrings against folded text: an accent makes a term match
  nothing, silently. `vocabulario-data.test.ts` enforces the rules; the guide
  for contributors is `docs/VOCABULARIO.md`.
- **Categories and municipalities are extracted by code, not by the model.** The
  model confused the enums systematically. The model emits *names*; code
  resolves identifiers, so it cannot invent a DANE code.
- **Search results are never cached.** Only the interpretation of a question is.
  Serving "open" after a place closed is the failure this project prevents.
- **Filters apply after reducing to the latest observation**, not before. Filter
  first and a closed place resurfaces because an old observation said "active".
- **The middleware runs in the Edge runtime, where `process.env[name]` is
  undefined.** Next inlines statically analysable reads at build time; a
  dynamic lookup compiles fine and silently ignores every override, in the one
  layer that sees every request. `src/lib/config.ts` reads only static
  `process.env.NAME`.
- **The build must not connect to Postgres.** A previous bug had `next build`
  reaching the dev database.

## Before adding a source

1. Read its `robots.txt` and one public page. Record what you found.
2. Prefer a static asset over an API when both exist — a CDN file costs the
   source owner nothing; polling their API spends a volunteer's quota.
3. Do not ingest personal data. Institutional records only (see *Data scope* in
   the README).
4. Ship the source disabled. Enable it deliberately.
5. Commit a sanitized fixture and verify no real contact data survives in it.

## Commands

```bash
pnpm dev                              # localhost:3000
pnpm typecheck
pnpm build
docker compose up -d db
pnpm db:push && pnpm db:seed          # seed data is fake and refuses production
pnpm ingest <slug> [--fixture]        # cali-ayuda | donde-ayudo-valle
node scripts/fetch-municipios.mjs     # regenerate DANE municipalities
```
