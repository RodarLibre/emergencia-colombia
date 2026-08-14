import Link from "next/link";

import type { SourceContact } from "@/db/schema";

import { relativeTime } from "@/lib/format";
import type { SearchResult } from "@/lib/search";
import {
  CATEGORY_LABELS,
  FRESHNESS_LABELS,
  RECORD_TYPE_LABELS,
  STATUS_LABELS,
  verificationLabel,
  type Category,
} from "@/lib/vocab";

/**
 * One notice on the board — but the unit of information here is the PLACE a
 * person is going, not the notice about it. The address leads as the
 * headline when a source published one; the organisation's own name drops to
 * a subtitle. Nobody reads a bulletin during an emergency; they decide where
 * to drive.
 *
 * A bordered sheet with a band across its top, not a floating card. The band
 * encodes how much to trust the entry before driving there — official,
 * confirmed recently, not reconfirmed, or closed — in the same family of
 * colours used everywhere else on the site, so the state reads before any
 * word does.
 */
function band(result: SearchResult): { className: string; label: string } {
  const lastUpdate = result.sourceUpdatedAt ?? result.observedAt;
  const isClosed = result.status === "closed" || result.status === "fulfilled";

  // Above everything else, including "official": the source read fine and no
  // longer lists this. Whatever it said before, nobody is standing behind it
  // now, and that is what someone about to drive there needs first.
  if (result.noLongerListed) {
    return {
      className: "bg-warn-bg text-warn-text border-warn-border border-b",
      label: `La fuente ya no lo publica · visto ${relativeTime(result.lastSeenAt)}`,
    };
  }
  if (result.verificationLevel === "official") {
    return {
      className: "bg-official-bg text-official-text",
      label: `Fuente oficial · ${relativeTime(lastUpdate)}`,
    };
  }
  if (isClosed) {
    return {
      className: "bg-surface-2 text-muted border-border border-b",
      label: `${STATUS_LABELS[result.status]} · ${relativeTime(lastUpdate)}`,
    };
  }
  if (result.freshness === "fresh") {
    return {
      className: "bg-accent-soft text-band-fresh-text border-rule border-b",
      label: `${FRESHNESS_LABELS.fresh} ${relativeTime(lastUpdate)}`,
    };
  }
  return {
    className: "bg-warn-bg text-warn-text border-warn-border border-b",
    label: `${FRESHNESS_LABELS[result.freshness]} ${relativeTime(lastUpdate)}`,
  };
}

/** Un WhatsApp se abre en WhatsApp; un correo en el correo. */
function enlaceDeContacto(c: SourceContact): string {
  if (c.kind === "whatsapp") return `https://wa.me/${c.value.replace(/[^0-9]/g, "")}`;
  if (c.kind === "correo") return `mailto:${c.value}`;
  return `tel:${c.value.replace(/[^0-9+]/g, "")}`;
}

