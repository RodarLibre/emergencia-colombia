import { fold } from "./normalize";
import type { SearchResult } from "./search";

/**
 * Cheap "possibly the same place" hint, computed in memory over the results
 * already on screen.
 *
 * This is NOT the plan's deduplication engine and doesn't try to be: there's
 * no candidate table, no configurable thresholds, no moderation queue. It
 * never merges anything or picks a winner. It only flags "another source
 * might be talking about this same thing" so the person can compare and decide.
 *
 * Preferred over showing nothing, because the dangerous case is one source
 * saying "open" and another "closed" and the person only seeing one.
 */

/**
 * Function words and generic domain terms are dropped. "norte", "sur",
 * "centro" and similar are NOT dropped: they're exactly what distinguishes
 * one place from another in the same municipality.
 */
const STOPWORDS = new Set([
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "y",
  "en",
  "por",
  "para",
  "con",
  "sin",
  "como",
  "que",
  "una",
  "uno",
  "este",
  "esta",
  "esto",
  "son",
  "hay",
  "ya",
  "mas",
  "pero",
  "punto",
  "puntos",
  "acopio",
  "acopios",
  "albergue",
  "albergues",
  "recibe",
  "reciben",
  "reportado",
  "zona",
  "sector",
  "temporal",
]);

function tokens(text: string): Set<string> {
  return new Set(
    fold(text)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

function sharedCount(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared += 1;
  return shared;
}

/**
 * Overlap coefficient: shared / size of the smaller set.
 *
 * Preferred over Jaccard because sources title things with different levels
 * of detail. For "Albergue Palmira norte - sin cupo" against "Albergue
 * Palmira norte - reportado como cerrado", Jaccard gives 0.33 and would
 * separate them, even though it's evidently the same place; overlap gives 0.67.
 */
function overlap(a: Set<string>, b: Set<string>): number {
  const min = Math.min(a.size, b.size);
  if (min === 0) return 0;
  return sharedCount(a, b) / min;
}

/**
 * Thresholds.
 *
 * The costs are asymmetric: one extra hint only adds noise the person
 * dismisses by reading, while one missing hint can make someone see "no
 * spots left" and never see the "closed" report. Showing it is preferred.
 * None of this merges records or picks a winner.
 */
const OVERLAP_THRESHOLD = 0.5;
const MIN_SHARED_TOKENS = 2;

/**
 * La dirección, reducida a lo que la identifica.
 *
 * Dos fuentes escriben la misma esquina de formas distintas —"Calle 9 con
 * Carrera 44", "calle 9 con cra 44"— así que se comparan sin tildes, sin
 * puntuación, sin espacios y con las abreviaturas de vía unificadas.
 */
const ABREVIATURAS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcra\b|\bcr\b|\bkra\b|\bkr\b/g, "carrera"],
  [/\bcll\b|\bcl\b/g, "calle"],
  [/\bav\b|\bavda\b/g, "avenida"],
  [/\bdg\b/g, "diagonal"],
  [/\btv\b|\btrans\b/g, "transversal"],
  [/\bno\b|\bnro\b|\bnum\b/g, ""],
];

function claveDireccion(direccion: string | null): string | null {
  if (!direccion) return null;
  let s = fold(direccion);
  for (const [re, con] of ABREVIATURAS) s = s.replace(re, con);
  s = s.replace(/[^a-z0-9]/g, "");
  // Menos de ocho caracteres útiles no identifica nada: "cll5" no es una
  // dirección, es el principio de muchas.
  return s.length >= 8 ? s : null;
}

/**
 * Returns, per sourceRecordId, the other results that could be the same
 * place seen by another source. Only relates results from different sources.
 */
export function findPossibleSameplace(
  results: readonly SearchResult[],
): Map<number, SearchResult[]> {
  const prepared = results.map((r) => ({
    r,
    t: tokens(`${r.title} ${r.locality ?? ""}`),
    dir: claveDireccion(r.displayAddress),
  }));
  const out = new Map<number, SearchResult[]>();

  const link = (id: number, other: SearchResult) => {
    const list = out.get(id);
    if (list) list.push(other);
    else out.set(id, [other]);
  };

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const a = prepared[i]!;
      const b = prepared[j]!;

      if (a.r.sourceSlug === b.r.sourceSlug) continue;
      if (a.r.recordType !== b.r.recordType) continue;
      if (a.r.admin2Name !== b.r.admin2Name) continue;

      // La misma dirección es una señal mucho más fuerte que parecerse de
      // nombre, y no exige que los títulos coincidan: dos fuentes bautizan el
      // mismo sitio distinto. Sin esto, seis direcciones idénticas del Valle
      // aparecían dos veces sin que nada lo dijera.
      const mismaDireccion = a.dir !== null && a.dir === b.dir;

      if (!mismaDireccion) {
        if (sharedCount(a.t, b.t) < MIN_SHARED_TOKENS) continue;
        if (overlap(a.t, b.t) < OVERLAP_THRESHOLD) continue;
      }

      link(a.r.sourceRecordId, b.r);
      link(b.r.sourceRecordId, a.r);
    }
  }
  return out;
}

/** true if two sources report statuses that contradict each other. */
export function statusesDisagree(a: SearchResult, others: readonly SearchResult[]): boolean {
  const open = new Set(["active", "partially_fulfilled"]);
  const shut = new Set(["closed", "fulfilled", "withdrawn"]);
  const aOpen = open.has(a.status);
  const aShut = shut.has(a.status);
  return others.some((o) => (aOpen && shut.has(o.status)) || (aShut && open.has(o.status)));
}
