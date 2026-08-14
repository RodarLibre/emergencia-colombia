import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it } from "vitest";

import { parseFeed } from "./mapa-emergencia";

const FIXTURE = readFileSync("fixtures/mapa-emergencia-publico.json", "utf8");

afterEach(() => {
  delete process.env.MAPA_EMERGENCIA_INCLUIR_RESCATE;
});

describe("alcance", () => {
  it("deja fuera rescate y otro mientras la bandera esté apagada", () => {
    const { puntos } = JSON.parse(FIXTURE) as { puntos: Array<{ id: string; tipo: string }> };
    const excluidos = new Set(
      puntos.filter((p) => p.tipo === "rescate" || p.tipo === "otro").map((p) => p.id),
    );
    expect(excluidos.size).toBeGreaterThan(0);

    const ids = new Set(parseFeed(FIXTURE).map((r) => r.externalId));
    for (const id of excluidos) expect(ids.has(id)).toBe(false);
  });

  it("los incluye con la bandera encendida", () => {
    const sin = parseFeed(FIXTURE).length;
    process.env.MAPA_EMERGENCIA_INCLUIR_RESCATE = "on";
    expect(parseFeed(FIXTURE).length).toBeGreaterThan(sin);
  });
});

describe("lo que acordamos con la fuente", () => {
  it("todo registro trae la hora de confirmación", () => {
    // Jorge pidió mostrarla siempre; un registro sin ella no puede entrar.
    for (const r of parseFeed(FIXTURE)) {
      expect(r.sourceUpdatedAt).toBeInstanceOf(Date);
      expect(Number.isNaN(r.sourceUpdatedAt!.getTime())).toBe(false);
    }
  });

  it("enlaza a la ficha de la fuente", () => {
    for (const r of parseFeed(FIXTURE)) {
      expect(r.recordUrl).toContain("mapa-emergencia.artefactofilms.workers.dev");
    }
  });

  it("no copia teléfonos, aunque vengan escritos en el texto libre", () => {
    const conTelefono = JSON.stringify({
      puntos: [
        {
          id: "prueba1",
          tipo: "acopio",
          estado: "necesita",
          nombre: "Acopio Palmira, llamar al 3153591165",
          direccion: "Calle 27 #35-00",
          lat: 3.5394,
          lng: -76.3036,
          necesidades: ["Agua"],
          confirmado: 1786724800941,
        },
      ],
    });
    const [r] = parseFeed(conTelefono);
    expect(JSON.stringify(r)).not.toContain("3153591165");
  });
});

describe("municipio calculado desde las coordenadas", () => {
  it("ubica un punto de Palmira", () => {
    const feed = JSON.stringify({
      puntos: [
        {
          id: "prueba2",
          tipo: "acopio",
          estado: "necesita",
          nombre: "Punto de prueba",
          direccion: "Calle 27",
          lat: 3.5394,
          lng: -76.3036,
          necesidades: ["Agua", "Comida"],
          confirmado: 1786724800941,
        },
      ],
    });
    const [r] = parseFeed(feed);
    expect(r!.admin2Name).toBe("Palmira");
    expect(r!.admin2Code).toBe("76520");
    expect(r!.categoryCodes).toEqual(expect.arrayContaining(["water", "food"]));
  });

  it("un punto fuera del Valle queda sin municipio, no con el más cercano", () => {
    const feed = JSON.stringify({
      puntos: [
        {
          id: "prueba3",
          tipo: "acopio",
          estado: "necesita",
          nombre: "Punto en Medellín",
          direccion: "Carrera 81",
          lat: 6.2442,
          lng: -75.5812,
          necesidades: [],
          confirmado: 1786724800941,
        },
      ],
    });
    const [r] = parseFeed(feed);
    expect(r!.admin2Code).toBeNull();
  });
});
