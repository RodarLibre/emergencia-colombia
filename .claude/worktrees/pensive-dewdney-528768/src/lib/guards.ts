import { sql } from "drizzle-orm";

import { db } from "@/db";

/**
 * Prefix for demo sources. Anything starting with this is made up.
 */
export const DEMO_SOURCE_PREFIX = "demo-";

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Defense in depth against serving fake data in production.
 *
 * There are two layers and both are necessary:
 *
 *  1. `excludeDemoSources()` applies inside the search query, so in
 *     production a demo record can NEVER appear in a result, even if
 *     someone enables it by hand in the database.
 *  2. This check makes the site refuse to serve and say so, instead of
 *     silently degrading to a smaller catalog.
 *
 * The seed already refuses to run with NODE_ENV=production, but that protects
 * the script, not the database: a database restored from a dev backup
 * arrives with the demo sources enabled.
 *
 * The concrete risk this prevents is a made-up shelter sending people to an
 * address that doesn't exist.
 */

type GuardResult = { ok: true } | { ok: false; demoSources: string[] };

const CACHE_TTL_MS = 60_000;
let cached: { at: number; result: GuardResult } | null = null;

export async function checkProductionDataIntegrity(): Promise<GuardResult> {
  if (!isProduction()) return { ok: true };

  // Nothing is served during `next build`, and there's no database to
  // connect to: in the Docker image the build runs without Postgres. Without
  // this early return, the build fails trying to prerender the homepage.
  // Checking here would also be pointless, because the production database
  // doesn't exist yet.
  if (process.env.NEXT_PHASE === "phase-production-build") return { ok: true };

  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const rows = (await db.execute(sql`
    SELECT slug FROM sources
    WHERE enabled = true AND slug LIKE ${`${DEMO_SOURCE_PREFIX}%`}
    ORDER BY slug
  `)) as unknown as { slug: string }[];

  const result: GuardResult =
    rows.length === 0 ? { ok: true } : { ok: false, demoSources: rows.map((r) => r.slug) };

  if (!result.ok && (!cached || cached.result.ok)) {
    // Logged, not just shown on the page: with Kamal the container ends up
    // `unhealthy` and the deploy doesn't get promoted, and without this
    // message that happens with no visible explanation.
    console.error(
      `[integridad] BLOQUEADO: fuentes de prueba habilitadas en produccion: ${result.demoSources.join(", ")}. ` +
        `Corregir con: DELETE FROM sources WHERE slug LIKE 'demo-%';`,
    );
  }

  cached = { at: Date.now(), result };
  return result;
}

/**
 * SQL fragment that excludes demo sources when running in production.
 * In development it returns `true` so nothing gets filtered.
 */
export function excludeDemoSources() {
  return isProduction() ? sql`s.slug NOT LIKE ${`${DEMO_SOURCE_PREFIX}%`}` : sql`true`;
}
