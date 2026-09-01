import { fold } from "../normalize";
import type { Category } from "../vocab";

import {
  PUBLISHER_ID,
  type ConfirmationMethod,
  type CabuyaPlace,
  type LifecycleStatus,
  type PlaceKind,
  type ServiceStatus,
  type SourceAuthority,
  type SourceKind,
} from "./protocol";

/**
 * Our vocabulary translated into the protocol's, one record at a time.
 *
 * Pure on purpose: the whole crosswalk is decidable from a single row, so it
 * is testable without a database and every judgement call in it is visible in
 * one file. Where the two vocabularies do not line up the record is dropped
 * with a reason, never bent until it fits — a place published under the wrong
 * kind directs somebody wrongly, and a place not published directs nobody.
 */

/** What the feed query hands to `toPlace`. Column names, not camelCase. */
export type FeedRow = {
  source_record_id: number;
  record_type: string;
  status: string;
  title: string;
  description: string | null;
  category_codes: string[];
  admin2_code: string | null;
  admin2_name: string | null;
  locality: string | null;
  display_address: string | null;
  opening_hours: string | null;
  location_precision: string;
  verification_level: string;
  source_updated_at: string | Date | null;
  observed_at: string | Date;
  canonical_url: string | null;
  contacts: unknown[] | null;
  no_longer_listed: boolean;
  source_last_read: string | Date;
  source_slug: string;
  source_mode: string;
  trust_label: string;
};

export type Excluded =
  /** Not a place: a communiqué, an alert or an earthquake. v0.1 carries places. */
  | "not_a_place"
  /** No address and we hold no coordinates, so the locator rule (§3.1) fails. */
  | "no_locator"
  /** Neither a DIVIPOLA code nor a municipality name to put in its place. */
  | "no_municipality"
  /** The source wrote the operational state into the name (CR-2 / REC010). */
  | "state_in_name"
  /** How we read this source has no honest word in the `source_kind` enum. */
  | "unmapped_source_mode";

export type CrosswalkResult = { ok: true; place: CabuyaPlace } | { ok: false; reason: Excluded };

// --- Kinds ----------------------------------------------------------------

/**
 * The three record types that are places. The other three are not:
 * `official_update` is an announcement, `hazard` is an alert (v0.2 points
 * those at CAP, which Colombia already uses officially) and `seismic_event` is
 * an event. None of them has an address you can drive to, which is what a
 * `place` is.
 */
const PLACE_TYPES: Record<string, PlaceKind | "by_category"> = {
  collection_point: "collection_center",
  shelter: "shelter",
  service_point: "by_category",
};

/**
 * A service point's kind, when its categories name one unambiguously.
 *
 * Only single-category records resolve. "Agua y alimentos" is a real thing a
 * point can be, and the protocol has no word for it: guessing `water_point`
 * would hide the food and guessing `distribution_point` would invent a claim
 * neither the source nor we ever made. Those become `other` plus the
 * extension, and `origin_category` carries our own value verbatim so the
 * crosswalk stays auditable from the record itself.
 */
const CATEGORY_KINDS: Partial<Record<Category, PlaceKind>> = {
  water: "water_point",
  food: "food_point",
  medical_assistance: "health_post",
  medical_supplies: "health_post",
  information: "info_point",
};

const SERVICE_POINT_EXT = "x_emergenciacolombia_punto_de_servicio";

function placeKindOf(row: FeedRow): { kind: PlaceKind; ext?: string } | null {
  const mapped = PLACE_TYPES[row.record_type];
  if (!mapped) return null;
  if (mapped !== "by_category") return { kind: mapped };

  const kinds = new Set(
    row.category_codes.map((c) => CATEGORY_KINDS[c as Category]).filter(Boolean) as PlaceKind[],
  );
  if (kinds.size === 1) return { kind: [...kinds][0]! };
  return { kind: "other", ext: SERVICE_POINT_EXT };
}

// --- Status ---------------------------------------------------------------

