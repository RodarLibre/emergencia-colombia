import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db";

import { fold } from "./normalize";

/**
 * Cache of a question's INTERPRETATION. Never of the results.
 *
 * "Donde llevo agua en Cali" is going to be written by many people, and
 * translating that to filters always gives the same thing. Catalog records
 * are queried fresh on every request: what's reused is how the question was
 * understood, not what it was answered with.
 *
 * The question is NEVER stored: the key is an HMAC of the normalized text. A
 * question could contain a name, an address, or health data, so storing it
 * would be storing personal data without need.
 */

/**
 * No `categorias`: those are derived deterministically from the question on
 * every request, so caching them would only preserve a past mistake.
 */
export type CachedIntent = {
  tipos: string[];
  municipio: string | null;
  texto: string | null;
};

function questionHash(question: string, promptVersion: string): string {
  const secret = process.env.RATE_LIMIT_SECRET ?? "sin-secreto-local";
  return createHmac("sha256", secret)
    .update(`${promptVersion}|${fold(question).replace(/\s+/g, " ")}`)
    .digest("hex");
}

export async function getCachedIntent(
  question: string,
  promptVersion: string,
): Promise<CachedIntent | null> {
  try {
    const rows = (await db.execute(sql`
      UPDATE ai_intent_cache
         SET hits = hits + 1
       WHERE question_hash = ${questionHash(question, promptVersion)}
         AND prompt_version = ${promptVersion}
         AND created_at > now() - interval '7 days'
      RETURNING intent
    `)) as unknown as { intent: CachedIntent }[];
    return rows[0]?.intent ?? null;
  } catch {
    // A down cache can't break a search: it just proceeds without one.
    return null;
  }
}

export async function putCachedIntent(
  question: string,
  promptVersion: string,
  intent: CachedIntent,
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO ai_intent_cache (question_hash, prompt_version, intent)
      VALUES (${questionHash(question, promptVersion)}, ${promptVersion}, ${JSON.stringify(intent)}::jsonb)
      ON CONFLICT (question_hash) DO UPDATE
        SET intent = EXCLUDED.intent,
            prompt_version = EXCLUDED.prompt_version,
            created_at = now()
    `);
  } catch {
    // Same idea: caching is an optimization, not a requirement.
  }
}

/** Cleans up old entries. Called from ingest, which already runs via cron. */
export async function pruneIntentCache(): Promise<void> {
  await db.execute(sql`
    DELETE FROM ai_intent_cache WHERE created_at < now() - interval '14 days'
  `);
}
