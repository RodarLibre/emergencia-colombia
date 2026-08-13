import { sql } from "drizzle-orm";

import { db } from "@/db";
import { relativeTime } from "@/lib/format";

export const dynamic = "force-dynamic";

type Row = {
  slug: string;
  name: string;
  base_url: string;
  mode: string;
  trust_label: string;
  enabled: boolean;
  records: number;
  last_observed_at: string | null;
  with_municipality: number;
  with_address: number;
};

const MODE_LABELS: Record<string, string> = {
  official_api: "API oficial",
  partner_feed: "Feed acordado con la fuente",
  public_html: "Lectura de páginas públicas",
  manual: "Carga manual",
};

const TRUST_LABELS: Record<string, string> = {
  official: "Oficial",
  ngo: "Organización",
  community: "Comunitaria",
};

/**
 * Sources directory.
 *
 * Two jobs: being transparent about where each piece of data comes from, and
 * being an exit when the search finds nothing — if a source is not connected
 * yet, the direct link is still worth having.
 *
 * Stacked entries rather than a table. The same five fields as columns turned
 * into 60px of width each on a phone and broke words mid-syllable: "Com unita
 * ria". A table that has to be read sideways is not a table.
 */
export default async function FuentesPage() {
  // Completeness is measured over each record's LATEST observation, not over
  // any point in its history: if an old observation had a municipality and
  // it got corrected to null, the count has to reflect the current state.
  const rows = (await db.execute(sql`
    WITH latest AS (
      SELECT DISTINCT ON (o.source_record_id)
        sr.source_id,
        sr.id AS record_id,
        o.admin2_code,
        o.display_address,
        o.observed_at
      FROM observations o
      JOIN source_records sr ON sr.id = o.source_record_id
      WHERE sr.withdrawn_at IS NULL AND sr.hidden_at IS NULL
      ORDER BY o.source_record_id, o.observed_at DESC
    )
    SELECT
      s.slug,
      s.name,
      s.base_url,
      s.mode,
      s.trust_label,
      s.enabled,
      COUNT(l.record_id)::int AS records,
      MAX(l.observed_at) AS last_observed_at,
      COUNT(l.record_id) FILTER (WHERE l.admin2_code IS NOT NULL)::int AS with_municipality,
      COUNT(l.record_id) FILTER (WHERE l.display_address IS NOT NULL)::int AS with_address
    FROM sources s
    LEFT JOIN latest l ON l.source_id = s.id
    GROUP BY s.id, s.slug, s.name, s.base_url, s.mode, s.trust_label, s.enabled
    ORDER BY s.enabled DESC, s.name
  `)) as unknown as Row[];

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 className="font-display text-[1.5rem] leading-tight font-semibold">Fuentes</h2>
        <p className="text-muted text-[0.9rem] leading-relaxed">
          Este sitio no publica información propia: lee lo que publican otros y conserva su enlace y
          su fecha. Una fuente solo se activa cuando hay base para leerla — una API oficial, permiso
          de la fuente, o páginas públicas que lo permitan.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted text-[0.9rem]">
          Todavía no hay fuentes registradas. Corré <code className="stamp">pnpm db:seed</code> para
          cargar datos de prueba.
        </p>
      ) : (
        <ul className="border-rule divide-border flex flex-col divide-y border-y">
          {rows.map((r) => (
            <li key={r.slug} className="flex flex-col gap-1.5 py-3">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="label text-muted">
                  {TRUST_LABELS[r.trust_label] ?? r.trust_label}
                </span>
                {!r.enabled ? (
                  <span className="label text-muted">· no conectada todavía</span>
                ) : null}
              </div>

              <a
                className="font-display text-accent text-[1.1rem] leading-tight font-semibold underline underline-offset-2"
                href={r.base_url}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                {r.name}
              </a>

              <p className="text-muted text-[0.85rem] leading-snug">
                {MODE_LABELS[r.mode] ?? r.mode}
              </p>

              {r.enabled && r.records > 0 ? (
                <p className="stamp text-muted">
                  <span className="text-text">{r.records}</span> registros · {r.with_municipality}/
                  {r.records} con municipio · {r.with_address}/{r.records} con dirección
                  <br />
                  leída {r.last_observed_at ? relativeTime(new Date(r.last_observed_at)) : "nunca"}
                </p>
              ) : (
                <p className="stamp text-muted">Sin lecturas todavía</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="font-display text-[1.15rem] leading-tight font-semibold">
          Corregir o retirar información
        </h3>
        <p className="text-[0.9rem] leading-relaxed">
          Si administrás una de estas fuentes y querés cambiar cómo se lee tu sitio, o si un
          registro debe corregirse o retirarse, escribinos y se atiende antes que cualquier otra
          tarea. Lo que la fuente retira se oculta y no vuelve a entrar en lecturas posteriores.
        </p>
      </div>
    </div>
  );
}
