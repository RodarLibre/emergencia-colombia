import { feedLicense, feedPermittedUse, redistributableSlugs } from "./consent";
import {
  CANONICAL_URL,
  EVENT_ID,
  FEED_PATH,
  PUBLISHER_ID,
  SPEC_VERSION,
  type PermittedUse,
} from "./protocol";

/**
 * The publisher manifest (§2): who we are, where the feed is, what may be done
 * with it.
 *
 * Built rather than written out so it cannot drift from the feed it points at:
 * one licence, one grant list, one path, computed from the same constants the
 * route serves.
 */
export type CabuyaManifest = {
  protocol: { name: "cabuya"; spec_version: string };
  publisher: { publisher_id: string; canonical_url: string; name: string };
  conformance_target: "L0" | "L1" | "L2" | "L3" | "L4";
  feeds: { name: string; url: string; entity: "place"; profile: "core" }[];
  license: string;
  permitted_use: PermittedUse[];
  crawl_policy_url: string;
  events: string[];
  languages: string[];
};

export function buildManifest(): CabuyaManifest {
  /**
   * Derived, never typed in by hand.
   *
   * §8.3 is the project's founding argument: conformance is measured by the
   * validator, never declared — because manifests lie and behaviour does not.
   * With no source cleared for redistribution the feed carries no records, so
   * the honest target is L1, "publishes a manifest and links out". It becomes
   * L2 the moment a grant lands in `consent.ts`, in the same commit that makes
   * it true, and the badge still comes from somebody else measuring it.
   */
  const target = redistributableSlugs().length > 0 ? "L2" : "L1";

  return {
    protocol: { name: "cabuya", spec_version: SPEC_VERSION },
    publisher: {
      publisher_id: PUBLISHER_ID,
      canonical_url: CANONICAL_URL,
      name: "Emergencia Colombia",
      // No `contact` field: it takes an org-level role address and this
      // project has never published one. Inventing one to fill the slot is
      // the kind of unbacked claim the protocol's Rule-0 exists to refuse.
    },
    conformance_target: target,
    feeds: [
      {
        name: "lugares",
        url: `${CANONICAL_URL}${FEED_PATH}`,
        entity: "place",
        profile: "core",
      },
    ],
    license: feedLicense(),
    permitted_use: feedPermittedUse(),
    crawl_policy_url: `${CANONICAL_URL}/terminos`,
    events: [EVENT_ID],
    // What the records are written in. The interface is Spanish because the
    // people reading it are; the feed says so rather than assuming English.
    languages: ["es"],
  };
}
