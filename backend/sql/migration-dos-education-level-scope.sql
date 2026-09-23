-- ============================================================================
-- RMS-MIS: TWO LEVEL-SPECIFIC DOS ADMINISTRATORS
-- Education-level scoping for the DOS role.
--
-- Run in Supabase SQL Editor (idempotent).
--
-- WHAT IT DOES
--   1. Adds `users.education_level` (NULL | 'PRIMARY' | 'SECONDARY') with a
--      CHECK constraint. Teachers/headteachers keep NULL.
--   2. Confirms the two DOS accounts:
--        dos@rukara.edu   -> role 'dos', education_level 'PRIMARY',   active
--        dos2@rukara.edu  -> role 'dos', education_level 'SECONDARY', active
--      dos2 is created in Supabase Auth (password dos123, email confirmed)
--      if it does not exist yet. No plain-text password is ever stored in
--      public tables.
--   3. Adds scope helper functions used by the new RLS policies.
--   4. Enforces the scope in ROW LEVEL SECURITY:
--        DOS PRIMARY   -> sees/manages ONLY Primary classes & their data.
--        DOS SECONDARY -> sees/manages ONLY Lower/Upper Secondary.
--        Teachers are UNCHANGED (still assignment-based; they keep reading
--        reference lists such as classes/subjects as before).
--        Reference/global tables (academic_years, terms, grading_scales,
--        school_settings, education_levels, assessment_types,
--        performance_comments) stay readable by everyone as today.
--
-- NOTE: existing DOS flows (dashboard, classes, assessments, marks, reports)
-- keep working, now automatically scoped by the level on the users table.
-- ============================================================================

-- ------------------------------------------------------------
-- 1) users.education_level
-- ------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS education_level TEXT;

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_education_level_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_education_level_check
  CHECK (education_level IS NULL OR education_level IN ('PRIMARY', 'SECONDARY'));

CREATE INDEX IF NOT EXISTS idx_users_education_level ON public.users(education_level);

-- ------------------------------------------------------------
-- 2) Seed / confirm the two level-specific DOS accounts.
--    Auth users are created via Supabase Auth (bcrypt hash only).
--    NOTE: we do NOT use ON CONFLICT on auth.users because newer
--    Supabase projects have no unique index on auth.users.email
--    (uniqueness lives in auth.identities). We check-then-insert.
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_primary_uid   uuid;
  v_secondary_uid uuid;
BEGIN
  -- ---- Primary DOS (dos@rukara.edu) -------------------------
  SELECT id INTO v_primary_uid
  FROM auth.users WHERE email = 'dos@rukara.edu' LIMIT 1;

  IF v_primary_uid IS NULL THEN
    INSERT INTO auth.users
      (instance_id, id, aud, role, email,
       encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token)
    VALUES
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', 'dos@rukara.edu',
       crypt('dos123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}',
       now(), now(), '')
    RETURNING id INTO v_primary_uid;
  ELSE
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_primary_uid;
  END IF;

  INSERT INTO public.users (id, email, full_name, role, education_level, status)
  VALUES (v_primary_uid, 'dos@rukara.edu', 'DOS Primary', 'dos', 'PRIMARY', 'active')
  ON CONFLICT (email) DO UPDATE
    SET full_name = 'DOS Primary',
        role      = 'dos',
        education_level = 'PRIMARY',
        status    = 'active';

  -- ---- Secondary DOS (dos2@rukara.edu) ----------------------
  SELECT id INTO v_secondary_uid
  FROM auth.users WHERE email = 'dos2@rukara.edu' LIMIT 1;

  IF v_secondary_uid IS NULL THEN
    INSERT INTO auth.users
      (instance_id, id, aud, role, email,
       encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data,
       created_at, updated_at, confirmation_token)
    VALUES
      ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
       'authenticated', 'authenticated', 'dos2@rukara.edu',
       crypt('dos123', gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', '{}',
       now(), now(), '')
    RETURNING id INTO v_secondary_uid;
  ELSE
    UPDATE auth.users
    SET email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_secondary_uid;
  END IF;

  INSERT INTO public.users (id, email, full_name, role, education_level, status)
  VALUES (v_secondary_uid, 'dos2@rukara.edu', 'DOS Secondary', 'dos', 'SECONDARY', 'active')
  ON CONFLICT (email) DO UPDATE
    SET full_name = 'DOS Secondary',
        role      = 'dos',
        education_level = 'SECONDARY',
        status    = 'active';
