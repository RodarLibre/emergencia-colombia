import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Everything the code can read, the container must receive.
 *
 * Kamal does not read `.env`: a variable reaches production only if
 * `deploy.yml` declares it. One that it does not is silently stuck on its
 * default, and putting a value in `.env` changes nothing — the setting looks
 * configurable and is not.
 *
 * `FEEDBACK_TEXT` arrived that way, and the audit that found it turned up seven
 * more: the quota and flood knobs. Those are the ones somebody would reach for
 * during a traffic spike, which is exactly when there is no time to edit code
 * and wait for a build.
 *
 * Declaring one costs nothing: `positiveInt` treats an empty string as unset,
 * so `deploy.yml` passes `""` and the default in this module still decides. No
 * limit is written down twice.
 */

const SRC = join(process.cwd(), "src");

/** Provided by the platform, or a legacy fallback for a name that IS declared. */
const EXEMPT = new Set(["NODE_ENV", "NEXT_PHASE", "NAME", "OPERATING_ADMIN1_CODE"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("configuration reaches production", () => {
  it("deploy.yml declares every variable the code reads", () => {
    const read = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      for (const m of readFileSync(file, "utf8").matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
        read.add(m[1]!);
      }
    }
    // A passing suite has to mean the scan worked.
    expect(read.size).toBeGreaterThan(5);

    const yaml = readFileSync(join(process.cwd(), "config", "deploy.yml"), "utf8");
    const declared = new Set([
      // `clear:` entries, and the `secret:` list.
      ...[...yaml.matchAll(/^\s{4,6}([A-Z0-9_]+):/gm)].map((m) => m[1]!),
      ...[...yaml.matchAll(/^\s*-\s([A-Z0-9_]+)\s*$/gm)].map((m) => m[1]!),
    ]);

    const missing = [...read].filter((v) => !declared.has(v) && !EXEMPT.has(v)).sort();
    expect(missing).toEqual([]);
  });
});
