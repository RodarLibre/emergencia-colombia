import { describe, expect, it } from "vitest";

import { costoUsd, type Preguntas, type ResumenDeUso } from "./costo";
import { construirReporte } from "./reporte";

/**
 * Medir el gasto importa porque el presupuesto sale de los créditos de una
 * persona. Y lo que se manda a un canal de Discord se reenvía, así que el
 * reporte no puede llevar nada de nadie.
 */

function preguntas(overrides: Partial<Preguntas> = {}): Preguntas {
  return {
    total: 0,
    cached: 0,
    deterministic: 0,
    outOfScope: 0,
    outOfCoverage: 0,
    empty: 0,
    ...overrides,
  };
}

function resumen(overrides: Partial<ResumenDeUso> = {}): ResumenDeUso {
  return {
    hoy: {
      calls: 120,
      inputTokens: 60_000,
      outputTokens: 6_000,
      failures: 0,
      usd: 0.0042,
      // Mas preguntas que llamadas: es lo normal, no un error de cuentas.
      preguntas: preguntas({ total: 300, cached: 150, deterministic: 30, empty: 12 }),
    },
    ultimos7: {
      calls: 840,
      inputTokens: 420_000,
      outputTokens: 42_000,
      usd: 0.0294,
      preguntas: preguntas({ total: 2_100, cached: 1_050 }),
    },
    total: {
      calls: 3_000,
      inputTokens: 1_500_000,
      outputTokens: 150_000,
      usd: 0.105,
      preguntas: preguntas({ total: 7_500, cached: 4_000 }),
    },
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

/**
 * El contador parecía congelado mientras el bot se usaba.
 *
 * `calls` solo cuenta llamadas al modelo, y la mayoría de las preguntas no
 * llama al modelo: una repetida sale de la caché, una fuera de alcance se
 * resuelve antes de gastar nada, y sin cupo se busca el texto tal cual. El
 * reporte mostraba el número que menos se movía.
 */
describe("el reporte cuenta preguntas, no solo inferencia", () => {
  it("muestra las preguntas antes que las llamadas al modelo", () => {
    const reporte = construirReporte(resumen(), "https://ejemplo.org");
    const hoy = reporte.embeds[0]!.fields.find((f) => f.name === "Hoy")!;

    expect(hoy.value).toContain("300");
    expect(hoy.value).toContain("preguntas");
    // Y la llamada al modelo sigue estando, para explicar el costo.
    expect(hoy.value).toContain("120");
  });

  it("dice cuánto se resolvió sin gastar", () => {
    const reporte = construirReporte(resumen(), "https://ejemplo.org");
    const campo = reporte.embeds[0]!.fields.find((f) => f.name.startsWith("Sin gastar"))!;

    // 150 de caché + 30 sin modelo = 180 de 300.
    expect(campo.value).toContain("180");
    expect(campo.value).toContain("60%");
  });

  it("separa lo que se fue sin respuesta, que es lo que falta cubrir", () => {
    const reporte = construirReporte(resumen(), "https://ejemplo.org");
    const campo = reporte.embeds[0]!.fields.find((f) => f.name.startsWith("Se fueron"))!;

    expect(campo.value).toContain("12");
  });

  it("no menciona lo que no pasó: sin preguntas perdidas, no hay campo", () => {
    const limpio = resumen();
    limpio.hoy.preguntas = preguntas({ total: 10, cached: 2 });
    const reporte = construirReporte(limpio, "https://ejemplo.org");

    expect(reporte.embeds[0]!.fields.some((f) => f.name.startsWith("Se fueron"))).toBe(false);
  });
});

/**
 * La línea que faltaba el día que una fuente se murió.
 *
 * `mapa-emergencia` estuvo cuatro días sin leerse y el reporte de cada hora
 * salió igual de tranquilo, porque solo hablaba de gasto. El gasto de un día
 * son céntimos; un catálogo congelado manda a alguien a un sitio que ya cerró.
 */
describe("frescura de las fuentes en el reporte", () => {
  const fuentes = [
    { slug: "viva", name: "Fuente Viva", hoursAgo: 0.2, stale: false },
    { slug: "muerta", name: "Fuente Muerta", hoursAgo: 100.6, stale: true },
  ];

  it("las lista siempre, no solo cuando algo falla", () => {
    const sanas = [{ slug: "viva", name: "Fuente Viva", hoursAgo: 0.2, stale: false }];
    const campos = construirReporte(resumen(), "https://ejemplo.org", sanas).embeds[0]!.fields;
    expect(campos.some((f) => f.name.startsWith("Fuentes"))).toBe(true);
  });

  it("nombra la que se cayó y hace cuánto", () => {
    const campo = construirReporte(
      resumen(),
      "https://ejemplo.org",
      fuentes,
    ).embeds[0]!.fields.find((f) => f.name.startsWith("Fuentes"))!;

    expect(campo.name).toContain("1 sin actualizar");
    expect(campo.value).toContain("Fuente Muerta");
    expect(campo.value).toContain("4 días");
  });

  it("una fuente caída pinta el mensaje de rojo, por encima del presupuesto", () => {
    const holgado = resumen({ presupuestoUsd: 1000 });
    const conCaida = construirReporte(holgado, "https://ejemplo.org", fuentes).embeds[0]!.color;
    const sinCaida = construirReporte(holgado, "https://ejemplo.org", [fuentes[0]!]).embeds[0]!
      .color;

    expect(conCaida).toBe(0xa32219);
    expect(sinCaida).not.toBe(conCaida);
  });

  it("sin datos de fuentes no inventa el campo", () => {
    const campos = construirReporte(resumen(), "https://ejemplo.org").embeds[0]!.fields;
    expect(campos.some((f) => f.name.startsWith("Fuentes"))).toBe(false);
  });
});
