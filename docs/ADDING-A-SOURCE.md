# Adding a source

The highest-value contribution to this project. Each connected source makes
every question answerable from one more place.

Read the ten invariants in `AGENTS.md` first. Three of them decide most of this
work: sources start disabled, `robots.txt` is respected with no workaround, and
contact data is mirrored **only** from a source that collects authorization per
person and declares it (`mirrorsContacts`) — for every other source, contacts
are not copied at all.

## Step 0 — Check whether it already speaks Cabuya

Before writing anything, look for a manifest:

```bash
curl -sL https://source.example/.well-known/cabuya.json
```

If it answers a [Cabuya Protocol](https://cabuya.org) manifest naming a feed
with `entity: "place"`, **there is no parser to write.** Add a publisher config
to `src/ingest/adapters/cabuya.ts` and register it:

```ts
export const MY_PUBLISHER: CabuyaPublisher = {
  slug: "my-source",
  name: "My Source",
  baseUrl: "https://source.example",
  manifestUrl: `https://source.example${MANIFEST_PATH}`,
  pollIntervalSeconds: 1800,
  coverageAdmin1Code: "66",
  contactNote: "What robots.txt said, and what is deliberately not read.",
};

export const MY_SOURCE = defineCabuyaPublisher(MY_PUBLISHER);
```

Discovery, pagination, the crosswalk into our vocabulary, municipality
resolution and redaction are shared. Steps 4 and 6 below still apply — commit a
fixture and test it — because the shared code being correct says nothing about
whether *that* publisher's data is what you think it is.

Two things the shared adapter decides for you, so you do not have to:

- **It refuses a feed that does not grant `display` in `permitted_use`.** A
  publisher narrowing its terms stops us on the next read, with nobody having
  to notice.
- **It never reads contacts,** because the protocol never sends them (§7.2).
  A Cabuya source never needs `mirrorsContacts`.

And one it does not: consuming a feed is not republishing it. Nothing read this
way enters our own feed until a grant with a name and a date is added to
`REDISTRIBUTION` in `src/lib/cabuya/consent.ts`, no matter what the publisher's
`permitted_use` allows.

If there is no manifest, carry on.

## Step 1 — Investigate before writing code

**Read `robots.txt` first, every time.**

```bash
curl -sL https://source.example/robots.txt
```

Three outcomes:

- **A rule forbids the path the data arrives by** → the source is `blocked`.
  Stop. It needs a written agreement with the owner. `terremotocolombia.co`
  disallows `/api/`, naming `Claude-User` and `Claude-Web` explicitly, and all
  of its records load from that API. It is not worked around, and driving a
  browser to make it call that API would be circumventing the rule.
- **No `robots.txt`** → no restriction declared. Proceed, politely.
- **Allowed** → proceed.

Then look at how the data actually arrives. The browser's network panel beats
reading the bundle:

- Server-rendered HTML → parse the page. (Cali Ayuda)
- A static JS chunk with the data inlined → parse the chunk. (Donde Ayudo)
- A static JSON feed → parse it. (SGC)
- Only a private API → needs an agreement.

**Prefer a static asset over an API when both exist.** A CDN-served file costs
the owner nothing; polling their API spends the quota and database of a
volunteer-run service during an emergency.

## Step 2 — Decide what NOT to ingest

Usually the most important decision, and it is made here rather than later.

- **Personal data is not copied.** Phone numbers, WhatsApp links, private
  addresses, individual names. Link to the source instead. Cali Ayuda's page
  carries three kinds of report and only "Punto de ayuda" is ingested; needs
  and offers belong to individuals and carry a phone number and a first name.
  The **one** exception is a source that collects authorization per person and
  says so, like CORAG: set `mirrorsContacts` on that source and only that
  source. It is a property of the source's consent model, never a global
  setting, and redaction keeps running over the free text either way.
- **Names of volunteers are not copied either.** Donde Ayudo records who
  verified each point. The fact of verification is kept; the identity is not.
- **Only institutional record types** in v1: collection points, service points,
  shelters, official updates, hazards, seismic events. Anything in
  `RECORD_TYPES_GATED` needs a privacy review first.
- **Filter for relevance at the source.** The SGC feed carries 200 Colombian
  events since the incident, 178 of them magnitude 2.x that nobody felt.
  Ingesting all of them would bury the humanitarian records. Ask what a person
  would actually ask about.

## Step 3 — Write the adapter

One file in `src/ingest/adapters/`. Export three things:

```ts
export const MY_SOURCE = {
  slug: "my-source",
  name: "My Source",
  baseUrl: "https://source.example",
  mode: "public_html", // official_api | partner_feed | public_html | manual
  trustLabel: "community", // official | ngo | community
  pollIntervalSeconds: 900,
  coverageAdmin1Code: "76", // department the source claims to cover
  contactNote: "What robots.txt said, what was excluded, and why.",
} as const;

