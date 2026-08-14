import { sql } from "drizzle-orm";

import { db } from "@/db";

import { PRESUPUESTO_USD, costoUsd, type ResumenDeUso } from "./costo";

/**
 * Cuánto se lleva gastado en inferencia.
 *
 * Existe porque el presupuesto sale de los créditos de una persona, no de una
 * empresa: "¿cuánto llevamos?" tiene que tener respuesta antes de que la
 * respuesta importe.
 *
 * Se guardan totales por día y nada por consulta — ni el texto, ni el usuario,
 * ni la hora exacta. El costo NO se guarda: se calcula al leer, porque los
 * precios cambian y un número viejo escrito en la base miente sin avisar.
 */

/** El día en Bogotá: quien paga y quien pregunta viven ahí. */
const DIA_BOGOTA = sql`(now() AT TIME ZONE 'America/Bogota')::date`;

/**
 * Suma una llamada al total del día.
 *
 * Nunca lanza: medir el gasto no puede ser el motivo de que alguien se quede
 * sin respuesta. Si la escritura falla, se pierde la medición y ya.
 */
export async function recordUsage(input: {
  inputTokens?: number;
  outputTokens?: number;
  failed?: boolean;
}): Promise<void> {
  const inTok = Math.max(0, Math.round(input.inputTokens ?? 0));
  const outTok = Math.max(0, Math.round(input.outputTokens ?? 0));
  const failed = input.failed ? 1 : 0;

  try {
    await db.execute(sql`
      INSERT INTO ai_usage_daily (day, calls, input_tokens, output_tokens, failures)
      VALUES (${DIA_BOGOTA}, 1, ${inTok}, ${outTok}, ${failed})
      ON CONFLICT (day) DO UPDATE SET
        calls = ai_usage_daily.calls + 1,
        input_tokens = ai_usage_daily.input_tokens + ${inTok},
        output_tokens = ai_usage_daily.output_tokens + ${outTok},
        failures = ai_usage_daily.failures + ${failed}
    `);
  } catch {
    // Silencio deliberado: ver el comentario de arriba.
  }
}

type Fila = { calls: number; input_tokens: number; output_tokens: number; failures: number };

export type { ResumenDeUso };

export async function usageSummary(): Promise<ResumenDeUso> {
  const uno = async (donde: ReturnType<typeof sql>): Promise<Fila> => {
    const filas = (await db.execute(sql`
      SELECT
        coalesce(sum(calls), 0)::int         AS calls,
        coalesce(sum(input_tokens), 0)::int  AS input_tokens,
        coalesce(sum(output_tokens), 0)::int AS output_tokens,
        coalesce(sum(failures), 0)::int      AS failures
      FROM ai_usage_daily ${donde}
    `)) as unknown as Fila[];
    return filas[0] ?? { calls: 0, input_tokens: 0, output_tokens: 0, failures: 0 };
  };

  const [hoy, siete, total] = await Promise.all([
    uno(sql`WHERE day = ${DIA_BOGOTA}`),
    uno(sql`WHERE day > ${DIA_BOGOTA} - 7`),
    uno(sql``),
  ]);

  const usdSiete = costoUsd(siete.input_tokens, siete.output_tokens);
  const usdPorDia = usdSiete / 7;
  const totalUsd = costoUsd(total.input_tokens, total.output_tokens);

  return {
    hoy: {
      calls: hoy.calls,
      inputTokens: hoy.input_tokens,
      outputTokens: hoy.output_tokens,
      failures: hoy.failures,
      usd: costoUsd(hoy.input_tokens, hoy.output_tokens),
    },
    ultimos7: {
      calls: siete.calls,
      inputTokens: siete.input_tokens,
      outputTokens: siete.output_tokens,
      usd: usdSiete,
    },
    total: {
      calls: total.calls,
      inputTokens: total.input_tokens,
      outputTokens: total.output_tokens,
      usd: totalUsd,
    },
    usdPorDia,
    presupuestoUsd: PRESUPUESTO_USD,
    diasRestantes:
      PRESUPUESTO_USD > 0 && usdPorDia > 0
        ? Math.max(0, Math.floor((PRESUPUESTO_USD - totalUsd) / usdPorDia))
        : null,
  };
}
