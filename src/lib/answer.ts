import type { ResolvedQuery } from "./intent";
import type { BroadenedSearch, SearchResult } from "./search";
import { joinInSpanish } from "./spanish";
import {
  CATEGORY_LABELS,
  RECORD_TYPE_LABELS,
  RECORD_TYPE_LABELS_PLURAL,
  type Category,
  type RecordTypeV1,
} from "./vocab";

/**
 * Composes the assistant's reply.
 *
 * Every sentence here is built by CODE from fields that exist on real records.
 * The model never sees a record and never writes a word of this, which is why
 * the assistant cannot state an address that does not exist or claim a shelter
 * has room when no source said so.
 *
 * The rule for every sentence below: if a record does not contain it, it is not
 * said. Counts are counted, names are copied, and anything uncertain is either
 * attributed to its source or left out.
 *
 * `text` is a single headline sentence now, not a paragraph — freshness moved
 * to a band on each card, provenance moved to the status strip above the
 * results, and repeating either in prose only pushed the actual headline
 * further from where a person starts reading.
 */

export type Answer = {
  /** What the assistant says. One sentence, no markup. */
  text: string;
  /** The most actionable result, if any — computed for callers that want it, not narrated in `text`. */
  highlight: SearchResult | null;
  results: SearchResult[];
  /**
   * Mismos lugares vistos por otras fuentes, traidos aunque no cumplan los
   * filtros. No se muestran como fichas: solo alimentan el aviso de "otra
   * fuente podria estar hablando del mismo lugar".
   */
  companions: SearchResult[];
  /** Warnings that must survive into the bubble. */
  notes: AnswerNote[];
};

export type AnswerNote =
  | "guessed"
  | "widened"
  | "disagreement"
  | "stale"
  | "off_topic"
  | "rate_limited"
  | "fallback"
  | "busy";

/** How complete a record is, which is also how useful it is to act on. */
function actionability(r: SearchResult): number {
  // A record its own source stopped publishing is never the one to lead with,
  // however complete it looks. It stays in the results — absence is not proof
  // it closed — but it does not get held up as the answer.
  if (r.noLongerListed) return -1;
  return (r.displayAddress ? 2 : 0) + (r.admin2Name ? 1 : 0) + (r.openingHours ? 1 : 0);
}

function describeWhere(query: ResolvedQuery): string {
  return query.admin2Name ? ` en ${query.admin2Name}` : "";
}

/**
 * Lowercase, natural-language category list: "agua", "agua y alimentos". Never
 * the database's own casing.
 *
 * The connector is a parameter because Spanish requires negative concord: after
 * "nadie publica" it is "ni", not "y". "Nadie publica atención médica y insumos
 * médicos" is wrong, and it showed on screen.
 */
function describePlainCategories(query: ResolvedQuery, connector: "y" | "ni" = "y"): string {
  const labels = query.categories
    .map((c) => CATEGORY_LABELS[c as Category])
    .filter((l): l is string => Boolean(l))
    .map((l) => l.toLowerCase());
  if (connector === "y") return joinInSpanish(labels);
  if (labels.length <= 1) return labels[0] ?? "";
  // "ni" never changes shape, so it does not go through joinInSpanish.
  return `${labels.slice(0, -1).join(", ")} ni ${labels.at(-1)}`;
}

/**
 * The one record type shared by every result, if there is one — used to pick
 * the right noun and verb. Mixed results fall back to "lugares", which is
 * true of any of them.
 */
function commonType(query: ResolvedQuery, results: readonly SearchResult[]): RecordTypeV1 | null {
  if (query.types.length === 1) return query.types[0] as RecordTypeV1;
  const types = new Set(results.map((r) => r.recordType));
  return types.size === 1 ? [...types][0]! : null;
}

/**
 * "6 lugares reciben agua en Palmira." / "3 albergues en Cali." / "1 sismo en Buga."
 *
 * "Recibe" only makes sense for a collection or service point: a seismic
 * event receives nothing, and a shelter already carries "alojamiento" in its
 * own name, so the verb drops for both instead of forcing a category onto
 * results that don't have one.
 */
function headline(query: ResolvedQuery, results: readonly SearchResult[]): string {
  const count = results.length;
  const one = count === 1;
  const type = commonType(query, results);
  const labels = one ? RECORD_TYPE_LABELS : RECORD_TYPE_LABELS_PLURAL;
  const noun = (type ? labels[type] : one ? "lugar" : "lugares").toLowerCase();
  const takesVerb = type !== "seismic_event" && type !== "shelter" && type !== "official_update";
  const categories = takesVerb ? describePlainCategories(query) : "";
  const verb = takesVerb && categories ? (one ? " recibe " : " reciben ") : "";
  const where = describeWhere(query);
  return `${count} ${noun}${verb}${categories}${where}.`;
}

export type ComposeInput = {
  question: string;
  query: ResolvedQuery;
  search: BroadenedSearch;
  offTopic: boolean;
  busy: boolean;
};

export function composeAnswer(input: ComposeInput): Answer {
  const { query, search, offTopic, busy } = input;
  const results = search.results;
  const notes: AnswerNote[] = [];

  if (busy) notes.push("busy");
  if (query.interpretedBy === "limited") notes.push("rate_limited");
  // Only claim the question wasn't understood when nothing was extracted from
  // it. Without an inference key the path is "fallback", yet the deterministic
  // reader still resolves the municipality and the categories — saying "I
  // couldn't interpret your question" under a correct answer is just wrong.
  const understoodSomething =
    query.types.length > 0 || query.categories.length > 0 || query.admin2Code !== null;
  if (query.interpretedBy === "fallback" && !understoodSomething) notes.push("fallback");
  // Solo el modelo la reconoció: se responde, pero se dice que es una lectura.
  if (query.guessed) notes.push("guessed");
  if (search.dropped.length > 0) notes.push("widened");
  if (results.some((r) => r.freshness !== "fresh")) notes.push("stale");

  if (offTopic) {
    notes.push("off_topic");
    return {
      text:
        "Eso no lo tengo. Solo busco puntos de acopio, albergues, puntos de servicio, " +
        "comunicados y sismos publicados por otros sitios.",
      highlight: null,
      results: [],
      companions: [],
      notes,
    };
  }

  if (results.length === 0) {
    const what = describePlainCategories(query, "ni") || "eso";
    return {
      text: `Nadie publica ${what}${describeWhere(query)}.`,
      highlight: null,
      results: [],
      companions: [],
      notes,
    };
  }

  const sorted = [...results].sort((a, b) => actionability(b) - actionability(a));
  const highlight = sorted[0] ?? null;

  return {
    text: headline(query, results),
    highlight,
    results,
    companions: search.companions,
    notes,
  };
}
