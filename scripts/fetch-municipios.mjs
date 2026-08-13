/**
 * Generates src/lib/data/municipios.json from DANE's Marco Geoestadistico
 * Nacional (MGN 2024).
 *
 *   node scripts/fetch-municipios.mjs
 *
 * Requested without geometry: only code and name are needed, not polygons.
 * The whole country fits in a single query (1121 municipalities,
 * maxRecordCount 2000).
 *
 * Important: use FeatureServer, not MapServer. The equivalent MapServer
 * returns incomplete attributes.
 *
 * This script exists so the list is reproducible and auditable instead of a
 * hand-written file. If DANE publishes MGN 2025, change the URL and run it again.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const LAYER =
  "https://geoportal.dane.gov.co/mparcgis/rest/services/MGN2024/Serv_CapasMGN_2024/FeatureServer/317";

const OUT = join(process.cwd(), "src/lib/data/municipios.json");

/** Lowercase words that don't get capitalized in Spanish place names. */
const LOWER = new Set(["de", "del", "la", "las", "los", "y", "e"]);

/** Abbreviations with periods like "D.C." are left fully uppercase. */
const ABBREVIATION = /^(?:[a-z]\.)+,?$/;

function titleCase(raw) {
  return raw
    .toLocaleLowerCase("es-CO")
    .split(/\s+/)
    .map((word, i) => {
      if (ABBREVIATION.test(word)) return word.toLocaleUpperCase("es-CO");
      if (i > 0 && LOWER.has(word)) return word;
      return word.charAt(0).toLocaleUpperCase("es-CO") + word.slice(1);
    })
    .join(" ");
}

async function main() {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "mpio_cdpmp,mpio_cnmbr,dpto_ccdgo,dpto_cnmbr",
    returnGeometry: "false",
    orderByFields: "mpio_cdpmp ASC",
    f: "json",
  });

  console.log("Consultando el DANE...");
  const res = await fetch(`${LAYER}/query?${params}`, {
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`DANE respondio ${res.status}`);

  const body = await res.json();
  if (body.error) throw new Error(`DANE: ${JSON.stringify(body.error)}`);
  if (body.exceededTransferLimit) {
    throw new Error("Se excedio el limite de registros: hay que paginar con resultOffset.");
  }

  const features = body.features ?? [];
  if (features.length < 1000) {
    throw new Error(`Solo llegaron ${features.length} municipios; se esperaban ~1121.`);
  }

  const municipios = features
    .map((f) => f.attributes)
    .map((a) => ({
      code: String(a.mpio_cdpmp),
      name: titleCase(String(a.mpio_cnmbr)),
      dept: String(a.dpto_ccdgo),
      deptName: titleCase(String(a.dpto_cnmbr)),
    }))
    .sort((a, b) => a.code.localeCompare(b.code));

  const payload = {
    source: "DANE - Marco Geoestadistico Nacional 2024",
    layer: LAYER,
    fetchedAt: new Date().toISOString(),
    count: municipios.length,
    municipios,
  };

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(payload, null, 0)}\n`);

  const byDept = new Map();
  for (const m of municipios) byDept.set(m.dept, (byDept.get(m.dept) ?? 0) + 1);
  console.log(`${municipios.length} municipios en ${byDept.size} departamentos -> ${OUT}`);
  console.log(`Valle del Cauca (76): ${byDept.get("76")} municipios`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
