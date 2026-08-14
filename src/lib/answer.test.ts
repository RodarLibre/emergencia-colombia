import { describe, expect, it } from "vitest";

import { composeAnswer } from "./answer";
import type { ResolvedQuery } from "./intent";
import type { BroadenedSearch, SearchResult } from "./search";

/**
 * El vocabulario dejó de poder negar una respuesta.
 *
 * Antes, si la lista de palabras no reconocía la pregunta se descartaba lo que
 * el modelo hubiera entendido y la persona recibía "eso no lo tengo". Eso
 * trataba igual dos cosas distintas: el modelo alucinando sobre algo ajeno, y
 * el modelo entendiendo bien algo que a nadie se le ocurrió agregar a la
 * lista. Ahora se responde, marcándolo como interpretación.
 */

function query(overrides: Partial<ResolvedQuery> = {}): ResolvedQuery {
  return {
    types: ["shelter"],
    admin2Code: null,
    admin2Name: null,
    categories: [],
    q: null,
    outOfScope: false,
    outOfScopeReason: null,
    guessed: false,
    interpretedBy: "model",
    ...overrides,
  };
}

/** Un resultado cualquiera: la frase que se prueba no depende de sus campos. */
function resultado(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    observationId: 1,
    sourceRecordId: 1,
    recordType: "collection_point",
    status: "active",
    title: "Casa cultural",
    description: null,
    categoryCodes: ["medical_assistance", "medical_supplies"],
    admin2Name: "Pereira",
    locality: null,
    displayAddress: null,
    openingHours: null,
    locationPrecision: "unknown",
    verificationLevel: "unknown",
    sourceUpdatedAt: null,
    observedAt: new Date("2026-08-14T00:00:00Z"),
    sourceName: "Mapa de Emergencia",
    sourceSlug: "mapa-emergencia",
    sourceTrustLabel: "community",
    noLongerListed: false,
    lastSeenAt: new Date("2026-08-14T00:00:00Z"),
    contacts: [],
    canonicalUrl: null,
    municipalityUnspecified: false,
    freshness: "fresh",
    ...overrides,
  };
}

const sinResultados: BroadenedSearch = { results: [], dropped: [], companions: [] };

describe("cuando solo el modelo entendió la pregunta", () => {
  it("lo dice", () => {
    const answer = composeAnswer({
      question: "estoy sin casa",
      query: query({ guessed: true }),
      search: sinResultados,
      offTopic: false,
      busy: false,
    });
    expect(answer.notes).toContain("guessed");
  });

  it("no lo dice cuando el vocabulario ya la reconocía", () => {
    const answer = composeAnswer({
      question: "albergues en Cali",
      query: query({ guessed: false }),
      search: sinResultados,
      offTopic: false,
      busy: false,
    });
    expect(answer.notes).not.toContain("guessed");
  });

  it("una pregunta ajena sigue recibiendo el mensaje de fuera de alcance", () => {
    const answer = composeAnswer({
      question: "cuál es la capital de Francia",
      query: query({ types: [], guessed: false }),
      search: sinResultados,
      offTopic: true,
      busy: false,
    });
    expect(answer.notes).toContain("off_topic");
    expect(answer.results).toEqual([]);
  });
});

/**
 * "Nadie publica atención médica y insumos médicos en Pereira" salió a
 * pantalla. El español pide concordancia negativa: después de "nadie publica"
 * la conjunción es "ni". Ninguna prueba miraba esta frase, que es la que ve
 * quien no encontró lo que buscaba — la peor para que suene mal escrita.
 */
describe("cuando no hay resultados", () => {
  it("enlaza las categorías con «ni», no con «y»", () => {
    const answer = composeAnswer({
      question: "medicamentos en pereira",
      query: query({
        categories: ["medical_assistance", "medical_supplies"],
        admin2Name: "Pereira",
      }),
      search: sinResultados,
      offTopic: false,
      busy: false,
    });

    expect(answer.text).toBe("Nadie publica atención médica ni insumos médicos en Pereira.");
  });

  it("no mete conjunción cuando la categoría es una sola", () => {
    const answer = composeAnswer({
      question: "agua en cali",
      query: query({ categories: ["water"], admin2Name: "Cali" }),
      search: sinResultados,
      offTopic: false,
      busy: false,
    });

    expect(answer.text).toBe("Nadie publica agua en Cali.");
  });
});

/**
 * La frase que sí estaba mal en producción: "recibe atención médica y insumos
 * médicos". Delante del sonido i la conjunción es "e".
 */
describe("cuando sí hay resultados", () => {
  it("usa «e» antes de una categoría que empieza por i", () => {
    const answer = composeAnswer({
      question: "medicamentos en pereira",
      query: query({
        types: ["collection_point"],
        categories: ["medical_assistance", "medical_supplies"],
        admin2Name: "Pereira",
      }),
      search: { results: [resultado()], dropped: [], companions: [] },
      offTopic: false,
      busy: false,
    });

    expect(answer.text).toBe(
      "1 punto de acopio recibe atención médica e insumos médicos en Pereira.",
    );
  });
});
