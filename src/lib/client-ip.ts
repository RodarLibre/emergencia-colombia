/**
 * Working out who is asking, when everything in between can lie.
 *
 * `X-Forwarded-For` is a list that grows left to right, and the leftmost entry
 * is whatever the CLIENT sent. Cloudflare appends the real address rather than
 * replacing the header, so a request carrying `X-Forwarded-For: 9.9.9.9`
 * arrives as `9.9.9.9, <real address>`. Reading `split(",")[0]` therefore reads
 * a value the attacker chose, which turns the quota and the flood shedding into
 * suggestions: send a different fake first entry each time and neither limit
 * ever triggers.
 *
 * Two rules, in order:
 *
 * 1. `CF-Connecting-IP` wins. Cloudflare overwrites it on every request, and
 *    behind the tunnel the origin is not reachable except through cloudflared,
 *    so nothing else can set it.
 * 2. Otherwise the LAST entry of `X-Forwarded-For` — the one appended by the
 *    nearest proxy we actually run — not the first.
 *
 * No address returned by this module is ever stored. Callers reduce it to a
 * network and hash it; see `networkKey`.
 *
 * Edge-safe: string handling only, no Node built-ins. The middleware runs in
 * the Edge runtime.
 */

export const CLIENT_IP_HEADER = "cf-connecting-ip";
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

export function trustedClientIp(
  cfConnectingIp: string | null | undefined,
  xForwardedFor: string | null | undefined,
): string {
  const direct = cfConnectingIp?.trim();
  if (direct) return direct;

  const chain = (xForwardedFor ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return chain.at(-1) ?? "";
}

/**
 * Reduces an address to its network: /24 for IPv4, /48 for IPv6.
 *
 * Grouping without identifying. A household or a café shares a bucket, which
 * is the intent — the limit is about a source of traffic, not about a person.
 */
export function networkOf(ip: string): string | null {
  if (!ip) return null;
  if (ip.includes(":")) return ip.split(":").slice(0, 3).join(":");
  return ip.split(".").slice(0, 3).join(".");
}
