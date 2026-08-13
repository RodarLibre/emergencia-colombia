import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { observations, sourceRecords, sources } from "@/db/schema";
import { OPERATING_ADMIN1 } from "@/lib/vocab";

import type { ParsedRecord, SourceConfig } from "./types";

/**
 * Writes to the catalog, shared by every adapter.
 *
 * Non-negotiable rules:
 *
 * - Observations are immutable. A change in the source creates a new one,
 *   never modifies the previous one. The history stays complete.
 * - If the content didn't change, only `lastSeenAt` gets updated. No
 *   duplicate observations get created on every run.
 * - A record that disappears from the listing is NOT deleted or hidden. Only
 *   the source can explicitly withdraw it. Re-running the ingestor against a
 *   down page can't make shelters disappear.
 */

export type IngestResult = {
  discovered: number;
  created: number;
  updated: number;
  unchanged: number;
};

/**
 * Count drop tolerated before rejecting a run.
 *
 * This is the quality protection that matters most. A parser that's
 * completely broken detects itself (zero records); the dangerous case is
 * breaking halfway — finding 3 of 8 — because the run "succeeds" with less
 * data and nobody notices. The missing records aren't deleted (never deleted
 * due to absence), but they stop being reconfirmed and age with no explanation.
 */
const MAX_COUNT_DROP = 0.4;

export class QuarantineError extends Error {}

/**
 * Compares the count against the last good run and aborts if it dropped too
 * much. Called BEFORE writing anything.
 */
export async function assertNoCountCollapse(sourceId: number, discovered: number): Promise<void> {
  const [row] = (await db.execute(sql`
    SELECT COUNT(*)::int AS previous
    FROM source_records
    WHERE source_id = ${sourceId} AND withdrawn_at IS NULL
  `)) as unknown as { previous: number }[];

  const previous = row?.previous ?? 0;
  if (previous === 0) return; // first run: nothing to compare against

  const drop = (previous - discovered) / previous;
  if (drop > MAX_COUNT_DROP) {
    throw new QuarantineError(
      `La fuente devolvio ${discovered} registros y la corrida anterior tenia ${previous} ` +
        `(caida del ${Math.round(drop * 100)}%, tolerancia ${Math.round(MAX_COUNT_DROP * 100)}%). ` +
        `No se escribio nada. Revisar si la fuente cambio de estructura antes de reintentar; ` +
        `si la caida es real, correr con --forzar.`,
    );
  }
}

/** Creates the source if it doesn't exist. Starts disabled on purpose. */
export async function ensureSource(config: SourceConfig): Promise<number> {
  const existing = await db.query.sources.findFirst({
    where: eq(sources.slug, config.slug),
  });
  if (existing) {
    // The adapter's configuration is authoritative: if the declared coverage
    // or the contact note changed, it propagates. The `enabled` field isn't
    // touched, since that's a human decision, not the code's.
    await db
      .update(sources)
      .set({
        name: config.name,
        coverageAdmin1Code: config.coverageAdmin1Code ?? null,
        pollIntervalSeconds: config.pollIntervalSeconds,
        contactNote: config.contactNote,
      })
      .where(eq(sources.id, existing.id));
    return existing.id;
  }

  const [inserted] = await db
    .insert(sources)
    .values({
      slug: config.slug,
      name: config.name,
      baseUrl: config.baseUrl,
      mode: config.mode,
      trustLabel: config.trustLabel,
      pollIntervalSeconds: config.pollIntervalSeconds,
      contactNote: config.contactNote,
      coverageAdmin1Code: config.coverageAdmin1Code ?? null,
      // Disabled until someone reviews the source's policy.
      // Enabled by hand: `pnpm ingest <slug> --habilitar`.
      enabled: false,
    })
    .returning();

  if (!inserted) throw new Error(`Could not create source ${config.slug}`);
  return inserted.id;
}

export async function upsertRecords(
  sourceId: number,
  records: readonly ParsedRecord[],
  verificationLevel: string,
): Promise<IngestResult> {
  const observedAt = new Date();
  const result: IngestResult = {
    discovered: records.length,
    created: 0,
    updated: 0,
    unchanged: 0,
  };

  for (const rec of records) {
    const existing = await db.query.sourceRecords.findFirst({
      where: and(
        eq(sourceRecords.sourceId, sourceId),
        eq(sourceRecords.externalId, rec.externalId),
      ),
    });

    let sourceRecordId: number;

    if (!existing) {
      const [created] = await db
        .insert(sourceRecords)
        .values({
          sourceId,
          externalId: rec.externalId,
          canonicalUrl: rec.recordUrl,
          firstSeenAt: observedAt,
          lastSeenAt: observedAt,
          lastContentHash: rec.contentHash,
        })
        .returning();
      if (!created) throw new Error(`Could not create source_record ${rec.externalId}`);
      sourceRecordId = created.id;
      result.created += 1;
    } else {
      sourceRecordId = existing.id;
      if (existing.lastContentHash === rec.contentHash) {
        // No changes: only records that it was seen again.
        await db
          .update(sourceRecords)
          .set({ lastSeenAt: observedAt })
          .where(eq(sourceRecords.id, existing.id));
        result.unchanged += 1;
        continue;
      }
      await db
        .update(sourceRecords)
        .set({
          lastSeenAt: observedAt,
          lastContentHash: rec.contentHash,
          canonicalUrl: rec.recordUrl,
        })
        .where(eq(sourceRecords.id, existing.id));
      result.updated += 1;
    }

    await db.insert(observations).values({
      sourceRecordId,
      recordType: rec.recordType,
      status: rec.status,
      title: rec.title,
      description: rec.description,
      categoryCodes: rec.categoryCodes,
      admin1Code: OPERATING_ADMIN1.code,
      admin1Name: OPERATING_ADMIN1.name,
      admin2Code: rec.admin2Code,
      admin2Name: rec.admin2Name,
      locality: rec.locality,
      displayAddress: rec.displayAddress,
      openingHours: rec.openingHours,
      // Precision is never upgraded by inference: if there's only a
      // neighborhood, it's locality_only; with nothing locatable, unknown.
      // An address for a public operational point is an exact point; a
      // neighborhood is locality_only; with nothing locatable, unknown.
      locationPrecision: rec.displayAddress
        ? "exact_operational_point"
        : rec.locality
          ? "locality_only"
          : "unknown",
      verificationLevel,
      sourceUpdatedAt: rec.sourceUpdatedAt,
      observedAt,
      contentHash: rec.contentHash,
      searchText: rec.searchText,
    });
  }

  return result;
}
