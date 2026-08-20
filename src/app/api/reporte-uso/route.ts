import { enviarReporteDeUso } from "@/lib/discord";
import { purgeExpiredText } from "@/lib/feedback-retention";
import { sourcesHealth, usageSummary } from "@/lib/usage";

import { authorized } from "../ingest/auth";

export const dynamic = "force-dynamic";

/**
 * Reporte de consumo, disparado por cron.
 *
 * `GET` devuelve el resumen; `POST` además lo publica en Discord. Va bajo
 * `/api`, que el middleware oculta de internet, y pide el mismo secreto de
 * operador que la ingesta: quien pueda dispararlo puede escribir en el canal.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const [uso, fuentes] = await Promise.all([usageSummary(), sourcesHealth()]);
  return Response.json({ ...uso, fuentes });
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });

  // Retention rides this cron instead of getting its own: it already runs
  // hourly with the operator secret, and one line in the crontab is one thing
  // somebody has to know exists (docs/DEPLOY-PROXMOX.md §7).
  //
  // In its own try, so a failed purge still sends the spend report. Losing
  // cost visibility over a cleanup problem would be paying twice for one fault.
  //
  // The failure is reported rather than swallowed: "0 rows expired" and
  // "retention has not run for six weeks" look identical otherwise, and the
  // second one means consented text is outliving what the checkbox promised.
  let purged: number | null = null;
  let purgeFailed = false;
  try {
    purged = await purgeExpiredText();
  } catch {
    purgeFailed = true;
  }

  const resultado = await enviarReporteDeUso();
  return Response.json({ ...resultado, purged, purgeFailed }, { status: resultado.ok ? 200 : 502 });
}
