/**
 * Demo data for developing the UI without depending on scraping.
 *
 * ALL OF THIS IS FAKE AND MARKED AS SUCH. Sources carry the "demo-" prefix
 * and the name says TEST DATA, so there's no way to confuse a made-up
 * shelter with a real one. The script refuses to run with NODE_ENV=production.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { sql } from "drizzle-orm";

import { client, db } from "@/db";
import { observations, sourceRecords, sources } from "@/db/schema";
import { buildSearchText } from "@/lib/normalize";
import { OPERATING_ADMIN1, type Category, type RecordTypeV1, type Status } from "@/lib/vocab";

if (process.env.NODE_ENV === "production") {
  throw new Error("db:seed does not run in production. This data is fake.");
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

type SeedRecord = {
  externalId: string;
  type: RecordTypeV1;
  status: Status;
  title: string;
  description: string;
  categories: Category[];
  admin2Code: string;
  admin2Name: string;
  locality: string | null;
  precision: string;
  verification: "official" | "source_verified" | "community_unverified" | "unknown";
  /** Minutes back for the source's last data point. */
  updatedMinutesAgo: number;
};

type SeedSource = {
  slug: string;
  name: string;
  baseUrl: string;
  mode: string;
  trustLabel: string;
  records: SeedRecord[];
};

