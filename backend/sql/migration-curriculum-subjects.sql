-- ============================================================
-- RMS-MIS: Curriculum subjects + class → subject mapping
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor)
--
-- What it does:
--  1. Adds catalogue columns to subjects (level/category/grades).
--  2. Seeds the official Primary (P1-P3, P4-P6) and Secondary
--     subject lists (upsert by name — never duplicates).
--  3. Creates class_subjects so each class exposes ONLY its own
--     subjects (Section → Class → Subject in the UI).
--  4. Auto-assigns P1-P3, P4-P6 and S1-S3 classes.
--     S4-S6 combinations are stream-dependent and are intentionally
--     left for the DOS to assign (commented examples below).
-- ============================================================

BEGIN;

-- ---------- 1) Catalogue columns ----------
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Both';
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS grades TEXT;

-- ---------- 2) Seed official subject catalogue ----------
DO $$
DECLARE
  r RECORD;
  n INT;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      -- name, code, level, category, grades
      ('Kinyarwanda', 'KIN', 'Both', 'Language', 'P1,P2,P3,P4,P5,P6,S1,S2,S3,S4,S5,S6'),
      ('English', 'ENG', 'Both', 'Language', 'P1,P2,P3,P4,P5,P6,S1,S2,S3,S4,S5,S6'),
      ('Mathematics', 'MAT', 'Both', 'Core', 'P1,P2,P3,P4,P5,P6,S1,S2,S3,S4,S5,S6'),
      ('Social and Religious Studies', 'SRS', 'Primary', 'Humanities', 'P1,P2,P3,P4,P5,P6'),
      ('Science and Elementary Technology', 'SET', 'Primary', 'Science', 'P1,P2,P3,P4,P5,P6'),
      ('Creative Arts and Sports', 'CAS', 'Primary', 'Arts', 'P1,P2,P3'),
      ('Creative Arts', 'CRA', 'Primary', 'Arts', 'P4,P5,P6'),
      ('Physical Education and Sports', 'PES', 'Both', 'Sports', 'P1,P2,P3,P4,P5,P6,S1,S2,S3,S4,S5,S6'),
      ('French', 'FRE', 'Both', 'Language', 'P4,P5,P6,S1,S2,S3,S4,S5,S6'),
      ('ICT / Computer Science', 'ICT', 'Secondary', 'Technology', 'S1,S2,S3,S4,S5,S6'),
      ('Entrepreneurship', 'ENT', 'Secondary', 'Vocational', 'S1,S2,S3,S4,S5,S6'),
      ('Religious and Moral Education', 'RME', 'Secondary', 'Humanities', 'S1,S2,S3,S4,S5,S6'),
      ('History', 'HIS', 'Secondary', 'Humanities', 'S1,S2,S3,S4,S5,S6'),
      ('Geography', 'GEO', 'Secondary', 'Humanities', 'S1,S2,S3,S4,S5,S6'),
      ('Physics', 'PHY', 'Secondary', 'Science', 'S1,S2,S3,S4,S5,S6'),
      ('Chemistry', 'CHE', 'Secondary', 'Science', 'S1,S2,S3,S4,S5,S6'),
      ('Biology', 'BIO', 'Secondary', 'Science', 'S1,S2,S3,S4,S5,S6'),
      ('General Science', 'GSC', 'Secondary', 'Science', 'S1,S2,S3,S4,S5,S6'),
      ('Kiswahili', 'KIS', 'Secondary', 'Language', 'S1,S2,S3,S4,S5,S6'),
      ('Agriculture', 'AGR', 'Secondary', 'Vocational', 'S1,S2,S3,S4,S5,S6'),
      ('Food and Nutrition', 'FDN', 'Secondary', 'Vocational', 'S4,S5,S6')
    ) AS v(name, code, level, category, grades)
  LOOP
    UPDATE public.subjects
       SET level = r.level, category = r.category, grades = r.grades
     WHERE lower(name) = lower(r.name);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n = 0 THEN
      BEGIN
        INSERT INTO public.subjects (name, code, status, level, category, grades)
        VALUES (r.name, r.code, 'active', r.level, r.category, r.grades);
      EXCEPTION WHEN unique_violation THEN
        -- Code taken by a variant row: keep existing row, just tag the level.
        UPDATE public.subjects SET level = r.level WHERE code = r.code;
      END;
    END IF;
  END LOOP;
END $$;

-- ---------- 3) Class → subject mapping ----------
CREATE TABLE IF NOT EXISTS public.class_subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (class_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_class_subjects_class ON public.class_subjects (class_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject ON public.class_subjects (subject_id);

ALTER TABLE public.class_subjects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_class_subjects_all ON public.class_subjects;
CREATE POLICY rms_class_subjects_all ON public.class_subjects
  FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.class_subjects TO anon, authenticated;
GRANT ALL ON public.subjects TO anon, authenticated;

-- ---------- 4) Auto-assign P1-P3, P4-P6 and S1-S3 classes ----------
-- Subjects apply when the class grade appears in subjects.grades.
DO $$
DECLARE
  c RECORD;
  g TEXT;
BEGIN
  FOR c IN SELECT id, level, name FROM public.classes LOOP
    g := upper(substring(coalesce(c.level, '') || ' ' || coalesce(c.name, '') from '([PS][1-6])'));
    IF g IS NULL THEN
      RAISE NOTICE 'Skipping class % — no grade found', c.name;
      CONTINUE;
    END IF;
    IF g IN ('S4', 'S5', 'S6') THEN
      RAISE NOTICE 'Skipping senior class % — assign its combination manually (see examples below)', c.name;
      CONTINUE;
    END IF;
    INSERT INTO public.class_subjects (class_id, subject_id)
    SELECT c.id, s.id
      FROM public.subjects s
     WHERE coalesce(s.status, 'active') = 'active'
       AND (s.grades IS NULL OR s.grades ILIKE '%' || g || '%')
       AND upper(coalesce(s.level, 'Both')) IN ('BOTH',
             CASE WHEN g LIKE 'P%' THEN 'PRIMARY' ELSE 'SECONDARY' END)
    ON CONFLICT (class_id, subject_id) DO NOTHING;
  END LOOP;
END $$;

-- ---------- 5) Senior combinations: DOS assigns manually, e.g. ----------
-- -- PCM class (replace IDs with your real class/subject ids):
-- INSERT INTO public.class_subjects (class_id, subject_id)
-- SELECT '<S4-PCM-CLASS-ID>', s.id FROM public.subjects s
--  WHERE s.name IN ('English','Mathematics','Physics','Chemistry','ICT / Computer Science');
-- -- MEG class:
-- INSERT INTO public.class_subjects (class_id, subject_id)
-- SELECT '<S4-MEG-CLASS-ID>', s.id FROM public.subjects s
--  WHERE s.name IN ('English','Mathematics','Geography','History','Entrepreneurship');

-- ---------- 6) Verify ----------
SELECT c.name AS class, count(cs.subject_id) AS subjects
  FROM public.classes c
  LEFT JOIN public.class_subjects cs ON cs.class_id = c.id
 GROUP BY c.name
 ORDER BY c.name;

SELECT name, level, category, grades FROM public.subjects ORDER BY name;

COMMIT;
