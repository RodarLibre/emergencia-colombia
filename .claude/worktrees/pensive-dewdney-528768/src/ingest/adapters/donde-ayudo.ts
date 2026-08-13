/**
 * Donde Ayudo Valle adapter (https://donde-ayudo-valle.vercel.app).
 *
 * Mode: public_html. The site doesn't publish robots.txt and is an SPA that
 * makes NO API calls at all: collection points come embedded in a static
 * JavaScript chunk served by the CDN. Reading it doesn't hit any database or
 * spend any of its backend's quota, which is why this route is preferred
 * over any endpoint.
 *
 * CHUNK DISCOVERY
 *
 * The filename carries a content hash and changes on every deploy, so it
 * can't be pinned. The chain is:
 *
 *   GET /                     -> <script src="/assets/index-XXXX.js">
 *   GET that bundle           -> list of "assets/*.js" it imports
 *   GET each candidate        -> the first one containing the data is used
 *
 * If the site changes bundlers, discovery fails explicitly instead of
 * silently returning zero records.
 *
 * DATA THAT ISN'T COPIED
 *
 * Every point carries `contactos` (whatsapp, phone, instagram) and sometimes
 * `verificadoPor` with the NAME of the volunteer who verified it. Neither is
 * ingested: contacts are looked up at the source, and of the verification
 * only the fact is kept, not the identity of who did it.
 */
import { createHash } from "node:crypto";

import { buildSearchText, resolveMunicipality, sanitizeText } from "@/lib/normalize";
import type { Category } from "@/lib/vocab";

import { ParserError, USER_AGENT, redactContact, type ParsedRecord } from "../types";

export const DONDE_AYUDO_SOURCE = {
  slug: "donde-ayudo-valle",
  name: "Donde Ayudo Valle",
  baseUrl: "https://donde-ayudo-valle.vercel.app",
  mode: "public_html",
  trustLabel: "community",
  pollIntervalSeconds: 1800,
  coverageAdmin1Code: "76",
  contactNote:
    "Sin robots.txt. Datos embebidos en un chunk estatico, sin API. Pendiente contactar al dueno para acordar un feed. No se copian contactos ni nombres de verificadores.",
} as const;

/** Source categories -> our own vocabulary. */
const CATEGORY_MAP: Record<string, Category> = {
  agua: "water",
  alimentos: "food",
  salud: "medical_supplies",
  aseo: "hygiene",
  limpieza: "hygiene",
  bebes: "baby_supplies",
  construccion: "construction_materials",
  ropa: "clothing",
  otros: "other",
};

/** Marker that identifies the chunk carrying the data. */
const DATA_MARKER = 'municipioSlug:"';

type MunicipalityEntry = { slug: string; nombre: string };

// --- Discovery -------------------------------------------------------------

async function get(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new ParserError(`${url} respondio ${res.status}`);
  return res.text();
}

export async function fetchDataChunk(): Promise<string> {
  const html = await get(`${DONDE_AYUDO_SOURCE.baseUrl}/`);

  const entry = /<script[^>]+src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  if (!entry) {
    throw new ParserError(
      "No se encontro el bundle de entrada en el HTML. El sitio cambio de estructura.",
    );
  }

  const entryCode = await get(`${DONDE_AYUDO_SOURCE.baseUrl}${entry}`);
  if (entryCode.includes(DATA_MARKER)) return entryCode;

  const candidates = [
    ...new Set(
      [...entryCode.matchAll(/["']([^"']*assets\/[A-Za-z0-9_.-]+\.js)["']/g)].map((m) => m[1]!),
    ),
  ];
  if (candidates.length === 0) {
    throw new ParserError(
      "El bundle de entrada no referencia ningun chunk. Cambio el empaquetador.",
    );
  }

  for (const rel of candidates) {
    const url = rel.startsWith("/")
      ? `${DONDE_AYUDO_SOURCE.baseUrl}${rel}`
      : `${DONDE_AYUDO_SOURCE.baseUrl}/${rel}`;
    const code = await get(url);
    if (code.includes(DATA_MARKER)) return code;
  }

  throw new ParserError(
    `Ninguno de los ${candidates.length} chunks contiene los datos. La fuente cambio de formato.`,
  );
}

// --- Parsing ---------------------------------------------------------------

/** Cuts out the balanced `{...}` object that contains the given position. */
function objectAround(code: string, position: number): string | null {
  let start = -1;
  let depth = 0;
  for (let i = position; i >= 0; i -= 1) {
    const ch = code[i];
    if (ch === "}") depth += 1;
    else if (ch === "{") {
      if (depth === 0) {
        start = i;
        break;
      }
      depth -= 1;
    }
  }
  if (start === -1) return null;

  depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
}

function field(obj: string, name: string): string | null {
  return new RegExp(`\\b${name}:"((?:[^"\\\\]|\\\\.)*)"`).exec(obj)?.[1] ?? null;
}

/**
 * Resolves categories from the `necesita` field.
 *
 * The source shares the needs array across points in the same municipality
 * and references it by variable (`necesita:a`, `necesita:[...a,{}]`), so
 * those references have to be resolved. Only categories are read: each
 * need's free-text description is kept separately.
 */
