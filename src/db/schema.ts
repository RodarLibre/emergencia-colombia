import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Core model from the plan, trimmed down.
 *
 * What carries the weight is kept: immutable observations + full provenance +
 * stable per-source identity. canonical_records, duplicate_candidates and
 * conflicts are omitted for now: the "current" view is computed as each
 * source_record's latest observation, and disagreements are shown by putting
 * sources side by side instead of merging them.
 */

// --- Sources -------------------------------------------------------------

export const sources = pgTable("sources", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  baseUrl: text("base_url").notNull(),
  /** official_api | partner_feed | public_html | manual */
  mode: text("mode").notNull(),
  /** Starts as false on purpose: without a reviewed policy, the source doesn't run. */
  enabled: boolean("enabled").notNull().default(false),
  /** official | ngo | community */
  trustLabel: text("trust_label").notNull().default("community"),
  pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(900),
  /**
   * Department the source declares it covers (DANE code). Used to avoid
   * hiding records with no municipality: if someone filters by a
   * municipality in this department, this source's records with no
   * municipality appear marked as "the source didn't specify a
   * municipality", instead of staying invisible or getting a made-up location.
   */
  coverageAdmin1Code: text("coverage_admin1_code"),
  policyReviewedAt: timestamp("policy_reviewed_at", { withTimezone: true }),
  contactNote: text("contact_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// --- Per-source record identity -----------------------------------

export const sourceRecords = pgTable(
  "source_records",
  {
    id: serial("id").primaryKey(),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    canonicalUrl: text("canonical_url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastContentHash: text("last_content_hash"),
    /**
     * Contacto publicado por la fuente, en el estado actual y NUNCA en el
     * historial.
     *
     * Un telefono no es un hecho sobre el punto a lo largo del tiempo: es un
     * puntero vivo a una persona. Vive aca porque aca se sobreescribe en cada
     * lectura y desaparece cuando la fuente deja de publicarlo, asi que una
     * baja en el origen se propaga sola. En `observations` quedaria para
     * siempre.
     *
     * Solo lo llenan las fuentes con `mirrorsContacts`: las que recogen
     * consentimiento por persona y con las que hay acuerdo. Del resto se
     * redacta como siempre.
     */
    contacts: jsonb("contacts").$type<SourceContact[] | null>(),
    /** Only when the source explicitly withdraws it. Never due to absence. */
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    /** Hidden due to moderation or a removal request. */
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("source_records_source_external_idx").on(t.sourceId, t.externalId),
    index("source_records_last_seen_idx").on(t.lastSeenAt),
  ],
);

// --- Observations (immutable) -----------------------------------------

export const observations = pgTable(
  "observations",
  {
    id: serial("id").primaryKey(),
    sourceRecordId: integer("source_record_id")
      .notNull()
      .references(() => sourceRecords.id, { onDelete: "cascade" }),
    schemaVersion: text("schema_version").notNull().default("1.0"),

    recordType: text("record_type").notNull(),
    status: text("status").notNull().default("unknown"),
    title: text("title").notNull(),
    description: text("description"),
    categoryCodes: text("category_codes").array().notNull().default([]),

    admin1Code: text("admin1_code"),
    admin1Name: text("admin1_name"),
    admin2Code: text("admin2_code"),
    admin2Name: text("admin2_name"),
    locality: text("locality"),
    /**
     * Public address of an operational point (collection point, shelter). NOT
     * used for private residences: those stay reduced to neighborhood or
     * municipality.
     */
    displayAddress: text("display_address"),
    openingHours: text("opening_hours"),
    /** Precision is never upgraded by inference (plan 9.1). */
    locationPrecision: text("location_precision").notNull().default("unknown"),

    verificationLevel: text("verification_level").notNull().default("unknown"),

    /** null when the source doesn't publish this data. Never inferred. */
    sourceCreatedAt: timestamp("source_created_at", { withTimezone: true }),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    /** Set by the ingestor, not the source. */
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),

    contentHash: text("content_hash").notNull(),
    /** Already-normalized text (no accents, lowercase) for FTS and trigrams. */
    searchText: text("search_text").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("observations_record_latest_idx").on(t.sourceRecordId, t.observedAt),
    index("observations_type_idx").on(t.recordType),
    index("observations_admin2_idx").on(t.admin2Code),
    index("observations_status_idx").on(t.status),
  ],
);

// --- Inference usage limiter --------------------------------------

/**
 * Fixed-window counters to limit calls to the model.
 *
 * Stores no IP and no question: `key` is an HMAC of a random cookie id or of
 * a truncated network. Only limits inference; deterministic search is never
 * limited.
 */
export const aiUsageCounters = pgTable(
  "ai_usage_counters",
  {
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.windowStart] }),
    index("ai_usage_counters_window_idx").on(t.windowStart),
  ],
);

