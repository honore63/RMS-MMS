-- ============================================================================
-- RMS-MIS — ASSESSMENT STANDARDIZATION & MARK CONVERSION
-- Run in Supabase SQL Editor (idempotent — safe to re-run).
--
-- WHAT THIS DOES
--  1. Standardizes the assessment catalogue to exactly 13 types:
--     Weekly Test, Monthly Test, Beginning of Term Exam, Mid-Term Exam,
--     End of Term Exam, Quiz, Assignment, Practical, Class Exercise,
--     Homework, Oral, End of Unit, Other.
--     - Each standard type gains a `period_hint` (week / month / term /
--       unit / other / NULL) that drives the conditional fields shown in the
--       assessment creation forms.
--     - Legacy rows are renamed in place to their standard names; any legacy
--       type that is NOT one of the 13 is deactivated (history is preserved).
--  2. Gives assessments structured fields:
--       period_type      ('week' | 'month' | 'term' | 'unit' | 'other')
--       period_value     (week 1-16, month 1-12, unit number 1-15+)
--       period_label     (e.g. 'Week 2', 'September', 'Term 1', 'Unit 3')
--       unit_number      (End-of-Unit assessments)
--       unit_name        (End-of-Unit assessments, free text)
--       display_name     (canonical, standardized label used in every list,
--                          report card, marks sheet and export)
--     Legacy `name` and `unit` columns are preserved untouched for
--     backward compatibility; every existing assessment gets a backfilled
--     display_name so reports stay meaningful immediately.
--  3. Marks conversion support:
--       marks.original_mark / marks.original_maximum  (preserved originals)
--       assessments.converted_from_maximum / converted_at / converted_by
--     The Convert Marks action (teacher marks-entry page) rewrites
--     maximum_mark and each mark proportionally while keeping the original
--     values here for audit (audit_logs.action = 'MARKS_CONVERTED').
--
-- Run AFTER: migration-rms-mis-assessment-flexibility.sql and
--           migration-rms-mis-rls.sql (idempotent in any order, though).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) assessment_types — standard catalogue support columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS period_hint TEXT;
ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessment_types_period_hint_check'
  ) THEN
    ALTER TABLE public.assessment_types
      ADD CONSTRAINT assessment_types_period_hint_check
      CHECK (period_hint IN ('week', 'month', 'term', 'unit', 'other'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Free legacy codes that collide with a standard code BEFORE we seed the
--    canonical rows. Only rows whose NAME is not one of the standards get a
--    suffix, so canonical names keep their canonical codes (EOU, MTE, ...).
-- ---------------------------------------------------------------------------
UPDATE public.assessment_types t
   SET code = t.code || '_LEGACY'
  FROM (VALUES ('WKT'), ('MLT'), ('BOT'), ('MTE'), ('EOT'), ('QUIZ'),
               ('ASGMT'), ('PRAC'), ('CEXE'), ('HW'), ('ORAL'), ('EOU'),
               ('OTHER')) AS c(code)
 WHERE UPPER(COALESCE(t.code, '')) = c.code
   AND t.name NOT IN (
        'Weekly Test', 'Monthly Test', 'Beginning of Term Exam', 'Mid-Term Exam',
        'End of Term Exam', 'Quiz', 'Assignment', 'Practical', 'Class Exercise',
        'Homework', 'Oral', 'End of Unit', 'Other'
   );

-- ---------------------------------------------------------------------------
-- 3) Rename legacy rows IN PLACE to the standard names (keeps the type id,
--    so every existing assessment reference stays valid). Each rename is
--    guarded so a name that already exists is never overwritten.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'End-of-Unit Assessment')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'End of Unit') THEN
    UPDATE public.assessment_types SET name = 'End of Unit' WHERE name = 'End-of-Unit Assessment';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Oral Assessment')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Oral') THEN
    UPDATE public.assessment_types SET name = 'Oral' WHERE name = 'Oral Assessment';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Mid-Term Examination')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Mid-Term Exam') THEN
    UPDATE public.assessment_types SET name = 'Mid-Term Exam' WHERE name = 'Mid-Term Examination';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Terminal Examination')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'End of Term Exam') THEN
    UPDATE public.assessment_types SET name = 'End of Term Exam' WHERE name = 'Terminal Examination';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Class Test')
     AND NOT EXISTS (SELECT 1 FROM public.assessment_types WHERE name = 'Class Exercise') THEN
    UPDATE public.assessment_types SET name = 'Class Exercise' WHERE name = 'Class Test';
  END IF;
END $$;

