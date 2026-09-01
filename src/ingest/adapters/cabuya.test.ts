import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ParserError } from "../types";

import { CORAG, parseCabuya } from "./cabuya";

const fixture = readFileSync("fixtures/corag-cabuya-places.json", "utf8");
const records = parseCabuya(fixture);

type Bundle = {
  manifestUrl: string;
  feedUrl: string;
  manifest: Record<string, unknown>;
  pages: { permitted_use?: unknown; next_cursor?: unknown; data?: { places?: unknown } }[];
};

const base = JSON.parse(fixture) as Bundle;

/** A one-page bundle carrying exactly the places given. */
function bundleOf(places: unknown[], overrides: Partial<Bundle["pages"][number]> = {}): string {
  return JSON.stringify({
    ...base,
    pages: [{ ...base.pages[0], data: { places }, next_cursor: null, ...overrides }],
  });
}

/** A minimal valid place, to be spread over with the case under test. */
function place(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "test-1",
    publisher_id: "corag",
    name: "Acopio Parroquia San José",
    place_kind: "collection_center",
    municipality_code: "66001",
    lifecycle_status: "active",
    last_confirmed_at: "2026-08-19T19:51:04.426039+00:00",
    source: { source_id: "test-1", source_kind: "first_party" },
    public_url: "https://ayuda.corag.app/emergencias/eje-cafetero/puntos-de-ayuda",
    contact_available: false,
    ...over,
  };
}

describe("parseCabuya — the Corag fixture", () => {
  it("reads all fifteen collection centres", () => {
    expect(records).toHaveLength(15);
    for (const r of records) expect(r.recordType).toBe("collection_point");
  });

  it("never carries a contact, because the protocol never sends one", () => {
    // §7.2 keeps values out of feeds and sends `contact_available` instead.
    // Asserted on the output rather than trusted from the spec: the fact that
    // a field cannot legally arrive is not a reason to publish it if it does.
    for (const r of records) {
      expect(r.contacts ?? null).toBeNull();
      const text = [r.title, r.description, r.displayAddress, r.searchText].join(" ");
      expect(text).not.toMatch(/\b3\d{9}\b/);
      expect(text).not.toMatch(/wa\.me|whatsapp/i);
    }
  });

  it("resolves Dosquebradas from the name when the source left the code null", () => {
    // Five of the fifteen arrive with `municipality_text` and a null
    // `municipality_code`. Resolving the name is not inference: it is reading
    // what the source did say.
    const raw = base.pages[0]!.data!.places as {
      municipality_text?: string;
      municipality_code?: string | null;
    }[];
    const nullCoded = raw.filter((p) => p.municipality_code == null);
    expect(nullCoded).toHaveLength(5);
    expect(nullCoded.every((p) => p.municipality_text === "Dosquebradas")).toBe(true);

    const resolved = records.filter((r) => r.admin2Name === "Dosquebradas");
    expect(resolved).toHaveLength(5);
    for (const r of resolved) expect(r.admin2Code).toBe("66170");
  });

  it("gives every record a municipality, an id and a link", () => {
    for (const r of records) {
      expect(r.admin2Code).toMatch(/^\d{5}$/);
      expect(r.externalId).not.toHaveLength(0);
      expect(r.recordUrl.startsWith("https://")).toBe(true);
    }
  });

  it("publishes no address, because the feed carries none", () => {
    // The core profile has no `address_text` in this feed and the coordinates
    // are municipality centroids. Rendering one as a street would be inventing
    // a location (invariant 5), so the field stays null and the record appears
    // at municipality level.
    for (const r of records) expect(r.displayAddress).toBeNull();
  });

  it("is idempotent: the same bytes hash the same way twice", () => {
    const again = parseCabuya(fixture);
    expect(again.map((r) => r.contentHash)).toEqual(records.map((r) => r.contentHash));
    expect(again.map((r) => r.externalId)).toEqual(records.map((r) => r.externalId));
  });
});

describe("parseCabuya — permission", () => {
  it("refuses a feed that does not grant display", () => {
    // The publisher narrowing its terms has to stop us on the next read,
    // without anybody noticing and acting.
    expect(() => parseCabuya(bundleOf([place()], { permitted_use: ["ai_train"] }))).toThrow(
      ParserError,
    );
  });

  it("refuses a feed with no permitted_use at all", () => {
    const stripped = JSON.parse(bundleOf([place()])) as Bundle;
    delete stripped.pages[0]!.permitted_use;
    delete (stripped.manifest as { permitted_use?: unknown }).permitted_use;
    expect(() => parseCabuya(JSON.stringify(stripped))).toThrow(ParserError);
  });
});

