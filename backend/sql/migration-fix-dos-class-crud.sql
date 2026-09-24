-- Restore DOS class CRUD.
-- Global DOS (education_level IS NULL) can manage all classes.
-- Primary / Secondary DOS accounts remain restricted to their level.
-- Run this after the DOS education-level scope migration.

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

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_classes_select ON public.classes;
DROP POLICY IF EXISTS rms_classes_insert ON public.classes;
DROP POLICY IF EXISTS rms_classes_update ON public.classes;
DROP POLICY IF EXISTS rms_classes_delete ON public.classes;

CREATE POLICY rms_classes_select ON public.classes
  FOR SELECT
  USING (public.rms_dos_can_level(classes.education_level));

CREATE POLICY rms_classes_insert ON public.classes
  FOR INSERT
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));

CREATE POLICY rms_classes_update ON public.classes
  FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level))
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));

CREATE POLICY rms_classes_delete ON public.classes
  FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));