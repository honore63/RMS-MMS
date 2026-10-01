-- ============================================================================
-- DELTA: Class-Derived Teacher Scope (spec #7, #13, #16)
-- Run AFTER migration-dos-education-level-scope.sql if you already applied it,
-- or INSTEAD OF the teacher sections (3, 7, 9) if doing a fresh run.
-- Idempotent — safe to re-run.
-- ============================================================================

-- ------------------------------------------------------------
-- 1) Teacher visibility — purely assignment-derived (no label)
--    Visible if: has >=1 in-scope assignment OR unassigned (shared pool).
--    A both-level teacher is visible to BOTH DOSes, each seeing only
--    their own level's assignments (via assignment RLS).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_teacher_in_scope(p_teacher_id UUID)
RETURNS boolean LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id)
    AND (
      NOT EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = p_teacher_id)
      OR EXISTS (
        SELECT 1
        FROM public.teacher_assignments ta
        JOIN public.classes c ON c.id = ta.class_id
        WHERE ta.teacher_id = p_teacher_id
          AND public.rms_dos_can_level(c.education_level)
      )
    );
$$;

-- ------------------------------------------------------------
-- 2) Teacher CRUD — scoped DOS only; NO label checks.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS rms_teachers_insert ON public.teachers;
DROP POLICY IF EXISTS rms_teachers_update ON public.teachers;

CREATE POLICY rms_teachers_insert ON public.teachers
  FOR INSERT
  WITH CHECK (public.rms_is_dos() AND public.rms_is_scoped_dos());

CREATE POLICY rms_teachers_update ON public.teachers
  FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(teachers.id))
  WITH CHECK (public.rms_is_dos() AND public.rms_is_scoped_dos());

-- ------------------------------------------------------------
-- 3) Teacher Assignments — remove teacher-label gate; scope by class+subject only.
-- ------------------------------------------------------------
DROP POLICY IF EXISTS rms_teacher_assignments_insert ON public.teacher_assignments;
DROP POLICY IF EXISTS rms_teacher_assignments_update ON public.teacher_assignments;

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
  );

-- ------------------------------------------------------------
-- 4) Legacy helper kept for backward compatibility — NOT used by policies.
-- ------------------------------------------------------------
COMMENT ON FUNCTION public.rms_dos_can_teacher(TEXT) IS 'Legacy: teacher scoping is now fully assignment-derived via rms_teacher_in_scope. This function is no longer referenced by any policy.';

-- ------------------------------------------------------------
-- 5) Verification
-- ------------------------------------------------------------
SELECT 'teacher policies' AS check,
       count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'teachers';

SELECT 'teacher_assignments policies' AS check,
       count(*) AS policy_count
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'teacher_assignments';

-- rms_teacher_in_scope sanity: a teacher with Primary assignment is visible to Primary DOS
-- (requires a Primary DOS session to test).

-- Auth/Profile linkage verification:
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

-- Class backfill check (NULL level must be 0):
SELECT 'classes with NULL education_level' AS check, count(*) AS null_count
FROM public.classes WHERE education_level IS NULL;

-- Distribution:
SELECT education_level, count(*) FROM public.classes GROUP BY education_level ORDER BY education_level;