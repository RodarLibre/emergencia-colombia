/**
 * The Cabuya Protocol surface, v0.1.
 *
 * Cabuya (https://cabuya.org) is the interoperability protocol the apps that
 * appeared after 2026-08-10 agreed to speak: one `place` schema, published as
 * a static JSON feed plus a manifest that says where the feed is. Publishing
 * it here means any of the other apps can read this catalog without writing an
 * adapter for it, which is the same favour every adapter in `src/ingest` had
 * to ask of somebody else.
 *
 * Conformance is measured by their validator, never declared here. Nothing in
 * this file may say a level we have not been measured at — see MANIFEST's
 * `conformance_target`.
 *
 * The spec is at https://cabuya.org/developers/spec/0.1; the section numbers
 * in the comments below point at it.
 */

/** Spec version implemented. Travels in the envelope and in the manifest. */
export const SPEC_VERSION = "0.1.0";

/**
 * Our identity in the protocol's registry.
 *
 * Assigned once and never reassigned, even after a wind-down (§5.3), so it is
 * a constant rather than configuration: changing it would orphan every
 * `emergencia-colombia:{id}` reference anyone else has stored.
 */
export const PUBLISHER_ID = "emergencia-colombia";

export const CANONICAL_URL = "https://emergenciacolombia.org";

/**
 * How consumers should credit this feed (LIC002).
 *
 * It sends the credit onward rather than keeping it. Every record in here
 * belongs to the team that published it first, which is invariant 1 and also
 * §4.3 rule 1: a consumer displaying a foreign record names its origin. Ours
 * is the compilation, and the compilation is the smaller half.
 */
export const ATTRIBUTION =
  "Emergencia Colombia (emergenciacolombia.org). Cada registro nombra la fuente que lo publicó: cítala a ella junto con este feed.";

/** Registry event id for the earthquake this catalog was built for. */
export const EVENT_ID = "sismo-eje-cafetero-2026";

/**
 * Where the two documents live.
 *
 * `/.well-known/cabuya.json` is the RECOMMENDED manifest path (§2.2), and the
 * feed sits outside `/api` deliberately: the middleware answers 404 to
 * anything under `/api` that arrives from the internet, which would make the
 * feed invisible in exactly the way §1.2 calls the discovery trap.
 */
export const MANIFEST_PATH = "/.well-known/cabuya.json";
export const FEED_PATH = "/cabuya/lugares.json";

// --- The record model (§3, place-feed.schema.json) ------------------------

export const PLACE_KINDS = [
  "collection_center",
  "shelter",
  "hospital",
  "health_post",
  "water_point",
  "food_point",
  "distribution_point",
  "warehouse",
  "info_point",
  "command_post",
  "other",
] as const;

export type PlaceKind = (typeof PLACE_KINDS)[number];

export type LifecycleStatus = "active" | "closed" | "planned" | "unknown";
export type ServiceStatus = "open" | "full" | "paused" | "unknown";

export type SourceKind =
  "first_party" | "partner_feed" | "official_source" | "press" | "user_report";

export type SourceAuthority = "government" | "ngo" | "community" | "volunteer" | "commercial";

export type PermittedUse = "display" | "aggregate" | "redistribute" | "ai_answer" | "ai_train";

/** How a confirmation happened (§6.1). Closed enum, never free text. */
export type ConfirmationMethod =
  "in_person" | "phone" | "official_source" | "partner_report" | "user_report" | "unverified";

/**
 * One place, as it travels.
 *
 * The required set is the `Core` profile: id, publisher_id, name, place_kind,
 * municipality_code (the KEY, null is legal), lifecycle_status,
 * last_confirmed_at (the KEY, null is legal and honest), source and
 * public_url, plus the locator rule — `address_text` or `lat`+`lon`.
 *
 * There is no contact field and there will not be one: §7.2 keeps contact
 * values out of feeds entirely, and `contact_available` carries the fact
 * without the value. That is the same rule as invariant 6 arriving from the
 * other direction.
 */
export type CabuyaPlace = {
  id: string;
  publisher_id: string;
  name: string;
  place_kind: PlaceKind;
  place_kind_ext?: string;
  origin_category?: string;
  description?: string;

  municipality_code: string | null;
  municipality_text?: string;
  address_text?: string;
  neighborhood_text?: string;

  lifecycle_status: LifecycleStatus;
  service_status?: ServiceStatus;

  last_confirmed_at: string | null;
  confirmation_method?:
    "in_person" | "phone" | "official_source" | "partner_report" | "user_report" | "unverified";
  last_reported_absent_at?: string;
  updated_at?: string;

  source: {
    source_id: string;
    source_url?: string;
    retrieved_at?: string;
    source_kind?: SourceKind;
  };
  source_authority?: SourceAuthority;
  attribution_required?: boolean;

  public_url: string;
  contact_available?: boolean;

  /**
   * Namespaced extensions (§8.4). Unknown members MUST be preserved by
   * consumers and MUST NOT fail validation, so this is where our vocabulary
   * survives the crosswalk instead of being flattened into it.
   */
  x_emergenciacolombia_record_type?: string;
  x_emergenciacolombia_categories?: string[];
  x_emergenciacolombia_location_precision?: string;
  x_emergenciacolombia_opening_hours?: string;
};

/** The feed envelope (§3.1). */
export type CabuyaFeed = {
  last_updated: string;
  attribution: string;
  ttl: number;
  version: string;
  publisher_id: string;
  license: string;
  permitted_use: PermittedUse[];
  data: { places: CabuyaPlace[] };
};
