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
-- 2) Consolidate + confirm the two level-specific DOS accounts.
--    Self-healing on every run:
--      * picks ONE surviving auth.users row per email (prefers a row
--        that already has password + confirmation + email identity),
--        then deletes ALL other duplicates and their identities,
--      * (re)creates the keeper with password `dos123` and a valid
--        auth.identities email row (REQUIRED by newer Supabase Auth),
--      * re-links public.users.id to the SURVIVING auth row so that
--        auth.uid() == profile.id (a mismatch silently made the scope
--        helpers return NULL -> DOS was treated as GLOBAL).
--    NOTE: no ON CONFLICT on auth.users (no unique email index).
-- ------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  r         record;
  v_keeper  uuid;
  v_row     record;
  v_email   text;
  v_lvl     text;
  v_name    text;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('dos@rukara.edu'::text,  'PRIMARY'::text,   'DOS Primary'::text),
      ('dos2@rukara.edu'::text, 'SECONDARY'::text, 'DOS Secondary'::text)
    ) t(email, lvl, nm)
  LOOP
    v_email := r.email;
    v_lvl   := r.lvl;
    v_name  := r.nm;

    -- 1) Pick the keeper row (healthy one first, else newest).
    SELECT id INTO v_keeper
    FROM auth.users u
    WHERE lower(u.email) = v_email
      AND crypt('dos123', u.encrypted_password) = u.encrypted_password
      AND u.email_confirmed_at IS NOT NULL
      AND exists(SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
    ORDER BY u.created_at DESC
    LIMIT 1;

    IF v_keeper IS NULL THEN
      SELECT id INTO v_keeper
      FROM auth.users u
      WHERE lower(u.email) = v_email
      ORDER BY u.created_at DESC
      LIMIT 1;
    END IF;

    -- 2) Delete every OTHER auth.users row for this email.
    FOR v_row IN
      SELECT id FROM auth.users u WHERE lower(u.email) = v_email
    LOOP
      IF v_row.id IS DISTINCT FROM v_keeper THEN
        DELETE FROM auth.identities WHERE user_id = v_row.id;
        DELETE FROM auth.users   WHERE id = v_row.id;
      END IF;
    END LOOP;

    -- 3) Create the keeper if nothing survived.
    IF v_keeper IS NULL THEN
      INSERT INTO auth.users
        (instance_id, id, aud, role, email,
         encrypted_password, email_confirmed_at,
         raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at, confirmation_token)
      VALUES
        ('00000000-0000-0000-0000-000000000000', gen_random_uuid(),
         'authenticated', 'authenticated', v_email,
         crypt('dos123', gen_salt('bf')), now(),
         '{"provider":"email","providers":["email"]}', '{}',
         now(), now(), '')
      RETURNING id INTO v_keeper;
    ELSE
      UPDATE auth.users
      SET encrypted_password = crypt('dos123', gen_salt('bf')),
          email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
          updated_at = now()
      WHERE id = v_keeper;
    END IF;

    -- 4) Ensure the email identity row (password login requirement).
    IF NOT exists(SELECT 1 FROM auth.identities WHERE user_id = v_keeper AND provider = 'email') THEN
      INSERT INTO auth.identities
        (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES
        (v_keeper, v_keeper, v_keeper::text,
         jsonb_build_object('sub', v_keeper::text, 'email', v_email,
                            'email_verified', true, 'phone_verified', false),
         'email', now(), now(), now());
    END IF;

    -- 5) Re-link the profile to the SURVIVING auth row. If an FK blocks
    --    the id change, fall back to keeping the old id (account stays
    --    fail-closed/denied until re-associated) without aborting the run.
    BEGIN
      INSERT INTO public.users (id, email, full_name, role, education_level, status)
      VALUES (v_keeper, v_email, v_name, 'dos', v_lvl, 'active')
      ON CONFLICT (email) DO UPDATE
        SET id = EXCLUDED.id,
            full_name = EXCLUDED.full_name,
            role      = EXCLUDED.role,
            education_level = EXCLUDED.education_level,
            status    = EXCLUDED.status;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Profile re-link deferred for %: %', v_email, SQLERRM;
      UPDATE public.users u
      SET full_name = v_name, role = 'dos',
          education_level = v_lvl, status = 'active'
      WHERE u.email = v_email;
    END;
  END LOOP;
