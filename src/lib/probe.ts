import { isAiEnabled } from "./ai";

/**
 * An on-demand check that inference actually works.
 *
 * Invariant 9 says any AI failure degrades to deterministic search rather than
 * an error page. That is right for the person asking a question and blind for
 * whoever runs this: the provider answered 402 Payment Required for days while
 * the site kept working, and nothing anywhere said so.
 *
 * So the failure stays invisible to users and becomes visible to operators.
 *
 * Deliberately NOT part of the container healthcheck: the site is fully usable
 * without inference, so a dead provider must never take the container down.
 * It also costs a call, so it only runs when explicitly asked for.
 */

export type ProbeResult = {
  ok: boolean;
  /** "off" | "ok" | "http_402" | "timeout" | "unreachable" | "bad_response" */
  estado: string;
  /** Round trip in ms, when a response arrived at all. */
  ms?: number;
  /** Provider's own message. Never includes the key — see below. */
  detalle?: string;
};

const PROBE_TIMEOUT_MS = 8_000;

export async function probeInference(): Promise<ProbeResult> {
  if (!isAiEnabled()) {
    return { ok: false, estado: "off", detalle: "AI_ENABLED no está en 'on', o falta la llave" };
  }

  const baseUrl = process.env.DO_GRADIENT_BASE_URL!;
  const model = process.env.DO_GRADIENT_MODEL ?? "openai-gpt-oss-20b";
  const started = Date.now();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DO_GRADIENT_API_KEY!}`,
      },
      // The smallest call that still proves entitlement: authentication alone
      // is not enough, because a token can list models and be refused
      // inference. That is exactly the failure this exists to catch.
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "ok" }],
        max_tokens: 1,
        reasoning_effort: "low",
      }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });

    const ms = Date.now() - started;

    if (response.ok) return { ok: true, estado: "ok", ms };

    // The body is the provider's, not ours, and never contains the key: it
    // travels in the request header and is not echoed back. Truncated anyway.
    const body = await response.text().catch(() => "");
    return {
      ok: false,
      estado: `http_${response.status}`,
      ms,
      detalle: body.slice(0, 200) || response.statusText,
    };
  } catch (error) {
    const ms = Date.now() - started;
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      ok: false,
      estado: timedOut ? "timeout" : "unreachable",
      ms,
      // The provider's URL is not a secret, but the message is not echoed
      // either — an error object can carry the request, and the request
      // carries the Authorization header.
      detalle: timedOut ? `sin respuesta en ${PROBE_TIMEOUT_MS} ms` : "no se pudo conectar",
    };
  }
}
