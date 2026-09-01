/**
 * Ingest CLI.
 *
 *   pnpm ingest cali-ayuda                 # reads from the live source
 *   pnpm ingest cali-ayuda --fixture       # reads the local fixture, no network
 *   pnpm ingest cali-ayuda --habilitar     # marks the source as enabled
 *   pnpm ingest cali-ayuda --forzar        # skips the count-drop guard
 *   pnpm ingest mapa-emergencia --retirar  # the source withdrew: its records leave search
 *   pnpm ingest mapa-emergencia --restaurar # undoes a --retirar
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
import { ensureSource, restoreSourceRecords, withdrawSourceRecords } from "./upsert";
import { QuarantineError } from "./upsert";
import { SourceGoneError } from "./types";

async function main() {
  const [slug, ...flags] = process.argv.slice(2);

  if (!slug || !isAdapterSlug(slug)) {
    console.error(
      "Usage: pnpm ingest <slug> [--fixture] [--habilitar] [--forzar] [--retirar] [--restaurar]",
    );
    console.error(`Available: ${ADAPTER_SLUGS.join(", ")}`);
    process.exit(1);
  }

  const adapter = ADAPTERS[slug];
  const useFixture = flags.includes("--fixture");

  // Retirar y restaurar terminan aca: no leen la fuente, y correr la ingesta
  // despues de retirar volveria a crear todo lo que se acaba de retirar.
  if (flags.includes("--retirar") || flags.includes("--restaurar")) {
    const sourceId = await ensureSource(adapter.config);

    if (flags.includes("--restaurar")) {
      const restored = await restoreSourceRecords(sourceId);
      console.log(`${slug}: ${restored} registros vuelven a aparecer en las busquedas.`);
      await client.end();
      return;
    }

    const { withdrawn, alreadyWithdrawn } = await withdrawSourceRecords(sourceId);
    console.log(
      `${slug}: ${withdrawn} registros retirados` +
        (alreadyWithdrawn ? ` (${alreadyWithdrawn} ya lo estaban)` : "") +
        `.\n\nNo se borro nada: las observaciones siguen intactas y esto se deshace con\n` +
        `  pnpm ingest ${slug} --restaurar\n\n` +
        `Acordate de quitar la linea de cron de esta fuente en el host: si sigue\n` +
        `corriendo, cada corrida vuelve a fallar contra una fuente que ya cerro.`,
    );
    await client.end();
    return;
  }

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
  if (err instanceof SourceGoneError) {
    // No es un fallo de lectura: la fuente dijo que se retiro. Se nombra
    // distinto porque la accion tambien es distinta, y decirlo aca es lo que
    // evita que quede reintentandose para siempre.
    console.error(
      `\nLA FUENTE SE RETIRO: ${err.message}\n\n` +
        `Sus registros siguen apareciendo en las busquedas hasta que se retiren:\n` +
        `  pnpm ingest <slug> --retirar`,
    );
    await client.end().catch(() => {});
    process.exit(1);
  }
  const prefix = err instanceof QuarantineError ? "QUARANTINE" : "Ingest failed";
  console.error(`\n${prefix}: ${err instanceof Error ? err.message : String(err)}`);
  await client.end().catch(() => {});
  process.exit(1);
});