END $$;

-- IMPORTANT: after running this migration you MUST sign out and sign in
-- again with the DOS accounts. The JWT `sub` must equal the surviving
-- auth row so the scope helpers resolve the education level. A stale
-- token against a deleted auth row results in DENIED access (fail-closed),
-- never a widened one.

-- ------------------------------------------------------------
-- 3) Scope helper functions (used by the RLS policies below).
--    All helpers read ONLY reference tables (users / classes /
--    subjects / assessments) and never the table being policed,
--    so the policies cannot recurse.
-- ------------------------------------------------------------
-- Current caller is a teacher with visibility over this assessment
-- (own profile OR their class+subject assignment). Defined here so this
-- migration is standalone; identical to migration-marks-import.sql.
CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment(p_assessment_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM teachers t
    JOIN assessments a ON a.id = p_assessment_id
    WHERE t.user_id = auth.uid()
      AND (
            a.teacher_id = t.id
         OR EXISTS (
              SELECT 1 FROM teacher_assignments ta
              WHERE ta.teacher_id = t.id
                AND ta.class_id = a.class_id
                AND ta.subject_id = a.subject_id
                AND (ta.academic_year_id IS NULL OR a.academic_year_id IS NULL
                     OR ta.academic_year_id = a.academic_year_id)
            )
      )
  );
$$;

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
-- accounts are limited to their own level.
-- FAIL-CLOSED: a DOS whose education level cannot be resolved (profile
-- missing or mismatched) is DENIED everything. A class WITHOUT a level
-- is also DENIED to a scoped DOS (never shared to both) — unclassified
-- classes must be backfilled first (see Section 3b).
CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN NOT public.rms_is_dos() THEN true
      WHEN public.rms_dos_education_level() IS NULL THEN false
      WHEN public.rms_dos_education_level() = 'PRIMARY'   THEN p_level = 'Primary'
      WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary')
      ELSE false
    END;
$$;

-- Subject-level check ('Both' is shared and allowed for every scope;
-- 'Secondary' is a SECONDARY-scope alias for Lower+Upper). FAIL-CLOSED:
-- NULL subject level is denied to a scoped DOS.
CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN NOT public.rms_is_dos() THEN true
      WHEN public.rms_dos_education_level() IS NULL THEN false
      WHEN p_level = 'Both' THEN true
      WHEN public.rms_dos_education_level() = 'PRIMARY'   THEN p_level = 'Primary'
      WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary', 'Secondary')
      ELSE false
    END;
$$;

-- Teachers also carry an education level ('PRIMARY' | 'SECONDARY' | 'BOTH',
-- or NULL = treat as both). Purely administrative teachers may keep BOTH.
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE public.teachers
  DROP CONSTRAINT IF EXISTS teachers_education_level_check;
ALTER TABLE public.teachers
  ADD CONSTRAINT teachers_education_level_check
  CHECK (education_level IS NULL OR education_level IN ('PRIMARY', 'SECONDARY', 'BOTH'));
UPDATE public.teachers SET education_level = COALESCE(education_level, 'BOTH');
CREATE INDEX IF NOT EXISTS idx_teachers_education_level ON public.teachers(education_level);

-- ------------------------------------------------------------
-- 3b) Backfill classes.education_level (the REAL table stores the level in
--     `classes.level`; `education_level` is added by the grouping migration.
--     Any class left NULL was being shared to BOTH DOSes — the leak).
--     Idempotent. Matches migration-education-level-class-grouping.sql.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.education_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.education_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "everyone_read_education_levels" ON public.education_levels;
CREATE POLICY "everyone_read_education_levels" ON public.education_levels FOR SELECT USING (true);
GRANT SELECT ON TABLE public.education_levels TO authenticated, anon;

