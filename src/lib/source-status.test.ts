import { describe, expect, it } from "vitest";

import { UNCHANGED_NOTICE_MS, sourceStatusLabel, type SourceStatusInput } from "./source-status";

const AHORA = new Date("2026-09-02T02:35:00Z");

function source(over: Partial<SourceStatusInput> = {}): SourceStatusInput {
  return {
    enabled: true,
    records: 95,
    withdrawn: 0,
    lastReadAt: new Date(AHORA.getTime() - 5 * 60_000),
    lastChangedAt: new Date(AHORA.getTime() - 10 * 60_000),
    ...over,
  };
}

describe("sourceStatusLabel — cuándo se leyó, no cuándo cambió", () => {
  it("nombra la última lectura, no la última observación", () => {
    // El bug medido en producción: Donde Ayudo se lee cada quince minutos y no
    // publica un cambio desde el 14 de agosto. La etiqueta decía "Leída hace 19
    // días" de una fuente que se acababa de leer.
    const label = sourceStatusLabel(
      source({
        lastReadAt: new Date(AHORA.getTime() - 5 * 60_000),
        lastChangedAt: new Date("2026-08-14T01:36:43Z"),
      }),
      AHORA,
    );
    expect(label).toContain("Leída hace 5 min");
    expect(label).not.toMatch(/Leída hace 19 días/);
  });

  it("dice también que la fuente lleva tiempo sin cambiar", () => {
    // Sin esta mitad, arreglar la etiqueta escondería que el contenido tiene
    // 19 días — que es justo lo que una persona necesita para decidir si
    // confiar en una dirección.
    const label = sourceStatusLabel(
      source({ lastChangedAt: new Date("2026-08-14T01:36:43Z") }),
      AHORA,
    );
    expect(label).toBe("Leída hace 5 min · sin cambios hace 19 días");
  });

  it("no menciona los cambios cuando la fuente está al día", () => {
    // Una fuente viva y sin novedades no tiene por qué parecer sospechosa.
    const label = sourceStatusLabel(
      source({ lastChangedAt: new Date(AHORA.getTime() - 3 * 3_600_000) }),
      AHORA,
    );
    expect(label).toBe("Leída hace 5 min");
  });

  it("el umbral es un día, y no se dispara justo por debajo", () => {
    const justo = sourceStatusLabel(
      source({ lastChangedAt: new Date(AHORA.getTime() - UNCHANGED_NOTICE_MS) }),
      AHORA,
    );
    expect(justo).toBe("Leída hace 5 min");

    const pasado = sourceStatusLabel(
      source({ lastChangedAt: new Date(AHORA.getTime() - UNCHANGED_NOTICE_MS - 60_000) }),
      AHORA,
    );
    expect(pasado).toContain("sin cambios");
  });
});

describe("sourceStatusLabel — los otros estados", () => {
  it("una fuente sin conectar lo dice antes que nada", () => {
    expect(sourceStatusLabel(source({ enabled: false }), AHORA)).toBe("No conectada todavía");
  });

  it("una fuente que cerró no es una que nunca se leyó", () => {
    const label = sourceStatusLabel(source({ records: 0, withdrawn: 936 }), AHORA);
    expect(label).toBe("La fuente cerró y retiró sus avisos");
  });

  it("no le pone fecha al cierre, porque no tenemos esa fecha", () => {
    // La única que hay es cuándo lo procesamos nosotros, y ahí se lee como
    // cuándo cerró la fuente, que es otro hecho.
    const label = sourceStatusLabel(source({ records: 0, withdrawn: 936 }), AHORA);
    expect(label).not.toMatch(/hace/);
  });

  it("distingue no haber leído nunca de haber leído sin cambios", () => {
    expect(sourceStatusLabel(source({ lastReadAt: null }), AHORA)).toBe("Sin lecturas todavía");
    expect(sourceStatusLabel(source({ lastChangedAt: null }), AHORA)).toBe("Leída hace 5 min");
  });

  it("un retiro parcial no apaga la fuente", () => {
    // `withdrawn > 0` con registros vivos es una fuente que sigue publicando.
    const label = sourceStatusLabel(source({ records: 12, withdrawn: 3 }), AHORA);
    expect(label).toContain("Leída");
  });
});
