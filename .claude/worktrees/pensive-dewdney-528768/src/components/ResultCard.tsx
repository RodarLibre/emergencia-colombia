import Link from "next/link";

import { absoluteTime, relativeTime } from "@/lib/format";
import type { SearchResult } from "@/lib/search";
import {
  CATEGORY_LABELS,
  FRESHNESS_LABELS,
  RECORD_TYPE_LABELS,
  STATUS_LABELS,
  verificationLabel,
} from "@/lib/vocab";

/** Types whose state changes fast enough to be worth confirming before travelling. */
const VOLATILE = new Set(["collection_point", "service_point", "shelter", "hazard"]);

/**
 * One notice on the board.
 *
 * Not a card: a ruled entry with a strip down its left edge. The strip encodes
 * how much to trust the entry before driving there — confirmed recently, not
 * reconfirmed, or closed — so the state reads before any word is read. It is
 * the first thing the eye gets and the last thing a person should ignore.
 */
function stripColor(result: SearchResult): string {
  if (result.status === "closed" || result.status === "fulfilled") return "bg-strip-closed";
  return result.freshness === "fresh" ? "bg-strip-fresh" : "bg-strip-aging";
}

export function ResultCard({
  result,
  sameplace,
  disagrees,
  /**
   * true when another result in the list shares this title. They are different
   * places with a generic name — there are 17 "Centro Temporal de Acopio" with
   * 17 different addresses — so the heading carries what distinguishes them.
   */
  titleRepeats,
}: {
  result: SearchResult;
  sameplace?: readonly SearchResult[];
  disagrees?: boolean;
  titleRepeats?: boolean;
}) {
  const lastUpdate = result.sourceUpdatedAt ?? result.observedAt;
  const isClosed = result.status === "closed" || result.status === "fulfilled";
  const distinguisher = result.locality ?? result.displayAddress ?? result.admin2Name;

  return (
    <article className="border-border bg-surface relative border-y border-r pl-4">
      <span
        aria-hidden="true"
        className={`absolute top-0 bottom-0 left-0 w-[3px] ${stripColor(result)}`}
      />

      <div className="flex flex-col gap-2 py-3 pr-4">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="label text-muted">
            {RECORD_TYPE_LABELS[result.recordType] ?? result.recordType}
          </span>
          {result.verificationLevel === "official" ? (
            <span className="label bg-official-bg text-official-text px-1.5 py-0.5">Oficial</span>
          ) : null}
          {isClosed ? (
            <span className="label text-muted">{STATUS_LABELS[result.status]}</span>
          ) : null}
        </div>

        <h3 className="font-display text-[1.15rem] leading-tight font-semibold">
          {result.title}
          {titleRepeats && distinguisher ? (
            <span className="text-muted font-normal"> · {distinguisher}</span>
          ) : null}
        </h3>

        {result.description ? (
          <p className="text-[0.9rem] leading-relaxed">{result.description}</p>
        ) : null}

        {/* Address and hours are what a person acts on: they come before everything else. */}
        {result.displayAddress ? (
          <p className="text-[0.95rem] leading-snug font-semibold">
            {result.displayAddress}
            {result.openingHours ? (
              <span className="text-muted block font-normal">{result.openingHours}</span>
            ) : null}
          </p>
        ) : null}

        {result.categoryCodes.length > 0 ? (
          <p className="text-muted text-[0.82rem] leading-relaxed">
            Recibe: {result.categoryCodes.map((c) => CATEGORY_LABELS[c] ?? c).join(" · ")}
          </p>
        ) : null}

        {result.freshness !== "fresh" ? (
          <p className="text-warn-text label !normal-case">{FRESHNESS_LABELS[result.freshness]}</p>
        ) : null}

        {/* Provenance, in the one face reserved for it. */}
        <div className="stamp text-muted border-border mt-1 border-t pt-2">
          <div>
            {result.locality ? `${result.locality}, ` : ""}
            {result.admin2Name ??
              (result.municipalityUnspecified
                ? "municipio no especificado por la fuente"
                : "ubicación no especificada")}
          </div>
          <div title={absoluteTime(lastUpdate)}>
            {verificationLabel(result.verificationLevel, result.sourceName)} · actualizado{" "}
            {relativeTime(lastUpdate)}
          </div>
          {/* Actions leave the provenance face: mono is for what a source
              said and when, not for things you can do. */}
          <div className="font-sans mt-2 flex flex-wrap gap-x-4 text-[0.82rem]">
            {result.canonicalUrl ? (
              <a
                className="text-accent underline underline-offset-2"
                href={result.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
              >
                Ver en {result.sourceName}
              </a>
            ) : null}
            <Link
              className="text-accent underline underline-offset-2"
              href={`/r/${result.sourceRecordId}`}
            >
              Historial
            </Link>
          </div>
        </div>

        {sameplace && sameplace.length > 0 ? (
          <p className="border-warn-border bg-warn-bg text-warn-text border-l-2 p-2 text-[0.82rem] leading-relaxed">
            {disagrees ? (
              <strong className="font-semibold">Las fuentes no coinciden. </strong>
            ) : null}
            Otra fuente podría estar hablando del mismo lugar:{" "}
            {sameplace.map((o, i) => (
              <span key={o.sourceRecordId}>
                {i > 0 ? ", " : ""}
                {o.sourceName} lo reporta como {STATUS_LABELS[o.status].toLowerCase()}
              </span>
            ))}
            . No se fusionaron los reportes: confirmá con la fuente.
          </p>
        ) : null}

        {VOLATILE.has(result.recordType) && !isClosed ? (
          <p className="text-muted text-[0.8rem] leading-relaxed">
            Confirmá antes de desplazarte. Esto cambia rápido y aquí no se verifica.
          </p>
        ) : null}
      </div>
    </article>
  );
}
