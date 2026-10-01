-- ============================================================
-- RMS: RESTORE TEACHER "Tuyishime Honore"
-- Re-creates the public.users + public.teachers rows after the
-- account was deleted from public.users (which cascade-deleted
-- the teachers row). The Supabase Auth login still exists.
--
-- HOW TO USE:
--  1. Replace EVERY '<EMAIL>' below with the teacher's login email.
--  2. Replace '<PHONE>' (optional) with their phone, or delete the
--     phone entry to store NULL.
--  3. Run the whole script in SQL Editor.
--  4. Review the NOTICE it prints, then COMMIT.
-- ============================================================

-- STEP 0 (optional): find the exact login email if unsure.
-- SELECT id, email FROM auth.users WHERE email ILIKE '%tuyi%';

BEGIN;

-- 1) Restore the public profile (idempotent via ON CONFLICT)
INSERT INTO public.users (id, email, full_name, role, status)
SELECT au.id, au.email, 'Tuyishime Honore', 'teacher', 'active'
FROM auth.users au
WHERE au.email = LOWER('<EMAIL>')
ON CONFLICT (id) DO UPDATE
  SET full_name = EXCLUDED.full_name,
      email     = EXCLUDED.email,
      role      = EXCLUDED.role,
      status    = EXCLUDED.status;

-- 2) Restore the teachers row (truly idempotent, skips if present)
DO $$
DECLARE
  v_uid  uuid;
  v_code text;
BEGIN
  SELECT id INTO v_uid FROM auth.users WHERE email = LOWER('<EMAIL>');

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No Auth user found for <EMAIL> — nothing restored.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.teachers WHERE user_id = v_uid) THEN
    RAISE NOTICE 'teachers row already exists for <EMAIL> — nothing to do.';
  ELSE
    -- Pick the next free 11-digit teacher code (unique).
    SELECT lpad((COALESCE(MAX(teacher_code::bigint), 54100000000) + 1)::text, 11, '0')
      INTO v_code
      FROM public.teachers;

    INSERT INTO public.teachers (user_id, teacher_code, full_name, email, phone, status)
    VALUES (v_uid, v_code, 'Tuyishime Honore', '<EMAIL>', '<PHONE>', 'active');

    RAISE NOTICE 'Teacher row created. Assigned code: %  (use Teachers page to edit it if needed).', v_code;
  END IF;
END $$;

-- 3) Confirm both rows restored
SELECT u.id, u.email, u.full_name, u.role, u.status,
       t.teacher_code, t.phone AS teacher_phone, t.status AS teacher_status
FROM public.users u
LEFT JOIN public.teachers t ON t.user_id = u.id
WHERE u.email = LOWER('<EMAIL>');

-- Run COMMIT; after confirming output. (Use ROLLBACK if anything looks wrong.)
COMMIT;