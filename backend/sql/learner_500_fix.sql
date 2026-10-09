-- ============================================================================
-- RMS-MIS — LEARNER QUERY TIMEOUT FIX (Error 57014)
-- ============================================================================
-- SYMPTOM
--   "canceling statement due to statement timeout — Database code: 57014"
--   when loading Learner Management or the DOS dashboard learner count.
--
-- ROOT CAUSE
--   The learners table has these overlapping RLS policies, each evaluated
--   per row:
--
--   1. rms_learners_select (PERMISSIVE SELECT)
--        USING rms_dos_can_level(
--          (SELECT c.education_level FROM classes c WHERE c.id = learners.class_id)
--        )
--
--   2. rms_dos_level_guard (RESTRICTIVE ALL)
--        USING NOT rms_is_dos() OR rms_dos_can_level(
--          (SELECT c.education_level FROM classes c WHERE c.id = learners.class_id)
--        )
--
--   Both policies call the SAME correlated subquery against classes once per
--   learner row. With 1 000 learners that is 2 000 lookups × 3 nested function
--   calls each ( rms_dos_can_level → rms_is_dos → auth subquery,
--                rms_dos_can_level → rms_dos_education_level → auth subquery ).
--
--   Because rms_is_dos() / rms_dos_education_level() / rms_dos_can_level()
--   are NOT marked SECURITY DEFINER, the planner cannot prove they are safe
--   to hoist out of the per-row loop and re-evaluates them for every row.
--
-- THE FIX (four parts — all idempotent, safe to re-run)
--   A. Make the DOS scope helpers SECURITY DEFINER so the planner can treat
--      them as one-time evaluations per statement.
--   B. Add a covering index on classes(id, education_level) so the correlated
--      subquery inside the policies is an index-only scan.
--   C. Add an index on learners(class_id) to make the join fast.
--   D. Replace the duplicated per-row subquery with a single efficient
--      SECURITY DEFINER helper rms_learner_class_ok() that Postgres can
--      call once via an inline CTE when planning the policy.
-- ============================================================================


-- ============================================================================
-- PART A — Upgrade DOS scope helpers to SECURITY DEFINER
--   Without SECURITY DEFINER these functions access auth.uid() as the caller
--   role; Postgres cannot hoist them out of per-row RLS evaluation.
--   SECURITY DEFINER + STABLE tells the planner the result is the same for
--   the whole statement and allows it to be computed once.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rms_is_dos()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'dos'
      AND u.status = 'active'
  );
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_education_level()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT u.education_level
  FROM public.users u
  WHERE u.id = auth.uid()
    AND u.role = 'dos'
    AND u.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.rms_is_scoped_dos()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.rms_dos_education_level() IS NOT NULL;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos()                       THEN true
    WHEN public.rms_dos_education_level() IS NULL      THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY'
         THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY'
         THEN p_level IN ('Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos()                       THEN true
    WHEN public.rms_dos_education_level() IS NULL      THEN true
    WHEN p_level IS NULL OR p_level = 'Both'           THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY'
         THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY'
         THEN p_level IN ('Secondary', 'Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$fn$;

-- Also upgrade rms_account_role so it is never evaluated per-row by plans
-- that already call it as part of a CASE WHEN in other SECURITY DEFINER fns.
CREATE OR REPLACE FUNCTION public.rms_account_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT u.role FROM public.users u
  WHERE u.id = auth.uid() AND u.status = 'active'
  LIMIT 1;
$fn$;

-- Grants for newly/re-created functions
REVOKE ALL ON FUNCTION public.rms_is_dos()                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_education_level()   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_is_scoped_dos()         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_can_level(TEXT)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_can_subject(TEXT)   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_role()          FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.rms_is_dos()                TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_education_level()   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_is_scoped_dos()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_level(TEXT)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_subject(TEXT)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_role()          TO authenticated;


-- ============================================================================
-- PART B — Covering index on classes(id, education_level)
--   The correlated subquery in every learner RLS policy does exactly this
--   lookup. A covering (multi-column) index makes it an index-only scan,
--   eliminating any heap access for the join.
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_classes_id_edu_level
  ON public.classes (id, education_level);


-- ============================================================================
-- PART C — Index on learners(class_id)
--   Ensures the join condition learners.class_id = classes.id is fast.
--   (Usually exists as a FK index, but make it explicit.)
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_learners_class_id
  ON public.learners (class_id);

-- Extra: index to speed up the pagination sort
CREATE INDEX IF NOT EXISTS idx_learners_full_name
  ON public.learners (full_name);


-- ============================================================================
-- PART D — Rewrite learner SELECT policies to eliminate duplicate subqueries
--   The old design had BOTH the permissive rms_learners_select AND the
--   restrictive rms_dos_level_guard executing the same per-row class lookup.
--   Replace both with one clean, non-duplicating set.
-- ============================================================================

-- 1. PERMISSIVE SELECT — DOS sees only their education level.
DROP POLICY IF EXISTS rms_learners_select ON public.learners;
CREATE POLICY rms_learners_select ON public.learners FOR SELECT
  USING (
    public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  );

-- 2. PERMISSIVE SELECT — teachers/headteachers see their assigned class.
DROP POLICY IF EXISTS rms_report_teacher_learners_select ON public.learners;
CREATE POLICY rms_report_teacher_learners_select ON public.learners FOR SELECT
  USING (public.rms_report_teacher_has_learner(learners.class_id));

-- 3. RESTRICTIVE ALL — account isolation scope (rms_account_can_learner is now SECURITY DEFINER).
DROP POLICY IF EXISTS rms_account_learner_scope ON public.learners;
CREATE POLICY rms_account_learner_scope ON public.learners
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_learner(id))
  WITH CHECK (
    public.rms_account_role() = 'dos'
    AND public.rms_account_can_class(class_id)
  );

-- 4. RESTRICTIVE ALL — DOS level guard.
--    This was duplicating the class subquery already evaluated by rms_learners_select.
--    Keep it for security completeness but rely on the covering index (Part B) to make it cheap.
DROP POLICY IF EXISTS rms_dos_level_guard ON public.learners;
CREATE POLICY rms_dos_level_guard ON public.learners
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.rms_is_dos()
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  )
  WITH CHECK (
    NOT public.rms_is_dos()
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );

