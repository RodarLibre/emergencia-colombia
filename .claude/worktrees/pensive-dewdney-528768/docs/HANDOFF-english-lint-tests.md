# Handoff: English refactor, linting, and a test suite

Self-contained task spec. You do not need any prior conversation to execute it.

Read `CONVENTIONS.md` first — it defines the language rule and the ten product
invariants. **Breaking an invariant is not a refactor, it is a product change.
Do not do it.**

## Three tasks, in this order

1. Add ESLint + Prettier and make the repo pass.
2. Add a test suite covering the cases listed below.
3. Translate Spanish comments to English.

Tests come before the translation on purpose: they prove the translation changed
nothing.

---

## Task 0 — Baseline

Record that the project works before you touch it:

```bash
pnpm install
docker compose up -d db
cp .env.example .env      # then fill DATABASE_URL
pnpm db:push
pnpm db:seed
pnpm typecheck
pnpm build
pnpm ingest cali-ayuda --fixture
pnpm ingest donde-ayudo-valle --fixture
```

Expected: typecheck and build clean, `cali-ayuda` reports 8 records,
`donde-ayudo-valle` reports 86.

If any of that fails before your changes, stop and report it.

---

## Task 1 — ESLint + Prettier

Nothing is configured today. Add:

- ESLint with `eslint-config-next` and `@typescript-eslint`, flat config
  (`eslint.config.mjs`).
- Prettier. Match the existing style: 2 spaces, double quotes, semicolons,
  ~100 char lines, trailing commas.
- Scripts: `pnpm lint`, `pnpm lint:fix`, `pnpm format`, `pnpm format:check`.

Rules that must be **on**, because they protect real invariants:

| Rule | Why |
|---|---|
| `@typescript-eslint/no-floating-promises` | An unawaited DB write in the ingest path loses data silently |
| `@typescript-eslint/no-explicit-any` | The `as unknown as Row[]` casts around raw SQL are deliberate and narrow; keep them from spreading |
| `no-console` (allow `warn`/`error`) | `console.error` is how the integrity guard and rate limiter report; `console.log` in request paths risks logging user questions |
| `eslint-comments/no-unused-disable` | Keep suppressions honest |

Do **not** add a rule that forces comments or identifiers to English — that is
Task 3, done by hand with judgment.

Fix violations by changing code, not by adding `eslint-disable`. If a
suppression is genuinely correct, comment why on the line above.

---

## Task 2 — Test suite

Use **Vitest**. Add `pnpm test` and `pnpm test:watch`.

Two groups:

- **Pure unit tests** (no DB, no network) — the bulk of the value.
- **Integration tests** that need Postgres. Gate them behind
  `pnpm test:integration` so `pnpm test` stays fast and offline.

Every case below is a real bug that was found and fixed. They are regression
tests, not coverage theater. **If a test fails, the code is right and your
expectation is wrong — check with the maintainer before changing source.**

### `src/lib/normalize.ts` — `fold`

| Input | Expected |
|---|---|
| `"Tuluá"` | `"tulua"` |
| `"Jamundí"` | `"jamundi"` |
| `"BUENAVENTURA"` | `"buenaventura"` |
| `"Cañón"` | `"canon"` |
| `"  Palmira  "` | `"palmira"` |

### `resolveMunicipality`

Colombia has 67 municipality names shared across departments, 7 of them in
Valle del Cauca. Resolution prefers the operating department (`76`).

| Input | Expected |
|---|---|
| `"Palmira"` / `"palmira"` / `"PALMIRA"` | `76520` |
| `"Tuluá"` / `"tulua"` | `76834` |
| `"buga"` | `76111` (Guadalajara de Buga, partial match) |
| `"Candelaria"` | `76130` — Valle, **not** Atlántico `08141` |
| `"La Unión"` | `76400` — Valle, not Antioquia/Nariño/Sucre |
| `"Restrepo"` | `76606` — Valle, not Meta |
| `"Medellín"` | `05001` (nationally unique) |
| `"Bogotá"` | `11001` — DANE calls it `"Bogotá, D.C."`; the short form must resolve |
| `"Villanueva"` | `null` — exists in 4 departments, none of them Valle |
| `"la"` / `"san"` | `null` — too short to disambiguate |
| `"Xyzabc"` / `""` / `null` | `null` |

### `findMunicipalityInText` — the three traps

This is the most important test block in the repo. All three bugs shipped
briefly and produced wrong geography.

**Trap 1 — beneficiary is not location.** `para`, `hacia` and `con` mark who the
aid is *for*, not where the point *is*.