/**
 * One status of ours becomes two of theirs: whether the place exists
 * (`lifecycle_status`) and whether it is taking people right now
 * (`service_status`). Splitting them is what lets a closed place stay in the
 * feed as closed instead of vanishing, which is the same reason invariant 3
 * refuses to delete a record for going absent.
 *
 * `withdrawn` is not here: a withdrawn record never reaches the feed. §7.3 is
 * explicit that suppressed records are omitted and never labelled downstream,
 * and a foreign moderation verdict republished without appeal is exactly the
 * shape of a defamation risk.
 */
const STATUS_MAP: Record<string, { lifecycle: LifecycleStatus; service?: ServiceStatus }> = {
  active: { lifecycle: "active", service: "open" },
  // "Parcialmente atendido": still operating, still receiving.
  partially_fulfilled: { lifecycle: "active", service: "open" },
  // "Atendido": the need was met. The place exists and is not taking more,
  // which is what `full` says — closer than `closed`, which would send
  // somebody the message that it is gone.
  fulfilled: { lifecycle: "active", service: "full" },
  closed: { lifecycle: "closed" },
  unknown: { lifecycle: "unknown", service: "unknown" },
};

// --- Provenance -----------------------------------------------------------

/**
 * Our ingest mode becomes the protocol's `source_kind`.
 *
 * Only the two modes that can carry a redistribution grant are here.
 * `public_html` and `sitemap_html` mean we read somebody's pages, and the
 * enum has no honest word for that — `press` and `user_report` would both be
 * false. A source read that way and granted anyway would arrive as a feed or
 * an API first, which changes its mode. Anything unmapped drops the record
 * rather than mislabelling where it came from.
 */
const SOURCE_KINDS: Record<string, SourceKind> = {
  official_api: "official_source",
  partner_feed: "partner_feed",
  // Read from the publisher's own Cabuya feed. `partner_feed` is the enum's
  // word for "another publisher handed this to us", which is exactly what a
  // manifest does — more openly than a private agreement, not less.
  cabuya_feed: "partner_feed",
};

const AUTHORITIES: Record<string, SourceAuthority> = {
  official: "government",
  ngo: "ngo",
  community: "community",
};

// --- CR-2: state does not live in the name --------------------------------

/**
 * The validator's own list (REC010, an error). A name carrying "(cerrado)" is
 * wrong the moment the place reopens, and the state belongs in the status
 * fields where a consumer can act on it.
 *
 * We do not edit it out. §4.3 rule 3 forbids altering a foreign record's
 * content, and rewriting somebody's title to pass a check would be the exact
 * kind of quiet fix this project refuses everywhere else. The record is left
 * out of the feed and stays visible in our own interface, where the state is
 * shown next to it anyway.
 */
const STATE_TOKENS = [
  "cerrado",
  "cerrada",
  "lleno",
  "llena",
  "abierto",
  "abierta",
  "inactivo",
  "inactiva",
  "suspendido",
  "suspendida",
  "closed",
  "full",
  "open",
  "inactive",
  "paused",
];

export function hasStateToken(name: string): boolean {
  const folded = fold(name);
  return STATE_TOKENS.some((token) => new RegExp(`\\b${token}\\b`).test(folded));
}

// --- The crosswalk --------------------------------------------------------

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

/**
 * `confirmation` is the source's declared semantics for `source_updated_at`,
 * from its grant in `consent.ts`. Passing it is what turns that column into a
 * confirmation; without it the column stays an edit and nothing else.
 */
