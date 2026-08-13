-- Local environment only. In production, extensions are enabled via
-- migration or through the managed provider's console.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- No PostGIS: v1 doesn't use geometries. See the note in docker-compose.yml.
