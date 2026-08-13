/**
 * Servicio Geológico Colombiano — seismic events.
 *
 * Mode: official_api. The SGC publishes static, versioned GeoJSON feeds on
 * `archive.sgc.gov.co`, which is the intended path for reuse: reading a
 * CDN-served file costs them nothing, unlike polling an application endpoint.
 * No robots.txt is published and no restriction is declared.
 *
 * SCOPE
 *
 * Colombia only, and only events from the incident date onward. Both are
 * requirements, not optimizations: this catalog exists to answer questions
 * about one earthquake, and a magnitude 5.5 off the coast of El Salvador is
 * noise here even though the SGC republishes it.
 *
 * RELEVANCE: `felt` BEATS MAGNITUDE
 *
 * The feed carries 200 Colombian events since 2026-08-10, and 178 of them are
 * magnitude 2.x that nobody noticed. Ingesting all of them would more than
 * double a catalog of 94 humanitarian records with events no one will ask
 * about.
 *
 * `felt` — how many people reported feeling it — is a far better filter than
 * magnitude, because it measures what people actually experienced. Measured on
 * the real feed: only 7 of 200 events were felt by anyone, and the cut includes
 * a magnitude 2.8 that 124 people reported while excluding 178 stronger-looking
 * events at 0 reports.
 *
 * The magnitude floor is a safety net, not the primary filter: reports
 * accumulate over time, so an event that just happened can be strong and still
 * show `felt: 0`. Without it, a magnitude 6 three minutes old would be dropped.
 */
import { createHash } from "node:crypto";

import { buildSearchText, resolveMunicipality, sanitizeText } from "@/lib/normalize";
import type { Category } from "@/lib/vocab";

import { ParserError, USER_AGENT, type ParsedRecord } from "../types";

export const SGC_SOURCE = {
  slug: "sgc-sismos",
  name: "Servicio Geológico Colombiano",
  baseUrl: "https://sgc.gov.co",
  mode: "official_api",
  trustLabel: "official",
  pollIntervalSeconds: 600,
  contactNote:
    "Static versioned GeoJSON feed on archive.sgc.gov.co. No robots.txt, no declared restriction. Official national seismological network.",
} as const;

/**
 * Five-day window at magnitude 2.0+, which is the SGC's own Colombian
 * seismicity feed. The window slides, but observations are immutable and
 * records are never deleted on absence, so history accumulates from the first
 * run instead of disappearing after five days.
 */
const FEED_URL = "https://archive.sgc.gov.co/feed/v1.0.1/summary/five_days_2.json";

/** Incident date. Nothing before the earthquake that started this belongs here. */
export const INCIDENT_START = "2026-08-10";

/** An event is relevant if people felt it, OR if it is large enough to matter. */
export const MIN_FELT_REPORTS = 1;
export const MIN_MAGNITUDE = 4.0;

/** A nearby town only locates the epicentre if it is actually nearby. */
const MAX_TOWN_DISTANCE_KM = 40;

type SgcProperties = {
  place?: string | null;
  localTime?: string | null;
  utcTime?: string | null;
  updated?: string | null;
  mag?: number | null;
  magType?: string | null;
  status?: string | null;
  felt?: number | null;
  mmi?: number | null;
  agency?: string | null;
  closerTowns?: string | null;
};

type SgcFeature = {
  id?: string;
  /** NOTE: [latitude, longitude, depthKm] — not the GeoJSON [lon, lat] order. */
  geometry?: { coordinates?: number[] } | null;
  properties?: SgcProperties | null;
};

