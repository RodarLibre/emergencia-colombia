import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sources } from "@/db/schema";

import { CALI_AYUDA_SOURCE, fetchReports, parseReports } from "./adapters/cali-ayuda";
import { DONDE_AYUDO_SOURCE, fetchDataChunk, parseDondeAyudo } from "./adapters/donde-ayudo";
import { PEREIRA_AYUDA_SOURCE, fetchPereiraAyuda, parsePereiraAyuda } from "./adapters/pereira-ayuda";
import { SGC_SOURCE, fetchSgcFeed, parseSgcFeed } from "./adapters/sgc";
import { pruneAbuseEvents } from "@/lib/abuse";
import { pruneIntentCache } from "@/lib/intent-cache";
import { pruneRateLimitCounters } from "@/lib/ratelimit";

import { ParserError, type ParsedRecord } from "./types";
import { assertNoCountCollapse, ensureSource, upsertRecords, type IngestResult } from "./upsert";
import { MAPA_EMERGENCIA_SOURCE, fetchMapaEmergencia, parseFeed } from "./adapters/mapa-emergencia";

/**
 * Adapter registry, shared by the CLI and the cron route.
 *
 * Exists so scheduling ingest doesn't depend on the platform: a container
 * uses the CLI, and where there are no long-running processes (Vercel) the
 * HTTP route is used. The logic is the same in both cases.
 */
export const ADAPTERS = {
  "cali-ayuda": {
    config: CALI_AYUDA_SOURCE,
    fixture: "fixtures/cali-ayuda-reports.html",
    fetch: fetchReports,
    parse: parseReports,
    // Community reports: the source doesn't claim to have verified them.
    verificationLevel: "community_unverified",
  },
  "mapa-emergencia": {
    config: MAPA_EMERGENCIA_SOURCE,
    fixture: "fixtures/mapa-emergencia-publico.json",
    fetch: fetchMapaEmergencia,
    parse: parseFeed,
    // Feed acordado con la fuente, pero los puntos los reporta la comunidad y
    // el feed no trae sello de entidad en ninguno (`verificado_por` vacio en
    // los 790). La atribucion es a la fuente, no una verificacion.
    verificationLevel: "community_unverified",
  },
  "donde-ayudo-valle": {
    config: DONDE_AYUDO_SOURCE,
    fixture: "fixtures/donde-ayudo-chunk.js",
    fetch: fetchDataChunk,
    parse: parseDondeAyudo,
    // The source marks some points as verified by a volunteer. The fact of
    // the verification is kept, not the name of who did it.
    verificationLevel: "source_verified",
  },
  "pereira-ayuda": {
    config: PEREIRA_AYUDA_SOURCE,
    fixture: "fixtures/pereira-ayuda-fichas.json",
    fetch: fetchPereiraAyuda,
    parse: parsePereiraAyuda,
    // La fuente marca cada ficha como comprobada o no, y va a los sitios. La
    // atribucion es a ella; nosotros no verificamos nada.
    verificationLevel: "source_verified",
  },
  "sgc-sismos": {
    config: SGC_SOURCE,
    fixture: "fixtures/sgc-five-days.json",
    fetch: fetchSgcFeed,
    parse: parseSgcFeed,
    // The national seismological network. Official for the fields it publishes,
    // and nothing more: the SGC does not verify collection points.
    verificationLevel: "official",
  },
} as const;

export type AdapterSlug = keyof typeof ADAPTERS;

export function isAdapterSlug(value: string): value is AdapterSlug {
  return value in ADAPTERS;
}

export const ADAPTER_SLUGS = Object.keys(ADAPTERS) as AdapterSlug[];

export type RunOptions = {
  /** Reads the local fixture instead of the source. Development only. */
  html?: string;
  /** Skips the count-drop guard. Only with human review. */
  force?: boolean;
};

/**
 * Runs an adapter end to end. Never deletes or hides records: if something
 * fails, the only consequence is that there are no new observations.
 */
export async function runAdapter(
  slug: AdapterSlug,
  options: RunOptions = {},
): Promise<IngestResult & { enabled: boolean }> {
  const adapter = ADAPTERS[slug];
  const sourceId = await ensureSource(adapter.config);

  const raw = options.html ?? (await adapter.fetch());
  const records: ParsedRecord[] = adapter.parse(raw, new Date());

  if (records.length === 0) {
    // Zero records isn't a silent success: it's the typical sign that the
    // source changed structure.
    throw new ParserError(
      "The parser extracted no records. Check whether the source changed before running again.",
    );
  }

  if (!options.force) await assertNoCountCollapse(sourceId, records.length);

  const result = await upsertRecords(sourceId, records, adapter.verificationLevel);

  // Housekeeping rides along with ingest, which is the only thing that already
  // runs on a schedule. Best-effort: neither table is load-bearing, and a
  // failed cleanup must never fail an ingest that already wrote observations.
  await Promise.allSettled([pruneRateLimitCounters(), pruneIntentCache(), pruneAbuseEvents()]);
  const state = await db.query.sources.findFirst({ where: eq(sources.id, sourceId) });

  return { ...result, enabled: Boolean(state?.enabled) };
}