| Input | Expected | Note |
|---|---|---|
| `"Campana de solidaridad con Versalles Norte del Valle"` | `null` | A collection point **in Cali** gathering aid for Versalles |
| `"Recoleccion para Tulua"` | `null` | |
| `"Donaciones hacia Buenaventura"` | `null` | |

**Trap 2 — proper nouns that match municipality names.** Only a locative
preposition (`en`, `de`, `del`) licenses a match.

| Input | Expected | Note |
|---|---|---|
| `"Colegio San Pedro Claver de Cali"` | `Cali` | **not** San Pedro (`76670`) |
| `"Centro La Victoria en Palmira"` | `Palmira` | not La Victoria |
| `"Parque San Pedro"` | `null` | |

**Trap 3 — municipalities that are also neighborhoods.** San Pedro is a Valle
municipality, a *corregimiento* of Buga, and a Cali neighborhood. Versalles is a
municipality and a well-known Cali neighborhood. Bare mentions are not enough.

| Input | Expected |
|---|---|
| `"acopio en San Pedro"` | `San Pedro` (preposition present) |
| `"Barrio Versalles"` | `null` |
| `"Institucion Educativa La Union"` | `null` |

**Word boundaries.**

| Input | Expected | Note |
|---|---|---|
| `"donde puedo llevar agua en Buga"` | `Guadalajara de Buga` | curated alias |
| `"acopio en Bugalagrande"` | `Bugalagrande` | not Buga |
| `"donde llevo agua"` | `null` | must **not** match Dagua (`76233`) |
| `"punto en Dagua"` | `Dagua` | |
| `"albergue en Tulua"` | `Tuluá` | |

### `extractCategories`

Category extraction is deterministic on purpose: the model confused the 17-value
enum systematically ("agua" → `communications`, "comida" → `transport`).

| Input | Must include |
|---|---|
| `"donde llevo agua"` | `water` |
| `"necesito dejar comida"` | `food` |
| `"se necesitan cascos y guantes"` | `rescue_equipment` |
| `"pañales y toallas"` | `hygiene` |
| `"busco donde dormir"` | `shelter` |
| `"xyz"` | `[]` |

### `buildTextQuery`

The original bug: `websearch_to_tsquery` ANDs terms, so a full question matched
nothing. Terms are now joined with `or`.

- `"donde puedo llevar agua en Palmira"` → contains `"agua"`, `"palmira"`,
  joined by `" or "`; must **not** contain `"donde"` or `"puedo"`.
- `""` → `null`.
- A string of only stopwords → falls back to the folded text, not `null`.

### `redactContact` (`src/ingest/types.ts`)

| Input | Expected |
|---|---|
| `"llama al 3046168439"` | contains `"[contacto en la fuente]"`, no digits from the number |
| `"+57 304 616 8439"` | redacted |
| `"tel 555 12 34"` | redacted |
| `"Calle 14 #16-29"` | **unchanged** — a street address is not a phone number |

That last row matters: over-eager redaction would destroy the addresses that
make a collection point actionable. Verify against the real fixture that all 86
`donde-ayudo` addresses survive.

### `computeFreshness` (`src/lib/vocab.ts`)

Windows in minutes: `hazard` 60, `collection_point`/`service_point`/`shelter`
720, `official_update` `null` (never stale).

- inside the window → `"fresh"`
- past the window, within 3× → `"needs_reconfirmation"`
- past 3× → `"stale"`
- `official_update` at any age → `"fresh"`

Pass an explicit `now` so tests are deterministic.

### `src/lib/relate.ts`

Overlap coefficient, not Jaccard: sources title the same place with different
verbosity. Jaccard gave 0.33 for the pair below and separated them.

- `"Albergue Palmira norte - sin cupo"` (source A, `fulfilled`) and
  `"Albergue Palmira norte - reportan que sigue abierto"` (source B, `active`),
  same `recordType`, same `admin2Name` → **linked**, and
  `statusesDisagree` → `true`.
- Same source slug → never linked, regardless of similarity.
- Different `recordType` → never linked.
- Fewer than 2 shared tokens → never linked.

### Adapters, against the committed fixtures

Fixtures in `fixtures/` are sanitized real pages. **Do not re-fetch live sources
in tests.**

`parseReports` on `fixtures/cali-ayuda-reports.html`:

- 8 records, all `service_point`
- zero phone numbers in any title or description
- ingests only "Punto de ayuda"; "Necesidad" and "Oferta" are excluded because
  they carry phone numbers and first names
