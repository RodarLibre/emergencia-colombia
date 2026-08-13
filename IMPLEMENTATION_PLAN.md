# Colombia Earthquake Information Federation

## Staged Implementation Plan for AI-Assisted Development

**Status:** Approved implementation baseline  
**Plan date:** 2026-08-12  
**Incident scope:** Colombia earthquake of 2026-08-10  
**Initial operating area:** Cali and Valle del Cauca, with a data model that supports all of Colombia  
**Primary goal:** Ship a trustworthy, read-only federation layer over existing community and official emergency-information systems.
**Selected AI inference:** DigitalOcean Gradient Serverless Inference using `openai-gpt-oss-20b` and `openai-gpt-oss-120b` behind a provider-independent server-side adapter.

---

## 1. Executive summary

The project should not become another place where people must create and maintain duplicate reports. Its first useful form is a read-only information federation service that:

1. Collects public records from participating websites and official sources.
2. Preserves the source, source URL, timestamps, and verification claims of every observation.
3. Normalizes records into a shared humanitarian schema.
4. Detects likely duplicates and contradictory updates without hiding either source.
5. Offers deterministic text and geographic search through a low-bandwidth PWA.
6. Adds a constrained chatbot that translates natural-language questions into database searches and cites every returned record.

The recommended architecture is a mixed TypeScript/Python monorepo:

- `pnpm` manages all TypeScript applications and packages.
- `uv` manages the Python ingestion service, virtual environment, dependency resolution, and lockfile.
- Docker Compose provides PostgreSQL/PostGIS and optional local infrastructure.
- The catalog API is the only service that owns the database schema.
- Python ingestion workers submit versioned observation envelopes through an internal HTTP API.
- An OpenAPI 3.1 document is the language-neutral contract between services.
- `packages/ai` owns model selection, DigitalOcean integration, token accounting, budget enforcement, and provider-independent interfaces.
- OpenCode and Hermes are development/operations tools only; neither is in the public chatbot request path.

The first public release should cover needs, offers, service/collection points, shelters, official updates, and optionally pets. Missing-person records are a separate gated stage because they involve higher privacy, safety, consent, and misidentification risks.

---

## 2. Product principles

These principles are requirements, not aspirations.

### 2.1 Provenance before intelligence

Every result must show:

- Original platform.
- Original permanent link when available.
- When the source says the record was updated.
- When this system observed it.
- Whether the information is official, source-verified, community-provided, disputed, or unknown.

The system must never present a model-generated statement without links to the underlying observations.

### 2.2 Federation instead of republishing

- Prefer documented APIs, feeds, webhooks, or owner-provided exports.
- Use public-page extraction only as a temporary bridge.
- Respect `robots.txt`, rate limits, terms of service, deletion requests, and explicit instructions from source owners.
- Never bypass CAPTCHA, anti-bot challenges, authentication, or access controls.
- Link users back to the original platform for contact details, edits, status changes, or new submissions.

### 2.3 Observations, not a single mutable truth

If Source A says a location needs water at 14:00 and Source B says it is fully supplied at 16:00, both facts must remain visible. The catalog may compute a current interpretation, but it must preserve and display the evidence and the conflict.

### 2.4 Safety over feature breadth

- No automatic structural-safety assessment.
- No medical diagnosis or prioritization by an LLM.
- No facial recognition.
- No automatic merging of missing-person records.
- No exposure of exact residential addresses unless an authorized source explicitly treats them as public operational locations.
- No contact information in LLM prompts, analytics, or client-side caches.

### 2.5 Useful with poor connectivity

- List-first UI; maps are an enhancement.
- Small payloads and pagination.
- A low-bandwidth mode that disables nonessential images and map tiles.
- An offline shell and official emergency contacts.
- Dynamic or sensitive records use network-first behavior and are not silently served as current when offline.

---

## 3. Goals, non-goals, and success metrics

### 3.1 MVP goals

- Ingest at least three authorized sources end to end.
- Search by text, record type, municipality, locality, status, freshness, and distance.
- Show a record detail page containing all linked source observations.
- Display conflicts and stale-data warnings.
- Provide source-health monitoring and parser-failure alerts.
- Support correction, removal, and source-wide deletion propagation.
- Provide a constrained natural-language search interface after deterministic search is stable.
- Make the application installable as a PWA without making offline data look current.

### 3.2 Explicit non-goals for the first release

- Accepting new emergency reports.
- Replacing 123, the SGC, UNGRD/SNIGRD, municipal authorities, the Red Cross, hospitals, police, fire services, or civil defense.
- Dispatching volunteers or rescue resources.
- Verifying bank accounts or collecting donations.
- Ranking human lives or rescue sites with an AI model.
- Mirroring all source photographs or contact information.
- Creating a general-purpose autonomous web-browsing agent.
- Building a native mobile application.
- Using Hermes, OpenCode, or any coding-agent runtime to serve public chatbot requests.
- Adding Kafka, Elasticsearch, or a vector database before measured load requires them.
- Using Valkey outside its narrowly defined Stage 5 duties: short-lived rate-limit counters, budget reservations, and safe response caching.
- Running dedicated GPU inference while serverless inference remains sufficient.

### 3.3 Initial success metrics

Operational metrics should be computed per source and per record type.

- **Ingestion freshness:** 95% of healthy sources observed within their configured polling interval.
- **Provenance coverage:** 100% of public results have a source name, source URL, and observation timestamp.
- **Parser reliability:** less than 2% unexplained extraction failure over a rolling 24-hour period.
- **Deletion propagation:** approved removals disappear from public search and caches within 30 minutes.
- **Search quality:** at least 90% pass rate on a curated set of 50 operational search scenarios.
- **Chat grounding:** 100% of factual result claims have one or more catalog citations; zero invented records in the evaluation suite.
- **AI budget safety:** zero provider calls after the configured hard budget is reached; provider usage reconciles with the internal ledger within the accepted tolerance.
- **Graceful degradation:** deterministic search remains available when the model provider, Valkey, or chat budget is unavailable.
- **Performance:** p95 text search below 500 ms at the catalog API under the expected MVP load.
- **Accessibility:** keyboard-operable core workflow and WCAG 2.2 AA checks on primary pages.

---

## 4. Source inventory and integration policy

This inventory reflects the review performed on 2026-08-12. Counts and technical details will change.