describe("parseCabuya — the kind crosswalk", () => {
  it("maps the kinds a person can be sent to", () => {
    const kinds: [string, string][] = [
      ["collection_center", "collection_point"],
      ["shelter", "shelter"],
      ["distribution_point", "service_point"],
      ["hospital", "service_point"],
      ["health_post", "service_point"],
      ["water_point", "service_point"],
      ["food_point", "service_point"],
      ["info_point", "service_point"],
    ];
    for (const [kind, expected] of kinds) {
      const [record] = parseCabuya(bundleOf([place({ place_kind: kind })]));
      expect(record!.recordType, kind).toBe(expected);
    }
  });

  it("drops warehouses and command posts", () => {
    // Operational locations. A warehouse is where an organisation keeps what
    // it already collected, and sending somebody there with a box is worse
    // than not listing it at all.
    for (const kind of ["warehouse", "command_post"]) {
      expect(() => parseCabuya(bundleOf([place({ place_kind: kind })])), kind).toThrow(ParserError);
    }
  });

  it("drops `other` unless our own extension says what it was", () => {
    expect(() => parseCabuya(bundleOf([place({ place_kind: "other" })]))).toThrow(ParserError);

    const [record] = parseCabuya(
      bundleOf([place({ place_kind: "other", x_emergenciacolombia_record_type: "service_point" })]),
    );
    expect(record!.recordType).toBe("service_point");
  });

  it("ignores an extension that names a type outside v1", () => {
    // `missing_person` is gated. A foreign feed asserting it must not be able
    // to route a record past that gate by writing it into an extension.
    expect(() =>
      parseCabuya(
        bundleOf([
          place({ place_kind: "other", x_emergenciacolombia_record_type: "missing_person" }),
        ]),
      ),
    ).toThrow(ParserError);
  });

  it("takes the category the kind itself asserts", () => {
    const [water] = parseCabuya(bundleOf([place({ place_kind: "water_point" })]));
    expect(water!.categoryCodes).toContain("water");
  });

  it("keeps only category codes we actually have", () => {
    const [record] = parseCabuya(
      bundleOf([place({ x_emergenciacolombia_categories: ["water", "no_existe", "food"] })]),
    );
    expect(record!.categoryCodes).toContain("water");
    expect(record!.categoryCodes).toContain("food");
    expect(record!.categoryCodes).not.toContain("no_existe");
  });
});

describe("parseCabuya — status", () => {
  const status = (over: Record<string, unknown>) => parseCabuya(bundleOf([place(over)]))[0]!.status;

  it("maps an open place to active", () => {
    expect(status({ lifecycle_status: "active", service_status: "open" })).toBe("active");
  });

  it("maps a full place to fulfilled, not closed", () => {
    // `closed` would tell somebody the place is gone. It is there and it is
    // not taking more.
    expect(status({ lifecycle_status: "active", service_status: "full" })).toBe("fulfilled");
  });

  it("maps closed to closed", () => {
    expect(status({ lifecycle_status: "closed" })).toBe("closed");
  });

  it("refuses to call a planned or paused place active", () => {
    // We have no word for either, and "active" sends somebody to a door that
    // is not open. "Sin dato" is what we actually know.
    expect(status({ lifecycle_status: "planned" })).toBe("unknown");
    expect(status({ lifecycle_status: "active", service_status: "paused" })).toBe("unknown");
  });
});

