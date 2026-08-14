import { describe, expect, it } from "vitest";

import { composeAnswer } from "./answer";
import type { ResolvedQuery } from "./intent";
import type { BroadenedSearch } from "./search";

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
