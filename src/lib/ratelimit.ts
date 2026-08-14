import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db";

import { recordAbuseEvent } from "./abuse";
import { networkOf, trustedClientIp } from "./client-ip";
import { QUOTA } from "./config";

/**
 * Usage limiter for calls to the model.
 *
 * Only limits INFERENCE. Deterministic search is never limited: once the
 * quota runs out, the question box falls back to plain-text search and keeps
 * responding. Nobody loses the ability to search for where to donate water
 * just because their neighbor spent the quota (plan 13.9).
 *
 * Lives in Postgres and not in Valkey, on purpose. At the provider's prices,
 * USD 140 buys ~2 million intent extractions, so the problem was never the
 * cost: it's abuse. A fixed-window counter is enough and is one fewer
 * dependency.
 *
 * Privacy: no IP is ever stored. The network key is an HMAC of the truncated
 * network (/24 for IPv4, /48 for IPv6), which groups without identifying.
 */

export type RateLimitDecision =
  { allowed: true } | { allowed: false; reason: "client" | "network" | "global" };

/** Plan 13.9. Overridable per environment — see `config.ts`. */
const LIMITS = [
  { suffix: "c1h", window: "hour" as const, max: QUOTA.perClientHour, reason: "client" as const },
  { suffix: "c1d", window: "day" as const, max: QUOTA.perClientDay, reason: "client" as const },
  { suffix: "n1h", window: "hour" as const, max: QUOTA.perNetworkHour, reason: "network" as const },
  {
    suffix: "g1m",
    window: "minute" as const,
    max: QUOTA.perGlobalMinute,
    reason: "global" as const,
  },
];

function windowStart(unit: "minute" | "hour" | "day", now: Date): Date {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  if (unit === "minute") return d;
  d.setUTCMinutes(0);
  if (unit === "hour") return d;
  d.setUTCHours(0);
  return d;
}

function keyedHash(value: string): string {
  const secret = process.env.RATE_LIMIT_SECRET ?? "sin-secreto-local";
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}

/**
 * Reduces a request's origin to a network and turns it into a keyed hash.
 * IPv4 -> /24, IPv6 -> /48. The raw IP is never stored or logged.
 *
 * Which header is trusted, and why the FIRST entry of `X-Forwarded-For` is
 * not, is in `client-ip.ts`. Reading it wrong makes this function return a
 * value the caller controls, and a quota keyed on an attacker-chosen string
 * is not a quota.
 */
export function networkKey(cfConnectingIp: string | null, forwardedFor: string | null): string {
  const network = networkOf(trustedClientIp(cfConnectingIp, forwardedFor));
  return keyedHash(network ?? "sin-ip");
}

/** Extracts the id from the signed cookie. The middleware already validated the signature. */
export function clientKey(cookieValue: string | undefined): string {
  const id = cookieValue?.split(".")[0];
  return keyedHash(id ? `cid:${id}` : "sin-cookie");
}

/**
 * Increments the counters and decides. The increment and the read happen in
 * a single atomic statement, so two simultaneous requests don't step on
 * each other.
 *
 * If the database fails, inference is DENIED (the gate doesn't open):
 * deterministic search stays available, so failing closed doesn't leave
 * anyone without service.
 */
export async function consumeAiQuota(args: {
  client: string;
  network: string;
  now?: Date;
}): Promise<RateLimitDecision> {
  const now = args.now ?? new Date();

  try {
    for (const limit of LIMITS) {
      const scope =
        limit.reason === "client"
          ? args.client
          : limit.reason === "network"
            ? args.network
            : "global";
      const key = `${limit.suffix}:${scope}`;
      const start = windowStart(limit.window, now);

      const rows = (await db.execute(sql`
        INSERT INTO ai_usage_counters (key, window_start, count)
        VALUES (${key}, ${start.toISOString()}, 1)
        ON CONFLICT (key, window_start)
          DO UPDATE SET count = ai_usage_counters.count + 1
        RETURNING count
      `)) as unknown as { count: number }[];

      const count = rows[0]?.count ?? 0;
      if (count > limit.max) {
        // Recorded so sustained hammering is visible later. Being off-topic is
        // never recorded: that is confusion, not abuse.
        void recordAbuseEvent({
          subjectKey: scope,
          subjectKind: limit.reason,
          kind: "rate_limited",
        });
        return { allowed: false, reason: limit.reason };
      }
    }
    return { allowed: true };
  } catch (err) {
    console.error("[ratelimit] counter failed, denying inference:", err);
    return { allowed: false, reason: "global" };
  }
}

/** Deletes old windows. Called from ingest, which already runs via cron. */
export async function pruneRateLimitCounters(): Promise<void> {
  await db.execute(sql`
    DELETE FROM ai_usage_counters WHERE window_start < now() - interval '2 days'
  `);
}
