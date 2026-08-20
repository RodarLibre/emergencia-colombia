import { describe, expect, it } from "vitest";

import {
  MISSED_RUNS_TOLERATED,
  STALE_FLOOR_MINUTES,
  classifySources,
  staleSources,
  type SourceReading,
} from "./source-health";

/**
 * `mapa-emergencia` —el 80% del catálogo— dejó de leerse el 15 de agosto y
 * nadie se enteró en cuatro días. El sitio seguía respondiendo, la ingesta se
 * ponía en cuarentena sola y correctamente, y los registros simplemente
 * dejaban de reconfirmarse. Una fuente se muere en silencio.
 */

const AHORA = new Date("2026-08-19T23:00:00Z");

function lectura(overrides: Partial<SourceReading> = {}): SourceReading {
  return {
    slug: "una-fuente",
    name: "Una fuente",
    lastReadAt: new Date(AHORA.getTime() - 5 * 60_000),
    pollIntervalSeconds: 900,
    ...overrides,
  };
}

describe("frescura por fuente", () => {
  it("una lectura reciente está bien", () => {
    const [estado] = classifySources([lectura()], AHORA);
    expect(estado!.stale).toBe(false);
  });

  it("aguanta un traspié sin gritar", () => {
    // Una corrida perdida de 15 minutos: normal.
    const hace20min = new Date(AHORA.getTime() - 20 * 60_000);
    const [estado] = classifySources([lectura({ lastReadAt: hace20min })], AHORA);
    expect(estado!.stale).toBe(false);
  });

  it("marca la que lleva más de tres corridas sin aparecer", () => {
    const perdidas = 900 * (MISSED_RUNS_TOLERATED + 1) * 1000;
    const [estado] = classifySources(
      [lectura({ lastReadAt: new Date(AHORA.getTime() - perdidas) })],
      AHORA,
    );
    expect(estado!.stale).toBe(true);
  });

  it("el caso real: cuatro días", () => {
    const cuatroDias = new Date(AHORA.getTime() - 100 * 3_600_000);
    const [estado] = classifySources([lectura({ lastReadAt: cuatroDias })], AHORA);
    expect(estado!.stale).toBe(true);
    expect(Math.round(estado!.hoursAgo!)).toBe(100);
  });

  it("una fuente de intervalo corto no se declara muerta a los minutos", () => {
    // Con 60 s de intervalo, tres corridas son tres minutos. El piso manda.
    const hace10min = new Date(AHORA.getTime() - 10 * 60_000);
    const [estado] = classifySources(
      [lectura({ pollIntervalSeconds: 60, lastReadAt: hace10min })],
      AHORA,
    );
    expect(estado!.stale).toBe(false);
    expect(STALE_FLOOR_MINUTES).toBeGreaterThan(10);
  });

  it("nunca leída cuenta como muerta", () => {
    const [estado] = classifySources([lectura({ lastReadAt: null })], AHORA);
    expect(estado!.stale).toBe(true);
    expect(estado!.hoursAgo).toBeNull();
  });

  it("separa solo las que fallan", () => {
    const estados = classifySources(
      [
        lectura({ slug: "viva" }),
        lectura({ slug: "muerta", lastReadAt: new Date(AHORA.getTime() - 100 * 3_600_000) }),
      ],
      AHORA,
    );
    expect(staleSources(estados).map((s) => s.slug)).toEqual(["muerta"]);
  });
});
