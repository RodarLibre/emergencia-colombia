/**
 * Cali Ayuda adapter (https://cali-ayuda-kappa.vercel.app).
 *
 * Mode: public_html, a temporary bridge while a feed is arranged with the
 * site's owner. The site doesn't publish robots.txt, and the /reports page
 * comes server-rendered, so there's no need to run JavaScript or touch any
 * internal endpoint.
 *
 * DELIBERATELY NARROWED SCOPE
 *
 * The page carries three kinds of report: "Necesidad", "Oferta" and "Punto de
 * ayuda". Only the POINTS are ingested. Needs and offers are from individuals
 * and many carry a phone number and first name; copying those to another
 * site is processing personal data that requires a legal basis and an
 * agreement with the source. For those, this project links to the original
 * and doesn't duplicate them.
 *
 * Besides the type filter, any phone number that shows up gets redacted, in
 * case the source's format changes and a point starts carrying contact info.
 */
import { createHash } from "node:crypto";

import {
  buildSearchText,
  findMunicipalityInText,
  resolveMunicipality,
  sanitizeText,
} from "@/lib/normalize";
import type { Category, RecordTypeV1 } from "@/lib/vocab";

import { ParserError, USER_AGENT, redactContact, type ParsedRecord } from "../types";

export const CALI_AYUDA_SOURCE = {
  slug: "cali-ayuda",
  name: "Cali Ayuda",
  baseUrl: "https://cali-ayuda-kappa.vercel.app",
  mode: "public_html",
  trustLabel: "community",
  pollIntervalSeconds: 900,
  // The source declares it covers "Cali and nearby municipalities". Registered
  // at the department level, which is the granularity it actually claims.
  coverageAdmin1Code: "76",
  contactNote:
    "Sin robots.txt. Pendiente contactar al dueno para acordar un feed. Solo se leen puntos de ayuda; necesidades y ofertas individuales quedan excluidas por datos personales.",
} as const;

const LIST_URL = `${CALI_AYUDA_SOURCE.baseUrl}/reports`;

/** Type labels exactly as the page displays them. */
const TYPE_LABELS = {
  "Punto de ayuda": "service_point",
  Necesidad: null, // excluido: datos personales
  Oferta: null, // excluido: datos personales
} as const satisfies Record<string, RecordTypeV1 | null>;

/** Source categories -> our own vocabulary. */
const CATEGORY_MAP: Record<string, Category> = {
  Agua: "water",
  Alimentos: "food",
  Medicamentos: "medical_supplies",
  Transporte: "transport",
  Albergue: "shelter",
  "Asistencia médica": "medical_assistance",
  Herramientas: "rescue_equipment",
  Rescate: "rescue_equipment",
  Ropa: "clothing",
  Higiene: "hygiene",
  Comunicaciones: "communications",
  Voluntarios: "volunteers",
  Donaciones: "cash_or_donation",
  Información: "information",
  Otro: "other",
};

/** "hace 1h" / "hace 30m" / "hace 2d" -> approximate date. */
function parseRelativeTime(raw: string, now: Date): Date | null {
  const m = /hace\s+(\d+)\s*([mhd])/i.exec(raw);
  if (!m) return null;
  const n = Number.parseInt(m[1]!, 10);
  const unit = m[2]!.toLowerCase();
  const minutes = unit === "m" ? n : unit === "h" ? n * 60 : n * 1440;
  return new Date(now.getTime() - minutes * 60_000);
}

function firstMatch(segment: string, re: RegExp): string | null {
  const m = re.exec(segment);
  return m?.[1] ?? null;
}

/**
 * Extracts records from the server-rendered payload.
 *
 * Anchored on the `/reports/<uuid>` route and the visible Spanish labels, not
 * on Tailwind classes: classes change on every redeploy, the route and the
 * labels don't.
 */
