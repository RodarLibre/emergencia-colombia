/**
 * Cabuya Protocol consumer (https://cabuya.org), spec 0.1.
 *
 * One adapter for every publisher that speaks the protocol, instead of one
 * adapter per site. `src/lib/cabuya` already publishes this catalog as a feed;
 * this is the same crosswalk arriving from the other direction, so that a team
 * who does the work of publishing a manifest is connected by adding a config
 * object rather than by somebody writing a parser for them.
 *
 * DISCOVERY
 *
 *   GET /.well-known/cabuya.json  -> manifest (§2)
 *   pick feeds[] where entity = "place"
 *   GET that feed URL             -> envelope with data.places (§3)
 *   follow next_cursor until null
 *
 * The feed URL is never hardcoded: §2 makes the manifest the only stable
 * address, and a publisher moving its feed should not need us to ship a
 * release. Corag already exercises this — its manifest lives on
 * `ayuda.corag.org` and names a feed on `ayuda.corag.app`.
 *
 * WHAT THIS DOES NOT DO
 *
 * Consuming is not republishing. Nothing read here enters our own Cabuya feed
 * unless a grant is added to `REDISTRIBUTION` in `src/lib/cabuya/consent.ts`,
 * which is a separate decision with a name and a date attached — a publisher's
 * `permitted_use` says what they allow, not what we chose to do.
 *
 * There is no contact handling in this file, and that is not an omission.
 * Protocol §7.2 keeps contact values out of feeds entirely and carries only
 * `contact_available`, the fact without the number. Invariant 6 arriving from
 * the other direction, so no source read this way ever needs `mirrorsContacts`.
 */
import { createHash } from "node:crypto";

import { municipioEnCoordenada } from "@/lib/geo";
import {
  buildSearchText,
  extractCategories,
  resolveMunicipality,
  sanitizeText,
} from "@/lib/normalize";
import {
  CATEGORIES,
  MUNICIPALITY_BY_CODE,
  type Category,
  type Municipality,
  type RecordTypeV1,
  type Status,
} from "@/lib/vocab";

import {
  ParserError,
  USER_AGENT,
  redactContact,
  type ParsedRecord,
  type SourceConfig,
} from "../types";

/** RECOMMENDED manifest path (§2.2). Publishers may move it; the config can override. */
export const MANIFEST_PATH = "/.well-known/cabuya.json";

/**
 * A publisher we read. Everything here is per-publisher policy; the parsing
 * below is shared and knows nothing about who it is reading.
 */
export type CabuyaPublisher = {
  slug: string;
  name: string;
  baseUrl: string;
  /** Absolute, so a publisher can serve its manifest from another host. */
  manifestUrl: string;
  pollIntervalSeconds: number;
  coverageAdmin1Code?: string;
  contactNote: string;
};

// --- Wire shapes ----------------------------------------------------------

/**
 * Read defensively rather than with the types in `src/lib/cabuya/protocol.ts`.
 *
 * Those describe what *we* emit and can be trusted field by field. This is
 * somebody else's JSON: §8.4 requires unknown members to be preserved and to
 * not fail validation, which cuts both ways — every field here is optional
 * until it has been checked, including the ones the spec marks required.
 */
type WireManifest = {
  protocol?: { name?: unknown; spec_version?: unknown };
  publisher?: { publisher_id?: unknown; name?: unknown };
  feeds?: { url?: unknown; entity?: unknown; profile?: unknown }[];
  license?: unknown;
  permitted_use?: unknown;
};

type WirePlace = Record<string, unknown>;

type WireFeed = {
  data?: { places?: unknown };
  permitted_use?: unknown;
  license?: unknown;
  publisher_id?: unknown;
  next_cursor?: unknown;
};

/** What `fetch` hands `parse`. One string, like every other adapter. */
type Bundle = {
  manifestUrl: string;
  feedUrl: string;
  manifest: WireManifest;
  pages: WireFeed[];
};

