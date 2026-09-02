import { relativeTime } from "./format";

/**
 * What the band on `/fuentes` says about one source.
 *
 * Pure and in its own file so the wording can be tested without a database,
 * same reason as `scope.ts`. The styling stays in the page: this decides what
 * is true about a source, not what colour it is.
 */

/** Only the fields the wording depends on. */
export type SourceStatusInput = {
  enabled: boolean;
  /** Records currently visible. Withdrawn ones are not counted here. */
  records: number;
  /** Records the source explicitly withdrew. See invariant 3. */
  withdrawn: number;
  /**
   * The last successful read, from `MAX(source_records.last_seen_at)`.
   *
   * Not `observations.observed_at`. That one only moves when an observation is
   * created, which happens when the source CHANGED — so a source read every
   * fifteen minutes with nothing new leaves it frozen. Labelling it "Leída"
   * told people Donde Ayudo had not been read in 19 days while the cron was
   * reading it on time, every time.
   */
  lastReadAt: Date | null;
  /** When the source last published something different. */
  lastChangedAt: Date | null;
};

/**
 * How long a source may go unchanged before the band says so.
 *
 * A day. Below it, "leída hace un rato" says everything that matters and the
 * data is current. Above it, the age of the content is what a person needs in
 * order to decide whether to trust an address.
 */
export const UNCHANGED_NOTICE_MS = 24 * 60 * 60 * 1000;

export function sourceStatusLabel(source: SourceStatusInput, now: Date = new Date()): string {
  if (!source.enabled) return "No conectada todavía";

  // A source that closed is not one that never worked, and it is said before
  // anything else because it explains why there are no records below.
  //
  // No date on purpose: the only timestamp we hold is when we processed the
  // withdrawal, and shown here it reads as when the source closed, which is a
  // different fact and not ours to publish.
  if (source.withdrawn > 0 && source.records === 0) {
    return "La fuente cerró y retiró sus avisos";
  }

  if (!source.lastReadAt) return "Sin lecturas todavía";

  // Both halves, because either one alone misleads in the opposite direction:
  // the read alone hides a frozen source, and the change alone makes a source
  // that is alive and simply has no news look like it went down.
  const read = `Leída ${relativeTime(source.lastReadAt, now)}`;
  if (!source.lastChangedAt) return read;

  const unchangedFor = now.getTime() - source.lastChangedAt.getTime();
  if (unchangedFor <= UNCHANGED_NOTICE_MS) return read;

  return `${read} · sin cambios ${relativeTime(source.lastChangedAt, now)}`;
}
