import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { SourceContact } from "@/db/schema";

import { checkProductionDataIntegrity, excludeDemoSources } from "./guards";
import { buildTextQuery, fold } from "./normalize";
import {
  computeFreshness,
  type Category,
  type FreshnessState,
  type LocationPrecision,
  type RecordTypeV1,
  type Status,
  type VerificationLevel,
  PERISHABLE_RECORD_TYPES,
} from "./vocab";

export type SearchFilters = {
  q?: string | null;
  /**
   * Text that ORDERS the results without excluding any.
   *
   * Someone asked "donde necesitan alcohol" and got 20 arbitrary collection
   * points: the model returned the type and no keywords, so the only
   * meaningful word in the question was dropped. Two records did ask for
   * alcohol and neither was near the top.
   *
   * It cannot filter. This text is synthesised by us, not extracted by the
   * model, and "hubo replicas anoche" appears in none of the 13 seismic
   * records — filtering by it would answer nothing. Ranking by it costs a
   * person nothing and puts the right record first when there is one.
   */
  rankBy?: string | null;
  types?: readonly string[];
  admin2Code?: string | null;
  categories?: readonly string[];
  limit?: number;
};

export type SearchResult = {
  observationId: number;
  sourceRecordId: number;
  recordType: RecordTypeV1;
  status: Status;
  title: string;
  description: string | null;
  categoryCodes: Category[];
  admin2Name: string | null;
  locality: string | null;
  displayAddress: string | null;
  openingHours: string | null;
  locationPrecision: LocationPrecision;
  verificationLevel: VerificationLevel;
  sourceUpdatedAt: Date | null;
  observedAt: Date;
  sourceName: string;
  sourceSlug: string;
  sourceTrustLabel: string;
  canonicalUrl: string | null;
  /** true when the source didn't publish a municipality and the record enters through coverage. */
  municipalityUnspecified: boolean;
  /** Computed, not stored: it's presentation, not truth. */
  freshness: FreshnessState;
  /**
   * The source read fine, and this record was not in its listing.
   *
   * Not a withdrawal: invariant 3 says a record is never deleted for going
   * absent, because a listing can drop something for a hundred reasons. But
   * staying silent about it is its own kind of lie — a place that vanished
   * from its source has most likely closed, and someone about to drive there
   * deserves to know that nobody has listed it since.
   */
  noLongerListed: boolean;
  /** When the source last showed this record in a listing. */
  lastSeenAt: Date;
  /**
   * Contacto publicado por la fuente, espejado del estado actual.
   *
   * Solo llega de fuentes con acuerdo que recogen consentimiento por persona.
   * No esta en el historial ni en el texto indexado: si la fuente lo quita,
   * desaparece en la siguiente lectura.
   */
  contacts: SourceContact[];
};

type Row = {
  id: number;
  source_record_id: number;
  record_type: string;
  status: string;
  title: string;
  description: string | null;
  category_codes: string[] | null;
  admin2_name: string | null;
  locality: string | null;
  display_address: string | null;
  opening_hours: string | null;
  location_precision: string;
  verification_level: string;
  source_updated_at: string | Date | null;
  observed_at: string | Date;
  source_name: string;
  source_slug: string;
  trust_label: string;
  canonical_url: string | null;
  municipality_unspecified?: boolean;
  no_longer_listed?: boolean;
  last_seen_at: string | Date;
  contacts: SourceContact[] | null;
};

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
/** Trigram similarity threshold to tolerate typos. */
const TRIGRAM_THRESHOLD = 0.18;
/**
 * Trigram matching applies only to short queries.
 *
 * It exists so "tulua" finds "Tuluá" and "jamundi" finds "Jamundí". Across a
 * whole sentence it stops discriminating: "cual es la capital de francia"
 * scored above the threshold against most of the catalog and returned 40
 * results. Longer queries rely on full-text matching, which requires actually
 * sharing a term.
 */
const TRIGRAM_MAX_QUERY_CHARS = 25;

/**
 * Deterministic search. It's the only path that queries the catalog: both
 * the question box and any manual filter end up here.
 *
 * Detail that matters: filters are applied AFTER reducing to each record's
 * latest observation, not before. If applied before, a place that already
 * closed would resurface because an old observation said "active".
 */
