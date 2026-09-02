import { createHash } from "node:crypto";

import { buildSearchText, extractCategories, resolveMunicipality } from "@/lib/normalize";
import type { Category, RecordTypeV1, Status } from "@/lib/vocab";

import { ParserError, USER_AGENT, redactContact, type ParsedRecord } from "../types";

/**
 * Pereira Ayuda — albergues y puntos de salud del Eje Cafetero.
 *
 * Lo mantiene un grupo de jovenes de Pereira yendo a los sitios, y cubre
 * Pereira, Dosquebradas, La Virginia, Santa Rosa de Cabal y la zona rural: el
 * area donde teniamos 86 registros contra 655 de Cali.
 *
 * Su robots.txt dice "todo el sitio es publico y queremos que se indexe
 * entero", y ya hicieron por su cuenta la separacion que a nosotros nos
 * importa: publican un sitemap aparte, `/p/sitemap.xml`, con solo los albergues
 * y los puntos de salud, y le ponen `noindex` a las otras ~550 fichas "porque
 * son pedidos y ofertas con el nombre de una persona encima, y que eso salga en
 * Google para siempre no es lo que esa persona vino a pedir".
 *
 * Se lee ese sitemap y no su base de datos. Es un asset estatico, que es lo que
 * el checklist prefiere sobre una API, y respeta la frontera que ellos mismos
 * dibujaron.
 */

export const PEREIRA_AYUDA_SOURCE = {
  slug: "pereira-ayuda",
  name: "Pereira Ayuda",
  baseUrl: "https://pereiraayuda.com",
  mode: "sitemap_html",
  trustLabel: "community",
  // Una hora, no quince minutos. Cada corrida son ~22 peticiones a un sitio
  // que sostiene un grupo de voluntarios; el catalogo cambia de a poco y no
  // justifica pedirle mas.
  pollIntervalSeconds: 3600,
  coverageAdmin1Code: "66",
  contactNote:
    "Sitio publico con robots.txt que invita a indexar. Se lee unicamente /p/sitemap.xml, el listado curado que la propia fuente marca como indexable. Sin acuerdo de contactos: no se replica ninguno.",
} as const;

const SITEMAP_URL = `${PEREIRA_AYUDA_SOURCE.baseUrl}/p/sitemap.xml`;

/** Lo que `fetch` devuelve y `parse` recibe. Un solo string, como el resto. */
type Bundle = { fetchedAt: string; pages: { url: string; html: string }[] };

async function getText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new ParserError(`${url} respondio ${res.status}`);
  return res.text();
}

export async function fetchPereiraAyuda(): Promise<string> {
  const sitemap = await getText(SITEMAP_URL);
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!.trim());
  if (urls.length === 0) throw new ParserError("El sitemap curado no trajo ninguna ficha.");

  const pages: Bundle["pages"] = [];
  for (const url of urls) {
    pages.push({ url, html: await getText(url) });
    // Una pausa corta entre fichas: son voluntarios, no una CDN.
    await new Promise((r) => setTimeout(r, 300));
  }
  return JSON.stringify({ fetchedAt: new Date().toISOString(), pages } satisfies Bundle);
}

/** `og:title` viene como "NOMBRE · TIPO en LOCALIDAD, MUNICIPIO". Se cumple en las 24 fichas. */
const TITLE = /^(.*?) · (.*?) en (.*)$/;

const TYPE_BY_LABEL: Record<string, { type: RecordTypeV1; category: Category | null }> = {
  albergue: { type: "shelter", category: "shelter" },
  "punto de salud": { type: "service_point", category: "medical_assistance" },
};

const MONTHS: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

/**
 * "Actualizado el 15 de agosto a las 2:53 p. m." → Date, en hora de Bogota.
 *
 * Solo 8 de las 24 fichas lo dicen. Las otras se quedan en null a proposito: el
 * `lastmod` del sitemap es identico para todas —es cuando se regenero el
 * archivo, no cuando se actualizo el punto— y usarlo afirmaria que las 24 se
 * revisaron hoy. Null es lo cierto: la fuente no lo dijo.
 */
function parseUpdatedAt(text: string, now: Date): Date | null {
  const m = text.match(
    /Actualizado el (\d{1,2}) de ([a-zé]+)(?: de (\d{4}))? a las (\d{1,2}):(\d{2}) ?([ap])\. ?m\./i,
  );
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (month === undefined) return null;

  let hour = Number(m[4]);
  if (m[6]!.toLowerCase() === "p" && hour !== 12) hour += 12;
  if (m[6]!.toLowerCase() === "a" && hour === 12) hour = 0;

  const year = m[3] ? Number(m[3]) : now.getUTCFullYear();
  // Bogota es UTC-5 todo el año: no hay horario de verano que corregir.
  const parsed = new Date(Date.UTC(year, month, Number(m[1]), hour + 5, Number(m[5])));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function meta(html: string, property: string): string | null {
  const m = html.match(new RegExp(`<meta property="${property}" content="([^"]*)"`, "i"));
  return m ? decode(m[1]!) : null;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, "&");
}

