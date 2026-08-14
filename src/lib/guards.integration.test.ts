import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { sources } from "@/db/schema";

let demoSourceId: number | null = null;

beforeEach(() => {
  vi.resetModules();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  delete process.env.NEXT_PHASE;
  if (demoSourceId !== null) {
    await db.delete(sources).where(eq(sources.id, demoSourceId));
    demoSourceId = null;
  }
});

/**
 * Every check in this file needs its own fresh module instance: guards.ts
 * memoizes the integrity check for 60s at module scope, which would leak a
 * stale "ok" result from one test into the next otherwise.
 */
async function freshModules() {
  const guards = await import("@/lib/guards");
  const search = await import("@/lib/search");
  const saludRoute = await import("@/app/salud/route");
  return { guards, search, saludRoute };
}

/** The route reads the query string, so it needs a real Request. */
function healthRequest(query = ""): Request {
  return new Request(`http://localhost/salud${query}`);
}

describe("production data integrity guard", () => {
  it("with an enabled demo-% source and NODE_ENV=production, blocks and reports it", async () => {
    const slug = `demo-test-${Math.random().toString(36).slice(2, 8)}`;
    const [inserted] = await db
      .insert(sources)
      .values({
        slug,
        name: "Fuente de prueba demo",
        baseUrl: "https://example.invalid",
        mode: "manual",
        enabled: true,
      })
      .returning();
    demoSourceId = inserted!.id;

    vi.stubEnv("NODE_ENV", "production");
    const { guards, search, saludRoute } = await freshModules();

    const integrity = await guards.checkProductionDataIntegrity();
    expect(integrity.ok).toBe(false);
    if (!integrity.ok) expect(integrity.demoSources).toContain(slug);

    const results = await search.searchRecords({});
    expect(results).toEqual([]);

    const response = await saludRoute.GET(healthRequest());
    expect(response.status).toBe(503);
    const body = (await response.json()) as { estado: string };
    expect(body.estado).toBe("bloqueado");
  });

  it("outside production, the same demo-% source does not block anything", async () => {
    const slug = `demo-test-${Math.random().toString(36).slice(2, 8)}`;
    const [inserted] = await db
      .insert(sources)
      .values({
        slug,
        name: "Fuente de prueba demo",
        baseUrl: "https://example.invalid",
        mode: "manual",
        enabled: true,
      })
      .returning();
    demoSourceId = inserted!.id;

    vi.stubEnv("NODE_ENV", "development");
    const { guards, saludRoute } = await freshModules();

    const integrity = await guards.checkProductionDataIntegrity();
    expect(integrity.ok).toBe(true);

    const response = await saludRoute.GET(healthRequest());
    expect(response.status).toBe(200);
  });
});
