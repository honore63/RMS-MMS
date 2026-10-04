-- ============================================================================
-- Class Teacher Access and DOS Assignment Management
-- ----------------------------------------------------------------------------
-- Grants a teacher who is the class teacher (classes.class_teacher_id) of a
-- class a read-only view of:
--   - that class
--   - the learners in it
--   - the assessments and marks of it
--   - the subjects taught in it (evidence: assessments on the class)
--
-- Subject marks and assessment writes stay gated by the existing policies.
-- Class-teacher changes are exposed only through a scope-checked DOS RPC.
-- Idempotent — safe to run on every deploy.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. New helper: is the current user the class teacher of p_assessment_id?
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_class_teacher_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t JOIN public.classes c ON c.class_teacher_id = t.id
    WHERE t.user_id = auth.uid()
      AND t.status = 'active'
      AND public.rms_account_role() IN ('teacher', 'headteacher')
      AND EXISTS (
        SELECT 1 FROM public.assessments a
        WHERE a.id = p_assessment_id AND a.class_id = c.id
      )
  );
$fn$;

-- ----------------------------------------------------------------------------
-- 2. Extend account isolation helpers (SELECT-gating ONLY).
-- ----------------------------------------------------------------------------

-- classes: teacher may read the class they are class teacher of.
CREATE OR REPLACE FUNCTION public.rms_account_can_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c WHERE c.id = p_class_id AND public.rms_dos_can_level(c.education_level))
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.class_id = p_class_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR (EXISTS (SELECT 1 FROM public.classes c WHERE c.id = p_class_id AND c.class_teacher_id = public.rms_account_teacher_id())
        AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.rms_account_teacher_id() AND t.status = 'active'))
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.class_id = p_class_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR (EXISTS (SELECT 1 FROM public.classes c WHERE c.id = p_class_id AND c.class_teacher_id = public.rms_account_teacher_id())
        AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.rms_account_teacher_id() AND t.status = 'active'))
    ELSE false END;
$fn$;

-- learners: teacher may read learners whose class they are class teacher of.
CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND public.rms_dos_can_level(c.education_level))
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR (EXISTS (SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
        WHERE l.id = p_learner_id AND c.class_teacher_id = public.rms_account_teacher_id())
        AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.rms_account_teacher_id() AND t.status = 'active'))
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR (EXISTS (SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
        WHERE l.id = p_learner_id AND c.class_teacher_id = public.rms_account_teacher_id())
        AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.rms_account_teacher_id() AND t.status = 'active'))
    ELSE false END;
$fn$;

-- subjects: teacher may read subjects actually taught in the class they are
-- class teacher of (evidence: assessments created on that class).
CREATE OR REPLACE FUNCTION public.rms_account_can_subject(p_subject_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = p_subject_id AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.subject_id = p_subject_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR EXISTS (SELECT 1 FROM public.classes c WHERE c.class_teacher_id = public.rms_account_teacher_id()
        AND EXISTS (SELECT 1 FROM public.assessments a WHERE a.class_id = c.id AND a.subject_id = p_subject_id)
        AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.rms_account_teacher_id() AND t.status = 'active'))
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.subject_id = p_subject_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR EXISTS (SELECT 1 FROM public.classes c WHERE c.class_teacher_id = public.rms_account_teacher_id()
        AND EXISTS (SELECT 1 FROM public.assessments a WHERE a.class_id = c.id AND a.subject_id = p_subject_id)
        AND EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = public.rms_account_teacher_id() AND t.status = 'active'))
    ELSE false END;
$fn$;

-- assessments: teacher may read assessments of the class they are class teacher of.
CREATE OR REPLACE FUNCTION public.rms_account_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.assessments a JOIN public.classes c ON c.id = a.class_id
      JOIN public.subjects s ON s.id = a.subject_id WHERE a.id = p_assessment_id
      AND public.rms_dos_can_level(c.education_level) AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
      OR public.rms_class_teacher_can_assessment(p_assessment_id)
    WHEN 'headteacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
      OR public.rms_class_teacher_can_assessment(p_assessment_id)
    ELSE false END;
$fn$;

