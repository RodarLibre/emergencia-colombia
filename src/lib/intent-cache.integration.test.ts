import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db";

import { getCachedIntent, putCachedIntent } from "./intent-cache";

let testStart: Date;

afterEach(async () => {
  await db.execute(sql`DELETE FROM ai_intent_cache WHERE created_at >= ${testStart.toISOString()}`);
});

describe("intent cache", () => {
  it("a cached intent is returned for the same question and prompt version", async () => {
    testStart = new Date();
    const question = `pregunta de prueba ${Math.random()}`;
    const intent = {
      tipos: ["service_point"],
      municipio: null,
      categorias: ["water"],
      texto: "agua",
    };

    await putCachedIntent(question, "v1", intent);
    const hit = await getCachedIntent(question, "v1");
    expect(hit).toEqual(intent);
  });

  it("changing the prompt version invalidates the cache — a version hash of SYSTEM_PROMPT and the vocabulary", async () => {
    testStart = new Date();
    const question = `pregunta de prueba ${Math.random()}`;
    const intent = {
      tipos: ["service_point"],
      municipio: null,
      categorias: ["water"],
      texto: "agua",
    };

    await putCachedIntent(question, "v1", intent);
    // A changed SYSTEM_PROMPT or a changed CATEGORIES/RECORD_TYPES_V1 list
    // produces a different PROMPT_VERSION hash, which is exactly this case.
    const miss = await getCachedIntent(question, "v2");
    expect(miss).toBeNull();
  });

  it("a question normalized the same way hits the same cache entry regardless of accents or case", async () => {
    testStart = new Date();
    const suffix = Math.random();
    const intent = { tipos: [], municipio: "Tuluá", categorias: [], texto: null };

    await putCachedIntent(`Dónde hay Agua ${suffix}`, "v1", intent);
    const hit = await getCachedIntent(`donde hay agua ${suffix}`, "v1");
    expect(hit).toEqual(intent);
  });
});
