import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ParserError } from "../types";

import { INCIDENT_START, parseCloserTowns, parseSgcFeed } from "./sgc";

const feed = readFileSync("fixtures/sgc-five-days.json", "utf8");
const records = parseSgcFeed(feed);

describe("parseSgcFeed — scope", () => {
  it("keeps only events in Colombia", () => {
    // The SGC republishes significant events from USGS, IGEPN and GFZ. A
    // magnitude 5.5 off El Salvador is noise in a catalog about one Colombian
    // earthquake.
    const raw = JSON.parse(feed) as { features: { properties: { place?: string } }[] };
    const foreign = raw.features.filter(
      (f) => !(f.properties.place ?? "").toLowerCase().includes("colombia"),
    );
    expect(foreign.length).toBeGreaterThan(0);
    for (const r of records) {
      expect(r.title.toLowerCase()).toContain("colombia");
    }
  });

  it("keeps only events from the incident date onward", () => {
    const start = new Date(`${INCIDENT_START}T00:00:00Z`);
    for (const r of records) {
      expect(r.sourceUpdatedAt).not.toBeNull();
      expect(r.sourceUpdatedAt!.getTime()).toBeGreaterThanOrEqual(start.getTime());
    }
  });

  it("drops the unfelt micro-earthquakes that dominate the feed", () => {
    // 200 Colombian events since the incident, 178 of them magnitude 2.x that
    // nobody noticed. Ingesting all of them would bury 94 humanitarian records.
    const raw = JSON.parse(feed) as { features: unknown[] };
    expect(raw.features.length).toBeGreaterThan(200);
    expect(records.length).toBeLessThan(15);
  });

  it("keeps a magnitude 2.8 that 124 people felt", () => {
    // The point of filtering by `felt` rather than magnitude: this event is
    // weaker than 178 that were dropped, and more relevant than all of them.
    const sipi = records.find((r) => r.title.includes("M2.8"));
    expect(sipi).toBeDefined();
    expect(sipi!.description).toContain("124");
  });

  it("includes the main shock", () => {
    const main = records.find((r) => r.title.includes("M7.4"));
    expect(main).toBeDefined();
    expect(main!.description).toContain("20.204");
    expect(main!.recordUrl).toBe("https://sgc.gov.co/detallesismo/SGC2026pqqmro");
  });
});

describe("parseSgcFeed — record shape", () => {
  it("types every record as seismic_event, which never goes stale", () => {
    for (const r of records) expect(r.recordType).toBe("seismic_event");
  });

  it("never sets an address: an epicentre is not a place to visit", () => {
    for (const r of records) {
      expect(r.displayAddress).toBeNull();
      expect(r.openingHours).toBeNull();
    }
  });

  it("resolves a municipality from the nearest town", () => {
    const main = records.find((r) => r.title.includes("M7.4"))!;
    expect(main.admin2Name).toBe("San José del Palmar");
  });

  it("states whether the solution was reviewed by an analyst", () => {
    const main = records.find((r) => r.title.includes("M7.4"))!;
    expect(main.description).toContain("Revisado por un analista");
  });

  it("puts nearby municipalities in the searchable text", () => {
    // The epicentre is in Chocó, but El Cairo and El Águila (Valle) are 27 and
    // 29 km away. Someone in Valle searching by name should find it.
    const main = records.find((r) => r.title.includes("M7.4"))!;
    expect(main.searchText).toContain("cairo");
  });

  it("includes `updated` in the content hash so revisions create observations", () => {
    // The SGC refines magnitude and depth for hours. The main shock was still
    // being revised three days later, and each revision should produce a new
    // observation rather than being hidden as "unchanged".
    const mainShockId = "SGC2026pqqmro";
    const before = parseSgcFeed(feed).find((r) => r.externalId === mainShockId)!;

    const raw = JSON.parse(feed) as {
      features: { id: string; properties: { updated?: string } }[];
    };
    const target = raw.features.find((f) => f.id === mainShockId)!;
    expect(target.properties.updated).toBeDefined();
    target.properties.updated = "2026-08-14 01:00:00";

    const after = parseSgcFeed(JSON.stringify(raw)).find((r) => r.externalId === mainShockId)!;
    expect(after.contentHash).not.toBe(before.contentHash);
  });
});

describe("parseCloserTowns", () => {
  it("parses town, department and distance", () => {
    expect(
      parseCloserTowns("San José Del Palmar (Chocó) a 12 km, El Cairo (Valle Del Cauca) a 27 km"),
    ).toEqual([
      { town: "San José Del Palmar", department: "Chocó", distanceKm: 12 },
      { town: "El Cairo", department: "Valle Del Cauca", distanceKm: 27 },
    ]);
  });

  it("returns an empty list for missing or malformed input", () => {
    expect(parseCloserTowns(null)).toEqual([]);
    expect(parseCloserTowns("")).toEqual([]);
    expect(parseCloserTowns("no distances here")).toEqual([]);
  });
});

describe("parseSgcFeed — failure modes", () => {
  it("throws ParserError on non-JSON instead of returning []", () => {
    expect(() => parseSgcFeed("<html>maintenance</html>")).toThrow(ParserError);
  });

  it("throws ParserError on a feed with no features instead of returning []", () => {
    expect(() => parseSgcFeed(JSON.stringify({ features: [] }))).toThrow(ParserError);
  });

  it("returns an empty list when everything is filtered out, without throwing", () => {
    // A quiet week is not a parser failure. The count-collapse guard in
    // upsert.ts is what catches a broken parser.
    const future = parseSgcFeed(feed, new Date(), { incidentStart: "2099-01-01" });
    expect(future).toEqual([]);
  });
});