// --- Fetch ----------------------------------------------------------------

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(30_000),
    redirect: "follow",
  });
  if (!response.ok) throw new ParserError(`${url} responded ${response.status}`);

  // A host answering HTML at a discovery path is the failure §2.2 names as the
  // reason the manifest path is only RECOMMENDED. Our own manifest route
  // exists to avoid doing this to somebody else; detect it when it is done to
  // us, because `JSON.parse` on an HTML error page fails much further away.
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new ParserError(`${url} answered ${type || "no content-type"}, not JSON.`);
  }
  try {
    return JSON.parse(await response.text());
  } catch {
    throw new ParserError(`${url} did not return valid JSON.`);
  }
}

/**
 * Pages followed before giving up.
 *
 * A bound rather than a trust exercise: a publisher whose cursor never
 * terminates would otherwise pull us into an unbounded loop against their own
 * infrastructure during an emergency.
 */
const MAX_PAGES = 50;

export async function fetchCabuya(
  publisher: CabuyaPublisher,
  signal?: AbortSignal,
): Promise<string> {
  const manifest = (await getJson(publisher.manifestUrl, signal)) as WireManifest;

  if (manifest?.protocol?.name !== "cabuya") {
    throw new ParserError(
      `${publisher.manifestUrl} is not a Cabuya manifest (protocol.name = ${JSON.stringify(manifest?.protocol?.name)}).`,
    );
  }

  const feeds = Array.isArray(manifest.feeds) ? manifest.feeds : [];
  const placeFeed = feeds.find((f) => f?.entity === "place" && typeof f?.url === "string");
  if (!placeFeed) {
    throw new ParserError(
      `The manifest declares no feed with entity "place" (${feeds.length} feed(s) listed).`,
    );
  }

  const feedUrl = String(placeFeed.url);
  // http would put an emergency answer on a link anybody on the path can
  // rewrite, and every publisher in the registry already serves https.
  if (!feedUrl.startsWith("https://")) {
    throw new ParserError(`The place feed is not served over https: ${feedUrl}`);
  }

  const pages: WireFeed[] = [];
  const seenCursors = new Set<string>();
  let url = feedUrl;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = (await getJson(url, signal)) as WireFeed;
    pages.push(body);

    const cursor = body?.next_cursor;
    if (cursor === null || cursor === undefined || cursor === "") break;
    if (typeof cursor !== "string") {
      throw new ParserError(`next_cursor is ${typeof cursor}, expected a string or null.`);
    }
    // A cursor that repeats means the parameter is not being honoured and we
    // are re-reading page one. Silently collecting the same page fifty times
    // would look like a healthy run.
    if (seenCursors.has(cursor)) {
      throw new ParserError("next_cursor repeated: the feed is not advancing.");
    }
    seenCursors.add(cursor);

    const next = new URL(feedUrl);
    next.searchParams.set("cursor", cursor);
    url = next.toString();

    // Paced like `pereira-ayuda`: the other end is a volunteer project, not a CDN.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return JSON.stringify({
    manifestUrl: publisher.manifestUrl,
    feedUrl,
    manifest,
    pages,
  } satisfies Bundle);
}

// --- Crosswalk, inbound ---------------------------------------------------

/**
 * `place_kind` (§3) -> our record type, plus the category the kind itself
 * asserts.
 *
 * Only the kinds a person can be sent to are here. `warehouse` and
 * `command_post` are operational locations — a warehouse is where an
 * organization keeps what it already collected, not a counter to drop a box
 * at — and directing somebody to one is worse than not listing it. `other`
 * carries no meaning to map, so it resolves only through the extension below.
 */
const PLACE_KINDS: Record<string, { type: RecordTypeV1; category?: Category }> = {
  collection_center: { type: "collection_point" },
  shelter: { type: "shelter", category: "shelter" },
  // Where people receive, not where they drop off. The distinction is the
  // whole difference between "llevá agua acá" and "acá dan agua".
  distribution_point: { type: "service_point" },
  hospital: { type: "service_point", category: "medical_assistance" },
  health_post: { type: "service_point", category: "medical_assistance" },
  water_point: { type: "service_point", category: "water" },
  food_point: { type: "service_point", category: "food" },
  info_point: { type: "service_point", category: "information" },
};

