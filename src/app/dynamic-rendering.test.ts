import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every page and route renders per request.
 *
 * The root layout reads the catalog — the source count and the integrity wall —
 * so prerendering ANY page renders that layout too, and the build opens a
 * database connection. The build machine has none. It fails inside Docker with
 * ECONNREFUSED while passing on any laptop that happens to have Postgres up,
 * which is the worst shape a failure can take: it only appears at deploy time,
 * on someone else's machine.
 *
 * This has now happened twice — `not-found.tsx`, then `/terminos` and
 * `/privacidad` — so it is checked instead of remembered. Reading the files is
 * the point: importing them would run them, and running them needs the database
 * this test exists to keep out of the build.
 *
 * A page that genuinely does not need the layout's data can be added to
 * `STATIC_ALLOWED`, deliberately and with a reason.
 */

const APP = join(process.cwd(), "src", "app");

/** Nothing yet. An entry here is a promise that the page renders without touching the catalog. */
const STATIC_ALLOWED: string[] = [];

function entryPoints(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return entryPoints(full);
    return /^(page|route)\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("rendering per request", () => {
  const files = entryPoints(APP);

  it("finds the pages at all, so a passing suite means something", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  for (const file of files) {
    const relative = file.slice(APP.length + 1);
    if (STATIC_ALLOWED.includes(relative)) continue;

    it(`${relative} is dynamic`, () => {
      expect(readFileSync(file, "utf8")).toContain('export const dynamic = "force-dynamic"');
    });
  }
});