-- ----------------------------------------------------------------------------
-- 3. Extend report helpers (SECURITY DEFINER, class-teacher aware).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_class(p_class_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active'
      AND t.status = 'active' AND ta.class_id = p_class_id)
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
      JOIN public.classes c ON c.class_teacher_id = t.id
      WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active'
        AND t.status = 'active' AND c.id = p_class_id);
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_subject(p_subject_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active'
      AND t.status = 'active' AND ta.subject_id = p_subject_id)
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
      JOIN public.classes c ON c.class_teacher_id = t.id
      JOIN public.assessments a ON a.class_id = c.id
      WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active'
        AND t.status = 'active' AND a.subject_id = p_subject_id);
$fn$;

-- ----------------------------------------------------------------------------
-- 4. Permissive SELECT policies: allow class-teacher reads.
--    (Insert/update/delete policies intentionally untouched.)
-- ----------------------------------------------------------------------------
DROP POLICY IF EXISTS rms_assessments_select ON public.assessments;
CREATE POLICY rms_assessments_select ON public.assessments FOR SELECT
  USING (public.rms_dos_can_level((SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id))
    OR public.rms_teacher_can_view_assessment_row(assessments.teacher_id, assessments.class_id, assessments.subject_id, assessments.academic_year_id)
    OR public.rms_class_teacher_can_assessment(assessments.id));

DROP POLICY IF EXISTS rms_marks_select ON public.marks;
CREATE POLICY rms_marks_select ON public.marks FOR SELECT
  USING (public.rms_dos_can_marks(marks.assessment_id)
    OR public.rms_teacher_can_assessment(marks.assessment_id)
    OR public.rms_class_teacher_can_assessment(marks.assessment_id));

