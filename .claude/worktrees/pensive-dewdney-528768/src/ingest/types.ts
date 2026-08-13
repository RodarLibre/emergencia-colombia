import type { Category, RecordTypeV1, Status } from "@/lib/vocab";

/** What any adapter produces. This is the contract with `upsertRecords`. */
export type ParsedRecord = {
  externalId: string;
  recordUrl: string;
  recordType: RecordTypeV1;
  status: Status;
  title: string;
  description: string | null;
  categoryCodes: Category[];
  locality: string | null;
  /** Only addresses of public operational points, never private residences. */
  displayAddress: string | null;
  openingHours: string | null;
  admin2Code: string | null;
  admin2Name: string | null;
  sourceUpdatedAt: Date | null;
  contentHash: string;
  searchText: string;
};

export class ParserError extends Error {}

/** Source configuration that `ensureSource` registers. */
export type SourceConfig = {
  slug: string;
  name: string;
  baseUrl: string;
  mode: string;
  trustLabel: string;
  pollIntervalSeconds: number;
  contactNote: string;
  coverageAdmin1Code?: string;
};

/**
 * Colombian phone numbers and contacts. Redaction always applies, in every
 * adapter, even when that source isn't expected to carry contacts: if the
 * source's format changes, the default has to be not publishing the data.
 */
const CONTACT_PATTERNS: RegExp[] = [
  /(?:\+?57[\s-]?)?\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/g,
  /\b\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
];

export function redactContact(text: string): string {
  let out = text;
  for (const re of CONTACT_PATTERNS) out = out.replace(re, "[contacto en la fuente]");
  return out.replace(/\s+/g, " ").trim();
}

/** Honest identification: doesn't impersonate a browser. */
export const USER_AGENT =
  "AyudaTerremotoBot/0.1 (+https://github.com/juanroa/ayuda-terremoto; proyecto comunitario)";