export async function searchRecords(filters: SearchFilters): Promise<SearchResult[]> {
  // Third layer of the integrity guard: if test data is enabled in
  // production, nothing is queried at all. The layout wall covers the view,
  // but without this the page would still run the query and the results
  // would end up in the HTML's RSC payload. "Not serving" has to mean they
  // don't come out, not just that they aren't seen.
  const integrity = await checkProductionDataIntegrity();
  if (!integrity.ok) return [];

  // No filters must never mean "the whole catalog". A caller that narrowed
  // by nothing has a bug, or a question that produced nothing; either way the
  // honest answer is no results, not 40 unrelated records.
  const hasAnyFilter =
    Boolean(filters.q) ||
    Boolean(filters.admin2Code) ||
    (filters.types?.length ?? 0) > 0 ||
    (filters.categories?.length ?? 0) > 0;
  if (!hasAnyFilter) return [];

  const limit = Math.min(filters.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  // Two forms of the same text: `tsQuery` with OR for term matching,
  // raw `folded` for trigram similarity.
  const tsQuery = filters.q ? buildTextQuery(filters.q) : null;
  const folded = filters.q ? fold(filters.q) : null;
  const hasText = Boolean(tsQuery && folded);
  // Only when there is no real text: a filter always outranks a hint.
  const rankOnly = !hasText && filters.rankBy ? buildTextQuery(filters.rankBy) : null;

  const conditions = [sql`l.status <> 'withdrawn'`];

  if (filters.types && filters.types.length > 0) {
    const list = sql.join(
      filters.types.map((t) => sql`${t}`),
      sql`, `,
    );
    conditions.push(sql`l.record_type IN (${list})`);
  }

  if (filters.admin2Code) {
    // The first two digits of a municipality's DANE code are the department.
    const deptCode = filters.admin2Code.slice(0, 2);
    conditions.push(
      sql`(
        l.admin2_code = ${filters.admin2Code}
        OR (l.admin2_code IS NULL AND l.coverage_admin1_code = ${deptCode})
      )`,
    );
  }

  if (filters.categories && filters.categories.length > 0) {
    const list = sql.join(
      filters.categories.map((c) => sql`${c}`),
      sql`, `,
    );
    conditions.push(sql`l.category_codes && ARRAY[${list}]::text[]`);
  }

  const useTrigram = hasText && folded!.length <= TRIGRAM_MAX_QUERY_CHARS;

  if (hasText) {
    conditions.push(
      useTrigram
        ? sql`(
            to_tsvector('spanish', l.search_text) @@ websearch_to_tsquery('spanish', ${tsQuery})
            OR similarity(l.search_text, ${folded}) > ${TRIGRAM_THRESHOLD}
          )`
        : sql`to_tsvector('spanish', l.search_text) @@ websearch_to_tsquery('spanish', ${tsQuery})`,
    );
  }

  const rank = !hasText
    ? rankOnly
      ? sql`ts_rank(to_tsvector('spanish', l.search_text), websearch_to_tsquery('spanish', ${rankOnly}))`
      : sql`0`
    : useTrigram
      ? // Not GREATEST of the two. They are not on the same scale: ts_rank of a
        // real match runs around 0.03-0.06, while trigram similarity between a
        // whole record and a short question sits around 0.12-0.15 for
        // everything, so the maximum was ALWAYS the trigram and the ranking was
        // decided by text length rather than by relevance. Asked "donde
        // necesitan alcohol", the record that did ask for alcohol scored twice
        // the relevance of the rest and came third.
        //
        // A word match is worth more than a resemblance, always. The +1 puts
        // every text match above every trigram rescue — similarity never
        // exceeds 1 — and ts_rank orders within the matches.
        sql`CASE
          WHEN to_tsvector('spanish', l.search_text) @@ websearch_to_tsquery('spanish', ${tsQuery})
            THEN 1 + ts_rank(to_tsvector('spanish', l.search_text), websearch_to_tsquery('spanish', ${tsQuery}))
          ELSE similarity(l.search_text, ${folded})
        END`
      : sql`ts_rank(to_tsvector('spanish', l.search_text), websearch_to_tsquery('spanish', ${tsQuery}))`;

  const query = sql`
    WITH latest AS (
      SELECT DISTINCT ON (o.source_record_id)
        o.id,
        o.source_record_id,
        o.record_type,
        o.status,
        o.title,
        o.description,
        o.category_codes,
        o.admin2_code,
        o.admin2_name,
        o.locality,
        o.display_address,
        o.opening_hours,
        o.location_precision,
        o.verification_level,
        o.source_updated_at,
        o.observed_at,
        o.search_text,
        sr.canonical_url,
        sr.last_seen_at,
        sr.contacts,
        -- The newest read across this source's visible records: effectively
        -- the timestamp of its last successful ingest.
        MAX(sr.last_seen_at) OVER (PARTITION BY sr.source_id) AS source_last_read,
        s.name  AS source_name,
        s.slug  AS source_slug,
        s.trust_label,
        s.coverage_admin1_code,
        s.windowed_listing
      FROM observations o
      JOIN source_records sr ON sr.id = o.source_record_id
      JOIN sources s ON s.id = sr.source_id
      WHERE sr.withdrawn_at IS NULL
        AND sr.hidden_at IS NULL
        AND s.enabled = true
        -- In production, demo sources can never appear in a result, even if
        -- someone enables them by hand in the database.
        AND ${excludeDemoSources()}
      ORDER BY o.source_record_id, o.observed_at DESC
    )
    SELECT
      l.*,
      ${rank} AS rank,
      (l.admin2_code IS NULL) AS municipality_unspecified,
      -- Five minutes of slack so the spread of timestamps within a single
      -- ingest run never marks a record as missing.
      --
      -- Only for a source that publishes its whole catalogue. Mapa de
      -- Emergencia publishes a six-hour window, so absence there means "not
      -- reconfirmed today", not "taken down" — and reading it as a takedown
      -- put the removed label on 912 of its 919 records, including every
      -- shelter in Pereira, where it is the only source we have.
      (
        NOT l.windowed_listing
        AND l.last_seen_at < l.source_last_read - INTERVAL '5 minutes'
      ) AS no_longer_listed
    FROM latest l
    WHERE ${sql.join(conditions, sql` AND `)}
    -- Soft quality filter: nothing is hidden, but among results of similar
    -- relevance the actionable one comes first. A collection point with a
    -- municipality and an address is actionable; one with only a
    -- neighborhood forces a visit to the source.
    ORDER BY
      -- Whether you can still go there outranks everything, including how well
      -- the text matches. Asked for shelters in Cali, the two that were closed
      -- and already covered came first and five open ones came after: the
      -- person deciding where to sleep read "CERRADO" at the top of the list.
      -- Nothing is hidden — a closed shelter is still an answer, and absence is
      -- not proof it reopened — but it goes last.
      CASE
        WHEN (
          NOT l.windowed_listing
          AND l.last_seen_at < l.source_last_read - INTERVAL '5 minutes'
        ) THEN 3
        WHEN l.status = 'closed' THEN 2
        WHEN l.status = 'fulfilled' THEN 1
        ELSE 0
      END ASC,
      rank DESC,
      (
        (CASE WHEN l.admin2_code IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN l.display_address IS NOT NULL THEN 1 ELSE 0 END) +
        (CASE WHEN l.opening_hours IS NOT NULL THEN 1 ELSE 0 END)
      ) DESC,
      l.observed_at DESC
    LIMIT ${limit}
  `;

  const rows = (await db.execute(query)) as unknown as Row[];
  const now = new Date();

  return rows.map((r) => mapRow(r, now));
}

/** Una fila cruda a un resultado. Compartido por la busqueda y los gemelos. */
function mapRow(r: Row, now: Date): SearchResult {
  const observedAt = new Date(r.observed_at);
  const sourceUpdatedAt = r.source_updated_at ? new Date(r.source_updated_at) : null;
  const recordType = r.record_type as RecordTypeV1;
  return {
    observationId: r.id,
    sourceRecordId: r.source_record_id,
    recordType,
    status: r.status as Status,
    title: r.title,
    description: r.description,
    categoryCodes: (r.category_codes ?? []) as Category[],
    admin2Name: r.admin2_name,
    locality: r.locality,
    displayAddress: r.display_address,
    openingHours: r.opening_hours,
    locationPrecision: r.location_precision as LocationPrecision,
    verificationLevel: r.verification_level as VerificationLevel,
    sourceUpdatedAt,
    observedAt,
    sourceName: r.source_name,
    sourceSlug: r.source_slug,
    sourceTrustLabel: r.trust_label,
    canonicalUrl: r.canonical_url,
    municipalityUnspecified: Boolean(r.municipality_unspecified),
    noLongerListed: Boolean(r.no_longer_listed),
    lastSeenAt: new Date(r.last_seen_at),
    contacts: r.contacts ?? [],
    // Freshness from what the source says, if it says it; otherwise from
    // when this system observed it.
    freshness: computeFreshness(recordType, sourceUpdatedAt ?? observedAt, now),
  };
}

/**
 * Direccion reducida a lo que la identifica, con las mismas reglas del lado
 * SQL de `findCompanions`. `translate` es inmutable, a diferencia de
 * `unaccent`, asi que no arrastra el problema que este proyecto ya evita.
 */
function addressKey(direccion: string): string | null {
  const s = direccion
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return s.length >= 8 ? s : null;
}

/**
 * Registros de OTRAS fuentes en la misma direccion que alguno de los
 * resultados, aunque no cumplan los filtros de la busqueda.
 *
 * Existe porque el aviso de "otra fuente podria estar hablando del mismo
 * lugar" se calcula sobre lo que ya esta en pantalla, y el filtro por tipo
 * dejaba fuera al gemelo: de seis direcciones repetidas en el Valle, cinco
 * estaban catalogadas como acopio en una fuente y como punto de servicio en
 * la otra, asi que nunca coincidian en la misma lista.
 *
 * No son resultados: no se cuentan ni se muestran como fichas. Solo permiten
 * decir "esto tambien lo reporta X, y lo reporta distinto".
 */
export async function findCompanions(results: readonly SearchResult[]): Promise<SearchResult[]> {
  const claves = new Map<string, true>();
  for (const r of results) {
    if (!r.displayAddress) continue;
    const k = addressKey(r.displayAddress);
    if (k) claves.set(k, true);
  }
  if (claves.size === 0) return [];

  const yaEstan = results.map((r) => r.sourceRecordId);
  const lista = sql.join(
    [...claves.keys()].map((k) => sql`${k}`),
    sql`, `,
  );
  const excluidos = sql.join(
    yaEstan.map((id) => sql`${id}`),
    sql`, `,
  );

  const query = sql`
    WITH latest AS (
      SELECT DISTINCT ON (o.source_record_id)
        o.id, o.source_record_id, o.record_type, o.status, o.title, o.description,
        o.category_codes, o.admin2_code, o.admin2_name, o.locality, o.display_address,
        o.opening_hours, o.location_precision, o.verification_level, o.source_updated_at,
        o.observed_at, o.search_text,
        sr.canonical_url, sr.last_seen_at, sr.contacts,
        MAX(sr.last_seen_at) OVER (PARTITION BY sr.source_id) AS source_last_read,
        s.name AS source_name, s.slug AS source_slug, s.trust_label, s.coverage_admin1_code
      FROM observations o
      JOIN source_records sr ON sr.id = o.source_record_id
      JOIN sources s ON s.id = sr.source_id
      WHERE sr.withdrawn_at IS NULL
        AND sr.hidden_at IS NULL
        AND s.enabled = true
        AND o.display_address IS NOT NULL
        AND ${excludeDemoSources()}
      ORDER BY o.source_record_id, o.observed_at DESC
    )
    SELECT
      l.*,
      0 AS rank,
      (l.admin2_code IS NULL) AS municipality_unspecified,
      (l.last_seen_at < l.source_last_read - INTERVAL '5 minutes') AS no_longer_listed
    FROM latest l
    WHERE l.status <> 'withdrawn'
      AND l.source_record_id NOT IN (${excluidos})
      AND regexp_replace(
            lower(translate(l.display_address, 'áéíóúüñÁÉÍÓÚÜÑ', 'aeiouunAEIOUUN')),
            '[^a-z0-9]', '', 'g'
          ) IN (${lista})
    LIMIT 40
  `;

  const rows = (await db.execute(query)) as unknown as Row[];
  const now = new Date();
  return rows.map((r) => mapRow(r, now));
}

export type DroppedFilter = "categories" | "types" | "text";

export type BroadenedSearch = {
  results: SearchResult[];
  /** Which filters had to be dropped to find anything. Empty when none were. */
  dropped: DroppedFilter[];
  /**
   * Registros de otras fuentes en la misma direccion que algun resultado, aun
   * si no cumplen los filtros. No son resultados: no se cuentan ni se muestran
   * como fichas, solo permiten decir "esto tambien lo reporta X".
   */
  companions: SearchResult[];
};

/**
 * Search, widening the filters when nothing matched.
 *
 * Zero results is the worst outcome this site can produce: someone asked where
 * to take water and got a blank page while the answer was one filter away.
 * Real examples that used to return nothing — "donde recibo panales" narrowed
 * to service_point when diapers are at collection points, and "hubo replicas
 * anoche" carrying junk categories that excluded every seismic event.
 *
 * Widening goes least-to-most informative: categories are inferred from
 * keywords and are the easiest to get wrong, so they drop first. The
 * municipality is NEVER dropped — someone in Palmira does not want Cartago.
 * What was dropped is returned so the interface can say so instead of quietly
 * answering a different question.
 */
async function withCompanions(
  results: SearchResult[],
  dropped: DroppedFilter[],
): Promise<BroadenedSearch> {
  return { results, dropped, companions: await findCompanions(results) };
}

export async function searchWithFallback(filters: SearchFilters): Promise<BroadenedSearch> {
  const exact = await searchRecords(filters);
  if (exact.length > 0) return withCompanions(exact, []);

  /**
   * Al ampliar, el texto que se deja de exigir pasa a ordenar.
   *
   * Antes se tiraba. Preguntando "hay colegios que sean puntos de albergue en
   * Cali" no habia ningun albergue con la palabra colegio, asi que se ampliaba
   * y salian ocho albergues en el orden de siempre: la unica palabra que decia
   * QUE clase de albergue se buscaba desaparecia sin dejar rastro.
   *
   * Degradarla de filtro a orden no puede vaciar la respuesta —ordenar nunca
   * excluye— y sube al principio lo que si se parece a lo que preguntaron.
   */
  const ordenarPor = (f: SearchFilters) => f.rankBy ?? f.q ?? null;

  /** Anything left to narrow by. No filters would mean "the whole catalog". */
  const stillNarrows = (f: SearchFilters) =>
    Boolean(f.q) ||
    (f.types?.length ?? 0) > 0 ||
    (f.categories?.length ?? 0) > 0 ||
    Boolean(f.admin2Code);

  // The free text goes FIRST, because it is the least trustworthy filter: it
  // is whatever words were left over after the municipality, the type and the
  // categories were taken out, and no record has to contain them. Asked "no
  // tengo dónde dormir" the reader correctly understood the category
  // "alojamiento", but the leftover text matched nothing and the answer was
  // "nadie publica alojamiento" while a shelter sat in the catalog. The person
  // with the least options got the emptiest answer.
  if (filters.q) {
    const next: SearchFilters = { ...filters, q: null, rankBy: ordenarPor(filters) };
    if (stillNarrows(next)) {
      const widened = await searchRecords(next);
      if (widened.length > 0) return withCompanions(widened, ["text"]);
    }
  }

  // Then the categories, which refine a search rather than define it. With no
  // "albergue con agua" it is better to offer albergues than to offer anything
  // at all that has water.
  if (filters.categories?.length) {
    const next: SearchFilters = {
      ...filters,
      q: null,
      rankBy: ordenarPor(filters),
      categories: [],
    };
    if (stillNarrows(next)) {
      const widened = await searchRecords(next);
      if (widened.length > 0) {
        return withCompanions(widened, filters.q ? ["text", "categories"] : ["categories"]);
      }
    }
  }

  // The record type last: it is the closest thing to what was actually asked
  // for. The municipality is never dropped — someone in Palmira is not helped
  // by a collection point in Cali.
  if (filters.types?.length) {
    const next: SearchFilters = {
      ...filters,
      q: null,
      rankBy: ordenarPor(filters),
      categories: [],
      types: [],
    };
    if (stillNarrows(next)) {
      const widened = await searchRecords(next);
      if (widened.length > 0) {
        const dropped: DroppedFilter[] = ["types"];
        if (filters.categories?.length) dropped.unshift("categories");
        if (filters.q) dropped.unshift("text");
        return withCompanions(widened, dropped);
      }
    }
  }

  return { results: [], dropped: [], companions: [] };
}

export type CatalogStats = {
  sourceCount: number;
  recordCount: number;
  /** Last successful read: says the pipeline is alive. */
  lastReadAt: Date | null;
  /**
   * The newest change published by a source, among record types that can go
   * stale: says how old the information is. Not `observed_at`, which moves on
   * any change at all — including a new earthquake every few hours — and made
   * the line read "hace 2 horas" over a catalogue twenty days old.
   */
  lastPerishableUpdateAt: Date | null;
};

/**
 * Live counts for the status line under the search box: how many sources are
 * connected, how many records they carry, and when any of them was last
 * read. Computed fresh on every call, same as `searchRecords` — this is
 * catalog-wide, not a search result, but the same rule applies: never cached,
 * because a stale "read 2 minutes ago" is exactly the kind of confidence this
 * project exists not to fake.
 */
export async function getCatalogStats(): Promise<CatalogStats> {
  const integrity = await checkProductionDataIntegrity();

  // Same idiom as the filters in `searchRecords`: a parameter list, not a JS
  // array. `= ANY(...)` binds the array as a single parameter and Postgres
  // answers "requires array on right side".
  const perishableList = sql.join(
    PERISHABLE_RECORD_TYPES.map((t) => sql`${t}`),
    sql`, `,
  );
  if (!integrity.ok)
    return { sourceCount: 0, recordCount: 0, lastReadAt: null, lastPerishableUpdateAt: null };

  const [sourceRows, latestRows] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS source_count
      FROM sources s
      WHERE s.enabled = true AND ${excludeDemoSources()}
    `) as unknown as Promise<{ source_count: number }[]>,
    db.execute(sql`
      WITH latest AS (
        SELECT DISTINCT ON (o.source_record_id)
          sr.last_seen_at, o.source_updated_at, o.record_type
        FROM observations o
        JOIN source_records sr ON sr.id = o.source_record_id
        JOIN sources s ON s.id = sr.source_id
        WHERE sr.withdrawn_at IS NULL
          AND sr.hidden_at IS NULL
          AND s.enabled = true
          AND ${excludeDemoSources()}
        ORDER BY o.source_record_id, o.observed_at DESC
      )
      SELECT COUNT(*)::int AS record_count,
             MAX(last_seen_at) AS last_read_at,
             -- Only the types that can go stale. The ones that cannot -- an
             -- earthquake, a communique valid until replaced -- never age, and
             -- including them is what let one automated feed hide twenty days
             -- of silence everywhere else. The list comes from
             -- FRESHNESS_WINDOW_MINUTES, not from a new judgement.
             MAX(source_updated_at) FILTER (
               WHERE record_type IN (${perishableList})
             ) AS last_perishable_update_at
      FROM latest
    `) as unknown as Promise<
      {
        record_count: number;
        last_read_at: string | Date | null;
        last_perishable_update_at: string | Date | null;
      }[]
    >,
  ]);

  return {
    sourceCount: sourceRows[0]?.source_count ?? 0,
    recordCount: latestRows[0]?.record_count ?? 0,
    lastReadAt: latestRows[0]?.last_read_at ? new Date(latestRows[0].last_read_at) : null,
    lastPerishableUpdateAt: latestRows[0]?.last_perishable_update_at
      ? new Date(latestRows[0].last_perishable_update_at)
      : null,
  };
}

/** A record's full history: all its observations, unmerged. */
export async function getRecordObservations(sourceRecordId: number) {
  const query = sql`
    SELECT o.*, s.name AS source_name, s.slug AS source_slug, sr.canonical_url
    FROM observations o
    JOIN source_records sr ON sr.id = o.source_record_id
    JOIN sources s ON s.id = sr.source_id
    WHERE o.source_record_id = ${sourceRecordId}
      AND sr.hidden_at IS NULL
    ORDER BY o.observed_at DESC
  `;
  return (await db.execute(query)) as unknown as (Row & { search_text: string })[];
}
