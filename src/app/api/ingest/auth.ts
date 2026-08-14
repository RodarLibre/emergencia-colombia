import { timingSafeEqual } from "node:crypto";

/**
 * Autenticación de operador, compartida por la ingesta y el reporte de uso.
 *
 * Estaba duplicada: dos comparaciones de secreto que pueden divergir son dos
 * oportunidades de que una quede mal.
 */
export function authorized(request: Request): boolean {
  const expected = process.env.INGEST_SECRET;
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (provided.length !== expected.length) return false;

  // Comparación en tiempo constante: no filtra el secreto por latencia.
  return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
