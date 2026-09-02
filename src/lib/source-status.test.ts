import { describe, expect, it } from "vitest";

import { UNCHANGED_NOTICE_MS, sourceStatusLabel, type SourceStatusInput } from "./source-status";

const AHORA = new Date("2026-09-02T02:35:00Z");

function source(over: Partial<SourceStatusInput> = {}): SourceStatusInput {
  return {
    enabled: true,
    records: 95,
    withdrawn: 0,
    lastReadAt: new Date(AHORA.getTime() - 5 * 60_000),
    lastChangedAt: new Date(AHORA.getTime() - 10 * 60_000),
    ...over,
  };
}

describe("sourceStatusLabel — when it was read, not when it changed", () => {
  it("names the last read, not the last observation", () => {
    // The bug as measured in production: Donde Ayudo is read every fifteen
    // minutes and has published no change since 14 August. The band said
    // "Leída hace 19 días" about a source that had just been read.
    const label = sourceStatusLabel(
      source({
        lastReadAt: new Date(AHORA.getTime() - 5 * 60_000),
        lastChangedAt: new Date("2026-08-14T01:36:43Z"),
      }),
      AHORA,
    );
    expect(label).toContain("Leída hace 5 min");
    expect(label).not.toMatch(/Leída hace 19 días/);
  });

  it("also says the source has gone a while without changing", () => {
    // Without this half, fixing the band would hide that the content is 19
    // days old — which is exactly what a person needs in order to decide
    // whether to trust an address.
    const label = sourceStatusLabel(
      source({ lastChangedAt: new Date("2026-08-14T01:36:43Z") }),
      AHORA,
    );
    expect(label).toBe("Leída hace 5 min · sin cambios hace 19 días");
  });

  it("does not mention changes when the source is current", () => {
    // A source that is alive and simply has no news should not look suspect.
    const label = sourceStatusLabel(
      source({ lastChangedAt: new Date(AHORA.getTime() - 3 * 3_600_000) }),
      AHORA,
    );
    expect(label).toBe("Leída hace 5 min");
  });

  it("the threshold is a day, and does not fire just below it", () => {
    const justo = sourceStatusLabel(
      source({ lastChangedAt: new Date(AHORA.getTime() - UNCHANGED_NOTICE_MS) }),
      AHORA,
    );
    expect(justo).toBe("Leída hace 5 min");

    const pasado = sourceStatusLabel(
      source({ lastChangedAt: new Date(AHORA.getTime() - UNCHANGED_NOTICE_MS - 60_000) }),
      AHORA,
    );
    expect(pasado).toContain("sin cambios");
  });
});

describe("sourceStatusLabel — the other states", () => {
  it("a source not yet connected says so before anything else", () => {
    expect(sourceStatusLabel(source({ enabled: false }), AHORA)).toBe("No conectada todavía");
  });

  it("a source that closed is not one that was never read", () => {
    const label = sourceStatusLabel(source({ records: 0, withdrawn: 936 }), AHORA);
    expect(label).toBe("La fuente cerró y retiró sus avisos");
  });

  it("puts no date on the closure, because we do not hold that date", () => {
    // The only one there is is when we processed it, and shown there it reads
    // as when the source closed, which is a different fact.
    const label = sourceStatusLabel(source({ records: 0, withdrawn: 936 }), AHORA);
    expect(label).not.toMatch(/hace/);
  });

  it("tells never-read apart from read-with-no-changes", () => {
    expect(sourceStatusLabel(source({ lastReadAt: null }), AHORA)).toBe("Sin lecturas todavía");
    expect(sourceStatusLabel(source({ lastChangedAt: null }), AHORA)).toBe("Leída hace 5 min");
  });

  it("a partial withdrawal does not switch the source off", () => {
    // `withdrawn > 0` with live records is a source still publishing.
    const label = sourceStatusLabel(source({ records: 12, withdrawn: 3 }), AHORA);
    expect(label).toContain("Leída");
  });
});
