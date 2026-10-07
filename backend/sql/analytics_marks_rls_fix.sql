-- Resolve DOS mark visibility without recursively evaluating assessment RLS
-- from inside a marks RLS policy.
CREATE OR REPLACE FUNCTION public.rms_dos_can_marks(p_assessment_id UUID)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT public.rms_dos_can_level(
    (SELECT c.education_level
     FROM public.assessments a
     JOIN public.classes c ON c.id = a.class_id
     WHERE a.id = p_assessment_id)
  );
$fn$;

REVOKE ALL ON FUNCTION public.rms_dos_can_marks(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_marks(UUID) TO authenticated;