export async function fetchMySource(signal?: AbortSignal): Promise<string>;
export function parseMySource(raw: string, now?: Date): ParsedRecord[];
```

`ParsedRecord` is in `src/ingest/types.ts`. Rules that matter:

- **`externalId` must be stable across runs.** It is the record's identity. A
  positional index is not stable.
- **`recordUrl` must be real.** Verify it against the live site. A single-page
  app returns 200 for any path, so a status code proves nothing — open it.
- **Apply `redactContact` to every text field**, even when you do not expect a
  phone number. If the source's format changes, the default must be not to
  publish it.
- **`sourceUpdatedAt` is what the source says**, `observedAt` is when we read
  it. They are different. Leave it `null` if the source publishes no date;
  never infer one from position on the page.
- **Everything that can change goes in `contentHash`.** If a field is not in the
  hash, a change to it will be silently swallowed as "unchanged". Include the
  resolved municipality: improving geographic resolution should produce a new
  observation.
- **Throw `ParserError` when extraction fails.** Never return `[]` — an empty
  list is indistinguishable from a quiet day, and a half-broken parser is the
  most dangerous failure mode this project has.

### Anchor the parser on things that survive a redeploy

Routes and visible labels are stable. CSS classes and bundle filenames are not.
Cali Ayuda's parser anchors on `/reports/<uuid>` and the Spanish label "Punto de
ayuda", not on Tailwind classes. Donde Ayudo's chunk filename carries a content
hash, so the adapter discovers it: page → entry bundle → the chunk containing a
known data marker.

### Municipalities

Never write DANE codes by hand. Use `resolveMunicipality(name)` for a field that
holds a municipality, and `findMunicipalityInText(text)` to read one out of free
text. Both are in `src/lib/normalize.ts` and both know about the traps:
beneficiary prepositions, venue names that match municipalities, and names that
are also neighborhoods.

If nothing resolves, leave it `null`. Do not assume. A record without a
municipality still appears under its source's declared coverage area, labeled
"la fuente no especificó municipio" — which is better than an invented location.

## Step 4 — Commit a sanitized fixture

Save a real response to `fixtures/`, with personal data removed, and **verify
the removal**:

```bash
grep -cE '\b3[0-9]{9}\b' fixtures/my-source.html   # expect 0
```

Tests run against the fixture. They never hit the network.

## Step 5 — Register it

In `src/ingest/registry.ts`:

```ts
"my-source": {
  config: MY_SOURCE,
  fixture: "fixtures/my-source.html",
  fetch: fetchMySource,
  parse: parseMySource,
  verificationLevel: "community_unverified",
},
```

`verificationLevel` states what the source claims, no more. `official` is for
government sources on the fields they actually publish. `source_verified` means
that source verified it — the label will name them.

## Step 6 — Test

Required, not optional. Follow `src/ingest/adapters/sgc.test.ts`. Cover:

- The expected record count from the fixture
- No contact data in any output field
- Whatever you deliberately excluded stays excluded
- Municipality resolution on a known record
- `ParserError` on empty and on restructured input

Then break your own code and confirm a test fails. A test that passes against
broken code protects nothing.

## Step 7 — Run it

```bash
pnpm ingest my-source --fixture     # offline first
pnpm ingest my-source               # live, still disabled
pnpm ingest my-source               # again: everything should be "unchanged"
pnpm ingest my-source --habilitar   # only once you have looked at the records
```

The second live run proving `unchanged` is the idempotency check. If records
show as `updated` every run, something unstable is in your `contentHash` — a
timestamp, or a value the source reorders.

Sources start disabled and their records do not appear in search until you
enable them deliberately.

## Step 8 — Document it

Add a row to the source table in `README.md`: what `robots.txt` said, what was
excluded, and why. That row is what stops the next person re-litigating a
decision you already made.

## What breaks in production

The count-collapse guard refuses a run returning more than 40% fewer records
than what is stored, and writes nothing:

```
QUARANTINE: the source returned 29 records and the previous run had 86 …
```

That is usually a half-broken parser, not a real drop. Check the source before
reaching for `--forzar`.

Records that vanish from a listing are **never** deleted. Only an explicit
withdrawal by the source removes one. A failed run's only consequence is that
there are no new observations.
