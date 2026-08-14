import limites from "./data/limites-municipios.json";
import { MUNICIPALITY_BY_CODE, type Municipality } from "./vocab";

/**
 * En qué municipio cae una coordenada.
 *
 * Esto NO es inferir. El invariante 5 prohíbe mejorar la precisión de una
 * ubicación: pasar de "el barrio tal" a una dirección exacta sería inventar.
 * Acá va al revés — una coordenada es más precisa que un municipio, y saber
 * en cuál cae es una operación geométrica contra el límite oficial del DANE,
 * no una suposición. Un punto está dentro de Palmira o no lo está.
 *
 * Se calcula al ingerir, nunca al buscar: el resultado se guarda como código
 * DANE y la búsqueda sigue siendo la de siempre. Por eso no hace falta
 * PostGIS, que este proyecto descartó a propósito.
 *
 * Solo carga los municipios de los departamentos cubiertos (ver
 * `limites-municipios.json`). Una coordenada de Medellín devuelve null, que es
 * la respuesta correcta: está fuera de la cobertura declarada, y decir que no
 * sabemos es mejor que asignarle el municipio más cercano.
 */

type Anillo = readonly (readonly number[])[];

/**
 * Ray casting: se traza una semirrecta horizontal desde el punto y se cuentan
 * los cruces con los lados del polígono. Impar, adentro; par, afuera.
 */
function dentroDelAnillo(lng: number, lat: number, anillo: Anillo): boolean {
  let dentro = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const xi = anillo[i]![0]!;
    const yi = anillo[i]![1]!;
    const xj = anillo[j]![0]!;
    const yj = anillo[j]![1]!;

    // El lado tiene que cruzar la latitud del punto, y el cruce quedar a su
    // derecha. La comparación asimétrica (`>` de un lado, `<=` del otro) evita
    // contar dos veces un vértice que toque la semirrecta justo.
    const cruza = yi > lat !== yj > lat;
    if (cruza && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}

/** Caja envolvente, para descartar rápido sin recorrer miles de vértices. */
type Caja = { minLng: number; maxLng: number; minLat: number; maxLat: number };

function cajaDe(poligonos: readonly Anillo[]): Caja {
  let minLng = Infinity,
    maxLng = -Infinity,
    minLat = Infinity,
    maxLat = -Infinity;
  for (const anillo of poligonos) {
    for (const [x, y] of anillo) {
      if (x! < minLng) minLng = x!;
      if (x! > maxLng) maxLng = x!;
      if (y! < minLat) minLat = y!;
      if (y! > maxLat) maxLat = y!;
    }
  }
  return { minLng, maxLng, minLat, maxLat };
}

const AREA = limites.municipios.map((m) => {
  const poligonos = m.poligonos as readonly Anillo[];
  return { code: m.code, poligonos, caja: cajaDe(poligonos) };
});

export const LIMITES_FUENTE = {
  fuente: limites.fuente,
  url: limites.url,
  descargado: limites.descargado,
  simplificacion: limites.simplificacion,
} as const;

/**
 * Devuelve el municipio que contiene la coordenada, o null si cae fuera del
 * área cubierta.
 */
export function municipioEnCoordenada(lat: number, lng: number): Municipality | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // 0,0 está en el golfo de Guinea: es el valor que deja un campo sin llenar,
  // no una ubicación.
  if (lat === 0 && lng === 0) return null;

  for (const m of AREA) {
    const { caja } = m;
    if (lng < caja.minLng || lng > caja.maxLng || lat < caja.minLat || lat > caja.maxLat) continue;
    if (m.poligonos.some((anillo) => dentroDelAnillo(lng, lat, anillo))) {
      return MUNICIPALITY_BY_CODE.get(m.code) ?? null;
    }
  }
  return null;
}
