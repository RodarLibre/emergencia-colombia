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

/**
 * Mascotas perdidas.
 *
 * Lo importante no es reconocer "perdí mi perro" — eso es fácil. Es no
 * tragarse "busco comida para mi perro", que SÍ podemos responder: hay puntos
 * que reciben insumos para animales. Y es no dejar que "busco a mi perro"
 * caiga en la burbuja de personas desaparecidas, que le mostraría Medicina
 * Legal a alguien que perdió a su gato.
 */
describe("mascotas perdidas", () => {
  const SE_DERIVAN = [
    "perdí mi perro",
    "perdi mi perro en el terremoto",
    "se me perdió el gato",
    "se me perdio la gata en Cali",
    "mi perro se perdió",
    "mi perrita está perdida",
    "el gato no aparece desde el sismo",
    "se escapó mi perro",
    "busco a mi perro",
    "estoy buscando a mi gato",
    "encontré un perro en la calle",
    "me encontré una gata perdida",
    "reportar mascota perdida",
    "perro encontrado en Pereira",
    "dónde reporto un gato extraviado",
  ];

  for (const q of SE_DERIVAN) {
    it(`deriva: "${q}"`, () => {
      expect(detectOutOfScope(q)).toBe("lost_pet");
    });
  }

  const SE_BUSCAN = [
    "busco comida para mi perro",
    "dónde llevo comida para perros",
    "dónde recibo alimento para mascotas",
    "apoyo animal en Pereira",
    "quién recibe comida de gatos",
    "veterinaria para mi gato",
    "necesito arena para gatos",
  ];

  for (const q of SE_BUSCAN) {
    it(`sigue buscando: "${q}"`, () => {
      expect(detectOutOfScope(q)).toBeNull();
    });
  }

  it("una persona manda sobre una mascota", () => {
    // "busco a mi hijo y a mi perro" es una pregunta por el hijo.
    expect(detectOutOfScope("busco a mi hijo y a mi perro")).toBe("person_safety");
  });

  it("no le quita el paso a una emergencia médica", () => {
    expect(detectOutOfScope("mi perro está bajo los escombros y no puedo respirar")).toBe(
      "medical_emergency",
    );
  });
});

/**
 * `\w` es ASCII en JavaScript, igual que `\b`.
 *
 * `encontr\w*` se detenía antes de la "é" de "encontré", así que
 * `encontr\w*\s+a\s+mi` nunca coincidía con "encontré a mi hijo": alguien
 * preguntando por su hijo en pasado caía en una búsqueda normal. Y "busqué"
 * ni siquiera comparte la raíz con "busco" — cambia la c por qu.
 */
describe("pretérito y tildes", () => {
  const EN_PASADO = [
    "encontré a mi hijo",
    "buscó a mi mamá",
    "busqué a mi hermano",
    "ubiqué a mi tía",
    "localicé a mi hermana",
    "perdí a mi abuela",
  ];

  for (const q of EN_PASADO) {
    it(`detecta: "${q}"`, () => {
      expect(detectOutOfScope(q)).toBe("person_safety");
    });
  }

  it("no se lleva por delante una búsqueda normal", () => {
    expect(detectOutOfScope("busqué agua y no encontré")).toBeNull();
  });
});
