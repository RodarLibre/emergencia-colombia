import type { ConfirmationMethod, PermittedUse } from "./protocol";

/**
 * Which sources may be republished in the Cabuya feed, and under what terms.
 *
 * This is the one human decision in the whole feed, and it is not ours to
 * make quietly. Everything in this catalog came from somebody else's site.
 * Reading it to answer a question in our own interface is one thing; handing
 * it to any consumer as a machine-readable feed is another, and the protocol
 * says so in §7.3: data enters the network by publication, never by scraping,
 * and consuming a publisher requires its declared consent.
 *
 * So the list starts empty, exactly like invariant 10 starts every source
 * disabled. An entry here is a claim that a specific team said yes to
 * redistribution — not that their robots.txt allowed indexing, not that their
 * data is public, not that they were friendly about the adapter. Those are all
 * real and none of them is this.
 *
 * It lives in code rather than in the database or the environment on purpose:
 * `CONVENTIONS.md` puts anything that changes what the site *means* — and
 * whose data we may hand onward is exactly that — where it goes through
 * review.
 *
 * Where each current source stands, so the empty object below is a record
 * rather than an oversight:
 *
 * - `mapa-emergencia` — the closest to ready. There is an agreement from
 *   2026-08-14, but it grants *display* with attribution, a link to the ficha
 *   and the confirmation time shown. Redistribution was never discussed. One
 *   email away, and the email has to happen first.
 * - `pereira-ayuda` — its robots.txt invites indexing. Indexing is not
 *   redistribution; a crawler reading a page and us republishing its contents
 *   as a feed are different acts and only one of them was consented to.
 * - `cali-ayuda`, `donde-ayudo-valle` — no robots.txt, no agreement, owner
 *   not yet contacted. Not eligible until both change.
 * - `sgc-sismos` — an official open feed, and the one case where the terms
 *   would not block it. It carries earthquakes, and an earthquake is not a
 *   `place`: v0.1 transports one entity and this is not it. Nothing to
 *   publish here until the protocol has somewhere to put it.
 */

export type RedistributionGrant = {
  /** SPDX identifier the source grants the republished records under. */
  license: string;
  /** What the source agreed consumers may do (§3.1, closed enum). */
  permittedUse: PermittedUse[];
  /** When the grant was given. */
  grantedOn: string;
  /** Who said yes and to what, in one line, for the reviewer of this diff. */
  note: string;
  /**
   * The source publishes a real confirmation event, and our `sourceUpdatedAt`
   * holds it rather than an edit time.
   *
   * Declared per source and never assumed, because the column means different
   * things in different adapters: Mapa de Emergencia's `confirmado` is
   * somebody saying the point is still there, while another site's timestamp
   * is whoever last touched the row. CR-1 exists to keep those two apart —
   * "an edit is not a confirmation" — and the only place that distinction is
   * known is here, next to the person who read the source's documentation.
   *
   * Absent means `last_confirmed_at` is published as null. Never confirmed is
   * a legal and honest answer; a confirmation we invented is neither.
   */
  confirmation?: { method: ConfirmationMethod };
};

/**
 * Source slug -> grant. Adding a key publishes that source's records to
 * anyone; the pull request that adds one says who agreed and when.
 */
export const REDISTRIBUTION: Readonly<Record<string, RedistributionGrant>> = {};

export function redistributableSlugs(): string[] {
  return Object.keys(REDISTRIBUTION).sort();
}

/**
 * The licence declared for the feed as a whole.
 *
 * The envelope carries one licence (§3.1) while the records come from several
 * teams, so every granted source has to agree on it. Enforced rather than
 * assumed — `consent.test.ts` fails when two grants disagree, and the fix is a
 * decision (relicense, or shard the feed per source), never a default.
 *
 * With no grants there are no records, and the compilation is our own.
 */
export const COMPILATION_LICENSE = "CC-BY-4.0";

export function feedLicense(
  grants: Readonly<Record<string, RedistributionGrant>> = REDISTRIBUTION,
): string {
  const licenses = new Set(Object.values(grants).map((g) => g.license));
  if (licenses.size === 0) return COMPILATION_LICENSE;
  if (licenses.size > 1) {
    // Refusing to serve beats picking one: publishing records under a licence
    // their owner did not grant is the failure this whole file exists to
    // prevent, and it would be invisible in the output.
    throw new Error(
      `[cabuya] granted sources declare more than one licence (${[...licenses].sort().join(", ")}). ` +
        `One envelope carries one licence: relicense, or split the feed per source.`,
    );
  }
  return [...licenses][0]!;
}

/**
 * The narrowest grant every included source gave — an intersection, never a
 * union. A consumer reading `aggregate` must be able to trust that all of it
 * may be aggregated, not most of it.
 */
export function feedPermittedUse(
  source: Readonly<Record<string, RedistributionGrant>> = REDISTRIBUTION,
): PermittedUse[] {
  const grants = Object.values(source);
  if (grants.length === 0) return ["display"];

  const [first, ...rest] = grants;
  return first!.permittedUse.filter((use) => rest.every((g) => g.permittedUse.includes(use)));
}
