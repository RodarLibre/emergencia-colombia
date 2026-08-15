"use server";

import { cookies, headers } from "next/headers";

import { db } from "@/db";
import { answerFeedback } from "@/db/schema";
import { composeAnswer, type Answer } from "@/lib/answer";
import { isBlocked, recordAbuseEvent } from "@/lib/abuse";
import { AI_LIMITS } from "@/lib/ai";
import {
  CONSENT_VERSION,
  cap,
  caseCode,
  mintTurnId,
  safeContext,
  textCaptureEnabled,
  validTurnId,
} from "@/lib/feedback";
import { PROMPT_VERSION, resolveQuestion, type OutOfScopeReason } from "@/lib/intent";
import { findMunicipalityOutsideCoverage, hasDomainSignal } from "@/lib/normalize";
import { CLIENT_IP_HEADER, FORWARDED_FOR_HEADER } from "@/lib/client-ip";
import { clientKey, consumeAiQuota, networkKey } from "@/lib/ratelimit";
import { type CatalogStats, getCatalogStats, searchWithFallback } from "@/lib/search";
import { LOAD_HEADER } from "@/middleware";

/**
 * One question in, one reply out.
 *
 * Every protection the page used to apply lives here, in the same order and for
 * the same reasons: out-of-scope detection before spending anything, the block
 * list before the quota, and inference dropped entirely while the box is busy.
 *
 * The reply's prose is composed by `composeAnswer` from real records. The model
 * only ever turns the question into filters.
 */

export type AskResult =
  | { kind: "answer"; answer: Answer; filters: AppliedFilters; feedback: FeedbackHandle | null }
  | { kind: "out_of_scope"; reason: OutOfScopeReason }
  | { kind: "out_of_coverage"; municipality: string; department: string };

/** What a vote needs to point at an answer. Opaque to the browser; echoed back verbatim. */
export type FeedbackHandle = {
  turnId: string;
  context: Record<string, unknown>;
  /** Whether the operator has text capture on. Decides if the box is even offered. */
  textCapture: boolean;
  /** Short code the person can quote back to us. Formatted here, not in the browser. */
  caso: string;
};

export type AppliedFilters = {
  types: string[];
  categories: string[];
  municipality: string | null;
  text: string | null;
};

export async function ask(question: string): Promise<AskResult> {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      kind: "answer",
      answer: {
        text: "Escribí tu pregunta y busco en todas las fuentes conectadas.",
        highlight: null,
        results: [],
        companions: [],
        notes: [],
      },
      filters: { types: [], categories: [], municipality: null, text: null },
      // There is no answer here to rate, only the prompt to type something.
      feedback: null,
    };
  }

  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const client = clientKey(cookieStore.get("ayuda_cid")?.value);
  const network = networkKey(
    headerStore.get(CLIENT_IP_HEADER),
    headerStore.get(FORWARDED_FOR_HEADER),
  );

  // A block denies inference only. Search still works: a network key can cover
  // a whole shelter's wifi, and cutting off their ability to find water would
  // be worse than the abuse it punishes.
  const blocked = await isBlocked([client, network]);
  if (blocked) {
    void recordAbuseEvent({ subjectKey: client, subjectKind: "client", kind: "blocked_attempt" });
  }

  // While busy, inference is dropped before the quota is even touched: it costs
  // 1.5-2.6 s per request and the deterministic path still resolves the
  // municipality and the categories.
  const busy = headerStore.get(LOAD_HEADER) === "high";

  const quota =
    blocked || busy ? { allowed: false as const } : await consumeAiQuota({ client, network });

  const query = await resolveQuestion(trimmed, { allowInference: quota.allowed });

  if (query.outOfScopeReason) return { kind: "out_of_scope", reason: query.outOfScopeReason };

  // Nombro un municipio que no cubrimos. Antes esa palabra se perdia y la
  // respuesta salia con lugares de otro departamento, sin avisar.
  const afuera = findMunicipalityOutsideCoverage(trimmed);
  if (afuera) {
    return { kind: "out_of_coverage", municipality: afuera.name, department: afuera.deptName };
  }

  const search = await searchWithFallback({
    q: query.q,
    rankBy: query.rankBy,
    types: query.types,
    admin2Code: query.admin2Code,
    categories: query.categories,
    limit: 20,
  });

  const turnId = mintTurnId();

  const answer = composeAnswer({
    question: trimmed,
    query,
    search,
    // Fuera de tema es no haberla entendido por NINGÚN camino. Que el
    // vocabulario no la reconozca ya no alcanza: si el modelo dedujo un tipo
    // de registro, hay algo que buscar. Ver `guessed` en `intent.ts`.
    offTopic: !hasDomainSignal(trimmed) && query.types.length === 0,
    busy,
  });

  return {
    kind: "answer",
    answer,
    // Null when there is no secret to sign with. The screen simply shows no
    // feedback control in that case; nothing else changes.
    //
    // The context travels out and comes back rather than being written now:
    // every search would otherwise write a row, and almost nobody votes.
    // A person can only echo their own turn's context, and none of it is
    // personal, so the worst a tampered value does is spoil their own row.
    feedback: turnId
      ? {
          turnId,
          textCapture: textCaptureEnabled(),
          caso: caseCode(turnId),
          context: {
            interpretedBy: query.interpretedBy,
            promptVersion: PROMPT_VERSION,
            notes: answer.notes,
            resultIds: answer.results.map((r) => r.sourceRecordId),
            types: query.types,
            categories: query.categories,
            municipality: query.admin2Name,
            // The search text is NOT here, and must never be put back.
            //
            // `query.q` is the person's own words — on the deterministic path
            // it is the whole question, verbatim. Carried here it would be
            // stored on every vote, with no tick, with the flag off, in the one
            // column the retention sweep does not clear. That is the consent
            // gate bypassed through the field nobody calls text.
            //
            // What was searched is already recorded by `types`, `categories`
            // and `municipality`, which are enums and codes. The words
            // themselves live in `questionText`, behind the gate, or nowhere.
          },
        }
      : null,
    filters: {
      types: query.types,
      categories: query.categories,
      municipality: query.admin2Name,
      text: query.q,
    },
  };
}

