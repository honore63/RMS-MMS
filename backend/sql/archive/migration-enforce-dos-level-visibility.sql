-- Apply after migration-dos-education-level-scope.sql.
-- Restrictive policies are ANDed with existing permissive policies, so an
-- older USING (true) policy cannot expose records outside a DOS's level.

DO $$
BEGIN
  IF to_regprocedure('public.rms_is_dos()') IS NULL
     OR to_regprocedure('public.rms_dos_can_level(text)') IS NULL
     OR to_regprocedure('public.rms_dos_can_subject(text)') IS NULL
     OR to_regprocedure('public.rms_dos_can_marks(uuid)') IS NULL
     OR to_regprocedure('public.rms_teacher_in_scope(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run migration-dos-education-level-scope.sql first';
  END IF;
END $$;

DROP POLICY IF EXISTS rms_dos_level_guard ON public.classes;
CREATE POLICY rms_dos_level_guard ON public.classes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_level(education_level))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_level(education_level));

DROP POLICY IF EXISTS rms_dos_level_guard ON public.subjects;
CREATE POLICY rms_dos_level_guard ON public.subjects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_subject(level))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_subject(level));

DROP POLICY IF EXISTS rms_dos_level_guard ON public.class_subjects;
CREATE POLICY rms_dos_level_guard ON public.class_subjects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.rms_is_dos()
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_subjects.class_id)
    )
  )
  WITH CHECK (
    NOT public.rms_is_dos()
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );

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

DROP POLICY IF EXISTS rms_dos_level_guard ON public.teacher_assignments;
CREATE POLICY rms_dos_level_guard ON public.teacher_assignments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.rms_is_dos()
    OR class_id IS NULL
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)
    )
  )
  WITH CHECK (
    NOT public.rms_is_dos()
    OR class_id IS NULL
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );

DROP POLICY IF EXISTS rms_dos_level_guard ON public.assessments;
CREATE POLICY rms_dos_level_guard ON public.assessments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.rms_is_dos()
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)
    )
  )
  WITH CHECK (
    NOT public.rms_is_dos()
    OR public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)
    )
  );

DROP POLICY IF EXISTS rms_dos_level_guard ON public.marks;
CREATE POLICY rms_dos_level_guard ON public.marks
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_marks(assessment_id))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_marks(assessment_id));

DROP POLICY IF EXISTS rms_dos_level_guard ON public.teachers;
CREATE POLICY rms_dos_level_guard ON public.teachers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (
    NOT public.rms_is_dos()
    OR (
      public.rms_is_scoped_dos()
      AND public.rms_teacher_in_scope(teachers.id)
    )
  )
  WITH CHECK (
    NOT public.rms_is_dos() OR public.rms_is_scoped_dos()
  );

NOTIFY pgrst, 'reload schema';

-- Verify every protected table has the restrictive guard installed.
SELECT tablename, policyname, permissive, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname = 'rms_dos_level_guard'
ORDER BY tablename;