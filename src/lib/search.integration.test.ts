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

/**
 * Una coincidencia de palabra vale más que un parecido.
 *
 * `GREATEST(ts_rank, similarity)` mezclaba dos escalas distintas: ts_rank de una
 * coincidencia real anda por 0.03-0.06, y la similitud por trigramas entre un
 * registro entero y una pregunta corta anda por 0.12-0.15 para todos. El máximo
 * era siempre el trigrama, así que el orden lo decidía el parecido del texto
 * completo y no la relevancia. "dónde necesitan alcohol" dejaba tercero al
 * único registro que pedía alcohol.
 */
describe("orden por relevancia", () => {
  it("la coincidencia de palabra va antes que el rescate por parecido", async () => {
    sourceId = await makeEnabledSource("rank-trigrama");
    const coincide = await makeSourceRecord(sourceId, "coincide");
    const soloParecido = await makeSourceRecord(sourceId, "solo-parecido");

    const comun = {
      recordType: "collection_point" as const,
      status: "active" as const,
      categoryCodes: [],
      admin2Code: "76001",
      admin2Name: "Cali",
      locationPrecision: "unknown" as const,
      verificationLevel: "unknown" as const,
      observedAt: new Date(),
    };

    await db.insert(observations).values([
      {
        // Texto largo, como los reales: la similitud por trigramas contra una
        // pregunta corta le queda baja aunque contenga la palabra exacta.
        ...comun,
        sourceRecordId: coincide,
        title: "Pide alcohol",
        contentHash: "sha256:coincide",
        searchText:
          "punto de acopio del barrio que recibe alcohol y otros insumos para " +
          "la emergencia del sismo, con voluntarios en jornada continua",
      },
      {
        // Corto y con erratas: no coincide ni una palabra, pero se parece
        // muchísimo. Este le ganaba al de arriba.
        ...comun,
        sourceRecordId: soloParecido,
        title: "Otra cosa",
        contentHash: "sha256:parecido",
        searchText: "dnde necesitn alcohl",
      },
    ]);

    const results = await searchRecords({
      q: "donde necesitan alcohol",
      admin2Code: "76001",
      limit: 20,
    });
    const posCoincide = results.findIndex((r) => r.sourceRecordId === coincide);
    const posParecido = results.findIndex((r) => r.sourceRecordId === soloParecido);

    expect(posCoincide).toBeGreaterThanOrEqual(0);
    expect(posParecido).toBeGreaterThanOrEqual(0);
    expect(posCoincide).toBeLessThan(posParecido);
  });
});

/**
 * Un albergue cerrado no puede encabezar la lista.
 *
 * Preguntando por albergues en Cali salían primero los dos que ya no recibían
 * —uno CERRADO y uno ATENDIDO— y después los cinco abiertos. El estado no
 * entraba en el orden: solo relevancia, completitud y fecha. Quien decide dónde
 * dormir esta noche leía "CERRADO" arriba de todo.
 *
 * No se ocultan: siguen en los resultados, al final.
 */
describe("orden por estado", () => {
  it("los abiertos van antes que los cerrados y los ya atendidos", async () => {
    sourceId = await makeEnabledSource("orden-estado");
    const cerrado = await makeSourceRecord(sourceId, "cerrado");
    const atendido = await makeSourceRecord(sourceId, "atendido");
    const abierto = await makeSourceRecord(sourceId, "abierto");

    const comun = {
      recordType: "shelter" as const,
      categoryCodes: [],
      admin2Code: "76001",
      admin2Name: "Cali",
      locationPrecision: "unknown" as const,
      verificationLevel: "unknown" as const,
      searchText: "albergue de prueba",
    };

    await db.insert(observations).values([
      {
        // El cerrado, con TODO a favor: dirección, horario y observado después.
        // Antes ganaba por eso.
        ...comun,
        sourceRecordId: cerrado,
        status: "closed",
        title: "Albergue cerrado",
        displayAddress: "Calle 1 #1-1",
        openingHours: "8am a 6pm",
        observedAt: new Date(),
        contentHash: "sha256:cerrado",
      },
      {
        ...comun,
        sourceRecordId: atendido,
        status: "fulfilled",
        title: "Albergue atendido",
        displayAddress: "Calle 2 #2-2",
        openingHours: "8am a 6pm",
        observedAt: new Date(),
        contentHash: "sha256:atendido",
      },
      {
        // El abierto, con menos datos y más viejo.
        ...comun,
        sourceRecordId: abierto,
        status: "active",
        title: "Albergue abierto",
        observedAt: new Date(Date.now() - 60 * 60_000),
        contentHash: "sha256:abierto",
      },
    ]);

    const results = await searchRecords({ types: ["shelter"], admin2Code: "76001", limit: 20 });
    const pos = (id: number) => results.findIndex((r) => r.sourceRecordId === id);

    expect(pos(abierto)).toBeGreaterThanOrEqual(0);
    expect(pos(abierto)).toBeLessThan(pos(atendido));
    expect(pos(atendido)).toBeLessThan(pos(cerrado));
    // Y ninguno desaparece.
    expect(pos(cerrado)).toBeGreaterThanOrEqual(0);
  });
});