-- Re-assert the unique name index (needed for the ON CONFLICT (name) seeding).
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_name_key ON public.assessment_types (name);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_code_key ON public.assessment_types (code);

-- ---------------------------------------------------------------------------
-- 4) Seed / align the 13 standard types.
--    - Existing rows (by name) are updated to the canonical code, order,
--      status, default max and period hint — their IDs and any assessments
--      referencing them are untouched.
--    - Missing rows are inserted.
-- ---------------------------------------------------------------------------
INSERT INTO public.assessment_types
  (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status, period_hint, is_standard)
VALUES
  ('Weekly Test',            'WKT',   'Short test given once a week (week number 1-16).',                                        10,  NULL, TRUE,  1,  'active', 'week',  TRUE),
  ('Monthly Test',           'MLT',   'Test covering one month of learning (e.g. September).',                                20,  NULL, TRUE,  2,  'active', 'month', TRUE),
  ('Beginning of Term Exam', 'BOT',   'Formal examination at the start of a term.',                                            50,  NULL, TRUE,  3,  'active', 'term',  TRUE),
  ('Mid-Term Exam',          'MTE',   'Formal examination held mid-term.',                                                    50,  NULL, TRUE,  4,  'active', 'term',  TRUE),
  ('End of Term Exam',       'EOT',   'Formal end-of-term examination.',                                                      100, NULL, TRUE,  5,  'active', 'term',  TRUE),
  ('Quiz',                   'QUIZ',  'Short, low-stakes knowledge check.',                                                   20,  NULL, TRUE,  6,  'active', NULL,   TRUE),
  ('Assignment',             'ASGMT', 'Take-home or in-class written work.',                                                  20,  NULL, TRUE,  7,  'active', NULL,   TRUE),
  ('Practical',              'PRAC',  'Hands-on or laboratory-based assessment.',                                             30,  NULL, TRUE,  8,  'active', NULL,   TRUE),
  ('Class Exercise',         'CEXE',  'A short exercise written during normal class time.',                                   10,  NULL, TRUE,  9,  'active', NULL,   TRUE),
  ('Homework',               'HW',    'Work assigned for completion at home.',                                                10,  NULL, TRUE, 10,  'active', NULL,   TRUE),
  ('Oral',                   'ORAL',  'Verbal question-and-answer assessment.',                                               10,  NULL, TRUE, 11,  'active', NULL,   TRUE),
  ('End of Unit',            'EOU',   'Structured assessment covering one completed unit of study.',                          30,  NULL, TRUE, 12,  'active', 'unit',  TRUE),
  ('Other',                  'OTHER', 'Any other category. The name is free text and required.',                              30,  NULL, TRUE, 13,  'active', 'other', TRUE)
ON CONFLICT (name) DO UPDATE
  SET code = EXCLUDED.code,
      description = COALESCE(EXCLUDED.description, public.assessment_types.description),
      default_maximum_mark = EXCLUDED.default_maximum_mark,
      weight = COALESCE(EXCLUDED.weight, public.assessment_types.weight),
      display_order = EXCLUDED.display_order,
      status = 'active',
      period_hint = EXCLUDED.period_hint,
      is_standard = TRUE;

-- ---------------------------------------------------------------------------
-- 5) Deactivate legacy / non-standard types (Project, Continuous Assessment,
--    and any duplicate legacy variants that could not be renamed). Existing
--    assessments keep working and keep their type label — they just cannot
--    be selected for new assessments anymore.
-- ---------------------------------------------------------------------------
UPDATE public.assessment_types
   SET status = 'inactive', is_standard = FALSE, display_order = 1000
 WHERE name NOT IN (
        'Weekly Test', 'Monthly Test', 'Beginning of Term Exam', 'Mid-Term Exam',
        'End of Term Exam', 'Quiz', 'Assignment', 'Practical', 'Class Exercise',
        'Homework', 'Oral', 'End of Unit', 'Other'
   )
   AND status = 'active';

