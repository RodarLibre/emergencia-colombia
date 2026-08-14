import { describe, expect, it } from "vitest";

import { municipioEnCoordenada } from "./geo";

/**
 * Puntos conocidos, verificados contra los límites oficiales del DANE.
 *
 * Un error acá manda a alguien al municipio equivocado, así que se prueban
 * coordenadas reales de lugares reconocibles, no aproximaciones.
 */

const DENTRO: Array<[string, number, number, string]> = [
  ["Plaza de Caicedo, Cali", 3.4516, -76.532, "Cali"],
  ["Parque Bolívar, Palmira", 3.5394, -76.3036, "Palmira"],
  ["Centro de Buga", 3.9006, -76.2978, "Guadalajara de Buga"],
  ["Centro de Tuluá", 4.0847, -76.1954, "Tuluá"],
  ["Centro de Buenaventura", 3.8801, -77.0312, "Buenaventura"],
  ["Centro de Cartago", 4.7469, -75.9116, "Cartago"],
  ["Centro de Jamundí", 3.2606, -76.5389, "Jamundí"],
  ["Centro de Yumbo", 3.5847, -76.4955, "Yumbo"],
  // Eje Cafetero.
  ["Plaza de Bolívar, Pereira", 4.8133, -75.6961, "Pereira"],
  ["Centro de Manizales", 5.0689, -75.5174, "Manizales"],
  ["Centro de Armenia", 4.5339, -75.6811, "Armenia"],
  ["Centro de Dosquebradas", 4.8347, -75.6749, "Dosquebradas"],
];

describe("en qué municipio cae una coordenada", () => {
  for (const [lugar, lat, lng, esperado] of DENTRO) {
    it(`${lugar} → ${esperado}`, () => {
      expect(municipioEnCoordenada(lat, lng)?.name).toBe(esperado);
    });
  }
});

describe("fuera de la cobertura devuelve null, no el más cercano", () => {
  const FUERA: Array<[string, number, number]> = [
    ["Medellín", 6.2442, -75.5812],
    ["Bogotá", 4.711, -74.0721],
    ["Popayán", 2.4448, -76.6147],
    ["océano Pacífico", 3.5, -79.5],
  ];
  for (const [lugar, lat, lng] of FUERA) {
    it(`${lugar} → null`, () => {
      expect(municipioEnCoordenada(lat, lng)).toBeNull();
    });
  }
});

describe("entradas que no son ubicaciones", () => {
  it("0,0 es un campo sin llenar, no el golfo de Guinea", () => {
    expect(municipioEnCoordenada(0, 0)).toBeNull();
  });

  it("descarta valores imposibles", () => {
    expect(municipioEnCoordenada(NaN, -76.5)).toBeNull();
    expect(municipioEnCoordenada(91, 0)).toBeNull();
    expect(municipioEnCoordenada(3.45, -200)).toBeNull();
  });
});