-- ----------------------------------------------------------------------------
-- 5. Performance index for the class-teacher lookups.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_classes_class_teacher_id ON public.classes(class_teacher_id)
  WHERE class_teacher_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Grants (mirror existing helper grants).
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rms_class_teacher_can_assessment(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_class_teacher_can_assessment(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Secure DOS assignment API. The classes table stores exactly one primary
--    class teacher per class, while one teacher may own multiple classes.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_teacher_level_allows(
  p_teacher_id UUID,
  p_education_level TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN upper(COALESCE(t.education_level, '')) IN ('BOTH', 'ALL') THEN
      upper(COALESCE(p_education_level, '')) IN ('PRIMARY', 'SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    WHEN upper(COALESCE(t.education_level, '')) = 'PRIMARY' THEN
      upper(COALESCE(p_education_level, '')) = 'PRIMARY'
    WHEN upper(COALESCE(t.education_level, '')) = 'SECONDARY' THEN
      upper(COALESCE(p_education_level, '')) IN ('SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    ELSE false
  END
  FROM public.teachers t
  WHERE t.id = p_teacher_id AND t.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_subject_level_allows(
  p_teacher_id UUID,
  p_subject_level TEXT
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN upper(COALESCE(t.education_level, '')) IN ('BOTH', 'ALL') THEN true
    WHEN upper(COALESCE(p_subject_level, '')) IN ('BOTH', 'ALL') THEN true
    WHEN upper(t.education_level) = 'PRIMARY' THEN upper(COALESCE(p_subject_level, '')) = 'PRIMARY'
    WHEN upper(t.education_level) = 'SECONDARY' THEN
      upper(COALESCE(p_subject_level, '')) IN ('SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    ELSE false
  END
  FROM public.teachers t
  WHERE t.id = p_teacher_id AND t.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_assign_teacher_level(p_level TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN
      upper(COALESCE(p_level, '')) IN ('PRIMARY', 'SECONDARY', 'BOTH', 'ALL')
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN upper(COALESCE(p_level, '')) = 'PRIMARY'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN upper(COALESCE(p_level, '')) = 'SECONDARY'
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_manage_teacher_level(p_level TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN
      upper(COALESCE(p_level, '')) IN ('PRIMARY', 'SECONDARY', 'BOTH', 'ALL')
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN upper(COALESCE(p_level, '')) IN ('PRIMARY', 'BOTH', 'ALL')
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN upper(COALESCE(p_level, '')) IN ('SECONDARY', 'BOTH', 'ALL')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_in_scope(p_teacher_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id)
    AND (
      (NOT EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = p_teacher_id)
        AND NOT EXISTS (SELECT 1 FROM public.classes c WHERE c.class_teacher_id = p_teacher_id))
      OR EXISTS (SELECT 1 FROM public.teacher_assignments ta JOIN public.classes c ON c.id = ta.class_id
        WHERE ta.teacher_id = p_teacher_id AND public.rms_dos_can_level(c.education_level))
      OR EXISTS (SELECT 1 FROM public.classes c
        WHERE c.class_teacher_id = p_teacher_id AND public.rms_dos_can_level(c.education_level))
    );
$fn$;

-- Older teacher rows default to Both so existing explicit assignments remain
-- valid; new account forms require a deliberate level selection.
-- Account-level values are lowercase in users, where Both is represented by
-- "all". Ensure this constraint is installed before the backfill below writes it.
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_education_level_check;
ALTER TABLE public.users ADD CONSTRAINT users_education_level_check
  CHECK (education_level IS NULL OR education_level IN ('PRIMARY', 'SECONDARY', 'primary', 'secondary', 'all'));

UPDATE public.teachers SET education_level = 'BOTH' WHERE education_level IS NULL;
UPDATE public.users u
SET education_level = CASE
  WHEN upper(t.education_level) = 'PRIMARY' THEN 'primary'
  WHEN upper(t.education_level) = 'SECONDARY' THEN 'secondary'
  ELSE 'all'
END
FROM public.teachers t
WHERE t.user_id = u.id AND u.role = 'teacher'
  AND u.education_level IS DISTINCT FROM CASE
    WHEN upper(t.education_level) = 'PRIMARY' THEN 'primary'
    WHEN upper(t.education_level) = 'SECONDARY' THEN 'secondary'
    ELSE 'all'
  END;

CREATE OR REPLACE FUNCTION public.rms_account_can_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c
      WHERE c.id = p_class_id AND public.rms_dos_can_level(c.education_level))
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta JOIN public.classes c ON c.id = ta.class_id
      WHERE ta.teacher_id = public.rms_account_teacher_id() AND c.id = p_class_id
        AND public.rms_teacher_level_allows(ta.teacher_id, c.education_level))
      OR EXISTS (SELECT 1 FROM public.classes c
        WHERE c.id = p_class_id AND c.class_teacher_id = public.rms_account_teacher_id()
          AND public.rms_teacher_level_allows(c.class_teacher_id, c.education_level))
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta JOIN public.classes c ON c.id = ta.class_id
      WHERE ta.teacher_id = public.rms_account_teacher_id() AND c.id = p_class_id
        AND public.rms_teacher_level_allows(ta.teacher_id, c.education_level))
      OR EXISTS (SELECT 1 FROM public.classes c
        WHERE c.id = p_class_id AND c.class_teacher_id = public.rms_account_teacher_id()
          AND public.rms_teacher_level_allows(c.class_teacher_id, c.education_level))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND public.rms_dos_can_level(c.education_level))
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND public.rms_teacher_level_allows(public.rms_account_teacher_id(), c.education_level)
        AND (c.class_teacher_id = public.rms_account_teacher_id()
          OR EXISTS (SELECT 1 FROM public.teacher_assignments ta
            WHERE ta.teacher_id = public.rms_account_teacher_id() AND ta.class_id = c.id)))
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND public.rms_teacher_level_allows(public.rms_account_teacher_id(), c.education_level)
        AND (c.class_teacher_id = public.rms_account_teacher_id()
          OR EXISTS (SELECT 1 FROM public.teacher_assignments ta
            WHERE ta.teacher_id = public.rms_account_teacher_id() AND ta.class_id = c.id)))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_subject(p_subject_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.subjects s
      WHERE s.id = p_subject_id AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta JOIN public.subjects s ON s.id = ta.subject_id
      WHERE ta.teacher_id = public.rms_account_teacher_id() AND s.id = p_subject_id
        AND public.rms_teacher_subject_level_allows(ta.teacher_id, s.level)
        AND (ta.class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
          WHERE c.id = ta.class_id AND public.rms_teacher_level_allows(ta.teacher_id, c.education_level))))
      OR EXISTS (SELECT 1 FROM public.classes c JOIN public.assessments a ON a.class_id = c.id
        JOIN public.subjects s ON s.id = a.subject_id
        WHERE c.class_teacher_id = public.rms_account_teacher_id() AND s.id = p_subject_id
          AND public.rms_teacher_level_allows(c.class_teacher_id, c.education_level)
          AND public.rms_teacher_subject_level_allows(c.class_teacher_id, s.level))
      OR EXISTS (SELECT 1 FROM public.class_subjects cs
        JOIN public.classes c ON c.id = cs.class_id
        JOIN public.subjects s ON s.id = cs.subject_id
        WHERE c.class_teacher_id = public.rms_account_teacher_id() AND s.id = p_subject_id
          AND public.rms_teacher_level_allows(c.class_teacher_id, c.education_level)
          AND public.rms_teacher_subject_level_allows(c.class_teacher_id, s.level))
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta JOIN public.subjects s ON s.id = ta.subject_id
      WHERE ta.teacher_id = public.rms_account_teacher_id() AND s.id = p_subject_id
        AND public.rms_teacher_subject_level_allows(ta.teacher_id, s.level)
        AND (ta.class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
          WHERE c.id = ta.class_id AND public.rms_teacher_level_allows(ta.teacher_id, c.education_level))))
      OR EXISTS (SELECT 1 FROM public.classes c JOIN public.assessments a ON a.class_id = c.id
        JOIN public.subjects s ON s.id = a.subject_id
        WHERE c.class_teacher_id = public.rms_account_teacher_id() AND s.id = p_subject_id
          AND public.rms_teacher_level_allows(c.class_teacher_id, c.education_level)
          AND public.rms_teacher_subject_level_allows(c.class_teacher_id, s.level))
      OR EXISTS (SELECT 1 FROM public.class_subjects cs
        JOIN public.classes c ON c.id = cs.class_id
        JOIN public.subjects s ON s.id = cs.subject_id
        WHERE c.class_teacher_id = public.rms_account_teacher_id() AND s.id = p_subject_id
          AND public.rms_teacher_level_allows(c.class_teacher_id, c.education_level)
          AND public.rms_teacher_subject_level_allows(c.class_teacher_id, s.level))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assignment(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c JOIN public.subjects s ON s.id = p_subject_id
      WHERE c.id = p_class_id AND public.rms_dos_can_level(c.education_level)
        AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN p_teacher_id = public.rms_account_teacher_id()
      AND EXISTS (SELECT 1 FROM public.teacher_assignments ta
        JOIN public.subjects s ON s.id = ta.subject_id
        WHERE ta.teacher_id = p_teacher_id AND ta.class_id IS NOT DISTINCT FROM p_class_id
          AND ta.subject_id = p_subject_id
          AND public.rms_teacher_subject_level_allows(p_teacher_id, s.level)
          AND (p_class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
            WHERE c.id = p_class_id AND public.rms_teacher_level_allows(p_teacher_id, c.education_level))))
    WHEN 'headteacher' THEN p_teacher_id = public.rms_account_teacher_id()
      AND EXISTS (SELECT 1 FROM public.teacher_assignments ta
        JOIN public.subjects s ON s.id = ta.subject_id
        WHERE ta.teacher_id = p_teacher_id AND ta.class_id IS NOT DISTINCT FROM p_class_id
          AND ta.subject_id = p_subject_id
          AND public.rms_teacher_subject_level_allows(p_teacher_id, s.level)
          AND (p_class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
            WHERE c.id = p_class_id AND public.rms_teacher_level_allows(p_teacher_id, c.education_level))))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT p_teacher_id = public.rms_account_teacher_id()
    AND public.rms_teacher_level_allows(p_teacher_id, c.education_level)
    AND public.rms_teacher_subject_level_allows(p_teacher_id, s.level)
    AND EXISTS (SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.teacher_id = p_teacher_id AND ta.class_id = p_class_id AND ta.subject_id = p_subject_id
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
          OR ta.academic_year_id = p_academic_year_id))
  FROM public.classes c CROSS JOIN public.subjects s
  WHERE c.id = p_class_id AND s.id = p_subject_id;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_can_view_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.teachers t
    JOIN public.classes c ON c.id = p_class_id JOIN public.subjects s ON s.id = p_subject_id
    WHERE t.user_id = auth.uid() AND t.status = 'active'
      AND public.rms_teacher_level_allows(t.id, c.education_level)
      AND public.rms_teacher_subject_level_allows(t.id, s.level)
      AND EXISTS (SELECT 1 FROM public.teacher_assignments ta
        WHERE ta.teacher_id = t.id AND ta.class_id = p_class_id AND ta.subject_id = p_subject_id
          AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
            OR ta.academic_year_id = p_academic_year_id)));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.teachers t JOIN public.assessments a ON a.id = p_assessment_id
    JOIN public.classes c ON c.id = a.class_id JOIN public.subjects s ON s.id = a.subject_id
    WHERE t.user_id = auth.uid() AND t.status = 'active'
      AND public.rms_teacher_level_allows(t.id, c.education_level)
      AND public.rms_teacher_subject_level_allows(t.id, s.level)
      AND EXISTS (SELECT 1 FROM public.teacher_assignments ta
        WHERE ta.teacher_id = t.id AND ta.class_id = a.class_id AND ta.subject_id = a.subject_id
          AND (ta.academic_year_id IS NULL OR a.academic_year_id IS NULL
            OR ta.academic_year_id = a.academic_year_id)));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_class_teacher_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.teachers t JOIN public.classes c ON c.class_teacher_id = t.id
    JOIN public.assessments a ON a.class_id = c.id JOIN public.subjects s ON s.id = a.subject_id
    WHERE t.user_id = auth.uid() AND t.status = 'active'
      AND public.rms_account_role() IN ('teacher', 'headteacher')
      AND public.rms_teacher_level_allows(t.id, c.education_level)
      AND a.id = p_assessment_id);
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.assessments a JOIN public.classes c ON c.id = a.class_id
      JOIN public.subjects s ON s.id = a.subject_id WHERE a.id = p_assessment_id
        AND public.rms_dos_can_level(c.education_level) AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
      OR public.rms_class_teacher_can_assessment(p_assessment_id)
    WHEN 'headteacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
      OR public.rms_class_teacher_can_assessment(p_assessment_id)
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assessment_fields(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c CROSS JOIN public.subjects s
      WHERE c.id = p_class_id AND s.id = p_subject_id
        AND public.rms_dos_can_level(c.education_level) AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN public.rms_teacher_can_assessment_row(
      p_teacher_id, p_class_id, p_subject_id, p_academic_year_id)
    WHEN 'headteacher' THEN public.rms_teacher_can_assessment_row(
      p_teacher_id, p_class_id, p_subject_id, p_academic_year_id)
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
    JOIN public.classes c ON c.id = p_class_id JOIN public.teacher_assignments ta
      ON ta.teacher_id = t.id AND ta.class_id = c.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND t.status = 'active'
      AND public.rms_teacher_level_allows(t.id, c.education_level))
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
      JOIN public.classes c ON c.id = p_class_id AND c.class_teacher_id = t.id
      WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND t.status = 'active'
        AND public.rms_teacher_level_allows(t.id, c.education_level));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_subject(p_subject_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id JOIN public.subjects s ON s.id = ta.subject_id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND t.status = 'active'
      AND s.id = p_subject_id AND public.rms_teacher_subject_level_allows(t.id, s.level)
      AND (ta.class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
        WHERE c.id = ta.class_id AND public.rms_teacher_level_allows(t.id, c.education_level))))
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
      JOIN public.classes c ON c.class_teacher_id = t.id
      JOIN public.assessments a ON a.class_id = c.id JOIN public.subjects s ON s.id = a.subject_id
      WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND t.status = 'active'
        AND s.id = p_subject_id AND public.rms_teacher_level_allows(t.id, c.education_level)
        AND public.rms_teacher_subject_level_allows(t.id, s.level))
    OR EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
      JOIN public.classes c ON c.class_teacher_id = t.id
      JOIN public.class_subjects cs ON cs.class_id = c.id
      JOIN public.subjects s ON s.id = cs.subject_id
      WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND t.status = 'active'
        AND s.id = p_subject_id AND public.rms_teacher_level_allows(t.id, c.education_level)
        AND public.rms_teacher_subject_level_allows(t.id, s.level));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_learner(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.rms_report_teacher_has_class(p_class_id);
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_assignment_visible(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID
)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.rms_is_dos()
    OR (p_teacher_id = public.rms_account_teacher_id()
      AND public.rms_account_can_class(p_class_id)
      AND public.rms_account_can_subject(p_subject_id));
$fn$;

DROP POLICY IF EXISTS rms_account_class_subject_level_scope ON public.class_subjects;
CREATE POLICY rms_account_class_subject_level_scope ON public.class_subjects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_role() = 'dos' OR public.rms_account_can_class(class_id))
  WITH CHECK (public.rms_account_role() = 'dos');