const RECORD_TYPE_EXT = "x_emergenciacolombia_record_type";
const CATEGORIES_EXT = "x_emergenciacolombia_categories";
const HOURS_EXT = "x_emergenciacolombia_opening_hours";

/** Record types this adapter accepts from the extension. v1 institutional places only. */
const EXT_RECORD_TYPES = new Set<RecordTypeV1>(["collection_point", "service_point", "shelter"]);

/**
 * Our own vocabulary surviving a round trip (§8.4).
 *
 * When a place we published is read back — ours from another consumer, or a
 * publisher who adopted the extension — the record type it left with is more
 * accurate than anything `place_kind` can carry, because that is exactly the
 * value the outbound crosswalk had to widen to fit the protocol's enum.
 */
function recordTypeOf(place: WirePlace): { type: RecordTypeV1; category?: Category } | null {
  const ext = place[RECORD_TYPE_EXT];
  if (typeof ext === "string" && EXT_RECORD_TYPES.has(ext as RecordTypeV1)) {
    return { type: ext as RecordTypeV1 };
  }
  const kind = place.place_kind;
  return typeof kind === "string" ? (PLACE_KINDS[kind] ?? null) : null;
}

/**
 * `lifecycle_status` + `service_status` -> our single status.
 *
 * The inverse of `STATUS_MAP` in the outbound crosswalk, and lossy in the
 * directions that matter for safety rather than for fidelity:
 *
 * - `planned` is a place that does not operate yet. We have no word for it,
 *   and "active" would send somebody to a door that is not open — `unknown`
 *   displays as "Sin dato", which is what we actually know.
 * - `paused` is the same argument on a shorter clock.
 */
function statusOf(place: WirePlace): Status {
  const lifecycle = place.lifecycle_status;
  const service = place.service_status;

  if (lifecycle === "closed") return "closed";
  if (lifecycle === "planned") return "unknown";
  if (lifecycle !== "active") return "unknown";

  if (service === "full") return "fulfilled";
  if (service === "paused") return "unknown";
  return "active";
}

/**
 * Where the place is, in the order the source's own claims deserve.
 *
 * The declared municipality wins over the computed one: a code the publisher
 * wrote is a statement, and recomputing it from coordinates would silently
 * overrule them. Coordinates are the fallback for what they left blank —
 * Corag ships five places with `municipality_text: "Dosquebradas"` and a null
 * code — and that is not inference under invariant 5, because a coordinate is
 * *more* precise than a municipality, never less. Nothing here ever produces
 * the nearest municipality: outside the boundaries it stays null.
 */
function municipalityOf(place: WirePlace): Municipality | null {
  const code = place.municipality_code;
  if (typeof code === "string") {
    const known = MUNICIPALITY_BY_CODE.get(code);
    if (known) return known;
  }

  const text = place.municipality_text;
  if (typeof text === "string") {
    const named = resolveMunicipality(text);
    if (named) return named;
  }

  const { lat, lon } = place;
  if (typeof lat === "number" && typeof lon === "number") {
    return municipioEnCoordenada(lat, lon);
  }
  return null;
}

const VALID_CATEGORIES = new Set<string>(CATEGORIES);

function categoriesOf(place: WirePlace, implied: Category | undefined, text: string): Category[] {
  const found = new Set<Category>();
  if (implied) found.add(implied);

  const ext = place[CATEGORIES_EXT];
  if (Array.isArray(ext)) {
    for (const value of ext) {
      if (typeof value === "string" && VALID_CATEGORIES.has(value)) found.add(value as Category);
    }
  }

  // Deterministic vocabulary over the free text, same as every other adapter.
  // `origin_category` is the publisher's own word for the place and goes in
  // as text rather than as an enum: it is theirs, and we do not pretend to
  // know that their "salud" is our `medical_assistance`.
  for (const code of extractCategories(text)) {
    if (VALID_CATEGORIES.has(code)) found.add(code as Category);
  }

  return [...found];
}

