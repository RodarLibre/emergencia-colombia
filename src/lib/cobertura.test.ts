import { describe, expect, it } from "vitest";

import { findMunicipalityInText, findMunicipalityOutsideCoverage } from "./normalize";

/**
 * Cuando la pregunta nombra un municipio que no cubrimos.
 *
 * "Albergues en Pereira" devolvia ocho albergues, el primero en Trujillo,
 * Valle. El indice de texto solo tiene los 42 municipios del area cubierta,
 * asi que la palabra Pereira se perdia y la respuesta salia como si nadie
 * hubiera nombrado un lugar. Responder sobre otro departamento en silencio es
 * peor que no responder.
 */

describe("municipios fuera del area cubierta", () => {
  const FUERA: Array<[string, string, string]> = [
    ["albergues en Pereira", "Pereira", "Risaralda"],
    ["dónde llevo agua en Manizales", "Manizales", "Caldas"],
    // El dato del DANE trae "Quindio" sin tilde; se cita tal cual viene.
    ["puntos de acopio en Armenia", "Armenia", "Quindio"],
    ["albergues en Medellín", "Medellín", "Antioquia"],
    ["ayuda en Chinchiná", "Chinchiná", "Caldas"],
  ];

  for (const [pregunta, nombre, depto] of FUERA) {
    it(`"${pregunta}" → ${nombre}, ${depto}`, () => {
      const m = findMunicipalityOutsideCoverage(pregunta);
      expect(m?.name).toBe(nombre);
      expect(m?.deptName).toBe(depto);
    });
  }
});

describe("no se activa cuando el municipio sí está cubierto", () => {
  for (const pregunta of [
    "albergues en Cali",
    "agua en Palmira",
    "acopio en Buga",
    "puntos en Tuluá",
    // Norte del Valle: adentro, aunque suenen lejanos.
    "albergues en Cartago",
    "ayuda en Roldanillo",
    "acopio en Zarzal",
    "albergues en Sevilla",
  ]) {
    it(`"${pregunta}"`, () => {
      expect(findMunicipalityInText(pregunta)).not.toBeNull();
      expect(findMunicipalityOutsideCoverage(pregunta)).toBeNull();
    });
  }
});

describe("no inventa lugares", () => {
  it("una pregunta sin municipio no activa nada", () => {
    expect(findMunicipalityOutsideCoverage("dónde puedo llevar agua")).toBeNull();
    expect(findMunicipalityOutsideCoverage("quiero ser voluntario")).toBeNull();
  });

  it("exige preposición: un nombre suelto no basta", () => {
    // "La Victoria" y "Argelia" son municipios y tambien palabras corrientes.
    expect(findMunicipalityOutsideCoverage("la victoria fue grande")).toBeNull();
  });
});
