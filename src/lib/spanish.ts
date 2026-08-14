/**
 * Spanish conjunctions that change shape to stay pronounceable.
 *
 * "atención médica y insumos médicos" is wrong: before the i sound, "y" becomes
 * "e". Same for "o", which becomes "u" before the o sound. It is a rule, not a
 * list of exceptions, so it belongs in one place — every sentence this project
 * writes is read by someone under stress, and text that reads as sloppy reads
 * as unreliable.
 *
 * No imports, so it stays testable without a database.
 */

/** Strips accents so "índice" is recognised as starting with the i sound. */
function fold(word: string): string {
  return word
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * The right form of "y" or "o" for the word that follows.
 *
 * The "hie-" exception is real: in "hielo" and "hierba" the h-i is a diphthong,
 * not an i sound, so it keeps "y" — "agua y hielo", never "agua e hielo". The
 * same applies to "o" before "hue-" ("cobre u hueso" would be wrong).
 */
export function conjunction(base: "y" | "o", next: string): string {
  const word = fold(next);
  if (base === "y") return /^(i|hi)/.test(word) && !/^hie/.test(word) ? "e" : "y";
  return /^(o|ho)/.test(word) && !/^hue/.test(word) ? "u" : "o";
}

/**
 * "agua", "agua y alimentos", "agua, ropa e insumos médicos".
 *
 * Only the last connector changes — the ones before it are commas.
 */
export function joinInSpanish(items: readonly string[], base: "y" | "o" = "y"): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  const last = items.at(-1)!;
  return `${items.slice(0, -1).join(", ")} ${conjunction(base, last)} ${last}`;
}
