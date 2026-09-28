-- Restrict learner inserts and updates to DOS accounts.
-- Apply after migration-dos-education-level-scope.sql,
-- migration-enforce-dos-level-visibility.sql, and migration-account-isolation.sql.

DO $$
BEGIN
  IF to_regprocedure('public.rms_account_role()') IS NULL
     OR to_regprocedure('public.rms_account_can_class(uuid)') IS NULL
     OR to_regprocedure('public.rms_account_can_learner(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run migration-account-isolation.sql first';
  END IF;
END $$;

DROP POLICY IF EXISTS rms_learners_teacher_insert ON public.learners;

DROP POLICY IF EXISTS rms_account_learner_scope ON public.learners;
CREATE POLICY rms_account_learner_scope ON public.learners
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_learner(id))
  WITH CHECK (
    public.rms_account_role() = 'dos'
    AND public.rms_account_can_class(class_id)
  );