const SEED: SeedSource[] = [
  {
    slug: "demo-acopios",
    name: "Demo Acopios Valle (DATOS DE PRUEBA)",
    baseUrl: "https://example.invalid/acopios",
    mode: "manual",
    trustLabel: "community",
    records: [
      {
        externalId: "ac-001",
        type: "collection_point",
        status: "active",
        title: "Acopio Unidad Deportiva - recibe agua y alimentos no perecederos",
        description:
          "Reciben agua embotellada, enlatados y arroz. Piden no llevar ropa usada por falta de espacio.",
        categories: ["water", "food"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: "San Fernando",
        precision: "locality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 45,
      },
      {
        externalId: "ac-002",
        type: "collection_point",
        status: "active",
        title: "Punto de acopio Parque del Ingenio - insumos medicos",
        description: "Necesitan gasas, suero fisiologico y analgesicos. Abierto de 8am a 6pm.",
        categories: ["medical_supplies"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: "Ciudad Jardin",
        precision: "locality_only",
        verification: "source_verified",
        updatedMinutesAgo: 120,
      },
      {
        externalId: "ac-003",
        type: "collection_point",
        status: "active",
        title: "Acopio Palmira centro - agua y elementos de aseo",
        description: "Reciben agua, jabon, panales y toallas higienicas.",
        categories: ["water", "hygiene"],
        admin2Code: "76520",
        admin2Name: "Palmira",
        locality: "Centro",
        precision: "locality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 200,
      },
      {
        externalId: "ac-004",
        type: "collection_point",
        status: "fulfilled",
        title: "Acopio Yumbo - ya no recibe ropa",
        description: "Cerraron la recepcion de ropa por saturacion. Siguen recibiendo agua.",
        categories: ["clothing", "water"],
        admin2Code: "76892",
        admin2Name: "Yumbo",
        locality: null,
        precision: "municipality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 300,
      },
      {
        externalId: "ac-005",
        type: "collection_point",
        status: "active",
        title: "Acopio Tulua - materiales de construccion y herramienta",
        description: "Reciben laminas de zinc, clavos, palas y carretillas.",
        categories: ["construction_materials", "rescue_equipment"],
        admin2Code: "76834",
        admin2Name: "Tulua",
        locality: null,
        precision: "municipality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 900,
      },
      {
        externalId: "ac-006",
        type: "collection_point",
        status: "active",
        title: "Acopio Buenaventura - alimentos y agua",
        description: "Punto habilitado en coliseo municipal. Reciben agua y mercados.",
        categories: ["food", "water"],
        admin2Code: "76109",
        admin2Name: "Buenaventura",
        locality: null,
        precision: "municipality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 2600,
      },
    ],
  },
  {
    slug: "demo-albergues",
    name: "Demo Albergues y Servicios (DATOS DE PRUEBA)",
    baseUrl: "https://example.invalid/albergues",
    mode: "manual",
    trustLabel: "ngo",
    records: [
      {
        externalId: "al-001",
        type: "shelter",
        status: "active",
        title: "Albergue temporal Institucion Educativa Cali sur",
        description: "Capacidad 120 personas. Hay cupo. Cuentan con agua y alimentacion.",
        categories: ["shelter", "food", "water"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: "Meléndez",
        precision: "locality_only",
        verification: "source_verified",
        updatedMinutesAgo: 90,
      },
      {
        externalId: "al-002",
        type: "shelter",
        status: "fulfilled",
        title: "Albergue Palmira norte - sin cupo",
        description: "Capacidad llena. Remiten a coordinacion municipal para reubicacion.",
        categories: ["shelter"],
        admin2Code: "76520",
        admin2Name: "Palmira",
        locality: null,
        precision: "municipality_only",
        verification: "source_verified",
        updatedMinutesAgo: 240,
      },
      {
        externalId: "al-003",
        type: "service_point",
        status: "active",
        title: "Punto de atencion medica Jamundi",
        description: "Atencion de heridas leves y entrega de medicamentos basicos.",
        categories: ["medical_assistance", "medical_supplies"],
        admin2Code: "76364",
        admin2Name: "Jamundí",
        locality: null,
        precision: "municipality_only",
        verification: "source_verified",
        updatedMinutesAgo: 60,
      },
      {
        externalId: "al-004",
        type: "service_point",
        status: "active",
        title: "Punto de carga de celulares y wifi Cali centro",
        description: "Energia y conexion gratuita. Funciona con planta electrica.",
        categories: ["power", "communications"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: "Centro",
        precision: "locality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 150,
      },
      {
        externalId: "al-005",
        type: "service_point",
        status: "active",
        title: "Cocina comunitaria Cartago",
        description: "Entrega de almuerzos de 12m a 2pm. Buscan voluntarios.",
        categories: ["food", "volunteers"],
        admin2Code: "76147",
        admin2Name: "Cartago",
        locality: null,
        precision: "municipality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 400,
      },
      {
        externalId: "al-006",
        type: "shelter",
        status: "active",
        title: "Albergue Guadalajara de Buga - recibe familias con mascotas",
        description: "Aceptan animales de compania. Requieren cobijas.",
        categories: ["shelter", "animal_support", "clothing"],
        admin2Code: "76111",
        admin2Name: "Guadalajara de Buga",
        locality: null,
        precision: "municipality_only",
        verification: "community_unverified",
        updatedMinutesAgo: 1500,
      },
    ],
  },
  {
    slug: "demo-oficial",
    name: "Demo Comunicados Oficiales (DATOS DE PRUEBA)",
    baseUrl: "https://example.invalid/oficial",
    mode: "manual",
    trustLabel: "official",
    records: [
      {
        externalId: "of-001",
        type: "official_update",
        status: "active",
        title: "Linea unica de emergencias 123 habilitada en todo el Valle",
        description:
          "La linea 123 opera con normalidad. Se pide reservarla para emergencias vitales.",
        categories: ["information"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: null,
        precision: "municipality_only",
        verification: "official",
        updatedMinutesAgo: 30,
      },
      {
        externalId: "of-002",
        type: "official_update",
        status: "active",
        title: "Suspension de clases en Cali y Palmira",
        description:
          "Se suspenden clases presenciales hasta nuevo aviso en instituciones publicas.",
        categories: ["information"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: null,
        precision: "municipality_only",
        verification: "official",
        updatedMinutesAgo: 180,
      },
      {
        externalId: "of-003",
        type: "hazard",
        status: "active",
        title: "Riesgo de deslizamiento en via Cali - Buenaventura",
        description:
          "Se recomienda no transitar el corredor sin confirmar estado con autoridades de transito.",
        categories: ["information", "transport"],
        admin2Code: "76109",
        admin2Name: "Buenaventura",
        locality: null,
        precision: "municipality_only",
        verification: "official",
        updatedMinutesAgo: 40,
      },
      {
        externalId: "of-004",
        type: "hazard",
        status: "active",
        title: "Alerta por replicas en zona centro del Valle",
        description: "Se mantiene monitoreo. Evitar estructuras con danos visibles.",
        categories: ["information"],
        admin2Code: "76834",
        admin2Name: "Tulua",
        locality: null,
        precision: "municipality_only",
        verification: "official",
        updatedMinutesAgo: 200,
      },
      {
        externalId: "of-005",
        type: "official_update",
        status: "active",
        title: "Puntos de hidratacion habilitados por la administracion municipal",
        description: "Se habilitan carrotanques en varios barrios. Consultar horarios por comuna.",
        categories: ["water", "information"],
        admin2Code: "76001",
        admin2Name: "Cali",
        locality: null,
        precision: "municipality_only",
        verification: "official",
        updatedMinutesAgo: 75,
      },
    ],
  },
];

/**
 * Deliberately contradictory pair.
 *
 * demo-albergues says the Palmira norte shelter has no spots left; this
 * community source says it's still open and receiving people. This is the
 * case that matters: if someone sees only one of the two, they travel with
 * incomplete information. The UI has to show both and flag the disagreement,
 * not pick a winner.
 */
const CONFLICT_PAIR: { sourceSlug: string; record: SeedRecord } = {
  sourceSlug: "demo-acopios",
  record: {
    externalId: "ac-007",
    type: "shelter",
    status: "active",
    title: "Albergue Palmira norte - reportan que sigue abierto",
    description: "Vecinos indican que el albergue sigue recibiendo personas esta noche.",
    categories: ["shelter"],
    admin2Code: "76520",
    admin2Name: "Palmira",
    locality: null,
    precision: "municipality_only",
    verification: "community_unverified",
    updatedMinutesAgo: 100,
  },
};

function hashOf(r: SeedRecord, updatedAt: Date): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...r, updatedAt: updatedAt.toISOString() }))
    .digest("hex");
}

async function insertRecord(sourceId: number, baseUrl: string, r: SeedRecord) {
  const sourceUpdatedAt = minutesAgo(r.updatedMinutesAgo);
  // observed_at is always "when this system saw it", not what the source says.
  const observedAt = minutesAgo(Math.max(0, r.updatedMinutesAgo - 5));

  const [record] = await db
    .insert(sourceRecords)
    .values({
      sourceId,
      externalId: r.externalId,
      canonicalUrl: `${baseUrl}/${r.externalId}`,
      firstSeenAt: observedAt,
      lastSeenAt: observedAt,
      lastContentHash: hashOf(r, sourceUpdatedAt),
    })
    .returning();

  if (!record) throw new Error(`Could not create source_record ${r.externalId}`);

  await db.insert(observations).values({
    sourceRecordId: record.id,
    recordType: r.type,
    status: r.status,
    title: r.title,
    description: r.description,
    categoryCodes: r.categories,
    admin1Code: OPERATING_ADMIN1.code,
    admin1Name: OPERATING_ADMIN1.name,
    admin2Code: r.admin2Code,
    admin2Name: r.admin2Name,
    locality: r.locality,
    locationPrecision: r.precision,
    verificationLevel: r.verification,
    sourceUpdatedAt,
    observedAt,
    contentHash: hashOf(r, sourceUpdatedAt),
    searchText: buildSearchText({
      title: r.title,
      description: r.description,
      locality: r.locality,
      admin2Name: r.admin2Name,
      categoryCodes: r.categories,
    }),
  });
}

async function main() {
  console.log("Applying expression indexes...");
  // `unsafe` because it's a repo file, not user input.
  const indexSql = readFileSync(join(process.cwd(), "src/db/indexes.sql"), "utf8");
  await client.unsafe(indexSql);

  console.log("Clearing previous demo data...");
  await db.execute(sql`
    DELETE FROM sources WHERE slug LIKE 'demo-%'
  `);

  const idBySlug = new Map<string, { id: number; baseUrl: string }>();

  for (const s of SEED) {
    const [inserted] = await db
      .insert(sources)
      .values({
        slug: s.slug,
        name: s.name,
        baseUrl: s.baseUrl,
        mode: s.mode,
        trustLabel: s.trustLabel,
        // Demo sources are explicitly enabled; real ones start as false.
        enabled: true,
        policyReviewedAt: new Date(),
        contactNote: "Fuente ficticia para desarrollo local.",
      })
      .returning();

    if (!inserted) throw new Error(`Could not create source ${s.slug}`);
    idBySlug.set(s.slug, { id: inserted.id, baseUrl: s.baseUrl });

    for (const r of s.records) {
      await insertRecord(inserted.id, s.baseUrl, r);
    }
    console.log(`  ${s.slug}: ${s.records.length} records`);
  }

  const conflictSource = idBySlug.get(CONFLICT_PAIR.sourceSlug);
  if (conflictSource) {
    await insertRecord(conflictSource.id, conflictSource.baseUrl, CONFLICT_PAIR.record);
    console.log("  contradictory pair added (Palmira norte shelter)");
  }

  const total = SEED.reduce((n, s) => n + s.records.length, 0) + 1;
  console.log(`\nDone: ${SEED.length} sources, ${total} test records.`);
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
