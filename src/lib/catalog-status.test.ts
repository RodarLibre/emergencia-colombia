import { describe, expect, it } from "vitest";

import { AGEING_NOTICE_MS, catalogStatusLines, type CatalogStatusInput } from "./catalog-status";
import { FRESHNESS_WINDOW_MINUTES, PERISHABLE_RECORD_TYPES } from "./vocab";

const NOW = new Date("2026-09-02T17:00:00Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function stats(over: Partial<CatalogStatusInput> = {}): CatalogStatusInput {
  return {
    sourceCount: 5,
    recordCount: 248,
    lastReadAt: ago(8 * 60_000),
    lastPerishableUpdateAt: ago(2 * HOUR),
    ...over,
  };
}

describe("catalogStatusLines — the case that prompted the change", () => {
  it("says nothing is new when the perishable catalogue is still", () => {
    // Production on 2026-09-02: the seismic feed published every few hours and
    // the line read "hace 2 horas", while the humanitarian half had not moved
    // in twenty days. Of the four places this project confused those two
    // dates, this was the only one that erred toward confidence.
    const l = catalogStatusLines(
      stats({ lastReadAt: ago(8 * 60_000), lastPerishableUpdateAt: ago(20 * DAY) }),
      NOW,
    );
    expect(l.freshness).toBe("leídas hace 8 min · nada nuevo desde hace 20 días");
  });

  it("does not mention age when the catalogue is actually moving", () => {
    // A pipeline that is alive and has news should not look suspect.
    const l = catalogStatusLines(stats({ lastPerishableUpdateAt: ago(2 * HOUR) }), NOW);
    expect(l.freshness).toBe("leídas hace 8 min");
  });

  it("the threshold is a shelter's window, and does not fire just below it", () => {
    // 12 h: past that a single record already shows "Sin confirmar", so the
    // summary above them cannot still read as current.
    expect(AGEING_NOTICE_MS).toBe(FRESHNESS_WINDOW_MINUTES.shelter! * 60_000);

    expect(
      catalogStatusLines(stats({ lastPerishableUpdateAt: ago(AGEING_NOTICE_MS) }), NOW).freshness,
    ).toBe("leídas hace 8 min");
    expect(
      catalogStatusLines(stats({ lastPerishableUpdateAt: ago(AGEING_NOTICE_MS + 60_000) }), NOW)
        .freshness,
    ).toContain("nada nuevo");
  });
});

describe("catalogStatusLines — the edges", () => {
  it("says nothing about dates when there are no reads yet", () => {
    expect(catalogStatusLines(stats({ lastReadAt: null }), NOW).freshness).toBeNull();
  });

  it("with nothing perishable it only says when it was read", () => {
    // A catalogue of nothing but earthquakes: no age to report, because none
    // of those records ages.
    const l = catalogStatusLines(stats({ lastPerishableUpdateAt: null }), NOW);
    expect(l.freshness).toBe("leídas hace 8 min");
  });

  it("counts in singular and plural", () => {
    expect(catalogStatusLines(stats({ recordCount: 1, sourceCount: 1 }), NOW).count).toBe(
      "1 aviso de 1 fuente",
    );
    expect(catalogStatusLines(stats({ recordCount: 248, sourceCount: 5 }), NOW).count).toBe(
      "248 avisos de 5 fuentes",
    );
  });
});

describe("PERISHABLE_RECORD_TYPES", () => {
  it("comes from the freshness table and not a hand-written list", () => {
    for (const t of PERISHABLE_RECORD_TYPES) {
      expect(FRESHNESS_WINDOW_MINUTES[t], t).not.toBeNull();
    }
  });

  it("leaves out what does not age, and includes what does", () => {
    // A magnitude 7.4 from twenty days ago is the same fact it always was; a
    // shelter unreconfirmed for twenty days is old data.
    expect(PERISHABLE_RECORD_TYPES).not.toContain("seismic_event");
    expect(PERISHABLE_RECORD_TYPES).not.toContain("official_update");
    for (const t of ["shelter", "collection_point", "service_point", "hazard"] as const) {
      expect(PERISHABLE_RECORD_TYPES, t).toContain(t);
    }
  });
});
