import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({
  db: {
    execute: vi.fn().mockRejectedValue(new Error("connection refused")),
  },
}));

describe("consumeAiQuota — fails closed", () => {
  it("denies when the counter database is unreachable", async () => {
    const { consumeAiQuota } = await import("./ratelimit");
    const decision = await consumeAiQuota({ client: "c", network: "n" });
    expect(decision).toEqual({ allowed: false, reason: "global" });
  });
});
