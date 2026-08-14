import { createHash } from "node:crypto";

import { generateObject } from "ai";
import { z } from "zod";

import { AI_LIMITS, PROVIDER_OPTIONS, isAiEnabled, modelFor } from "./ai";
import {
  extractCategories,
  findMunicipalityInText,
  hasDomainSignal,
  resolveMunicipality,
} from "./normalize";
import { getCachedIntent, putCachedIntent } from "./intent-cache";
import { detectOutOfScope, type OutOfScopeReason } from "./scope";
import { CATEGORIES, OPERATING_MUNICIPALITIES, RECORD_TYPES_V1 } from "./vocab";

/**
 * The whole bot.
 *
 * The model does ONE thing: convert a Spanish question into a validated
 * filter object. It never sees a catalog record, so it can't invent one. The
 * response is built by deterministic search.
 *
 * Any failure (provider down, invalid JSON, timeout, budget) falls back to
 * plain-text search. The person never sees an error.
 */

const TYPE_VALUES = RECORD_TYPES_V1 as readonly [string, ...string[]];

export const SearchIntentSchema = z.object({
  tipos: z
    .array(z.enum(TYPE_VALUES))
    .max(5)
    .describe("Que clase de lugar o informacion busca. Vacio si no se deduce."),
  municipio: z
    .string()
    .nullable()
    .describe("Nombre del municipio tal como lo escribio la persona. null si no lo menciona."),
  texto: z
    .string()
    .nullable()
    .describe("Palabras clave restantes utiles para busqueda libre. null si no quedan."),
});

export type SearchIntent = z.infer<typeof SearchIntentSchema>;

/** Filters already resolved, ready for search. */
export type ResolvedQuery = {
  types: string[];
  admin2Code: string | null;
  admin2Name: string | null;
  categories: string[];
  q: string | null;
  outOfScope: boolean;
  /** Why, so the reply can route to whoever can actually answer. */
  outOfScopeReason: OutOfScopeReason | null;
  /**
   * "model"    interpreted by the model
   * "cache"    reused a previous interpretation, without calling the model
   * "limited"  usage limit reached: searched the raw text as-is
   * "fallback" the provider failed or is off: searched the raw text as-is
   */
  interpretedBy: "model" | "cache" | "limited" | "fallback";
  /**
   * El vocabulario no reconoció la pregunta y el modelo sí.
   *
   * Se responde igual, pero diciéndolo: la lista de palabras no puede seguir
   * siendo lo que niega una respuesta. Quien escribió "estoy sin casa" no
   * merece un rechazo porque a nadie se le ocurrió agregar esa frase.
   */
  guessed: boolean;
};

const SYSTEM_PROMPT = `Convertis preguntas en espanol sobre la emergencia por el terremoto en Colombia a filtros de busqueda.

Solo extraes filtros. No respondes la pregunta, no das consejos y no inventas lugares.

Municipios del area de cobertura: ${OPERATING_MUNICIPALITIES.map((m) => m.name).join(", ")}.

Reglas:
- Si la persona busca donde ENTREGAR o DONAR cosas, el tipo es collection_point.
- Si busca donde RECIBIR ayuda o servicios, el tipo es service_point.
- Si busca donde dormir o refugiarse, el tipo es shelter.
- Si pide informacion de autoridades, el tipo es official_update.
- Si menciona un peligro o alerta, el tipo es hazard.
- Si pregunta por sismos, temblores o replicas, el tipo es seismic_event.
- El texto puede tener errores de tipeo y venir sin tildes. Interpretalo igual.
- Si algo no se deduce con claridad, dejalo vacio o en null. No adivines.`;

/**
 * Prompt version, derived from its content and the vocabulary.
 *
 * Computed instead of maintained by hand so that changing a rule or adding a
 * category automatically invalidates the cache. An old interpretation paired
 * with a new vocabulary would return filters that no longer exist.
 */
const PROMPT_VERSION = createHash("sha256")
  .update(`${SYSTEM_PROMPT}|${RECORD_TYPES_V1.join(",")}|${CATEGORIES.join(",")}`)
  .digest("hex")
  .slice(0, 12);

/** Removes duplicates while preserving order. */
function dedupe<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** No-inference path: the raw text is used as free-text search. */
function fallbackQuery(question: string): ResolvedQuery {
  const trimmed = question.trim().slice(0, AI_LIMITS.maxQuestionChars);
  const fallbackReason = detectOutOfScope(trimmed);
  return {
    types: [],
    admin2Code: null,
    admin2Name: null,
    categories: [],
    q: trimmed.length > 0 ? trimmed : null,
    outOfScope: fallbackReason !== null,
    outOfScopeReason: fallbackReason,
    // Sin modelo no hay nada que interpretar: o lo reconoce el vocabulario, o
    // se busca el texto tal cual.
    guessed: false,
    interpretedBy: "fallback",
  };
}

/**
 * Guarantees the question always leaves at least one filter behind.
 *
 * With no filters at all, `searchRecords` has nothing to narrow by and returns
 * the whole catalog. Asked "cual es la capital de Francia" the model returned
 * `texto: null`, the off-topic gate dropped its guessed type, and the search
 * answered with 40 unrelated records. Falling back to the raw question means
 * the text search runs and correctly finds nothing.
 *
 * "No filters" must never mean "show everything".
 */
function withFallbackText(resolved: ResolvedQuery, question: string): ResolvedQuery {
  const hasAnyFilter =
    resolved.types.length > 0 ||
    resolved.categories.length > 0 ||
    resolved.admin2Code !== null ||
    Boolean(resolved.q);
  return hasAnyFilter ? resolved : { ...resolved, q: question };
}

