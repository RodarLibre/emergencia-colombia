import { sql } from "drizzle-orm";

import { db } from "@/db";

import { PRESUPUESTO_USD, costoUsd, type Preguntas, type ResumenDeUso } from "./costo";

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

/**
 * Suma una pregunta atendida al total del dia.
 *
 * Se llama SIEMPRE, haya o no inferencia. `recordUsage` cuenta llamadas al
 * modelo y por eso el numero parecia congelado: una pregunta repetida sale de
 * la cache, una fuera de alcance se resuelve antes de gastar nada, y sin cupo
 * se busca el texto tal cual. Ninguna de esas tocaba el contador, y son la
 * mayoria.
 *
 * Se guarda el camino y el desenlace, nunca la pregunta.
 */
export async function recordQuestion(input: {
  path: "model" | "cache" | "limited" | "fallback";
  outcome: "results" | "empty" | "out_of_scope" | "out_of_coverage";
}): Promise<void> {
  const cached = input.path === "cache" ? 1 : 0;
  const deterministic = input.path === "limited" || input.path === "fallback" ? 1 : 0;
  const outOfScope = input.outcome === "out_of_scope" ? 1 : 0;
  const outOfCoverage = input.outcome === "out_of_coverage" ? 1 : 0;
  const empty = input.outcome === "empty" ? 1 : 0;

  try {
    await db.execute(sql`
      INSERT INTO ai_usage_daily (day, questions, cached, deterministic, out_of_scope, out_of_coverage, empty)
      VALUES (${DIA_BOGOTA}, 1, ${cached}, ${deterministic}, ${outOfScope}, ${outOfCoverage}, ${empty})
      ON CONFLICT (day) DO UPDATE SET
        questions = ai_usage_daily.questions + 1,
        cached = ai_usage_daily.cached + ${cached},
        deterministic = ai_usage_daily.deterministic + ${deterministic},
        out_of_scope = ai_usage_daily.out_of_scope + ${outOfScope},
        out_of_coverage = ai_usage_daily.out_of_coverage + ${outOfCoverage},
        empty = ai_usage_daily.empty + ${empty}
    `);
  } catch {
    // Mismo silencio que arriba: medir no puede costarle la respuesta a nadie.
  }
}

type Fila = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  failures: number;
  questions: number;
  cached: number;
  deterministic: number;
  out_of_scope: number;
  out_of_coverage: number;
  empty: number;
};

export type { ResumenDeUso };

export async function usageSummary(): Promise<ResumenDeUso> {
  const uno = async (donde: ReturnType<typeof sql>): Promise<Fila> => {
    const filas = (await db.execute(sql`
      SELECT
        coalesce(sum(calls), 0)::int         AS calls,
        coalesce(sum(input_tokens), 0)::int  AS input_tokens,
        coalesce(sum(output_tokens), 0)::int AS output_tokens,
        coalesce(sum(failures), 0)::int      AS failures,
        coalesce(sum(questions), 0)::int     AS questions,
        coalesce(sum(cached), 0)::int        AS cached,
        coalesce(sum(deterministic), 0)::int AS deterministic,
        coalesce(sum(out_of_scope), 0)::int  AS out_of_scope,
        coalesce(sum(out_of_coverage), 0)::int AS out_of_coverage,
        coalesce(sum(empty), 0)::int         AS empty
      FROM ai_usage_daily ${donde}
    `)) as unknown as Fila[];
    return (
      filas[0] ?? {
        calls: 0,
        input_tokens: 0,
        output_tokens: 0,
        failures: 0,
        questions: 0,
        cached: 0,
        deterministic: 0,
        out_of_scope: 0,
        out_of_coverage: 0,
        empty: 0,
      }
    );
  };

  const [hoy, siete, total] = await Promise.all([
    uno(sql`WHERE day = ${DIA_BOGOTA}`),
    uno(sql`WHERE day > ${DIA_BOGOTA} - 7`),
    uno(sql``),
  ]);

  const preguntas = (f: Fila): Preguntas => ({
    total: f.questions,
    cached: f.cached,
    deterministic: f.deterministic,
    outOfScope: f.out_of_scope,
    outOfCoverage: f.out_of_coverage,
    empty: f.empty,
  });

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
      preguntas: preguntas(hoy),
    },
    ultimos7: {
      calls: siete.calls,
      inputTokens: siete.input_tokens,
      outputTokens: siete.output_tokens,
      usd: usdSiete,
      preguntas: preguntas(siete),
    },
    total: {
      calls: total.calls,
      inputTokens: total.input_tokens,
      outputTokens: total.output_tokens,
      usd: totalUsd,
      preguntas: preguntas(total),
    },
    usdPorDia,
    presupuestoUsd: PRESUPUESTO_USD,
    diasRestantes:
      PRESUPUESTO_USD > 0 && usdPorDia > 0
        ? Math.max(0, Math.floor((PRESUPUESTO_USD - totalUsd) / usdPorDia))
        : null,
  };
}
