-- ============================================================================
-- RMS-MIS: FULL MIGRATION — Class Management + Rwanda Subject List
-- ============================================================================
-- PURPOSE  : Safe, idempotent migration that:
--   1. Upgrades the classes table to support academic year links and status.
--   2. Adds all secondary school classes (S1–S6) without touching primary data.
--   3. Adds all 25 Rwanda General Education subjects without touching existing ones.
--   4. Adds unique constraints and indexes for data integrity.
--   5. Ensures RLS policies cover all new columns.
--
-- HOW TO RUN: Paste this entire script into Supabase → SQL Editor → Run
-- SAFE     : Can be re-run multiple times without duplicating or deleting data.
-- ============================================================================

-- ============================================================================
-- STEP 1: UPGRADE CLASSES TABLE
-- ============================================================================

-- 1a) Add academic_year_id column (links a class to a specific academic year)
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id);

-- 1b) Add status column (active / inactive) so DOS can enable/disable classes
ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

-- 1c) Add constraint so status can only be 'active' or 'inactive'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'classes_status_check'
  ) THEN
    ALTER TABLE public.classes
      ADD CONSTRAINT classes_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
END $$;

-- ============================================================================
-- STEP 2: ADD MISSING SECONDARY SCHOOL CLASSES (S1–S6)
-- ============================================================================
-- Only inserts classes that do not already exist (matched by name).
-- Existing P1–P6 classes are completely untouched.

INSERT INTO public.classes (name, level, stream, status)
SELECT v.name, v.level, v.stream, 'active'
FROM (VALUES
  ('S1',            'S1', NULL        ),
  ('S2',            'S2', NULL        ),
  ('S3',            'S3', NULL        ),
  ('S4 – Stream 1', 'S4', 'Stream 1' ),
  ('S4 – Stream 2', 'S4', 'Stream 2' ),
  ('S5 – Stream 1', 'S5', 'Stream 1' ),
  ('S5 – Stream 2', 'S5', 'Stream 2' ),
  ('S6 – MEG',      'S6', 'MEG'      ),
  ('S6 – PCM',      'S6', 'PCM'      ),
  ('S6 – MCE',      'S6', 'MCE'      )
) AS v (name, level, stream)
WHERE NOT EXISTS (
  SELECT 1 FROM public.classes c
  WHERE UPPER(TRIM(c.name)) = UPPER(TRIM(v.name))
);

-- ============================================================================
-- STEP 3: UPGRADE SUBJECTS TABLE — Add unique constraint on name
-- ============================================================================

-- 3a) Ensure the code column has a unique constraint (may already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'subjects_code_key' AND conrelid = 'public.subjects'::regclass
  ) THEN
    ALTER TABLE public.subjects ADD CONSTRAINT subjects_code_key UNIQUE (code);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $$;

-- ============================================================================
-- STEP 4: INSERT ALL 25 RWANDA GENERAL EDUCATION SUBJECTS
-- ============================================================================
-- Only inserts subjects that don't already exist (matched by name, case-insensitive).
-- Existing subjects (Mathematics, English, ICT, etc.) are NEVER overwritten.

INSERT INTO public.subjects (name, code, status)
SELECT v.name, v.code, 'active'
FROM (VALUES
  ('Mathematics',                                       'MATH'    ),
  ('English',                                           'ENG'     ),
  ('Kinyarwanda',                                       'KIN'     ),
  ('French',                                            'FRE'     ),
  ('Kiswahili',                                         'KISW'    ),
  ('Physics',                                           'PHY'     ),
  ('Chemistry',                                         'CHEM'    ),
  ('Biology and Health Sciences',                       'BIO'     ),
  ('Geography and Environment',                         'GEO'     ),
  ('History and Citizenship',                           'HIST'    ),
  ('Entrepreneurship',                                  'ENT'     ),
  ('ICT',                                               'ICT'     ),
  ('Computer Science',                                  'CS'      ),
  ('Economics',                                         'ECON'    ),
  ('Psychology',                                        'PSY'     ),
  ('Literature in English',                             'LIT'     ),
  ('General Studies and Communication Skills (GSCS)',   'GSCS'    ),
  ('Subsidiary Mathematics',                            'SUB_MATH'),
  ('Religion and Ethics',                               'REL_ETH' ),
  ('Religious Studies',                                 'REL_STU' ),
  ('Physical Education and Sports',                     'PES'     ),
  ('Music, Dance and Drama',                            'MDD'     ),
  ('Fine Arts and Crafts',                              'FAC'     ),
  ('Home Sciences',                                     'HS'      ),
  ('Farming (Agriculture and Animal Husbandry)',        'FARM'    )
) AS v (name, code)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subjects s
  WHERE UPPER(TRIM(s.name)) = UPPER(TRIM(v.name))
)
AND NOT EXISTS (
  SELECT 1 FROM public.subjects s
  WHERE UPPER(TRIM(s.code)) = UPPER(TRIM(v.code))
);

-- ============================================================================
-- STEP 5: PERFORMANCE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_classes_level            ON public.classes(level);
CREATE INDEX IF NOT EXISTS idx_classes_status           ON public.classes(status);
CREATE INDEX IF NOT EXISTS idx_classes_academic_year_id ON public.classes(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_subjects_status          ON public.subjects(status);
CREATE INDEX IF NOT EXISTS idx_subjects_code            ON public.subjects(code);

-- ============================================================================
-- STEP 6: ENSURE RLS IS ACTIVE WITH PERMISSIVE ALL-ACCESS POLICIES
-- ============================================================================

ALTER TABLE public.classes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

-- Drop any old class/subject policies before recreating
DROP POLICY IF EXISTS rms_classes_all  ON public.classes;
DROP POLICY IF EXISTS rms_subjects_all ON public.subjects;

CREATE POLICY rms_classes_all  ON public.classes  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_subjects_all ON public.subjects FOR ALL USING (true) WITH CHECK (true);

-- ============================================================================
-- STEP 7: GRANT PERMISSIONS
-- ============================================================================

GRANT ALL ON public.classes  TO anon, authenticated;
GRANT ALL ON public.subjects TO anon, authenticated;

-- ============================================================================
-- DONE: Verification Queries (Run these after the migration to confirm)
-- ============================================================================

-- Check total classes:
-- SELECT level, COUNT(*) FROM public.classes GROUP BY level ORDER BY level;

-- Check total subjects:
-- SELECT status, COUNT(*) FROM public.subjects GROUP BY status ORDER BY status;

-- List all secondary classes:
-- SELECT name, level, stream, status FROM public.classes WHERE level LIKE 'S%' ORDER BY level, stream;

-- List all Rwanda subjects:
-- SELECT name, code, status FROM public.subjects ORDER BY name;
