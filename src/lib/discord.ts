import { construirReporte } from "./reporte";
import { usageSummary } from "./usage";

/**
 * Reporte de consumo a Discord.
 *
 * Nada de esto cambia lo que ve una persona buscando ayuda: es para quien paga
 * la cuenta. El webhook va en `DISCORD_WEBHOOK_URL`; sin él, no se envía nada
 * y tampoco falla.
 *
 * Se manda un resumen agregado: llamadas, tokens y costo. Nunca preguntas,
 * nunca usuarios. Un canal de Discord se comparte y se reenvía, así que lo que
 * salga de acá tiene que poder verlo cualquiera.
 */

/**
 * Envía el resumen. Devuelve qué pasó, para que quien lo dispare pueda
 * informarlo sin adivinar.
 */
export async function enviarReporteDeUso(): Promise<{ ok: boolean; detalle: string }> {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) return { ok: false, detalle: "DISCORD_WEBHOOK_URL no está configurado" };

  const resumen = await usageSummary();
  const sitio = process.env.SITE_URL ?? "https://emergenciacolombia.org";

  try {
    const respuesta = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(construirReporte(resumen, sitio)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok) {
      // El cuerpo de Discord no lleva el webhook; la URL sí, y por eso no se
      // registra nunca: quien la tenga puede publicar en el canal.
      return { ok: false, detalle: `Discord respondió ${respuesta.status}` };
    }
    return { ok: true, detalle: `Enviado: ${resumen.total.calls} consultas acumuladas` };
  } catch {
    return { ok: false, detalle: "No se pudo contactar a Discord" };
  }
}
