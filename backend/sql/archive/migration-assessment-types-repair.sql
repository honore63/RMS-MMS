-- ============================================================================
-- RMS — ASSESSMENT TYPES REPAIR / COMPLETION
-- Ensures ALL 11 standard assessment types exist in the database.
-- Idempotent — safe to run multiple times.
-- Run AFTER migration-rms-mis-assessment-types-rls-combined.sql
-- ============================================================================

-- ------------------------------------------------------------
-- 1) Verify/repair the assessment_types table schema
-- ------------------------------------------------------------
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS default_maximum_mark NUMERIC NOT NULL DEFAULT 30;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS weight NUMERIC;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS contributes_to_combined BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS period_hint TEXT;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure the id column uses uuid_generate_v4
ALTER TABLE public.assessment_types ALTER COLUMN id SET DEFAULT uuid_generate_v4();

-- ------------------------------------------------------------
-- 2) Upsert all 11 standard assessment types (idempotent)
--    Uses ON CONFLICT (name) DO NOTHING — existing rows kept.
--    For any missing types, they get inserted.
-- ------------------------------------------------------------
INSERT INTO public.assessment_types
  (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status, period_hint, is_standard)
VALUES
  ('Quiz',                      'QUIZ',  'Short, low-stakes knowledge check.',                     20,  NULL, TRUE,  1, 'active', 'any', TRUE),
  ('Assignment',                'ASGMT', 'Take-home or in-class written work.',                    20,  NULL, TRUE,  2, 'active', 'any', TRUE),
  ('Practical',                 'PRAC',  'Hands-on or laboratory-based assessment.',               30,  NULL, TRUE,  3, 'active', 'any', TRUE),
  ('Project',                   'PROJ',  'Extended project or portfolio work.',                    50,  NULL, TRUE,  4, 'active', 'any', TRUE),
  ('Class Test',               'CTEST', 'A test written during normal class time.',               20,  NULL, TRUE,  5, 'active', 'any', TRUE),
  ('Continuous Assessment',     'CA',    'Ongoing observation and marking across the term.',       20,  NULL, TRUE,  6, 'active', 'any', TRUE),
  ('Oral Assessment',           'ORAL',  'Verbal question-and-answer assessment.',                 10,  NULL, TRUE,  7, 'active', 'any', TRUE),
  ('End-of-Unit Assessment',   'EOU',   'Structured assessment covering one completed unit.',       30,  NULL, TRUE,  8, 'active', 'per-unit', TRUE),
  ('Mid-Term Examination',      'MTE',   'Formal examination held mid-term.',                      50,  NULL, TRUE,  9, 'active', 'mid-term', TRUE),
  ('Terminal Examination',      'TE',    'Formal end-of-term examination.',                       100, NULL, TRUE, 10, 'active', 'end-term', TRUE),
  ('Other',                     'OTHER', 'Any other category of assessment.',                      30,  NULL, TRUE, 11, 'active', 'any', TRUE)
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 3) Also handle legacy name variants from earlier migrations
-- ------------------------------------------------------------
DO $$
BEGIN
  -- "End-of-Unit Assessment" -> "End of Unit" (if old name exists)
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'End-of-Unit Assessment')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'End of Unit') THEN
    UPDATE public.assessment_types SET name = 'End of Unit' WHERE name = 'End-of-Unit Assessment';
  END IF;

  -- "Oral Assessment" -> "Oral" (if old name exists)
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Oral Assessment')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Oral') THEN
    UPDATE public.assessment_types SET name = 'Oral' WHERE name = 'Oral Assessment';
  END IF;

  -- "Mid-Term Examination" -> "Mid-Term Exam" (if old name exists)
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Mid-Term Examination')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Mid-Term Exam') THEN
    UPDATE public.assessment_types SET name = 'Mid-Term Exam' WHERE name = 'Mid-Term Examination';
  END IF;

  -- "Terminal Examination" -> "End of Term Exam" (if old name exists)
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Terminal Examination')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'End of Term Exam') THEN
    UPDATE public.assessment_types SET name = 'End of Term Exam' WHERE name = 'Terminal Examination';
  END IF;

  -- "Class Test" -> "Class Exercise" (if old name exists)
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Class Test')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Class Exercise') THEN
    UPDATE public.assessment_types SET name = 'Class Exercise' WHERE name = 'Class Test';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4) Ensure ALL 11 canonical names exist (final safety net)
-- ------------------------------------------------------------
INSERT INTO public.assessment_types
  (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status)
VALUES
  ('Quiz',                      'QUIZ',  'Short, low-stakes knowledge check.',                     20,  NULL, TRUE,  1, 'active'),
  ('Assignment',                'ASGMT', 'Take-home or in-class written work.',                    20,  NULL, TRUE,  2, 'active'),
  ('Practical',                 'PRAC',  'Hands-on or laboratory-based assessment.',               30,  NULL, TRUE,  3, 'active'),
  ('Project',                   'PROJ',  'Extended project or portfolio work.',                    50,  NULL, TRUE,  4, 'active'),
  ('Class Test',               'CTEST', 'A test written during normal class time.',               20,  NULL, TRUE,  5, 'active'),
  ('Continuous Assessment',     'CA',    'Ongoing observation and marking across the term.',       20,  NULL, TRUE,  6, 'active'),
  ('Oral Assessment',           'ORAL',  'Verbal question-and-answer assessment.',                 10,  NULL, TRUE,  7, 'active'),
  ('End-of-Unit Assessment',    'EOU',   'Structured assessment covering one completed unit.',       30,  NULL, TRUE,  8, 'active'),
  ('Mid-Term Examination',      'MTE',   'Formal examination held mid-term.',                      50,  NULL, TRUE,  9, 'active'),
  ('Terminal Examination',      'TE',    'Formal end-of-term examination.',                       100, NULL, TRUE, 10, 'active'),
  ('Other',                     'OTHER', 'Any other category of assessment.',                      30,  NULL, TRUE, 11, 'active')
ON CONFLICT (name) DO NOTHING;

-- ------------------------------------------------------------
-- 5) Ensure unique constraints exist
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_name_key ON public.assessment_types (name);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_code_key ON public.assessment_types (code);

-- ------------------------------------------------------------
-- 6) Backfill any assessments with NULL assessment_type_id to End-of-Unit
-- ------------------------------------------------------------
DO $$
DECLARE v_eou UUID;
BEGIN
  SELECT id INTO v_eou FROM public.assessment_types WHERE code = 'EOU' LIMIT 1;
  IF FOUND THEN
    UPDATE public.assessments
       SET assessment_type_id = v_eou
     WHERE assessment_type_id IS NULL;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 7) Verification query — run this to confirm all 11 types exist
-- ------------------------------------------------------------
SELECT COUNT(*) AS total_assessment_types FROM public.assessment_types;
SELECT name, code, default_maximum_mark, status FROM public.assessment_types ORDER BY display_order;
