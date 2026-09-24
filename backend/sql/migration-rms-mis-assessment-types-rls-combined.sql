-- ============================================================
-- RMS-MIS ONE-SHOT: ASSESSMENT TYPES + ROW LEVEL SECURITY
-- Combine both migrations into a single run. Idempotent.
-- 1) assessment_types table (configurable types + seeds)
-- 2) assessments: assessment_type_id / weight / description,
--    unit is now optional, backfill of existing rows to EOU
-- 3) Scoped RLS: assessment_types, teacher_assignments, assessments
-- After running, the schema reload postgrest is triggered.
-- ============================================================
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

-- Backfill subject level for existing rows that were NULL (they predate the level column)
UPDATE public.subjects SET level = 'Both' WHERE level IS NULL;
UPDATE public.subjects SET education_level = level WHERE education_level IS NULL;

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
-- ============================================================
-- ============================================================
-- PART 2 — ROW LEVEL SECURITY (scoped policies)
-- ============================================================
-- ============================================================
-- ============================================================
-- RMS-MIS ROW LEVEL SECURITY — ASSESSMENTS, TEACHER_ASSIGNMENTS,
-- ASSESSMENT_TYPES
-- Run in Supabase SQL Editor (idempotent).
-- Tightens the previously open assessments / teacher_assignments
-- policies to a scoped model that matches the marks scoping from
-- migration-marks-import.sql:
--   - DOS (role 'dos', active) can do everything.
--   - Teachers see their OWN assessments + the ones matching their
--     class+subject(+year) assignment; create only assessments that
--     match their assignment; update their own; delete their own
--     drafts; never delete anything marked/approved.
--   - Teacher assignments are read-only for teachers (only their
--     own rows), managed by DOS.
--   - assessment_types is readable by everyone, managed by DOS.
-- The helper functions only read users / teachers /
-- teacher_assignments (never assessments) so the policies cannot
-- recurse.
-- Run the companion migration-rms-mis-assessment-flexibility.sql in
-- the same SQL Editor session.
-- ============================================================

-- ------------------------------------------------------------
-- 1) Scope helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_is_dos()
RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u
    WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active'
  );
$$;

-- Is the caller the teacher recorded against the assessment that
-- would carry the given teacher/class/subject/year? Safe to use in
-- assessments policies: touches only teachers + teacher_assignments.
CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
) RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM teachers t
    WHERE t.user_id = auth.uid()
      AND t.id = p_teacher_id
      AND EXISTS (
        SELECT 1 FROM teacher_assignments ta
        WHERE ta.teacher_id = t.id
          AND (ta.class_id IS NULL OR ta.class_id = p_class_id)
          AND (ta.subject_id IS NULL OR ta.subject_id = p_subject_id)
          AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
               OR ta.academic_year_id = p_academic_year_id)
      )
  );
$$;

-- Can the caller VIEW an assessment row, either as its owner-teacher
-- or as a teacher assigned to the same class+subject(+year)? Touches
-- only teachers + teacher_assignments.
CREATE OR REPLACE FUNCTION public.rms_teacher_can_view_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
) RETURNS boolean LANGUAGE sql STABLE
AS $$
  SELECT (
    EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.user_id = auth.uid() AND t.id = p_teacher_id
    )
    OR EXISTS (
      SELECT 1 FROM teacher_assignments ta
      JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.user_id = auth.uid()
        AND (ta.class_id IS NULL OR ta.class_id = p_class_id)
        AND (ta.subject_id IS NULL OR ta.subject_id = p_subject_id)
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
             OR ta.academic_year_id = p_academic_year_id)
    )
  );
$$;

-- ------------------------------------------------------------
-- 2) assessment_types policies (read-all, DOS manages)
-- ------------------------------------------------------------
ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_assessment_types_select ON public.assessment_types;
DROP POLICY IF EXISTS rms_assessment_types_modify ON public.assessment_types;
CREATE POLICY rms_assessment_types_select ON public.assessment_types
  FOR SELECT USING (true);
CREATE POLICY rms_assessment_types_modify ON public.assessment_types
  FOR ALL USING (public.rms_is_dos()) WITH CHECK (public.rms_is_dos());

-- ------------------------------------------------------------
-- 3) Clear every legacy policy on assessments and
--    teacher_assignments (open or partial, any names)
-- ------------------------------------------------------------
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname, pp.tablename
    FROM pg_policies pp
    WHERE pp.schemaname = 'public'
      AND pp.tablename IN ('assessments', 'teacher_assignments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- ------------------------------------------------------------
-- 4) teacher_assignments policies
--    SELECT = DOS anywhere or the caller's own rows; writes = DOS.
-- ------------------------------------------------------------
CREATE POLICY rms_teacher_assignments_select ON public.teacher_assignments
  FOR SELECT
  USING (
    public.rms_is_dos()
    OR EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.id = teacher_assignments.teacher_id AND t.user_id = auth.uid()
    )
  );
CREATE POLICY rms_teacher_assignments_insert ON public.teacher_assignments
  FOR INSERT WITH CHECK (public.rms_is_dos());
CREATE POLICY rms_teacher_assignments_update ON public.teacher_assignments
  FOR UPDATE USING (public.rms_is_dos()) WITH CHECK (public.rms_is_dos());
CREATE POLICY rms_teacher_assignments_delete ON public.teacher_assignments
  FOR DELETE USING (public.rms_is_dos());

-- ------------------------------------------------------------
-- 5) assessments policies
-- ------------------------------------------------------------
CREATE POLICY rms_assessments_select ON public.assessments
  FOR SELECT
  USING (
    public.rms_is_dos()
    OR public.rms_teacher_can_view_assessment_row(
         assessments.teacher_id, assessments.class_id,
         assessments.subject_id, assessments.academic_year_id)
  );

CREATE POLICY rms_assessments_insert ON public.assessments
  FOR INSERT
  WITH CHECK (
    public.rms_is_dos()
    OR public.rms_teacher_can_assessment_row(
         teacher_id, class_id, subject_id, academic_year_id)
  );

CREATE POLICY rms_assessments_update ON public.assessments
  FOR UPDATE
  USING (
    public.rms_is_dos()
    OR EXISTS (
      SELECT 1 FROM teachers t
      WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id
    )
  )
  WITH CHECK (
    public.rms_is_dos()
    OR (teacher_id = assessments.teacher_id
        AND public.rms_teacher_can_assessment_row(
             teacher_id, class_id, subject_id, academic_year_id))
  );

-- Teachers may delete only their own still-draft assessments
-- (discarding a mistake). Anything marked/submitted/approved and all
-- other rows are DOS-only.
CREATE POLICY rms_assessments_delete ON public.assessments
  FOR DELETE
  USING (
    public.rms_is_dos()
    OR (
      assessments.status = 'draft'
      AND EXISTS (
        SELECT 1 FROM teachers t
        WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id
      )
    )
  );

-- ------------------------------------------------------------
-- 6) Verification
-- ------------------------------------------------------------
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('assessments','teacher_assignments','assessment_types');

SELECT tablename, policyname, cmd, permissive
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('assessments','teacher_assignments','assessment_types')
ORDER BY tablename, policyname;
-- ------------------------------------------------------------
-- Reload the PostgREST schema cache so the new tables, columns
-- and policies take effect immediately.
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