-- ---------------------------------------------------------------------------
-- 6) assessments — structured standardization + conversion columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.assessments
  ADD COLUMN IF NOT EXISTS period_type TEXT,
  ADD COLUMN IF NOT EXISTS period_value INTEGER,
  ADD COLUMN IF NOT EXISTS period_label TEXT,
  ADD COLUMN IF NOT EXISTS unit_number INTEGER,
  ADD COLUMN IF NOT EXISTS unit_name TEXT,
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS converted_from_maximum NUMERIC,
  ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS converted_by UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assessments_period_type_check'
  ) THEN
    ALTER TABLE public.assessments
      ADD CONSTRAINT assessments_period_type_check
      CHECK (period_type IN ('week', 'month', 'term', 'unit', 'other'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 7) marks — preserve originals when marks are converted
-- ---------------------------------------------------------------------------
ALTER TABLE public.marks
  ADD COLUMN IF NOT EXISTS original_mark NUMERIC,
  ADD COLUMN IF NOT EXISTS original_maximum NUMERIC;

-- ---------------------------------------------------------------------------
-- 8) Backfill display_name + structured fields for EXISTING assessments.
--    Step A: End-of-Unit typed assessments — derive unit number / unit name
--            from the legacy `unit` or `name` text (e.g. "Unit 4 - Fractions"
--            or "Unit 4 Quiz").
-- ---------------------------------------------------------------------------
UPDATE public.assessments a
SET period_type  = 'unit',
    unit_number  = COALESCE(
      a.unit_number,
      NULLIF((regexp_match(COALESCE(a.unit, a.name, ''), 'unit[[:space:]]*([0-9]+)', 'i'))[1], '')::integer
    ),
    unit_name    = CASE
      WHEN (regexp_match(COALESCE(a.unit, a.name, ''), 'unit[[:space:]]*([0-9]+)', 'i'))[1] IS NOT NULL
        THEN NULLIF(TRIM(BOTH ' -:' FROM regexp_replace(COALESCE(a.unit, a.name, ''), 'unit[[:space:]]*[0-9]+', '', 'i')), '')
      ELSE NULLIF(a.unit, '') END,
    period_label = CASE
      WHEN (regexp_match(COALESCE(a.unit, a.name, ''), 'unit[[:space:]]*([0-9]+)', 'i'))[1] IS NOT NULL
        THEN 'Unit ' || (regexp_match(COALESCE(a.unit, a.name, ''), 'unit[[:space:]]*([0-9]+)', 'i'))[1]
      ELSE NULL END
FROM public.assessment_types t
WHERE t.id = a.assessment_type_id
  AND t.period_hint = 'unit'
  AND a.period_type IS NULL;

-- ---------------------------------------------------------------------------
--    Step B: canonical display_name for every assessment that has none yet.
--            - End of Unit  -> "End of Unit — Unit 3: Fractions and Decimals"
--            - Term types   -> type + legacy name/unit (usually already a
--                               proper term-exam label)
--            - Generic types-> the type name when the legacy name already
--                               starts with it, else "Type — Name".
-- ---------------------------------------------------------------------------
UPDATE public.assessments a
SET display_name = CASE
  WHEN t.period_hint = 'unit' THEN
    t.name || ' — ' ||
    CASE
      WHEN a.unit_number IS NOT NULL
        THEN 'Unit ' || a.unit_number ||
             CASE WHEN a.unit_name IS NOT NULL AND a.unit_name <> '' THEN ': ' || a.unit_name ELSE '' END
      ELSE COALESCE(NULLIF(a.unit, ''), NULLIF(a.name, ''), t.name)
    END
  WHEN a.name IS NOT NULL AND LEFT(a.name, character_length(t.name)) = t.name THEN a.name
  WHEN COALESCE(NULLIF(a.unit, ''), NULLIF(a.name, '')) IS NULL THEN t.name
  ELSE t.name || ' — ' || COALESCE(NULLIF(a.unit, ''), a.name)
END
FROM public.assessment_types t
WHERE t.id = a.assessment_type_id
  AND (a.display_name IS NULL OR a.display_name = '');

-- ---------------------------------------------------------------------------
-- 9) Indexes for the new columns
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_assessments_period_type   ON public.assessments (period_type);
CREATE INDEX IF NOT EXISTS idx_assessments_period_label  ON public.assessments (period_label);
CREATE INDEX IF NOT EXISTS idx_assessments_unit_number   ON public.assessments (unit_number);

-- ---------------------------------------------------------------------------
-- 10) Verification (leave visible in the editor after running)
-- ---------------------------------------------------------------------------
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'assessments'
  AND column_name IN ('period_type','period_value','period_label','unit_number','unit_name','display_name','converted_from_maximum','converted_at','converted_by');

SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'marks'
  AND column_name IN ('original_mark','original_maximum');

SELECT status, COUNT(*) AS active_standard_types
FROM public.assessment_types
WHERE is_standard = TRUE
GROUP BY status ORDER BY status;

SELECT at.name AS type, COUNT(*) AS assessments
FROM public.assessments a
LEFT JOIN public.assessment_types at ON at.id = a.assessment_type_id
GROUP BY at.name ORDER BY assessments DESC;

SELECT COUNT(*) AS assessments_with_display_name
FROM public.assessments
WHERE display_name IS NOT NULL AND display_name <> '';