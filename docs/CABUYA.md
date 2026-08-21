# Publishing the Cabuya feed

[Cabuya](https://cabuya.org) is the interoperability protocol the apps that
appeared after 2026-08-10 agreed to speak: one `place` schema, four transports,
and conformance measured by a published validator rather than declared. This
catalog now publishes two of its surfaces.

Every adapter in `src/ingest` exists because somebody else's site had no
machine-readable surface. Publishing one is the same favour, returned.

| Surface | Path | What it is |
|---|---|---|
| Manifest | `/.well-known/cabuya.json` | Who we are, where the feed is, what may be done with it (§2) |
| Place feed | `/cabuya/lugares.json` | The catalog as `place` records (§3) |
| Advertisement | `<link rel="cabuya">` in the layout | The second discovery mechanism (§2.2) |
| `robots.txt` | `/robots.txt` | An L2 precondition (§1.2), and the site's crawl policy said out loud |

Code lives in `src/lib/cabuya/`: `protocol.ts` (types and constants),
`consent.ts` (**the one human decision**), `crosswalk.ts` (our vocabulary into
theirs, pure and tested) and `feed.ts` (the query).

## The feed is empty, and that is the honest state

`consent.ts` holds the list of sources whose records may be republished. It is
empty.

Everything in this catalog belongs to the team that published it first.
Reading it to answer a question in our own interface is one thing; handing it
to any consumer as a machine-readable feed is another. §7.3 of the spec is
explicit — data enters the network by publication, never by scraping — and it
lines up exactly with invariant 10: sources start disabled and are enabled one
at a time.

Where each source stands today is recorded in the comment at the top of
`consent.ts`. The short version: `mapa-emergencia` has an agreement that grants
*display*, not redistribution, and is one email away; `pereira-ayuda`'s
robots.txt invites indexing, which is not the same permission; `cali-ayuda` and
`donde-ayudo-valle` have no agreement at all; `sgc-sismos` carries earthquakes,
and an earthquake is not a `place`.

Until then the feed serves `"places": []` with a valid envelope — a publisher
whose sources have not authorised redistribution, which is a true statement,
rather than a broken link.

## Adding a grant

One entry in `REDISTRIBUTION`, in a pull request that says who agreed and when:

```ts
"mapa-emergencia": {
  license: "CC-BY-4.0",
  permittedUse: ["display", "aggregate"],
  grantedOn: "2026-09-01",
  note: "Jorge Caballero (Artefacto Films) por correo; atribución con enlace al mapa.",
  // Only if the source publishes a real confirmation event and
  // `sourceUpdatedAt` holds it. See below.
  confirmation: { method: "user_report" },
},
```

Adding one also flips the manifest's `conformance_target` from L1 to L2, in the
same commit that makes it true. The badge still comes from somebody else
measuring it — that is the whole point of §8.3.

Two rules the code enforces so they cannot be forgotten:

- **One envelope carries one licence.** If two grants declare different ones,
  `feedLicense()` throws instead of picking. The fix is a decision — relicense,
  or split the feed per source — never a default.
- **`permitted_use` is an intersection, never a union.** A consumer reading
  `aggregate` must be able to trust that all of it may be aggregated.

## `last_confirmed_at`, the field everyone gets wrong

The protocol's own stack guides say adaptations break at `last_confirmed_at`
every time, because the guide shows a mapping and the real app has no
confirmation event.

We have two timestamps and neither is one by default: `observed_at` is when we
read the source, and `source_updated_at` is when the source last touched the
row. CR-1 exists precisely to keep those apart — **an edit is not a
confirmation**, and being read by us is even less of one. So the default is
`null`, which the spec calls legal and honest.

Some sources publish the real thing. Mapa de Emergencia's `confirmado` is
somebody saying the point is still there, and showing it is a condition of the
agreement with them. That is declared per source in the grant, never assumed —
the same column means different things in different adapters, and the only
place that distinction is known is next to the person who read the source's
documentation. Where a grant declares it, the timestamp becomes
`last_confirmed_at` and `updated_at` is left empty: we know when it was
confirmed, not when the row was edited, and writing one value into both would
invent the second event.

## What the crosswalk refuses to publish

A record is dropped, never bent until it fits. `crosswalk.ts` returns a reason
for each:

| Reason | Why |
|---|---|
| `not_a_place` | `official_update`, `hazard` and `seismic_event` have no address you can drive to. v0.1 carries places; alerts point at CAP in v0.2. |
| `no_locator` | No address, and we hold no coordinates. Composing one from the neighbourhood would upgrade precision by inference (invariant 5). |
| `no_municipality` | Neither a DIVIPOLA code nor a municipality name. |
| `state_in_name` | The source wrote "(cerrado)" into the title. CR-2 forbids publishing it and §4.3 rule 3 forbids editing somebody else's record, so it stays out of the feed and stays visible on our own pages. |
| `unmapped_source_mode` | `public_html` has no honest value in the `source_kind` enum. A source granted redistribution arrives as a feed or an API first, which changes its mode. |

Two more things never travel: contact values (§7.2 — `contact_available`
carries the fact, and invariant 6 keeps the number in the record's current
state) and withdrawn records (§7.3 — omitted, never republished with somebody
else's moderation verdict attached).

## Measured, on real data

Dry run against the dev database on 2026-08-21, with `mapa-emergencia`
temporarily granted (reverted afterwards; the grant list in `main` is empty):

- 138 live records in, **91 places out** — 39 dropped for `no_municipality`,
  8 for `no_locator`, 0 for anything else.
- `cabuya-validator feed` — **0 errors, 0 infos**, 163 warnings, all of two
  kinds:
  - `REC005` ×91 — address but no `lat`/`lon`. Both are RECOMMENDED. The
    source publishes coordinates and the catalog does not store them; that is
    a schema change, and it would also fix most of the 39 records dropped for
    having no municipality.
  - `REC013` ×72 — a collection point with no `expires_at`. No source
    publishes one, and inventing an expiry date is inventing a closure.
- `cabuya-validator validate` against the live manifest: schema-valid,
  soft-404 `pass`, CORS `present`.

Reproduce it with:

```bash
curl -s http://localhost:3000/cabuya/lugares.json | cabuya-validator feed -
```

## Not published

- **Coordinates.** No adapter stores them. See REC005 above.
- **A `contact` in the manifest.** It takes an org-level role address and this
  project has never had one. Inventing one to fill the slot is the kind of
  unbacked claim the protocol's Rule-0 refuses.
- **A registry entry.** `registry/publishers/` in `Cabuya/cabuya.org` is a
  separate pull request, and it should come after a source has granted
  redistribution — the entry is a claim about who we are, and an adopter entry
  additionally needs a measured L2.
- **`Cache-Control` on either route.** `next.config.ts` sets `no-store`
  site-wide and wins over anything a handler sets. Nothing is lost: `ttl` is
  the protocol's caching contract, and the spec never mentions the HTTP header.
