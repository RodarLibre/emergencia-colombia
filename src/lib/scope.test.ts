import { describe, expect, it } from "vitest";

import { detectOutOfScope } from "./scope";

/**
 * Out-of-scope routing, over the phrasings people actually type.
 *
 * The regression that motivated this file: "donde puedo saber si mi familiar
 * esta herido" was searched like any other question, matched nothing, was
 * widened until no filter was left, and answered a person asking about an
 * injured relative with a notice about schools being suspended.
 *
 * Written the way questions arrive — no accents, conjugated, WhatsApp
 * register — because that is what a phone produces at 2 a.m. The second block
 * matters more than the first: over-blocking denies help to someone who only
 * wanted to know where to take water, and no test suite will ever be
 * exhaustive here. Real questions will keep finding the gaps.
 */

const MUST_ROUTE_TO_PERSON_SAFETY = [
  "alguien sabe de mi hermano",
  "como puedo saber si mi hijo esta en un hospital",
  "mi esposo salio y no ha vuelto",
  "no he podido comunicarme con mi mama",
  "mi papa vive en buga y no responde",
  "donde reportan los heridos",
  "donde publican la lista de victimas",
  "hay algun registro de desaparecidos",
  "como busco a una persona desaparecida",
  "mi hermana estaba en el centro, como se si esta bien",
  "quiero saber si mi tio sobrevivio",
  "a que hospital llevaron a mi hermano",
  "se sabe algo de los desaparecidos",
  "mi novio no da señales de vida",
  "necesito encontrar a mi familia",
  "como ubico a mi abuelo",
  "mi hijo no llego a la casa",
  "estan dando informacion de los fallecidos",
  "cuantos muertos hay",
  "cuantas victimas van",
  "mi mamá está bien?",
  "donde puedo saber si mi familiar esta herido",
  "nadie sabe nada de mi primo",
  "mi tia sigue sin aparecer",
  "mi hermano esta desaparecido",
  "como hago para reportar un desaparecido",
  "donde estan los heridos de palmira",
  "mi papá no aparece",
  "perdi a mi hija en la evacuacion",
  "alguien ha visto a mi esposo",
];

const MUST_STAY_SEARCHABLE = [
  "donde puedo llevar agua en palmira",
  "donde consigo agua para mi hijo",
  "necesito panales para mi bebe",
  "mi familia necesita mercado donde piden",
  "albergues en cali",
  "donde puedo encontrar comida",
  "quien recibe insumos medicos",
  "hubo replicas anoche",
  "puntos de acopio cerca de mi casa",
  "donde puedo dejar ropa para los damnificados",
  "necesito ayuda para mi mama que esta sola",
  "mi abuela necesita medicamentos donde consigo",
  "donde hay atencion medica en buga",
  "hay albergue para mi familia",
  "donde puedo buscar ayuda",
  "como puedo ayudar a los heridos",
  "donde donar sangre para los heridos",
  "quiero ser voluntario",
  "donde recogen donaciones",
  "necesito un lugar donde dormir con mi hijo",
  "mi esposa y yo necesitamos carpa",
  "donde entrego mercados en tulua",
  "hay agua potable en yumbo",
  "que dice la alcaldia de cali",
  "donde puedo bañarme",
  "necesito pañales y leche para mi bebe",
  "mi hermano y yo queremos donar ropa",
  "hay ruta de transporte a jamundi",
];

describe("questions about a person", () => {
  for (const question of MUST_ROUTE_TO_PERSON_SAFETY) {
    it(`routes: "${question}"`, () => {
      expect(detectOutOfScope(question)).toBe("person_safety");
    });
  }
});

describe("questions that must keep working", () => {
  for (const question of MUST_STAY_SEARCHABLE) {
    it(`searches: "${question}"`, () => {
      expect(detectOutOfScope(question)).toBeNull();
    });
  }
});

describe("other refusals keep their own routing", () => {
  it("a medical emergency outranks everything else", () => {
    expect(detectOutOfScope("necesito una ambulancia urgente")).toBe("medical_emergency");
    expect(detectOutOfScope("no puedo respirar")).toBe("medical_emergency");
    expect(detectOutOfScope("mi hermano esta sangrando mucho")).toBe("medical_emergency");
  });

  it("structural questions route to inspection", () => {
    expect(detectOutOfScope("es seguro volver a mi casa")).toBe("structure");
    expect(detectOutOfScope("mi casa quedo agrietada se va a caer")).toBe("structure");
  });

  it("donating blood is not a medical emergency", () => {
    expect(detectOutOfScope("donde donar sangre para los heridos")).toBeNull();
    expect(detectOutOfScope("quiero donar sangre")).toBeNull();
  });
});