export function toPlace(
  row: FeedRow,
  publicUrlBase: string,
  confirmation?: ConfirmationMethod | null,
): CrosswalkResult {
  const kind = placeKindOf(row);
  if (!kind) return { ok: false, reason: "not_a_place" };

  // The locator rule: `address_text` OR lat+lon, and we hold no coordinates —
  // no adapter has ever received any. A record reduced to its municipality
  // cannot be published as a place somebody can reach, and composing an
  // address out of the neighbourhood would be upgrading precision by
  // inference, which invariant 5 forbids.
  if (!row.display_address) return { ok: false, reason: "no_locator" };

  if (!row.admin2_code && !row.admin2_name) return { ok: false, reason: "no_municipality" };

  if (hasStateToken(row.title)) return { ok: false, reason: "state_in_name" };

  const status = STATUS_MAP[row.status] ?? {
    lifecycle: "unknown" as const,
    service: "unknown" as const,
  };
  const sourceKind = SOURCE_KINDS[row.source_mode];
  if (!sourceKind) return { ok: false, reason: "unmapped_source_mode" };

  const confirmed = confirmation && row.source_updated_at ? iso(row.source_updated_at) : null;

  const place: CabuyaPlace = {
    id: String(row.source_record_id),
    publisher_id: PUBLISHER_ID,
    name: row.title,
    place_kind: kind.kind,
    ...(kind.ext ? { place_kind_ext: kind.ext } : {}),
    origin_category: row.record_type,
    ...(row.description ? { description: row.description } : {}),

    municipality_code: row.admin2_code,
    ...(row.admin2_name ? { municipality_text: row.admin2_name } : {}),
    address_text: row.display_address,
    ...(row.locality ? { neighborhood_text: row.locality } : {}),

    lifecycle_status: status.lifecycle,
    ...(status.service ? { service_status: status.service } : {}),

    /**
     * Only when the source publishes a confirmation and its grant says so.
     *
     * We are an aggregator: we never go anywhere and we confirm nothing
     * ourselves. What we hold is when we read the source (`observed_at`) and
     * one timestamp the source published — and CR-1 exists precisely to stop
     * those being passed off as confirmation. A read is not a confirmation,
     * and an edit is not either.
     *
     * Some sources do publish the real thing. Mapa de Emergencia's
     * `confirmado` is somebody saying the point is still there, and showing it
     * is a condition of the agreement with them. Where a grant declares that,
     * the timestamp goes here and `updated_at` stays empty — we know when it
     * was confirmed, not when the row was edited, and saying both from one
     * value would be inventing the second.
     *
     * Everywhere else this is null. The protocol calls null "never confirmed"
     * and calls it legal; publishing a timestamp anyway would make every
     * record look fresher than anyone can vouch for.
     */
    last_confirmed_at: confirmed,
    // The method describes a confirmation that happened. With no timestamp
    // there was none to describe, whatever the grant declares the column
    // usually holds.
    confirmation_method: confirmed && confirmation ? confirmation : "unverified",

    source: {
      // The original publisher, not us. Our identity is in the envelope, and
      // §4.3 rule 4 says an aggregator republishing keeps the original chain
      // intact — which is invariant 1 written in somebody else's schema.
      source_id: row.source_slug,
      ...(row.canonical_url ? { source_url: row.canonical_url } : {}),
      retrieved_at: iso(row.observed_at),
      source_kind: sourceKind,
    },
    ...(AUTHORITIES[row.trust_label] ? { source_authority: AUTHORITIES[row.trust_label] } : {}),
    attribution_required: true,

    public_url: `${publicUrlBase}/r/${row.source_record_id}`,
    // The fact, never the value (§7.2). The number itself stays where
    // invariant 6 put it: in the record's current state, shown attributed, and
    // gone from here the moment the source stops publishing it.
    contact_available: Array.isArray(row.contacts) && row.contacts.length > 0,

    x_emergenciacolombia_record_type: row.record_type,
    x_emergenciacolombia_categories: row.category_codes,
    x_emergenciacolombia_location_precision: row.location_precision,
  };

  if (!confirmation && row.source_updated_at) place.updated_at = iso(row.source_updated_at);
  if (row.opening_hours) place.x_emergenciacolombia_opening_hours = row.opening_hours;

  /**
   * Negative confirmation, which the protocol treats as first-class (§6.1).
   *
   * The source read fine and did not list this record. That is not a
   * withdrawal — invariant 3 — and it is not nothing either, which is the same
   * reasoning behind the "ya no aparece" note on our own cards. The absence
   * was observed at the source's last read, so that is the timestamp.
   *
   * Windowed sources are excluded upstream in SQL: a feed that publishes only
   * the last six hours drops records for a living, and reporting that as
   * absence would mark a whole town's shelters as gone.
   */
  if (row.no_longer_listed) place.last_reported_absent_at = iso(row.source_last_read);

  return { ok: true, place };
}
