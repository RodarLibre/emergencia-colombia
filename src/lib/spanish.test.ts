import { describe, expect, it } from "vitest";

import { conjunction, joinInSpanish } from "./spanish";

/**
 * "atención médica y insumos médicos" salió a pantalla. En español la "y" se
 * vuelve "e" delante del sonido i, y la "o" se vuelve "u" delante del sonido o.
 * Es una regla, no una excepción suelta, así que se prueba como regla.
 */

describe("conjunction", () => {
  it("cambia y por e delante del sonido i", () => {
    expect(conjunction("y", "insumos médicos")).toBe("e");
    expect(conjunction("y", "información")).toBe("e");
    expect(conjunction("y", "higiene")).toBe("e");
  });

  it("respeta la tilde: «índice» empieza por sonido i", () => {
    expect(conjunction("y", "índice")).toBe("e");
  });

  it("mantiene y delante de hie-, donde la i no suena sola", () => {
    // "agua y hielo", nunca "agua e hielo".
    expect(conjunction("y", "hielo")).toBe("y");
    expect(conjunction("y", "hierba")).toBe("y");
  });

  it("no toca la y en el resto de los casos", () => {
    expect(conjunction("y", "agua")).toBe("y");
    expect(conjunction("y", "alimentos")).toBe("y");
  });

  it("cambia o por u delante del sonido o, salvo hue-", () => {
    expect(conjunction("o", "otro")).toBe("u");
    expect(conjunction("o", "hospital")).toBe("u");
    expect(conjunction("o", "hueso")).toBe("o");
    expect(conjunction("o", "agua")).toBe("o");
  });
});

describe("joinInSpanish", () => {
  it("no pone conjunción con un solo elemento", () => {
    expect(joinInSpanish(["agua"])).toBe("agua");
    expect(joinInSpanish([])).toBe("");
  });

  it("usa comas y deja la conjunción solo antes del último", () => {
    expect(joinInSpanish(["agua", "ropa", "alimentos"])).toBe("agua, ropa y alimentos");
  });

  it("aplica la eufonía al último elemento, que es el que manda", () => {
    expect(joinInSpanish(["atención médica", "insumos médicos"])).toBe(
      "atención médica e insumos médicos",
    );
    // El primero empieza por i y no cambia nada: solo cuenta el último.
    expect(joinInSpanish(["insumos médicos", "agua"])).toBe("insumos médicos y agua");
  });
});
