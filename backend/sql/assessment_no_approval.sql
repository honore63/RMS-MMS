-- Remove DOS approval/rejection as a required state transition.
-- Existing approved/rejected rows remain readable and may be edited without
-- changing their legacy status; new transitions into those states are blocked.
CREATE OR REPLACE FUNCTION public.rms_prevent_assessment_approval()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Assessment approval and rejection are disabled; submitted marks are immediately available.';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IN ('approved', 'rejected')
    AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Assessment approval and rejection are disabled; submitted marks are immediately available.';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS rms_assessment_no_approval ON public.assessments;
CREATE TRIGGER rms_assessment_no_approval
  BEFORE INSERT OR UPDATE OF status ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.rms_prevent_assessment_approval();
