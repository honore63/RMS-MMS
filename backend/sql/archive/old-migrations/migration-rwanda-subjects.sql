-- ============================================================================
-- RMS-MIS MIGRATION: General Education Subject List for Rwanda
-- Safe to execute multiple times (idempotent).
-- ============================================================================

-- 1) Ensure unique constraint on subject name in subjects table (if not exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_subject_name'
  ) THEN
    ALTER TABLE public.subjects ADD CONSTRAINT unique_subject_name UNIQUE (name);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 2) Insert / Update complete Rwanda General Education subject list
INSERT INTO public.subjects (name, code, status)
SELECT * FROM (VALUES
  ('Mathematics', 'MATH', 'active'),
  ('English', 'ENG', 'active'),
  ('Kinyarwanda', 'KIN', 'active'),
  ('French', 'FRE', 'active'),
  ('Kiswahili', 'KISW', 'active'),
  ('Physics', 'PHY', 'active'),
  ('Chemistry', 'CHEM', 'active'),
  ('Biology and Health Sciences', 'BIO', 'active'),
  ('Geography and Environment', 'GEO', 'active'),
  ('History and Citizenship', 'HIST', 'active'),
  ('Entrepreneurship', 'ENT', 'active'),
  ('ICT', 'ICT', 'active'),
  ('Computer Science', 'CS', 'active'),
  ('Economics', 'ECON', 'active'),
  ('Psychology', 'PSY', 'active'),
  ('Literature in English', 'LIT', 'active'),
  ('General Studies and Communication Skills (GSCS)', 'GSCS', 'active'),
  ('Subsidiary Mathematics', 'SUB_MATH', 'active'),
  ('Religion and Ethics', 'REL_ETH', 'active'),
  ('Religious Studies', 'REL_STU', 'active'),
  ('Physical Education and Sports', 'PES', 'active'),
  ('Music, Dance and Drama', 'MDD', 'active'),
  ('Fine Arts and Crafts', 'FAC', 'active'),
  ('Home Sciences', 'HS', 'active'),
  ('Farming (Agriculture and Animal Husbandry)', 'FARM', 'active')
) AS v (name, code, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.subjects s WHERE UPPER(TRIM(s.name)) = UPPER(TRIM(v.name))
);

-- 3) Ensure indexes for code and status for fast lookups
CREATE INDEX IF NOT EXISTS idx_subjects_status ON public.subjects(status);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON public.subjects(code);

-- 4) RLS Policies for Subjects Table
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_subjects_all ON public.subjects;
CREATE POLICY rms_subjects_all ON public.subjects FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.subjects TO anon, authenticated;
