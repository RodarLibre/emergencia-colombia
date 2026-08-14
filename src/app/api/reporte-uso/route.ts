import { enviarReporteDeUso } from "@/lib/discord";
import { usageSummary } from "@/lib/usage";

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
  return Response.json(await usageSummary());
}

export async function POST(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });
  const resultado = await enviarReporteDeUso();
  return Response.json(resultado, { status: resultado.ok ? 200 : 502 });
}