INSERT INTO public.education_levels (name, code, description, display_order, active)
VALUES
  ('Primary', 'PRIMARY', 'Primary Education (P1 - P6)', 1, true),
  ('Lower Secondary', 'LOWER_SECONDARY', 'Lower Secondary Education (S1 - S3)', 2, true),
  ('Upper Secondary', 'UPPER_SECONDARY', 'Upper Secondary Education (S4 - S6)', 3, true),
  ('Nursery', 'NURSERY', 'Pre-Primary / Nursery Education', 0, false),
  ('TVET', 'TVET', 'Technical & Vocational Education', 4, false)
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name, description = EXCLUDED.description, display_order = EXCLUDED.display_order;

ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS education_level_id UUID REFERENCES public.education_levels(id);

UPDATE public.classes
SET education_level = 'Primary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'PRIMARY' LIMIT 1)
WHERE (education_level IS NULL OR education_level <> 'Primary')
  AND (level IN ('P1','P2','P3','P4','P5','P6') OR level ILIKE 'P%' OR name ILIKE 'P%'
       OR level ~ '^P[0-9]' OR name ~ '^P[0-9]');

UPDATE public.classes
SET education_level = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE (education_level IS NULL OR education_level <> 'Lower Secondary')
  AND (level IN ('S1','S2','S3') OR name ~ '^S[1-3](\s|$)' OR level ~ '^S[1-3]');

UPDATE public.classes
SET education_level = 'Upper Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'UPPER_SECONDARY' LIMIT 1)
WHERE (education_level IS NULL OR education_level <> 'Upper Secondary')
  AND (level IN ('S4','S5','S6') OR name ~ '^S[4-6](\s|$)' OR level ~ '^S[4-6]');

-- Default fallback for any class still unclassified (never leave NULL,
-- NULL means "hidden from both DOSes").
UPDATE public.classes
SET education_level = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE education_level IS NULL;

UPDATE public.subjects SET level = 'Both' WHERE level IS NULL;
UPDATE public.subjects SET education_level = level WHERE education_level IS NULL;

