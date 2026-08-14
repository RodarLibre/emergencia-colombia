import { describe, expect, it } from "vitest";

import vocabulario from "./data/vocabulario.json";
import { fold } from "./normalize";
import { CATEGORIES } from "./vocab";

/**
 * Reglas del archivo de vocabulario.
 *
 * `data/vocabulario.json` está pensado para que lo edite gente que conoce cómo
 * se habla en su municipio, no necesariamente quien programa. Estas reglas
 * existen para que un aporte bienintencionado no falle en silencio: una
 * palabra con tilde, o una categoría mal escrita, no rompe nada — simplemente
 * no coincide nunca, y nadie se entera.
 */

const TODAS = [
  ...vocabulario.terminosDeDominio.map((t) => ["terminosDeDominio", t] as const),
  ...Object.entries(vocabulario.palabrasPorCategoria).flatMap(([c, palabras]) =>
    palabras.map((p) => [`palabrasPorCategoria.${c}`, p] as const),
  ),
];

describe("archivo de vocabulario", () => {
  it("ninguna palabra lleva tildes ni mayúsculas", () => {
    // La comparación se hace contra texto ya normalizado con `fold`, así que
    // "bañarse" con ñ jamás coincidiría con nada. Es el error más fácil de
    // cometer y el más difícil de notar.
    const malas = TODAS.filter(([, palabra]) => fold(palabra) !== palabra);
    expect(malas.map(([donde, p]) => `${donde}: "${p}" → "${fold(p)}"`)).toEqual([]);
  });

  it("las categorías existen en el vocabulario controlado", () => {
    const validas = new Set<string>(CATEGORIES);
    const desconocidas = Object.keys(vocabulario.palabrasPorCategoria).filter(
      (c) => !validas.has(c),
    );
    expect(desconocidas).toEqual([]);
  });

  it("no hay palabras repetidas dentro de una misma lista", () => {
    for (const [nombre, lista] of [
      ["terminosDeDominio", vocabulario.terminosDeDominio] as const,
      ...Object.entries(vocabulario.palabrasPorCategoria),
    ]) {
      const repetidas = lista.filter((p, i) => lista.indexOf(p) !== i);
      expect({ [nombre]: repetidas }).toEqual({ [nombre]: [] });
    }
  });

  it("ninguna palabra es tan corta que coincida con cualquier cosa", () => {
    // Con tres letras, "gas" ya aparece dentro de "gastar" o "pagas".
    const cortas = TODAS.filter(([, p]) => p.trim().length < 4);
    expect(cortas.map(([donde, p]) => `${donde}: "${p}"`)).toEqual([]);
  });

  it("ninguna palabra contiene a otra de su misma lista", () => {
    // Si "acopio" y "acopios" están las dos, la segunda no aporta nada y
    // sugiere que quien la agregó esperaba coincidencia exacta, que no es
    // como funciona.
    const redundantes: string[] = [];
    for (const [nombre, lista] of [
      ["terminosDeDominio", vocabulario.terminosDeDominio] as const,
      ...Object.entries(vocabulario.palabrasPorCategoria),
    ]) {
      for (const a of lista) {
        for (const b of lista) {
          if (a !== b && b.includes(a)) redundantes.push(`${nombre}: "${b}" ya lo cubre "${a}"`);
        }
      }
    }
    expect(redundantes).toEqual([]);
  });
});
