-- ============================================================
-- RMS-MIS ASSESSMENT TYPES — DATABASE SUPPORT
-- Run in Supabase SQL Editor (idempotent).
-- 1. Creates the assessment_types reference table — the flexibly
--    configurable categories of assessment (Quiz, Assignment,
--    Practical, Project, End-of-Unit Assessment, Terminal
--    Examination, ...). Types are managed in the app, never
--    hard-coded in the JavaScript.
-- 2. Adds assessment_type_id, weight, description to assessments.
--    weight is NULL by default; a value overrides the type's
--    default weight for weighted combined-report aggregation.
-- 3. Makes unit optional (unit only matters for unit-based types
--    such as the End-of-Unit Assessment).
-- 4. Backfills every existing assessment to the End-of-Unit
--    Assessment type so all historic data keeps its meaning.
-- Run AFTER this migration in the same SQL Editor session (or any
-- order): migration-rms-mis-rls.sql (row-level security).
-- ============================================================

-- ------------------------------------------------------------
-- 1) assessment_types table
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.assessment_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  default_maximum_mark NUMERIC NOT NULL DEFAULT 30,
  weight NUMERIC,
  contributes_to_combined BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 1b) Reconcile a pre-existing assessment_types table that may
--     have been created earlier with an outdated shape (e.g.
--     missing the default_maximum_mark column). CREATE TABLE
--     IF NOT EXISTS does NOT add missing columns to an existing
--     table, so every column is (re)asserted here idempotently.
-- ------------------------------------------------------------
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS default_maximum_mark NUMERIC NOT NULL DEFAULT 30;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS weight NUMERIC;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS contributes_to_combined BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.assessment_types ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- Carry over a legacy max-mark column if one exists under an old name.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='assessment_types' AND column_name='maximum_mark') THEN
    UPDATE public.assessment_types
       SET default_maximum_mark = COALESCE(default_maximum_mark, maximum_mark * 1.0)
     WHERE maximum_mark IS NOT NULL;
  END IF;
END $$;

-- Backfill missing codes, dedupe, then enforce unique keys so the
-- idempotent seeding below (ON CONFLICT (name)) always works.
UPDATE public.assessment_types
   SET code = UPPER(REPLACE(REPLACE(TRIM(name), ' ', '_'), '-', '_'))
 WHERE code IS NULL OR code = '';

DELETE FROM public.assessment_types a
 USING public.assessment_types b
 WHERE a.id > b.id AND a.name = b.name;

CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_name_key ON public.assessment_types (name);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_code_key ON public.assessment_types (code);

-- ------------------------------------------------------------
-- 2) assessments: type, weight, description
-- ------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS assessment_type_id UUID REFERENCES public.assessment_types(id),
  ADD COLUMN IF NOT EXISTS weight NUMERIC,
  ADD COLUMN IF NOT EXISTS description TEXT;

-- unit is now optional; only unit-based types need it.
ALTER TABLE public.assessments ALTER COLUMN unit DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_assessments_assessment_type_id
  ON public.assessments (assessment_type_id);

-- ------------------------------------------------------------
-- 3) Seed the configurable types (idempotent)
-- ------------------------------------------------------------
INSERT INTO public.assessment_types
  (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status)
VALUES
  ('Quiz',                      'QUIZ',  'Short, low-stakes knowledge check.',                     20,  NULL, TRUE,  1, 'active'),
  ('Assignment',                'ASGMT', 'Take-home or in-class written work.',                    20,  NULL, TRUE,  2, 'active'),
  ('Practical',                 'PRAC',  'Hands-on or laboratory-based assessment.',               30,  NULL, TRUE,  3, 'active'),
  ('Project',                   'PROJ',  'Extended project or portfolio work.',                    50,  NULL, TRUE,  4, 'active'),
  ('Class Test',                'CTEST', 'A test written during normal class time.',               20,  NULL, TRUE,  5, 'active'),
  ('Continuous Assessment',     'CA',    'Ongoing observation and marking across the term.',       20,  NULL, TRUE,  6, 'active'),
  ('Oral Assessment',           'ORAL',  'Verbal question-and-answer assessment.',                 10,  NULL, TRUE,  7, 'active'),
  ('End-of-Unit Assessment',    'EOU',   'Structured assessment covering one completed unit of study.', 30, NULL, TRUE,  8, 'active'),
  ('Mid-Term Examination',      'MTE',   'Formal examination held mid-term.',                      50,  NULL, TRUE,  9, 'active'),
  ('Terminal Examination',      'TE',    'Formal end-of-term examination.',                        100, NULL, TRUE, 10, 'active'),
  ('Other',                     'OTHER', 'Any other category of assessment.',                      30,  NULL, TRUE, 11, 'active')
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 4) Backfill existing assessments to End-of-Unit Assessment
-- ------------------------------------------------------------
DO $$
DECLARE v_eou UUID;
BEGIN
  SELECT id INTO v_eou FROM public.assessment_types WHERE code = 'EOU';
  UPDATE public.assessments
     SET assessment_type_id = v_eou
   WHERE assessment_type_id IS NULL;
END $$;

-- ------------------------------------------------------------
-- 5) Verification
-- ------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'assessments'
  AND column_name IN ('assessment_type_id','weight','description');

SELECT COUNT(*) AS seeded_types FROM public.assessment_types;

SELECT COALESCE(at.name, '(none assigned)') AS type, COUNT(*) AS assessments
FROM public.assessments a
LEFT JOIN public.assessment_types at ON at.id = a.assessment_type_id
GROUP BY at.name ORDER BY assessments DESC;