DROP POLICY IF EXISTS rms_dos_teacher_education_level_scope ON public.teachers;
CREATE POLICY rms_dos_teacher_education_level_scope ON public.teachers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_manage_teacher_level(education_level))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_assign_teacher_level(education_level));

DROP POLICY IF EXISTS rms_dos_user_teacher_education_level_scope ON public.users;
CREATE POLICY rms_dos_user_teacher_education_level_scope ON public.users
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR role <> 'teacher' OR public.rms_dos_can_manage_teacher_level(education_level))
  WITH CHECK (NOT public.rms_is_dos() OR role <> 'teacher' OR public.rms_dos_can_assign_teacher_level(education_level));

DROP POLICY IF EXISTS rms_class_teacher_education_level_scope ON public.classes;
CREATE POLICY rms_class_teacher_education_level_scope ON public.classes
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (class_teacher_id IS NULL OR public.rms_teacher_level_allows(class_teacher_id, education_level));
DROP POLICY IF EXISTS rms_class_teacher_education_level_update_scope ON public.classes;
CREATE POLICY rms_class_teacher_education_level_update_scope ON public.classes
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (class_teacher_id IS NULL OR public.rms_teacher_level_allows(class_teacher_id, education_level));

DROP POLICY IF EXISTS rms_teacher_assignment_education_level_insert ON public.teacher_assignments;
CREATE POLICY rms_teacher_assignment_education_level_insert ON public.teacher_assignments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = subject_id AND public.rms_teacher_subject_level_allows(teacher_id, s.level)
      AND (class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
        WHERE c.id = class_id AND public.rms_teacher_level_allows(teacher_id, c.education_level)))));
