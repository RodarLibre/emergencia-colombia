import { relativeTime } from "./format";
import {
  FRESHNESS_LABELS,
  STATUS_LABELS,
  type FreshnessState,
  type Status,
  type VerificationLevel,
} from "./vocab";

/**
 * What the band across the top of a result says, and why.
 *
 * Pure and in its own file so the wording can be tested without rendering
 * anything — vitest only collects `.test.ts`, and this decision had already
 * been wrong twice while living inside `ResultCard.tsx` where nothing could
 * reach it. Same split as `source-status.ts`: this decides what is true about
 * a result; the component decides what colour that is.
 *
 * The band is read before any word on the card, by somebody deciding whether
 * to drive somewhere. Everything below is ordered by what that person needs
 * first, not by what is easiest to compute.
 */

/** Only the fields the wording depends on. */
export type ResultBandInput = {
  status: Status;
  freshness: FreshnessState;
  verificationLevel: VerificationLevel;
  /** The source read fine and stopped listing this record. */
  noLongerListed: boolean;
  /** What the source says it last changed; null when it publishes no date. */
  sourceUpdatedAt: Date | null;
  /** When we recorded the observation being shown. */
  observedAt: Date;
  /** When we last saw the record at all, changed or not. */
  lastSeenAt: Date;
};

/**
 * The state the band reports. Named for what is true, not for a colour: three
 * of these share a style today and that is the component's business, not this
 * file's.
 */
export type ResultBandTone =
  "no_longer_listed" | "official" | "closed" | "unknown" | "fresh" | "unconfirmed";

export type ResultBand = { tone: ResultBandTone; label: string };

export function resultBand(result: ResultBandInput, now: Date = new Date()): ResultBand {
  // Freshness is computed from what the source says, and falls back to when we
  // observed it when the source publishes no date. That fallback is why the
  // branches below that can afford to use `lastSeenAt` do: for a record whose
  // source stamps nothing, `observedAt` moves every time WE re-read it, which
  // reads as somebody having confirmed it.
  const lastUpdate = result.sourceUpdatedAt ?? result.observedAt;

  // Above everything else, including "official": the source read fine and no
  // longer lists this. Whatever it said before, nobody is standing behind it
  // now, and that is what someone about to drive there needs first.
  if (result.noLongerListed) {
    return {
      tone: "no_longer_listed",
      // "La fuente ya no lo publica" hacía pensar en un detalle editorial. Lo
      // que hay que entender antes de manejar hasta allá es que el dato está
      // viejo y que quien lo publicó lo quitó.
      label: `Desactualizada, eliminada por la fuente · vista ${relativeTime(result.lastSeenAt, now)}`,
    };
  }

  if (result.verificationLevel === "official") {
    return { tone: "official", label: `Fuente oficial · ${relativeTime(lastUpdate, now)}` };
  }

  // "Atendido" is not "cerrado", but both mean the same thing to somebody
  // holding a box: do not drive here expecting to hand it over.
  if (result.status === "closed" || result.status === "fulfilled") {
    return {
      tone: "closed",
      label: `${STATUS_LABELS[result.status]} · ${relativeTime(lastUpdate, now)}`,
    };
  }

  // "Sin dato" before freshness, because the two answer different questions
  // and freshness answers the one nobody asked: it says "Confirmado" about how
  // recent OUR read is, not about the place operating. Without this branch
  // "Clínica Los Nevados — EVACUADA", whose ficha reads "Ojo: No vaya",
  // carried the label "Confirmado hace 2 min".
  if (result.status === "unknown") {
    return {
      tone: "unknown",
      label: `${STATUS_LABELS.unknown} · visto ${relativeTime(result.lastSeenAt, now)}`,
    };
  }

  if (result.freshness === "fresh") {
    return { tone: "fresh", label: `${FRESHNESS_LABELS.fresh} ${relativeTime(lastUpdate, now)}` };
  }

  return {
    tone: "unconfirmed",
    label: `${FRESHNESS_LABELS[result.freshness]} ${relativeTime(lastUpdate, now)}`,
  };
}