/** "2026-08-10 12:34" is not ISO. Treated as UTC, which is what `utcTime` is. */
function parseUtc(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.trim().replace(" ", "T");
  const withSeconds = /T\d{2}:\d{2}$/.test(normalized) ? `${normalized}:00` : normalized;
  const date = new Date(`${withSeconds}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "San José Del Palmar (Chocó) a 12 km, El Cairo (Valle Del Cauca) a 27 km"
 * Returns them in the order published, which is nearest first.
 */
export function parseCloserTowns(raw: string | null | undefined) {
  if (!raw) return [];
  return [...raw.matchAll(/([^,(]+?)\s*\(([^)]+)\)\s*a\s*(\d+(?:\.\d+)?)\s*km/g)].map((m) => ({
    town: m[1]!.trim(),
    department: m[2]!.trim(),
    distanceKm: Number.parseFloat(m[3]!),
  }));
}

function describeDepth(depthKm: number | undefined): string {
  if (depthKm === undefined || Number.isNaN(depthKm)) return "profundidad no reportada";
  if (depthKm < 30) return `profundidad superficial (${Math.round(depthKm)} km)`;
  return `profundidad ${Math.round(depthKm)} km`;
}

export function parseSgcFeed(
  raw: string,
  // Unused: every timestamp comes from the feed itself. The parameter exists
  // because the adapter registry calls every parser with the same signature.
  now: Date = new Date(),
  options: { incidentStart?: string } = {},
): ParsedRecord[] {
  void now;

  let parsed: { features?: SgcFeature[] };
  try {
    parsed = JSON.parse(raw) as { features?: SgcFeature[] };
  } catch {
    throw new ParserError("The SGC feed is not valid JSON. The endpoint changed or returned HTML.");
  }

  const features = parsed.features;
  if (!Array.isArray(features) || features.length === 0) {
    throw new ParserError("The SGC feed carries no features. The endpoint or its format changed.");
  }

  const incidentStart = options.incidentStart ?? INCIDENT_START;
  const out: ParsedRecord[] = [];
  const seen = new Set<string>();

  for (const feature of features) {
    const p = feature.properties;
    const id = feature.id;
    if (!p || !id || seen.has(id)) continue;

    // Colombia only. The SGC republishes significant events from other
    // agencies, and `place` is the field that states the country.
    const place = (p.place ?? "").trim();
    if (!place.toLowerCase().includes("colombia")) continue;

    const occurredAt = parseUtc(p.utcTime) ?? parseUtc(p.localTime);
    if (!occurredAt) continue;
    if (occurredAt < new Date(`${incidentStart}T00:00:00Z`)) continue;

    const magnitude = typeof p.mag === "number" ? p.mag : null;
    const felt = typeof p.felt === "number" ? p.felt : 0;
    const relevant = felt >= MIN_FELT_REPORTS || (magnitude !== null && magnitude >= MIN_MAGNITUDE);
    if (!relevant) continue;

    seen.add(id);

    const towns = parseCloserTowns(p.closerTowns);
    const nearest = towns[0];
    // Only the nearest town locates the epicentre, and only if it is close
    // enough. An event 681 km from the nearest town is not "in" it.
    const municipality =
      nearest && nearest.distanceKm <= MAX_TOWN_DISTANCE_KM
        ? resolveMunicipality(nearest.town)
        : null;

    const depthKm = feature.geometry?.coordinates?.[2];
    const magnitudeLabel =
      magnitude !== null ? `M${magnitude.toFixed(1)}` : "magnitud no reportada";
    const title = sanitizeText(`Sismo ${magnitudeLabel} — ${place}`, 200);

    const descriptionParts = [
      `${p.localTime ?? "hora no reportada"} hora local.`,
      `${describeDepth(depthKm)}.`,
      felt > 0
        ? `${felt.toLocaleString("es-CO")} personas reportaron haberlo sentido.`
        : "Sin reportes de personas que lo hayan sentido.",
      // The SGC revises events: "automatic" is a preliminary solution, "manual"
      // has been reviewed by an analyst. Stating which one is provenance.
      p.status === "manual"
        ? "Revisado por un analista del SGC."
        : "Solución preliminar automática, sujeta a revisión.",
      towns.length > 0
        ? `Municipios cercanos: ${towns.map((t) => `${t.town} (${t.department}) a ${t.distanceKm} km`).join(", ")}.`
        : "",
    ].filter(Boolean);

    const description = sanitizeText(descriptionParts.join(" "), 1000);
    const categoryCodes: Category[] = ["information"];

    // `updated` is in the hash on purpose: the SGC refines magnitude and depth
    // for hours after an event, and each revision should produce a new
    // observation so the history shows how the estimate changed.
    const payload = { id, magnitude, felt, status: p.status, updated: p.updated, place };

    out.push({
      externalId: id,
      recordUrl: `${SGC_SOURCE.baseUrl}/detallesismo/${id}`,
      recordType: "seismic_event",
      // An earthquake happened. It is not a state that opens and closes.
      status: "active",
      title,
      description,
      categoryCodes,
      locality: null,
      // An epicentre is not a street address, and there is nothing to visit.
      displayAddress: null,
      openingHours: null,
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      sourceUpdatedAt: parseUtc(p.updated) ?? occurredAt,
      contentHash: `sha256:${createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
      searchText: buildSearchText({
        title,
        description,
        locality: null,
        admin2Name: municipality?.name ?? null,
        categoryCodes,
      }),
    });
  }

  return out;
}

export async function fetchSgcFeed(signal?: AbortSignal): Promise<string> {
  const res = await fetch(FEED_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(20_000),
    redirect: "follow",
  });
  if (!res.ok) throw new ParserError(`${FEED_URL} responded ${res.status}`);
  return res.text();
}
