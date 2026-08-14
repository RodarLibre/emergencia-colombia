import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { observations, sourceRecords, sources } from "@/db/schema";
import { deleteTestSource, testSlug, testSourceConfig } from "@/test-support/db";

import { searchRecords } from "./search";

let sourceId: number | null = null;

afterEach(async () => {
  if (sourceId !== null) await deleteTestSource(sourceId);
  sourceId = null;
});

async function makeEnabledSource(label: string): Promise<number> {
  const [inserted] = await db
    .insert(sources)
    .values({ ...testSourceConfig(testSlug(label)), enabled: true })
    .returning();
  return inserted!.id;
}

async function makeSourceRecord(ownerSourceId: number, externalId: string): Promise<number> {
  const [inserted] = await db
    .insert(sourceRecords)
    .values({ sourceId: ownerSourceId, externalId, canonicalUrl: "https://example.invalid" })
    .returning();
  return inserted!.id;
}

describe("searchRecords — latest-observation semantics", () => {
  it("excludes a record whose latest observation withdrew it, even though an older one was active", async () => {
    sourceId = await makeEnabledSource("latest-withdrawn");
    const recordId = await makeSourceRecord(sourceId, "r1");

    await db.insert(observations).values([
      {
        sourceRecordId: recordId,
        recordType: "collection_point",
        status: "active",
        title: "Punto de prueba latest",
        categoryCodes: ["water"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locationPrecision: "unknown",
        verificationLevel: "unknown",
        observedAt: new Date(Date.now() - 10 * 60_000),
        contentHash: "sha256:old",
        searchText: "punto de prueba latest",
      },
      {
        sourceRecordId: recordId,
        recordType: "collection_point",
        status: "withdrawn",
        title: "Punto de prueba latest",
        categoryCodes: ["water"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locationPrecision: "unknown",
        verificationLevel: "unknown",
        observedAt: new Date(),
        contentHash: "sha256:new",
        searchText: "punto de prueba latest",
      },
    ]);

    const results = await searchRecords({ admin2Code: "76001" });
    expect(results.some((r) => r.sourceRecordId === recordId)).toBe(false);
  });

  it("filters by the latest observation's categories, not an older observation's", async () => {
    sourceId = await makeEnabledSource("latest-category");
    const recordId = await makeSourceRecord(sourceId, "r1");

    await db.insert(observations).values([
      {
        sourceRecordId: recordId,
        recordType: "collection_point",
        status: "active",
        title: "Punto de prueba categoria",
        categoryCodes: ["water"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locationPrecision: "unknown",
        verificationLevel: "unknown",
        observedAt: new Date(Date.now() - 10 * 60_000),
        contentHash: "sha256:old-cat",
        searchText: "punto de prueba categoria",
      },
      {
        sourceRecordId: recordId,
        recordType: "collection_point",
        status: "active",
        title: "Punto de prueba categoria",
        categoryCodes: ["food"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locationPrecision: "unknown",
        verificationLevel: "unknown",
        observedAt: new Date(),
        contentHash: "sha256:new-cat",
        searchText: "punto de prueba categoria",
      },
    ]);

    // The old observation said "water"; the current one says "food". Filtering
    // by "water" must not resurrect it through the stale observation.
    const stale = await searchRecords({ admin2Code: "76001", categories: ["water"] });
    expect(stale.some((r) => r.sourceRecordId === recordId)).toBe(false);

    const current = await searchRecords({ admin2Code: "76001", categories: ["food"] });
    const match = current.find((r) => r.sourceRecordId === recordId);
    expect(match).toBeDefined();
    expect(match?.status).toBe("active");
  });

  it("returns the record's most recent status, not an older one", async () => {
    sourceId = await makeEnabledSource("latest-status");
    const recordId = await makeSourceRecord(sourceId, "r1");

    await db.insert(observations).values([
      {
        sourceRecordId: recordId,
        recordType: "shelter",
        status: "active",
        title: "Albergue de prueba",
        categoryCodes: [],
        admin2Code: "76001",
        admin2Name: "Cali",
        locationPrecision: "unknown",
        verificationLevel: "unknown",
        observedAt: new Date(Date.now() - 10 * 60_000),
        contentHash: "sha256:old-status",
        searchText: "albergue de prueba",
      },
      {
        sourceRecordId: recordId,
        recordType: "shelter",
        status: "closed",
        title: "Albergue de prueba",
        categoryCodes: [],
        admin2Code: "76001",
        admin2Name: "Cali",
        locationPrecision: "unknown",
        verificationLevel: "unknown",
        observedAt: new Date(),
        contentHash: "sha256:new-status",
        searchText: "albergue de prueba",
      },
    ]);

    const results = await searchRecords({ admin2Code: "76001", types: ["shelter"] });
    const match = results.find((r) => r.sourceRecordId === recordId);
    expect(match).toBeDefined();
    expect(match?.status).toBe("closed");
  });
});

describe("records the source stopped publishing", () => {
  it("marks a record whose last_seen_at fell behind its source's last read", async () => {
    // Cali Ayuda went from 8 records to 7 in production: someone removed a
    // collection point from their listing. Invariant 3 keeps the record, but
    // showing it as if nothing happened hides the most useful thing about it.
    const [row] = (await db.execute(sql`
      SELECT DISTINCT ON (sr.id) sr.id, sr.last_seen_at, o.admin2_code
      FROM source_records sr
      JOIN sources s ON s.id = sr.source_id
      JOIN observations o ON o.source_record_id = sr.id
      WHERE s.enabled AND sr.withdrawn_at IS NULL AND sr.hidden_at IS NULL
        AND o.admin2_code IS NOT NULL
        -- La fuente necesita más de un registro para que "quedarse atrás"
        -- signifique algo.
        AND (SELECT COUNT(*) FROM source_records x WHERE x.source_id = sr.source_id) > 1
      ORDER BY sr.id, o.observed_at DESC
      LIMIT 1
    `)) as unknown as { id: number; last_seen_at: string; admin2_code: string }[];
    if (!row) return;

    const original = row.last_seen_at;
    // Tres horas por detrás de sus hermanos de la misma fuente: eso es
    // exactamente "la fuente se leyó bien y este no estaba".
    await db.execute(sql`
      UPDATE source_records sr
      SET last_seen_at = (
        SELECT MAX(sr2.last_seen_at) FROM source_records sr2
        WHERE sr2.source_id = sr.source_id AND sr2.id <> sr.id
      ) - interval '3 hours'
      WHERE sr.id = ${row.id}
    `);

    try {
      // Sin filtros la búsqueda devuelve vacío a propósito; se filtra por su
      // propio municipio para que el registro entre en el resultado.
      const results = await searchRecords({ admin2Code: row.admin2_code, limit: 100 });
      const mine = results.find((r) => r.sourceRecordId === row.id);
      // It is still listed among the results — absence is not a withdrawal.
      expect(mine?.noLongerListed).toBe(true);

      const others = results.filter((r) => r.sourceRecordId !== row.id);
      expect(others.every((r) => r.noLongerListed === false)).toBe(true);
    } finally {
      await db.execute(sql`
        UPDATE source_records SET last_seen_at = ${original} WHERE id = ${row.id}
      `);
    }
  });
});