- an empty or restructured page throws `ParserError` — never returns `[]`

`parseDondeAyudo` on `fixtures/donde-ayudo-chunk.js`:

- 86 records, all `collection_point`
- 86 with `admin2Code`, 86 with `displayAddress`, 12 with `openingHours`,
  86 with `sourceUpdatedAt`
- `"Rozo (Palmira)"` resolves to municipality Palmira with locality Rozo
- `"Buga (Guadalajara de Buga)"` resolves to `76111`
- no `contactos` values and no `verificadoPor` names appear in any output field
- a chunk without the data marker throws `ParserError`

### Integration tests (need Postgres)

- **Idempotency**: running an adapter twice creates no second observation;
  counts report `unchanged`.
- **Quarantine**: with 86 stored records, submitting 29 throws
  `QuarantineError` and writes nothing. Truncating the fixture to a third
  reproduces it.
- **No deletion on absence**: a record missing from a run is not deleted or
  hidden; only `withdrawnAt` set explicitly removes it.
- **Latest-observation semantics**: filters apply *after* reducing to the latest
  observation per record. A record whose latest state is `closed` must not
  resurface because an older observation said `active`.
- **Rate limiter**: 10 allowed per client per hour, the 11th denied; hitting the
  limit returns `allowed: false` with `reason: "cliente"`; a DB failure denies
  (fails closed).
- **Intent cache**: same question twice hits the cache and does not call the
  provider; changing `SYSTEM_PROMPT` or the vocabulary invalidates it, because
  the version is a hash of both.
- **Production integrity guard**: with `NODE_ENV=production` and an enabled
  `demo-%` source, `searchRecords` returns `[]` and `/salud` responds 503.

Do not call the inference provider in any test. Mock `generateObject` or set
`AI_ENABLED=off`.

---

## Task 3 — Translate comments to English

Only after tasks 1 and 2 pass.

**Translate**: comments and JSDoc.

**Do not touch**:

- UI copy, labels, disclaimers — the audience is Spanish-speaking
- User-facing URLs and query params: `?p=`, `?tipos=`, `?mun=`, `?cat=`, `?via=`,
  `?fuera=`, `?fuente=`, `/fuentes`, `/salud`
- `CATEGORY_LABELS`, `STATUS_LABELS`, `RECORD_TYPE_LABELS` values
- `verificationLabel()` return strings
- `SYSTEM_PROMPT` and the Zod schema keys it drives (`tipos`, `municipio`,
  `categorias`, `texto`) — the prompt is Spanish because the questions are
- Spanish keyword tables: `CATEGORY_KEYWORDS`, `QUERY_STOPWORDS`,
  `OUT_OF_SCOPE_PATTERNS`, `AMBIGUOUS_WITH_NEIGHBORHOODS`,
  `MUNICIPALITY_ALIASES`, `PLACE_PREPOSITIONS`, `BENEFICIARY_PREPOSITIONS`
- `docs/`, `README.md` and `IMPLEMENTATION_PLAN.md` unless asked separately

Files with Spanish comments, roughly by density:

```
src/lib/normalize.ts        src/lib/intent.ts
src/lib/search.ts           src/lib/vocab.ts
src/lib/guards.ts           src/lib/ratelimit.ts
src/lib/intent-cache.ts     src/lib/relate.ts
src/lib/ai.ts               src/lib/format.ts
src/db/schema.ts            src/db/index.ts
src/ingest/*.ts             src/ingest/adapters/*.ts
src/app/**/*.tsx            src/components/*.tsx
src/middleware.ts           config/deploy.yml
infra/postgres/init/*.sql   scripts/*.mjs
```

Preserve the reasoning. Several comments explain decisions that look wrong
without them — the beneficiary prepositions, deterministic-only out-of-scope
detection, `reasoning_effort: low` being a requirement rather than a tweak, why
search results are never cached. A comment that loses its *why* is worse than
no translation. Keep measured numbers (`2492ms → 56ms`, `29 vs 86`, `7/8`).

Identifiers are already English except the Spanish-facing ones listed above.
Leave them.

---

## Definition of done

- `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` all pass
- `pnpm test:integration` passes against a local Postgres
- `pnpm build` passes, and `docker build .` passes (the build must not connect
  to a database — a previous bug had it reaching the dev DB)
- Both adapters still report 8 and 86 from their fixtures
- No behavior change: no altered thresholds, prompts, limits, or SQL semantics
- No secret committed. Verify `.env` and `.kamal/secrets` are untracked
- Commits in English, one per task
