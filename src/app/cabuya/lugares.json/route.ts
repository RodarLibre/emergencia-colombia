import { buildFeed } from "@/lib/cabuya/feed";
import { checkProductionDataIntegrity } from "@/lib/guards";

export const dynamic = "force-dynamic";

/**
 * The Cabuya place feed — https://cabuya.org (§3).
 *
 * Outside `/api` on purpose: the middleware answers 404 to anything under
 * `/api` arriving from the internet, and a feed nobody can fetch is worse than
 * no feed, because the manifest promises it.
 *
 * The `ttl` in the envelope is the sources' poll interval, not a number picked
 * for load: the failure this project exists to prevent is telling somebody a
 * place is open after it closed, and that does not become acceptable because
 * the reader is a machine.
 *
 * No `Cache-Control` is set here. `next.config.ts` puts `no-store` on every
 * path and it wins over anything a handler sets, so a header here would only
 * be a comment that looks like code. Nothing is lost: the caching contract in
 * this protocol is `ttl`, which tells a consumer how often to poll, and the
 * spec never mentions the HTTP header at all.
 */
export async function GET() {
  // Same wall as the rest of the site: with test data enabled in production
  // nothing is served. A made-up shelter is worse in a feed than on a page —
  // it propagates into other people's apps under our name.
  const integrity = await checkProductionDataIntegrity();
  if (!integrity.ok) {
    return Response.json(
      { error: "demo data enabled in production; the feed is withheld" },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  const built = await buildFeed();
  if (!built) {
    // No source has ever been read, so there is no honest generation time to
    // put in `last_updated` — and §3.1 forbids the alternative, which is
    // stamping "now" on an empty feed and letting a consumer read that as
    // freshness.
    return Response.json(
      { error: "no source has been read yet; the feed has no generation time to state" },
      { status: 503, headers: { "Access-Control-Allow-Origin": "*" } },
    );
  }

  return new Response(`${JSON.stringify(built.feed, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