function str(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const clean = sanitizeText(value, maxLength);
  return clean || null;
}

function date(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// --- Parse ----------------------------------------------------------------

/**
 * The uses a consumer must be granted to show a record at all.
 *
 * `display` is the floor, and refusing without it is the whole reason the
 * field exists: a publisher that narrowed its terms should stop appearing
 * here on the next read, without anybody having to notice and act.
 */
const REQUIRED_USE = "display";

export function parseCabuya(raw: string): ParsedRecord[] {
  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch {
    throw new ParserError("The bundle is not valid JSON.");
  }
  if (!Array.isArray(bundle?.pages) || bundle.pages.length === 0) {
    throw new ParserError("The bundle carries no feed pages.");
  }

  const out: ParsedRecord[] = [];
  const seen = new Set<string>();

  for (const page of bundle.pages) {
    const permitted = page?.permitted_use ?? bundle.manifest?.permitted_use;
    if (!Array.isArray(permitted) || !permitted.includes(REQUIRED_USE)) {
      throw new ParserError(
        `The feed does not grant "${REQUIRED_USE}" (permitted_use = ${JSON.stringify(permitted)}). Nothing was ingested.`,
      );
    }

    const places = page?.data?.places;
    if (!Array.isArray(places)) {
      throw new ParserError("A feed page has no data.places array.");
    }

    for (const place of places as WirePlace[]) {
      const id = place?.id;
      const publicUrl = place?.public_url;
      // `externalId` is the record's identity across runs and `recordUrl` is
      // what a person clicks to check us. Neither has a safe default.
      if (typeof id !== "string" || !id) continue;
      if (typeof publicUrl !== "string" || !publicUrl.startsWith("https://")) continue;
      // A duplicate id across pages means the cursor walked in a circle.
      if (seen.has(id)) continue;

      const kind = recordTypeOf(place);
      if (!kind) continue;

      const title = str(place.name, 200);
      if (!title) continue;

      seen.add(id);

      const description = str(place.description, 1000);
      const address = str(place.address_text, 240);
      const municipality = municipalityOf(place);

      // Redaction runs even though §7.2 forbids contact values in a feed. A
      // publisher's free-text fields are written by people, and people write
      // their number wherever there is room — five records in the Artefacto
      // Films feed carried one, and that feed had a contact field of its own.
      const cleanTitle = redactContact(title);
      const cleanDescription = description ? redactContact(description) : null;
      const cleanAddress = address ? redactContact(address) : null;

      const categories = categoriesOf(
        place,
        kind.category,
        [cleanTitle, cleanDescription, str(place.origin_category, 120)].filter(Boolean).join(" "),
      );

      const status = statusOf(place);
      // What the source says, never when we read it. `updated_at` is the
      // record's own clock; `last_confirmed_at` is the closest thing when the
      // publisher does not keep one, and Corag sends them identical.
      const sourceUpdatedAt = date(place.updated_at) ?? date(place.last_confirmed_at);

      const record: ParsedRecord = {
        externalId: id,
        recordUrl: publicUrl,
        recordType: kind.type,
        status,
        title: cleanTitle,
        description: cleanDescription,
        categoryCodes: categories,
        locality: str(place.neighborhood_text, 120),
        // Only what the publisher wrote as an address. Coordinates are not
        // promoted into one: invariant 5, and a municipality centroid
        // rendered as a street would be a fabricated address.
        displayAddress: cleanAddress,
        openingHours: str(place[HOURS_EXT], 120),
        admin2Code: municipality?.code ?? null,
        admin2Name: municipality?.name ?? null,
        sourceUpdatedAt,
        contentHash: "",
        searchText: "",
      };

      record.searchText = buildSearchText({
        title: record.title,
        description: record.description,
        locality: record.locality,
        admin2Name: record.admin2Name,
        categoryCodes: record.categoryCodes,
      });

      // The resolved municipality is in the hash on purpose: improving
      // geographic resolution is a change worth a new observation.
      record.contentHash = createHash("sha256")
        .update(
          JSON.stringify([
            record.title,
            record.description,
            record.status,
            record.recordType,
            record.admin2Code,
            record.locality,
            record.displayAddress,
            record.openingHours,
            record.categoryCodes,
            sourceUpdatedAt?.toISOString() ?? null,
          ]),
        )
        .digest("hex");

      out.push(record);
    }
  }

  // Never `[]`: a quiet day and a parser that stopped matching look identical
  // from here, and the second one is the more dangerous of the two.
  if (out.length === 0) {
    throw new ParserError(
      `The feed carried places but none survived the crosswalk. Check whether ${bundle.feedUrl} changed its vocabulary.`,
    );
  }

  return out;
}

// --- Publishers -----------------------------------------------------------

/** Binds a publisher to the shared fetch/parse so the registry stays uniform. */
export function defineCabuyaPublisher(publisher: CabuyaPublisher): {
  config: SourceConfig;
  fetch: () => Promise<string>;
  parse: (raw: string) => ParsedRecord[];
} {
  return {
    config: {
      slug: publisher.slug,
      name: publisher.name,
      baseUrl: publisher.baseUrl,
      // Its own mode: not a feed agreed with us like Artefacto Films', and not
      // pages we read like Donde Ayudo's. It is published openly, to anyone,
      // in a documented protocol — which is a stronger basis than either.
      mode: "cabuya_feed",
      trustLabel: "community",
      pollIntervalSeconds: publisher.pollIntervalSeconds,
      contactNote: publisher.contactNote,
      ...(publisher.coverageAdmin1Code ? { coverageAdmin1Code: publisher.coverageAdmin1Code } : {}),
    },
    fetch: () => fetchCabuya(publisher),
    parse: parseCabuya,
  };
}

/**
 * Corag · Ayuda directa (https://ayuda.corag.org).
 *
 * The first publisher to answer the ask in `docs/PROPUESTA-CORAG.md`: the
 * appendix of 2026-08-20 asked for the collection centres on a route that does
 * not also serve named requests, and they published exactly that — as Cabuya,
 * which is why this adapter is generic instead of being called `corag.ts`.
 *
 * `ayuda.corag.org/robots.txt` allows everything; `corag.app` disallows
 * `/api/`, and no data is read from that host. Their `/integraciones` page
 * documents the feed and states the rule themselves: "El feed no lleva
 * personas ... Del contacto viaja el hecho, nunca el número."
 */
export const CORAG_PUBLISHER: CabuyaPublisher = {
  slug: "corag",
  name: "Corag · Ayuda directa",
  baseUrl: "https://ayuda.corag.org",
  manifestUrl: `https://ayuda.corag.org${MANIFEST_PATH}`,
  // Their envelope asks for 300s. Read at half their rate rather than at
  // theirs: the feed changed once in the thirteen days before it was
  // connected, and the ttl is a ceiling on staleness, not a request.
  pollIntervalSeconds: 1800,
  // 66 = Risaralda, where Pereira and Dosquebradas are and where this catalog
  // is thinnest. Their Bogotá record still arrives; coverage is what the
  // source claims, not a filter.
  coverageAdmin1Code: "66",
  contactNote:
    "robots.txt on ayuda.corag.org allows everything; the manifest at /.well-known/cabuya.json is itself the invitation, and /integraciones documents the feed. Only the place feed is read — never the MCP endpoint, never the write API. Their feed carries no contact values by protocol (§7.2), so nothing is mirrored and mirrorsContacts stays off.",
};

export const CORAG = defineCabuyaPublisher(CORAG_PUBLISHER);
