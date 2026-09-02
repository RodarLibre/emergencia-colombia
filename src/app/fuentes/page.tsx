import { sql } from "drizzle-orm";

import { db } from "@/db";
import { sourceStatusLabel } from "@/lib/source-status";

export const dynamic = "force-dynamic";

type Row = {
  slug: string;
  name: string;
  base_url: string;
  mode: string;
  trust_label: string;
  enabled: boolean;
  records: number;
  /**
   * When the source was last read successfully, and when it last changed.
   *
   * Not the same thing, and conflating them was the bug: `observed_at` only
   * moves when a new observation lands, which is when the source changed. A
   * source read every fifteen minutes with nothing new leaves it frozen, and
   * the band said "Leída hace 19 días" about something just read.
   */
  last_read_at: string | null;
  last_changed_at: string | null;
  with_municipality: number;
  with_address: number;
  /** Records the source explicitly withdrew. See invariant 3. */
  withdrawn: number;
};

const MODE_LABELS: Record<string, string> = {
  official_api: "API oficial",
  partner_feed: "Feed acordado con la fuente",
  public_html: "Lectura de páginas públicas",
  sitemap_html: "Lectura del listado que la fuente marca indexable",
  // The source publishes it openly and documented, for anyone: it is not a
  // permission granted to us, and "acordado" would tell that wrong.
  cabuya_feed: "Feed abierto · Protocolo Cabuya",
  manual: "Carga manual",
};

const TRUST_LABELS: Record<string, string> = {
  official: "Oficial",
  ngo: "Organización",
  community: "Comunitaria",
};

/** Same band language as `ResultCard`: how much to trust an entry reads before any word does. */
function sourceBand(r: Row): { className: string; label: string } {
  const label = sourceStatusLabel({
    enabled: r.enabled,
    records: r.records,
    withdrawn: r.withdrawn,
    lastReadAt: r.last_read_at ? new Date(r.last_read_at) : null,
    lastChangedAt: r.last_changed_at ? new Date(r.last_changed_at) : null,
  });

  const muted = { className: "bg-surface-2 text-muted border-border border-b", label };
  if (!r.enabled) return muted;
  if (r.withdrawn > 0 && r.records === 0) return muted;
  if (!r.last_read_at) return muted;
  if (r.trust_label === "official") {
    return { className: "bg-official-bg text-official-text", label };
  }
  return { className: "bg-accent-soft text-band-fresh-text border-rule border-b", label };
}

