import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";

import { db } from "@/db";

import { consumeAiQuota } from "./ratelimit";

const testClients: string[] = [];

afterEach(async () => {
  for (const key of testClients.splice(0)) {
    await db.execute(sql`DELETE FROM ai_usage_counters WHERE key LIKE ${`%:${key}`}`);
  }
  // g1m:global is shared across every call in the same minute, including
  // across repeated runs of this file — reset it so 20/minute never trips
  // from a previous run instead of the assertion under test.
  await db.execute(sql`DELETE FROM ai_usage_counters WHERE key = 'g1m:global'`);
});

function freshClient(): string {
  const key = `test-${Math.random().toString(36).slice(2, 10)}`;
  testClients.push(key);
  return key;
}

describe("consumeAiQuota — per-client hourly window", () => {
  it("allows 10 requests per client per hour and denies the 11th", async () => {
    const client = freshClient();
    const network = freshClient();
    const now = new Date();

    for (let i = 0; i < 10; i += 1) {
      const decision = await consumeAiQuota({ client, network, now });
      expect(decision).toEqual({ allowed: true });
    }

    const eleventh = await consumeAiQuota({ client, network, now });
    expect(eleventh).toEqual({ allowed: false, reason: "client" });
  });
});