| Source | Primary data | Initial integration approach | Important constraint |
|---|---|---|---|
| [Cali Ayuda](https://cali-ayuda-kappa.vercel.app/) | Needs, offers, service points, urgency, categories | Public HTML adapter, then request a JSON feed | Some records contain phone numbers or health information; redact at ingestion |
| [Donde Ayudo · Valle](https://donde-ayudo-valle.vercel.app/) | Collection points by municipality | Public rendered-page adapter or owner feed | Confirm operating hours and expiry semantics with owner |
| [Terremoto Colombia](https://terremotocolombia.co/) | People, supplies, collection points, shelters, buildings, hospitals, volunteers | Partner API/feed after written confirmation | Its public terms mention an API and federation, but `robots.txt` blocks `/api`; do not consume the API without owner agreement |
| [Mapa de Emergencia](https://mapa-emergencia.artefactofilms.workers.dev/) | High-volume live needs and field updates | Owner-provided feed strongly preferred | High update rate, conflicts, personal details, and operational risk make HTML scraping inappropriate as a first step |
| [Volvé a Casa](https://volveacasa-three.vercel.app/) | Lost and found pets with structured attributes | Public pages/sitemap, then owner feed | `robots.txt` blocks `/api`; do not query private endpoints |
| [Reúne Mascotas](https://reunemascotas.brannd.com.co/) | Lost, found, and reunited pets | Owner feed or rate-limited public-page adapter | Cloudflare challenge must not be bypassed |
| [Mascotas Perdidas / OutSystems](https://personal-hffxivhl.outsystemscloud.com/MascotasPerdidas/) | Paginated lost/found pets | Request JSON/CSV export; browser adapter only as last resort | Dynamic UI and nonpermanent detail links make scraping fragile |
| [Red de Apoyo Colombia](https://reddeapoyocolombia.com/) | Needs published by reportedly verified foundations | Partner feed | Preserve the exact scope of the platform's verification claim |
| [QuakeReport](https://github.com/emorell96/QuakeReport) | Damage, shelters, missing people, collection points | Collaborate through its public API and open-source project | Prefer a shared interchange format instead of duplicating backend functions |
| [SGC earthquake catalog](https://sgc.gov.co/catalogo) | Official seismic event metadata | Official ArcGIS/JSON services | Treat as authoritative only for the fields the SGC actually publishes |
| [SNIGRD](https://www.gestiondelriesgo.gov.co/snigrd/) | Public alerts and emergency information | Official public feed or page adapter | Government sources use a separate trust label, not a blanket guarantee of freshness |

### 4.1-bis Verified source findings (2026-08-12, added during implementation)

Each source below was checked by reading its `robots.txt` and one public page.
This supersedes the "initial integration approach" column above where they
disagree.

| Source | robots.txt | Verified state | Finding |
|---|---|---|---|
| Cali Ayuda | none published | **connected** | `/reports` is server-rendered; no API needed. Only "Punto de ayuda" records ingested — needs/offers carry phone numbers and first names. |
| Donde Ayudo · Valle | none published | **connected** | No API at all: ~86 collection points are embedded in a content-hashed static JS chunk. Richest source found — explicit municipality, street address, opening hours, and real ISO `actualizado` timestamps. Contact list and individual verifier names deliberately not ingested. |
| Mapa de Emergencia | none published | **investigated, not connected** | Cloudflare Worker exposing `/api/snapshot`, `/api/geo`, `/api/puntos/{id}/bitacora`. Technically unrestricted, but high update rate, `wa.me` contact links, and the load falling on one volunteer's Worker make an owner-agreed feed the right first step. `bitacora` (per-point log) suggests it already keeps a confirmation history worth federating properly. |
| Red de Apoyo Colombia | allows `/`, publishes sitemap | **no data to ingest yet** | `/misiones` is server-rendered but currently empty: *"Preferimos mostrar cero antes que mostrar una sin verificar o ya resuelta."* Their needs come from NIT-verified foundations and the flow is direct WhatsApp contact, so link-out beats copying. |
| Terremoto Colombia | **yes** | **blocked** | `robots.txt` allows `/` but disallows `/api/`, naming `Claude-User` and `Claude-Web` explicitly. All record data loads client-side from that API. Requires owner agreement; browser automation to reach it would circumvent the declared rule and is out of the question. |

Two lessons that generalize:

- **Static assets beat APIs when both exist.** Reading a CDN-served JS chunk
  costs the source owner nothing, while polling their API consumes the quota
  and database of a volunteer-run service during an emergency.
- **Municipality names in free text are not locations.** "Recolección para
  Tuluá" and "Campaña con Versalles" name the *beneficiary*, not where the
  collection point is. Treating those prepositions as locative sent records to
  the wrong municipality. See the geographic attribution notes in `README.md`.

### 4.1 Required source-policy record

No connector may run in production until its source has a policy record containing:

- Owner or organization name.
- Technical and removal-request contact.
- Base URL and allowed URL patterns.
- Integration mode: `official_api`, `partner_feed`, `public_html`, or `browser_last_resort`.
- Evidence of permission or public-access basis.
- Relevant terms and `robots.txt` snapshot date.
- Allowed record types and fields.
- Prohibited fields.
- Polling interval and maximum concurrency.
- Raw-content retention period.
- Deletion/correction procedure.
- Whether images may be proxied, stored, or only linked.
- Verification claims that the platform is allowed to make.

The runtime must default to disabled if the policy is absent, expired, or explicitly revoked.

---

## 5. Technology decisions

### 5.1 Monorepo

Use one Git repository. This keeps contracts, fixtures, migrations, product code, and operational documentation in a single atomic change history.

```text
.
├── apps/
│   └── web/                         # Next.js PWA, public UI, admin UI, AI chat route
├── services/
│   ├── catalog-api/                 # Fastify API, domain logic, DB owner
│   └── ingest/                      # Python adapters, scheduler commands, normalization
├── packages/
│   ├── contracts/                   # OpenAPI 3.1, generated TS/Python types
│   ├── db/                          # Drizzle schema, migrations, seeds
│   ├── ai/                          # Model adapters, routing, budgets, safe AI telemetry
│   ├── ui/                          # Small shared accessible component library
│   ├── config-eslint/               # Shared TS lint configuration
│   └── config-typescript/           # Shared strict TS configurations
├── infra/
│   ├── compose.yaml                 # Local infrastructure
│   ├── docker/
│   │   ├── catalog-api.Dockerfile
│   │   ├── ingest.Dockerfile
│   │   └── web.Dockerfile
│   └── postgres/
│       └── init/                    # Local-only extension/bootstrap SQL
├── fixtures/
│   └── sources/                     # Sanitized HTML/JSON fixtures per adapter/version
├── docs/
│   ├── adr/                         # Architecture decision records
│   ├── runbooks/                    # Operations and incident procedures
│   ├── source-policies/             # Reviewed connector policies
│   ├── threat-model.md
│   ├── data-protection.md
│   └── agent-handoffs/              # Work packet completion reports
├── scripts/                         # Thin, portable orchestration scripts only
├── .github/workflows/
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── compose.yaml                     # Optional root include/alias
└── README.md
```

### 5.2 TypeScript package management: pnpm

Use `pnpm` workspaces because it is fast, disk-efficient, strict about undeclared dependencies, and suitable for a multi-package TypeScript repository.

Rules:

- Pin an exact `packageManager` version in the root `package.json`.
- Use Corepack in local setup and container builds.
- Commit `pnpm-lock.yaml`.
- CI and production builds run `pnpm install --frozen-lockfile`.
- Internal dependencies use `workspace:*`.
- Core framework packages use exact versions, not broad ranges.
- Root scripts orchestrate workspace commands with `pnpm --filter` or `pnpm -r`.
- Do not use npm or Yarn in subdirectories.

Suggested runtime baseline: Node.js 24 LTS, pinned in development tooling and Docker images. The bootstrap agent must confirm ecosystem compatibility and record any deviation in an ADR.

### 5.3 Python package management: uv

Yes, use `uv` instead of a manual `pip`/`venv` workflow.

Reasons:

- Fast resolver and installation.
- Reproducible `uv.lock`.
- Manages the virtual environment and Python version expectations.
- Supports development dependency groups and script execution.
- Gives CI a single `uv sync --frozen` path.

Rules:

- `services/ingest/pyproject.toml` is the Python project definition.
- Commit `services/ingest/uv.lock`.
- Pin Python 3.13 initially for broad scraper-library compatibility.
- Use `uv sync --frozen --all-groups` in CI.
- Use `uv run` for Python commands; do not document `pip install` as a project workflow.
- Use Ruff for lint/format, Pyright for static checking, and Pytest for tests.
- If another Python service appears later, convert the Python subtree to a uv workspace in a dedicated ADR.

### 5.4 Web application

- Next.js App Router, React, and strict TypeScript.
- Current stable Next.js version selected and pinned during bootstrap.
- Vercel AI SDK plus `@ai-sdk/openai-compatible` for the constrained chat tool loop.
- Import model construction and routing only from `packages/ai`; application code must not instantiate provider clients ad hoc.
- A minimal accessible component layer in `packages/ui`; avoid a large design-system project during the emergency phase.
- MapLibre GL for maps only after the list workflow is complete.
- A production tile provider or approved self-hosted tiles; do not depend on public OpenStreetMap tiles at emergency traffic scale.
- Server-side calls to `catalog-api`; browser clients should not receive internal service credentials.

### 5.5 Catalog API

- Fastify with strict TypeScript.
- OpenAPI validation at the HTTP boundary.
- Drizzle ORM and migrations from `packages/db`.
- PostgreSQL full-text search, `pg_trgm`, `unaccent`, and PostGIS.
- Cursor pagination, never unbounded result lists.
- Structured JSON logs and OpenTelemetry instrumentation.
- This service is the only database schema owner.

### 5.6 Ingestion service

- Python 3.13.
- HTTP/API adapters use HTTPX.
- Static HTML parsing uses Selectolax or Parsel.
- Scrapy is available for sources that need crawl scheduling, pagination, retries, and AutoThrottle.
- Playwright is an optional, explicitly authorized transport for JavaScript-only sources.
- Pydantic validates raw and normalized records.
- Tenacity or equivalent bounded retry behavior for transient errors.
- Libphonenumber may normalize contact data for HMAC matching, but raw numbers must be discarded unless an approved policy explicitly requires encrypted storage.
- Pillow/imagehash may support pet-image perceptual hashes in a later stage; source images must not be downloaded without policy approval.

### 5.7 AI inference and provider routing

Initial provider decision:

- Use DigitalOcean Gradient Serverless Inference through its OpenAI-compatible endpoint: `https://inference.do-ai.run/v1`.
- Use a dedicated model access key stored only in server-side secret management.
- Use `openai-gpt-oss-20b` for low-cost intent extraction and simple structured searches.
- Use `openai-gpt-oss-120b` only for ambiguous requests, source comparison, conflict explanation, and cases that fail the smaller model's validated capability boundary.
- Keep deterministic catalog search as the zero-inference route and final fallback.
- Evaluate `deepseek-4-flash` as a lower-cost candidate before enabling it; it must pass the same Spanish, structured-output, tool, citation, safety, and privacy tests.
- Treat direct MiniMax access as a future cross-provider continuity option, not as the initial cost-saving route. It requires a separate ADR, account, secret, data-processing review, and evaluation pass.
- Do not call OpenCode or Hermes from the public chatbot. They may be used to develop, test, deploy, or repair the system.

`packages/ai` must expose task-oriented model roles rather than provider/model names:

```text
deterministic_search     -> no model call
intent_extraction        -> openai-gpt-oss-20b
grounded_synthesis       -> openai-gpt-oss-120b
economy_candidate        -> disabled until evaluation passes
external_provider_backup -> disabled until separately funded and approved
```

Provider IDs, model IDs, timeouts, token limits, reasoning effort, budgets, and fallback order are environment configuration validated at startup. No provider API key or raw provider error may reach the browser.

### 5.8 Database and local infrastructure

Start with Docker Compose and PostgreSQL 16 + PostGIS.

Required extensions:

```sql
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
```

Do not add pgvector in Stage 1. PostgreSQL full-text, trigram, and geographic indexes are enough for initial scale. If pet visual similarity later demonstrates value, add pgvector through a tested custom database image or a managed service that supports both PostGIS and pgvector.

Local Compose profiles:

- Default: `db` only.
- `app`: web, catalog API, and ingest worker.
- `ai`: Valkey for Stage 5 rate limits, atomic budget reservations, and short-lived non-sensitive caches.
- `storage`: optional MinIO for short-lived raw snapshots.
- `observability`: optional OpenTelemetry Collector and local trace/log viewer.

Valkey is not a source of truth and must not contain prompts, person names, contact information, catalog records, or durable financial data. PostgreSQL stores the durable AI usage ledger. If Valkey is unavailable, fail closed for model calls and keep deterministic search available. Ingestion jobs continue to use a PostgreSQL-backed job table with `FOR UPDATE SKIP LOCKED`; Valkey is not the ingestion queue.

### 5.9 Production deployment shape

Keep the system portable:

- `web`: edge/serverless-capable Next.js deployment.
- `catalog-api`: long-running container service.
- `ingest`: long-running worker container plus scheduled job/command.
- `db`: managed PostgreSQL with PostGIS and point-in-time recovery.
- `ai counters`: managed Valkey or an equivalently isolated service when chat is enabled publicly.
- `AI inference`: DigitalOcean Gradient Serverless Inference; no dedicated GPU deployment for the MVP.
- `raw snapshots`: S3-compatible encrypted object storage with lifecycle deletion.

A single container host is acceptable for an internal alpha. A public emergency service should move the database to a managed offering before launch. The plan does not require one particular cloud vendor.

---

## 6. Service boundaries

### 6.1 `apps/web`

Owns:

- Public PWA routes.
- Search forms and result presentation.
- Map and list UI.
- Source/provenance views.
- Moderation UI, protected by strong authentication.
- AI SDK chat route and tool orchestration.
- PWA manifest, service worker, offline shell, and low-bandwidth mode.

Does not own:

- Database migrations.
- Scraping.
- Deduplication decisions.
- Source credentials.
- Storage of raw source content.

### 6.2 `services/catalog-api`

Owns:

- Database access and transactions.
- Ingestion-run lifecycle.
- Idempotent observation upserts.
- Canonical-record generation.
- Duplicate candidate generation and merge decisions.
- Conflict representation.
- Freshness calculation.
- Public search and record detail APIs.
- Moderation and deletion APIs.
- Audit log.

### 6.3 `services/ingest`

Owns:

- Source discovery and fetching.
- Source-specific parsing.
- Field redaction before transmission.
- Source-to-shared-schema normalization.
- Content hashing and optional short-lived snapshots.
- Adapter contract tests and fixtures.
- Poll scheduling commands and source health signals.

Does not write directly to PostgreSQL. It sends batches to the catalog API using service authentication and an idempotency key.

### 6.4 `packages/contracts`

Owns:

- `openapi/catalog.openapi.yaml` as the canonical wire contract.
- JSON Schema fragments where useful.
- Generated TypeScript request/response types.
- Generated Python Pydantic models or a generated Python client.
- Contract examples used by integration tests.

Generated files must never be edited manually. CI regenerates them and fails if the working tree changes.

### 6.5 `packages/ai`

Owns:

- Provider-independent model roles and request/response types.
- DigitalOcean OpenAI-compatible client construction.
- Model routing and bounded fallback rules.
- Structured-intent schemas shared with the web chat route.
- Per-model token and cost calculation using an effective-dated price configuration.
- Budget reservation/settlement, privacy-safe rate limiting, and the global AI kill switch.
- Provider capability probes and model evaluation configuration.

Does not own catalog queries, scraping, source truth, user-facing components, provider secrets in source code, or any general-purpose agent tools.

---

## 7. Core domain model

### 7.1 Record types

Initial shared types:

```text
need
offer
service_point
collection_point
shelter
official_update
hazard
damaged_building
lost_pet
found_pet
reunited_pet
missing_person
found_person
hospital_update
```

Only enabled types from a reviewed source policy may be ingested.

### 7.2 Verification levels

```text
official
source_verified
community_unverified
disputed
unknown
```

`source_verified` must always be qualified by the source. For example, “Foundation verified by Red de Apoyo Colombia” is not the same claim as official government verification.

### 7.3 Location precision

```text
exact_operational_point
approximate_point
locality_only
municipality_only
unknown
```

Exact private residences should be reduced to locality or municipality unless their publication is necessary, authorized, and safe. Store the original only if the approved source policy permits it and the protected-data design is complete.

### 7.4 Observation envelope

The OpenAPI contract should express an envelope equivalent to:

```json
{
  "schema_version": "1.0",
  "source": {
    "slug": "cali-ayuda",
    "record_id": "96fdf869-a2c6-4541-9140-57100338e60d",
    "record_url": "https://example.org/reports/record-id"
  },
  "record": {
    "type": "collection_point",
    "status": "active",
    "title": "Collection point title",
    "description": "Sanitized public description",
    "category_codes": ["medical_supplies", "food"],
    "source_created_at": "2026-08-12T16:00:00-05:00",
    "source_updated_at": "2026-08-12T16:20:00-05:00",
    "observed_at": "2026-08-12T16:25:00-05:00",
    "verification_level": "community_unverified"
  },
  "location": {
    "country_code": "CO",
    "admin1_code": "76",
    "admin1_name": "Valle del Cauca",
    "admin2_code": "76001",
    "admin2_name": "Cali",
    "locality": "San Fernando",
    "display_address": null,
    "latitude": null,
    "longitude": null,
    "precision": "locality_only"
  },
  "public_contact": null,
  "assets": [],
  "content_hash": "sha256:...",
  "adapter_version": "cali-ayuda@1.0.0"
}
```

Rules:

- `source.record_id`, `source.slug`, and `schema_version` are required.
- `record_url` is required unless the source provides no stable link; this exception must be explicit in source policy.
- Contact information is omitted by default.
- All timestamps include an offset. Unknown source timestamps remain `null`; do not infer them from page order.
- `observed_at` is generated by the ingestion service.
- Text is sanitized and length-limited before reaching the catalog.
- Any external URL is validated against the source policy allowlist.

### 7.5 Essential tables

#### `sources`

- `id`
- `slug` unique
- `name`
- `base_url`
- `mode`
- `enabled`
- `trust_label`
- `poll_interval_seconds`
- `policy_version`
- `policy_reviewed_at`

#### `ingestion_runs`

- `id`
- `source_id`
- `adapter_version`
- `started_at`
- `finished_at`
- `status`
- `discovered_count`
- `accepted_count`
- `rejected_count`
- `unchanged_count`
- `error_summary_redacted`
- `cursor_before`
- `cursor_after`

#### `source_records`

- `id`
- `source_id`
- `external_id`
- `canonical_url`
- `first_seen_at`
- `last_seen_at`
- `last_content_hash`
- `withdrawn_at`
- `tombstoned_at`

Unique constraint: `(source_id, external_id)`.

#### `observations`

- `id`
- `source_record_id`
- `schema_version`
- `record_type`
- `normalized_status`
- `title`
- `description`
- `category_codes` array
- `location_id`
- `verification_level`
- `source_created_at`
- `source_updated_at`
- `observed_at`
- `content_hash`
- `normalized_payload` JSONB
- `supersedes_observation_id` nullable
- `public_visibility`

Observations are immutable. A changed source record creates a new observation.

#### `locations`

- Administrative codes and names.
- Locality and safe display address.
- PostGIS `geography(Point, 4326)` when coordinates are allowed.
- Precision and geocoding source.

#### `canonical_records`

- `id`
- `record_type`
- `display_title`
- `computed_status`
- `verification_level`
- `freshness_state`
- `primary_location_id`
- `first_observed_at`
- `last_observed_at`
- `public_visibility`
- `search_document`

#### `canonical_record_observations`

- `canonical_record_id`
- `observation_id`
- `link_reason`
- `link_score`
- `created_by`: `system` or moderator ID
- `created_at`

#### `duplicate_candidates`

- Two canonical/source record references.
- Feature scores and total score.
- State: pending, merged, rejected, expired.
- Moderator decision metadata.

#### `conflicts`

- `canonical_record_id`
- Conflicting field or semantic claim.
- Observation references.
- Severity and resolution state.

#### `tombstones`

- Source and external ID or canonical record ID.
- Reason category.
- Requested/approved timestamps.
- Nonreversible hash needed to prevent accidental reingestion.
- No removed public content.

#### `moderation_actions` and `audit_events`

Append-only records for merge, split, hide, restore, redact, status override, source disable, and deletion actions.

#### `ai_usage_events`

- Internal request ID; never use provider text as an identifier.
- Privacy-safe anonymous client/session hash with short retention.
- Provider, model ID, model role, prompt/schema version, and route type.
- Input, output, reasoning, and cached token counts when reported.
- Reserved maximum cost and settled estimated cost in integer micro-USD.
- Outcome: `completed`, `provider_error`, `timeout`, `rejected`, `budget_blocked`, or `usage_unknown`.
- Provider request ID when safe and useful for billing reconciliation.
- No prompt, response text, search terms, person names, contact information, or catalog payload.
- Created and settled timestamps.

Price schedules must be effective-dated configuration or rows, not constants scattered through application code. Usage rows are append-only; corrections use reconciliation records rather than destructive edits.

### 7.6 Indexes

- GIN index on the normalized search vector.
- GIN trigram indexes for selected normalized titles/names.
- GiST index on allowed geographic points.
- B-tree indexes on record type, computed status, last observation time, and public visibility.
- Unique index on source/external ID.
- Partial indexes for active public records and pending moderation candidates.

---

## 8. Ingestion pipeline

### 8.1 Adapter interface

Each adapter implements the following conceptual interface:

```python
class SourceAdapter(Protocol):
    manifest: AdapterManifest

    async def discover(self, cursor: str | None) -> AsyncIterator[SourceReference]: ...
    async def fetch(self, reference: SourceReference) -> FetchResult: ...
    def parse(self, fetched: FetchResult) -> list[RawSourceRecord]: ...
    def normalize(self, raw: RawSourceRecord) -> list[ObservationEnvelope]: ...
```

The adapter manifest includes:

- Source slug and adapter version.
- Transport mode.
- Allowed hosts and paths.
- Polling and concurrency limits.
- Supported record types.
- Parser fixture version.
- Whether raw snapshots or images are allowed.

### 8.2 Pipeline stages

1. **Schedule:** find enabled, due sources.
2. **Policy gate:** confirm the connector policy is current and the adapter version is allowed.
3. **Discover:** retrieve feed cursor, sitemap entries, list pages, or documented API pagination.
4. **Fetch:** apply host allowlist, rate limit, timeout, byte limit, response-type validation, and conditional headers.
5. **Snapshot:** optionally store encrypted short-lived raw content and always compute a content hash.
6. **Parse:** convert source content into source-shaped Pydantic records.
7. **Sanitize:** remove scripts, markup, hidden instructions, contact data, and disallowed fields.
8. **Normalize:** map fields and vocabulary into an observation envelope.
9. **Validate:** run Pydantic and generated OpenAPI schema validation.
10. **Submit:** batch to catalog API with an idempotency key derived from source, run, and batch number.
11. **Finalize:** commit cursor only after catalog acceptance.
12. **Health evaluation:** compare counts, errors, and content distribution with previous successful runs.

### 8.3 Failure behavior

- A failed run never marks unseen source records as deleted.
- A large count drop triggers quarantine and human review.
- Schema validation failures are stored as redacted diagnostics, not silently discarded.
- Retries are bounded with exponential backoff and jitter.
- Permanent 4xx responses disable only the affected adapter/run and alert operators.
- A source returning anti-bot or authentication UI is marked blocked; the connector does not attempt evasion.
- Cursor advancement is transactional with successful batch acceptance.

### 8.4 Removal behavior

There are three distinct cases:

- **Explicit source deletion/withdrawal:** hide promptly and create a tombstone.
- **Record absent from one successful listing:** mark `not_seen`; do not delete.
- **Record absent from multiple complete successful listings:** create a withdrawal candidate according to source policy.

No absence-based deletion rule applies to missing-person records without an explicit owner agreement.

### 8.5 Raw-data retention

Default proposal:

- Raw public HTML/JSON snapshots: encrypted and deleted within 72 hours.
- Sanitized parser fixtures: kept only after removing personal information.
- Content hashes and ingestion metadata: retained for audit and idempotency.
- Images: link only by default; no mirroring.

Any exception requires a source-policy change and data-protection review.

---

## 9. Normalization and vocabularies

### 9.1 Administrative geography

- Use DANE department and municipality codes where available.
- Preserve the source-provided location string separately from normalized display fields.
- Geocoding must record provider, confidence, time, and result precision.
- Never upgrade a locality-only record into an exact point based on guesswork.

### 9.2 Needs and offers

Maintain an internal controlled vocabulary and preserve source labels:

```text
water
food
medical_supplies
medical_assistance
shelter
transport
rescue_equipment
construction_materials
communications
power
clothing
hygiene
volunteers
animal_support
cash_or_donation
information
other
```

The normalized vocabulary supports filters; the original text remains visible with its source.

### 9.3 Status model

Suggested cross-type states:

```text
active
partially_fulfilled
fulfilled
closed
found
reunited
withdrawn
unknown
```

Do not force all source statuses into a misleading value. Use `unknown` and preserve the source value when semantics do not match.

### 9.4 Humanitarian interchange

Provide later CSV/JSON exports compatible with relevant HXL concepts such as location, geography, need, status, organization, and date. Use CAP concepts for official alerts, including sender, urgency, severity, certainty, effective time, expiry, update, and cancellation. These standards inform interchange; they do not replace the project's application schema.

References:

- [Humanitarian Exchange Language](https://hxlstandard.org/standard/)
- [Common Alerting Protocol 1.2](https://docs.oasis-open.org/emergency/cap/v1.2/cs01/CAP-v1.2-cs01.html)

---

## 10. Deduplication and conflict handling

### 10.1 Candidate generation

Generate candidates using cheap blocking keys before similarity scoring:

- Same source/external ID: always the same source record.
- Same record type or a compatible type pair.
- Same municipality/locality or within a configured geographic radius.
- Overlapping time window.
- Normalized title/name tokens.
- Type-specific attributes such as need category or pet species/color/sex.
- HMAC of a normalized phone number only when policy permits processing; the raw number is never a scoring feature visible outside the protected ingestion path.

### 10.2 Scoring

Store individual features and the total score so decisions are explainable.

Example feature groups:

- Text/title trigram similarity.
- Full-text token overlap.
- Geographic distance.
- Temporal distance.
- Category overlap.
- Source-independent stable identifier, if partners share one.
- Pet attribute and perceptual-image similarity in the pet stage.

Initial threshold proposal:

- `>= 0.92`: automatic link only for low-risk record types.
- `0.72–0.919`: moderation candidate.
- `< 0.72`: remain separate.

These thresholds are configuration, not constants embedded in code.

### 10.3 High-risk exclusions

Never auto-merge:

- Missing or found people.
- Records involving minors.
- Health/medical cases.
- Conflicting building-safety states.
- Records whose only matching feature is a phone number, generic title, or broad location.

### 10.4 Conflict representation

Conflicts must be first-class records. Examples:

- Active need vs fulfilled.
- Safe/open shelter vs closed/unsafe.
- “Volunteers needed” vs “do not come.”
- Missing vs found/reunited.
- Different addresses or people sharing a similar name.

The public UI should show:

- A concise conflict warning.
- Each source claim and timestamp.
- A recommendation to confirm with the original source before moving or acting.

### 10.5 Freshness

Freshness is a computed presentation state, not proof of correctness.

Initial configurable review windows:

- Rescue/hazard operational updates: 60 minutes.
- Needs/offers: 4 hours.
- Collection/service points and shelters: 12 hours.
- Official updates: until explicit expiry or supersession.
- Pets and missing people: ask for reconfirmation after 48 hours, but never automatically mark resolved.

Labels should say “not recently reconfirmed,” not “expired” or “false,” unless the source explicitly withdrew the record.

---

## 11. Catalog API design

### 11.1 Public endpoints

```text
GET  /v1/records
GET  /v1/records/{recordId}
GET  /v1/records/{recordId}/observations
GET  /v1/sources
GET  /v1/sources/{sourceSlug}/health
GET  /v1/taxonomies
GET  /health/live
GET  /health/ready
```

`GET /v1/records` filters:

- `q`
- `types[]`
- `statuses[]`
- `category_codes[]`
- `admin1_code`
- `admin2_code`
- `locality`
- `latitude`, `longitude`, `radius_meters`
- `observed_after`
- `freshness[]`
- `verification_levels[]`
- `has_conflict`
- `cursor`
- `limit`, capped server-side

Results include only public safe fields and provenance summaries.

### 11.2 Internal ingestion endpoints

```text
POST /internal/v1/ingestion-runs
POST /internal/v1/ingestion-runs/{runId}/observations:batch
POST /internal/v1/ingestion-runs/{runId}:complete
POST /internal/v1/ingestion-runs/{runId}:fail
POST /internal/v1/source-records:withdraw
```

Requirements:

- Service-to-service authentication.
- Source-scoped authorization.
- Idempotency key on all writes.
- Maximum batch count and byte size.
- Partial validation errors returned per item without leaking sensitive payloads to logs.
- Run completion fails if required batches are missing.

### 11.3 Moderation endpoints

```text
GET  /admin/v1/duplicate-candidates
POST /admin/v1/duplicate-candidates/{id}:accept
POST /admin/v1/duplicate-candidates/{id}:reject
POST /admin/v1/canonical-records/{id}:split
POST /admin/v1/canonical-records/{id}:hide
POST /admin/v1/canonical-records/{id}:restore
POST /admin/v1/canonical-records/{id}:redact
POST /admin/v1/deletion-requests
POST /admin/v1/deletion-requests/{id}:approve
POST /admin/v1/sources/{slug}:disable
```

Every mutation requires an actor, reason code, optional note, and audit event.

### 11.4 API security

- Public rate limits by IP/privacy-safe client key.
- Strict CORS allowlist.
- Request/response size limits.
- Parameterized SQL through the data layer.
- SSRF protections for all URLs.
- No arbitrary outbound fetching from public API parameters.
- Admin and internal routes on separate authentication policies.
- Service secrets rotated without redeploying source code.

---

## 12. Public PWA experience

### 12.1 Required routes

```text
/
/search
/records/{id}
/sources
/sources/{slug}
/chat                         # Enabled only after Stage 5 gates pass
/privacy
/data-sources
/request-correction
/offline
/admin/*                      # Protected; may later move to a separate app
```

### 12.2 Home page

Lead with action-oriented paths:

- Find supplies or a service point.
- Find where help is needed.
- Search shelters.
- Search pets.
- Search people only when the high-risk stage is approved.
- View official information and emergency numbers.

Clearly state that the platform is community-operated and does not replace official emergency services.

### 12.3 Search results

Each result card displays:

- Type and normalized status.
- Title and safe summary.
- Municipality/locality.
- Last source update and last observation.
- Freshness label.
- Verification label with source context.
- Conflict warning when applicable.
- Source count and primary source link.
- “Confirm before traveling or acting” for dynamic operational records.

### 12.4 Record detail

- Canonical summary.
- Timeline of source observations.
- Source links.
- Conflicting claims side by side.
- Safe location precision.
- Correction/removal path.
- Emergency disclaimer where relevant.

### 12.5 Map

- List view remains available and is the default on slow connections.
- Cluster points and request only the current viewport.
- Do not expose points more precise than the public location policy permits.
- Show stale/conflicting markers differently.
- Do not render a point when only a municipality is known.

### 12.6 Offline behavior

Cache:

- Application shell.
- Accessibility assets.
- Emergency numbers and official-source links.
- An explicit offline page.

Do not cache by default:

- Search API responses containing person records.
- Contact information.
- Medical descriptions.
- Photographs.
- Admin pages or responses.

Dynamic pages must show the last successful fetch time and a prominent offline/stale state. A service worker must not return old operational data as if it were live.

---

## 13. Chatbot design

### 13.1 Role

The chatbot is a natural-language query interface, not an emergency decision-maker. It must use catalog tools and must not browse arbitrary websites.

### 13.2 Allowed tools

```text
search_records(filters)
get_record(record_id)
compare_record_sources(record_id)
get_source_health(source_slug)
get_official_contacts(area_code)
```

No write tool is exposed to the model in the MVP.

### 13.3 Query flow

Choose the cheapest safe route before making a provider call:

1. If the UI already supplies explicit filters, call deterministic catalog search and make no model call.
2. For simple natural-language search, ask `openai-gpt-oss-20b` for a strict `SearchIntent` object.
3. Validate the object with Zod, enforce allowed enumerations/ranges, and call the catalog API in application code.
4. Render normal result cards and a deterministic summary template. Do not spend a second inference call merely to restate search results.
5. For an explicitly complex comparison, ambiguous request, or conflict explanation, provide at most five sanitized catalog results to `openai-gpt-oss-120b` for grounded synthesis.
6. Validate every cited record/source ID against the tool result before rendering the answer.
7. If model output is invalid, allow at most one bounded repair attempt when budget remains; otherwise return deterministic search links with the extracted safe query text.

The first public version should use structured intent extraction before enabling a general tool loop. Tool calling may be enabled only after the pinned model passes capability tests. Even then, all tools remain read-only and execute in application code.

### 13.4 Hard rules

- Never put raw HTML or source payloads in the model context.
- Treat all source text as untrusted data, not instructions.
- Never send phone numbers, exact private addresses, health details, source credentials, or hidden moderation fields to the model.
- Never invent a match when the search returns none.
- Never claim that a building is safe or that a person/pet was found unless an observation explicitly states it.
- If sources disagree, state the disagreement.
- For imminent danger, show official emergency contacts before community information.
- Bound tool calls and returned rows.
- Disable chat if the catalog API or citation renderer is unhealthy; deterministic search remains available.
- Limit user input to a configurable maximum, initially 800 characters.
- Default model output to at most 250 tokens; require an explicit reviewed use case to raise it.
- Use `reasoning_effort: low` or the lowest evaluated reliable setting for intent extraction.
- Send structured conversation state instead of replaying unbounded chat history.
- Allow at most one in-flight inference per anonymous client.
- Do not retry timeouts, `429`, or `5xx` more than once, and never retry a partially completed write action; the MVP exposes no model write action.

### 13.5 Model independence

- Hide provider selection behind `packages/ai`; public application modules request `intent_extraction` or `grounded_synthesis`, never a vendor model ID.
- Configure DigitalOcean as the initial provider with `https://inference.do-ai.run/v1`; keep the base URL overridable for testing.
- Pin the initial production model IDs to `openai-gpt-oss-20b` and `openai-gpt-oss-120b`.
- Pin prompts and tool schemas by version.
- Store only privacy-safe telemetry.
- A model change requires the evaluation suite to pass before deployment.
- Do not silently fall back between models when a schema, citation, safety, or privacy validation fails. Fallback is allowed only for provider timeout, rate limit, capacity, or `5xx` failures, and the fallback model must already have passed evaluation.
- OpenCode and Hermes are explicitly outside this interface and outside the public request path.

### 13.6 Evaluation set

Create versioned evaluations covering:

- Spanish questions with spelling errors and local place names.
- Needs vs offers.
- Geographic-radius queries.
- Empty results.
- Stale records.
- Conflicting sources.
- Attempts to make the model follow instructions embedded in source descriptions.
- Requests for private contact information.
- Medical, structural-safety, and dispatch questions the bot must decline.
- Ambiguous person/pet names.

Evaluate each model role independently for:

- Valid JSON/schema adherence.
- Spanish and Colombian place-name understanding.
- Correct use of accents, common misspellings, and local terminology.
- Tool-call validity if tool calling is proposed.
- Citation precision and unsupported-claim rate.
- Latency, timeout rate, input/output tokens, and cost per successful task.
- Adversarial instruction handling.

### 13.7 Budget envelopes

Treat the available USD 200 DigitalOcean credit as a finite incident resource, represented by virtual application envelopes:

```text
public_chat              USD 140
development_evaluations  USD  20
internal_data_tasks      USD  20
emergency_reserve        USD  20
```

These are initial policy values, not separate DigitalOcean balances. Operators may move funds between envelopes through reviewed configuration, with an audit event. Do not enable provider auto-reload for the MVP without an explicit operating decision.

Pricing changes over time. Seed the initial effective-dated price schedule from the reviewed DigitalOcean pricing page, but verify it at deployment and never infer current pricing from this plan alone. As reviewed on 2026-08-12, the planning assumptions are:

```text
openai-gpt-oss-20b   USD 0.05 / 1M input tokens   USD 0.45 / 1M output tokens
openai-gpt-oss-120b  USD 0.10 / 1M input tokens   USD 0.70 / 1M output tokens
```

Authoritative references:

- [DigitalOcean Inference pricing](https://docs.digitalocean.com/products/inference/details/pricing/)
- [DigitalOcean supported inference models](https://docs.digitalocean.com/products/inference/details/foundation-models/)
- [DigitalOcean Chat Completions API](https://docs.digitalocean.com/products/inference/how-to/use-chat-completions-api/)

### 13.8 Budget enforcement and settlement

Before every provider call:

1. Reject if the global kill switch, relevant envelope, daily cap, or provider health gate is closed.
2. Apply anonymous-client, network, global-throughput, and concurrency limits.
3. Estimate the maximum cost using the input estimate, `max_completion_tokens`, model role, and active price schedule.
4. Atomically reserve integer micro-USD in Valkey against daily, envelope, and total caps.
5. Call the provider with a unique internal request ID and bounded timeout.
6. Read the provider `usage` fields, calculate settled cost, store an append-only `ai_usage_events` row, and release unused reservation.
7. If usage is unknown after a timeout or interrupted stream, retain the maximum reservation until reconciliation rather than assuming the request was free.

Budget reconciliation compares the internal ledger with DigitalOcean per-request/model metrics at least daily while chat is enabled. A discrepancy above the configured tolerance closes model calls and alerts an operator; deterministic search continues.

Initial configurable service levels:

```text
0%–70% of envelope used    normal routing
70%–85%                    shorter outputs; no optional synthesis
85%–95%                    intent extraction only; prefer 20B
95%–100%                   deterministic search only; reserve requires operator override
100%                       hard stop for all model calls in that envelope
```

### 13.9 Abuse controls and availability

Initial limits, all configurable after real traffic observation:

```text
10 AI requests per anonymous client per hour
30 AI requests per anonymous client per day
60 AI requests per privacy-safe network hash per hour
20 AI requests globally per minute
1 concurrent AI request per anonymous client
```

- Identify an anonymous browser with a signed, rotating cookie.
- Use a short-lived keyed hash of a truncated IP/network only as a secondary abuse signal; never store the raw IP in the AI ledger.
- Do not penalize deterministic search because multiple users share a hospital, shelter, university, or carrier network.
- Add a challenge only after suspicious behavior; accessibility and emergency access must remain usable.
- Cache only safe, non-person, normalized intent/result envelopes with short TTLs. Cache keys use a keyed hash; never place the raw question in Valkey.
- A cache hit must still confirm record freshness and visibility before responding.
- Provider, Valkey, budget, or AI-route failure always degrades to deterministic search rather than a blank/error-only page.

### 13.10 External continuity option

Do not fund or integrate a second provider before the DigitalOcean path is operating and measured. If an independent provider is later required, MiniMax may be evaluated through the same `packages/ai` interface, but it is not assumed to be cheaper. It must have a separate small prepaid balance, data-processing review, secret, kill switch, and complete evaluation run. Using another model through DigitalOcean is model redundancy, not provider redundancy.

---

## 14. Privacy, legal, and humanitarian safeguards

This is an engineering plan, not legal advice. Obtain Colombian privacy counsel or a qualified data-protection review before launching sensitive-person workflows.

### 14.1 Governing baseline

The design must account for Colombian Law 1581 of 2012, its implementing rules, source terms, copyright/database rights, and humanitarian data-protection practices. Emergency or vital-interest exceptions must not be treated as blanket permission for indiscriminate aggregation.

References:

- [Colombian Law 1581 of 2012](https://www1.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=49981)
- [ICRC Handbook on Data Protection in Humanitarian Action](https://www.icrc.org/en/data-protection-humanitarian-action-handbook)

### 14.2 Required controls before public alpha

- Data inventory and purpose for every collected field.
- Source permission/policy registry.
- Privacy notice in Spanish.
- Correction, access, and removal process.
- Documented retention periods.
- Encryption in transit and at rest.
- Separate secrets management.
- Redacted application logs.
- Least-privilege admin roles.
- Audit trail for moderation and deletion.
- Backups with tested deletion implications.
- Incident-response and breach-notification runbook.
- Threat model covering doxxing, stalking, fraud, false reports, prompt injection, and compromised source sites.

### 14.3 Contact data

Default behavior: do not ingest or expose phone numbers. Link to the source record instead.

If matching by contact is later approved:

1. Normalize the value inside the ingestion process.
2. Compute a keyed HMAC for duplicate candidate generation.
3. Discard the raw value before sending the observation.
4. Keep the HMAC key outside the repository and database.
5. Never return the HMAC through public or admin APIs.

### 14.4 People and minors

The missing-person stage requires:

- Written agreements with source owners or a clearly documented lawful basis.
- A specific consent and removal workflow.
- Minimum public field set.
- No exact home address.
- No identity-document numbers.
- No medical or biometric data.
- No automated face matching.
- No auto-merge.
- Stronger access and retention controls for minors.
- Clear handoff to official missing-person and family-restoration channels.

### 14.5 Analytics

- No third-party advertising trackers.
- Do not log search terms that may contain names, phone numbers, addresses, or medical information.
- Prefer aggregate counters and server-side performance metrics.
- IP addresses should be truncated/hashed only as necessary for short-lived abuse prevention.

---

## 15. Security threat model summary

### 15.1 Threats

- Malicious source content attempting prompt injection.
- Compromised community website feeding fraudulent updates.
- Doxxing through aggregation of previously dispersed personal data.
- Fraudulent donation or contact instructions.
- SSRF through external URLs.
- Parser bombs, oversized files, or image decompression attacks.
- Unauthorized moderation actions.
- Scraper credentials leaking in logs.
- Reingestion of legally removed records.
- Source-owner denial of service caused by aggressive polling.
- Supply-chain compromise in npm/Python/container dependencies.

### 15.2 Minimum mitigations

- Allowlisted hosts, paths, schemes, response types, and byte sizes.
- Sandboxed/isolated browser adapter process.
- HTML-to-text sanitization and model-context isolation.
- Source labels and conflict visibility.
- Secret scanning and dependency audits.
- Container runs as nonroot with read-only filesystem where practical.
- Network policies: ingest can reach approved sources and catalog; catalog cannot fetch arbitrary URLs.
- Admin SSO/MFA or equivalent strong identity.
- Append-only audit events.
- Tombstone checks before any public upsert.
- Per-source rate limits and emergency kill switch.

---

## 16. Observability and operations

### 16.1 Service telemetry

Use structured logs, metrics, and traces with a shared correlation ID.

Required metrics:

- HTTP request count, latency, and errors.
- Search latency and result counts by safe aggregate dimensions.
- Ingestion run duration and outcome.
- Records discovered, accepted, unchanged, rejected, and quarantined.
- Time since last successful run per source.
- Parser-selector failure counts.
- Count-change anomaly.
- Duplicate candidates and moderation queue age.
- Deletion queue age.
- Chat tool errors, citation completeness, and refusal categories without storing sensitive prompts.

### 16.2 Source health states

```text
healthy
delayed
degraded
blocked
policy_disabled
failed
unknown
```

The public source page may expose freshness and general health, but not internal errors or credentials.

### 16.3 Alerts

- Source misses two expected successful intervals.
- Result count drops or grows beyond configured bounds.
- Parser validation failure exceeds threshold.
- Ingestion receives unexpected content type or host redirect.
- Deletion request approaches SLA.
- Public API error rate or latency exceeds threshold.
- Database storage or connection saturation.
- Citation completeness evaluation fails in deployment smoke test.

### 16.4 Runbooks

Create at least:

- Disable one source immediately.
- Roll back an adapter.
- Recover a failed ingestion cursor.
- Correct an incorrect canonical merge.
- Process a deletion or redaction request.
- Respond to a compromised source.
- Restore the database and verify tombstones.
- Disable chat while preserving deterministic search.

---

## 17. Testing strategy

### 17.1 TypeScript

- Unit tests for domain rules and freshness calculations.
- Catalog API integration tests against ephemeral PostgreSQL/PostGIS.
- OpenAPI request/response validation tests.
- Web component tests for provenance, conflict, stale, and offline states.
- Playwright end-to-end tests for list search, record detail, filters, correction path, admin merge, and PWA offline shell.

### 17.2 Python

- Unit tests for sanitization and normalization.
- Adapter contract tests from sanitized fixtures.
- Golden observation-envelope snapshots.
- Property tests for URLs, dates, and text-length boundaries where useful.
- Network calls prohibited in normal unit tests.
- A separate opt-in live smoke test per source with conservative rate limits.

### 17.3 Cross-service

- Generate clients from OpenAPI.
- Submit fixture batches from Python to a real catalog API and database.
- Verify idempotent replay.
- Verify partial validation failures.
- Verify cursor does not advance on failed finalization.
- Verify source withdrawal and tombstone behavior.

### 17.4 Safety tests

- PII redaction fixtures.
- Prompt-injection content remains inert.
- Private contacts do not appear in API responses, logs, analytics, HTML, or model contexts.
- Exact locations are downgraded according to policy.
- Deleted records cannot reappear after adapter replay or restore testing.
- Chat cannot access admin/internal APIs.

### 17.5 Performance tests

Seed at least 100,000 synthetic public-safe observations and measure:

- Text search.
- Radius search.
- Combined filters.
- Record-detail provenance query.
- Batch ingestion and idempotent replay.
- Duplicate candidate generation.

---

## 18. CI/CD

### 18.1 Pull request checks

Run independent jobs where possible:

1. `pnpm install --frozen-lockfile`.
2. TypeScript format/lint/typecheck.
3. TypeScript unit tests.
4. Catalog API integration tests.
5. Web build and end-to-end smoke tests.
6. `uv sync --frozen --all-groups`.
7. Ruff format/lint, Pyright, and Pytest.
8. OpenAPI lint and generated-code clean check.
9. Migration apply/revert-forward test on an empty and previous-version database.
10. Docker image build.
11. Dependency, container, and secret scans.
12. Adapter fixture-contract tests.

### 18.2 Deployment order

1. Back up and verify database readiness.
2. Apply forward-only compatible migrations.
3. Deploy catalog API.
4. Run catalog health and contract smoke tests.
5. Deploy web.
6. Deploy ingestion service with sources disabled.
7. Enable one canary source.
8. Confirm health/counts/idempotency.
9. Enable remaining approved sources individually.
10. Enable chat only after search and citation smoke tests pass.

### 18.3 Rollback

- Prefer backward-compatible expand/migrate/contract database changes.
- Application code may roll back to the last healthy image.
- Database migrations are corrected forward; no automated destructive downgrade.
- Adapter versions can be disabled or rolled back independently.
- Keep a source kill switch and global chat kill switch.

---

## 19. Staged delivery roadmap

Each work packet below is designed for one AI agent or one tightly coordinated human/agent pair. An agent must not broaden its packet without updating the plan and obtaining review.

### Stage 0 — Governance and repository foundation

**Outcome:** A reproducible monorepo with approved contracts and safety constraints before live data collection.

#### WP-000: Repository bootstrap

**Owns:** root files, workspace configuration, shared config packages  
**Dependencies:** none

Deliverables:

- Root `package.json`, exact pnpm version, and workspace file.
- Node runtime pin and Corepack instructions.
- `apps/web`, `services/catalog-api`, and package skeletons.
- `services/ingest/pyproject.toml`, Python pin, and uv lockfile.
- Root scripts: bootstrap, lint, typecheck, test, build, dev, and generate contracts.
- `.editorconfig`, `.gitignore`, contributor guide, and concise root README.

Acceptance:

- Fresh clone can bootstrap with documented commands.
- `pnpm -r` and `uv run` smoke commands pass.
- No application contains undeclared cross-workspace dependencies.

#### WP-001: Architecture decisions

**Owns:** `docs/adr/`  
**Dependencies:** WP-000

Write ADRs for:

- Monorepo and service boundaries.
- pnpm and uv.
- Catalog API as database owner.
- OpenAPI as cross-language contract.
- PostgreSQL/PostGIS without Redis/vector search initially.
- Read-only federation and link-out contact policy.

Acceptance: each ADR states context, decision, consequences, and alternatives.

#### WP-002: Source policy templates and owner outreach pack

**Owns:** `docs/source-policies/`, outreach templates  
**Dependencies:** none

Deliverables:

- Machine-readable source-policy schema.
- Human review checklist.
- Email/message template requesting JSON/CSV/API/webhook access.
- Proposed minimal federation feed specification.
- Initial disabled policy files for known sources.

Acceptance: production connector startup fails closed for a missing or disabled policy.

#### WP-003: Privacy and threat-model baseline

**Owns:** `docs/data-protection.md`, `docs/threat-model.md`  
**Dependencies:** none

Deliverables:

- Field-level data inventory.
- Purpose, lawful-basis question, retention, and exposure classification.
- Threat model and security review checklist.
- Missing-person stage gates.
- Initial deletion/correction workflow.

Acceptance: reviewers can determine whether any proposed field may enter public API, admin API, model context, logs, or raw storage.

### Stage 1 — Core catalog and ingestion path

**Outcome:** A fixture can travel from Python through a validated internal API into PostgreSQL and appear in deterministic public search.

#### WP-100: Docker Compose and local infrastructure

**Owns:** `infra/`, Compose files  
**Dependencies:** WP-000

Deliverables:

- PostgreSQL/PostGIS service with health check and persistent named volume.
- Extension initialization for PostGIS, trigram, and unaccent.
- Optional MinIO and observability profiles.
- Nonsecret `.env.example` files.
- Commands for start, stop, logs, and clean test environment.

Acceptance:

- Database becomes healthy from a clean volume.
- Test cleanup never targets an unresolved or broad filesystem path.
- Secrets are not embedded in images or committed Compose files.

#### WP-101: OpenAPI contract v1

**Owns:** `packages/contracts/`  
**Dependencies:** WP-000, domain sections of this plan

Deliverables:

- Observation, source, run, search, provenance, conflict, error, and pagination schemas.
- Internal ingestion and public read endpoints.
- TypeScript and Python generation commands.
- Valid and invalid examples.

Acceptance:

- OpenAPI lint passes.
- Generated code is deterministic.
- Both language builds consume the generated types.

#### WP-102: Database schema and migrations

**Owns:** `packages/db/`  
**Dependencies:** WP-100, WP-101

Deliverables:

- Essential tables, constraints, indexes, and seed data for sources/taxonomies.
- Forward-compatible migration workflow.
- Synthetic data factory.
- Database integration-test helpers.

Acceptance:

- Migrations apply to an empty database.
- Unique/idempotency constraints work.
- Geographic and full-text indexes are used in representative `EXPLAIN` tests.

#### WP-103: Catalog ingestion-run API

**Owns:** `services/catalog-api` ingestion modules  
**Dependencies:** WP-101, WP-102

Deliverables:

- Authenticated run start, batch submission, completion, and failure endpoints.
- Source-scoped authorization.
- Idempotent batch processing.
- Per-item validation results.
- Transactional run finalization.

Acceptance:

- Replaying a batch creates no duplicate observation.
- Invalid items do not corrupt valid accepted items.
- A failed/incomplete run cannot advance a source cursor.

#### WP-104: Public catalog search API

**Owns:** `services/catalog-api` public read modules  
**Dependencies:** WP-102

Deliverables:

- Search filters, cursor pagination, safe response projection.
- Record detail and observation timeline.
- Source list/health projection.
- Readiness/liveness endpoints.

Acceptance:

- Query tests cover text, type, category, municipality, radius, freshness, verification, and conflict filters.
- No protected field appears in a serialized public response.

#### WP-105: Python ingestion framework

**Owns:** `services/ingest` framework, not individual source adapters  
**Dependencies:** WP-101, WP-103

Deliverables:

- Adapter protocol and manifest validation.
- Policy gate and URL allowlist.
- HTTP fetch limits, conditional requests, retries, and rate controls.
- Parse/sanitize/normalize/validate/submit pipeline.
- CLI commands: `list-sources`, `validate-policy`, `run-source`, `run-due`, and `live-smoke`.
- Generated catalog client integration.

Acceptance:

- A fake fixture source completes an end-to-end run.
- Network is disabled in unit tests.
- Anti-bot/auth responses produce `blocked`, not retry storms.

### Stage 2 — First low-risk sources

**Outcome:** The catalog contains real, public-safe operational records from approved sources and official seismic metadata.

#### WP-200: Cali Ayuda adapter

**Owns:** only the Cali Ayuda adapter, fixtures, and policy mapping  
**Dependencies:** WP-002, WP-105; policy approval

Deliverables:

- Need, offer, and service-point extraction.
- Stable UUID/source link handling.
- Phone and medical-detail redaction rules.
- Sanitized fixtures and count-change expectations.

Acceptance:

- Adapter output matches golden envelopes.
- No phone number enters an envelope or log.
- Parser failure on layout change is explicit.

#### WP-201: Donde Ayudo adapter

**Owns:** only this source adapter and fixtures  
**Dependencies:** WP-002, WP-105; policy approval

Deliverables:

- Municipality and collection-point discovery.
- Needs/category normalization.
- Operating-status and timestamp preservation where available.

Acceptance: pagination/municipality coverage and stable-link behavior are fixture-tested.

#### WP-202: SGC official-source adapter

**Owns:** SGC adapter and official-source mapping  
**Dependencies:** WP-105

Deliverables:

- Use documented official JSON/ArcGIS endpoints.
- Normalize event ID, magnitude, depth, coordinates, event time, and review state.
- Preserve SGC URL and official attribution.

Acceptance:

- No community verification labels are applied to SGC metadata.
- Units and timezone conversions are tested.

#### WP-203: Source health and anomaly engine

**Owns:** ingestion health calculation and catalog health endpoints  
**Dependencies:** WP-103, at least one adapter

Deliverables:

- Health-state calculation.
- Expected-interval and count-change anomaly rules.
- Parser validation-rate metrics.
- Source disable/kill switch.

Acceptance: simulated empty, delayed, blocked, and malformed runs produce the correct state and alerts.

### Stage 3 — Deterministic public product

**Outcome:** Users can search and compare sourced information without AI.

#### WP-300: Web shell and accessibility foundation

**Owns:** `apps/web` layout, navigation, shared UI primitives  
**Dependencies:** WP-000

Deliverables:

- Spanish-first UI shell with language-ready structure.
- Emergency disclaimer and official contact component.
- Responsive/keyboard accessible navigation.
- Loading, empty, error, stale, and offline patterns.

Acceptance: automated accessibility checks pass on the shell and navigation.

#### WP-301: Search and list experience

**Owns:** public search pages  
**Dependencies:** WP-104, WP-300

Deliverables:

- Query, type, status, category, municipality, locality, freshness, and verification filters.
- Cursor pagination.
- Low-bandwidth mode.
- Shareable URL state.
- Result cards with provenance, freshness, and conflict state.

Acceptance: end-to-end tests cover search, filter combination, pagination, empty state, and API failure.

#### WP-302: Record provenance and comparison view

**Owns:** record detail pages  
**Dependencies:** WP-104, WP-300

Deliverables:

- Canonical summary.
- Source observation timeline.
- Side-by-side conflicts.
- Original links.
- Correction/removal entry point.

Acceptance: no detail page hides a conflicting active observation.

#### WP-303: PWA and offline shell

**Owns:** manifest, service worker, offline behavior  
**Dependencies:** WP-300, WP-301

Deliverables:

- Installable manifest/icons.
- Minimal service worker.
- Offline shell and official contacts.
- Cache allow/deny tests.
- Last-fetched and offline indicators.

Acceptance:

- Sensitive/dynamic API responses are not cached by default.
- Offline tests never display cached operational data as current.

#### WP-304: Map view

**Owns:** map UI and viewport API integration  
**Dependencies:** WP-301; approved tile strategy

Deliverables:

- MapLibre view with viewport-limited requests and clustering.
- Precision-aware markers.
- Stale/conflict visual states.
- Keyboard-accessible list equivalent.

Acceptance: municipality-only records never receive fabricated map points.

### Stage 4 — Reconciliation, moderation, and deletion

**Outcome:** Duplicate and contradictory records are handled transparently and reversibly.

#### WP-400: Candidate generation and scoring

**Owns:** catalog deduplication modules  
**Dependencies:** WP-102, real normalized fixtures

Deliverables:

- Blocking keys and explainable features.
- Configurable per-type thresholds.
- Candidate generation job.
- Evaluation dataset with known matches/nonmatches.

Acceptance:

- High-risk types are excluded from auto-merge.
- Every score exposes its component features to moderators.

#### WP-401: Canonicalization and conflict engine

**Owns:** canonical state computation  
**Dependencies:** WP-400

Deliverables:

- Observation linking.
- Computed status/freshness/verification.
- First-class conflict generation.
- Recompute command after policy/algorithm change.

Acceptance:

- Recompute is deterministic.
- Source observations remain immutable.
- Contradictory observations remain visible.

#### WP-402: Moderation UI and API

**Owns:** admin duplicate/conflict workflows  
**Dependencies:** WP-401, WP-300

Deliverables:

- Protected pending-candidate queue.
- Accept/reject merge.
- Split canonical record.
- Hide/restore/redact actions.
- Actor/reason audit trail.

Acceptance: every action is reversible where legally/safely appropriate and fully audited.

#### WP-403: Correction, deletion, and tombstones

**Owns:** removal workflow and runbook  
**Dependencies:** WP-102, WP-302

Deliverables:

- Public request form without exposing requests.
- Admin review and approval.
- Public hide, index/cache purge, tombstone creation.
- Adapter replay tests.
- Source-wide emergency disable/removal path.

Acceptance: a deleted fixture record cannot reappear after a full source replay or database restore test.

### Stage 5 — Constrained AI search

**Outcome:** Natural-language questions produce grounded catalog searches with complete provenance.

#### WP-500: Catalog chat tools

**Owns:** server-side tool wrappers and schemas  
**Dependencies:** WP-104, WP-401

Deliverables:

- Search, detail, compare, source-health, and official-contact tools.
- Strict Zod inputs and bounded results.
- Sanitized model projection.
- Tool-level tracing without sensitive payloads.

Acceptance: tests prove that protected fields cannot enter tool results.

#### WP-501: AI SDK chat route and UI

**Owns:** `/chat`, AI SDK orchestration  
**Dependencies:** WP-500, WP-300

Deliverables:

- Streaming response UI.
- Spanish system instructions.
- Structured source/record cards.
- Citation completeness guard.
- Model-provider abstraction and feature flag/kill switch.

Acceptance:

- No answer is returned as grounded when citations are missing.
- Catalog or model failure degrades to deterministic-search links.

#### WP-502: Safety and quality evaluations

**Owns:** versioned chat evaluation suite  
**Dependencies:** WP-501

Deliverables:

- At least 50 representative scenarios.
- Prompt-injection, privacy, empty-result, ambiguity, conflict, stale, and refusal cases.
- Automated scoring for tool selection, cited record IDs, unsupported claims, and forbidden data.
- Deployment gate.

Acceptance: agreed thresholds pass twice against the pinned model before chat is enabled.

### Stage 6 — Pets and broader federation

**Outcome:** Pet records are federated with attribute-aware matching, and additional high-value partners use feeds rather than brittle scraping.

#### WP-600: Volvé a Casa adapter

**Dependencies:** owner/policy approval, WP-105  
**Constraint:** public pages/sitemap only unless API access is granted.

Acceptance: stable pet ID/link, attributes, status, and image-link policy are tested.

#### WP-601: Reúne Mascotas adapter

**Dependencies:** owner/policy approval, WP-105  
**Constraint:** never bypass Cloudflare challenge.

Acceptance: lost/found/reunited states and stable hash IDs are fixture-tested.

#### WP-602: OutSystems pet integration

**Dependencies:** owner-provided feed preferred  
**Constraint:** browser automation requires explicit policy approval and isolated runtime.

Acceptance: pagination, stable synthetic source IDs, and detail availability failures are handled without duplicates.

#### WP-603: Pet matching

**Dependencies:** at least two pet sources

Deliverables:

- Species, sex, size, color, name, location, and temporal features.
- Optional perceptual image hash only where image processing is authorized.
- Human review queue for likely matches.

Acceptance: matching never marks a pet reunited; it only suggests related reports.

#### WP-604: Partner feed kit

**Owns:** reusable federation documentation and validator

Deliverables:

- Minimal JSON/CSV feed specification.
- Example feed and validation CLI.
- Deletion/tombstone feed semantics.
- Optional webhook signature specification.
- HXL-compatible export mapping.

Acceptance: a new partner can validate a sample feed without access to repository internals.

### Stage 7 — Missing-person information, gated

**Outcome:** Only proceed if legal, privacy, source-agreement, moderation, and official-channel gates are approved.

#### Mandatory entry gates

- Written source/data-sharing agreements or documented legal review.
- Approved minimum public field set.
- Correction/removal team and response SLA.
- Official Red Cross/authority referral path.
- Moderator staffing.
- Abuse and misidentification response runbook.
- No face recognition.
- No auto-merge.
- Minor-specific safeguards.
- Independent privacy/security review.

#### WP-700: Person schema and protected projection

Design the minimum schema, access layers, and retention policy without ingesting production data.

#### WP-701: Partner-only person adapter

Implement one approved source through a feed/API, not opportunistic HTML scraping.

#### WP-702: Manual reconciliation workflow

Candidate suggestions must require trained human approval and show all differing attributes.

#### WP-703: Official handoff and removal UX

Provide clear official reporting/family-restoration routes and rapid correction/removal.

No Stage 7 code is publicly enabled until all gates are signed off.

### Stage 8 — Production hardening and scaling

**Outcome:** The service can remain safe and operable under emergency traffic and ongoing source changes.

Work packets:

- Managed database, PITR, restore drills, and multi-zone decision.
- Autoscaling and load tests.
- WAF/rate limiting and admin identity hardening.
- OpenTelemetry dashboards and paging.
- Dependency/container patch automation.
- Disaster recovery and source-compromise exercises.
- Spanish content review and accessibility audit.
- Public status page and transparent source methodology.

---

## 20. AI-agent execution protocol

This section is mandatory for agents implementing the plan.

### 20.1 Before starting a work packet

1. Read this document and relevant ADRs completely.
2. Read repository-local `AGENTS.md` if present.
3. Confirm packet dependencies are complete.
4. Inspect current Git status and preserve unrelated changes.
5. Announce the packet ID in the PR/branch description.
6. List the directories the packet owns.
7. Identify contract or migration changes before editing implementation code.

### 20.2 Scope rules

- One agent owns one work packet at a time.
- Do not edit another active packet's owned directory without coordination.
- Contract changes are their own reviewed change or must be coordinated with every consumer.
- Database migrations are append-only and owned by `packages/db`.
- Generated files are changed only by their generator.
- Source adapters never change catalog tables directly.
- Live source calls must be opt-in and rate-limited.
- Do not add a new infrastructure service without an ADR and measured need.

### 20.3 Required handoff

Every completed packet creates `docs/agent-handoffs/WP-NNN.md` containing:

- Summary.
- Files changed.
- Commands run and results.
- API/schema/migration changes.
- Security/privacy considerations.
- Known limitations.
- Follow-up work.
- Exact acceptance criteria status.

### 20.4 Definition of done for any packet

- Acceptance criteria are demonstrably satisfied.
- Tests cover success and failure paths.
- Lint, typecheck, tests, and relevant builds pass.
- No secrets or personal production data are committed.
- Documentation and examples are updated.
- Logs and errors are checked for sensitive information.
- New configuration has a safe default and an `.env.example` entry if needed.
- Operational impact and rollback are documented.
- Handoff file is complete.

---

## 21. Suggested issue and branch conventions

- Issue title: `[WP-103] Implement idempotent ingestion batches`.
- Branch: `codex/wp-103-ingestion-batches`.
- Commit: `feat(catalog): add idempotent ingestion batches`.
- Pull request must link the work packet and reproduce its acceptance checklist.
- Avoid mixing dependency upgrades with functional work unless the packet is specifically an upgrade.

Labels:

```text
stage:0-foundation
stage:1-core
stage:2-sources
stage:3-product
stage:4-reconciliation
stage:5-ai
stage:6-pets
stage:7-people-gated
stage:8-hardening
risk:privacy
risk:security
risk:source-policy
blocked:owner-access
```

---

## 22. Initial local developer workflow

The bootstrap packet should make these commands available from the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
uv sync --directory services/ingest --frozen --all-groups
docker compose up -d db
pnpm db:migrate
pnpm dev
```

Expected focused commands:

```bash
pnpm --filter @earthquake/web dev
pnpm --filter @earthquake/catalog-api dev
uv run --directory services/ingest quake-ingest run-source fixture-demo
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm contracts:generate
```

Exact package names may change in WP-000, but the root workflow must remain short and documented.

---

## 23. Earliest useful release sequence

If urgency requires prioritization, execute in this order:

1. WP-000, WP-001, WP-002, and WP-003.
2. WP-100 through WP-105.
3. WP-200, WP-201, WP-202, and WP-203.
4. WP-300, WP-301, and WP-302.
5. WP-403 before broad public promotion.
6. WP-303 and WP-304.
7. WP-400 through WP-402.
8. WP-500 through WP-502.
9. Pet federation in Stage 6.
10. Stage 7 only after every gate is approved.

The first release should be valuable without a map and without AI. If deterministic search, provenance, correction, source health, and safe data handling are not reliable, do not enable chat.

---

## 24. Decisions intentionally deferred

These choices require evidence or partner input:

- Production hosting provider.
- Authentication provider for moderators.
- Map tile provider.
- Whether raw snapshots need object storage at all.
- Whether contact HMAC matching is legally and operationally justified.
- Whether pgvector adds measurable value for pet matching.
- Exact per-source polling intervals.
- Exact retention periods after legal/source-owner review.
- Public export/open-data licensing.
- Whether the admin UI should become a separate application.
- Whether high traffic justifies Redis or a dedicated queue.

Deferred decisions must not be silently implemented. Create an ADR when one becomes necessary.

---

## 25. Final release gates

### Internal alpha

- Fixture and real-source ingestion work.
- Source policies exist and sources are approved.
- Public-safe field projection tests pass.
- Deterministic search and provenance work.
- Kill switches are tested.

### Limited public beta

- Privacy notice and correction/removal process are live.
- Source-health dashboard and alerts are monitored.
- Database backups and restore test pass.
- Accessibility and low-bandwidth flows pass.
- At least two source owners have been contacted, even if using permitted public-page adapters temporarily.
- No missing-person production data unless Stage 7 gates are complete.

### Chat enablement

- Deterministic search has operated reliably.
- Model-context projection contains no protected fields.
- Citation completeness guard is enforced.
- Safety evaluation suite passes against the pinned model.
- Chat kill switch and fallback work.

### Missing-person enablement

- Every Stage 7 gate is approved in writing.
- Independent privacy/security review is complete.
- Removal and misidentification incident drills pass.

---

## 26. Product statement

The project's differentiator is not that it uses AI. Its value is that a person can search several fragmented systems at once, see when each source was updated, understand when sources disagree, and return to the original platform to verify or act. AI is permitted only where it makes that evidence easier to query without weakening provenance, privacy, or human judgment.
