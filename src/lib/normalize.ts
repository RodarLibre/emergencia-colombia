import {
  ALL_MUNICIPALITIES,
  OPERATING_ADMIN1_CODE,
  OPERATING_MUNICIPALITIES,
  type Municipality,
} from "./vocab";

/** Unicode range for combining diacritical marks (accents, diaeresis, etc.). */
const COMBINING_MARKS = /[̀-ͯ]/g;

/**
 * Strips accents and lowercases.
 *
 * Normalized in the application, not in SQL, on purpose: `unaccent` isn't
 * immutable in Postgres and breaks generated columns and expression indexes.
 * Storing the already-normalized text avoids that problem entirely.
 */
export function fold(text: string): string {
  return text.normalize("NFD").replace(COMBINING_MARKS, "").toLowerCase().trim();
}

/** Indexable plain text built from an observation's public fields. */
export function buildSearchText(parts: {
  title: string;
  description?: string | null;
  locality?: string | null;
  admin2Name?: string | null;
  categoryCodes?: readonly string[];
}): string {
  return fold(
    [
      parts.title,
      parts.description ?? "",
      parts.locality ?? "",
      parts.admin2Name ?? "",
      (parts.categoryCodes ?? []).join(" "),
    ]
      .filter(Boolean)
      .join(" "),
  ).replace(/\s+/g, " ");
}

/**
 * Variants of an official name the way people actually write it.
 *
 * DANE records "Bogotá, D.C.", but nobody writes that: "bogota" needs to be
 * indexed too. It's cut at the comma, which is where DANE puts these
 * administrative suffixes.
 */
function nameVariants(name: string): string[] {
  const full = fold(name);
  const short = full.split(",")[0]!.trim();
  return short && short !== full ? [full, short] : [full];
}

/** Indexes built once. */
const OPERATING_BY_NAME = ((): ReadonlyMap<string, Municipality> => {
  const map = new Map<string, Municipality>();
  for (const m of OPERATING_MUNICIPALITIES) {
    for (const key of nameVariants(m.name)) if (!map.has(key)) map.set(key, m);
  }
  return map;
})();

/** Normalized name -> every municipality in the country that has it. */
const NATIONAL_BY_NAME = ((): ReadonlyMap<string, readonly Municipality[]> => {
  const map = new Map<string, Municipality[]>();
  for (const m of ALL_MUNICIPALITIES) {
    for (const key of nameVariants(m.name)) {
      const list = map.get(key);
      if (list) {
        if (!list.includes(m)) list.push(m);
      } else {
        map.set(key, [m]);
      }
    }
  }
  return map;
})();

/**
 * Resolves a municipality name written by a person (or by the model) to its
 * DANE code. The model never emits codes: it emits names, and this mapping
 * translates them, so it can never invent an identifier.
 *
 * There are 67 names repeated across departments, 7 of them in the operating
 * area ("La Union", "Candelaria", "Bolivar", "Argelia", "La Victoria",
 * "Restrepo", "San Pedro"). Resolution order is:
 *
 *   1. Exact match within the operating department.
 *   2. Exact match nationally, only if it's unique.
 *   3. Partial match within the operating department ("buga" -> Guadalajara).
 *
 * If a name is ambiguous outside the operating area, it returns null instead
 * of picking a department at random: the text falls back to free-text search,
 * which beats silently filtering by the wrong municipality.
 */
export function resolveMunicipality(input: string | null | undefined): Municipality | null {
  if (!input) return null;
  const needle = fold(input);
  if (!needle) return null;

  const local = OPERATING_BY_NAME.get(needle);
  if (local) return local;

  const national = NATIONAL_BY_NAME.get(needle);
  if (national && national.length === 1) return national[0]!;
  if (national && national.length > 1) return null; // ambiguo: no se adivina

  // Partial match, only within the operating area and requiring some length
  // so "la" or "san" doesn't drag in anything.
  if (needle.length >= 4) {
    for (const m of OPERATING_MUNICIPALITIES) {
      const hay = fold(m.name);
      if (hay.includes(needle) || needle.includes(hay)) return m;
    }
  }
  return null;
}

export { OPERATING_ADMIN1_CODE };

