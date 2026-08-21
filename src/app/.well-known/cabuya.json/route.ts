import { buildManifest } from "@/lib/cabuya/manifest";

export const dynamic = "force-dynamic";

/**
 * The Cabuya publisher manifest — https://cabuya.org (§2).
 *
 * The RECOMMENDED path is `/.well-known/cabuya.json`, and the reason it is
 * only RECOMMENDED is the one thing that can break here: hosts and catch-all
 * routes that answer HTML at discovery paths. The validator treats
 * `200 + text/html` as absent, so this route exists to answer JSON at exactly
 * this path. Whether the path survives the host is not something a unit test
 * can answer: the check that counts is a request against the deployed site.
 */
export function GET() {
  return new Response(`${JSON.stringify(buildManifest(), null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Required verbatim on the feed (§3.1) and served here for the same
      // reason: without it every browser-based consumer needs a proxy.
      "Access-Control-Allow-Origin": "*",
    },
  });
}
