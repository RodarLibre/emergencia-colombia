import Link from "next/link";
import { notFound } from "next/navigation";

import { absoluteTime, relativeTime } from "@/lib/format";
import { getRecordObservations } from "@/lib/search";
import {
  CATEGORY_LABELS,
  RECORD_TYPE_LABELS,
  STATUS_LABELS,
  verificationLabel,
  type Category,
  type RecordTypeV1,
  type Status,
  type VerificationLevel,
} from "@/lib/vocab";

export const dynamic = "force-dynamic";

/**
 * A record's history.
 *
 * Observations are immutable: every change in the source creates a new one.
 * All of them are shown here, newest to oldest, without collapsing them — so
 * you can see what a place said three hours ago and what it says now.
 *
 * This is the page the whole project rests on. Everywhere else the site asks
 * to be trusted; here it shows its work. So the sequence is drawn as a
 * sequence — a rule running down the entries, with the reading marked on it —
 * because here the order genuinely carries information.
 */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sourceRecordId = Number.parseInt(id, 10);
  if (!Number.isInteger(sourceRecordId) || sourceRecordId <= 0) notFound();

  const rows = await getRecordObservations(sourceRecordId);
  if (rows.length === 0) notFound();

  const latest = rows[0]!;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/" className="label text-muted hover:text-accent">
        ← Volver a preguntar
      </Link>

      <div className="flex flex-col gap-2">
        <span className="label text-muted">
          {RECORD_TYPE_LABELS[latest.record_type as RecordTypeV1] ?? latest.record_type}
        </span>
        <h2 className="font-display text-[1.5rem] leading-tight font-semibold">{latest.title}</h2>
        <p className="stamp text-muted">
          {latest.admin2_name ?? "sin municipio"} · {rows.length}{" "}
          {rows.length === 1 ? "observación" : "observaciones"} · fuente: {latest.source_name}
        </p>
        {latest.canonical_url ? (
          <a
            className="text-accent text-[0.9rem] underline underline-offset-2"
            href={latest.canonical_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            Ver el original en {latest.source_name}
          </a>
        ) : null}
      </div>

      <p className="border-warn-border bg-warn-bg text-warn-text rounded-sm border-l-2 px-3 py-2.5 text-[0.88rem] leading-relaxed">
        Esto es lo que este sitio <strong className="font-semibold">observó</strong> en{" "}
        {latest.source_name}, no una verificación. La fuente puede haber cambiado algo que todavía
        no se ha leído.
      </p>

      <div className="flex flex-col gap-3">
        <h3 className="label text-muted">Historial de lecturas</h3>

        <ol className="border-rule flex flex-col gap-5 border-l pl-4">
          {rows.map((o, i) => {
            const observedAt = new Date(o.observed_at);
            const sourceUpdatedAt = o.source_updated_at ? new Date(o.source_updated_at) : null;
            const categories = (o.category_codes ?? []) as Category[];
            const isCurrent = i === 0;

            return (
              <li key={o.id} className="relative flex flex-col gap-1.5">
                {/* Sits on the rule, marking this reading on the timeline. */}
                <span
                  aria-hidden="true"
                  className={`absolute top-[0.42rem] -left-[1.3rem] h-2 w-2 rounded-full ${
                    isCurrent ? "bg-accent" : "bg-rule"
                  }`}
                />

                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className={`label ${isCurrent ? "text-accent" : "text-muted"}`}>
                    {isCurrent ? "Estado actual" : "Antes"}
                  </span>
                  <span className="text-muted text-[0.82rem]">
                    {STATUS_LABELS[o.status as Status] ?? o.status}
                  </span>
                </div>

                <p className="text-[1rem] leading-snug font-semibold">{o.title}</p>

                {o.description ? (
                  <p className="text-[0.9rem] leading-relaxed">{o.description}</p>
                ) : null}

                {categories.length > 0 ? (
                  <p className="text-muted text-[0.82rem]">
                    {categories.map((c) => CATEGORY_LABELS[c] ?? c).join(" · ")}
                  </p>
                ) : null}

                <div className="stamp text-muted" title={absoluteTime(observedAt)}>
                  <div>Leído {relativeTime(observedAt)}</div>
                  <div>
                    {sourceUpdatedAt
                      ? `La fuente dice que se actualizó ${relativeTime(sourceUpdatedAt)}`
                      : "La fuente no publica fecha de actualización"}
                  </div>
                  <div>
                    {verificationLabel(o.verification_level as VerificationLevel, o.source_name)}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
