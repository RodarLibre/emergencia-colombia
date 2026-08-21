import { sql } from "drizzle-orm";

import { db } from "@/db";

import { excludeDemoSources } from "../guards";
import { feedLicense, feedPermittedUse, redistributableSlugs, REDISTRIBUTION } from "./consent";
import { toPlace, type Excluded, type FeedRow } from "./crosswalk";
import {
  ATTRIBUTION,
  CANONICAL_URL,
  PUBLISHER_ID,
  SPEC_VERSION,
  type CabuyaFeed,
} from "./protocol";

/**
 * The place feed, built from the catalog (§3).
 *
 * Two rules from the protocol shape the query and both are also ours:
 *
 * - Records are reduced to their latest observation FIRST and filtered after.
 *   Filtering first resurfaces a closed place because some older observation
 *   said "active" — the trap `search.ts` documents, arriving here unchanged.
 * - `last_updated` is never "now". §3.1 names regenerating it per request as
 *   an anti-pattern worse than having no signal at all, because it destroys
 *   the one thing that distinguishes "nothing changed" from "the pipeline
 *   died". It is the last successful read of the sources in the feed.
 */

const DEFAULT_TTL_SECONDS = 900;

export type FeedBuild = {
  feed: CabuyaFeed;
  /** What was left out and why. Not published; counted so it can be looked at. */
  excluded: Partial<Record<Excluded, number>>;
};

type StatsRow = { last_read: string | null; poll_seconds: number | null };

/**
 * Null when no source has ever been read successfully.
 *
 * The route answers 503 rather than inventing a generation time. A feed that
 * cannot say when it was built is not a feed a consumer can reason about, and
 * the honest way to say "there is nothing here yet" is to not serve one.
 */
export async function buildFeed(): Promise<FeedBuild | null> {
  const slugs = redistributableSlugs();

  // With no grant, the feed is empty rather than absent: the manifest points
  // at it, the schema still holds, and a consumer sees a publisher whose
  // sources have not authorised redistribution instead of a broken link.
  const granted =
    slugs.length > 0
      ? sql`AND s.slug IN (${sql.join(
          slugs.map((slug) => sql`${slug}`),
          sql`, `,
        )})`
      : sql``;

  const stats = (await db.execute(sql`
    SELECT
      MAX(sr.last_seen_at) AS last_read,
      MIN(s.poll_interval_seconds) AS poll_seconds
    FROM sources s
    LEFT JOIN source_records sr ON sr.source_id = s.id
    WHERE s.enabled = true
      AND ${excludeDemoSources()}
      ${granted}
  `)) as unknown as StatsRow[];

  const lastRead = stats[0]?.last_read ?? null;
  if (!lastRead) return null;

  const rows =
    slugs.length === 0
      ? []
      : ((await db.execute(sql`
          WITH latest AS (
            SELECT DISTINCT ON (o.source_record_id)
              o.source_record_id,
              o.record_type,
              o.status,
              o.title,
              o.description,
              o.category_codes,
              o.admin2_code,
              o.admin2_name,
              o.locality,
              o.display_address,
              o.opening_hours,
              o.location_precision,
              o.verification_level,
              o.source_updated_at,
              o.observed_at,
              sr.canonical_url,
              sr.contacts,
              sr.last_seen_at,
              MAX(sr.last_seen_at) OVER (PARTITION BY sr.source_id) AS source_last_read,
              s.slug AS source_slug,
              s.mode AS source_mode,
              s.trust_label,
              s.windowed_listing
            FROM observations o
            JOIN source_records sr ON sr.id = o.source_record_id
            JOIN sources s ON s.id = sr.source_id
            WHERE sr.withdrawn_at IS NULL
              AND sr.hidden_at IS NULL
              AND s.enabled = true
              AND ${excludeDemoSources()}
              ${granted}
            ORDER BY o.source_record_id, o.observed_at DESC
          )
          SELECT
            l.*,
            (
              NOT l.windowed_listing
              AND l.last_seen_at < l.source_last_read - INTERVAL '5 minutes'
            ) AS no_longer_listed
          FROM latest l
          -- A record the source withdrew is omitted, never published as
          -- withdrawn: §7.3 keeps foreign moderation verdicts out of the
          -- network, and invariant 3 already means absence never got it here.
          WHERE l.status <> 'withdrawn'
          ORDER BY l.source_record_id
        `)) as unknown as FeedRow[]);

  const places = [];
  const excluded: Partial<Record<Excluded, number>> = {};

  for (const row of rows) {
    const result = toPlace(
      row,
      CANONICAL_URL,
      REDISTRIBUTION[row.source_slug]?.confirmation?.method,
    );
    if (result.ok) places.push(result.place);
    else excluded[result.reason] = (excluded[result.reason] ?? 0) + 1;
  }

  return {
    feed: {
      last_updated: new Date(lastRead).toISOString(),
      attribution: ATTRIBUTION,
      ttl: stats[0]?.poll_seconds ?? DEFAULT_TTL_SECONDS,
      version: SPEC_VERSION,
      publisher_id: PUBLISHER_ID,
      license: feedLicense(),
      permitted_use: feedPermittedUse(),
      data: { places },
    },
    excluded,
  };
}
