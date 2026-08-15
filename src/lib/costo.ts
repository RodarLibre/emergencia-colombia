import { positiveNumberFromEnv } from "./config";

/**
 * Precios y aritmetica del gasto, sin tocar la base de datos.
 *
 * Separado de `usage.ts` para que se pueda probar sin Postgres: el calculo del
 * costo es justo lo que hay que poder verificar sin levantar nada.
 */

/**
 * Precios por millón de tokens, en dólares.
 *
 * Configurables porque el proveedor los cambia y nadie se entera hasta que
 * llega la factura. Los valores por defecto son los de `openai-gpt-oss-20b`
 * en DigitalOcean Gradient al 2026-08; verificar en el panel antes de confiar
 * en una cifra.
 *
 * TODO: hoy hay un solo motor de inferencia y un solo par de precios, porque
 * hay un solo proveedor. Cuando entre otro —o un segundo modelo con precio
 * distinto en el mismo proveedor— esto tiene que pasar a ser una tabla por
 * modelo y `ai_usage_daily` necesita una columna `model`. Mientras haya uno
 * solo, agregar esa estructura es complejidad sin beneficio: el dia que se
 * agregue el segundo, el cambio es una migracion y un GROUP BY.
 */
export const PRECIOS = {
  entradaPorMillon: positiveNumberFromEnv("AI_PRICE_INPUT_USD_PER_MILLION", 0.05),
  salidaPorMillon: positiveNumberFromEnv("AI_PRICE_OUTPUT_USD_PER_MILLION", 0.2),
} as const;

/** Techo de gasto declarado, para poder avisar antes de rozarlo. */
export const PRESUPUESTO_USD = positiveNumberFromEnv("AI_BUDGET_USD", 0);

export function costoUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * PRECIOS.entradaPorMillon +
    (outputTokens / 1_000_000) * PRECIOS.salidaPorMillon
  );
}

/**
 * Preguntas atendidas, separadas por camino y desenlace.
 *
 * `calls` cuenta inferencia. Esto cuenta gente. Son numeros muy distintos: el
 * bot responde muchisimo sin llamar al modelo, y mirar solo `calls` daba la
 * impresion de que nadie estaba usando el sitio.
 */
export type Preguntas = {
  total: number;
  /** Reusaron una interpretacion anterior. No gastaron tokens. */
  cached: number;
  /** Resueltas sin modelo: sin cupo, sin proveedor, o el sitio saturado. */
  deterministic: number;
  outOfScope: number;
  outOfCoverage: number;
  /** Se busco y no habia nada: es lo que dice que falta cubrir. */
  empty: number;
};

export type ResumenDeUso = {
  hoy: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    failures: number;
    usd: number;
    preguntas: Preguntas;
  };
  ultimos7: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    usd: number;
    preguntas: Preguntas;
  };
  total: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    usd: number;
    preguntas: Preguntas;
  };
  /** Media de los últimos 7 días, para proyectar. */
  usdPorDia: number;
  presupuestoUsd: number;
  /** Días que aguanta el presupuesto al ritmo actual, null si no hay techo. */
  diasRestantes: number | null;
};
