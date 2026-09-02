import { describe, expect, it } from "vitest";

import { AGEING_NOTICE_MS, catalogStatusLines, type CatalogStatusInput } from "./catalog-status";
import { FRESHNESS_WINDOW_MINUTES, PERISHABLE_RECORD_TYPES } from "./vocab";

const AHORA = new Date("2026-09-02T17:00:00Z");
const hace = (ms: number) => new Date(AHORA.getTime() - ms);
const HORA = 3_600_000;
const DIA = 24 * HORA;

function stats(over: Partial<CatalogStatusInput> = {}): CatalogStatusInput {
  return {
    sourceCount: 5,
    recordCount: 248,
    lastReadAt: hace(8 * 60_000),
    lastPerishableUpdateAt: hace(2 * HORA),
    ...over,
  };
}

describe("catalogStatusLines — el caso que motivó el cambio", () => {
  it("dice que nada es nuevo cuando el catálogo perecedero está quieto", () => {
    // Producción el 2026-09-02: el feed sísmico publicaba cada pocas horas y
    // la línea decía "hace 2 horas", mientras lo humanitario llevaba veinte
    // días sin moverse. De los cuatro sitios donde este proyecto confundió
    // esas dos fechas, este era el único que erraba hacia la confianza.
    const l = catalogStatusLines(
      stats({ lastReadAt: hace(8 * 60_000), lastPerishableUpdateAt: hace(20 * DIA) }),
      AHORA,
    );
    expect(l.freshness).toBe("leídas hace 8 min · nada nuevo desde hace 20 días");
  });

  it("no menciona la antigüedad cuando el catálogo sí se está moviendo", () => {
    // Una tubería viva y con novedades no tiene por qué parecer sospechosa.
    const l = catalogStatusLines(stats({ lastPerishableUpdateAt: hace(2 * HORA) }), AHORA);
    expect(l.freshness).toBe("leídas hace 8 min");
  });

  it("el umbral es la ventana de un albergue, y no se dispara justo por debajo", () => {
    // 12 h: pasado eso un registro suelto ya muestra "Sin confirmar", así que
    // el resumen que va encima no puede seguir leyéndose como al día.
    expect(AGEING_NOTICE_MS).toBe(FRESHNESS_WINDOW_MINUTES.shelter! * 60_000);

    expect(
      catalogStatusLines(stats({ lastPerishableUpdateAt: hace(AGEING_NOTICE_MS) }), AHORA)
        .freshness,
    ).toBe("leídas hace 8 min");
    expect(
      catalogStatusLines(stats({ lastPerishableUpdateAt: hace(AGEING_NOTICE_MS + 60_000) }), AHORA)
        .freshness,
    ).toContain("nada nuevo");
  });
});

describe("catalogStatusLines — los bordes", () => {
  it("sin lecturas todavía no dice nada de fechas", () => {
    expect(catalogStatusLines(stats({ lastReadAt: null }), AHORA).freshness).toBeNull();
  });

  it("sin nada perecedero solo dice cuándo se leyó", () => {
    // Un catálogo de puros sismos: no hay antigüedad que reportar, porque
    // ninguno de esos registros envejece.
    const l = catalogStatusLines(stats({ lastPerishableUpdateAt: null }), AHORA);
    expect(l.freshness).toBe("leídas hace 8 min");
  });

  it("cuenta en singular y en plural", () => {
    expect(catalogStatusLines(stats({ recordCount: 1, sourceCount: 1 }), AHORA).count).toBe(
      "1 aviso de 1 fuente",
    );
    expect(catalogStatusLines(stats({ recordCount: 248, sourceCount: 5 }), AHORA).count).toBe(
      "248 avisos de 5 fuentes",
    );
  });
});

describe("PERISHABLE_RECORD_TYPES", () => {
  it("sale de la tabla de frescura y no de una lista escrita a mano", () => {
    for (const t of PERISHABLE_RECORD_TYPES) {
      expect(FRESHNESS_WINDOW_MINUTES[t], t).not.toBeNull();
    }
  });

  it("deja fuera lo que no envejece, e incluye lo que sí", () => {
    // Un sismo de magnitud 7,4 de hace veinte días es el mismo hecho de
    // siempre; un albergue sin reconfirmar hace veinte días es un dato viejo.
    expect(PERISHABLE_RECORD_TYPES).not.toContain("seismic_event");
    expect(PERISHABLE_RECORD_TYPES).not.toContain("official_update");
    for (const t of ["shelter", "collection_point", "service_point", "hazard"] as const) {
      expect(PERISHABLE_RECORD_TYPES, t).toContain(t);
    }
  });
});
