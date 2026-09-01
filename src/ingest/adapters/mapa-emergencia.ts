/**
 * Mapa de Emergencia, de Artefacto Films.
 *
 * Mode: partner_feed. Jorge Caballero publicó `/api/publico` a pedido nuestro,
 * con las condiciones que él mismo puso y que este adaptador cumple:
 *
 *   - Mostrar siempre la hora de última confirmación junto a cada dato. Viene
 *     en `confirmado` y se guarda como `sourceUpdatedAt`, que es lo que la
 *     interfaz muestra en cada ficha.
 *   - Sin teléfonos: para contactar, se enlaza a la ficha (`enlace`).
 *   - Lo que desaparece del JSON está archivado. No se borra —el invariante 3
 *     lo prohíbe— pero el sitio lo marca solo: un registro que deja de venir
 *     se queda atrás en `last_seen_at` y aparece como "la fuente ya no lo
 *     publica".
 *
 * ALCANCE ACOTADO A PROPÓSITO
 *
 * El feed trae 790 puntos y seis tipos. Aquí entran cuatro —acopio, albergue,
 * salud y cocina— que son lugares que PRESTAN un servicio. Los de tipo
 * `rescate` y `otro` son lo contrario: sitios que necesitan ayuda, con conteo
 * de voluntarios que faltan. Eso es el tipo `need`, deliberadamente fuera de
 * v1, y entra solo con `MAPA_EMERGENCIA_INCLUIR_RESCATE=on`.
 *
 * El municipio no viene en el feed: se calcula desde las coordenadas contra
 * los límites del DANE (ver `lib/geo.ts`). Un punto fuera del Valle queda sin
 * municipio en vez de recibir el más cercano.
 *
 * Aunque Jorge no publica contactos, los usuarios los escriben dentro de los
 * campos de texto libre: cinco registros traían un celular en `nombre` o
 * `direccion`, uno de ellos como nombre completo. Todo texto pasa por
 * `redactContact` antes de guardarse.
 */
import { createHash } from "node:crypto";

import { municipioEnCoordenada } from "@/lib/geo";
import { buildSearchText, sanitizeText } from "@/lib/normalize";
import type { Category, RecordTypeV1, Status } from "@/lib/vocab";

import {
  ParserError,
  SourceGoneError,
  USER_AGENT,
  redactContact,
  type ParsedRecord,
} from "../types";

export const MAPA_EMERGENCIA_SOURCE = {
  slug: "mapa-emergencia",
  name: "Mapa de Emergencia (Artefacto Films)",
  baseUrl: "https://mapa-emergencia.artefactofilms.workers.dev",
  mode: "partner_feed",
  trustLabel: "community",
  pollIntervalSeconds: 900,
  // El feed es nacional. Se registra el departamento principal solo como
  // referencia: cada punto lleva su municipio calculado desde las coordenadas,
  // y los de fuera del area cubierta quedan sin municipio a proposito.
  coverageAdmin1Code: "76",
  // El feed trae `vigencia_horas: 6` y lo dice en su propia nota: "lo que no
  // aparece aqui esta archivado". Publica una ventana, no un catalogo, asi que
  // que un punto falte en una lectura NO significa que lo hayan retirado.
  windowedListing: true,
  contactNote:
    "Feed publico acordado con la fuente el 2026-08-14. Condiciones: mostrar siempre la hora de confirmacion, enlazar a la ficha para contacto, y atribuir con enlace al mapa. El contacto del acuerdo no se guarda en el repositorio.",
} as const;

const FEED_URL = `${MAPA_EMERGENCIA_SOURCE.baseUrl}/api/publico`;

/** Los cuatro tipos que prestan un servicio. `rescate` y `otro` van aparte. */
const TIPOS: Record<string, RecordTypeV1> = {
  acopio: "collection_point",
  albergue: "shelter",
  salud: "service_point",
  cocina: "service_point",
  agua: "service_point",
};

/** Tipos que describen un sitio que NECESITA ayuda, no que la presta. */
const TIPOS_DE_NECESIDAD = new Set(["rescate", "otro"]);

function incluirRescate(): boolean {
  return process.env.MAPA_EMERGENCIA_INCLUIR_RESCATE === "on";
}

const ESTADOS: Record<string, Status> = {
  urgente: "active",
  necesita: "active",
  cubierto: "partially_fulfilled",
  cerrado: "closed",
  descartado: "withdrawn",
};

