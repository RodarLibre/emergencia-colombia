import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parsePereiraAyuda } from "./pereira-ayuda";

/**
 * Pereira Ayuda publica un sitemap curado con solo albergues y puntos de salud.
 * La curaduría es buena, pero no perfecta, y es de ellos: lo que decide qué
 * entra acá es mirar el dato, no confiar en la clasificación ajena.
 */

const RAW = readFileSync("fixtures/pereira-ayuda-fichas.json", "utf8");
const AHORA = new Date("2026-08-20T18:00:00Z");

describe("pereira-ayuda", () => {
  const records = parsePereiraAyuda(RAW, AHORA);

  it("saca los puntos institucionales del sitemap curado", () => {
    expect(records.length).toBeGreaterThan(15);
    expect(
      records.every((r) => r.recordType === "shelter" || r.recordType === "service_point"),
    ).toBe(true);
  });

  it("descarta toda ficha con un teléfono, que es el pedido de una persona", () => {
    // El fixture trae las 24, incluidas las tres con contacto. Dos de ellas
    // venían tituladas "Pañales para adulto · Punto de salud".
    const paginas = (JSON.parse(RAW) as { pages: unknown[] }).pages.length;
    expect(paginas).toBe(24);
    expect(records).toHaveLength(21);
    expect(records.some((r) => /pañales/i.test(r.title))).toBe(false);
  });

  it("nunca deja un número en lo que se indexa ni en lo que se muestra", () => {
    for (const r of records) {
      expect(r.searchText).not.toMatch(/\d{7}/);
      expect(r.description ?? "").not.toMatch(/3\d{9}/);
      expect(r.contacts ?? []).toHaveLength(0);
    }
  });

  it("resuelve el municipio, y siempre cae en Risaralda", () => {
    const municipios = new Set(records.map((r) => r.admin2Name));
    expect(municipios).toContain("Pereira");
    expect(municipios).toContain("Dosquebradas");
    // El código de municipio manda; el departamento se deriva de él.
    expect(records.every((r) => r.admin2Code === null || r.admin2Code.startsWith("66"))).toBe(true);
  });

  it("un albergue es alojamiento y un punto de salud es atención médica", () => {
    const albergue = records.find((r) => r.recordType === "shelter")!;
    const salud = records.find((r) => r.recordType === "service_point")!;
    expect(albergue.categoryCodes).toContain("shelter");
    expect(salud.categoryCodes).toContain("medical_assistance");
  });

  it("solo pone fecha cuando la fuente la dice", () => {
    const conFecha = records.filter((r) => r.sourceUpdatedAt !== null);
    // Ocho de las fichas escriben "Actualizado el …"; el resto no dice nada, y
    // null es lo cierto. El lastmod del sitemap es igual para todas —es cuándo
    // se regeneró el archivo— y usarlo afirmaría que se revisaron todas hoy.
    expect(conFecha.length).toBeGreaterThan(0);
    expect(conFecha.length).toBeLessThan(records.length);
    for (const r of conFecha) {
      expect(r.sourceUpdatedAt!.getTime()).toBeLessThanOrEqual(AHORA.getTime());
      expect(r.sourceUpdatedAt!.getUTCFullYear()).toBe(2026);
    }
  });

  it("no inventa una dirección que la fuente no publicó", () => {
    expect(records.every((r) => r.displayAddress === null)).toBe(true);
  });

  it("cada registro enlaza a su ficha y tiene identidad estable", () => {
    for (const r of records) {
      expect(r.recordUrl).toMatch(/^https:\/\/pereiraayuda\.com\/p\//);
      expect(r.externalId).toBeTruthy();
      expect(r.contentHash).toHaveLength(64);
    }
    expect(new Set(records.map((r) => r.externalId)).size).toBe(records.length);
  });
});

/**
 * Desescapar dos veces.
 *
 * `decode` corría `&amp;` primero, así que `&amp;#39;` —un `&#39;` literal que
 * la fuente escapó a propósito— quedaba como `'`, y `&amp;lt;script&amp;gt;`
 * volvía a ser una etiqueta de verdad. Lo encontró CodeQL en la PR; la regla
 * es que `&amp;` va de último, porque es el que puede fabricar otra entidad.
 */
describe("decodificación de entidades", () => {
  function ficha(titulo: string): string {
    return JSON.stringify({
      fetchedAt: "2026-08-20T18:00:00.000Z",
      pages: [
        {
          url: "https://pereiraayuda.com/p/prueba.html",
          html:
            `<meta property="og:title" content="${titulo} · Albergue en Pereira">` +
            `<meta property="og:url" content="https://pereiraayuda.com/p/prueba.html">` +
            `<meta property="og:description" content="Colchonetas">` +
            `<div data-slug="prueba"></div>`,
        },
      ],
    });
  }

  it("no vuelve a decodificar lo que ya estaba escapado", () => {
    const [r] = parsePereiraAyuda(ficha("&amp;#39;"), AHORA);
    expect(r!.title).toBe("&#39;");
  });

  it("no reconstruye una etiqueta que la fuente escapó", () => {
    const [r] = parsePereiraAyuda(ficha("&amp;lt;script&amp;gt;"), AHORA);
    expect(r!.title).toBe("&lt;script&gt;");
    expect(r!.title).not.toContain("<script>");
  });

  it("sigue decodificando lo que sí toca", () => {
    const [r] = parsePereiraAyuda(ficha("Caf&#233; Agua &amp; algo"), AHORA);
    expect(r!.title).toBe("Café Agua & algo");
  });
});

describe("el estado que la fuente escribe en el titulo", () => {
  const registros = parsePereiraAyuda(RAW, AHORA);
  const porTitulo = (fragmento: string) => registros.find((r) => r.title.includes(fragmento));

  it("no da por activo un sitio que la fuente marca evacuado", () => {
    // "Clinica Los Nevados — EVACUADA" trae "Ojo: No vaya" en la ficha.
    // Mostrarla con el sello "Activo" es el fallo que este proyecto evita.
    const nevados = porTitulo("Los Nevados");
    expect(nevados).toBeDefined();
    expect(nevados!.status).toBe("unknown");
  });

  it("tampoco lo da por cerrado, que seria afirmar de mas", () => {
    // Un hospital evacuado puede seguir atendiendo urgencias, y
    // "parcialmente evacuada" no es un cierre. "Sin dato" es lo que sabemos.
    for (const fragmento of ["Los Nevados", "Noé", "Comfamiliar"]) {
      const r = porTitulo(fragmento);
      expect(r, fragmento).toBeDefined();
      expect(r!.status, fragmento).not.toBe("closed");
      expect(r!.status, fragmento).toBe("unknown");
    }
  });

  it("deja activo lo que la fuente marca ABIERTO", () => {
    const sanJorge = porTitulo("San Jorge");
    expect(sanJorge).toBeDefined();
    expect(sanJorge!.status).toBe("active");
  });

  it('NO trata "Ojo:" como un cierre', () => {
    // Nueve de las 21 fichas lo traen y es una advertencia, no un estado. Dos
    // son albergues abiertos que solo piden pasar antes por el CAM: marcarlos
    // cerrados le negaria un techo a alguien, que es el error opuesto y peor.
    for (const fragmento of ["Centro Vida Violetas", "Polideportivo Campestre"]) {
      const r = porTitulo(fragmento);
      expect(r, fragmento).toBeDefined();
      expect(r!.status, fragmento).toBe("active");
    }
  });

  it("la mayoria sigue activa: esto no apaga la fuente", () => {
    const activos = registros.filter((r) => r.status === "active");
    expect(activos.length).toBeGreaterThanOrEqual(registros.length - 4);
  });
});