/**
 * Spanish function words and question words.
 *
 * Only stripped from the QUERY, never from the indexed text, and deliberately
 * excludes domain terms ("agua", "albergue", "acopio"): those are exactly
 * what the person is looking for.
 */
const QUERY_STOPWORDS = new Set([
  "a",
  "al",
  "algun",
  "alguna",
  "algunas",
  "alguno",
  "algunos",
  "ante",
  "aqui",
  "como",
  "con",
  "cual",
  "cuales",
  "cuando",
  "cuanto",
  "de",
  "del",
  "donde",
  "dos",
  "el",
  "ella",
  "ellos",
  "en",
  "entre",
  "es",
  "esa",
  "ese",
  "eso",
  "esta",
  "estan",
  "este",
  "esto",
  "estoy",
  "hay",
  "la",
  "las",
  "le",
  "les",
  "lo",
  "los",
  "me",
  "mi",
  "mis",
  "muy",
  "nos",
  "o",
  "para",
  "pero",
  "por",
  "porque",
  "puedo",
  "que",
  "quien",
  "se",
  "ser",
  "si",
  "sin",
  "sobre",
  "son",
  "soy",
  "su",
  "sus",
  "tambien",
  "tengo",
  "tiene",
  "tienen",
  "toda",
  "todas",
  "todo",
  "todos",
  "un",
  "una",
  "unas",
  "uno",
  "unos",
  "y",
  "ya",
  "yo",
  "busco",
  "buscar",
  "necesito",
  "necesitar",
  "quiero",
  "querer",
  "llevar",
  "llevo",
  "ir",
  "voy",
  "dar",
  "doy",
  "hacer",
  "puede",
  "pueden",
  "habra",
  "estara",
]);

/**
 * Converts free text into a query for `websearch_to_tsquery`.
 *
 * Joins terms with `or` instead of leaving the implicit AND. With AND, a
 * question like "donde puedo llevar agua en Palmira" matches nothing, because
 * it also requires the document to contain "donde" and "puedo". With OR it
 * matches on "agua" and "palmira", and `ts_rank` ranks the ones with both higher.
 *
 * `websearch_to_tsquery` sanitizes its input, so it's safe to pass it a
 * person's raw text.
 */
export function buildTextQuery(raw: string): string | null {
  const terms = fold(raw)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !QUERY_STOPWORDS.has(t));

  if (terms.length === 0) {
    // With no useful terms, return the sanitized text so trigram similarity
    // at least has something to work with.
    const folded = fold(raw);
    return folded.length > 0 ? folded : null;
  }
  return terms.join(" or ");
}

/**
 * Looks for a municipality from the operating area named within free text.
 *
 * It's not guessing: if the source wrote "Campana de solidaridad con Versalles
 * Norte del Valle", it named Versalles, which is a municipality in Valle
 * (76863). Extracting it is reading what the source said.
 *
 * Word boundaries are required and the longest name is tried first, because
 * "Cali" is a substring of "Calima": text that says Calima can't resolve to
 * Cali.
 */
/**
 * Prepositions that mark WHERE something IS.
 *
 * They distinguish a municipality from a venue that shares its name: "acopio
 * en Palmira" is geography, "Colegio San Pedro Claver" is a proper noun.
 *
 * "para", "hacia" and "con" are deliberately excluded, since they mark the
 * BENEFICIARY and not the location. "Campana de solidaridad con Versalles" is
 * a collection point in Cali gathering aid FOR Versalles: the point's
 * municipality is Cali. Treating those prepositions as location sent the
 * record to the wrong municipality.
 */
const PLACE_PREPOSITIONS = "(?:en|del?)";

/** Prepositions that mark WHO the aid is directed to, not where it is. */
const BENEFICIARY_PREPOSITIONS = "(?:para|hacia|con|destinad\\w*\\s+a)";

/**
 * Municipality names that are also common neighborhood and corregimiento
 * names, so a bare mention isn't enough to locate anything.
 *
 * Real examples: San Pedro is a Valle municipality (76670), a corregimiento of
 * Buga, and a Cali neighborhood. Versalles is a municipality (76863) and also
 * a well-known Cali neighborhood.
 *
 * These are only accepted with a locative preposition ("en San Pedro"), never
 * from a bare mention.
 *
 * REVIEW with local knowledge: the list was built by naming convention
 * (San/Santa/El/La + frequent toponyms), not from a neighborhood catalog.
 */
