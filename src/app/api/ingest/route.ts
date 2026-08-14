import { ADAPTER_SLUGS, isAdapterSlug, runAdapter } from "@/ingest/registry";
import { ParserError } from "@/ingest/types";

import { authorized } from "./auth";
import { QuarantineError } from "@/ingest/upsert";

export const dynamic = "force-dynamic";
/** One source per call, to avoid running into execution time limits. */
export const maxDuration = 60;

/**
 * Ingest triggered by cron.
 *
 * Exists so scheduling ingest doesn't depend on the platform: a container
 * can use the CLI, but a host or Vercel cron can only do HTTP. One source
 * per call.
 *
 *   curl -X POST https://sitio/api/ingest?fuente=donde-ayudo-valle \
 *     -H "Authorization: Bearer $INGEST_SECRET"
 *
 * Without `INGEST_SECRET` configured, the route responds 503: an
 * unauthenticated ingest is never exposed, not even by accident.
 */

export async function POST(request: Request) {
  if (!process.env.INGEST_SECRET) {
    return Response.json(
      { error: "INGEST_SECRET is not configured; this route is disabled" },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const slug = new URL(request.url).searchParams.get("fuente") ?? "";
  if (!isAdapterSlug(slug)) {
    return Response.json({ error: "unknown source", disponibles: ADAPTER_SLUGS }, { status: 400 });
  }

  try {
    const result = await runAdapter(slug);
    return Response.json({ fuente: slug, ...result });
  } catch (err) {
    // Quarantine isn't a server error: the source responded, but with far
    // fewer records than expected, and nothing got written.
    if (err instanceof QuarantineError) {
      return Response.json(
        { fuente: slug, estado: "cuarentena", motivo: err.message },
        { status: 409 },
      );
    }
    if (err instanceof ParserError) {
      return Response.json(
        { fuente: slug, estado: "parser", motivo: err.message },
        { status: 502 },
      );
    }
    // No internal details go out.
    console.error(`[ingest] unexpected failure on ${slug}:`, err);
    return Response.json({ fuente: slug, estado: "error" }, { status: 500 });
  }
}
