import { describe, expect, it } from "vitest";

import { costoUsd, type ResumenDeUso } from "./costo";
import { construirReporte } from "./reporte";

/**
 * Medir el gasto importa porque el presupuesto sale de los créditos de una
 * persona. Y lo que se manda a un canal de Discord se reenvía, así que el
 * reporte no puede llevar nada de nadie.
 */

function resumen(overrides: Partial<ResumenDeUso> = {}): ResumenDeUso {
  return {
    hoy: { calls: 120, inputTokens: 60_000, outputTokens: 6_000, failures: 0, usd: 0.0042 },
    ultimos7: { calls: 840, inputTokens: 420_000, outputTokens: 42_000, usd: 0.0294 },
    total: { calls: 3_000, inputTokens: 1_500_000, outputTokens: 150_000, usd: 0.105 },
    usdPorDia: 0.0042,
    presupuestoUsd: 0,
    diasRestantes: null,
    ...overrides,
  };
}

describe("cálculo de costo", () => {
  it("cobra entrada y salida por separado", () => {
    // 1M de entrada a 0.05 y 1M de salida a 0.20.
    expect(costoUsd(1_000_000, 1_000_000)).toBeCloseTo(0.25, 5);
  });

  it("sin consumo, sin costo", () => {
    expect(costoUsd(0, 0)).toBe(0);
  });
});

describe("el reporte no lleva datos de nadie", () => {
  it("solo agregados", () => {
    const reporte = construirReporte(resumen(), "https://ejemplo.org");
    const valores = reporte.embeds[0]!.fields.map((f) => `${f.name} ${f.value}`).join(" ");
    // Los campos solo pueden llevar cifras y etiquetas, nunca contenido de nadie.
    for (const prohibido of ["cookie", "whatsapp", "@", "http"]) {
      expect(valores.toLowerCase()).not.toContain(prohibido);
    }
    expect(reporte.embeds[0]!.footer.text).toContain("No se registran preguntas ni usuarios");
  });
});

describe("presupuesto", () => {
  it("no aparece cuando no se declaró", () => {
    const texto = JSON.stringify(construirReporte(resumen(), "https://ejemplo.org"));
    expect(texto).not.toContain("Presupuesto");
  });

  it("muestra lo usado, lo que queda y cuánto aguanta", () => {
    const r = resumen({ presupuestoUsd: 1, diasRestantes: 213 });
    const texto = JSON.stringify(construirReporte(r, "https://ejemplo.org"));
    expect(texto).toContain("Presupuesto");
    expect(texto).toContain("11% usado");
    expect(texto).toContain("213 días");
  });

  it("cambia de color al acercarse al techo", () => {
    const verde = construirReporte(resumen({ presupuestoUsd: 1 }), "x").embeds[0]!.color;
    const rojo = construirReporte(
      resumen({ presupuestoUsd: 0.11, total: { ...resumen().total, usd: 0.105 } }),
      "x",
    ).embeds[0]!.color;
    expect(verde).not.toBe(rojo);
  });
});

describe("fallos del proveedor", () => {
  it("no se mencionan cuando no hay", () => {
    const texto = JSON.stringify(construirReporte(resumen(), "x"));
    expect(texto).not.toContain("Fallos");
  });

  it("se mencionan cuando los hay", () => {
    // Un cero repetido cada día entrena a la gente a no leer el mensaje.
    const r = resumen({ hoy: { ...resumen().hoy, failures: 12 } });
    expect(JSON.stringify(construirReporte(r, "x"))).toContain("Fallos del proveedor");
  });
});
