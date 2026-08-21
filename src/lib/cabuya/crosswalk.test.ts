import { describe, expect, it } from "vitest";

import { hasStateToken, toPlace, type FeedRow } from "./crosswalk";
import { PUBLISHER_ID } from "./protocol";

const BASE = "https://emergenciacolombia.org";

function row(overrides: Partial<FeedRow> = {}): FeedRow {
  return {
    source_record_id: 41,
    record_type: "collection_point",
    status: "active",
    title: "Acopio Parque del Estudiante",
    description: "Reciben agua y ropa.",
    category_codes: ["water"],
    admin2_code: "66001",
    admin2_name: "Pereira",
    locality: "Álamos",
    display_address: "Carrera 27 #10-02",
    opening_hours: "8am a 6pm",
    location_precision: "exact_operational_point",
    verification_level: "source_verified",
    source_updated_at: "2026-08-20T15:00:00.000Z",
    observed_at: "2026-08-21T09:00:00.000Z",
    canonical_url: "https://ejemplo.invalid/p/41",
    contacts: null,
    no_longer_listed: false,
    source_last_read: "2026-08-21T09:00:00.000Z",
    source_slug: "mapa-emergencia",
    source_mode: "partner_feed",
    trust_label: "community",
    ...overrides,
  };
}

function place(overrides: Partial<FeedRow> = {}) {
  const result = toPlace(row(overrides), BASE);
  if (!result.ok) throw new Error(`expected a place, got ${result.reason}`);
  return result.place;
}

function reason(overrides: Partial<FeedRow>) {
  const result = toPlace(row(overrides), BASE);
  return result.ok ? null : result.reason;
}

describe("place kinds", () => {
  it("maps the two types that need no interpretation", () => {
    expect(place().place_kind).toBe("collection_center");
    expect(place({ record_type: "shelter" }).place_kind).toBe("shelter");
  });

  it("resolves a service point when one category names the kind", () => {
    expect(place({ record_type: "service_point", category_codes: ["water"] }).place_kind).toBe(
      "water_point",
    );
    expect(
      place({ record_type: "service_point", category_codes: ["medical_assistance"] }).place_kind,
    ).toBe("health_post");
  });

  it("refuses to guess when the categories name two kinds", () => {
    const both = place({ record_type: "service_point", category_codes: ["water", "food"] });
    expect(both.place_kind).toBe("other");
    expect(both.place_kind_ext).toBe("x_emergenciacolombia_punto_de_servicio");
  });

  it("keeps our own value verbatim, so the crosswalk can be audited", () => {
    const p = place({ record_type: "service_point", category_codes: ["water", "food"] });
    expect(p.origin_category).toBe("service_point");
    expect(p.x_emergenciacolombia_categories).toEqual(["water", "food"]);
  });

  it("leaves out what is not a place", () => {
    expect(reason({ record_type: "official_update" })).toBe("not_a_place");
    expect(reason({ record_type: "hazard" })).toBe("not_a_place");
    expect(reason({ record_type: "seismic_event" })).toBe("not_a_place");
  });
});

describe("what cannot be published", () => {
  it("drops a record with no address, because we hold no coordinates", () => {
    expect(reason({ display_address: null })).toBe("no_locator");
  });

  it("drops a record with no municipality of any kind", () => {
    expect(reason({ admin2_code: null, admin2_name: null })).toBe("no_municipality");
  });

  it("publishes a named municipality with a null code, which the spec allows", () => {
    const p = place({ admin2_code: null, admin2_name: "Dosquebradas" });
    expect(p.municipality_code).toBeNull();
    expect(p.municipality_text).toBe("Dosquebradas");
  });

  it("keeps the municipality_code key present even when it is null", () => {
    expect("municipality_code" in place({ admin2_code: null, admin2_name: "Cali" })).toBe(true);
  });

  it("drops a source whose mode has no honest source_kind", () => {
    expect(reason({ source_mode: "public_html" })).toBe("unmapped_source_mode");
    expect(place({ source_mode: "official_api" }).source.source_kind).toBe("official_source");
  });
});

