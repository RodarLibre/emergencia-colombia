-- Indices de expresion que drizzle-kit no genera. Idempotentes.
-- Se aplican con `pnpm db:seed` (o manualmente) despues de `pnpm db:push`.

-- Busqueda de texto completo en espanol sobre el texto ya normalizado.
CREATE INDEX IF NOT EXISTS observations_fts_idx
  ON observations
  USING gin (to_tsvector('spanish', search_text));

-- Coincidencia difusa para errores de tipeo y nombres parciales.
CREATE INDEX IF NOT EXISTS observations_trgm_idx
  ON observations
  USING gin (search_text gin_trgm_ops);
