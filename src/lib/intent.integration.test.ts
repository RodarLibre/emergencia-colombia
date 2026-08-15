import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";

const generateObjectMock = vi.fn();

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateObject: generateObjectMock };
});

let testStart: Date;

beforeEach(() => {
  vi.resetModules();
  generateObjectMock.mockReset();
  vi.stubEnv("AI_ENABLED", "on");
  vi.stubEnv("DO_GRADIENT_API_KEY", "test-key");
  vi.stubEnv("DO_GRADIENT_BASE_URL", "https://example.invalid/v1");
  testStart = new Date();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await db.execute(sql`DELETE FROM ai_intent_cache WHERE created_at >= ${testStart.toISOString()}`);
});

describe("resolveQuestion — intent cache short-circuits the provider", () => {
  it("asking the same question twice calls the provider once, and reuses the cache the second time", async () => {
    generateObjectMock.mockResolvedValue({
      object: { tipos: ["service_point"], municipio: null, categorias: ["water"], texto: "agua" },
    });

    const { resolveQuestion } = await import("./intent");
    const question = `donde llevo agua ${Math.random()}`;

    const first = await resolveQuestion(question);
    expect(first.interpretedBy).toBe("model");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);

    const second = await resolveQuestion(question);
    expect(second.interpretedBy).toBe("cache");
    expect(generateObjectMock).toHaveBeenCalledTimes(1);
  });
});

describe("resolveQuestion — a provider failure degrades to the same deterministic quality as AI off", () => {
  it("still resolves the municipality and categories written in the text when generateObject throws", async () => {
    generateObjectMock.mockRejectedValue(new Error("timeout"));

    const { resolveQuestion } = await import("./intent");
    const question = `agua en Dagua ${Math.random()}`;

    const result = await resolveQuestion(question);

    expect(result.interpretedBy).toBe("fallback");
    expect(result.admin2Name).toBe("Dagua");
    expect(result.categories).toContain("water");
  });
});

/**
 * "Albergues en Cali" pedía tipo `shelter` Y categoría `shelter` a la vez.
 *
 * Cuatro de los cinco albergues abiertos de Cali no llevan la categoría —quien
 * registra un albergue no suele etiquetarlo además como "alojamiento"— así que
 * quedaban fuera, y la respuesta terminaba armada con los que estaban cerrados.
 */
describe("categoría implícita en el tipo", () => {
  it("no exige la categoría alojamiento cuando ya se pidió el tipo albergue", async () => {
    generateObjectMock.mockResolvedValue({
      object: { tipos: ["shelter"], municipio: "Cali", categorias: [], texto: null },
    });

    const { resolveQuestion } = await import("./intent");
    const query = await resolveQuestion(`albergues en Cali ${Math.random()}`);

    expect(query.types).toContain("shelter");
    expect(query.categories).not.toContain("shelter");
  });

  it("mantiene las categorías que el tipo no implica", async () => {
    generateObjectMock.mockResolvedValue({
      object: { tipos: ["shelter"], municipio: "Cali", categorias: [], texto: null },
    });

    const { resolveQuestion } = await import("./intent");
    const query = await resolveQuestion(`albergues con agua en Cali ${Math.random()}`);

    expect(query.categories).toContain("water");
    expect(query.categories).not.toContain("shelter");
  });

  it("la mantiene cuando no se pidió el tipo: ahí sí es el único filtro", async () => {
    generateObjectMock.mockResolvedValue({
      object: { tipos: ["service_point"], municipio: "Cali", categorias: [], texto: null },
    });

    const { resolveQuestion } = await import("./intent");
    const query = await resolveQuestion(`donde puedo dormir en Cali ${Math.random()}`);

    expect(query.categories).toContain("shelter");
  });
});
