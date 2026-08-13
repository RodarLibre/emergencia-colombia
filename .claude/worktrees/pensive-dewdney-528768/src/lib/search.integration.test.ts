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