describe("parseCabuya — location", () => {
  it("prefers the code the publisher declared over the coordinates", () => {
    // A code the publisher wrote is a statement. Recomputing it would
    // silently overrule them.
    const [record] = parseCabuya(
      bundleOf([place({ municipality_code: "76111", lat: 4.8133, lon: -75.6961 })]),
    );
    expect(record!.admin2Code).toBe("76111");
    expect(record!.admin2Name).toBe("Guadalajara de Buga");
  });

  it("falls back to the coordinates when the source named no municipality", () => {
    const [record] = parseCabuya(
      bundleOf([
        place({
          municipality_code: null,
          municipality_text: undefined,
          lat: 4.8133,
          lon: -75.6961,
        }),
      ]),
    );
    expect(record!.admin2Name).toBe("Pereira");
  });

  it("leaves the municipality null outside the boundaries instead of picking the nearest", () => {
    // Invariant 5, and the reason `municipioEnCoordenada` returns null rather
    // than a nearest match: a point in the Pacific is not "almost Buenaventura".
    const [record] = parseCabuya(
      bundleOf([
        place({ municipality_code: null, municipality_text: undefined, lat: 2.0, lon: -82.0 }),
      ]),
    );
    expect(record!.admin2Code).toBeNull();
  });

  it("ignores a municipality code that is not a real DANE code", () => {
    const [record] = parseCabuya(
      bundleOf([place({ municipality_code: "99999", municipality_text: "Pereira" })]),
    );
    expect(record!.admin2Code).toBe("66001");
  });

  it("takes the address only when the publisher wrote one", () => {
    const [record] = parseCabuya(
      bundleOf([place({ address_text: "Calle 14 #16-29", neighborhood_text: "Boston" })]),
    );
    expect(record!.displayAddress).toBe("Calle 14 #16-29");
    expect(record!.locality).toBe("Boston");
  });
});

describe("parseCabuya — redaction and rejection", () => {
  it("redacts a phone somebody typed into a free-text field", () => {
    // §7.2 forbids contact values, so this should be impossible. People write
    // their number wherever there is room, and the default when a format
    // changes has to be not publishing it.
    const [record] = parseCabuya(
      bundleOf([place({ name: "Acopio 3001234567", description: "Llamar al 3109876543" })]),
    );
    expect(record!.title).not.toMatch(/\b3\d{9}\b/);
    expect(record!.description).not.toMatch(/\b3\d{9}\b/);
    expect(record!.searchText).not.toMatch(/\b3\d{9}\b/);
  });

  it("skips a record with no id, no name, or a non-https link", () => {
    // Each of these is the record's identity or the link a person clicks to
    // check us. None has a safe default.
    for (const broken of [
      { id: "" },
      { name: "   " },
      { public_url: "http://ayuda.corag.app/x" },
    ]) {
      expect(() => parseCabuya(bundleOf([place(broken)])), JSON.stringify(broken)).toThrow(
        ParserError,
      );
    }
  });

  it("keeps the first of two places sharing an id", () => {
    const records = parseCabuya(bundleOf([place({ name: "Primero" }), place({ name: "Segundo" })]));
    expect(records).toHaveLength(1);
    expect(records[0]!.title).toBe("Primero");
  });

  it("throws on empty, on restructured, and on a feed of zero places", () => {
    expect(() => parseCabuya("")).toThrow(ParserError);
    expect(() => parseCabuya("{}")).toThrow(ParserError);
    expect(() => parseCabuya(JSON.stringify({ ...base, pages: [] }))).toThrow(ParserError);
    expect(() =>
      parseCabuya(JSON.stringify({ ...base, pages: [{ permitted_use: ["display"] }] })),
    ).toThrow(ParserError);
    // An empty list is not a quiet day: it is the shape a parser takes when
    // the source changed its vocabulary underneath it.
    expect(() => parseCabuya(bundleOf([]))).toThrow(ParserError);
  });
});

describe("parseCabuya — pagination", () => {
  it("reads places from every page of the bundle", () => {
    const page = (id: string) => ({
      ...base.pages[0],
      next_cursor: null,
      data: { places: [place({ id, source: { source_id: id } })] },
    });
    const records = parseCabuya(JSON.stringify({ ...base, pages: [page("a"), page("b")] }));
    expect(records.map((r) => r.externalId)).toEqual(["a", "b"]);
  });
});

describe("the Corag source config", () => {
  it("never mirrors contacts", () => {
    // Not a policy this adapter can opt into: the protocol carries no value
    // to mirror. Invariant 6 arriving from the other direction.
    expect(CORAG.config.mirrorsContacts ?? false).toBe(false);
  });

  it("declares the mode it is actually read by", () => {
    expect(CORAG.config.mode).toBe("cabuya_feed");
    expect(CORAG.config.coverageAdmin1Code).toBe("66");
  });

  it("polls no faster than the source's own ttl asks for", () => {
    expect(CORAG.config.pollIntervalSeconds).toBeGreaterThanOrEqual(300);
  });
});
