import { describe, expect, it } from "vitest";

import { ALL_MUNICIPALITIES, computeFreshness, departmentOf } from "./vocab";

const NOW = new Date("2026-08-13T12:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("computeFreshness", () => {
  it("is fresh inside the window", () => {
    expect(computeFreshness("hazard", minutesAgo(59), NOW)).toBe("fresh");
    expect(computeFreshness("hazard", minutesAgo(60), NOW)).toBe("fresh");
  });

  it("needs reconfirmation past the window but within 3x", () => {
    expect(computeFreshness("hazard", minutesAgo(61), NOW)).toBe("needs_reconfirmation");
    expect(computeFreshness("hazard", minutesAgo(180), NOW)).toBe("needs_reconfirmation");
  });

  it("is stale past 3x the window", () => {
    expect(computeFreshness("hazard", minutesAgo(181), NOW)).toBe("stale");
  });

  it.each(["collection_point", "service_point", "shelter"] as const)(
    "uses the 720-minute window for %s",
    (recordType) => {
      expect(computeFreshness(recordType, minutesAgo(720), NOW)).toBe("fresh");
      expect(computeFreshness(recordType, minutesAgo(721), NOW)).toBe("needs_reconfirmation");
      expect(computeFreshness(recordType, minutesAgo(2161), NOW)).toBe("stale");
    },
  );

  it("is always fresh for official_update, no matter the age", () => {
    expect(computeFreshness("official_update", minutesAgo(0), NOW)).toBe("fresh");
    expect(computeFreshness("official_update", minutesAgo(100_000), NOW)).toBe("fresh");
  });
});

describe("erratas de la fuente oficial", () => {
  it("Quindío lleva tilde, aunque el MGN del DANE la omita", () => {
    // Es la unica errata de acentuacion en los 33 departamentos. Se corrige en
    // `scripts/fetch-municipios.mjs`, para que no reaparezca al regenerar.
    const nombres = new Set(ALL_MUNICIPALITIES.map((m) => m.deptName));
    expect(nombres.has("Quindío")).toBe(true);
    expect(nombres.has("Quindio")).toBe(false);
  });
});

/**
 * El departamento se deriva del municipio, no se asume.
 *
 * Cada registro llevaba el PRIMER departamento operativo, que era correcto
 * cuando el área era solo Valle del Cauca. Al crecer al Eje Cafetero quedó
 * mintiendo en silencio: Pereira con su código de municipio bien, 66001, y al
 * lado el departamento 76.
 */
describe("departmentOf", () => {
  it("saca el departamento del código del municipio", () => {
    expect(departmentOf("66001")).toEqual({ code: "66", name: "Risaralda" });
    expect(departmentOf("63001")).toEqual({ code: "63", name: "Quindío" });
    expect(departmentOf("17001")).toEqual({ code: "17", name: "Caldas" });
    expect(departmentOf("76001")).toEqual({ code: "76", name: "Valle del Cauca" });
  });

  it("sin municipio no inventa departamento: eso lo decide quien llama", () => {
    expect(departmentOf(null)).toBeNull();
    expect(departmentOf(undefined)).toBeNull();
    expect(departmentOf("")).toBeNull();
    expect(departmentOf("99999")).toBeNull();
  });
});