function buildNeedIndex(code: string): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const m of code.matchAll(/([A-Za-z$_][\w$]*)=\[\{categoria:/g)) {
    const name = m[1]!;
    const arr = arrayAt(code, m.index + m[0].length - "{categoria:".length - 1);
    if (arr)
      index.set(
        name,
        [...arr.matchAll(/categoria:"([^"]+)"/g)].map((c) => c[1]!),
      );
  }
  return index;
}

function arrayAt(code: string, openBracketSearchFrom: number): string | null {
  const start = code.lastIndexOf("[", openBracketSearchFrom + 1);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) return code.slice(start, i + 1);
    }
  }
  return null;
}

function needCategoriesFor(obj: string, needIndex: Map<string, string[]>): Category[] {
  const raw = /\bnecesita:(\[[\s\S]*?\]|[A-Za-z$_][\w$]*)/.exec(obj)?.[1];
  if (!raw) return [];

  const found = new Set<string>();

  // Categories written literally inside the object.
  for (const m of raw.matchAll(/categoria:"([^"]+)"/g)) found.add(m[1]!);
  // Referenced variables, with or without spread.
  for (const m of raw.matchAll(/(?:\.\.\.)?\b([A-Za-z$_][\w$]*)\b/g)) {
    const list = needIndex.get(m[1]!);
    if (list) for (const c of list) found.add(c);
  }

  const out = new Set<Category>();
  for (const c of found) {
    const mapped = CATEGORY_MAP[c];
    if (mapped) out.add(mapped);
  }
  return [...out];
}

/**
 * "Buga (Guadalajara de Buga)" -> municipality Guadalajara de Buga
 * "Rozo (Palmira)"             -> municipality Palmira, locality Rozo
 */
function splitMunicipalityLabel(label: string): { municipality: string; locality: string | null } {
  const m = /^(.+?)\s*\((.+?)\)\s*$/.exec(label);
  if (!m) return { municipality: label, locality: null };
  const outside = m[1]!.trim();
  const inside = m[2]!.trim();
  // If the parenthesis names the real municipality, what's outside it is the locality.
  if (resolveMunicipality(inside)) {
    return {
      municipality: inside,
      locality: resolveMunicipality(outside) ? null : outside,
    };
  }
  return { municipality: outside, locality: inside };
}

export function parseDondeAyudo(code: string): ParsedRecord[] {
  const municipalities = new Map<string, MunicipalityEntry>();
  for (const m of code.matchAll(/\{slug:"([^"]+)",nombre:"([^"]+)"\}/g)) {
    municipalities.set(m[1]!, { slug: m[1]!, nombre: m[2]! });
  }
  if (municipalities.size === 0) {
    throw new ParserError("No se encontro el registro de municipios en el chunk.");
  }

  const needIndex = buildNeedIndex(code);
  const out: ParsedRecord[] = [];
  const seen = new Set<string>();

  for (const m of code.matchAll(/municipioSlug:"/g)) {
    const obj = objectAround(code, m.index);
    if (!obj) continue;

    const id = field(obj, "id");
    const nombre = field(obj, "nombre");
    const municipioSlug = field(obj, "municipioSlug");
    if (!id || !nombre || !municipioSlug || seen.has(id)) continue;
    seen.add(id);

    // `activo:!1` is minified false. An inactive point is kept as closed,
    // not discarded: the source having closed it is information.
    const isActive = !/\bactivo:!1\b/.test(obj);

    const label = municipalities.get(municipioSlug)?.nombre ?? municipioSlug;
    const { municipality: munName, locality: labelLocality } = splitMunicipalityLabel(label);
    const municipality = resolveMunicipality(munName);

    const barrio = field(obj, "barrio");
    const locality = barrio ?? labelLocality;
    const direccion = field(obj, "direccion");
    const horario = field(obj, "horario");
    const actualizado = field(obj, "actualizado");

    const title = redactContact(sanitizeText(nombre, 200));
    if (!title) continue;

    const categoryCodes = needCategoriesFor(obj, needIndex);
    const address = direccion ? redactContact(sanitizeText(direccion, 240)) : null;
    const hours = horario && horario !== "Sin horario definido" ? sanitizeText(horario, 120) : null;

    const payload = {
      id,
      title,
      address,
      hours,
      categoryCodes,
      locality,
      admin2Code: municipality?.code ?? null,
      isActive,
      actualizado,
    };

    out.push({
      externalId: id,
      // The source doesn't publish a URL per point; the municipality listing
      // is the most specific stable link that exists.
      recordUrl: `${DONDE_AYUDO_SOURCE.baseUrl}/municipio/${municipioSlug}`,
      recordType: "collection_point",
      status: isActive ? "active" : "closed",
      title,
      description: null,
      categoryCodes,
      locality: locality ? sanitizeText(locality, 120) : null,
      displayAddress: address,
      openingHours: hours,
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      // Real ISO date published by the source, not an approximation.
      sourceUpdatedAt: actualizado ? new Date(actualizado) : null,
      contentHash: `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
      searchText: buildSearchText({
        title,
        description: [address, hours].filter(Boolean).join(" "),
        locality,
        admin2Name: municipality?.name ?? null,
        categoryCodes,
      }),
    });
  }

  return out;
}
