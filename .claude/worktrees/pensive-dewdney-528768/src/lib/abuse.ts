import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * Abuse recording and blocking.
 *
 * Deliberately identity-free. Everything here keys on the same HMAC the rate
 * limiter uses — of a random cookie id, or of a network truncated to /24 or
 * /48. That is enough to recognise a repeat offender and block them, which is
 * the entire operational need. Knowing whose address it is adds nothing here,
 * and would turn this into a controller of personal data.
 *
 * Two rules that matter more than the storage:
 *
 * 1. **Being off-topic is not abuse.** Someone asking the time is confused,
 *    not attacking. Only sustained hammering is recorded.
 * 2. **A block denies inference, never search.** A network key can cover a
 *    whole shelter's wifi. Taking away their ability to find water because one
 *    person hammered the box would be worse than the abuse.
 */

export type AbuseKind = "rate_limited" | "blocked_attempt";
export type SubjectKind = "client" | "network" | "global";

/** Records a signal. Best-effort: never fails the request that triggered it. */
export async function recordAbuseEvent(args: {
  subjectKey: string;
  subjectKind: SubjectKind;
  kind: AbuseKind;
}): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO abuse_events (subject_key, subject_kind, kind)
      VALUES (${args.subjectKey}, ${args.subjectKind}, ${args.kind})
    `);
  } catch (err) {
    console.error("[abuse] could not record event:", err);
  }
}

/**
 * True when this subject is currently blocked from inference.
 *
 * Fails OPEN, unlike the rate limiter. A database problem should not
 * accidentally block people; the rate limiter is still there to bound usage.
 */
export async function isBlocked(subjectKeys: readonly string[]): Promise<boolean> {
  if (subjectKeys.length === 0) return false;
  try {
    const list = sql.join(
      subjectKeys.map((k) => sql`${k}`),
      sql`, `,
    );
    const rows = (await db.execute(sql`
      SELECT 1 FROM blocked_subjects
      WHERE subject_key IN (${list}) AND expires_at > now()
      LIMIT 1
    `)) as unknown as unknown[];
    return rows.length > 0;
  } catch (err) {
    console.error("[abuse] could not read the block list, allowing:", err);
    return false;
  }
}

/**
 * Aggregate view for deciding whether anyone needs blocking.
 *
 * Returns keys, never addresses. To block one, pass its key to
 * `blockSubject` — you never need to know who it belongs to.
 */
export async function topOffenders(sinceHours = 24, limit = 20) {
  return (await db.execute(sql`
    SELECT
      subject_key,
      subject_kind,
      count(*)::int          AS events,
      min(created_at)        AS first_seen,
      max(created_at)        AS last_seen
    FROM abuse_events
    WHERE created_at > now() - (${sinceHours} || ' hours')::interval
    GROUP BY subject_key, subject_kind
    ORDER BY events DESC
    LIMIT ${limit}
  `)) as unknown as {
    subject_key: string;
    subject_kind: string;
    events: number;
    first_seen: string;
    last_seen: string;
  }[];
}

/**
 * Aggregate usage, for telling the community how the site is being used.
 *
 * Counts only. No keys, no questions — this is the shape of a number you can
 * put in a message, not a report about people.
 */
export async function usageSummary(sinceHours = 24) {
  const [row] = (await db.execute(sql`
    SELECT
      (SELECT count(*)::int FROM abuse_events
        WHERE kind = 'rate_limited'
          AND created_at > now() - (${sinceHours} || ' hours')::interval) AS rate_limited,
      (SELECT count(DISTINCT subject_key)::int FROM abuse_events
        WHERE created_at > now() - (${sinceHours} || ' hours')::interval) AS distinct_subjects,
      (SELECT count(*)::int FROM blocked_subjects WHERE expires_at > now())  AS active_blocks,
      (SELECT coalesce(sum(hits), 0)::int FROM ai_intent_cache)              AS cache_hits
  `)) as unknown as {
    rate_limited: number;
    distinct_subjects: number;
    active_blocks: number;
    cache_hits: number;
  }[];
  return row;
}

/** Blocks a subject for a bounded time. Blocks always expire. */
export async function blockSubject(args: {
  subjectKey: string;
  subjectKind: SubjectKind;
  reason: string;
  hours?: number;
}): Promise<void> {
  const hours = args.hours ?? 24;
  await db.execute(sql`
    INSERT INTO blocked_subjects (subject_key, subject_kind, reason, expires_at)
    VALUES (${args.subjectKey}, ${args.subjectKind}, ${args.reason},
            now() + (${hours} || ' hours')::interval)
    ON CONFLICT (subject_key) DO UPDATE
      SET reason = EXCLUDED.reason,
          blocked_at = now(),
          expires_at = EXCLUDED.expires_at
  `);
}

/** Old signals are not kept: they answer "is this happening now". */
export async function pruneAbuseEvents(): Promise<void> {
  await db.execute(sql`
    DELETE FROM abuse_events WHERE created_at < now() - interval '30 days'
  `);
  await db.execute(sql`
    DELETE FROM blocked_subjects WHERE expires_at < now() - interval '7 days'
  `);
}
