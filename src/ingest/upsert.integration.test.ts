import { readFileSync } from "node:fs";

import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { observations, sourceRecords } from "@/db/schema";
import { buildParsedRecord, deleteTestSource, testSlug, testSourceConfig } from "@/test-support/db";

import { parseDondeAyudo } from "./adapters/donde-ayudo";
import { assertNoCountCollapse, ensureSource, QuarantineError, upsertRecords } from "./upsert";

let sourceId: number | null = null;

afterEach(async () => {
  if (sourceId !== null) await deleteTestSource(sourceId);
  sourceId = null;
});

describe("upsertRecords — idempotency", () => {
  it("running the same records twice creates no second observation", async () => {
    sourceId = await ensureSource(testSourceConfig(testSlug("idempotency")));
    const records = [buildParsedRecord(), buildParsedRecord(), buildParsedRecord()];

    const first = await upsertRecords(sourceId, records, "community_unverified");
    expect(first.created).toBe(3);
    expect(first.unchanged).toBe(0);

    const second = await upsertRecords(sourceId, records, "community_unverified");
    expect(second.created).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(3);

    const rows = await db.query.sourceRecords.findMany({
      where: eq(sourceRecords.sourceId, sourceId),
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const obs = await db.query.observations.findMany({
        where: eq(observations.sourceRecordId, row.id),
      });
      expect(obs).toHaveLength(1);
    }
  });
});

describe("upsertRecords — no deletion on absence", () => {
  it("a record missing from a run is not deleted or hidden", async () => {
    sourceId = await ensureSource(testSourceConfig(testSlug("no-delete")));
    const a = buildParsedRecord({ externalId: "a" });
    const b = buildParsedRecord({ externalId: "b" });
    const c = buildParsedRecord({ externalId: "c" });

    await upsertRecords(sourceId, [a, b, c], "community_unverified");
    // Simulate a re-run where the source only lists a and b — c fell off the
    // listing (e.g. a flaky page), which must not touch it.
    await upsertRecords(sourceId, [a, b], "community_unverified");

    const rows = await db.query.sourceRecords.findMany({
      where: eq(sourceRecords.sourceId, sourceId),
    });
    expect(rows).toHaveLength(3);

    const missing = rows.find((r) => r.externalId === "c");
    expect(missing).toBeDefined();
    expect(missing?.withdrawnAt).toBeNull();
    expect(missing?.hiddenAt).toBeNull();
  });

  it("only an explicit withdrawnAt removes a record from the catalog", async () => {
    sourceId = await ensureSource(testSourceConfig(testSlug("withdraw")));
    const a = buildParsedRecord({ externalId: "a" });
    await upsertRecords(sourceId, [a], "community_unverified");

    const [row] = await db.query.sourceRecords.findMany({
      where: and(eq(sourceRecords.sourceId, sourceId), eq(sourceRecords.externalId, "a")),
    });
    expect(row).toBeDefined();

    await db
      .update(sourceRecords)
      .set({ withdrawnAt: new Date() })
      .where(eq(sourceRecords.id, row!.id));

    const [withdrawn] = await db.query.sourceRecords.findMany({
      where: eq(sourceRecords.id, row!.id),
    });
    expect(withdrawn?.withdrawnAt).not.toBeNull();
  });
});

describe("assertNoCountCollapse — quarantine", () => {
  it("throws QuarantineError when the new count drops more than 40% from 86, and writes nothing", async () => {
    sourceId = await ensureSource(testSourceConfig(testSlug("quarantine")));
    const fixture = readFileSync("fixtures/donde-ayudo-chunk.js", "utf8");
    const all86 = parseDondeAyudo(fixture);
    expect(all86).toHaveLength(86);

    await upsertRecords(sourceId, all86, "source_verified");
    const before = await db.query.sourceRecords.findMany({
      where: eq(sourceRecords.sourceId, sourceId),
    });
    expect(before).toHaveLength(86);

    // Truncating the fixture to a third reproduces the original bug report.
    const aThird = all86.slice(0, 29);
    await expect(assertNoCountCollapse(sourceId, aThird.length)).rejects.toThrow(QuarantineError);

    // assertNoCountCollapse runs before any write in the real ingest flow —
    // nothing changed because we never called upsertRecords with aThird.
    const after = await db.query.sourceRecords.findMany({
      where: eq(sourceRecords.sourceId, sourceId),
    });
    expect(after).toHaveLength(86);
  });

  it("does not throw on a first run, with nothing to compare against", async () => {
    sourceId = await ensureSource(testSourceConfig(testSlug("first-run")));
    await expect(assertNoCountCollapse(sourceId, 1)).resolves.toBeUndefined();
  });

  it("does not throw when the drop is within tolerance", async () => {
    sourceId = await ensureSource(testSourceConfig(testSlug("tolerance")));
    const ten = Array.from({ length: 10 }, (_, i) => buildParsedRecord({ externalId: `r${i}` }));
    await upsertRecords(sourceId, ten, "community_unverified");

    // 40% tolerance: dropping from 10 to 7 is a 30% drop, allowed.
    await expect(assertNoCountCollapse(sourceId, 7)).resolves.toBeUndefined();
  });
});

/**
 * El guardia compara lectura contra lectura, no contra el acumulado.
 *
 * Con el acumulado, una fuente que publica una ventana —Mapa de Emergencia
 * lista lo confirmado en las ultimas seis horas— entrega 20 contra 919 y eso
 * se lee como un derrumbe del 98%. Quedo en cuarentena cuatro dias con la
 * fuente sana.
 */
describe("assertNoCountCollapse", () => {
  it("no se asusta por el catalogo acumulado si la ultima lectura fue chica", async () => {
    const sourceId = await ensureSource({ ...testSourceConfig(testSlug("ventana-guardia")) });
    try {
      const ahora = new Date();
      const viejo = new Date(Date.now() - 48 * 3600_000);

      // 30 registros acumulados de lecturas viejas, 5 en la ultima.
      for (let i = 0; i < 30; i++) {
        await db.insert(sourceRecords).values({
          sourceId,
          externalId: `viejo-${i}`,
          canonicalUrl: "https://example.invalid",
          lastSeenAt: viejo,
        });
      }
      for (let i = 0; i < 5; i++) {
        await db.insert(sourceRecords).values({
          sourceId,
          externalId: `nuevo-${i}`,
          canonicalUrl: "https://example.invalid",
          lastSeenAt: ahora,
        });
      }

      // Cuatro contra los cinco de la ultima lectura: baja, pero dentro de
      // tolerancia. Contra los 35 acumulados habria sido un 89% de caida.
      await expect(assertNoCountCollapse(sourceId, 4)).resolves.toBeUndefined();
      // Y un derrumbe real frente a la ultima lectura si se detiene.
      await expect(assertNoCountCollapse(sourceId, 1)).rejects.toThrow(
        /cuarentena|caida|La fuente/,
      );
    } finally {
      await deleteTestSource(sourceId);
    }
  });
});