-- Can the current scoped DOS see a given teacher record? Scope is derived
-- from the teacher's ACADEMIC ASSIGNMENTS (spec #7), not just the label:
--   1) an explicitly other-level teacher is never visible,
--   2) a matching/BOTH/NULL teacher with NO assignments is shared,
--   3) otherwise the teacher is visible ONLY when every assignment's class
--      is within the DOS's level (no assignment leaks into the other level).
-- SECURITY DEFINER: reads policed tables, which bypasses RLS here and
-- prevents the policy from re-entering itself (the 57014 recursion bug).
CREATE OR REPLACE FUNCTION public.rms_teacher_in_scope(p_teacher_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH t AS (
    SELECT t.education_level AS lvl
    FROM public.teachers t
    WHERE t.id = p_teacher_id
  ),
  x AS (
    SELECT DISTINCT c.education_level AS lvl
    FROM public.teacher_assignments ta
    JOIN public.classes c ON c.id = ta.class_id
    WHERE ta.teacher_id = p_teacher_id
      AND c.education_level IS NOT NULL
  )
  SELECT
    CASE
      WHEN NOT exists(SELECT 1 FROM t) THEN false
      WHEN t.lvl IS NOT NULL AND t.lvl NOT IN ('BOTH', public.rms_dos_education_level()) THEN false
      WHEN NOT exists(SELECT 1 FROM x) THEN true
      WHEN NOT exists(SELECT 1 FROM x xr WHERE NOT public.rms_dos_can_level(xr.lvl)) THEN true
      ELSE false
    END
  FROM t;
$$;

-- Does a teacher level value belong to the current DOS scope? FAIL-CLOSED.
CREATE OR REPLACE FUNCTION public.rms_dos_can_teacher(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT
    CASE
      WHEN NOT public.rms_is_dos() THEN true
      WHEN public.rms_dos_education_level() IS NULL THEN false
      WHEN p_level IS NULL OR p_level = 'BOTH' THEN true
      WHEN public.rms_dos_education_level() = 'PRIMARY'   THEN p_level = 'PRIMARY'
      WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level = 'SECONDARY'
      ELSE false
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
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
    AND public.rms_dos_can_subject(
      (SELECT s.level FROM public.subjects s WHERE s.id = subject_id)
    )
    AND (
      teacher_id IS NULL
      OR (
        SELECT t.education_level IS NULL OR t.education_level = 'BOTH'
            OR t.education_level = public.rms_dos_education_level()
        FROM public.teachers t WHERE t.id = teacher_id
      )
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
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
    AND public.rms_dos_can_subject(
      (SELECT s.level FROM public.subjects s WHERE s.id = subject_id)
    )
    AND (
      teacher_id IS NULL
      OR (
        SELECT t.education_level IS NULL OR t.education_level = 'BOTH'
            OR t.education_level = public.rms_dos_education_level()
        FROM public.teachers t WHERE t.id = teacher_id
      )
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
-- 9) RLS: teachers — level-scoped teacher management with FULL CRUD
--    for the DOS within its own level. FAIL-CLOSED: a DOS without a
--    resolvable level sees NO teachers and can do nothing.
--    Teachers/headteachers/other roles keep reading all rows.
-- ------------------------------------------------------------
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol RECORD;
BEGIN
  FOR pol IN
    SELECT pp.policyname
    FROM pg_policies pp
    WHERE pp.schemaname = 'public' AND pp.tablename = 'teachers'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teachers', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY rms_teachers_select ON public.teachers
  FOR SELECT
  USING (
    NOT public.rms_is_dos()
    OR (public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(teachers.id))
  );
CREATE POLICY rms_teachers_insert ON public.teachers
  FOR INSERT
  WITH CHECK (public.rms_is_dos() AND public.rms_is_scoped_dos() AND public.rms_dos_can_teacher(teachers.education_level));
CREATE POLICY rms_teachers_update ON public.teachers
  FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(teachers.id))
  WITH CHECK (public.rms_is_dos() AND public.rms_is_scoped_dos() AND public.rms_dos_can_teacher(teachers.education_level));
CREATE POLICY rms_teachers_delete ON public.teachers
  FOR DELETE
  USING (public.rms_is_dos() AND public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(teachers.id));

-- ------------------------------------------------------------
-- 10) Verification
-- ------------------------------------------------------------
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN ('classes','subjects','teachers','learners','teacher_assignments',
                    'assessments','marks');

SELECT tablename, count(*) AS policy_count FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('classes','subjects','teachers','learners','teacher_assignments',
                    'assessments','marks')
GROUP BY tablename ORDER BY tablename;

SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('classes','subjects','teachers','learners','teacher_assignments',
                    'assessments','marks')
ORDER BY tablename, policyname;

-- One auth row per DOS email, identity present, password OK,
-- and profile.id == surviving auth.id (auth.uid() must equal it).
SELECT u.id,
       u.email,
       u.email_confirmed_at IS NOT NULL AS confirmed,
       crypt('dos123', u.encrypted_password) = u.encrypted_password AS pw_ok,
       (SELECT count(*) FROM auth.users x WHERE lower(x.email) = lower(u.email)) AS dup_rows,
       (SELECT count(*) FROM auth.identities i WHERE i.user_id = u.id) AS identity_count,
       (p.id = u.id) AS profile_matches_auth,
       p.role, p.education_level, p.status
FROM auth.users u
LEFT JOIN public.users p ON p.id = u.id
WHERE lower(u.email) IN ('dos@rukara.edu', 'dos2@rukara.edu')
ORDER BY u.email;