function visibleText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cualquier telefono. Ver el motivo en `parse`. */
const PHONE = /(?<!\d)3\d{9}(?!\d)/;

export function parsePereiraAyuda(raw: string, now: Date): ParsedRecord[] {
  let bundle: Bundle;
  try {
    bundle = JSON.parse(raw) as Bundle;
  } catch {
    throw new ParserError("El bundle no es JSON valido.");
  }
  if (!Array.isArray(bundle.pages)) throw new ParserError("El bundle no trae paginas.");

  const out: ParsedRecord[] = [];

  for (const page of bundle.pages) {
    const html = page.html ?? "";

    // Un telefono en la ficha significa que es el pedido de una persona, no un
    // punto institucional. Su curaduria es buena pero no perfecta: en las 24
    // fichas indexadas se colaron tres asi, dos de ellas tituladas "Pañales
    // para adulto · Punto de salud". No se confia en la clasificacion ajena
    // para decidir esto; se mira el dato.
    if (PHONE.test(html)) continue;

    const title = meta(html, "og:title");
    const url = meta(html, "og:url") ?? page.url;
    if (!title || !url) continue;

    const parts = title.replace(/ \| Pereira Ayuda$/, "").match(TITLE);
    if (!parts) continue;

    const [, name, typeLabel, place] = parts as unknown as [string, string, string, string];
    const kind = TYPE_BY_LABEL[typeLabel.trim().toLowerCase()];
    if (!kind) continue;

    // "Boston, Pereira" / "CRA 15 bis 27-27 San Nicolas, Pereira": el municipio
    // es siempre el ultimo trozo, y lo de antes es barrio o direccion.
    const chunks = place
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    const municipality = resolveMunicipality(chunks.at(-1));
    // Fuera del area cubierta no se inventa municipio: entra sin el, como el
    // resto. Invariante 5.
    const locality = chunks.length > 1 ? chunks.slice(0, -1).join(", ") : null;

    const description = redactContact(meta(html, "og:description") ?? "");
    const text = visibleText(html);

    const categories = new Set<Category>(extractCategories(`${name} ${description}`) as Category[]);
    if (kind.category) categories.add(kind.category);

    // El estado, con dos senales y una tercera que se descarta a proposito.
    //
    // "Cerrado" en la ficha es la fuente diciendo que el sitio dejo de operar.
    //
    // El titulo tambien lo lleva —"Clinica Los Nevados — EVACUADA"— y eso no
    // puede quedar en `active`: esa misma ficha dice "Ojo: No vaya", y
    // ponerle el sello "Activo" al lado es el fallo que este proyecto existe
    // para evitar. Tampoco es `closed`: un hospital evacuado puede seguir
    // atendiendo urgencias y "parcialmente evacuada" no es un cierre.
    // `unknown` se muestra como "Sin dato", que es lo unico que sabemos.
    //
    // Lo que NO se usa como senal es "Ojo:", aunque lo traigan 9 de las 21
    // fichas. Es una advertencia, no un cierre: dos de ellas son albergues
    // abiertos que solo piden pasar antes por el CAM, y marcarlos cerrados le
    // negaria un techo a alguien. El error opuesto y peor.
    const evacuated = /\bevacuad[oa]s?\b/i.test(name);
    const status: Status = /\bCerrado\b/.test(text) ? "closed" : evacuated ? "unknown" : "active";
    const sourceUpdatedAt = parseUpdatedAt(text, now);

    const slug = html.match(/data-slug="([^"]+)"/)?.[1] ?? url;

    const record: ParsedRecord = {
      externalId: slug,
      recordUrl: url,
      recordType: kind.type,
      status,
      title: name.trim(),
      description: description || null,
      categoryCodes: [...categories],
      locality,
      // La fuente no publica direccion exacta en muchas fichas y lo dice
      // ("sin direccion exacta publicada"). Lo que hay en el titulo es barrio,
      // no direccion, asi que no se asciende a una precision que nadie dio.
      displayAddress: null,
      openingHours: null,
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      sourceUpdatedAt,
      contentHash: "",
      searchText: "",
    };

    record.searchText = buildSearchText({
      title: record.title,
      description: record.description,
      locality: record.locality,
      admin2Name: record.admin2Name,
      categoryCodes: record.categoryCodes,
    });
    record.contentHash = createHash("sha256")
      .update(
        JSON.stringify([
          record.title,
          record.description,
          record.status,
          record.admin2Code,
          record.locality,
          record.categoryCodes,
          sourceUpdatedAt?.toISOString() ?? null,
        ]),
      )
      .digest("hex");

    out.push(record);
  }

  return out;
}
