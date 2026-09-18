-- ============================================================
-- Academic Year Management
-- Add full academic-year lifecycle to RMS.
--
-- Run this in the Supabase SQL Editor BEFORE using the new
-- "Academic Years" management UI (admin-academic.js).
-- After applying, edit each existing year once to set its
-- name to the single format "2025–2026" and choose a status.
-- ============================================================

-- 1) academic_years: introduced columns (on conflict: drop + re-add the CHECK so it always reflects the final shape)
ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_status_check;

ALTER TABLE academic_years
  ADD COLUMN IF NOT EXISTS start_year INTEGER,
  ADD COLUMN IF NOT EXISTS end_year INTEGER,
  ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE academic_years
  ADD CONSTRAINT academic_years_status_check CHECK (status IN ('active', 'upcoming', 'archived', 'inactive'));

-- Name must match the start/end years exactly ("2026–2027", en dash, no spacing).
-- NOTE: no regex escapes are used here — Postgres' ARE regex has no \x{...}, which
-- can abort the whole script. NULL start/end years are allowed so pre-existing rows
-- stay valid; the app writes start_year/end_year on first edit of an existing year.
ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_name_check;
ALTER TABLE academic_years ADD CONSTRAINT academic_years_name_check
  CHECK (name = (start_year::text || '–' || end_year::text));

ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_year_range_check;
ALTER TABLE academic_years ADD CONSTRAINT academic_years_year_range_check
  CHECK (end_year = start_year + 1);

ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_name_key;
ALTER TABLE academic_years ADD CONSTRAINT academic_years_name_key UNIQUE (name);

-- Exactly one CURRENT year at any time (NULL means nothing is current)
CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current
  ON academic_years ((TRUE)) WHERE is_current = TRUE;

-- 2) terms: order + single active term per year, update existing names
ALTER TABLE terms ADD COLUMN IF NOT EXISTS term_no INTEGER;
ALTER TABLE terms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE terms SET term_no = CASE
  WHEN position(lower(name) IN 'term i') > 0 THEN 1
  WHEN position(lower(name) IN 'term ii') > 0 THEN 2
  ELSE 3
END WHERE term_no IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS terms_active_one_per_year
  ON terms (academic_year_id) WHERE is_active = TRUE;

-- 3) keep updated_at fresh whenever a year row changes
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS academic_years_set_updated_at ON academic_years;
CREATE TRIGGER academic_years_set_updated_at
  BEFORE UPDATE ON academic_years
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4) RLS: consistent with the rest of the app (database.sql clean-state design).
--    This project has NO 'profiles' table (roles live on public.users), so
--    policies must never reference 'profiles' — a missing relation makes
--    PostgREST return HTTP 400 on every academic_years request.
--    DOS-only actions are enforced at the app/UI layer (role checks in JS).
ALTER TABLE academic_years ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS academic_years_select ON academic_years;
DROP POLICY IF EXISTS academic_years_insert ON academic_years;
DROP POLICY IF EXISTS academic_years_update ON academic_years;
DROP POLICY IF EXISTS academic_years_delete ON academic_years;
DROP POLICY IF EXISTS rms_academic_years_all ON academic_years;

CREATE POLICY rms_academic_years_all ON public.academic_years
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL PRIVILEGES ON TABLE public.academic_years TO anon, authenticated;
GRANT ALL PRIVILEGES ON TABLE public.terms TO anon, authenticated;