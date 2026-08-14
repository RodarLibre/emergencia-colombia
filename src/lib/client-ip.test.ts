import { describe, expect, it } from "vitest";

import { networkOf, trustedClientIp } from "./client-ip";

/**
 * These tests exist because of a real hole, found while preparing to put
 * Cloudflare in front of the site.
 *
 * Both the quota and the flood shedding read `X-Forwarded-For.split(",")[0]`.
 * That entry is written by the client: Cloudflare appends the true address
 * instead of replacing the header, so anyone could send a different fake first
 * entry on every request and never hit a limit. On a site whose whole defence
 * against burning the inference budget is that limit, that is the difference
 * between having one and believing you have one.
 */

describe("which address is trusted", () => {
  it("prefers CF-Connecting-IP, which Cloudflare overwrites", () => {
    expect(trustedClientIp("203.0.113.7", "9.9.9.9, 10.0.0.1")).toBe("203.0.113.7");
  });

  it("ignores a forged first entry and takes the one our own proxy appended", () => {
    expect(trustedClientIp(null, "9.9.9.9, 203.0.113.7")).toBe("203.0.113.7");
  });

  it("handles a single-entry chain", () => {
    expect(trustedClientIp(null, "203.0.113.7")).toBe("203.0.113.7");
  });

  it("survives padding, empty entries and a trailing comma", () => {
    expect(trustedClientIp(null, " 9.9.9.9 , , 203.0.113.7 ,")).toBe("203.0.113.7");
    expect(trustedClientIp("  ", "203.0.113.7")).toBe("203.0.113.7");
  });

  it("returns empty when there is nothing to go on", () => {
    expect(trustedClientIp(null, null)).toBe("");
    expect(trustedClientIp(null, "")).toBe("");
    expect(trustedClientIp(undefined, undefined)).toBe("");
  });

  it("a forged chain alone can never decide the bucket", () => {
    // The attacker controls every entry except the last, which our proxy adds.
    const forged = Array.from({ length: 20 }, (_, i) => `9.9.9.${i}`).join(", ");
    expect(trustedClientIp(null, `${forged}, 203.0.113.7`)).toBe("203.0.113.7");
  });
});

describe("reducing an address to a network", () => {
  it("keeps /24 for IPv4", () => {
    expect(networkOf("203.0.113.7")).toBe("203.0.113");
    expect(networkOf("203.0.113.250")).toBe("203.0.113");
  });

  it("keeps /48 for IPv6", () => {
    expect(networkOf("2001:db8:1234:5678::1")).toBe("2001:db8:1234");
  });

  it("groups two addresses in the same /24 together", () => {
    expect(networkOf("203.0.113.7")).toBe(networkOf("203.0.113.99"));
  });

  it("keeps different networks apart", () => {
    expect(networkOf("203.0.113.7")).not.toBe(networkOf("203.0.114.7"));
  });

  it("returns null for nothing", () => {
    expect(networkOf("")).toBeNull();
  });
});
