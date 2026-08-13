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
 * to be trusted; here it shows its work — reading dates in one column and
 * what changed in the other, like a log rather than a narrative, because
 * here the order and the timing genuinely carry information.
 */
export default async function RecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sourceRecordId = Number.parseInt(id, 10);
  if (!Number.isInteger(sourceRecordId) || sourceRecordId <= 0) notFound();

  const rows = await getRecordObservations(sourceRecordId);
  if (rows.length === 0) notFound();

  const latest = rows[0]!;
  const hasAddress = Boolean(latest.display_address);
  const headline = latest.display_address ?? latest.title;

  return (
    <div className="flex flex-col gap-5 px-5">
      <Link
        href="/"
        className="label border-rule hover:border-accent inline-flex w-fit items-center gap-1.5 border px-3 py-2.5"
      >
        ← Volver a los resultados
      </Link>

      <div className="flex flex-col gap-2">
        <span className="label text-muted">
          {RECORD_TYPE_LABELS[latest.record_type as RecordTypeV1] ?? latest.record_type}
          {latest.admin2_name ? ` · ${latest.admin2_name}` : ""}
        </span>
        <h2 className="font-display text-[1.6rem] leading-[1.05] font-bold">{headline}</h2>
        {hasAddress ? (
          <p className="text-muted text-[0.98rem] leading-snug font-semibold">{latest.title}</p>
        ) : null}
        <p className="text-[0.92rem] leading-relaxed">
          Cada vez que leemos {latest.source_name} guardamos lo que decía. Nada se sobreescribe,
          así podés ver qué cambió.
        </p>
      </div>

      <div className="border-rule flex flex-col border-t">
        {rows.map((o, i) => {
          const observedAt = new Date(o.observed_at);
          const sourceUpdatedAt = o.source_updated_at ? new Date(o.source_updated_at) : null;
          const categories = (o.category_codes ?? []) as Category[];
          const isCurrent = i === 0;

          return (
            <div key={o.id} className="border-border flex gap-3 border-b py-3">
              <div className="stamp text-muted w-[4.4rem] shrink-0" title={absoluteTime(observedAt)}>
                {relativeTime(observedAt)}
              </div>
              <div className="flex flex-col gap-1.5">
                {isCurrent ? (
                  <span className="label bg-official-bg text-official-text self-start px-1.5 py-0.5">
                    Como está ahora
                  </span>
                ) : null}
                <p className="text-[0.98rem] leading-snug font-semibold">
                  {STATUS_LABELS[o.status as Status] ?? o.status} · {o.title}
                </p>
                {o.description ? (
                  <p className="text-[0.9rem] leading-relaxed">{o.description}</p>
                ) : null}
                {categories.length > 0 ? (
                  <p className="text-muted text-[0.82rem]">
                    {categories.map((c) => CATEGORY_LABELS[c] ?? c).join(" · ")}
                  </p>
                ) : null}
                <p className="stamp text-muted">
                  {sourceUpdatedAt
                    ? `La fuente dice que se actualizó ${relativeTime(sourceUpdatedAt)}.`
                    : "La fuente no publica fecha de actualización."}{" "}
                  {verificationLabel(o.verification_level as VerificationLevel, o.source_name)}.
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {latest.canonical_url ? (
        <a
          href={latest.canonical_url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="bg-official-bg text-official-text flex min-h-[3rem] items-center justify-center text-[0.92rem] font-semibold"
        >
          Ver el original en {latest.source_name} ↗
        </a>
      ) : null}
    </div>
  );
}
