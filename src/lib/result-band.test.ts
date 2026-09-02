import { describe, expect, it } from "vitest";

import { resultBand, type ResultBandInput } from "./result-band";

const NOW = new Date("2026-09-02T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function result(over: Partial<ResultBandInput> = {}): ResultBandInput {
  return {
    status: "active",
    freshness: "fresh",
    verificationLevel: "community_unverified",
    noLongerListed: false,
    sourceUpdatedAt: ago(30),
    observedAt: ago(5),
    lastSeenAt: ago(2),
    ...over,
  };
}

describe("resultBand — precedence matters", () => {
  it('"the source took it down" wins even over official', () => {
    // It does not matter who published it: if the source read fine and no
    // longer lists it, nobody stands behind that data, and it is the first
    // thing somebody about to drive there needs to know.
    const b = resultBand(
      result({ noLongerListed: true, verificationLevel: "official", status: "active" }),
      NOW,
    );
    expect(b.tone).toBe("no_longer_listed");
    expect(b.label).toContain("eliminada por la fuente");
  });

  it('"sin dato" wins over freshness', () => {
    // The bug that prompted splitting this out: the freshness band says
    // "Confirmado" about how recent OUR read is, not about the place operating.
    const b = resultBand(result({ status: "unknown", freshness: "fresh" }), NOW);
    expect(b.tone).toBe("unknown");
    expect(b.label).toContain("Sin dato");
    expect(b.label).not.toContain("Confirmado");
  });

  it("closed wins over freshness, but not over official", () => {
    expect(resultBand(result({ status: "closed" }), NOW).tone).toBe("closed");
    expect(resultBand(result({ status: "closed", verificationLevel: "official" }), NOW).tone).toBe(
      "official",
    );
  });
});

describe("resultBand — what each state says", () => {
  it("treats fulfilled as closed", () => {
    // Not the same thing, but to somebody holding a box they mean the same:
    // do not drive there expecting to hand it over.
    for (const status of ["closed", "fulfilled"] as const) {
      expect(resultBand(result({ status }), NOW).tone, status).toBe("closed");
    }
  });

  it("names the official source before freshness", () => {
    const b = resultBand(result({ verificationLevel: "official" }), NOW);
    expect(b.tone).toBe("official");
    expect(b.label).toContain("Fuente oficial");
  });

  it("confirms what is fresh and not what went unreconfirmed", () => {
    expect(resultBand(result({ freshness: "fresh" }), NOW).tone).toBe("fresh");
    for (const freshness of ["needs_reconfirmation", "stale"] as const) {
      const b = resultBand(result({ freshness }), NOW);
      expect(b.tone, freshness).toBe("unconfirmed");
      expect(b.label, freshness).toContain("Sin confirmar");
    }
  });
});

describe("resultBand — which clock each date comes from", () => {
  it("uses the source's date when it publishes one", () => {
    const b = resultBand(
      result({ freshness: "fresh", sourceUpdatedAt: ago(120), observedAt: ago(1) }),
      NOW,
    );
    expect(b.label).toContain("hace 2 horas");
  });

  it("falls back to the observation only when the source stamps nothing", () => {
    const b = resultBand(
      result({ freshness: "fresh", sourceUpdatedAt: null, observedAt: ago(45) }),
      NOW,
    );
    expect(b.label).toContain("hace 45 min");
  });

  it('"sin dato" says when we saw it, not when we observed it', () => {
    // `observedAt` moves every time WE re-read a record whose source stamps no
    // date, and that reads as somebody having confirmed it. "Visto" is what
    // actually happened.
    const b = resultBand(
      result({
        status: "unknown",
        sourceUpdatedAt: null,
        observedAt: ago(1),
        lastSeenAt: ago(90),
      }),
      NOW,
    );
    expect(b.label).toContain("visto hace 2 horas");
  });

  it("the withdrawn one is dated by when it was seen too", () => {
    const b = resultBand(
      result({ noLongerListed: true, observedAt: ago(1), lastSeenAt: ago(180) }),
      NOW,
    );
    expect(b.label).toContain("vista hace 3 horas");
  });
});
