import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

/**
 * The single place where a provider client gets built.
 *
 * The rest of the app requests roles ("intent"), never a specific provider's
 * model id (plan 5.7). Switching providers only touches this file.
 */

export type ModelRole = "intent";

/** Global switch. With AI_ENABLED other than "on", nobody gets called. */
export function isAiEnabled(): boolean {
  return (
    process.env.AI_ENABLED === "on" &&
    Boolean(process.env.DO_GRADIENT_API_KEY) &&
    Boolean(process.env.DO_GRADIENT_BASE_URL)
  );
}

const MODEL_IDS: Record<ModelRole, string> = {
  // For extracting intent, gpt-oss-20b is enough and costs half on input and
  // two thirds on output. Left configurable in case 120b is preferred.
  intent: process.env.DO_GRADIENT_MODEL ?? "openai-gpt-oss-20b",
};

let provider: ReturnType<typeof createOpenAICompatible> | null = null;

export function modelFor(role: ModelRole) {
  if (!isAiEnabled()) {
    throw new Error("Inference is disabled");
  }
  provider ??= createOpenAICompatible({
    name: PROVIDER_NAME,
    baseURL: process.env.DO_GRADIENT_BASE_URL!,
    apiKey: process.env.DO_GRADIENT_API_KEY!,
    // Verified against the real endpoint: DigitalOcean does accept
    // response_format json_schema. Without this flag the SDK refuses to
    // send it and every intent extraction falls back.
    supportsStructuredOutputs: true,
  });
  return provider.chatModel(MODEL_IDS[role]);
}

export const PROVIDER_NAME = "digitalocean-gradient";

/**
 * Per-provider options.
 *
 * `reasoningEffort: low` is not an optimization, it's a requirement. gpt-oss
 * models reason before answering and bill those tokens as output. At medium
 * effort they spend 800+ tokens reasoning, end in finish_reason "length", and
 * never emit content. At low they answer in ~80 tokens.
 */
export const PROVIDER_OPTIONS = {
  [PROVIDER_NAME]: { reasoningEffort: "low" },
} as const;

/** Budget per call. Hard ceilings, not suggestions. */
export const AI_LIMITS = {
  /** Plan 13.4: bounded user input. */
  maxQuestionChars: 800,
  /**
   * NO se puede usar junto con salida estructurada: el proveedor responde 400
   * ("max_tokens cannot be set when response_format type is 'json_schema'").
   * Queda para llamadas sin esquema. El techo alto era porque los tokens de
   * razonamiento cuentan como salida y, si se agota el presupuesto razonando,
   * la respuesta vuelve vacía.
   */
  maxOutputTokens: 700,
  /** Measured: 3-5s per call with reasoning_effort low. */
  timeoutMs: 12_000,
  /** A single retry, as plan 13.4 asks for. */
  maxRetries: 1,
} as const;