export function parseReports(html: string, now: Date = new Date()): ParsedRecord[] {
  const idRe = /\\?"href\\?":\\?"\/reports\/([0-9a-f-]{36})\\?"/g;
  const anchors: { id: string; index: number }[] = [];
  for (let m = idRe.exec(html); m !== null; m = idRe.exec(html)) {
    anchors.push({ id: m[1]!, index: m.index });
  }

  if (anchors.length === 0) {
    throw new ParserError(
      "No se encontro ningun enlace /reports/<uuid>. La pagina cambio de estructura o dejo de renderizar en el servidor.",
    );
  }

  const out: ParsedRecord[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < anchors.length; i += 1) {
    const { id, index } = anchors[i]!;
    if (seen.has(id)) continue;
    seen.add(id);

    const end = anchors[i + 1]?.index ?? Math.min(index + 4000, html.length);
    const segment = html.slice(index, end);

    // Type: only points get in.
    const typeLabel = Object.keys(TYPE_LABELS).find((label) => segment.includes(label));
    if (!typeLabel) continue;
    const recordType = TYPE_LABELS[typeLabel as keyof typeof TYPE_LABELS];
    if (recordType === null) continue;

    const rawTitle = firstMatch(segment, /\\?"h3\\?",null,\{[^}]*?\\?"children\\?":\\?"(.*?)\\?"/);
    if (!rawTitle) continue;

    const rawDescription = firstMatch(
      segment,
      /text-muted-foreground\\?",\\?"children\\?":\\?"(.*?)\\?"\}/,
    );

    const locality = firstMatch(segment, /📍 \\?",\\?"(.*?)\\?"/);
    const relative = firstMatch(segment, /\\?"children\\?":\\?"(hace [^"\\]+)\\?"/);

    const categoryLabel = Object.keys(CATEGORY_MAP).find((label) =>
      segment.includes(`\\"children\\":\\"${label}\\"`),
    );

    const title = redactContact(sanitizeText(unescapeJson(rawTitle), 200));
    const description = rawDescription
      ? redactContact(sanitizeText(unescapeJson(rawDescription), 1000))
      : null;
    if (!title) continue;

    // The source gives Cali neighborhoods, not municipalities.
    // resolveMunicipality is conservative and returns null for an ambiguous
    // name, so a neighborhood like "Granada" doesn't mistakenly turn into the
    // Granada municipality (Meta).
    // 1) the neighborhood might actually be a municipality ("Palmira");
    // 2) if not, the text might name one ("...con Versalles Norte del Valle").
    // If neither works it stays null: it's not assumed that everything is
    // Cali, because it isn't. The municipality filter still includes them, marked.
    const municipality =
      resolveMunicipality(locality) ?? findMunicipalityInText(`${title} ${description ?? ""}`);
    const categoryCodes = categoryLabel ? [CATEGORY_MAP[categoryLabel]!] : [];
    const cleanLocality = locality ? sanitizeText(unescapeJson(locality), 120) : null;

    // The resolved municipality feeds into the hash: it's part of the
    // normalized content, so improving geo resolution generates a new
    // observation instead of staying invisible as "unchanged".
    const payload = {
      id,
      title,
      description,
      categoryCodes,
      locality: cleanLocality,
      admin2Code: municipality?.code ?? null,
    };

    out.push({
      externalId: id,
      recordUrl: `${CALI_AYUDA_SOURCE.baseUrl}/reports/${id}`,
      recordType,
      // The source doesn't publish a closed status in the listing.
      status: "unknown",
      title,
      description,
      categoryCodes,
      locality: cleanLocality,
      // This source doesn't publish an address or hours in the listing.
      displayAddress: null,
      openingHours: null,
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      sourceUpdatedAt: relative ? parseRelativeTime(relative, now) : null,
      contentHash: `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
      searchText: buildSearchText({
        title,
        description,
        locality: cleanLocality,
        admin2Name: municipality?.name ?? null,
        categoryCodes,
      }),
    });
  }

  return out;
}

/** The payload comes with JSON escapes embedded inside the HTML. */
function unescapeJson(raw: string): string {
  return raw
    .replace(/\\\\n/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\\\\"/g, '"')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

export async function fetchReports(signal?: AbortSignal): Promise<string> {
  const res = await fetch(LIST_URL, {
    headers: {
      // Identify ourselves and leave a way to be contacted. Don't pretend to be a browser.
      "User-Agent": USER_AGENT,
      Accept: "text/html",
    },
    signal: signal ?? AbortSignal.timeout(20_000),
    redirect: "follow",
  });

  if (!res.ok) {
    throw new ParserError(`${LIST_URL} respondio ${res.status}`);
  }
  const type = res.headers.get("content-type") ?? "";
  if (!type.includes("text/html")) {
    throw new ParserError(`Se esperaba HTML y llego ${type}`);
  }
  return res.text();
}
