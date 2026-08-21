# Buscador de ayuda — Colombia earthquake

### **https://emergenciacolombia.org**

One question box in Spanish that searches across several emergency websites at
once. Every result says where it came from, when the source last updated it, and
links back to the original.

It does not accept new reports. It does not verify information. It does not
replace the 123 emergency line.

> Docs are in English; the interface is in Spanish. The audience is people in
> Valle del Cauca and the Eje Cafetero — see `CONVENTIONS.md`.

MIT licensed. Take whatever is useful: the vocabulary, the DANE boundary
lookup, the provenance model. No reciprocity expected — other collectives are
building their own tools and connecting beats converging.

---

## Current state

**Live at https://emergenciacolombia.org**, serving three connected sources
across Valle del Cauca, Risaralda, Caldas and Quindío. Each source is ingested
on its own schedule, every 10 to 20 minutes.

Live counts are on [/fuentes](https://emergenciacolombia.org/fuentes), per
source and always current. They are not repeated here: a number typed into a
README is true on the day it is typed and silently wrong afterwards. As of
2026-08-14 the catalog was around 900 records over 66 municipalities.

Done:

- Immutable observations with full provenance per source.
- Deterministic search: Spanish full-text, accent- and typo-tolerant, filtered
  by type, municipality and category.
- Natural-language question box. The model turns a question into filters and
  never sees a record; any failure degrades to deterministic search.
- **Municipality computed from coordinates** against DANE boundaries, in
  JavaScript at ingest time — no PostGIS.
- Cross-source disagreement warnings, matched by address, without merging.
- **"The source no longer publishes this"** when a record drops out of a feed —
  never deleted, because absence is not proof it closed.
- **"We don't reach there yet"** when a question names a municipality outside
  the covered area, instead of quietly answering about somewhere else.
- Freshness and verification labels that name who claims what.
- Deterministic out-of-scope detection routing to official channels, including
  a dedicated path for questions about injured or missing people.
- Per-record change history.
- Rate limiter that never stores an IP, abuse tracking, flood shedding.
- Production data-integrity guard, count-collapse quarantine.
- Daily database backups, cron-driven ingestion, Cloudflare Tunnel.

Deliberately not done:

- Map, offline PWA, exports.
- Deduplication engine with a moderation queue.
- Individual needs, pets, missing persons (see *Data scope*).
- Relevance/recency blended ranking.

Known gaps:

- **Coverage is thin outside the four departments.** ~279 records carry no
  municipality because they fall outside the loaded boundaries.
- `RECORD_TYPES_V1` has no type for "an operation in progress", so rescue
  points are filed as service points, which reads slightly wrong.
- `AMBIGUOUS_WITH_NEIGHBORHOODS` was assembled from naming conventions rather
  than a gazetteer, and needs review by someone with local knowledge.
- Relevance and recency are not blended in the ordering.

---

## Run

```bash
cp .env.example .env
docker compose up -d db
pnpm install
pnpm db:push
pnpm db:seed
pnpm dev
```

http://localhost:3000

```bash
docker compose --profile tools up -d    # + Adminer on :8080
pnpm typecheck
pnpm build
pnpm db:reset                            # drops the volume and recreates
pnpm lint && pnpm test                   # no database needed
pnpm test:integration                    # needs Postgres
pnpm ingest mapa-emergencia              # live
pnpm ingest donde-ayudo-valle --fixture  # offline
```

To enable the natural-language box, set `DO_GRADIENT_API_KEY` and
`AI_ENABLED=on`. Without them the app still works, searching the text as typed.

---

## Documentation

| Document | For |
|---|---|
| [docs/USING-THE-BOT.md](docs/USING-THE-BOT.md) | What to ask, how to read a result, what it will not answer |
| [docs/ADDING-A-SOURCE.md](docs/ADDING-A-SOURCE.md) | The most valuable contribution: connecting one more source |
| [docs/VOCABULARIO.md](docs/VOCABULARIO.md) | **Contributing without writing code**: the words the search understands |
| [docs/DEPLOY-PROXMOX.md](docs/DEPLOY-PROXMOX.md) | Deploying to a Proxmox LXC with Kamal, including the nesting requirement |
| [docs/DOMINIO-CLOUDFLARE.md](docs/DOMINIO-CLOUDFLARE.md) | Domain and Cloudflare Tunnel, and what stays off the public internet |
| [docs/MUDANZA-DE-HOST.md](docs/MUDANZA-DE-HOST.md) | Moving the deployment to another host without touching DNS |
| [CONVENTIONS.md](CONVENTIONS.md) | Language rule, comment style, how to run the tests |
| [AGENTS.md](AGENTS.md) | Orientation for AI agents: the ten invariants, and where the traps are |

## The bot: the model translates the question, never the answer

```
"dónde puedo llevar agua en Palmira"
  ↓  one call, strict schema, temperature 0
{ tipos: ["collection_point"], municipio: "Palmira",
  categorias: ["water"], texto: null }
  ↓  Zod validates; code resolves the DANE code
deterministic SQL
  ↓
result cards with provenance
```

The model **never sees a catalog record**, so it cannot invent a shelter. That
removes hallucination risk by construction rather than trying to measure it away.

Consequences of the design:

- The model emits municipality **names**, not codes. `resolveMunicipality` maps
  them, so it cannot invent an identifier.
- Every value it emits comes from an enum derived from `src/lib/vocab.ts`.
- Any failure — provider down, invalid JSON, timeout, quota — falls back to
  plain text search. Nobody sees an error.
- After resolving, it redirects to a URL with explicit filters. Editing or
  removing a chip costs no further inference.
- Out-of-scope detection is deterministic and runs **before** spending a call.

No conversation history and no streaming: for "dónde llevo agua en Palmira" a
conversation adds nothing and costs bandwidth.

### What was removed from the model, and why

Five times, moving a task from the model into code improved accuracy and cut
cost:

| Task | Why it moved |
|---|---|
| Categories | The model confused the 17-value enum systematically: "agua" → `communications`, "comida" → `transport`. A keyword table does not. |
| DANE codes | The model emits names; code resolves identifiers, so it cannot invent one. |
| Municipality in the question | The model skipped it ~1 in 8 times *even when written verbatim*. Worse, asked about "Buga" it once answered "Bugalagrande" — a real municipality 40 km away. Resolving names rather than codes stops it inventing an identifier, but not inventing a name that exists. Reading the question first does. |
| Out-of-scope flag | It fired at random. "Dónde puedo llevar agua en Palmira" came back blocked on one run and fine on the next. |
| Categories, entirely | Asked "hubo réplicas anoche" it answered shelter + hygiene + communications, which filtered out every seismic event and returned nothing. |

That last one mattered most. A false positive **denies an answer to someone who
just wants to donate water** — the worst outcome this site can produce. A false
negative only runs a search, and the 123 notice is pinned at the top of every
page regardless. Between failing by blocking and failing by searching, it fails
by searching.

The model keeps the one thing code does not do well: understanding what someone
is looking for when they do not use the vocabulary's words.

---

## Sources

Verified 2026-08-12/14 by reading each `robots.txt` and one public page.

Record counts below are the order of magnitude each source contributes, not a
live figure — [/fuentes](https://emergenciacolombia.org/fuentes) has those.

| Source | robots.txt | State | Detail |
|---|---|---|---|
| mapa-emergencia | none | **connected** (~780) | Feed agreed with the owner, who published `/api/publico` on request. Carries staffing per point — how many volunteers are there and how many are missing — which no other source has. Its conditions are encoded, not just promised: a record without a confirmation time is not ingested. |
| pereira-ayuda | none, invites indexing | **ready, disabled** (21) | Albergues and health points in Pereira, Dosquebradas, La Virginia and Santa Rosa de Cabal, kept up by young people from the city who visit the sites. Read from `/p/sitemap.xml`, the curated listing the source itself marks indexable — it already separates institutional points from the ~550 person-level requests it deliberately `noindex`es. Three of the 24 carry a phone and are dropped: a contact means it is somebody's request, not a place. |
| Donde Ayudo Valle | none | **connected** (95) | No API at all: collection points are embedded in a static JS chunk. |
| Cali Ayuda | none | **disabled** | Nine records, none with an address — the source does not publish them. Its contribution became noise once a richer source covered the same city. |
| terremotocolombia.co | **yes** | **blocked** | Allows `/`, disallows `/api/`, naming `Claude-User` and `Claude-Web` explicitly. All record data loads from that API. Needs owner agreement. |
| reddeapoyocolombia.com | yes | **no data yet** | `/misiones` renders server-side but is empty today: *"preferimos mostrar cero antes que mostrar una sin verificar"*. |
| CORAG (`ayuda.corag.app`) | none | **in conversation** | MCP with four read tools, including search by category and proximity. 37 collection points with coordinates fit v1; the rest are individual requests and offers, which do not. Publishes WhatsApp as a first-class field with per-person consent. |
| SGC (seismic) | none | **connected** (13) | `archive.sgc.gov.co/feed/v1.0.1/summary/*.json` — static versioned GeoJSON, current to the minute. Colombia only, since the incident date, filtered by felt reports. |
| SNIGRD | none (404) | not investigated | Government, public, no declared restriction. |
| QuakeReport | — | not a source | Open source with a public API. A collaborator, not something to scrape. |
| pet sources | various | out of v1 scope | See *Data scope*. |

**terremotocolombia.co will not be worked around.** Driving a browser to make it
call `/api/` would circumvent the rule they declared. It waits for an agreement.

**Static assets before APIs.** Where both exist, read the static asset: a
CDN-served file costs the source owner nothing, while polling their API spends
the quota and database of a volunteer-run service during an emergency.

### Source maturity

Sources are not filtered by "how much work" or "how much info". Instead each
level has an explicit exit criterion, so "pending" is not a judgment call.

| Level | Meaning | To advance |
|---|---|---|
| `investigated` | `robots.txt` and one page read; readability and cost known | Confirm access basis and that there is data |
| `blocked` | Terms or `robots.txt` forbid the path the data arrives by | Written agreement. **No exceptions.** |
| `no data` | Readable and permitted, but publishes zero records today | Wait. A parser cannot be validated against zero records. |
| `connected` | Ingests, is idempotent, passes the count-collapse guard | — |

**Why the source set was not cut to one.** With a single source the product is a
mirror of Donde Ayudo, and the two features that are the whole thesis — citing
several sources and showing when they disagree — stop being demonstrable. The
sets were also checked and **do not overlap**: Cali Ayuda contributes a shelter
and a rescue site that Donde Ayudo cannot have, because Donde Ayudo is
collection points only.

### Cali Ayuda: why only the points

The page carries three kinds of report. "Necesidad" and "Oferta" belong to
individuals and many carry **a phone number and a first name**; copying those is
processing personal data that needs a legal basis and an agreement with the
source. Only "Punto de ayuda" is ingested, and phone numbers are redacted anyway
in case the format changes.

The source publishes some descriptions with the first letter cut off ("e
necesita" instead of "Se necesita"). That is a bug in the source, verified in
their original HTML. It is not corrected by guessing: what they published is
preserved, and the card links to the original.

### Donde Ayudo: chunk discovery

No API. The points live in a content-hashed static JS chunk, so the filename
changes on every deploy and cannot be pinned:

```
GET /              → <script src="/assets/index-XXXX.js">
GET that bundle    → list of "assets/*.js" it imports
GET each candidate → use the first one containing the data marker
```

If they change bundler, discovery fails explicitly instead of returning zero.

Not copied: `contactos` (WhatsApp, phone, Instagram) and `verificadoPor`, which
holds the **name of the volunteer** who verified the point. The fact of
verification is kept; the identity of who did it is not.

### What quality actually protects

The risk is not thin records — it is **a parser that breaks halfway.** Fully
broken detects itself (zero records). The dangerous one finds 3 of 8: the run
"succeeds", and the missing 5 are not deleted (nothing is ever deleted on
absence) but stop being reconfirmed and go stale with no explanation.

1. **Count-collapse quarantine.** A run returning more than 40% fewer records
   than what is stored writes nothing and errors as `CUARENTENA`. Verified by
   truncating a fixture: 29 against 86 is rejected. If the drop is real, use
   `pnpm ingest <slug> --forzar`.
2. **Per-source completeness** on `/fuentes`: how many records have a
   municipality and how many have an address, measured on each record's *latest*
   observation.
3. **Soft quality ordering.** Among similarly relevant results, the one with
   municipality, address and hours comes first. Nothing is hidden.

Measured against the committed fixtures, which is why these numbers are lower
than the live ones in *Sources* above and will not move as the sources do:

| Source | Records | Municipality | Address | Hours |
|---|---|---|---|---|
| Donde Ayudo Valle | 86 | 86 | 86 | 12 |
| Cali Ayuda | 8 | 0 | 0 | 0 |

The live equivalent, per source and always current, is on `/fuentes`.

Cali Ayuda is also the most fragile parser in the repo (React RSC payload). If it
breaks and fixing it is not worth it, disable the source and the site keeps
working — which is why sources start at `enabled = false` and are turned on one
at a time.

---

## A municipality name in text is not a location

Three traps found with real data, all handled in `findMunicipalityInText`:

1. **Beneficiary ≠ location.** "Campaña de solidaridad **con** Versalles" is a
   collection point *in Cali* gathering aid *for* Versalles. "Recolección
   **para** Tuluá" likewise. `para`, `hacia` and `con` mark who the aid is for;
   only `en`, `de` and `del` say where the point is. Treating the first group as
   locative sent records to the wrong municipality.
2. **Proper nouns matching municipality names.** "Colegio San Pedro Claver de
   Cali" is not in the San Pedro municipality. The locative preposition is the
   signal that separates them.
3. **Municipalities that are also neighborhoods and *corregimientos*.** San
   Pedro is a Valle municipality (76670), a *corregimiento* of Buga, and a Cali
   neighborhood; Versalles is a municipality and a well-known Cali
   neighborhood. Those names are only accepted with a locative preposition,
   never on a bare mention.

`AMBIGUOUS_WITH_NEIGHBORHOODS` in `src/lib/normalize.ts` lists the group in
point 3. **It was assembled from naming conventions, not from a neighborhood
gazetteer — someone with local knowledge should review it.**

### Missing municipality: fixed in search, not by inventing data

Cali Ayuda publishes **neighborhoods**, not municipalities. Assuming "everything
is Cali" would have mislabeled the Versalles record.

The real problem was recall, not data quality: a record without a municipality
was invisible when filtering by Cali. Two mechanisms, no fabricated geography:

1. **Read what the source did say.** `findMunicipalityInText` looks for
   municipality names in the title and description.
2. **Declared coverage per source.** `sources.coverage_admin1_code` stores the
   department a source claims to cover. When filtering by a municipality in that
   department, records without a municipality from that source **appear
   labeled** "la fuente no especificó municipio", instead of being invisible or
   receiving an invented location.

Filtering by Cali went from 0 to 7 real Cali Ayuda records. The resolved
municipality is part of the content hash, so improving geographic resolution
produces a new observation instead of being hidden as "unchanged".

---

## Similar information: everything is shown, always with its source

**Nothing is merged and no winner is picked.** An answer is not "one specific
fact from one source": it is everything the connected sources publish about it,
each with its origin, date and link. Three distinct cases, none of which
collapses records:

**1. Same place, different sources.** Both are shown, with a "another source may
be describing the same place" note and, when the statuses contradict, a
**"las fuentes no coinciden"** warning quoting each one. Detection is an
in-memory hint over the results on screen (`findPossibleSameplace`), not a
deduplication engine: no candidate table, no moderation queue, and it cannot
merge.

The metric is the overlap coefficient, not Jaccard: sources title the same place
with different verbosity. For "Albergue Palmira norte - sin cupo" against
"Albergue Palmira norte - reportan que sigue abierto", Jaccard gives 0.33 and
separates them; overlap gives 0.67.

**2. Different places with the same name.** There are **17 records titled "Centro
Temporal de Acopio", with 17 different addresses.** All 17 are shown, and since
the repeated title made them look identical, the heading carries what
distinguishes them — "Centro Temporal de Acopio · Metropolitano del Norte".

**3. Same place and source over time.** Observations are immutable. The list
shows the latest; the full history is at `/r/[id]`.

Not built yet: blending relevance with recency in the ordering. Today it orders
by relevance, then completeness, then date.

---

## Rate limiter: by cookie, not by IP

**IP is not the primary key, deliberately.** During an emergency people share
networks: a shelter's wifi, a hospital, a university, a mobile carrier's NAT.
Limiting by IP means throttling an entire shelter because one person asked ten
questions.

Three keys, in order of precision:

| Key | Limit | What it protects against |
|---|---|---|
| Signed per-browser cookie | 10/hour, 30/day | One person spending another's quota |
| Truncated network (HMAC of /24 or /48) | 60/hour | Someone with many cookies on one network |
| Global | 20/minute | Distributed abuse, and the provider budget |

- The cookie is a random UUID **signed with HMAC**, issued in middleware (a
  server component cannot write cookies). Signed so the limit cannot be dodged
  by editing it.
- **No IP is stored.** It is truncated to the network and keyed-hashed, which
  groups without identifying.
- Clearing the cookie recovers quota. Accepted: the real ceiling is the network
  and global limits, and a bypass costs cents. The goal is not perfect control,
  it is that nothing runs away.

**Fixed windows, not sliding.** A fixed window is one atomic `UPSERT`, so
concurrent requests cannot race. A sliding window would need every timestamp
stored. The cost is burstiness at the window boundary, which is acceptable here.
Reset is by clock, not gradual refill.

**It only limits inference.** When the quota runs out the box falls back to plain
text search with a notice and still returns results with their sources.
Verified: with the quota exhausted, 37 results. Nobody loses the ability to
search for water because a neighbor spent the quota.

**It fails closed.** If the counter query errors, inference is denied — safe,
because deterministic search does not depend on it.

Timeout is a separate concern and already existed: 12 s abort per model call and
a single retry.

---

## Cache: the interpretation, never the answer

What is cached is the translation "Spanish question" → filters. That does not go
stale. **Catalog records are always queried fresh.**

Measured: the same question goes from **2492 ms to 56 ms** — 44× faster and
without touching the provider. And because the cache is consulted *before* the
quota, a repeated question consumes nobody's limit, so the quota stretches much
further than the numbers suggest.

- The question is **never stored**: the key is an HMAC of the normalized text. A
  question can contain a name, an address, or health information.
- The prompt version is **derived by hash** from the prompt and the vocabulary
  rather than maintained by hand, so changing a rule or adding a category
  invalidates the cache automatically.

Deliberately not cached: search results. Serving "open" after a place closed is
exactly the failure this project exists to prevent. Historical seismic queries
do not need it either — 52–234 rows with indexes is a sub-millisecond query.

---

## Production data integrity

Three layers so a fabricated shelter is never served. `db:seed` already refuses
to run with `NODE_ENV=production`, but that protects the script, not the
database: a database restored from a development backup arrives with demo
sources enabled.

1. **Query exclusion.** In production, `searchRecords` cannot return a record
   from a `demo-%` source, even if someone enables it by hand.
2. **Short-circuit in search.** If the guard fails, `searchRecords` returns empty
   without querying. Without this the page still ran the query and the results
   landed in the RSC payload of the HTML: invisible, but served. "Not serving"
   has to mean they do not leave, not that they are not seen.
3. **Visible wall.** The layout replaces all content with a block page showing
   only the 123 number, and `/salud` responds **503** so monitoring sees it.

Verified in a real production build against the database with demo data: wall
shown, zero records in the HTML, `/salud` at 503. With demo sources disabled it
serves normally — a gate, not a permanent block.

```sql
DELETE FROM sources WHERE slug LIKE 'demo-%';
```

---

## Geography

All 1121 municipalities come from DANE's Marco Geoestadístico Nacional (MGN
2024), `Municipio` layer of the FeatureServer:

```bash
node scripts/fetch-municipios.mjs
```

Generates `src/lib/data/municipios.json`. Not hand-edited. Use the
**FeatureServer**, not MapServer: the equivalent MapServer returns incomplete
attributes.

67 municipality names repeat across departments, 7 of them in Valle (La Unión,
Candelaria, Bolívar, Argelia, La Victoria, Restrepo, San Pedro).
`resolveMunicipality` resolves in this order: exact within the operating
department, exact nationally if unique, partial within the department. If a name
is ambiguous outside the operating area it returns `null` and the text stays a
free-text search — better than silently filtering by the wrong municipality.

`OPERATING_ADMIN1_CODES` (default `76,66,17,63` — Valle del Cauca, Risaralda,
Caldas, Quindío) sets the coverage area; the first one names it in the
singular. Adding a department is downloading its DANE boundaries and adding the
code, with no logic to touch. The data model
supports the whole country.

---

## Data scope: the line that needs no lawyer

v1 ingests **institutional records only**: collection points, service points,
shelters, official updates, hazards, seismic events. That list is
`RECORD_TYPES_V1` in `src/lib/vocab.ts`, which is the authority.

Individual needs with contact details, pets and people are out. That line is
defensible without prior legal review — under Ley 1581 health data is sensitive
and requires explicit consent — and it covers most of the value for people
coordinating logistics. Individual records are handled by linking to the source,
not copying them.

**Contact details are the one exception, and only in one direction.** Since
2026-08-14 a phone number is mirrored when the source collects authorization
per person and declares it (`mirrorsContacts`, e.g. CORAG). It lives in the
record's current state, never in the history, so a takedown at the source
propagates on the next read. Scraping a number off a site that never consented
is still forbidden, and no contact ever enters the indexed text — nobody should
be findable *by* their phone number. See invariant 6 in `AGENTS.md`.

`RECORD_TYPES_GATED` in `src/lib/vocab.ts` lists the types that need a privacy
review and/or a source agreement before being enabled.

---

## Deployment

**Not a monorepo**: a single Next.js app at the repo root, so Vercel works with
no configuration. Both paths are ready.

### Where it is hosted matters more than what with

This site reports on an earthquake in Valle del Cauca. Hosting it in a homelab
**inside the affected region** makes it a single point of failure correlated with
the event itself: if an aftershock cuts power or internet, the site goes down
exactly when it is needed most.

A private network (Tailscale) is for administration, not publication: if people
in Cali need to open it, it has to be on the public internet.

For this project: a VPS outside the region, or Vercel.

### Kamal

`config/deploy.yml` is a template; replace everything marked `CAMBIAR`. It
includes Postgres as an accessory, or drop that section for a managed one.

The healthcheck points at `/salud`, which returns **503 when demo sources are
enabled**, so a deploy with fake data in the database **fails** rather than
serving it — Kamal will not promote the container, and the reason is in the
container logs.

```bash
kamal setup     # first time
kamal deploy
```

### Vercel

Works as is. Needs a Postgres reachable from the internet (Neon, Supabase — a
homelab behind Tailscale is not), `pnpm db:push` plus `src/db/indexes.sql` and
`src/db/answer-feedback.sql` once,
and Vercel Cron calling `/api/ingest`.

### Scheduled ingestion

`POST /api/ingest?fuente=<slug>` with `Authorization: Bearer $INGEST_SECRET`.
One source per call, to stay inside execution time limits. Without
`INGEST_SECRET` configured the route returns 503: an unauthenticated ingestion
endpoint is never exposed by accident.

**One line per connected source.** A slug missing from the crontab is a source
that never updates again, and nothing reports it: the site keeps serving that
source's last observations, which go stale silently. Today that means three
lines — `cali-ayuda` is disabled and deliberately absent.

The URL below assumes `/api` is reachable by the caller, which is true on
Vercel. **Behind the Cloudflare Tunnel it is not**: the middleware answers `404`
to anything carrying `CF-Connecting-IP`, so the cron has to run on the host and
reach the container directly. See `docs/DEPLOY-PROXMOX.md` and
`docs/DOMINIO-CLOUDFLARE.md`.

```bash
*/15 * * * * curl -fsS -X POST "https://DOMAIN/api/ingest?fuente=mapa-emergencia"   -H "Authorization: Bearer $INGEST_SECRET"
*/15 * * * * curl -fsS -X POST "https://DOMAIN/api/ingest?fuente=donde-ayudo-valle" -H "Authorization: Bearer $INGEST_SECRET"
*/10 * * * * curl -fsS -X POST "https://DOMAIN/api/ingest?fuente=sgc-sismos"        -H "Authorization: Bearer $INGEST_SECRET"
```

Codes: `200` ingested, `409` quarantined by count collapse (wrote nothing),
`502` the parser found no records, `401` invalid secret.

The authoritative list of slugs is `ADAPTERS` in `src/ingest/registry.ts`
(`pnpm ingest` with no argument prints them). Adding a source means adding a
cron line; there is nothing that will notice if you forget.

### Inference spend report

`POST /api/reporte-uso` with the same bearer secret posts a usage summary to
Discord — today, the last 7 days, and the running total, aggregated by Bogotá
day. Only daily totals are stored: no questions, no users. Without
`DISCORD_WEBHOOK_URL` it sends nothing and does not fail, so it is safe to
schedule before the webhook exists.

```bash
0 * * * * curl -fsS -X POST "https://DOMAIN/api/reporte-uso" -H "Authorization: Bearer $INGEST_SECRET"
```

### Answer feedback

Under every answer: *¿Te sirvió?*, two buttons, and a case code. A thumbs-down
opens an inline panel — never a dialog — with fixed reason chips.

**Nothing anybody types is stored by default.** Ratings, reason chips and
machine-generated context are; the question text and the free comment are not,
unless `FEEDBACK_TEXT=on` **and** the person ticks the consent box **and** it is
a thumbs-down. All three, every time. With the flag off, no personal data is
processed at all — which is the point: the obligations that come with holding it
(privacy notice, consent, deletion rights, a channel that answers) do not attach
until somebody decides to turn it on. `src/db/schema.ts` already ran this
calculation once for IP addresses and declined it.

**Before turning it on:** `/privacidad` and the contact address on `/terminos`
are in place. What is left is not code — somebody has to actually read
`hola@rodarlibre.co` for deletion requests, and `INGEST_SECRET` should be split
so the route that reads personal data is not guarded by the credential sitting
in the host crontab.

The case code under each answer is the only handle a person has on their own
row — there are no accounts. It is how a bad answer gets reported without
sending us the question, and how a deletion request identifies what to delete.

```bash
curl -s        ".../api/feedback"              -H "Authorization: Bearer $INGEST_SECRET" | jq
curl -X DELETE ".../api/feedback?caso=7F3A21B4" -H "Authorization: Bearer $INGEST_SECRET"
```

Two rows can share a case code — it is 8 hex characters of the uuid — so the
delete refuses with `409` and lists the candidates rather than guessing. Repeat
with `?id=` to pick one.

**The table is not created by `pnpm db:push`.** Apply it once, explicitly:

```bash
psql "$DATABASE_URL" -f src/db/answer-feedback.sql
```

`push` diffs the whole schema against the live database. For a new table it
emits a clean `CREATE`, but if production has drifted at all it also proposes
changes to `observations` and `source_records` — the catalog. The `.sql` file is
one idempotent statement you can read before it runs. `src/db/schema.ts` still
owns the definition; the two have to say the same thing.

**Retention has no cron of its own.** The hourly spend report below also clears
`question_text` and `comment` on rows older than `RETENTION_DAYS`, so there is
one schedule to know about instead of two. Its response carries `purged` and
`purgeFailed` — without that second field, "nothing expired" and "the sweep has
been broken for six weeks" look identical, and the second one means consented
text is outliving what the checkbox promised. With `FEEDBACK_TEXT` off there is
nothing to clear and the sweep is a no-op.

`AI_BUDGET_USD` turns the report into a runway estimate; the token prices it
costs against are `AI_PRICE_INPUT_USD_PER_MILLION` and
`AI_PRICE_OUTPUT_USD_PER_MILLION`, which are not fetched from the provider — if
they change and these do not, the reported cost lies.

The CLI (`pnpm ingest`) uses the same logic, so scheduling does not depend on the
platform.

### The build must not touch the database

`next build` must not connect to Postgres. The integrity guard skips during
`NEXT_PHASE=phase-production-build` and the home page is `force-dynamic`.
Without that the Docker build failed with `ECONNREFUSED` — and locally it
"worked" because it was connecting to the development database, which is worse
than failing.

---

## Inference provider findings

Measured against the real DigitalOcean Gradient endpoint, not assumed:

- **`json_schema` does work**, but the SDK needs `supportsStructuredOutputs:
  true`. Without that flag it refuses to send `response_format` and every
  extraction falls back.
- **`reasoning_effort: low` is mandatory.** `gpt-oss` models reason before
  answering and bill those tokens as output. At medium effort they spend 800+
  tokens reasoning, finish with `finish_reason: "length"`, and **never emit
  content**. At low they answer in ~80 tokens.
- **The output ceiling must be high** (700) even though the object is ~80
  tokens: the headroom is for reasoning.
- Measured latency: 1.6–2.6 s typical, with spikes past 10 s.

### Model choice: `gpt-oss-20b`

Over 8 representative questions, same prompt:

| | Type correct | Municipality correct | Mean latency |
|---|---|---|---|
| `gpt-oss-20b` | 7/8 | 7/8 | 1520 ms |
| `gpt-oss-120b` | 7/8 | 7/8 | 2914 ms |

Same accuracy, twice the latency, twice the input cost, and the `120b` had a
9.6 s spike that fell back. With deterministic municipality detection on top,
20b reaches **8/8 and 8/8 at 1210 ms**.

Cost is not the constraint: at listed prices USD 140 buys roughly 2 million
intent extractions. Abuse is the constraint, which is why the rate limiter lives
in Postgres and not in a separate cache service.

---

## Differences from IMPLEMENTATION_PLAN.md

The plan remains the reference for principles. These decisions depart from its
execution shape, with the reason:

| Plan | Here | Why |
|---|---|---|
| Monorepo, 2 services + 6 packages | One Next.js app | One language, one process: the workspace and codegen buy nothing yet. Promoting later is mechanical. |
| TypeScript + Python 3.13 + uv | TypeScript only | Avoids a second runtime and an OpenAPI contract between two languages. |
| Ingest writes via an internal HTTP API | Writes directly | Correct for a mature system; overhead today. |
| PostgreSQL 16 + PostGIS | `postgres:17-alpine` | v1 filters by municipality, not radius. The PostGIS image runs emulated on Apple Silicon. One line to change. |
| Valkey for AI budgeting | Not used | The rate limiter already caps spend, and the budget was never the risk. Declared in compose under the `cache` profile, off. |
| `canonical_records` + `duplicate_candidates` + moderation queue | In-memory hint, no merging | The queue needs 24/7 moderators who do not exist. Showing sources side by side with disagreement labeled delivers the value without the staffing. |
| Chat with a tool loop, synthesis over 5 records, 50-case eval suite | `generateObject` for intent only | See *The bot*. What remains is one test: does it emit valid schema JSON for Spanish questions with typos? |
| Filter UI, chat as an addition | The box **is** the interface | There are already N sites with N search UIs. What is missing is one question that spans them. |

Plan principles kept without negotiation: provenance before intelligence,
immutable observations, never delete on absence, freshness as presentation
rather than truth, no CAPTCHA or `robots.txt` circumvention, no automatic
merging, sources disabled by default.

---

## Structure

Load-bearing files only. Tests sit next to what they test.

```
src/
├── app/            routes (/, /fuentes, /r/[id], /salud,
│                   /api/ingest, /api/reporte-uso) + actions.ts
├── components/     Chat, ResultCard, DataIntegrityBlock, Nav, ThemeToggle, ui/
├── db/             drizzle schema, client, *.sql            ← sole schema owner
├── ingest/
│   ├── adapters/   one file per source
│   ├── registry.ts adapter registry, shared by CLI and cron route
│   ├── upsert.ts   catalog writes + quarantine guard
│   ├── types.ts    ParsedRecord contract, contact redaction
│   └── seed.ts     fake development data
├── lib/
│   ├── ai.ts          sole place a provider client is constructed
│   ├── probe.ts       provider reachability check
│   ├── intent.ts      the whole bot
│   ├── scope.ts       out-of-scope detection — no imports, on purpose
│   ├── answer.ts      what the page says about a result set
│   ├── search.ts      deterministic search — sole path to the catalog
│   ├── vocab.ts       controlled vocabulary — single source of truth
│   ├── normalize.ts   folding, geography, categories
│   ├── spanish.ts     Spanish morphology (verbs, euphonic "y"/"e")
│   ├── geo.ts         point-in-polygon against DANE boundaries
│   ├── relate.ts      "possibly the same place" hint
│   ├── ratelimit.ts   inference quota
│   ├── abuse.ts       abuse tracking and flood shedding
│   ├── client-ip.ts   truncate + keyed-hash, never store an IP
│   ├── intent-cache.ts
│   ├── usage.ts       daily inference totals — no questions, no users
│   ├── costo.ts       token totals → dollars
│   ├── reporte.ts     the usage report's text
│   ├── discord.ts     posts it to the webhook
│   ├── guards.ts      production integrity
│   ├── config.ts      static process.env reads (Edge runtime, see AGENTS.md)
│   ├── data/          municipios.json, limites-municipios.json, vocabulario.json
│   └── format.ts
└── middleware.ts   issues the signed anonymous cookie, hides /api and /salud
```

`AGENTS.md` and `CLAUDE.md` are generated by `next dev`; project orientation was
appended to `AGENTS.md` and is preserved across regenerations.

## Aportar sin programar

El vocabulario que el buscador entiende está en
`src/lib/data/vocabulario.json`, en un formato editable a mano. Si en tu
municipio se dice "remesa" y no "mercado", o "cambuche" y no "carpa", agregarlo
ahí es el aporte que más rinde. Las reglas están en
[docs/VOCABULARIO.md](docs/VOCABULARIO.md) y los tests avisan si algo quedó mal.
