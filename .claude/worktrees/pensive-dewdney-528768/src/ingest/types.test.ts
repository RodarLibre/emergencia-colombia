import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { redactContact } from "./types";

describe("redactContact", () => {
  it("redacts a bare mobile number", () => {
    const out = redactContact("llama al 3046168439");
    expect(out).toContain("[contacto en la fuente]");
    expect(out).not.toMatch(/\d/);
  });

  it("redacts an international-format mobile number", () => {
    const out = redactContact("+57 304 616 8439");
    expect(out).toContain("[contacto en la fuente]");
    expect(out).not.toMatch(/\d/);
  });

  it("redacts a short 'tel' number", () => {
    const out = redactContact("tel 555 12 34");
    expect(out).toContain("[contacto en la fuente]");
  });

  it("leaves a street address unchanged — it is not a phone number", () => {
    expect(redactContact("Calle 14 #16-29")).toBe("Calle 14 #16-29");
  });

  it("redacts every phone number in the real donde-ayudo-valle fixture output", async () => {
    const { parseDondeAyudo } = await import("./adapters/donde-ayudo");
    const code = readFileSync("fixtures/donde-ayudo-chunk.js", "utf8");
    const records = parseDondeAyudo(code);
    expect(records.length).toBe(86);

    const addressesSurviving = records.filter((r) => r.displayAddress).length;
    expect(addressesSurviving).toBe(86);

    for (const r of records) {
      for (const field of [r.title, r.description, r.displayAddress]) {
        if (!field) continue;
        expect(field).not.toMatch(/\b3\d{2}[\s-]?\d{3}[\s-]?\d{4}\b/);
      }
    }
  });
});