/** "dondeayudo.co", not "https://www.dondeayudo.co/reportes" — the button names the site, not the path. */
function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

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
      MAX(l.observed_at) AS last_changed_at,
      -- The read comes from \`last_seen_at\`, which every run updates whether
      -- or not anything changed. Same expression as \`sourcesHealth\` in
      -- \`lib/usage.ts\` and \`source_last_read\` in \`lib/search.ts\`: the stamp
      -- of the last ingest that actually worked.
      --
      -- Aggregated separately rather than JOINed to \`source_records\`: joined
      -- here it multiplies rows against \`latest\` and COUNT(l.record_id) starts
      -- counting the product. Measured: 9025 records instead of 95.
      r.last_read_at,
      COUNT(l.record_id) FILTER (WHERE l.admin2_code IS NOT NULL)::int AS with_municipality,
      COUNT(l.record_id) FILTER (WHERE l.display_address IS NOT NULL)::int AS with_address,
      -- Counted apart from \`latest\`, which excludes withdrawn records on
      -- purpose. Without this a source that closed shows zero records and no
      -- date, i.e. identical to one never read, which is the opposite of what
      -- happened.
      COALESCE(w.n, 0)::int AS withdrawn
    FROM sources s
    LEFT JOIN latest l ON l.source_id = s.id
    LEFT JOIN (
      SELECT source_id, MAX(last_seen_at) AS last_read_at
      FROM source_records WHERE withdrawn_at IS NULL GROUP BY source_id
    ) r ON r.source_id = s.id
    LEFT JOIN (
      SELECT source_id, COUNT(*)::int AS n
      FROM source_records WHERE withdrawn_at IS NOT NULL GROUP BY source_id
    ) w ON w.source_id = s.id
    GROUP BY s.id, s.slug, s.name, s.base_url, s.mode, s.trust_label, s.enabled, w.n,
             r.last_read_at
    ORDER BY s.enabled DESC, s.name
  `)) as unknown as Row[];

  const enabled = rows.filter((r) => r.enabled);
  const totalRecords = enabled.reduce((sum, r) => sum + r.records, 0);
  const lastRead = enabled.reduce<Date | null>((max, r) => {
    if (!r.last_read_at) return max;
    const t = new Date(r.last_read_at);
    return !max || t > max ? t : max;
  }, null);

  return (
    <div className="flex flex-col gap-5 px-5">
      <div className="flex flex-col gap-2">
        {rows.length > 0 ? (
          <h2 className="font-display text-[1.6rem] leading-[1.05] font-bold text-balance">
            {enabled.length} {enabled.length === 1 ? "sitio conectado" : "sitios conectados"}.{" "}
            {totalRecords} {totalRecords === 1 ? "aviso" : "avisos"}.
          </h2>
        ) : (
          <h2 className="font-display text-[1.6rem] leading-[1.05] font-bold">Fuentes</h2>
        )}
        <p className="text-[0.95rem] leading-relaxed">
          Nada de esto lo publicamos nosotros. Si tu búsqueda no encontró nada, entrá directo a cada
          sitio.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted text-[0.9rem]">
          Todavía no hay fuentes registradas. Corré <code className="stamp">pnpm db:seed</code> para
          cargar datos de prueba.
        </p>
      ) : (
        <>
          {enabled.length > 0 ? (
            <div className="border-border bg-surface flex gap-5 border p-3">
              <div>
                <div className="font-mono text-[1.3rem] leading-none font-medium">
                  {totalRecords}
                </div>
                <div className="label text-muted">registros</div>
              </div>
              <div>
                <div className="font-mono text-[1.3rem] leading-none font-medium">
                  {enabled.length}
                </div>
                <div className="label text-muted">conectadas</div>
              </div>
              {lastRead ? (
                <div>
                  <div className="font-mono text-[1.3rem] leading-none font-medium">
                    {new Intl.DateTimeFormat("es-CO", {
                      hour: "2-digit",
                      minute: "2-digit",
                      hour12: false,
                      timeZone: "America/Bogota",
                    }).format(lastRead)}
                  </div>
                  <div className="label text-muted">última lectura</div>
                </div>
              ) : null}
            </div>
          ) : null}

          <ul className="flex flex-col gap-3">
            {rows.map((r) => {
              const b = sourceBand(r);
              return (
                <li key={r.slug}>
                  <article className="border-border border">
                    <div
                      className={`flex items-center justify-between gap-2 px-3 py-1.5 ${b.className}`}
                    >
                      <span className="label shrink-0 whitespace-nowrap">
                        {TRUST_LABELS[r.trust_label] ?? r.trust_label}
                      </span>
                      {/* `text-balance` porque la etiqueta ahora puede traer dos hechos y en
                          un teléfono parte en dos líneas: sin esto la segunda queda con una
                          palabra suelta a la derecha y parece un error de render. */}
                      <span className="label text-right text-balance opacity-80">{b.label}</span>
                    </div>

                    <div className="flex flex-col gap-2 p-3">
                      <p className="font-display text-[1.15rem] leading-tight font-bold">
                        {r.name}
                      </p>
                      <p className="text-muted text-[0.88rem] leading-snug">
                        {MODE_LABELS[r.mode] ?? r.mode}
                      </p>

                      {r.enabled && r.records > 0 ? (
                        <p className="stamp">
                          <strong className="text-text font-medium">{r.records}</strong> avisos ·{" "}
                          {r.with_address} con dirección
                        </p>
                      ) : null}

                      {r.enabled ? (
                        <a
                          href={r.base_url}
                          target="_blank"
                          rel="noopener noreferrer nofollow"
                          className="border-official-bg text-official-bg mt-1 flex min-h-[2.9rem] items-center justify-center border text-[0.9rem] font-semibold"
                        >
                          Abrir {hostname(r.base_url)} ↗
                        </a>
                      ) : null}
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <div className="border-rule flex flex-col gap-2 border-t pt-4">
        <h3 className="font-display text-[1.15rem] leading-tight font-semibold">
          ¿Es tuyo uno de estos sitios?
        </h3>
        <p className="text-[0.9rem] leading-relaxed">
          Escribinos para cambiar cómo se lee tu sitio, o para retirar un registro: se atiende antes
          que cualquier otra tarea. Lo que se retira no vuelve a entrar en lecturas posteriores.
        </p>
      </div>
    </div>
  );
}
