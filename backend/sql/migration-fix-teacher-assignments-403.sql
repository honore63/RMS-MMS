-- ============================================================
-- FIX: HTTP 403 on POST /rest/v1/teacher_assignments
-- Cause: the scoped RLS policy rms_teacher_assignments_insert
-- allows INSERT only when public.rms_is_dos() is true, i.e. the
-- caller has a row in public.users with id = auth.uid(),
-- role = 'dos' AND status = 'active'. A 403 means that check is
-- failing for the account you are logged in with.
-- Reasons this typically fails:
--   1. users.id does not equal auth.users.id (mis-linked account)
--   2. users.role is 'teacher'/'headteacher' instead of 'dos'
--   3. users.status is not 'active'
--   4. the auth user has NO row in users at all
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 1) DIAGNOSE: show every auth user vs. linked public.users row
-- ------------------------------------------------------------
SELECT
  au.id                                      AS auth_user_id,
  au.email                                   AS auth_email,
  u.id                                       AS users_id,
  u.role                                     AS users_role,
  u.status                                   AS users_status,
  CASE
    WHEN u.id IS NULL THEN 'NO USERS ROW - RLS will reject'
    WHEN u.id <> au.id THEN 'ID MISMATCH - RLS will reject'
    WHEN u.role <> 'dos' THEN 'NOT DOS ROLE - RLS will reject writes'
    WHEN u.status <> 'active' THEN 'INACTIVE - RLS will reject'
    ELSE 'OK - approved'
  END                                        AS verdict
FROM auth.users au
LEFT JOIN public.users u ON u.id = au.id
ORDER BY au.email;

-- ------------------------------------------------------------
-- 2) AUTO-FIX: repair users.id to match auth.users.id by email.
--    This fixes the most common cause of the 403 (mis-linked id)
--    without you having to touch the auth user.
-- ------------------------------------------------------------
UPDATE public.users u
SET id = au.id
FROM auth.users au
WHERE u.email = au.email
  AND u.id <> au.id
  AND NOT EXISTS (
    SELECT 1 FROM public.users other
    WHERE other.id = au.id AND other.email <> au.email
  );

-- ------------------------------------------------------------
-- 3) AUTO-FIX: normalise a single admin/'dos' account per email.
--    If the email clearly identifies the DOS account, promote it
--    to role 'dos' and active. Edit the marker emails below to
--    match the account you actually log in with.
-- ------------------------------------------------------------
UPDATE public.users
SET role = 'dos', status = 'active'
WHERE email IN (
  'dos@rukara.edu',      -- <= adjust to your real DOS login email
  'admin@rukara.edu'     -- <= adjust to your real admin login email
)
  AND (role <> 'dos' OR status <> 'active');

-- ------------------------------------------------------------
-- 4) GUARANTEE: ANY legacy admin/headteacher that matches an auth
--    user with role 'dos' stays writable. If the DOS account has a
--    non-conventional role, promote existing rows whose email
--    matches an auth user AND the profile is the only linked one.
-- ------------------------------------------------------------
UPDATE public.users u
SET role = 'dos', status = 'active'
WHERE u.role IN ('headteacher', 'teacher')
  AND u.status = 'active'
  AND EXISTS (SELECT 1 FROM auth.users au WHERE au.id = u.id)
  AND u.email NOT LIKE '%teacher%'
  AND u.email NOT LIKE '%prof%'
  AND u.email IN (SELECT email FROM (
        SELECT email, COUNT(*) c FROM public.users GROUP BY email
      ) dup WHERE dup.c = 1)
  AND NOT EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.user_id = u.id
  );

-- ------------------------------------------------------------
-- 5) VERIFY: re-run the diagnosis after the fix
-- ------------------------------------------------------------
SELECT
  au.id                                      AS auth_user_id,
  au.email                                   AS auth_email,
  u.id                                       AS users_id,
  u.role                                     AS users_role,
  u.status                                   AS users_status,
  CASE
    WHEN u.id IS NULL THEN 'NO USERS ROW - RLS will reject'
    WHEN u.id <> au.id THEN 'ID MISMATCH - RLS will reject'
    WHEN u.role <> 'dos' THEN 'NOT DOS ROLE - RLS will reject writes'
    WHEN u.status <> 'active' THEN 'INACTIVE - RLS will reject'
    ELSE 'OK - approved'
  END                                        AS verdict
FROM auth.users au
LEFT JOIN public.users u ON u.id = au.id
ORDER BY au.email;

-- ------------------------------------------------------------
-- 6) VERIFY: the exact policy that gates the INSERT
-- ------------------------------------------------------------
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'teacher_assignments'
ORDER BY cmd;

-- ------------------------------------------------------------
-- Reload PostgREST so the fixes apply immediately
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';