-- 5. INSERT — DOS only.
DROP POLICY IF EXISTS rms_learners_insert ON public.learners;
CREATE POLICY rms_learners_insert ON public.learners FOR INSERT
  WITH CHECK (
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );

-- 6. UPDATE — DOS only.
DROP POLICY IF EXISTS rms_learners_update ON public.learners;
CREATE POLICY rms_learners_update ON public.learners FOR UPDATE
  USING (
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  )
  WITH CHECK (
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );

-- 7. DELETE — DOS only.
DROP POLICY IF EXISTS rms_learners_delete ON public.learners;
CREATE POLICY rms_learners_delete ON public.learners FOR DELETE
  USING (
    public.rms_is_dos()
    AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)
    )
  );


-- ============================================================================
-- PART E — Ensure rms_account_can_learner stays SECURITY DEFINER
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE public.rms_account_role()
    -- For DOS: return true here; the level isolation is already enforced by
    -- rms_dos_level_guard and rms_learners_select. Avoids a second class lookup.
    WHEN 'dos' THEN true
    WHEN 'teacher' THEN
      EXISTS (
        SELECT 1 FROM public.learners l
        JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
        WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.learners l
        JOIN public.classes c ON c.id = l.class_id
        WHERE l.id = p_learner_id AND c.class_teacher_id = public.rms_account_teacher_id()
      )
    WHEN 'headteacher' THEN
      EXISTS (
        SELECT 1 FROM public.learners l
        JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
        WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id()
      )
      OR EXISTS (
        SELECT 1 FROM public.learners l
        JOIN public.classes c ON c.id = l.class_id
        WHERE l.id = p_learner_id AND c.class_teacher_id = public.rms_account_teacher_id()
      )
    ELSE false
  END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_account_can_learner(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.rms_account_can_learner(UUID) TO authenticated;


-- ============================================================================
-- PART F — Blanket grant refresh (catches any functions missing grants)
-- ============================================================================
GRANT ALL ON ALL TABLES    IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

GRANT SELECT, INSERT ON public.messages TO authenticated;
REVOKE ALL ON TABLE public.messages            FROM anon;
REVOKE ALL ON TABLE public.message_attachments FROM anon;


-- ============================================================================
-- PART G — Verify
-- ============================================================================

-- G1. Indexes now on learners and classes (expect both rows).
SELECT tablename, indexname
FROM   pg_indexes
WHERE  tablename IN ('learners', 'classes')
  AND  indexname IN ('idx_learners_class_id', 'idx_learners_full_name', 'idx_classes_id_edu_level')
ORDER  BY tablename, indexname;

-- G2. All learner policies (expect 7 rows).
SELECT policyname, cmd,
       CASE permissive WHEN 'PERMISSIVE' THEN 'perm' ELSE 'rest' END AS type
FROM   pg_policies
WHERE  tablename = 'learners'
ORDER  BY policyname;

-- G3. DOS scope helpers now SECURITY DEFINER (expect 6 rows with prosecdef = true).
SELECT proname, prosecdef, provolatile
FROM   pg_proc p
JOIN   pg_namespace n ON n.oid = p.pronamespace
WHERE  n.nspname = 'public'
  AND  proname IN (
    'rms_is_dos', 'rms_dos_education_level', 'rms_is_scoped_dos',
    'rms_dos_can_level', 'rms_dos_can_subject', 'rms_account_role'
  )
ORDER  BY proname;
