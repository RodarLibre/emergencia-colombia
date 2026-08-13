import { eq } from "drizzle-orm";

import { db } from "@/db";
import { sources } from "@/db/schema";
import type { ParsedRecord, SourceConfig } from "@/ingest/types";
import type { Category, RecordTypeV1, Status } from "@/lib/vocab";

/**
 * Integration tests share the local dev Postgres with the seed data, so every
 * throwaway source uses a "test-" slug and gets deleted afterward — the
 * cascade on source_records/observations takes the rest with it.
 */
export function testSlug(label: string): string {
  return `test-${label}-${Math.random().toString(36).slice(2, 10)}`;
}

export function testSourceConfig(slug: string): SourceConfig {
  return {
    slug,
    name: `Fuente de prueba ${slug}`,
    baseUrl: "https://example.invalid",
    mode: "manual",
    trustLabel: "community",
    pollIntervalSeconds: 900,
    contactNote: "Fuente creada por la suite de integracion.",
  };
}

export async function deleteTestSource(sourceId: number): Promise<void> {
  await db.delete(sources).where(eq(sources.id, sourceId));
}

export function buildParsedRecord(overrides: Partial<ParsedRecord> = {}): ParsedRecord {
  const externalId = overrides.externalId ?? testSlug("record");
  const recordType: RecordTypeV1 = overrides.recordType ?? "collection_point";
  const status: Status = overrides.status ?? "active";
  const categoryCodes: Category[] = overrides.categoryCodes ?? ["water"];
  const title = overrides.title ?? `Punto de prueba ${externalId}`;

  return {
    externalId,
    recordUrl: `https://example.invalid/${externalId}`,
    recordType,
    status,
    title,
    description: null,
    categoryCodes,
    locality: null,
    displayAddress: null,
    openingHours: null,
    admin2Code: "76001",
    admin2Name: "Cali",
    sourceUpdatedAt: null,
    contentHash: `sha256:${externalId}`,
    searchText: title.toLowerCase(),
    ...overrides,
  };
}
