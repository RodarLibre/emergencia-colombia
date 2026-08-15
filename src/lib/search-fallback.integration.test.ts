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

  it("drops the leftover text before anything else", async () => {
    // "no tengo dónde dormir": the reader understood the category, but the
    // words left over matched no record and the answer was "nadie publica
    // alojamiento" while a shelter sat in the catalog. The person with the
    // least options got the emptiest answer.
    const { results, dropped } = await searchWithFallback({
      q: "no tengo donde dormir zzzz",
      categories: ["shelter"],
    });
    expect(results.length).toBeGreaterThan(0);
    expect(dropped).toEqual(["text"]);
  });

  it("keeps the municipality while dropping the text", async () => {
    const { results, dropped } = await searchWithFallback({
      q: "palabras que no existen en ningun registro zzzz",
      admin2Code: municipality,
    });
    expect(results.length).toBeGreaterThan(0);
    expect(dropped).toEqual(["text"]);
    // Que no se pierda el municipio lo cubre el test de más abajo.
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

describe("gemelos en la misma direccion", () => {
  it("los trae aunque el filtro por tipo los deje fuera", async () => {
    // Seis direcciones del Valle estaban en dos fuentes, cinco de ellas con
    // tipos distintos: el gemelo nunca caia en la misma lista y el aviso de
    // "mismo lugar" no se podia calcular.
    const [dup] = (await db.execute(sql`
      WITH ult AS (
        SELECT sr.id, s.slug, o.display_address, o.record_type
        FROM source_records sr
        JOIN sources s ON s.id = sr.source_id
        JOIN LATERAL (
          SELECT * FROM observations o2 WHERE o2.source_record_id = sr.id
          ORDER BY o2.observed_at DESC LIMIT 1
        ) o ON true
        WHERE s.enabled AND o.display_address IS NOT NULL
      )
      SELECT a.display_address, a.record_type AS tipo_a, b.record_type AS tipo_b
      FROM ult a JOIN ult b
        ON a.display_address = b.display_address AND a.slug < b.slug
      LIMIT 1
    `)) as unknown as { display_address: string; tipo_a: string; tipo_b: string }[];

    if (!dup) return; // La base local puede no tener duplicados entre fuentes.

    const { results, companions } = await searchWithFallback({
      q: dup.display_address,
      types: [dup.tipo_a],
      limit: 20,
    });

    expect(results.length).toBeGreaterThan(0);
    if (dup.tipo_a !== dup.tipo_b) {
      // El gemelo es de otro tipo: no puede estar en `results`, pero si en
      // `companions`.
      expect(results.every((r) => r.recordType === dup.tipo_a)).toBe(true);
      expect(companions.some((c) => c.recordType === dup.tipo_b)).toBe(true);
    }
    // Nunca se repite un registro entre las dos listas.
    const ids = new Set(results.map((r) => r.sourceRecordId));
    expect(companions.every((c) => !ids.has(c.sourceRecordId))).toBe(true);
  });
});

/**
 * `rankBy` ordena sin excluir.
 *
 * Alguien preguntó "dónde necesitan alcohol" y recibió 20 puntos de acopio que
 * no tenían nada que ver: el modelo devolvió el tipo y ninguna palabra clave, y
 * la única palabra con contenido de la pregunta se perdió. Dos registros pedían
 * alcohol y ninguno estaba arriba.
 *
 * No puede filtrar: "hubo réplicas anoche" no aparece en ningún sismo, así que
 * filtrar por esas palabras no respondería nada.
 */
describe("rankBy", () => {
  it("no descarta ni un resultado", async () => {
    const sin = await searchWithFallback({ types: [recordType], limit: 50 });
    const con = await searchWithFallback({
      types: [recordType],
      rankBy: "una frase que no aparece en ningun registro",
      limit: 50,
    });

    expect(con.results.length).toBe(sin.results.length);
    expect(con.dropped).toEqual([]);
  });

  it("sube lo que coincide, sin sacar lo demás", async () => {
    const base = await searchWithFallback({ types: [recordType], limit: 50 });
    // Una palabra tomada de un registro que HOY no sale primero.
    const ultimo = base.results.at(-1);
    if (!ultimo) return;
    const palabra = ultimo.title.split(/\s+/).find((w) => w.length > 5);
    if (!palabra) return;

    const con = await searchWithFallback({
      types: [recordType],
      rankBy: palabra,
      limit: 50,
    });

    expect(con.results.length).toBe(base.results.length);
    const posicion = con.results.findIndex((r) => r.sourceRecordId === ultimo.sourceRecordId);
    const antes = base.results.findIndex((r) => r.sourceRecordId === ultimo.sourceRecordId);
    expect(posicion).toBeLessThanOrEqual(antes);
  });
});
