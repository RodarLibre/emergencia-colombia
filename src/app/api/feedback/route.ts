import { desc, eq, like } from "drizzle-orm";

import { db } from "@/db";
import { answerFeedback } from "@/db/schema";

import { authorized } from "../ingest/auth";

export const dynamic = "force-dynamic";

/**
 * Reading and removing feedback.
 *
 * Operator-only, behind the same secret as the ingest and the usage report,
 * and under `/api`, which the middleware hides from the internet. No
 * aggregation here on purpose: `jq` over a few hundred rows answers every
 * question anyone has asked so far, and a query nobody has needed yet is a
 * query nobody has to maintain.
 *
 * ponytail: shares INGEST_SECRET. Split into its own secret before turning
 * FEEDBACK_TEXT on — from that moment this route reads personal data, and the
 * ingest secret lives in a crontab on the host.
 */
export async function GET(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });

  const rows = await db
    .select()
    .from(answerFeedback)
    .orderBy(desc(answerFeedback.createdAt))
    .limit(200);

  return Response.json(rows);
}

/**
 * Takedown, and the way somebody exercises their right to be forgotten.
 *
 * A person has no account and no session — the case code printed under their
 * answer is the only thing they can quote. So deletion takes that code:
 *
 *   curl -X DELETE ".../api/feedback?caso=7F3A21B4" -H "Authorization: Bearer ..."
 *
 * Deletes the row rather than blanking the text. A request to be forgotten is
 * not answered by keeping a record that says somebody complained.
 */
export async function DELETE(request: Request) {
  if (!authorized(request)) return new Response(null, { status: 404 });

  const url = new URL(request.url);
  const caso = url.searchParams.get("caso");
  const id = url.searchParams.get("id");

  if (id) {
    const parsed = Number(id);
    // Bounded to what a Postgres `serial` can hold. `Number.isInteger` is happy
    // with 3e9 and 1e30, and the driver would raise "value out of range" from
    // inside the query — a 500 on what is really a bad request, which stops a
    // scripted takedown loop halfway through.
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 2_147_483_647) {
      return new Response(null, { status: 400 });
    }
    const gone = await db.delete(answerFeedback).where(eq(answerFeedback.id, parsed)).returning();
    return Response.json({ deleted: gone.length });
  }

  // The code is the first 8 characters of the uuid, uppercased for reading.
  // Matching is a prefix on the stored id, which is lowercase.
  if (!caso || !/^[0-9a-fA-F]{8}$/.test(caso)) return new Response(null, { status: 400 });

  // Eight hex characters is 32 bits of the uuid, so two rows can share a code.
  // Look before deleting: the caller is usually honouring a request to be
  // forgotten, and quietly destroying a second person's row while answering the
  // first is a worse failure than making somebody run one more command.
  const matches = await db
    .select({ id: answerFeedback.id, createdAt: answerFeedback.createdAt })
    .from(answerFeedback)
    .where(like(answerFeedback.turnId, `${caso.toLowerCase()}%`));

  if (matches.length === 0) return Response.json({ deleted: 0 });
  if (matches.length > 1) {
    return Response.json(
      { deleted: 0, ambiguous: matches, hint: "Repetir con ?id= para elegir cual" },
      { status: 409 },
    );
  }

  const gone = await db
    .delete(answerFeedback)
    .where(eq(answerFeedback.id, matches[0]!.id))
    .returning();

  return Response.json({ deleted: gone.length });
}
