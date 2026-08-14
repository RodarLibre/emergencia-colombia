import { NextResponse, type NextRequest } from "next/server";
import { FLOOD } from "@/lib/config";
import {
  CLIENT_IP_HEADER,
  FORWARDED_FOR_HEADER,
  networkOf as truncate,
  trustedClientIp,
} from "@/lib/client-ip";

/**
 * Two jobs, both before any page renders:
 *
 * 1. Issue the signed cookie that identifies an anonymous browser.
 * 2. Shed request floods.
 *
 * Neither touches the database. Under a flood, querying Postgres to decide
 * whether to serve is exactly the wrong move — it turns the defence into part
 * of the attack.
 */

export const COOKIE_NAME = "ayuda_cid";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// --- Flood shedding -------------------------------------------------------

/**
 * Measured on the deployed box: `/salud` serves ~123 req/s, the homepage ~94,
 * and a search rendering 40 cards only ~24 — the cost is server-side
 * rendering, not the query, which runs in 6 ms. That makes the search path
 * trivially saturable by one script, so it gets a ceiling.
 *
 * Deliberately generous. The key can cover a whole shelter's wifi behind one
 * NAT, and throttling twenty people looking for water to stop one script would
 * be the wrong trade. A flood is thousands per minute, not hundreds.
 */
const MAX_REQUESTS_PER_MINUTE = FLOOD.maxRequestsPerMinute;

/** Bounded so the defence cannot itself become a memory-exhaustion vector. */
const MAX_TRACKED_KEYS = 10_000;

type Bucket = { count: number; windowStart: number };
const buckets = new Map<string, Bucket>();

/**
 * Global requests in the current minute, for load awareness.
 *
 * It lives here rather than in the app because middleware state demonstrably
 * survives the production build — the 429 shedding above proves it — while a
 * module-level counter inside the app did not: 30 rendered searches left it at
 * zero samples, and `globalThis.__ayudaLoad` was not even present in the
 * built server bundle. Next isolates route handlers and pages from each other
 * in ways that make in-app shared state unreliable.
 *
 * The signal reaches the page as a request header instead.
 */
const HIGH_LOAD_REQUESTS_PER_MINUTE = FLOOD.highLoadPerMinute;
export const LOAD_HEADER = "x-ayuda-load";

let globalWindowStart = 0;
let globalCount = 0;

function globalLoadIsHigh(now: number): boolean {
  const windowStart = Math.floor(now / 60_000) * 60_000;
  if (windowStart !== globalWindowStart) {
    globalWindowStart = windowStart;
    globalCount = 0;
  }
  globalCount += 1;
  return globalCount > HIGH_LOAD_REQUESTS_PER_MINUTE;
}

function tooManyRequests(key: string, now: number): boolean {
  const windowStart = Math.floor(now / 60_000) * 60_000;
  const bucket = buckets.get(key);

  if (!bucket || bucket.windowStart !== windowStart) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      // Drop everything from older windows rather than growing without bound.
      for (const [k, v] of buckets) if (v.windowStart !== windowStart) buckets.delete(k);
      if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear();
    }
    buckets.set(key, { count: 1, windowStart });
    return false;
  }

  bucket.count += 1;
  return bucket.count > MAX_REQUESTS_PER_MINUTE;
}

/**
 * Truncated network, not an address: /24 for IPv4, /48 for IPv6. Held in
 * memory for at most a minute and never written anywhere.
 */
function networkOf(request: NextRequest): string {
  const ip = trustedClientIp(
    request.headers.get(CLIENT_IP_HEADER),
    request.headers.get(FORWARDED_FOR_HEADER),
  );
  return truncate(ip) ?? "unknown";
}

// --- Anonymous browser cookie --------------------------------------------

async function hmac(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/**
 * Operator surfaces: ingest and the health probe. Never part of the public
 * site.
 */
const OPERATOR_ONLY = /^\/(api|salud)(\/|$)/;

export async function middleware(request: NextRequest) {
  if (OPERATOR_ONLY.test(request.nextUrl.pathname)) {
    // Arriving with CF-Connecting-IP means arriving from the internet, since
    // the origin is only reachable publicly through the tunnel. From there
    // these paths do not exist — not "forbidden", absent. 404 rather than 403
    // because 403 confirms there is something to find.
    //
    // Deliberately duplicated with the tunnel's ingress rules: one of the two
    // will eventually be edited by someone who does not know about the other,
    // and the site should not become exploitable when that happens.
    if (request.headers.get(CLIENT_IP_HEADER)) {
      return new NextResponse(null, { status: 404 });
    }

    // Internal callers — the container healthcheck, kamal-proxy, cron on the
    // box — pass straight through. They skip the limiter on purpose: a flood
    // must never make monitoring believe the app is down, and ingest carries
    // its own authentication.
    return NextResponse.next();
  }

  const now = Date.now();
  const busy = globalLoadIsHigh(now);

  if (tooManyRequests(networkOf(request), now)) {
    // 429 with Retry-After, so a well-behaved client backs off instead of
    // retrying immediately and making it worse.
    return new NextResponse("Demasiadas peticiones. Intenta de nuevo en un minuto.", {
      status: 429,
      headers: { "Retry-After": "60", "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // Passed to the page as a request header. Measured on this box: a search
  // rendering 40 cards serves ~24 req/s, so 600 per minute is pressure well
  // before people are waiting seconds.
  const requestHeaders = new Headers(request.headers);
  if (busy) requestHeaders.set(LOAD_HEADER, "high");
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const secret = process.env.RATE_LIMIT_SECRET;

  // With no secret, nothing gets signed: the limiter falls back to network
  // and global keys, which don't need a cookie.
  if (!secret) return response;

  const existing = request.cookies.get(COOKIE_NAME)?.value;
  if (existing) {
    const [id, sig] = existing.split(".");
    if (id && sig && (await hmac(id, secret)) === sig) return response;
  }

  const id = crypto.randomUUID();
  response.cookies.set({
    name: COOKIE_NAME,
    value: `${id}.${await hmac(id, secret)}`,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export const config = {
  // Everything except static assets. `/salud` and `/api/*` used to be excluded
  // here; they are matched now so they can be hidden from the internet, and
  // they still skip the limiter — see the first branch of `middleware`.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