const AMBIGUOUS_WITH_NEIGHBORHOODS = new Set([
  "san pedro",
  "versalles",
  "la victoria",
  "la union",
  "la cumbre",
  "el cerrito",
  "el aguila",
  "el cairo",
  "el dovio",
  "bolivar",
  "candelaria",
  "argelia",
  "restrepo",
  "florida",
  "trujillo",
  "sevilla",
]);

const TEXT_MATCHERS: ReadonlyArray<{
  municipality: Municipality;
  /** Preceded by a locative preposition: high confidence. */
  withPreposition: RegExp;
  /** Preceded by a beneficiary preposition: NOT the location. */
  beneficiary: RegExp;
  /** Bare mention: only used if no candidate has a preposition. */
  bare: RegExp;
}> = [...OPERATING_MUNICIPALITIES]
  .sort((a, b) => b.name.length - a.name.length)
  .map((m) => {
    const escaped = fold(m.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return {
      municipality: m,
      withPreposition: new RegExp(`\\b${PLACE_PREPOSITIONS}\\s+${escaped}\\b`),
      beneficiary: new RegExp(`\\b${BENEFICIARY_PREPOSITIONS}\\s+${escaped}\\b`),
      bare: new RegExp(`\\b${escaped}\\b`),
    };
  });

/**
 * Colloquial names, curated by hand and on purpose.
 *
 * NOT derived mechanically from official names. Taking the last word of
 * Valle's compound names would produce "pedro" -> San Pedro and "victoria" ->
 * La Victoria, and since this function also runs over place titles ("Colegio
 * San Pedro Claver de Cali"), those would be false positives.
 *
 * In Valle the only diminutive in general use is Buga. The list grows when
 * real usage justifies it, not before.
 */
const MUNICIPALITY_ALIASES: ReadonlyMap<string, string> = new Map([
  ["buga", "76111"], // Guadalajara de Buga
]);

export function findMunicipalityInText(text: string | null | undefined): Municipality | null {
  if (!text) return null;
  const hay = fold(text);

  // 1. Official name preceded by a locative preposition. Maximum confidence.
  for (const { withPreposition, municipality } of TEXT_MATCHERS) {
    if (withPreposition.test(hay)) return municipality;
  }

  // 2. Colloquial alias preceded by a preposition. The word boundary keeps
  //    "buga" from matching inside "bugalagrande".
  for (const [alias, code] of MUNICIPALITY_ALIASES) {
    if (new RegExp(`\\b${PLACE_PREPOSITIONS}\\s+${alias}\\b`).test(hay)) {
      const m = ALL_MUNICIPALITIES.find((x) => x.code === code);
      if (m) return m;
    }
  }

  // 3. Bare mention of the official name, excluding those that are also
  //    neighborhood or corregimiento names. Last resort.
  for (const { bare, beneficiary, municipality } of TEXT_MATCHERS) {
    if (AMBIGUOUS_WITH_NEIGHBORHOODS.has(fold(municipality.name))) continue;
    // "Recoleccion para Tulua" names the beneficiary, not where the point is.
    if (beneficiary.test(hay)) continue;
    if (bare.test(hay)) return municipality;
  }
  return null;
}

/**
 * Spanish words -> vocabulary category.
 *
 * Done by code, not by the model. With reasoning_effort low the model
 * confuses categories systematically ("agua" -> communications, "comida" ->
 * transport): picking among 17 enums by position isn't a reasoning task, it's
 * a lookup table. The model is left with what only it can do: understanding
 * intent and place.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, string]> = [
  ["agua", "water"],
  ["hidratacion", "water"],
  ["comida", "food"],
  ["aliment", "food"],
  ["mercado", "food"],
  ["merienda", "food"],
  ["almuerzo", "food"],
  ["medicament", "medical_supplies"],
  ["insumo", "medical_supplies"],
  ["gasa", "medical_supplies"],
  ["jeringa", "medical_supplies"],
  ["curacion", "medical_supplies"],
  ["medic", "medical_assistance"],
  ["enfermer", "medical_assistance"],
  ["herid", "medical_assistance"],
  ["albergue", "shelter"],
  ["dormir", "shelter"],
  ["refugio", "shelter"],
  ["alojamiento", "shelter"],
  ["carpa", "shelter"],
  ["colchon", "shelter"],
  ["transporte", "transport"],
  ["camion", "transport"],
  ["vehiculo", "transport"],
  ["rescate", "rescue_equipment"],
  ["casco", "rescue_equipment"],
  ["camilla", "rescue_equipment"],
  ["herramienta", "rescue_equipment"],
  ["pala", "rescue_equipment"],
  ["escombro", "rescue_equipment"],
  ["zinc", "construction_materials"],
  ["material", "construction_materials"],
  ["cemento", "construction_materials"],
  ["teja", "construction_materials"],
  ["senal", "communications"],
  ["internet", "communications"],
  ["wifi", "communications"],
  ["celular", "communications"],
  ["energia", "power"],
  ["luz", "power"],
  ["planta", "power"],
  ["carga", "power"],
  ["ropa", "clothing"],
  ["cobija", "clothing"],
  ["frazada", "clothing"],
  ["zapato", "clothing"],
  ["aseo", "hygiene"],
  ["higiene", "hygiene"],
  ["jabon", "hygiene"],
  ["panal", "hygiene"],
  ["toalla", "hygiene"],
  ["voluntari", "volunteers"],
  ["mascota", "animal_support"],
  ["animal", "animal_support"],
  ["perro", "animal_support"],
  ["gato", "animal_support"],
  // "donacion" is deliberately absent: after an earthquake it almost always
  // means bringing supplies, not money, and mapping it to cash_or_donation
  // filtered out every goods collection point. "dinero" and "plata" are
  // unambiguous.
  ["dinero", "cash_or_donation"],
  ["plata", "cash_or_donation"],
  ["informacion", "information"],
  ["alerta", "information"],
  ["comunicado", "information"],
];

/**
 * Words that mean the question is about this emergency at all.
 *
 * Generous on purpose. It only decides whether to trust the model's guess at a
 * record type, and the costs are asymmetric: discarding a type from an oddly
 * phrased real question still leaves a text search running, while trusting a
 * fabricated one answers "que hora es" with seven earthquakes.
 *
 * Measured against the deployed site: asked the time, the model returned
 * `hazard`; asked the capital of France, `official_update`. The prompt tells it
 * to leave the field empty when nothing can be deduced, and it guesses anyway.
 */
const DOMAIN_TERMS = [
  // Kinds of place
  "acopio",
  "albergue",
  "refugio",
  "alojamiento",
  "punto",
  "centro",
  "sede",
  "hospital",
  "puesto",
  "brigada",
  "colegio",
  "coliseo",
  "parque",
  // The emergency itself
  "sismo",
  "temblor",
  "terremoto",
  "replica",
  "damnificad",
  "emergencia",
  "desastre",
  "afectad",
  "derrumbe",
  "escombro",
  "magnitud",
  // Giving and receiving
  "ayuda",
  "ayudar",
  "donar",
  "donacion",
  "recib",
  "entreg",
  "necesit",
  "aporta",
  "colabora",
  "voluntari",
  "reparto",
  "reparten",
  "dejar",
  "llevar",
  // Official information
  "oficial",
  "autoridad",
  "alcaldia",
  "gobernacion",
  "comunicado",
  "alerta",
  "aviso",
  "boletin",
];

/**
 * True when the question carries any signal that it is about this emergency:
 * a resource category, a municipality, or a domain word.
 */
export function hasDomainSignal(question: string): boolean {
  if (extractCategories(question).length > 0) return true;
  if (findMunicipalityInText(question)) return true;
  const hay = fold(question);
  return DOMAIN_TERMS.some((term) => hay.includes(term));
}

/** Extracts categories from Spanish text, deterministically. */
export function extractCategories(raw: string): string[] {
  const hay = fold(raw);
  const found = new Set<string>();
  for (const [needle, category] of CATEGORY_KEYWORDS) {
    if (hay.includes(needle)) found.add(category);
  }
  return [...found];
}

/** Limits and cleans free text before storing or displaying it. */
export function sanitizeText(raw: string, maxLength: number): string {
  return raw
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}
