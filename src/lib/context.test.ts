import { describe, expect, it } from "vitest";

import { safeContext } from "./feedback";

/**
 * The context blob is rebuilt from a fixed list of keys, not copied.
 *
 * It travels to the browser and back, so anything it accepts is something a
 * person can choose. It is also the one column the retention sweep never
 * clears, which is why the question must never reach it: a value here is kept
 * on every vote, with no consent tick and with text capture off.
 */
describe("safeContext", () => {
  it("never carries the question, however it is sent", () => {
    const question = "¿Quién recibe insumos médicos?";
    for (const shape of [
      { text: question },
      { q: question },
      { question },
      { questionText: question },
      { text: { nested: question } },
    ]) {
      expect(JSON.stringify(safeContext(shape))).not.toContain("insumos médicos");
    }
  });

  it("drops keys it does not know", () => {
    expect(safeContext({ sorpresa: "x".repeat(5000) })).not.toHaveProperty("sorpresa");
  });

  it("bounds what it does keep", () => {
    const out = safeContext({
      interpretedBy: "x".repeat(500),
      municipality: "y".repeat(500),
      resultIds: Array.from({ length: 500 }, (_, i) => i),
    });
    expect((out.interpretedBy as string).length).toBeLessThanOrEqual(40);
    expect((out.municipality as string).length).toBeLessThanOrEqual(120);
    expect((out.resultIds as unknown[]).length).toBeLessThanOrEqual(40);
  });

  it("survives values of the wrong type", () => {
    for (const bad of [null, undefined, 5, "texto", [], true]) {
      expect(() => safeContext(bad)).not.toThrow();
    }
  });
});