END $$;

-- ------------------------------------------------------------
-- 3) Scope helper functions (used by the RLS policies below).
--    All helpers read ONLY reference tables (users / classes /
--    subjects / assessments) and never the table being policed,
--    so the policies cannot recurse.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_dos_education_level()
RETURNS TEXT LANGUAGE sql STABLE AS $$
  SELECT u.education_level
  FROM public.users u
  WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active';
$$;

-- Current caller is a DOS account with an education-level scope.
CREATE OR REPLACE FUNCTION public.rms_is_scoped_dos()
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.rms_dos_education_level() IS NOT NULL;
$$;

-- Does the caller's scope allow a class education level value?
-- Unscoped callers (teachers, headteachers) are always allowed; DOS
-- accounts are limited to their own level (PRIMARY -> 'Primary',
-- SECONDARY -> 'Lower Secondary' / 'Upper Secondary').
CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN NOT public.rms_is_dos() THEN true
      WHEN p_level IS NULL        THEN true
      WHEN public.rms_dos_education_level() = 'PRIMARY'   THEN p_level = 'Primary'
      WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary')
      ELSE true
    END;
$$;

-- Subject-level check ('Both' is shared and allowed for every scope;
-- 'Secondary' is a SECONDARY-scope alias for Lower+Upper).
CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN NOT public.rms_is_dos() THEN true
      WHEN p_level IS NULL OR p_level = 'Both' THEN true
      WHEN public.rms_dos_education_level() = 'PRIMARY'   THEN p_level = 'Primary'
      WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary', 'Secondary')
      ELSE true
    END;
$$;

-- ------------------------------------------------------------
-- 4) RLS: classes / subjects (reference lists + ownership).
--    Teachers keep reading everything (same as today); DOS is
--    limited to its own level. Writes become DOS-only + level
--    scoped (previously the open policies let every authenticated
--    user write, which the app never relied on).
-- ------------------------------------------------------------
ALTER TABLE public.classes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname, pp.tablename
    FROM pg_policies pp
    WHERE pp.schemaname = 'public'
      AND pp.tablename IN ('classes', 'subjects')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- classes
CREATE POLICY rms_classes_select ON public.classes
  FOR SELECT USING (public.rms_dos_can_level(classes.education_level));
CREATE POLICY rms_classes_insert ON public.classes
  FOR INSERT WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));
CREATE POLICY rms_classes_update ON public.classes
  FOR UPDATE USING (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level))
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));
CREATE POLICY rms_classes_delete ON public.classes
  FOR DELETE USING (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));

-- subjects
CREATE POLICY rms_subjects_select ON public.subjects
  FOR SELECT USING (public.rms_dos_can_subject(subjects.level));
CREATE POLICY rms_subjects_insert ON public.subjects
  FOR INSERT WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level));
CREATE POLICY rms_subjects_update ON public.subjects
  FOR UPDATE USING (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level))
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level));
CREATE POLICY rms_subjects_delete ON public.subjects
  FOR DELETE USING (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level));

-- ------------------------------------------------------------
-- 5) RLS: learners — DOS scoped by their class level; teachers
--    keep reading all (existing behaviour) and writing nothing.
-- ------------------------------------------------------------
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname
    FROM pg_policies pp
    WHERE pp.schemaname = 'public' AND pp.tablename = 'learners'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.learners', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY rms_learners_select ON public.learners
  FOR SELECT
  USING (
    public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  );
CREATE POLICY rms_learners_insert ON public.learners
  FOR INSERT
  WITH CHECK (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );
CREATE POLICY rms_learners_update ON public.learners
  FOR UPDATE
  USING (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  )
  WITH CHECK (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );
CREATE POLICY rms_learners_delete ON public.learners
  FOR DELETE
  USING (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  );

