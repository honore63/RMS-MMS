-- Allow DOS accounts to create teacher profiles while keeping scoped
-- DOS visibility and assignment-level restrictions intact.
-- Run this once in the Supabase SQL Editor.

CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN p_level IS NULL OR p_level = 'Both' THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Secondary', 'Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_teacher_in_scope(p_teacher_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id
  )
  AND (
    -- Newly registered teachers are visible until DOS assigns them.
    NOT EXISTS (
      SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = p_teacher_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.teacher_assignments ta
      JOIN public.classes c ON c.id = ta.class_id
      WHERE ta.teacher_id = p_teacher_id
        AND public.rms_dos_can_level(c.education_level)
    )
  );
$$;

DROP POLICY IF EXISTS rms_teachers_select ON public.teachers;
DROP POLICY IF EXISTS rms_teachers_insert ON public.teachers;
DROP POLICY IF EXISTS rms_teachers_update ON public.teachers;
DROP POLICY IF EXISTS rms_teachers_delete ON public.teachers;

CREATE POLICY rms_teachers_select ON public.teachers
  FOR SELECT
  USING (
    NOT public.rms_is_dos()
    OR NOT public.rms_is_scoped_dos()
    OR public.rms_teacher_in_scope(teachers.id)
  );

CREATE POLICY rms_teachers_insert ON public.teachers
  FOR INSERT
  WITH CHECK (public.rms_is_dos());

CREATE POLICY rms_teachers_update ON public.teachers
  FOR UPDATE
  USING (
    public.rms_is_dos()
    AND (
      NOT public.rms_is_scoped_dos()
      OR public.rms_teacher_in_scope(teachers.id)
    )
  )
  WITH CHECK (public.rms_is_dos());

CREATE POLICY rms_teachers_delete ON public.teachers
  FOR DELETE
  USING (
    public.rms_is_dos()
    AND (
      NOT public.rms_is_scoped_dos()
      OR public.rms_teacher_in_scope(teachers.id)
    )
  );