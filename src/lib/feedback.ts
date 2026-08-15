import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Identity for one answer, so a vote can point at something.
 *
 * The id is signed rather than stored. A lookup table would need writing on
 * every search — the hot path — and then cleaning up; a signature costs one
 * hash and no state. What it buys is the important part: without it,
 * `rateAnswer` accepts any id anyone invents, which turns a feedback endpoint
 * into an unauthenticated write into a table that keeps text on request.
 *
 * The secret is the limiter's, reused deliberately. A second secret would be
 * one more thing to configure for no extra protection: both sign a claim that
 * this server issued something.
 */

/**
 * Which consent wording was shown when text was kept.
 *
 * Stored with the row, so changing the copy cannot silently reinterpret what
 * somebody agreed to. Same reason `intent.ts` versions its prompt.
 */
export const CONSENT_VERSION = "2026-08-14";

/** Days a consented question survives. The privacy notice reads this, so there is one copy. */
export const RETENTION_DAYS = 30;

/**
 * Text capture is off unless somebody turns it on.
 *
 * With this off nothing personal is written, so the obligations that come with
 * holding it do not apply. Sources ship disabled for the same reason
 * (`AGENTS.md`, invariant 10): the safe state is the default, and enabling is a
 * decision somebody makes on purpose.
 */
export function textCaptureEnabled(): boolean {
  return process.env.FEEDBACK_TEXT === "on";
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", secret).update(id).digest("hex").slice(0, 16);
}

/**
 * `<uuid>.<signature>`, or null when there is no secret to sign with.
 *
 * Null is not an error. The limiter already treats the secret as optional —
 * without it there is no signed cookie either — and a search that throws
 * because feedback could not be set up would be a far worse outcome than a
 * missing thumbs-up button. Callers render no feedback UI and move on.
 */
export function mintTurnId(): string | null {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret) return null;
  const id = randomUUID();
  return `${id}.${sign(id, secret)}`;
}

/** True only for ids this server minted. Anything else is discarded unread. */
export function validTurnId(turnId: unknown): boolean {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret) return false;
  // Typed as `unknown` on purpose: this arrives from a server action, where the
  // TypeScript signature is erased and the body is whatever was posted.
  if (typeof turnId !== "string") return false;

  // Exactly two parts. Splitting and destructuring would silently accept
  // `<uuid>.<signature>.<anything>` — the signature still checks out, because
  // it only ever covered the uuid — while the trailing junk makes the whole
  // string a different value. Every variant would then pass validation and land
  // as its own row, so one real search would buy unlimited writes.
  const parts = turnId.split(".");
  if (parts.length !== 2) return false;

  const [id, signature] = parts;
  // Length is checked before comparing: `timingSafeEqual` throws on a mismatch
  // rather than returning false, and the length of a hex digest is not secret.
  if (!id || signature?.length !== 16) return false;

  return timingSafeEqual(Buffer.from(sign(id, secret)), Buffer.from(signature));
}

/**
 * What a person sees and quotes back to us.
 *
 * It is the only handle they will ever have on their own row — there are no
 * accounts here — so it is what a deletion request arrives as. Short enough to
 * read over the phone, and taken from the id rather than generated separately,
 * because a second identifier would be a second thing that can disagree.
 */
export function caseCode(turnId: string): string {
  return turnId.slice(0, 8).toUpperCase();
}

/**
 * Trim to a length the column can hold, without splitting a character in half.
 *
 * A cap can land between the two halves of a surrogate pair. A lone half is not
 * valid UTF-8, Postgres rejects the whole row, and the rating is lost along
 * with the text — a worse outcome than a comment one character shorter.
 */
export function cap(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  return value.slice(0, max).replace(/[\uD800-\uDBFF]$/, "") || null;
}

/**
 * Rebuild the context from only the keys we put there, at sizes we choose.
 *
 * It travelled to the browser and came back, which makes every value in it
 * something a person can choose. Written straight through, a `jsonb` column
 * with no shape and no ceiling is a free-text field that never asked for
 * consent and that the retention sweep does not clear — the exact thing the
 * consent gate exists to prevent, arriving through the one door nobody
 * described as text.
 */
export function safeContext(raw: unknown): Record<string, unknown> {
  const source = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};

  const strings = (value: unknown) =>
    Array.isArray(value)
      ? value
          .slice(0, 40)
          .map((item) => cap(typeof item === "number" ? String(item) : item, 80))
          .filter((item) => item !== null)
      : [];

  return {
    interpretedBy: cap(source.interpretedBy, 40),
    promptVersion: cap(source.promptVersion, 80),
    notes: strings(source.notes),
    resultIds: strings(source.resultIds),
    types: strings(source.types),
    categories: strings(source.categories),
    municipality: cap(source.municipality, 120),
    // No `text` key, deliberately — see the note in `ask`. Rebuilding from a
    // fixed list of keys is what makes that stick: a caller can send whatever
    // it likes and the question still cannot reach the column.
  };
}
