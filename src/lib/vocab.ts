/**
 * Shared controlled vocabulary.
 *
 * The single source of truth for: search filters, validation of observations
 * on ingest, and the intent schema requested from the model. If a value isn't
 * here, it doesn't enter the database and the model can't emit it.
 */

// --- Record types ---------------------------------------------------

/**
 * v1 is deliberately institutional: physical points and announcements.
 * Nothing about individual needs with contact info, pets, or people.
 * That line is defensible without prior legal consultation (Ley 1581: health
 * data is sensitive and requires explicit consent).
 */
export const RECORD_TYPES_V1 = [
  "collection_point",
  "service_point",
  "shelter",
  "official_update",
  "hazard",
  "seismic_event",
] as const;

/** Require a privacy review and/or an agreement with the source owner. */
export const RECORD_TYPES_GATED = [
  "need",
  "offer",
  "damaged_building",
  "hospital_update",
  "lost_pet",
  "found_pet",
  "reunited_pet",
  "missing_person",
  "found_person",
] as const;

export type RecordTypeV1 = (typeof RECORD_TYPES_V1)[number];

export const RECORD_TYPE_LABELS: Record<RecordTypeV1, string> = {
  collection_point: "Punto de acopio",
  service_point: "Punto de servicio",
  shelter: "Albergue",
  official_update: "Comunicado oficial",
  hazard: "Riesgo o alerta",
  seismic_event: "Sismo",
};

/**
 * Plural labels, declared rather than derived.
 *
 * Spanish compound nouns pluralize the head noun, not the last word: "punto de
 * acopio" becomes "puntos de acopio", not "punto de acopios". Any regex over
 * the singular gets that wrong, and the assistant said "10 punto de acopio".
 */
export const RECORD_TYPE_LABELS_PLURAL: Record<RecordTypeV1, string> = {
  collection_point: "puntos de acopio",
  service_point: "puntos de servicio",
  shelter: "albergues",
  official_update: "comunicados oficiales",
  hazard: "riesgos o alertas",
  seismic_event: "sismos",
};

// --- Statuses -------------------------------------------------------------

export const STATUSES = [
  "active",
  "partially_fulfilled",
  "fulfilled",
  "closed",
  "withdrawn",
  "unknown",
] as const;

export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  active: "Activo",
  partially_fulfilled: "Parcialmente atendido",
  fulfilled: "Atendido",
  closed: "Cerrado",
  withdrawn: "Retirado por la fuente",
  unknown: "Sin dato",
};

// --- Need / resource categories -----------------------------------

export const CATEGORIES = [
  "water",
  "food",
  "medical_supplies",
  "medical_assistance",
  "shelter",
  "transport",
  "rescue_equipment",
  "construction_materials",
  "communications",
  "power",
  "clothing",
  "hygiene",
  "baby_supplies",
  "volunteers",
  "animal_support",
  "cash_or_donation",
  "information",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  water: "Agua",
  food: "Alimentos",
  medical_supplies: "Insumos médicos",
  medical_assistance: "Atención médica",
  shelter: "Alojamiento",
  transport: "Transporte",
  rescue_equipment: "Equipo de rescate",
  construction_materials: "Materiales de construcción",
  communications: "Comunicaciones",
  power: "Energía",
  clothing: "Ropa",
  hygiene: "Aseo e higiene",
  baby_supplies: "Bebés",
  volunteers: "Voluntarios",
  animal_support: "Apoyo animal",
  cash_or_donation: "Donación en dinero",
  information: "Información",
  other: "Otro",
};

// --- Verification level ----------------------------------------------

export const VERIFICATION_LEVELS = [
  "official",
  "source_verified",
  "community_unverified",
  "disputed",
  "unknown",
] as const;

export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

/**
 * The label always names who is making the claim. Bare "Verificado" is
 * exactly the error the plan prohibits in section 7.2 — "publicado por X"
 * names the claimant even for the levels that carry no verification at all.
 */
export function verificationLabel(level: VerificationLevel, sourceName: string): string {
  switch (level) {
    case "official":
      return `Publicado por ${sourceName}`;
    case "source_verified":
      return `Publicado por ${sourceName} · verificado por ellos, no por nosotros`;
    case "community_unverified":
      return `Publicado por ${sourceName} · reporte comunitario sin verificar`;
    case "disputed":
      return `Publicado por ${sourceName} · fuentes en desacuerdo`;
    case "unknown":
      return `Publicado por ${sourceName} · sin información de verificación`;
  }
}

// --- Freshness ------------------------------------------------------------

/**
 * Reconfirmation windows in minutes (plan 10.5). They're configuration, not
 * truth: they express "how long since anyone confirmed this", not "this is false".
 */
export const FRESHNESS_WINDOW_MINUTES: Record<RecordTypeV1, number | null> = {
  hazard: 60,
  // An earthquake is a fact that happened, not an operational state that
  // needs reconfirming. Labelling the magnitude 7.4 as "not recently
  // reconfirmed" would be wrong.
  seismic_event: null,
  collection_point: 720,
  service_point: 720,
  shelter: 720,
  official_update: null, // valid until the source replaces it
};

