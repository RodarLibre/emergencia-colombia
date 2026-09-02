import { relativeTime } from "./format";

/**
 * The line under the search box: how much catalog there is, and how old it is.
 *
 * Pure and testable for the same reason as `source-status.ts` and
 * `result-band.ts`, and this one is the most-read line on the site.
 *
 * It used to say "leídas por última vez hace 2 horas" off
 * `MAX(observations.observed_at)`, which is neither of the two things a person
 * could mean. An observation is written when a source CHANGES, so the number
 * tracked whichever source changed most recently — in practice the seismic
 * feed, which publishes a new event every few hours forever. The humanitarian
 * half of the catalogue had not moved in twenty days and the line said two
 * hours. Of the four places this project got that distinction wrong, this was
 * the only one that erred toward confidence.
 */

export type CatalogStatusInput = {
  sourceCount: number;
  recordCount: number;
  /** Last successful read of any source. Says the pipeline is alive. */
  lastReadAt: Date | null;
  /**
   * Newest change published by a source, among record types that can go
   * stale — `FRESHNESS_WINDOW_MINUTES` decides which, and it is not a new
   * judgement: a magnitude 7.4 does not need reconfirming, a shelter does.
   * Says how old the information is.
   */
  lastPerishableUpdateAt: Date | null;
};

/**
 * How old the perishable catalogue may get before the line says so.
 *
 * Twelve hours, which is `FRESHNESS_WINDOW_MINUTES` for a shelter: past it a
 * single record already shows "Sin confirmar", so the summary above them
 * should not still read as current.
 */
export const AGEING_NOTICE_MS = 12 * 60 * 60 * 1000;

export type CatalogStatusLines = {
  /** "248 avisos de 5 fuentes" */
  count: string;
  /** The second line, or null when there is nothing honest to say yet. */
  freshness: string | null;
};

export function catalogStatusLines(
  stats: CatalogStatusInput,
  now: Date = new Date(),
): CatalogStatusLines {
  const count =
    `${stats.recordCount} ${stats.recordCount === 1 ? "aviso" : "avisos"} ` +
    `de ${stats.sourceCount} ${stats.sourceCount === 1 ? "fuente" : "fuentes"}`;

  if (!stats.lastReadAt) return { count, freshness: null };

  const read = `leídas hace ${sinceWords(stats.lastReadAt, now)}`;

  // Both halves, for the same reason as the band on /fuentes: the read alone
  // hides a catalogue nobody is updating, and the age alone makes a pipeline
  // that is working look broken. Somebody deciding whether to drive needs the
  // second one, and it is the one that was missing.
  if (!stats.lastPerishableUpdateAt) return { count, freshness: read };

  const age = now.getTime() - stats.lastPerishableUpdateAt.getTime();
  if (age <= AGEING_NOTICE_MS) return { count, freshness: read };

  return {
    count,
    freshness: `${read} · nada nuevo desde hace ${sinceWords(stats.lastPerishableUpdateAt, now)}`,
  };
}

/** `relativeTime` without its "hace", so it can be placed in a sentence. */
function sinceWords(date: Date, now: Date): string {
  return relativeTime(date, now).replace(/^hace /, "");
}
