import { timingSafeEqual } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { checkProductionDataIntegrity } from "@/lib/guards";
import { probeInference } from "@/lib/probe";

export const dynamic = "force-dynamic";

/**
 * Probe for the container's healthcheck and the hosting provider's.
 *
 * `GET /salud` is what the container calls, and it stays cheap and public:
 * database, integrity, nothing else.
 *
 * `GET /salud?inferencia=1` additionally spends one real call on the provider
 * to prove inference works. It is opt-in for three reasons: it costs a call
 * and therefore money, a dead provider must never mark the container unhealthy
 * (the site is fully usable without it — invariant 9), and the inference
 * verdict never changes the status code.
 *
 * Because it costs money per request, it is authenticated with the same
 * operator secret as ingest:
 *
 *   curl -H "Authorization: Bearer $INGEST_SECRET" \
 *     "http://host/salud?inferencia=1"
 *
 * Left open it would be a way for anyone to burn the provider budget in a
 * loop, which is exactly the abuse the rate limiter exists to prevent.
 */

function authorized(request: Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== expected.length) return false;

  // Constant-time comparison: avoids leaking the secret through latency.
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}

export async function GET(request: Request) {
  const wantsInference = new URL(request.url).searchParams.has("inferencia");

  try {
    await db.execute(sql`SELECT 1`);
    const integrity = await checkProductionDataIntegrity();
    if (!integrity.ok) {
      // 503 on purpose: monitoring has to see it, not just the page.
      return Response.json(
        { estado: "bloqueado", base: "ok", motivo: "datos de prueba habilitados en produccion" },
        { status: 503 },
      );
    }

    // Load is deliberately not reported here: Next isolates route handlers
    // from pages, so this endpoint sees a counter that never records anything.
    const body: Record<string, unknown> = { estado: "ok", base: "ok", datos: "ok" };

    if (wantsInference) {
      body.inferencia = authorized(request)
        ? await probeInference()
        : // Not 401: the health check itself succeeded, and answering 401 here
          // would make an unauthenticated probe look like the site is down.
          { ok: null, estado: "no_autorizado", detalle: "requiere Bearer INGEST_SECRET" };
    }

    return Response.json(body);
  } catch {
    // No error details: the connection string is never leaked.
    return Response.json({ estado: "degradado", base: "error" }, { status: 503 });
  }
}
