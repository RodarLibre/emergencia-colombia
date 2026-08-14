import { describe, expect, it } from "vitest";

import { findPossibleSameplace, statusesDisagree } from "./relate";
import type { SearchResult } from "./search";

function result(overrides: Partial<SearchResult>): SearchResult {
  return {
    observationId: 1,
    sourceRecordId: 1,
    recordType: "shelter",
    status: "active",
    title: "",
    description: null,
    categoryCodes: [],
    admin2Name: "Palmira",
    locality: null,
    displayAddress: null,
    openingHours: null,
    locationPrecision: "unknown",
    verificationLevel: "unknown",
    sourceUpdatedAt: null,
    observedAt: new Date("2026-08-13T00:00:00Z"),
    sourceName: "",
    sourceSlug: "source-a",
    sourceTrustLabel: "community",
    noLongerListed: false,
    lastSeenAt: new Date("2026-08-13T00:00:00Z"),
    canonicalUrl: null,
    municipalityUnspecified: false,
    freshness: "fresh",
    ...overrides,
  };
}

describe("findPossibleSameplace — overlap coefficient", () => {
  it("links two titles Jaccard would separate, and flags disagreeing statuses", () => {
    const a = result({
      sourceRecordId: 1,
      sourceSlug: "source-a",
      title: "Albergue Palmira norte - sin cupo",
      status: "fulfilled",
    });
    const b = result({
      sourceRecordId: 2,
      sourceSlug: "source-b",
      title: "Albergue Palmira norte - reportan que sigue abierto",
      status: "active",
    });

    const linked = findPossibleSameplace([a, b]);
    expect(linked.get(a.sourceRecordId)).toEqual([b]);
    expect(linked.get(b.sourceRecordId)).toEqual([a]);
    expect(statusesDisagree(a, linked.get(a.sourceRecordId) ?? [])).toBe(true);
  });

  it("never links results from the same source", () => {
    const a = result({
      sourceRecordId: 1,
      sourceSlug: "source-a",
      title: "Albergue Palmira norte - sin cupo",
    });
    const b = result({
      sourceRecordId: 2,
      sourceSlug: "source-a",
      title: "Albergue Palmira norte - reportan que sigue abierto",
    });

    expect(findPossibleSameplace([a, b]).size).toBe(0);
  });

  it("never links results of different record types", () => {
    const a = result({
      sourceRecordId: 1,
      sourceSlug: "source-a",
      recordType: "shelter",
      title: "Albergue Palmira norte - sin cupo",
    });
    const b = result({
      sourceRecordId: 2,
      sourceSlug: "source-b",
      recordType: "collection_point",
      title: "Albergue Palmira norte - reportan que sigue abierto",
    });

    expect(findPossibleSameplace([a, b]).size).toBe(0);
  });

  it("never links results with fewer than 2 shared tokens", () => {
    const a = result({ sourceRecordId: 1, sourceSlug: "source-a", title: "Albergue norte" });
    const b = result({ sourceRecordId: 2, sourceSlug: "source-b", title: "Albergue sur" });

    expect(findPossibleSameplace([a, b]).size).toBe(0);
  });
});

describe("misma dirección en dos fuentes", () => {
  it("las relaciona aunque el nombre no se parezca en nada", () => {
    // Caso real: donde-ayudo-valle y mapa-emergencia listan la misma esquina
    // del Valle con nombres distintos. Antes no se relacionaban y la persona
    // veía el mismo sitio dos veces sin saberlo.
    const a = result({
      sourceRecordId: 1,
      sourceSlug: "donde-ayudo-valle",
      title: "Parroquia San Judas",
      displayAddress: "Calle 9 con Carrera 44",
    });
    const b = result({
      sourceRecordId: 2,
      sourceSlug: "mapa-emergencia",
      title: "Acopio barrio El Refugio",
      displayAddress: "calle 9 con Cra 44",
    });
    const rel = findPossibleSameplace([a, b]);
    expect(rel.get(1)?.map((r) => r.sourceRecordId)).toEqual([2]);
    expect(rel.get(2)?.map((r) => r.sourceRecordId)).toEqual([1]);
  });

  it("no relaciona direcciones distintas del mismo barrio", () => {
    const a = result({
      sourceRecordId: 1,
      sourceSlug: "donde-ayudo-valle",
      title: "Acopio uno",
      displayAddress: "Calle 9 con Carrera 44",
    });
    const b = result({
      sourceRecordId: 2,
      sourceSlug: "mapa-emergencia",
      title: "Acopio dos",
      displayAddress: "Calle 70 con Carrera 12",
    });
    expect(findPossibleSameplace([a, b]).size).toBe(0);
  });

  it("una dirección demasiado corta no identifica nada", () => {
    const a = result({
      sourceRecordId: 1,
      sourceSlug: "donde-ayudo-valle",
      title: "Acopio uno",
      displayAddress: "Cll 5",
    });
    const b = result({
      sourceRecordId: 2,
      sourceSlug: "mapa-emergencia",
      title: "Acopio dos",
      displayAddress: "Calle 5",
    });
    expect(findPossibleSameplace([a, b]).size).toBe(0);
  });
});