/**
 * Cache of question INTERPRETATION. Never caches results.
 *
 * The "Spanish question" -> filters translation doesn't go stale, so it can
 * be reused; catalog records are always queried fresh. Caching results would
 * be dangerous: serving "open" when it already closed is the failure this
 * project exists to prevent.
 *
 * Privacy: the question is NEVER stored. The key is an HMAC of the
 * normalized text. And it's versioned by prompt: if the vocabulary or the
 * rules change, old entries stop matching instead of returning stale filters.
 */
/**
 * Consumo diario de inferencia, en agregado.
 *
 * Solo totales por dia: ni el texto de las preguntas ni nada por consulta. Sin
 * esto no se puede responder "cuanto llevamos gastado", que es justo lo que hay
 * que saber cuando el presupuesto sale de los creditos de alguien.
 *
 * El costo se calcula al leer, no se guarda: los precios cambian y un numero
 * viejo guardado en la base miente sin avisar.
 */
export const aiUsageDaily = pgTable("ai_usage_daily", {
  /** Dia en America/Bogota, que es donde vive quien paga y quien pregunta. */
  day: date("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
  inputTokens: bigint("input_tokens", { mode: "number" }).notNull().default(0),
  outputTokens: bigint("output_tokens", { mode: "number" }).notNull().default(0),
  /** Llamadas que fallaron. No gastan tokens pero si dicen que algo anda mal. */
  failures: integer("failures").notNull().default(0),

  /**
   * Preguntas atendidas, que NO es lo mismo que llamadas al modelo.
   *
   * `calls` solo contaba inferencia, y el bot responde muchisimo sin llamar al
   * modelo: una pregunta repetida sale de la cache, una fuera de alcance se
   * resuelve antes de gastar nada, y sin cupo se busca el texto tal cual. El
   * numero parecia congelado mientras la gente usaba el sitio.
   *
   * Todo lo de abajo son totales por dia. Nunca se guarda una pregunta.
   */
  questions: integer("questions").notNull().default(0),
  /** Interpretadas reusando una interpretacion anterior: no gastan tokens. */
  cached: integer("cached").notNull().default(0),
  /** Resueltas sin modelo: sin cupo, sin proveedor, o con el sitio saturado. */
  deterministic: integer("deterministic").notNull().default(0),
  /** Derivadas a quien si puede responder: 123, Cruz Roja, mascotas. */
  outOfScope: integer("out_of_scope").notNull().default(0),
  /** Un municipio que todavia no cubrimos. */
  outOfCoverage: integer("out_of_coverage").notNull().default(0),
  /** Se busco y no habia nada. Es la metrica que dice que nos falta cubrir. */
  empty: integer("empty").notNull().default(0),
});

export const aiIntentCache = pgTable(
  "ai_intent_cache",
  {
    questionHash: text("question_hash").primaryKey(),
    promptVersion: text("prompt_version").notNull(),
    intent: jsonb("intent").notNull(),
    hits: integer("hits").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("ai_intent_cache_created_idx").on(t.createdAt)],
);

/**
 * Abuse signals, for deciding whether anyone needs blocking and for telling
 * the community how the site is being used.
 *
 * NO IP ADDRESS IS STORED, and neither is any question text. `subjectKey` is
 * the same keyed HMAC the rate limiter uses — of a random cookie id, or of a
 * truncated network (/24, /48). It is enough to block a source of abuse
 * without ever learning who it is, which is the only thing this needs to do.
 *
 * Storing raw IPs would make this a controller of personal data under Ley
 * 1581, with a privacy notice, consent, deletion rights and a data-subject
 * channel to answer for — in exchange for knowing an address that serves no
 * operational purpose here.
 */
export const abuseEvents = pgTable(
  "abuse_events",
  {
    id: serial("id").primaryKey(),
    /** HMAC of a cookie id or a truncated network. Never an address. */
    subjectKey: text("subject_key").notNull(),
    /** client | network | global */
    subjectKind: text("subject_kind").notNull(),
    /** rate_limited | blocked_attempt */
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("abuse_events_subject_idx").on(t.subjectKey, t.createdAt),
    index("abuse_events_created_idx").on(t.createdAt),
  ],
);

/**
 * Blocked subjects.
 *
 * A block denies INFERENCE ONLY. Deterministic search is never blocked: a
 * network key can cover a whole shelter's wifi, and taking away their ability
 * to search for water because one person hammered the box would be a far worse
 * outcome than the abuse.
 *
 * Blocks expire. A permanent block on a rotating carrier address eventually
 * punishes a stranger.
 */
export const blockedSubjects = pgTable(
  "blocked_subjects",
  {
    subjectKey: text("subject_key").primaryKey(),
    subjectKind: text("subject_kind").notNull(),
    /** Free-text note for whoever reviews this later. */
    reason: text("reason").notNull(),
    blockedAt: timestamp("blocked_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("blocked_subjects_expires_idx").on(t.expiresAt)],
);

/**
 * What someone thought of an answer.
 *
 * `turnId` is signed (`lib/feedback.ts`), so a row can only exist for an answer
 * this server actually produced. It is also the whole identity: one turn is
 * issued to one person for one answer, so UNIQUE on it alone gives one vote per
 * answer without storing anything about who voted. There is no client key here
 * on purpose — it would be a second identifier that buys nothing.
 *
 * The reply itself is not stored. `composeAnswer` builds prose from records, so
 * the filters and the record ids in `context` reconstruct what was on screen,
 * and they do it without freezing text that the catalog has since moved on from.
 *
 * `questionText` and `comment` are the only personal data here, and both stay
 * null unless FEEDBACK_TEXT is on AND the person ticked the box AND it was a
 * thumbs-down. `consentVersion` records which wording they agreed to. Text
 * expires — see RETENTION_DAYS — while the row it came from stays, because the
 * counts are what the rates are made of and they are nobody's data.
 */
export const answerFeedback = pgTable(
  "answer_feedback",
  {
    id: serial("id").primaryKey(),
    /** `<uuid>.<hmac>`. Unique, so a second vote on the same answer is dropped. */
    turnId: text("turn_id").notNull().unique(),
    /** up | down */
    rating: text("rating").notNull(),
    /** Chips from a fixed list. No free text, so these are always safe to keep. */
    reasons: text("reasons").array().notNull().default([]),
    /** filters, interpretedBy, promptVersion, notes, resultIds. */
    context: jsonb("context").notNull(),
    questionText: text("question_text"),
    comment: text("comment"),
    consentVersion: text("consent_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("answer_feedback_created_idx").on(t.createdAt)],
);

// --- Relations ----------------------------------------------------------

export const sourcesRelations = relations(sources, ({ many }) => ({
  records: many(sourceRecords),
}));

/** Un canal de contacto publicado por la fuente, citado con su nombre. */
export type SourceContact = {
  /** "whatsapp" | "telefono" | "correo" */
  kind: string;
  value: string;
  /** Como lo nombra la fuente, si lo nombra. Nunca se infiere. */
  label?: string | null;
};

export const sourceRecordsRelations = relations(sourceRecords, ({ one, many }) => ({
  source: one(sources, { fields: [sourceRecords.sourceId], references: [sources.id] }),
  observations: many(observations),
}));

export const observationsRelations = relations(observations, ({ one }) => ({
  sourceRecord: one(sourceRecords, {
    fields: [observations.sourceRecordId],
    references: [sourceRecords.id],
  }),
}));

export type Source = typeof sources.$inferSelect;
export type SourceRecord = typeof sourceRecords.$inferSelect;
export type Observation = typeof observations.$inferSelect;
export type NewObservation = typeof observations.$inferInsert;