/** Fixed list. Free text needs consent; these never do, so they are always kept. */
const REASONS = ["no_entendio", "otra_ciudad", "ya_cerro", "desactualizado", "palabra"] as const;

export type FeedbackReason = (typeof REASONS)[number];

/**
 * One vote on one answer.
 *
 * Everything here is best-effort by design: a forged id, a bad rating, a value
 * of the wrong type or a database that will not take the write all end the same
 * way — nothing happens, and the person searching never finds out. Feedback
 * failing is not worth interrupting somebody looking for a shelter
 * (`AGENTS.md`, invariant 9 applies the same rule to inference).
 *
 * The whole body is inside the try for that reason. The argument is whatever
 * was posted: the types below are erased before it arrives, so validating them
 * outside would be the one path able to throw.
 *
 * No rate limiting of its own: `middleware.ts` already sheds floods on every
 * path a browser can reach, and a signed id cannot be manufactured in bulk.
 */
export async function rateAnswer(input: {
  turnId: string;
  rating: "up" | "down";
  reasons?: FeedbackReason[];
  context: unknown;
  questionText?: string;
  comment?: string;
  consented?: boolean;
  /** True only for the detail panel, which is allowed to revise what the thumb wrote. */
  detail?: boolean;
}): Promise<void> {
  try {
    if (!validTurnId(input?.turnId)) return;
    if (input.rating !== "up" && input.rating !== "down") return;

    // Three conditions, all required. The flag is the operator's decision, the
    // tick is the person's, and a thumbs-up never carries text because there is
    // nothing to diagnose in one.
    const keepText = textCaptureEnabled() && input.consented === true && input.rating === "down";

    // Deduplicated: the panel cannot produce a repeat, a hand-written call can,
    // and five copies of one chip would quietly outvote five different ones.
    const reasons = Array.isArray(input.reasons)
      ? [...new Set(input.reasons.filter((r) => REASONS.includes(r)))]
      : [];

    const text = {
      questionText: keepText ? cap(input.questionText, AI_LIMITS.maxQuestionChars) : null,
      comment: keepText ? cap(input.comment, AI_LIMITS.maxQuestionChars) : null,
      consentVersion: keepText ? CONSENT_VERSION : null,
    };

    const row = db.insert(answerFeedback).values({
      turnId: input.turnId,
      rating: input.rating,
      reasons,
      context: safeContext(input.context),
      ...text,
    });

    // The thumb is written the moment it is pressed and the panel follows with
    // the detail, so two writes race for one row. Only the panel may revise it:
    // if the thumb's write arrives last it would otherwise blank the comment
    // somebody had just consented to, and the screen says "gracias" either way,
    // so the loss would be silent.
    await (input.detail === true
      ? row.onConflictDoUpdate({
          target: answerFeedback.turnId,
          set: { rating: input.rating, reasons, ...text },
        })
      : row.onConflictDoNothing());
  } catch {
    // Deliberately silent. See the note above.
  }
}

/** For the status line under the search box. Never cached — see `getCatalogStats`. */
export async function getStats(): Promise<CatalogStats> {
  return getCatalogStats();
}
