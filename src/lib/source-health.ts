/**
 * Whether each connected source is still being read.
 *
 * `mapa-emergencia` stopped updating on 15 August and nobody noticed for four
 * days. Nothing was broken in a way anybody could see: the ingest was
 * quarantining itself correctly, the answer to every question still came back,
 * and the records simply stopped being reconfirmed. A source dies quietly.
 *
 * No imports, so the rule can be tested without a database — same reason as
 * `scope.ts`.
 */

/** What the database knows about one source's last successful read. */
export type SourceReading = {
  slug: string;
  name: string;
  lastReadAt: Date | null;
  /** How often the ingest is supposed to run for this source. */
  pollIntervalSeconds: number;
};

export type SourceStatus = {
  slug: string;
  name: string;
  /** null when the source has never been read at all. */
  hoursAgo: number | null;
  stale: boolean;
};

/**
 * Missed runs tolerated before a source counts as stale.
 *
 * Three, not one: a single failed fetch is normal — the other end restarts, a
 * request times out — and an alert that cries at every blip gets muted, which
 * is how four days of silence happen in the first place.
 */
export const MISSED_RUNS_TOLERATED = 3;

/**
 * Floor under the tolerance, in minutes.
 *
 * A source polled every two minutes would otherwise be declared dead six
 * minutes after a hiccup. What matters is that somebody notices the same day,
 * not the same minute.
 */
export const STALE_FLOOR_MINUTES = 30;

function staleAfterMs(pollIntervalSeconds: number): number {
  return Math.max(pollIntervalSeconds * MISSED_RUNS_TOLERATED * 1000, STALE_FLOOR_MINUTES * 60_000);
}

export function classifySources(readings: readonly SourceReading[], now: Date): SourceStatus[] {
  return readings.map((r) => {
    // Never read is stale by definition: a source that was enabled and never
    // produced anything is the loudest possible version of this problem.
    if (!r.lastReadAt) return { slug: r.slug, name: r.name, hoursAgo: null, stale: true };

    const elapsed = now.getTime() - r.lastReadAt.getTime();
    return {
      slug: r.slug,
      name: r.name,
      hoursAgo: elapsed / 3_600_000,
      stale: elapsed > staleAfterMs(r.pollIntervalSeconds),
    };
  });
}

export function staleSources(statuses: readonly SourceStatus[]): SourceStatus[] {
  return statuses.filter((s) => s.stale);
}
