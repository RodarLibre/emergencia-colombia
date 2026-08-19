-- Sources that publish a recent window instead of their whole catalogue.
-- Idempotent, and deliberately not run through `drizzle-kit push`.
--
-- `push` diffs the WHOLE schema: asked to add this one column it also noticed
-- that answer_feedback's unique constraint was created by hand under a
-- different name, and offered to TRUNCATE that table to reconcile it. During an
-- emergency that is not a risk worth taking for one column.
--
--   psql "$DATABASE_URL" -f src/db/windowed-listing.sql
--
-- src/db/schema.ts still owns the definition; this file has to say the same.

ALTER TABLE sources
  ADD COLUMN IF NOT EXISTS windowed_listing boolean NOT NULL DEFAULT false;

-- Mapa de Emergencia publishes `vigencia_horas: 6` and says so itself: "lo que
-- no aparece aqui esta archivado".
UPDATE sources SET windowed_listing = true WHERE slug = 'mapa-emergencia';