describe("CR-2: operational state does not live in the name", () => {
  it("detects the token behind an accent and behind punctuation", () => {
    expect(hasStateToken("Acopio Villa Olímpica (CERRADO)")).toBe(true);
    expect(hasStateToken("Albergue lleno")).toBe(true);
    expect(hasStateToken("Acopio Parque del Estudiante")).toBe(false);
  });

  it("does not fire on a word that merely contains a token", () => {
    // "Abiertos" would match a substring search; the boundary is what makes
    // the check usable on real Spanish titles.
    expect(hasStateToken("Colegio Abierta Mente")).toBe(true);
    expect(hasStateToken("Fundación Manos Abiertas")).toBe(false);
  });

  it("leaves the record out rather than rewriting somebody else's title", () => {
    expect(reason({ title: "Acopio Villa Olímpica (CERRADO)" })).toBe("state_in_name");
  });
});

describe("freshness is never overstated", () => {
  it("publishes last_confirmed_at as null unless a grant declares otherwise", () => {
    // The field means somebody confirmed the place is there. By default we
    // hold no such event: CR-1 says an edit is not a confirmation, and being
    // read by us is even less of one. Null is honest and the spec calls it
    // legal — including for a source that calls its own data verified, which
    // says nothing about when.
    expect(place().last_confirmed_at).toBeNull();
    expect(place({ verification_level: "official" }).last_confirmed_at).toBeNull();
    expect(place({ source_updated_at: "2026-08-21T08:59:00.000Z" }).last_confirmed_at).toBeNull();
  });

  it("carries the source's own edit time as updated_at, never as confirmation", () => {
    expect(place().updated_at).toBe("2026-08-20T15:00:00.000Z");
  });

  it("publishes the confirmation when the source's grant says the timestamp is one", () => {
    const result = toPlace(row(), BASE, "user_report");
    if (!result.ok) throw new Error(result.reason);
    expect(result.place.last_confirmed_at).toBe("2026-08-20T15:00:00.000Z");
    expect(result.place.confirmation_method).toBe("user_report");
    // Not both from one value: we know when it was confirmed, not when the
    // row was edited, and writing the same timestamp into `updated_at` would
    // be inventing the second event.
    expect(result.place.updated_at).toBeUndefined();
  });

  it("stays null when the grant declares a confirmation the source did not send", () => {
    const result = toPlace(row({ source_updated_at: null }), BASE, "user_report");
    if (!result.ok) throw new Error(result.reason);
    expect(result.place.last_confirmed_at).toBeNull();
    // And claims no method either: there was no confirmation to describe.
    expect(result.place.confirmation_method).toBe("unverified");
  });

  it("reports an absence the source's listing showed", () => {
    const p = place({ no_longer_listed: true, source_last_read: "2026-08-21T09:00:00.000Z" });
    expect(p.last_reported_absent_at).toBe("2026-08-21T09:00:00.000Z");
    expect(place().last_reported_absent_at).toBeUndefined();
  });
});

describe("provenance and contact", () => {
  it("keeps the original source in the record and us in the envelope", () => {
    const p = place();
    expect(p.source.source_id).toBe("mapa-emergencia");
    expect(p.source.source_id).not.toBe(PUBLISHER_ID);
    expect(p.source.source_url).toBe("https://ejemplo.invalid/p/41");
    expect(p.source.retrieved_at).toBe("2026-08-21T09:00:00.000Z");
    expect(p.attribution_required).toBe(true);
  });

  it("carries the fact of a contact and never the value", () => {
    const withContact = place({ contacts: [{ tipo: "whatsapp", valor: "3001234567" }] });
    expect(withContact.contact_available).toBe(true);
    expect(JSON.stringify(withContact)).not.toContain("3001234567");
    expect(place().contact_available).toBe(false);
  });

  it("links out to our own record page, where the source is named", () => {
    expect(place().public_url).toBe("https://emergenciacolombia.org/r/41");
    expect(place().id).toBe("41");
    expect(place().publisher_id).toBe(PUBLISHER_ID);
  });
});

describe("status becomes two axes", () => {
  it("splits existence from availability", () => {
    expect(place({ status: "active" })).toMatchObject({
      lifecycle_status: "active",
      service_status: "open",
    });
    expect(place({ status: "fulfilled" })).toMatchObject({
      lifecycle_status: "active",
      service_status: "full",
    });
    expect(place({ status: "closed" }).lifecycle_status).toBe("closed");
    expect(place({ status: "closed" }).service_status).toBeUndefined();
  });
});
