-- Install the scoped DOS dashboard learner count RPC on an existing project.
CREATE OR REPLACE FUNCTION public.rms_dashboard_scoped_learner_count(p_class_ids UUID[])
RETURNS BIGINT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_class_ids UUID[] := coalesce(p_class_ids, ARRAY[]::UUID[]);
  v_count BIGINT;
BEGIN
  IF public.rms_account_role() IS DISTINCT FROM 'dos' THEN
    RAISE EXCEPTION 'Only DOS accounts can request dashboard learner counts'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_class_ids) AS requested(class_id)
    LEFT JOIN public.classes AS c ON c.id = requested.class_id
    WHERE c.id IS NULL
      OR NOT public.rms_dos_can_level(c.education_level)
  ) THEN
    RAISE EXCEPTION 'Dashboard learner count includes a class outside the DOS scope'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.learners AS l
  WHERE l.class_id = ANY(v_class_ids);

  RETURN v_count;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_dashboard_scoped_learner_count(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_dashboard_scoped_learner_count(UUID[]) TO authenticated;
