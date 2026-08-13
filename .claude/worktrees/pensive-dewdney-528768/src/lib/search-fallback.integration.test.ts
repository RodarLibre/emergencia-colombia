import { sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { db } from "@/db";

import { searchWithFallback } from "./search";

/**
 * Widening exists because zero results is the worst outcome this site can
 * produce. Every case below returned nothing before it was added.
 */

let municipality: string;
let recordType: string;

beforeAll(async () => {
  const rows = (await db.execute(sql`
    SELECT o.admin2_code, o.record_type
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    JOIN sources s ON s.id = sr.source_id
    WHERE s.enabled AND o.admin2_code IS NOT NULL
    LIMIT 1
  `)) as unknown as { admin2_code: string; record_type: string }[];
  municipality = rows[0]!.admin2_code;
  recordType = rows[0]!.record_type;
});

describe("searchWithFallback", () => {
  it("reports nothing dropped when the exact filters already match", async () => {
    const { results, dropped } = await searchWithFallback({ admin2Code: municipality });
    expect(results.length).toBeGreaterThan(0);
    expect(dropped).toEqual([]);
  });

  it("drops an impossible category before giving up", async () => {
    // "donde recibo panales" inferred `hygiene`; the diapers are at collection
    // points that carry other categories.
    const { results, dropped } = await searchWithFallback({
      admin2Code: municipality,
      categories: ["animal_support", "power"],
    });
    expect(results.length).toBeGreaterThan(0);
    expect(dropped).toEqual(["categories"]);
  });

  it("drops the record type only after categories, and reports both", async () => {
    const otherType = recordType === "shelter" ? "hazard" : "shelter";
    const { results, dropped } = await searchWithFallback({
      admin2Code: municipality,
      categories: ["animal_support"],
      types: [otherType],
    });
    expect(results.length).toBeGreaterThan(0);
    expect(dropped).toEqual(["categories", "types"]);
  });

  it("never drops the municipality", async () => {
    // Someone in Palmira does not want results from Cartago. An empty result
    // is correct here, and widening must not manufacture one.
    const { results } = await searchWithFallback({
      admin2Code: "91001", // Leticia, Amazonas — no records
      categories: ["animal_support"],
      types: ["shelter"],
    });
    expect(results).toEqual([]);
  });
});