export const FRESHNESS_STATES = ["fresh", "needs_reconfirmation", "stale"] as const;
export type FreshnessState = (typeof FRESHNESS_STATES)[number];

export function computeFreshness(
  recordType: RecordTypeV1,
  lastUpdate: Date,
  now: Date = new Date(),
): FreshnessState {
  const window = FRESHNESS_WINDOW_MINUTES[recordType];
  if (window === null) return "fresh";
  const ageMinutes = (now.getTime() - lastUpdate.getTime()) / 60_000;
  if (ageMinutes <= window) return "fresh";
  if (ageMinutes <= window * 3) return "needs_reconfirmation";
  return "stale";
}

/**
 * Deliberately short: paired with a relative time everywhere they're shown
 * ("Confirmado hace 40 min"). "Recientemente" duplicated the timestamp
 * sitting right next to it without adding anything a reader needs.
 */
export const FRESHNESS_LABELS: Record<FreshnessState, string> = {
  fresh: "Confirmado",
  needs_reconfirmation: "Sin confirmar",
  stale: "Sin confirmar",
};

// --- Geography -----------------------------------------------------------

/**
 * Official geography: the 1121 municipalities of DANE's Marco Geoestadistico
 * Nacional (MGN 2024).
 *
 * The file is generated by `node scripts/fetch-municipios.mjs`, not edited by
 * hand. It covers the whole country, even though the initial operating area
 * is a single department.
 */
import municipiosData from "./data/municipios.json";

export type Municipality = {
  code: string;
  name: string;
  dept: string;
  deptName: string;
};

export const ALL_MUNICIPALITIES: readonly Municipality[] = municipiosData.municipios;

export const MUNICIPIOS_SOURCE = {
  source: municipiosData.source,
  fetchedAt: municipiosData.fetchedAt,
} as const;

/**
 * Department where the site operates. Configurable: the data model supports
 * the whole country, but only one area at a time is announced as covered.
 * 76 = Valle del Cauca.
 */
/**
 * Departamentos cubiertos, en codigo DANE y separados por coma.
 *
 * El primero es el principal: da nombre al area cuando hay que nombrarla en
 * singular. Se amplio del Valle al Eje Cafetero porque el feed de Artefacto
 * Films ya traia puntos de Risaralda, Caldas y Quindio, y sin sus limites
 * quedaban sin municipio y por tanto invisibles.
 */
export const OPERATING_ADMIN1_CODES: readonly string[] = (
  process.env.OPERATING_ADMIN1_CODES ??
  process.env.OPERATING_ADMIN1_CODE ??
  "76,66,17,63"
)
  .split(",")
  .map((c) => c.trim())
  .filter(Boolean);

/** El principal, para lo que necesita un solo nombre. */
export const OPERATING_ADMIN1_CODE = OPERATING_ADMIN1_CODES[0]!;

export const OPERATING_MUNICIPALITIES: readonly Municipality[] = ALL_MUNICIPALITIES.filter((m) =>
  OPERATING_ADMIN1_CODES.includes(m.dept),
);

export const OPERATING_ADMIN1 = {
  code: OPERATING_ADMIN1_CODE,
  name: ALL_MUNICIPALITIES.find((m) => m.dept === OPERATING_ADMIN1_CODE)?.deptName ?? "Colombia",
} as const;

/** Los nombres de los departamentos cubiertos, para decirlos en la interfaz. */
export const OPERATING_ADMIN1_NAMES: readonly string[] = OPERATING_ADMIN1_CODES.map(
  (code) => ALL_MUNICIPALITIES.find((m) => m.dept === code)?.deptName ?? code,
);

export const MUNICIPALITY_BY_CODE: ReadonlyMap<string, Municipality> = new Map(
  ALL_MUNICIPALITIES.map((m) => [m.code, m]),
);

/**
 * The department a municipality belongs to.
 *
 * Every record used to be stamped with the FIRST operating department, which
 * was correct while the area was Valle del Cauca alone. Once coverage grew to
 * the Eje Cafetero it quietly mislabelled everything: Pereira carried the right
 * municipality code, 66001, next to department 76. The first two digits of a
 * DANE municipality code ARE its department, so there is nothing to assume.
 *
 * Null when the record has no municipality — there the source's coverage is
 * the only thing we know, and that is the caller's fallback.
 */
export function departmentOf(admin2Code: string | null | undefined): { code: string; name: string } | null {
  if (!admin2Code) return null;
  const municipality = MUNICIPALITY_BY_CODE.get(admin2Code);
  if (!municipality) return null;
  return { code: municipality.dept, name: municipality.deptName };
}

export const LOCATION_PRECISIONS = [
  "exact_operational_point",
  "approximate_point",
  "locality_only",
  "municipality_only",
  "unknown",
] as const;

export type LocationPrecision = (typeof LOCATION_PRECISIONS)[number];
