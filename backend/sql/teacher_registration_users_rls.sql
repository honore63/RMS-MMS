-- Create teacher user profiles through a narrowly scoped, authenticated DOS RPC.
-- This avoids depending on browser session state for direct users-table inserts.
CREATE OR REPLACE FUNCTION public.rms_create_teacher_user_profile(
  p_user_id UUID, p_email TEXT, p_full_name TEXT, p_phone TEXT, p_education_level TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $fn$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.users caller
    WHERE caller.id = auth.uid() AND caller.role = 'dos' AND caller.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Only an active DOS account can create a teacher profile.';
  END IF;
  IF p_user_id IS NULL OR p_email IS NULL OR btrim(p_email) = ''
    OR p_full_name IS NULL OR btrim(p_full_name) = ''
    OR p_education_level IS NULL
    OR p_education_level NOT IN ('primary', 'secondary', 'all')
    OR NOT public.rms_dos_can_teacher_level(p_education_level) THEN
    RAISE EXCEPTION 'Teacher profile details are invalid or outside the DOS education-level scope.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users target
    WHERE target.id = p_user_id AND lower(target.email) = lower(p_email)
  ) THEN
    RAISE EXCEPTION 'The teacher authentication account could not be verified.';
  END IF;

  INSERT INTO public.users (id, email, full_name, role, status, phone, education_level)
  VALUES (p_user_id, lower(btrim(p_email)), btrim(p_full_name), 'teacher', 'active',
    NULLIF(btrim(p_phone), ''), p_education_level)
  ON CONFLICT (id) DO NOTHING;
  RETURN p_user_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_create_teacher_user_profile(UUID, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_create_teacher_user_profile(UUID, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;

-- Create the teacher row through a DOS-verified RPC instead of a direct
-- browser upsert, which is not permitted by the teachers table's RLS policies.
CREATE OR REPLACE FUNCTION public.rms_register_teacher(
  p_user_id UUID,
  p_teacher_code TEXT,
  p_email TEXT,
  p_full_name TEXT,
  p_phone TEXT,
  p_user_education_level TEXT,
  p_teacher_education_level TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $fn$
DECLARE
  v_teacher_id UUID;
BEGIN
  IF p_teacher_code IS NULL OR btrim(p_teacher_code) = ''
    OR p_user_education_level IS NULL
    OR p_teacher_education_level IS NULL
    OR p_teacher_education_level NOT IN ('PRIMARY', 'SECONDARY', 'BOTH')
    OR NOT public.rms_dos_can_teacher_level(p_teacher_education_level)
    OR (p_user_education_level = 'primary' AND p_teacher_education_level <> 'PRIMARY')
    OR (p_user_education_level = 'secondary' AND p_teacher_education_level <> 'SECONDARY')
    OR (p_user_education_level = 'all' AND p_teacher_education_level <> 'BOTH') THEN
    RAISE EXCEPTION 'Teacher details are invalid or outside the DOS education-level scope.'
      USING ERRCODE = '42501';
  END IF;

  PERFORM public.rms_create_teacher_user_profile(
    p_user_id, p_email, p_full_name, p_phone, p_user_education_level
  );

  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));
  SELECT id INTO v_teacher_id
  FROM public.teachers
  WHERE user_id = p_user_id;

  IF v_teacher_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.teachers
      WHERE id = v_teacher_id AND teacher_code = btrim(p_teacher_code)
    ) THEN
      RAISE EXCEPTION 'This account is already linked to a different teacher record.'
        USING ERRCODE = '23505';
    END IF;
    RETURN v_teacher_id;
  END IF;

  INSERT INTO public.teachers (
    user_id, teacher_code, full_name, email, phone, status, education_level, created_by
  )
  VALUES (
    p_user_id, btrim(p_teacher_code), btrim(p_full_name), lower(btrim(p_email)),
    NULLIF(btrim(p_phone), ''), 'active', p_teacher_education_level, auth.uid()
  )
  RETURNING id INTO v_teacher_id;

  RETURN v_teacher_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_register_teacher(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_register_teacher(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
  TO authenticated;