DROP POLICY IF EXISTS rms_teacher_assignment_education_level_update ON public.teacher_assignments;
CREATE POLICY rms_teacher_assignment_education_level_update ON public.teacher_assignments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (NOT public.rms_is_dos() OR EXISTS (
    SELECT 1 FROM public.subjects s
    WHERE s.id = subject_id AND public.rms_teacher_subject_level_allows(teacher_id, s.level)
      AND (class_id IS NULL OR EXISTS (SELECT 1 FROM public.classes c
        WHERE c.id = class_id AND public.rms_teacher_level_allows(teacher_id, c.education_level)))));

REVOKE ALL ON FUNCTION public.rms_teacher_level_allows(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_teacher_subject_level_allows(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_can_assign_teacher_level(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_can_manage_teacher_level(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_teacher_in_scope(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_teacher_level_allows(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_teacher_subject_level_allows(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_assign_teacher_level(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_manage_teacher_level(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_teacher_in_scope(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_audit_class_teacher_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_old_teacher_id UUID;
  v_new_teacher_id UUID;
  v_old_teacher_name TEXT;
  v_new_teacher_name TEXT;
  v_user_name TEXT;
  v_user_role TEXT;
  v_action TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_teacher_id := OLD.class_teacher_id;
    v_new_teacher_id := NEW.class_teacher_id;
    IF v_old_teacher_id IS NOT DISTINCT FROM v_new_teacher_id THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_new_teacher_id := NEW.class_teacher_id;
    IF v_new_teacher_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    RETURN OLD;
  END IF;

  SELECT t.full_name INTO v_old_teacher_name
  FROM public.teachers t WHERE t.id = v_old_teacher_id;
  SELECT t.full_name INTO v_new_teacher_name
  FROM public.teachers t WHERE t.id = v_new_teacher_id;
  SELECT u.full_name, u.role INTO v_user_name, v_user_role
  FROM public.users u WHERE u.id = auth.uid();

  v_action := CASE
    WHEN v_old_teacher_id IS NULL THEN 'assign_class_teacher'
    WHEN v_new_teacher_id IS NULL THEN 'remove_class_teacher'
    ELSE 'change_class_teacher'
  END;

  INSERT INTO public.audit_logs (user_id, user_name, role, action, old_value, new_value, timestamp)
  VALUES (
    auth.uid(),
    COALESCE(v_user_name, 'SYSTEM'),
    COALESCE(v_user_role, 'system'),
    v_action,
    CASE WHEN v_old_teacher_id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'class_id', NEW.id,
        'class_name', NEW.name,
        'teacher_id', v_old_teacher_id,
        'teacher_name', v_old_teacher_name
      )::TEXT END,
    CASE WHEN v_new_teacher_id IS NULL THEN NULL ELSE
      jsonb_build_object(
        'class_id', NEW.id,
        'class_name', NEW.name,
        'teacher_id', v_new_teacher_id,
        'teacher_name', v_new_teacher_name
      )::TEXT END,
    NOW()
  );
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS rms_audit_class_teacher_update ON public.classes;
CREATE TRIGGER rms_audit_class_teacher_update
AFTER UPDATE OF class_teacher_id ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.rms_audit_class_teacher_change();

DROP TRIGGER IF EXISTS rms_audit_class_teacher_insert ON public.classes;
CREATE TRIGGER rms_audit_class_teacher_insert
AFTER INSERT ON public.classes
FOR EACH ROW EXECUTE FUNCTION public.rms_audit_class_teacher_change();

CREATE OR REPLACE FUNCTION public.rms_set_class_teacher_assignments(
  p_teacher_id UUID,
  p_class_ids UUID[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_class_ids UUID[] := array_remove(COALESCE(p_class_ids, '{}'::UUID[]), NULL);
  v_teacher_level TEXT;
  v_teacher_status TEXT;
  v_user_role TEXT;
  v_user_status TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT public.rms_is_dos() THEN
    RAISE EXCEPTION 'Only an authenticated DOS/Admin may assign class teachers.'
      USING ERRCODE = '42501';
  END IF;

  SELECT t.education_level, t.status, u.role, u.status
  INTO v_teacher_level, v_teacher_status, v_user_role, v_user_status
  FROM public.teachers t
  LEFT JOIN public.users u ON u.id = t.user_id
  WHERE t.id = p_teacher_id;
  IF NOT FOUND OR (
    cardinality(v_class_ids) > 0 AND (
      v_teacher_status IS DISTINCT FROM 'active'
      OR v_user_role IS DISTINCT FROM 'teacher'
      OR v_user_status IS DISTINCT FROM 'active'
    )
  ) THEN
    RAISE EXCEPTION 'The selected teacher must have an active teacher account to be assigned.';
  END IF;
  IF NOT public.rms_dos_can_teacher_level(v_teacher_level) THEN
    RAISE EXCEPTION 'The selected teacher is outside your education-level scope.'
      USING ERRCODE = '42501';
  END IF;
  IF NOT public.rms_dos_can_assign_teacher_level(v_teacher_level) THEN
    RAISE EXCEPTION 'The selected teacher education level is outside your DOS scope.'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (SELECT DISTINCT unnest(v_class_ids) AS id) requested
    LEFT JOIN public.classes c ON c.id = requested.id
    WHERE c.id IS NULL OR NOT public.rms_dos_can_level(c.education_level)
  ) THEN
    RAISE EXCEPTION 'One or more selected classes are outside your education-level scope or do not exist.'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.classes c
    WHERE c.id = ANY(v_class_ids)
      AND NOT public.rms_teacher_level_allows(p_teacher_id, c.education_level)
  ) THEN
    RAISE EXCEPTION 'A selected class is outside the teacher account education level.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.classes c
  SET class_teacher_id = NULL
  WHERE c.class_teacher_id = p_teacher_id
    AND public.rms_dos_can_level(c.education_level)
    AND NOT (c.id = ANY(v_class_ids));

  UPDATE public.classes c
  SET class_teacher_id = p_teacher_id
  WHERE c.id = ANY(v_class_ids)
    AND c.class_teacher_id IS DISTINCT FROM p_teacher_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_audit_class_teacher_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_set_class_teacher_assignments(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_set_class_teacher_assignments(UUID, UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';