export type ResolveOptions = {
  /**
   * false when the rate limiter already denied inference. The provider isn't
   * called and the raw text is searched as-is: nobody loses search just
   * because the quota ran out.
   */
  allowInference?: boolean;
};

export async function resolveQuestion(
  question: string,
  options: ResolveOptions = {},
): Promise<ResolvedQuery> {
  const trimmed = question.trim().slice(0, AI_LIMITS.maxQuestionChars);
  if (!trimmed) return fallbackQuery("");

  // Evaluated before spending a call: if it's out of scope, the answer is
  // the official channels and there's no search to run.
  const deterministicOutOfScope = detectOutOfScope(trimmed);
  if (deterministicOutOfScope) return fallbackQuery(trimmed);

  const deterministicCategories = extractCategories(trimmed);

  // El vocabulario es un atajo, no una puerta.
  //
  // Antes decidía solo él: sin señal de dominio se descartaba el tipo que
  // diera el modelo. El problema es que trata igual dos fallos distintos —el
  // modelo alucinando `hazard` para "que hora es", y el modelo entendiendo
  // bien "estoy sin casa" cuando la lista no tenía esa frase— y por eso la
  // lista no se terminaba nunca: cada palabra agregada era una que el modelo
  // ya entendía.
  //
  // Ahora reconocerlo por código es el camino rápido y seguro; que lo
  // reconozca solo el modelo también vale, pero se marca como interpretación.
  const recognizedByCode = hasDomainSignal(trimmed);

  // The cache is checked BEFORE spending quota: a repeated question doesn't
  // touch the provider, so it shouldn't consume anyone's limit either.
  const cached = isAiEnabled() ? await getCachedIntent(trimmed, PROMPT_VERSION) : null;
  if (cached) {
    const municipality = findMunicipalityInText(trimmed) ?? resolveMunicipality(cached.municipio);
    const fromCache: ResolvedQuery = {
      types: dedupe(cached.tipos),
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      categories: deterministicCategories,
      q: cached.texto?.trim() || null,
      outOfScope: false,
      outOfScopeReason: null,
      guessed: !recognizedByCode && cached.tipos.length > 0,
      interpretedBy: "cache",
    };
    return withFallbackText(fromCache, trimmed);
  }

  if (!isAiEnabled() || options.allowInference === false) {
    const municipality = findMunicipalityInText(trimmed);
    return {
      ...fallbackQuery(trimmed),
      categories: deterministicCategories,
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      interpretedBy: options.allowInference === false ? "limited" : "fallback",
    };
  }

  try {
    const { object } = await generateObject({
      model: modelFor("intent"),
      schema: SearchIntentSchema,
      system: SYSTEM_PROMPT,
      prompt: trimmed,
      temperature: 0,
      // Sin límite de tokens a propósito: el proveedor rechaza la petición
      // entera si se combina un tope con salida estructurada —"max_tokens
      // cannot be set when response_format type is 'json_schema'"— y ese 400
      // lo tragaba el catch, así que toda pregunta caía al camino
      // determinista y parecía que la llave no servía. Quien acota el gasto
      // es `reasoning_effort: low`: medido, 48 tokens de salida por consulta.
      maxRetries: AI_LIMITS.maxRetries,
      abortSignal: AbortSignal.timeout(AI_LIMITS.timeoutMs),
      providerOptions: PROVIDER_OPTIONS,
    });

    await putCachedIntent(trimmed, PROMPT_VERSION, {
      tipos: object.tipos,
      municipio: object.municipio,
      texto: object.texto,
    });

    // The model emits a municipality NAME; the DANE code is resolved on this
    // side. That way it can't invent an identifier.
    //
    // If the model didn't return a municipality, it's looked up in the
    // question. Measured: the model skips the municipality ~1 in 8 times even
    // when it's written verbatim in the text. Reading it with code costs
    // nothing and can't invent one.
    // What the person wrote wins over what the model reports. Measured: asked
    // "donde recibo donaciones en Buga", the model answered "Bugalagrande" — a
    // real municipality 40 km away. Resolving names rather than codes stops the
    // model inventing an identifier, but not inventing a name that happens to
    // exist. Reading the question first does.
    const municipality = findMunicipalityInText(trimmed) ?? resolveMunicipality(object.municipio);

    const fromModel: ResolvedQuery = {
      // With reasoning_effort low the model repeats items ("water","water",...).
      // Deduplicated here instead of trusting it not to.
      types: dedupe(object.tipos),
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
      // Categories are fully deterministic. The model was asked for them at
      // first and produced junk: "hubo replicas anoche" came back as
      // shelter + hygiene + communications, which then filtered out every
      // seismic event, so the question returned nothing. A keyword table does
      // not do that.
      categories: deterministicCategories,
      q: object.texto?.trim() || null,
      // Deterministic, nothing else. See the note about false positives.
      outOfScope: deterministicOutOfScope !== null,
      outOfScopeReason: deterministicOutOfScope,
      guessed: !recognizedByCode && object.tipos.length > 0,
      interpretedBy: "model",
    };
    return withFallbackText(fromModel, trimmed);
  } catch {
    // Neither the question text nor the provider error is logged: it could
    // contain names, phone numbers, or health data (plan 14.5).
    //
    // Same deterministic resolution as the "AI disabled" branch above: a
    // provider failure must degrade to that quality, not below it. Without
    // this, a transient timeout silently drops the municipality filter even
    // though it's sitting right there in the text.
    const municipality = findMunicipalityInText(trimmed);
    return {
      ...fallbackQuery(trimmed),
      categories: deterministicCategories,
      admin2Code: municipality?.code ?? null,
      admin2Name: municipality?.name ?? null,
    };
  }
}

export type { OutOfScopeReason };
