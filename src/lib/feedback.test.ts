import { afterEach, describe, expect, it, vi } from "vitest";

import { caseCode, mintTurnId, textCaptureEnabled, validTurnId } from "./feedback";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("turn id", () => {
  it("accepts what it minted", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "secreto-de-prueba");
    const turnId = mintTurnId()!;
    expect(validTurnId(turnId)).toBe(true);
  });

  it("rejects a tampered id", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "secreto-de-prueba");
    const [id = "", signature = ""] = mintTurnId()!.split(".");
    // The replacement has to be a character the uuid cannot already start with,
    // or this tests the RNG instead of the signature: overwriting with a fixed
    // "0" leaves the id untouched for the one mint in sixteen that begins with
    // "0", and an untouched id is still validly signed.
    const tampered = `${id[0] === "0" ? "1" : "0"}${id.slice(1)}`;
    expect(validTurnId(`${tampered}.${signature}`)).toBe(false);
  });

  it("rejects an id signed with another secret", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "el-de-alguien-mas");
    const foreign = mintTurnId()!;
    vi.stubEnv("RATE_LIMIT_SECRET", "el-nuestro");
    expect(validTurnId(foreign)).toBe(false);
  });

  it("rejects a valid id with anything appended", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "secreto-de-prueba");
    const turnId = mintTurnId()!;
    // The signature only ever covered the uuid, so every one of these still
    // verifies if the extra part is ignored — and each is a different string,
    // so each would take its own row past a UNIQUE column.
    for (const suffix of [".1", ".2", ".", ".a.b", "."]) {
      expect(validTurnId(`${turnId}${suffix}`)).toBe(false);
    }
  });

  it("rejects values that are not strings", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "secreto-de-prueba");
    // A server action deserializes whatever was posted; the types are gone.
    for (const bad of [5, null, undefined, {}, [], true]) {
      expect(validTurnId(bad)).toBe(false);
    }
  });

  it("rejects malformed input without throwing", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "secreto-de-prueba");
    // `timingSafeEqual` throws on length mismatch, so short signatures have to
    // be turned away before they reach it.
    for (const bad of ["", ".", "sin-punto", "id.", ".firma", "id.corta", "id.".padEnd(40, "f")]) {
      expect(validTurnId(bad)).toBe(false);
    }
  });

  it("mints nothing when there is no secret, and validates nothing either", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "");
    expect(mintTurnId()).toBeNull();
    expect(validTurnId("cualquier-cosa.0123456789abcdef")).toBe(false);
  });
});

describe("case code", () => {
  it("is stable, short, and readable out loud", () => {
    vi.stubEnv("RATE_LIMIT_SECRET", "secreto-de-prueba");
    const turnId = mintTurnId()!;
    expect(caseCode(turnId)).toHaveLength(8);
    expect(caseCode(turnId)).toBe(caseCode(turnId));
    expect(caseCode(turnId)).toMatch(/^[0-9A-F]{8}$/);
  });
});

describe("text capture", () => {
  it("is off unless explicitly turned on", () => {
    expect(textCaptureEnabled()).toBe(false);
    vi.stubEnv("FEEDBACK_TEXT", "true");
    expect(textCaptureEnabled()).toBe(false);
    vi.stubEnv("FEEDBACK_TEXT", "on");
    expect(textCaptureEnabled()).toBe(true);
  });
});
