"use server";

import { cookies, headers } from "next/headers";

import { composeAnswer, type Answer } from "@/lib/answer";
import { isBlocked, recordAbuseEvent } from "@/lib/abuse";
import { resolveQuestion, type OutOfScopeReason } from "@/lib/intent";
import { hasDomainSignal } from "@/lib/normalize";
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
  | { kind: "answer"; answer: Answer; filters: AppliedFilters }
  | { kind: "out_of_scope"; reason: OutOfScopeReason };

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
        notes: [],
      },
      filters: { types: [], categories: [], municipality: null, text: null },
    };
  }

  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const client = clientKey(cookieStore.get("ayuda_cid")?.value);
  const network = networkKey(headerStore.get("x-forwarded-for"));

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

  const search = await searchWithFallback({
    q: query.q,
    types: query.types,
    admin2Code: query.admin2Code,
    categories: query.categories,
    limit: 20,
  });

  const answer = composeAnswer({
    question: trimmed,
    query,
    search,
    offTopic: !hasDomainSignal(trimmed),
    busy,
  });

  return {
    kind: "answer",
    answer,
    filters: {
      types: query.types,
      categories: query.categories,
      municipality: query.admin2Name,
      text: query.q,
    },
  };
}

/** For the status line under the search box. Never cached — see `getCatalogStats`. */
export async function getStats(): Promise<CatalogStats> {
  return getCatalogStats();
}