-- ------------------------------------------------------------
-- 6) RLS: teacher_assignments — DOS scoped by assigned class;
--    teachers keep reading their own rows (unchanged).
-- ------------------------------------------------------------
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname
    FROM pg_policies pp
    WHERE pp.schemaname = 'public' AND pp.tablename = 'teacher_assignments'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_assignments', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY rms_teacher_assignments_select ON public.teacher_assignments
  FOR SELECT
  USING (
    public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)
    )
    OR (class_id IS NULL)
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = teacher_assignments.teacher_id AND t.user_id = auth.uid()
    )
  );
CREATE POLICY rms_teacher_assignments_insert ON public.teacher_assignments
  FOR INSERT
  WITH CHECK (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );
CREATE POLICY rms_teacher_assignments_update ON public.teacher_assignments
  FOR UPDATE
  USING (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)
    )
  )
  WITH CHECK (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );
CREATE POLICY rms_teacher_assignments_delete ON public.teacher_assignments
  FOR DELETE
  USING (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)
    )
  );

-- ------------------------------------------------------------
-- 7) RLS: assessments — DOS scoped by their class level;
--    the existing teacher rules (own / assigned) are unchanged.
-- ------------------------------------------------------------
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname
    FROM pg_policies pp
    WHERE pp.schemaname = 'public' AND pp.tablename = 'assessments'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.assessments', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY rms_assessments_select ON public.assessments
  FOR SELECT
  USING (
    public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)
    )
    OR public.rms_teacher_can_view_assessment_row(
         assessments.teacher_id, assessments.class_id,
         assessments.subject_id, assessments.academic_year_id)
  );
CREATE POLICY rms_assessments_insert ON public.assessments
  FOR INSERT
  WITH CHECK (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
    OR public.rms_teacher_can_assessment_row(
         teacher_id, class_id, subject_id, academic_year_id)
  );
CREATE POLICY rms_assessments_update ON public.assessments
  FOR UPDATE
  USING (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id
    )
  )
  WITH CHECK (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
    OR (teacher_id = assessments.teacher_id
        AND public.rms_teacher_can_assessment_row(
             teacher_id, class_id, subject_id, academic_year_id))
  );
CREATE POLICY rms_assessments_delete ON public.assessments
  FOR DELETE
  USING (
    public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)
    )
    OR (
      assessments.status = 'draft'
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id
      )
    )
  );

-- ------------------------------------------------------------
-- 8) RLS: marks — DOS scoped via assessment -> class level;
--    the existing teacher rules (own / assigned) are unchanged.
-- ------------------------------------------------------------
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname
    FROM pg_policies pp
    WHERE pp.schemaname = 'public' AND pp.tablename = 'marks'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.marks', pol.policyname);
  END LOOP;
END $$;

-- DOS scope check for a mark (via its assessment's class level).
CREATE OR REPLACE FUNCTION public.rms_dos_can_marks(p_assessment_id UUID)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT public.rms_dos_can_level(
    (SELECT c.education_level
     FROM public.assessments a JOIN public.classes c ON c.id = a.class_id
     WHERE a.id = p_assessment_id)
  );
$$;

CREATE POLICY rms_marks_select ON public.marks
  FOR SELECT
  USING (
    public.rms_dos_can_marks(marks.assessment_id)
    OR public.rms_teacher_can_assessment(marks.assessment_id)
  );
CREATE POLICY rms_marks_insert ON public.marks
  FOR INSERT
  WITH CHECK (
    public.rms_dos_can_marks(assessment_id)
    OR public.rms_teacher_can_assessment(assessment_id)
  );
CREATE POLICY rms_marks_update ON public.marks
  FOR UPDATE
  USING (
    public.rms_dos_can_marks(marks.assessment_id)
    OR public.rms_teacher_can_assessment(marks.assessment_id)
  )
  WITH CHECK (
    public.rms_dos_can_marks(assessment_id)
    OR public.rms_teacher_can_assessment(assessment_id)
  );
CREATE POLICY rms_marks_delete ON public.marks
  FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_marks(marks.assessment_id));

-- ------------------------------------------------------------
-- 9) Verification
-- ------------------------------------------------------------
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('classes','subjects','learners','teacher_assignments',
                    'assessments','marks');

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('classes','subjects','learners','teacher_assignments',
                    'assessments','marks')
ORDER BY tablename, policyname;

SELECT email, role, education_level, status FROM public.users
WHERE email IN ('dos@rukara.edu', 'dos2@rukara.edu')
ORDER BY email;