/**
 * Las necesidades vienen como texto libre escrito por la comunidad. Se mapean
 * por raíz sin tilde, igual que el resto del vocabulario del proyecto.
 */
const NECESIDADES: ReadonlyArray<readonly [string, Category]> = [
  ["agua", "water"],
  ["electrolito", "water"],
  ["comida para animales", "animal_support"],
  ["comida", "food"],
  ["aliment", "food"],
  ["mercado", "food"],
  ["colchonet", "shelter"],
  ["carpa", "shelter"],
  ["cobija", "shelter"],
  ["panal", "baby_supplies"],
  ["botiquin", "medical_supplies"],
  ["medicament", "medical_supplies"],
  ["tapaboca", "medical_supplies"],
  ["guante", "rescue_equipment"],
  ["gafas", "rescue_equipment"],
  ["pica", "rescue_equipment"],
  ["pala", "rescue_equipment"],
  ["costal", "rescue_equipment"],
  ["balde", "rescue_equipment"],
  ["casco", "rescue_equipment"],
  ["linterna", "power"],
  ["pila", "power"],
  ["bateria", "power"],
  ["voluntari", "volunteers"],
  ["ropa", "clothing"],
  ["aseo", "hygiene"],
  ["jabon", "hygiene"],
];

function fold(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function categorias(necesidades: readonly string[]): Category[] {
  const found = new Set<Category>();
  for (const n of necesidades) {
    const hay = fold(n);
    for (const [raiz, cat] of NECESIDADES) {
      if (hay.includes(raiz)) found.add(cat);
    }
  }
  return [...found];
}

/**
 * Cuánta gente hay y cuánta falta, que es el dato que ninguna otra fuente
 * tiene. Se traduce a estado para que la respuesta distinga entre "acá hacen
 * falta manos" y "acá ya sobran": mandar a alguien a un sitio saturado le
 * gasta el viaje.
 */
function estadoPorDotacion(saturacion: string, faltan: number): Status | null {
  if (saturacion === "cerrado") return "closed";
  if (saturacion === "exceso") return "fulfilled";
  if (saturacion === "faltan" || faltan > 0) return "active";
  return null;
}

type Punto = {
  id?: unknown;
  enlace?: unknown;
  nombre?: unknown;
  tipo?: unknown;
  estado?: unknown;
  direccion?: unknown;
  barrio?: unknown;
  lat?: unknown;
  lng?: unknown;
  necesidades?: unknown;
  confirmado?: unknown;
  saturacion?: unknown;
  voluntarios_hay?: unknown;
  voluntarios_faltan?: unknown;
};

function texto(v: unknown, max = 300): string | null {
  if (typeof v !== "string") return null;
  const limpio = redactContact(sanitizeText(v, max));
  return limpio.length > 0 ? limpio : null;
}

export function parseFeed(body: string): ParsedRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ParserError("El feed no es JSON valido");
  }

  const puntos = (raw as { puntos?: unknown })?.puntos;
  if (!Array.isArray(puntos)) {
    throw new ParserError("El feed no trae un arreglo 'puntos'");
  }

  const conRescate = incluirRescate();
  const out: ParsedRecord[] = [];

  for (const p of puntos as Punto[]) {
    const id = typeof p.id === "string" ? p.id.trim() : "";
    const tipoCrudo = typeof p.tipo === "string" ? p.tipo.trim().toLowerCase() : "";
    if (!id || !tipoCrudo) continue;

    const esNecesidad = TIPOS_DE_NECESIDAD.has(tipoCrudo);
    if (esNecesidad && !conRescate) continue;

    // `rescate` y `otro` entran, cuando se habilitan, como punto de servicio:
    // son lugares físicos donde hay una operación en curso.
    const recordType = esNecesidad ? "service_point" : TIPOS[tipoCrudo];
    if (!recordType) continue;

    const nombre = texto(p.nombre, 200);
    const direccion = texto(p.direccion, 300);
    if (!nombre && !direccion) continue;

    const lat = typeof p.lat === "number" ? p.lat : null;
    const lng = typeof p.lng === "number" ? p.lng : null;
    const municipio = lat !== null && lng !== null ? municipioEnCoordenada(lat, lng) : null;

    const necesidades = Array.isArray(p.necesidades)
      ? p.necesidades.filter((n): n is string => typeof n === "string")
      : [];

    // `confirmado` viene en milisegundos. Es el dato que Jorge pidió mostrar
    // siempre, así que un registro sin fecha creíble no entra: mostrarlo sin
    // ella sería incumplir lo acordado.
    const ms = typeof p.confirmado === "number" ? p.confirmado : null;
    const confirmado = ms && ms > 1_000_000_000_000 && ms < 4_000_000_000_000 ? new Date(ms) : null;
    if (!confirmado) continue;

    const saturacion = typeof p.saturacion === "string" ? p.saturacion : "";
    const hay = typeof p.voluntarios_hay === "number" ? p.voluntarios_hay : 0;
    const faltan = typeof p.voluntarios_faltan === "number" ? p.voluntarios_faltan : 0;

    const title = nombre ?? direccion!;

    const partes: string[] = [];
    if (faltan > 0) {
      partes.push(`Faltan ${faltan} ${faltan === 1 ? "voluntario" : "voluntarios"}`);
    } else if (saturacion === "exceso") {
      partes.push("Ya hay suficientes voluntarios");
    }
    if (hay > 0) partes.push(`${hay} en el sitio`);
    if (necesidades.length > 0) partes.push(`Necesita: ${necesidades.slice(0, 12).join(", ")}`);
    const description = partes.length > 0 ? partes.join(". ") : null;

    const cats = categorias(necesidades);
    // Solo donde de verdad hacen falta manos. Sin esto, "donde puedo ayudar
    // con mano de obra" devolvería también los sitios que ya están cubiertos.
    if (faltan > 0 || saturacion === "faltan") {
      if (!cats.includes("volunteers")) cats.push("volunteers");
    }

    const record: ParsedRecord = {
      externalId: id,
      recordUrl:
        typeof p.enlace === "string" && p.enlace.startsWith(MAPA_EMERGENCIA_SOURCE.baseUrl)
          ? p.enlace
          : `${MAPA_EMERGENCIA_SOURCE.baseUrl}/#p=${id}`,
      recordType,
      // La dotación manda sobre el estado declarado: un sitio "urgente" con
      // exceso de voluntarios no necesita más gente.
      status:
        estadoPorDotacion(saturacion, faltan) ??
        ESTADOS[typeof p.estado === "string" ? p.estado : ""] ??
        "unknown",
      title,
      description,
      categoryCodes: cats,
      locality: texto(p.barrio, 120),
      displayAddress: direccion,
      openingHours: null,
      admin2Code: municipio?.code ?? null,
      admin2Name: municipio?.name ?? null,
      sourceUpdatedAt: confirmado,
      contentHash: "",
      searchText: "",
    };

    record.searchText = buildSearchText({
      title: [record.title, record.displayAddress].filter(Boolean).join(" "),
      description: record.description,
      locality: record.locality,
      admin2Name: record.admin2Name,
      categoryCodes: record.categoryCodes,
    });
    record.contentHash = createHash("sha256")
      .update(
        JSON.stringify([
          record.title,
          record.description,
          record.status,
          record.displayAddress,
          record.admin2Code,
          record.categoryCodes,
          confirmado.toISOString(),
        ]),
      )
      .digest("hex");

    out.push(record);
  }

  if (out.length === 0) {
    throw new ParserError("El feed no produjo ningun registro utilizable");
  }
  return out;
}

/** Devuelve el cuerpo crudo: el registro separa traer de interpretar. */
export async function fetchMapaEmergencia(): Promise<string> {
  const response = await fetch(FEED_URL, {
    headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });

  // El 31 de agosto de 2026 la fuente cerro: las tres rutas del Worker
  // responden 410 con `{"cerrado":true,"archivo":"..."}`, y el sitio sirve un
  // aviso firmado que lo dice con fecha. Un 410 es lo mas explicito que puede
  // ser un retiro por HTTP, asi que se distingue del resto de fallos en vez de
  // reintentarse cada quince minutos para siempre.
  if (response.status === 410) {
    let archive: string | null = null;
    try {
      archive = (JSON.parse(await response.text()) as { archivo?: string }).archivo ?? null;
    } catch {
      // El cuerpo es cortesia, no contrato: el 410 ya dijo lo que importa.
    }
    throw new SourceGoneError(
      `La fuente respondio 410 Gone: se retiro de forma explicita.${archive ? ` Archivo: ${archive}` : ""}`,
      archive,
    );
  }

  if (!response.ok) {
    throw new ParserError(`El feed respondio ${response.status}`);
  }
  return response.text();
}