export function ResultCard({
  result,
  sameplace,
  disagrees,
  /**
   * true when another result in the list shares this title. Only matters
   * when the title IS the headline (no address) — there are 17 "Centro
   * Temporal de Acopio" with 17 different addresses, and when an address is
   * available it already disambiguates them on its own.
   */
  titleRepeats,
  /** Categories the current search matched on, so their chips read as "on" rather than merely listed. */
  matchedCategories,
}: {
  result: SearchResult;
  sameplace?: readonly SearchResult[];
  disagrees?: boolean;
  titleRepeats?: boolean;
  matchedCategories?: ReadonlySet<Category>;
}) {
  const { className: bandClassName, label: bandLabel } = band(result);
  const hasAddress = Boolean(result.displayAddress);
  const headline = result.displayAddress ?? result.title;
  const distinguisher = result.locality ?? result.admin2Name;

  return (
    <article className="border-border bg-surface border">
      <div className={`flex items-center justify-between gap-2 px-3 py-1.5 ${bandClassName}`}>
        <span className="label">{bandLabel}</span>
        <span className="label shrink-0 opacity-80 whitespace-nowrap">
          {RECORD_TYPE_LABELS[result.recordType] ?? result.recordType}
        </span>
      </div>

      <div className="flex flex-col gap-2 p-3">
        <h3 className="font-display text-[1.3rem] leading-tight font-bold">
          {headline}
          {titleRepeats && !hasAddress && distinguisher ? (
            <span className="text-muted font-normal"> · {distinguisher}</span>
          ) : null}
        </h3>

        {hasAddress && result.admin2Name ? (
          <p className="text-[0.95rem] leading-snug">
            {result.locality ? `${result.locality}, ` : ""}
            <strong className="font-semibold">{result.admin2Name}</strong>
          </p>
        ) : null}

        {result.openingHours ? (
          <p className="text-band-fresh-text text-[0.95rem] leading-snug font-semibold">
            {result.openingHours}
          </p>
        ) : null}

        {sameplace && sameplace.length > 0 ? (
          <div className="border-warn-border bg-warn-bg text-warn-text border-l-4 p-2.5 text-[0.85rem] leading-relaxed">
            {disagrees ? (
              <strong className="block font-semibold">Dos fuentes se contradicen.</strong>
            ) : null}
            Otra fuente podría hablar del mismo lugar:{" "}
            {sameplace.map((o, i) => (
              <span key={o.sourceRecordId}>
                {i > 0 ? ", " : ""}
                {o.sourceName} lo reporta como {STATUS_LABELS[o.status].toLowerCase()}
              </span>
            ))}
            . No se fusionaron los reportes: confirmá con la fuente.
          </div>
        ) : null}

        {result.categoryCodes.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {result.categoryCodes.map((c) => {
              const on = matchedCategories?.has(c) ?? false;
              return (
                <span
                  key={c}
                  className={
                    on
                      ? "label bg-official-bg text-official-text px-1.5 py-1"
                      : "label border-rule text-muted border px-1.5 py-1"
                  }
                >
                  {CATEGORY_LABELS[c] ?? c}
                </span>
              );
            })}
          </div>
        ) : null}

        {hasAddress ? (
          <p className="font-display text-muted text-[1rem] leading-tight font-semibold">
            {result.title}
          </p>
        ) : null}

        {result.description ? (
          <p className="text-[0.9rem] leading-relaxed">{result.description}</p>
        ) : null}

        <div className="border-border mt-1 flex flex-col gap-1.5 border-t pt-2.5">
          {/* Whenever the place line above didn't render (no address, or no municipality to bold), the location goes here instead. */}
          {!result.admin2Name ? (
            <p className="stamp text-muted">
              {result.municipalityUnspecified
                ? `La fuente no dijo en qué municipio queda. Aparece porque ${result.sourceName} cubre el Valle.`
                : `${result.locality ? `${result.locality}, ` : ""}ubicación no especificada`}
            </p>
          ) : !hasAddress && result.locality ? (
            <p className="stamp text-muted">
              {result.locality}, {result.admin2Name}
            </p>
          ) : null}
          <p className="stamp text-muted">
            {verificationLabel(result.verificationLevel, result.sourceName)}
          </p>

          {result.contacts.length > 0 ? (
            <div className="border-border flex flex-col gap-1 border-t pt-2">
              {result.contacts.map((c) => (
                <a
                  key={`${c.kind}:${c.value}`}
                  href={enlaceDeContacto(c)}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="text-accent text-[0.92rem] font-semibold underline underline-offset-2"
                >
                  {c.label ? `${c.label} · ` : ""}
                  {c.value}
                </a>
              ))}
              {/* Se dice de quien es el dato: no es nuestro, es de la fuente,
                  y es ella quien tiene la autorizacion de esa persona. */}
              <p className="stamp text-muted">Contacto publicado por {result.sourceName}</p>
            </div>
          ) : null}

          <div className="flex gap-1.5">
            {result.canonicalUrl ? (
              <a
                href={result.canonicalUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="bg-official-bg text-official-text flex min-h-[2.9rem] flex-1 items-center justify-center text-[0.88rem] font-semibold"
              >
                Ver el original ↗
              </a>
            ) : null}
            <Link
              href={`/r/${result.sourceRecordId}`}
              className={`border-border text-muted flex min-h-[2.9rem] items-center justify-center border px-3 text-[0.88rem] ${
                result.canonicalUrl ? "" : "flex-1"
              }`}
            >
              Cambios
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
