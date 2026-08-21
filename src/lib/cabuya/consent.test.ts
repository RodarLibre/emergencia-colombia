import { describe, expect, it } from "vitest";

import {
  COMPILATION_LICENSE,
  feedLicense,
  feedPermittedUse,
  redistributableSlugs,
  REDISTRIBUTION,
  type RedistributionGrant,
} from "./consent";
import { buildManifest } from "./manifest";

function grant(overrides: Partial<RedistributionGrant> = {}): RedistributionGrant {
  return {
    license: "CC-BY-4.0",
    permittedUse: ["display", "aggregate"],
    grantedOn: "2026-08-21",
    note: "test",
    ...overrides,
  };
}

describe("the grant list", () => {
  it("starts empty, and stays that way until somebody says yes", () => {
    // Not a placeholder. Everything in this catalog belongs to the team that
    // published it; §7.3 says data enters the network by publication and never
    // by scraping. If this ever fails, the commit that filled it in has to
    // name who agreed and when — that is what `note` is for.
    expect(redistributableSlugs()).toEqual([]);
    expect(REDISTRIBUTION).toEqual({});
  });

  it("declares the compilation's own licence while there is nothing to license", () => {
    expect(feedLicense()).toBe(COMPILATION_LICENSE);
    expect(feedPermittedUse()).toEqual(["display"]);
  });
});

describe("one envelope carries one licence", () => {
  it("uses the licence every granted source agreed on", () => {
    expect(feedLicense({ a: grant(), b: grant() })).toBe("CC-BY-4.0");
  });

  it("refuses to pick one when the grants disagree", () => {
    expect(() => feedLicense({ a: grant(), b: grant({ license: "ODbL-1.0" }) })).toThrow(
      /more than one licence/,
    );
  });
});

describe("permitted use is an intersection", () => {
  it("keeps only what every source granted", () => {
    expect(
      feedPermittedUse({
        a: grant({ permittedUse: ["display", "aggregate", "ai_answer"] }),
        b: grant({ permittedUse: ["display", "aggregate"] }),
      }),
    ).toEqual(["display", "aggregate"]);
  });

  it("narrows to nothing rather than granting what one source withheld", () => {
    expect(
      feedPermittedUse({
        a: grant({ permittedUse: ["display"] }),
        b: grant({ permittedUse: ["aggregate"] }),
      }),
    ).toEqual([]);
  });
});

describe("the manifest", () => {
  it("targets L1 while no source is granted, because the feed carries nothing", () => {
    expect(buildManifest().conformance_target).toBe("L1");
  });

  it("points at the feed it describes, absolutely and over https", () => {
    const manifest = buildManifest();
    expect(manifest.feeds).toHaveLength(1);
    expect(manifest.feeds[0]!.url).toBe("https://emergenciacolombia.org/cabuya/lugares.json");
    expect(manifest.feeds[0]!.entity).toBe("place");
    expect(manifest.protocol).toEqual({ name: "cabuya", spec_version: "0.1.0" });
  });

  it("publishes no contact, because this project has never had a role address", () => {
    expect("contact" in buildManifest().publisher).toBe(false);
  });

  it("says the same thing as the feed about licence and use", () => {
    const manifest = buildManifest();
    expect(manifest.license).toBe(feedLicense());
    expect(manifest.permitted_use).toEqual(feedPermittedUse());
  });
});
