/**
 * Ingest CLI.
 *
 *   pnpm ingest cali-ayuda                 # reads from the live source
 *   pnpm ingest cali-ayuda --fixture       # reads the local fixture, no network
 *   pnpm ingest cali-ayuda --habilitar     # marks the source as enabled
 *   pnpm ingest cali-ayuda --forzar        # skips the count-drop guard
 *
 * The logic lives in registry.ts, shared with the /api/ingest route so
 * scheduling ingest doesn't depend on the platform.
 *
 * A failed run never deletes or hides records: the only consequence is that
 * there are no new observations.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

import { client, db } from "@/db";
import { sources } from "@/db/schema";

import { ADAPTERS, ADAPTER_SLUGS, isAdapterSlug, runAdapter } from "./registry";
import { ensureSource } from "./upsert";
import { QuarantineError } from "./upsert";

async function main() {
  const [slug, ...flags] = process.argv.slice(2);

  if (!slug || !isAdapterSlug(slug)) {
    console.error("Usage: pnpm ingest <slug> [--fixture] [--habilitar] [--forzar]");
    console.error(`Available: ${ADAPTER_SLUGS.join(", ")}`);
    process.exit(1);
  }

  const adapter = ADAPTERS[slug];
  const useFixture = flags.includes("--fixture");

  if (flags.includes("--habilitar")) {
    const sourceId = await ensureSource(adapter.config);
    await db
      .update(sources)
      .set({ enabled: true, policyReviewedAt: new Date() })
      .where(eq(sources.id, sourceId));
    console.log(`Source ${slug} enabled.`);
  }

  console.log(
    useFixture ? `Reading fixture ${adapter.fixture}` : `Fetching ${adapter.config.baseUrl}...`,
  );

  const result = await runAdapter(slug, {
    html: useFixture ? readFileSync(adapter.fixture, "utf8") : undefined,
    force: flags.includes("--forzar"),
  });

  console.log(
    `\n${slug}: ${result.discovered} found | ${result.created} new | ` +
      `${result.updated} updated | ${result.unchanged} unchanged`,
  );

  if (!result.enabled) {
    console.log(
      `\nNote: this source is DISABLED, so its records do not appear in search.\n` +
        `To enable it: pnpm ingest ${slug} --habilitar`,
    );
  }

  await client.end();
}

main().catch(async (err) => {
  const prefix = err instanceof QuarantineError ? "QUARANTINE" : "Ingest failed";
  console.error(`\n${prefix}: ${err instanceof Error ? err.message : String(err)}`);
  await client.end().catch(() => {});
  process.exit(1);
});
