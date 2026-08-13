import type { ResolvedQuery } from "./intent";
import { relativeTime } from "./format";
import type { BroadenedSearch, SearchResult } from "./search";
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
 */

export type Answer = {
  /** What the assistant says. Plain sentences, no markup. */
  text: string;
  /** Shown under the reply, so a person can act without reading everything. */
  highlight: SearchResult | null;
  results: SearchResult[];
  /** Warnings that must survive into the bubble. */
  notes: AnswerNote[];
};

export type AnswerNote =
  "widened" | "disagreement" | "stale" | "off_topic" | "rate_limited" | "fallback" | "busy";

function pluralize(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** How complete a record is, which is also how useful it is to act on. */
function actionability(r: SearchResult): number {
  return (r.displayAddress ? 2 : 0) + (r.admin2Name ? 1 : 0) + (r.openingHours ? 1 : 0);
}

function describeWhat(
  query: ResolvedQuery,
  results: readonly SearchResult[],
  plural: boolean,
): string {
  const labels = plural ? RECORD_TYPE_LABELS_PLURAL : RECORD_TYPE_LABELS;

  if (query.types.length === 1) {
    const label = labels[query.types[0] as RecordTypeV1];
    if (label) return label.toLowerCase();
  }

  const types = new Set(results.map((r) => r.recordType));
  if (types.size === 1) {
    const only = [...types][0];
    const label = only ? labels[only] : undefined;
    if (label) return label.toLowerCase();
  }

  return plural ? "lugares y publicaciones" : "lugar o publicación";
}

function describeWhere(query: ResolvedQuery): string {
  return query.admin2Name ? ` en ${query.admin2Name}` : "";
}

function describeCategories(query: ResolvedQuery): string {
  const labels = query.categories
    .map((c) => CATEGORY_LABELS[c as Category])
    .filter((l): l is string => Boolean(l))
    .map((l) => l.toLowerCase());
  if (labels.length === 0) return "";
  if (labels.length === 1) return ` con ${labels[0]}`;
  return ` con ${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

/** "Acopio X, en Calle 14 #16-29, abierto de 6am a 4pm." Only stated fields. */
function describeHighlight(r: SearchResult): string {
  const parts = [r.title];
  if (r.displayAddress) parts.push(`en ${r.displayAddress}`);
  const place = r.locality ?? r.admin2Name;
  if (place && !r.displayAddress) parts.push(`en ${place}`);
  if (r.openingHours) parts.push(`abierto ${r.openingHours}`);
  return parts.join(", ");
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
  if (search.dropped.length > 0) notes.push("widened");

  if (offTopic) {
    notes.push("off_topic");
    return {
      text:
        "Esta pregunta no parece ser sobre la emergencia. Solo puedo buscar lo que otros " +
        "sitios publican sobre el terremoto: puntos de acopio, albergues, puntos de servicio, " +
        "comunicados oficiales y sismos.",
      highlight: null,
      results: [],
      notes,
    };
  }

  if (results.length === 0) {
    return {
      text:
        "No encontré nada que coincida. Eso no significa que no exista ayuda: significa que " +
        "ninguna de las fuentes conectadas lo publica en este momento. Podés revisar la lista " +
        "de fuentes para ir directo a cada sitio.",
      highlight: null,
      results: [],
      notes,
    };
  }

  const sorted = [...results].sort((a, b) => actionability(b) - actionability(a));
  const highlight = sorted[0] ?? null;

  const count = results.length;
  const what = describeWhat(query, results, count !== 1);
  const where = describeWhere(query);
  const categories = describeCategories(query);

  const sentences: string[] = [];

  sentences.push(`Encontré ${count} ${what}${where}${categories}.`);

  if (highlight && actionability(highlight) >= 2) {
    sentences.push(`${describeHighlight(highlight)}.`);
  }

  // Freshness is stated, never implied. "Recently confirmed" is a claim about
  // the source's timestamp, not about the place being open.
  const newest = results.reduce<Date | null>((max, r) => {
    const t = r.sourceUpdatedAt ?? r.observedAt;
    return !max || t > max ? t : max;
  }, null);
  if (newest) {
    sentences.push(`La actualización más reciente es de ${relativeTime(newest)}.`);
  }

  const stale = results.filter((r) => r.freshness !== "fresh").length;
  if (stale > 0) {
    notes.push("stale");
    sentences.push(
      `${stale} ${pluralize(stale, "no fue reconfirmado", "no fueron reconfirmados")} ` +
        `recientemente, así que conviene confirmar antes de ir.`,
    );
  }

  return { text: sentences.join(" "), highlight, results, notes };
}
