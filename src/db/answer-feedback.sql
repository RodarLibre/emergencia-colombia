-- Feedback on answers. Idempotent.
--
-- Kept out of `drizzle-kit push` on purpose. `push` diffs the WHOLE schema
-- against the live database: for a new table it emits a clean CREATE, but if
-- production has drifted from the schema for any reason it also proposes
-- changes to tables nobody asked to touch — observations, source_records —
-- and that is exactly the mistake that must not happen during an emergency.
--
-- This is one statement, read in full before it is applied:
--
--   psql "$DATABASE_URL" -f src/db/answer-feedback.sql
--
-- src/db/schema.ts still owns the definition; this file has to say the same
-- thing. In development `pnpm db:push` is enough.

CREATE TABLE IF NOT EXISTS answer_feedback (
  id              serial PRIMARY KEY,
  turn_id         text NOT NULL UNIQUE,
  rating          text NOT NULL,
  reasons         text[] NOT NULL DEFAULT '{}',
  context         jsonb NOT NULL,
  question_text   text,
  comment         text,
  consent_version text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS answer_feedback_created_idx
  ON answer_feedback (created_at);
