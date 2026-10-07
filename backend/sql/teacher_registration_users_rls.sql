-- Allow authenticated DOS accounts to create teacher profiles, while
-- preventing a scoped DOS from creating a profile for the opposite level.
-- Self-service teacher profile creation remains supported.
DROP POLICY IF EXISTS rms_account_users_insert ON public.users;
CREATE POLICY rms_account_users_insert ON public.users FOR INSERT TO authenticated
  WITH CHECK (
    (id = auth.uid() AND role = 'teacher')
    OR (
      public.rms_account_role() = 'dos'
      AND role IN ('teacher', 'parent')
      AND public.rms_dos_can_teacher_level(education_level)
    )
  );
