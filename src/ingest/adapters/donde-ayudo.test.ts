import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ParserError } from "../types";
import { parseDondeAyudo } from "./donde-ayudo";

const FIXTURE = readFileSync("fixtures/donde-ayudo-chunk.js", "utf8");

describe("parseDondeAyudo — fixtures/donde-ayudo-chunk.js", () => {
  it("extracts 86 records, all collection_point", () => {
    const records = parseDondeAyudo(FIXTURE);
    expect(records).toHaveLength(86);
    for (const r of records) expect(r.recordType).toBe("collection_point");
  });

  it("resolves admin2Code, displayAddress and sourceUpdatedAt for all 86", () => {
    const records = parseDondeAyudo(FIXTURE);
    expect(records.filter((r) => r.admin2Code).length).toBe(86);
    expect(records.filter((r) => r.displayAddress).length).toBe(86);
    expect(records.filter((r) => r.sourceUpdatedAt).length).toBe(86);
  });

  it("resolves openingHours for 12 records", () => {
    const records = parseDondeAyudo(FIXTURE);
    expect(records.filter((r) => r.openingHours).length).toBe(12);
  });

  it('resolves "Rozo (Palmira)" to municipality Palmira with locality Rozo', () => {
    const records = parseDondeAyudo(FIXTURE);
    const rozo = records.find((r) => r.locality === "Rozo");
    expect(rozo).toBeDefined();
    expect(rozo?.admin2Name).toBe("Palmira");
  });

  it('resolves "Buga (Guadalajara de Buga)" to 76111', () => {
    const records = parseDondeAyudo(FIXTURE);
    const buga = records.find((r) => r.admin2Name === "Guadalajara de Buga");
    expect(buga).toBeDefined();
    expect(buga?.admin2Code).toBe("76111");
  });

  it("never leaks contactos values or verificadoPor names in any output field", () => {
    // The fixture marks its (already-sanitized) verifier name as "REDACTADO";
    // the parser must never read the contactos/verificadoPor fields at all.
    expect(FIXTURE).toContain('verificadoPor:"REDACTADO"');

    const records = parseDondeAyudo(FIXTURE);
    for (const r of records) {
      const haystack = JSON.stringify(r);
      expect(haystack).not.toContain("REDACTADO");
      expect(haystack).not.toContain("contactos");
      expect(haystack).not.toContain("verificadoPor");
    }
  });

  it("throws ParserError on a chunk without the municipios registry, instead of returning []", () => {
    expect(() => parseDondeAyudo("export default {}")).toThrow(ParserError);
  });
});
