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

describe("dotación de voluntarios", () => {
  function punto(extra: Record<string, unknown>) {
    return JSON.stringify({
      puntos: [
        {
          id: "v1",
          tipo: "rescate",
          estado: "urgente",
          nombre: "Sitio de remoción",
          direccion: "Calle 5 #1-20",
          lat: 3.4516,
          lng: -76.532,
          necesidades: [],
          confirmado: 1786724800941,
          ...extra,
        },
      ],
    });
  }

  it("donde faltan manos, marca voluntarios y lo dice", () => {
    process.env.MAPA_EMERGENCIA_INCLUIR_RESCATE = "on";
    const [r] = parseFeed(
      punto({ saturacion: "faltan", voluntarios_hay: 6, voluntarios_faltan: 43 }),
    );
    expect(r!.categoryCodes).toContain("volunteers");
    expect(r!.status).toBe("active");
    expect(r!.description).toContain("Faltan 43 voluntarios");
    expect(r!.description).toContain("6 en el sitio");
  });

  it("donde ya sobra gente, no aparece como sitio para ir a ayudar", () => {
    // Mandar a alguien a un sitio saturado le gasta el viaje. Es el dato que
    // ninguna otra fuente tiene y por eso vale codificarlo.
    process.env.MAPA_EMERGENCIA_INCLUIR_RESCATE = "on";
    const [r] = parseFeed(
      punto({ saturacion: "exceso", voluntarios_hay: 20, voluntarios_faltan: 0 }),
    );
    expect(r!.categoryCodes).not.toContain("volunteers");
    expect(r!.status).toBe("fulfilled");
    expect(r!.description).toContain("Ya hay suficientes");
  });

  it("sin dato de dotación, cae al estado que declara la fuente", () => {
    process.env.MAPA_EMERGENCIA_INCLUIR_RESCATE = "on";
    const [r] = parseFeed(
      punto({ saturacion: "sin_dato", voluntarios_hay: 0, voluntarios_faltan: 0 }),
    );
    expect(r!.status).toBe("active");
    expect(r!.categoryCodes).not.toContain("volunteers");
  });
});
