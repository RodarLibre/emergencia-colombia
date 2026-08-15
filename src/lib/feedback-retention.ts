import { and, isNotNull, lt, sql } from "drizzle-orm";

import { db } from "@/db";
import { answerFeedback } from "@/db/schema";

import { RETENTION_DAYS } from "./feedback";

/**
 * Consented text expires; the row it came from does not.
 *
 * The counts are what the rates are made of and they are nobody's data, so
 * they stay. What goes is the only part that was ever personal.
 *
 * Contacts work the same way (`AGENTS.md`, invariant 6): a live pointer to a
 * person lives in the current state and never in the history, so it can leave
 * without a migration and without anyone having to remember to remove it.
 */
export async function purgeExpiredText(): Promise<number> {
  const expired = await db
    .update(answerFeedback)
    .set({ questionText: null, comment: null, consentVersion: null })
    .where(
      and(
        // `make_interval` takes the number as a parameter. Interpolating into
        // an `interval '... days'` literal works today because the value is a
        // constant, and stops working the day it comes from configuration.
        lt(answerFeedback.createdAt, sql`now() - make_interval(days => ${RETENTION_DAYS})`),
        // Keyed on the consent marker, not on the question. A row can hold a
        // comment with no question, and gating on the question alone would
        // leave that comment in place forever — while the checkbox promised
        // thirty days. The consent version is what says "this row holds
        // something somebody agreed to give us".
        isNotNull(answerFeedback.consentVersion),
      ),
    )
    .returning({ id: answerFeedback.id });

  return expired.length;
}
