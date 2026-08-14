/**
 * Operational values that may need changing without a rebuild.
 *
 * During an emergency the traffic is whatever it is, and the moment to raise a
 * limit is while the spike is happening — not after a Docker build, a push and
 * a redeploy. Everything here has a working default, so an unset variable is
 * never an outage; setting one is an override.
 *
 * Only knobs belong here. Anything that changes what the site *means* — the
 * vocabulary, the invariants, whether a source is trusted — stays in code,
 * where it goes through review.
 *
 * Every read below is a STATIC `process.env.NAME`, never `process.env[name]`.
 * The middleware runs in the Edge runtime, where Next inlines statically
 * analysable reads at build time and dynamic lookups come back undefined. A
 * helper that took the variable's name would have compiled fine, passed
 * review, and silently ignored every override in the one layer that sees
 * every request.
 */

/**
 * Validates a positive integer coming from the environment.
 *
 * A malformed value falls back to the default instead of throwing: this is
 * read on the request path, and a typo in an env var must not take the site
 * down mid-emergency. It is reported so it does not pass unnoticed.
 */
function positiveInt(raw: string | undefined, name: string, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.warn(`[config] ${name}="${raw}" no es un entero positivo; uso ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Lee un numero positivo del entorno. Igual que `positiveInt` pero admite
 * decimales, para precios.
 */
export function positiveNumberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.warn(`[config] ${name}="${raw}" no es un numero valido; uso ${fallback}`);
    return fallback;
  }
  return parsed;
}

/**
 * Inference quota. Limits the MODEL only — deterministic search is never
 * limited, so running out costs interpretation, never the ability to search.
 */
export const QUOTA = {
  perClientHour: positiveInt(process.env.QUOTA_CLIENT_HOUR, "QUOTA_CLIENT_HOUR", 10),
  perClientDay: positiveInt(process.env.QUOTA_CLIENT_DAY, "QUOTA_CLIENT_DAY", 30),
  perNetworkHour: positiveInt(process.env.QUOTA_NETWORK_HOUR, "QUOTA_NETWORK_HOUR", 60),
  perGlobalMinute: positiveInt(process.env.QUOTA_GLOBAL_MINUTE, "QUOTA_GLOBAL_MINUTE", 20),
} as const;

/**
 * Flood shedding in the middleware, which is the only layer that sees every
 * request. These are about surviving a burst, not about fairness.
 */
export const FLOOD = {
  /** Requests per minute per truncated network before shedding with 429. */
  maxRequestsPerMinute: positiveInt(
    process.env.FLOOD_NETWORK_PER_MINUTE,
    "FLOOD_NETWORK_PER_MINUTE",
    120,
  ),
  /** Above this total per minute the site announces it is under load. */
  highLoadPerMinute: positiveInt(
    process.env.FLOOD_HIGH_LOAD_PER_MINUTE,
    "FLOOD_HIGH_LOAD_PER_MINUTE",
    600,
  ),
} as const;
