import { describe, expect, it } from "vitest";

import { extractCategories, hasDomainSignal } from "./normalize";

/**
 * El vocabulario que la gente usa de verdad.
 *
 * `hasDomainSignal` decide si una pregunta se busca o se responde con "eso no
 * lo tengo". Un hueco acá no se ve en ningún log: la persona lee el rechazo y
 * se va. Estas frases salieron de cruzar lo que publican las fuentes con las
 * formas en que alguien pediría lo mismo, y nueve de ellas fallaban.
 *
 * El costo de equivocarse no es simétrico. Un falso positivo hace una búsqueda
 * que probablemente no encuentre nada; un falso negativo le niega la respuesta
 * a alguien que sí la necesitaba. Ante la duda, se agrega el término.
 */

const SE_BUSCAN = [
  // La palabra que usan las propias fuentes en sus títulos.
  "recolección de ayudas",
  "recolecta en el barrio",
  "dónde hacen la recolecta",
  // Comida preparada, distinta de un mercado para cocinar.
  "hay comedor comunitario",
  "olla comunitaria",
  "dan desayuno",
  "dónde dan comida caliente",
  // Necesidades de albergue que nadie nombra como "albergue".
  "dónde puedo bañarme",
  "estoy sin casa",
  "mi casa se cayó",
  "perdí todo en el sismo",
  "necesito una carpa para dormir",
  "necesito colchonetas",
  // Salud.
  "jornada de vacunación",
  "brigada de salud",
  "puesto de salud cercano",
  "necesito medicinas",
  // Entregar y ayudar.
  "quiero ser voluntario",
  "cómo puedo ayudar",
  "dónde entrego mi donación",
  "dónde donar sangre",
  "quién recibe cobijas",
  "necesito pañales",
  "necesito guantes",
  "hay agua potable",
  // Segunda tanda: coloquialismos colombianos y grupos de personas.
  "donde dan remesa",
  "reparten anchetas",
  "hay cambuches",
  "necesito un toldo",
  "dónde consigo escobas",
  "hay velas y pilas",
  "necesito linternas",
  "leche de fórmula para bebé",
  "algo para adulto mayor",
  "personas con discapacidad",
  "suspendieron las clases",
  "hay dónde cargar el celular",
];

const NO_SE_BUSCAN = [
  "cuál es la capital de Francia",
  "quién ganó el partido",
  "receta de sancocho",
  "cuánto cuesta un iphone",
  "cómo hago una hoja de vida",
  "el clima de mañana",
  "traducir hola al inglés",
  "dónde queda la notaría",
  "horario del banco",
  "resultados de la lotería",
  // Adversariales: casi activan las palabras nuevas, y no deben.
  "clases de inglés",
  "quiero tomar clases de yoga",
  "una novela de amor",
  "pila de libros",
  "la vela del barco",
  "planta de interior",
  "carga de trabajo",
  "formula matemática",
];

describe("preguntas que tienen que buscarse", () => {
  for (const frase of SE_BUSCAN) {
    it(`entra: "${frase}"`, () => {
      expect(hasDomainSignal(frase)).toBe(true);
    });
  }
});

describe("preguntas ajenas a la emergencia", () => {
  for (const frase of NO_SE_BUSCAN) {
    it(`no entra: "${frase}"`, () => {
      expect(hasDomainSignal(frase)).toBe(false);
    });
  }
});

describe("además producen un filtro útil, no solo pasan", () => {
  it("comida preparada es alimentos", () => {
    expect(extractCategories("hay comedor comunitario")).toContain("food");
    expect(extractCategories("dan desayuno")).toContain("food");
  });

  it("quedarse sin casa es alojamiento", () => {
    expect(extractCategories("estoy sin casa")).toContain("shelter");
    expect(extractCategories("me quedé sin techo")).toContain("shelter");
  });

  it("bañarse es aseo", () => {
    expect(extractCategories("dónde puedo bañarme")).toContain("hygiene");
  });

  it("vacunación es atención médica", () => {
    expect(extractCategories("jornada de vacunación")).toContain("medical_assistance");
  });

  it("una remesa es un mercado", () => {
    expect(extractCategories("donde dan remesa")).toContain("food");
  });

  it("un cambuche es alojamiento", () => {
    expect(extractCategories("hay cambuches")).toContain("shelter");
  });

  it("bebés: la categoría existía sin una sola palabra que la activara", () => {
    expect(extractCategories("leche de fórmula para bebé")).toContain("baby_supplies");
    expect(extractCategories("necesito biberón")).toContain("baby_supplies");
    // Y no se activa con el verbo beber.
    expect(extractCategories("el perro bebe agua")).not.toContain("baby_supplies");
  });
});
