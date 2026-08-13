import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ParserError } from "../types";
import { parseReports } from "./cali-ayuda";

const FIXTURE = readFileSync("fixtures/cali-ayuda-reports.html", "utf8");

describe("parseReports — fixtures/cali-ayuda-reports.html", () => {
  it("extracts 8 records, all service_point", () => {
    const records = parseReports(FIXTURE, new Date("2026-08-13T12:00:00Z"));
    expect(records).toHaveLength(8);
    for (const r of records) expect(r.recordType).toBe("service_point");
  });

  it("never leaks a phone number in title or description", () => {
    const records = parseReports(FIXTURE, new Date("2026-08-13T12:00:00Z"));
    const phone = /\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/;
    for (const r of records) {
      expect(r.title).not.toMatch(phone);
      if (r.description) expect(r.description).not.toMatch(phone);
    }
  });

  it("ingests only 'Punto de ayuda', excluding 'Necesidad' and 'Oferta'", () => {
    // The page has all three report kinds; only points make it into the 8.
    expect(FIXTURE).toContain("Necesidad");
    const records = parseReports(FIXTURE, new Date("2026-08-13T12:00:00Z"));
    expect(records).toHaveLength(8);
  });

  it("throws ParserError on an empty page instead of returning []", () => {
    expect(() => parseReports("<html><body>nada</body></html>")).toThrow(ParserError);
  });

  it("throws ParserError on a restructured page instead of returning []", () => {
    const restructured = FIXTURE.replace(/"href\\?":\\?"\/reports\//g, '"href":"/informes/');
    expect(() => parseReports(restructured)).toThrow(ParserError);
  });
});
