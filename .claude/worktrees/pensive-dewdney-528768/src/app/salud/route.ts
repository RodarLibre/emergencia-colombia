import { sql } from "drizzle-orm";

import { db } from "@/db";
import { checkProductionDataIntegrity } from "@/lib/guards";

export const dynamic = "force-dynamic";

/** Probe for the container's healthcheck and the hosting provider's. */
export async function GET() {
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
    return Response.json({ estado: "ok", base: "ok", datos: "ok" });
  } catch {
    // No error details: the connection string is never leaked.
    return Response.json({ estado: "degradado", base: "error" }, { status: 503 });
  }
}
