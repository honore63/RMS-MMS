-- ============================================================================
-- FIX: dos2@rukara.edu "Database error querying schema" on login
-- ============================================================================
-- PROBLEM:
--   The dos2@rukara.edu account was created by directly INSERTing into
--   auth.users. Newer Supabase (GoTrue v2+) requires a matching row in
--   auth.identities. Without it, signInWithPassword returns a 500 error:
--   "Database error querying schema".
--
-- SOLUTION:
--   1. Ensure the auth.users row exists, has the correct password hash,
--      and email_confirmed_at is set.
--   2. Create the missing auth.identities row.
--   3. Confirm the public.users row is correct.
--
-- Run this entire script in:  Supabase Dashboard → SQL Editor → New Query → Run
-- ============================================================================


-- ============================================================================
-- STEP 1: Diagnose — check current state
-- ============================================================================
-- Run this first to see the current situation (optional diagnostic):
/*
SELECT 'auth.users' AS source, au.id, au.email, au.email_confirmed_at,
       au.created_at, au.encrypted_password IS NOT NULL AS has_password
FROM auth.users au
WHERE au.email IN ('dos@rukara.edu', 'dos2@rukara.edu');

SELECT 'auth.identities' AS source, ai.id, ai.user_id, ai.provider,
       ai.identity_data->>'email' AS identity_email, ai.created_at
FROM auth.identities ai
WHERE ai.user_id IN (SELECT id FROM auth.users WHERE email IN ('dos@rukara.edu', 'dos2@rukara.edu'));

SELECT 'public.users' AS source, u.id, u.email, u.role, u.education_level, u.status
FROM public.users u
WHERE u.email IN ('dos@rukara.edu', 'dos2@rukara.edu');
*/


-- ============================================================================
-- STEP 2: Fix the dos2@rukara.edu account
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_uid uuid;
  v_identity_exists boolean;
BEGIN
  -- ---- Get the auth.users id for dos2 ---------------------------------
  SELECT id INTO v_uid
  FROM auth.users
  WHERE email = 'dos2@rukara.edu'
  LIMIT 1;

  -- If the user doesn't exist in auth.users at all, create it
  IF v_uid IS NULL THEN
    INSERT INTO auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, confirmation_token,
      is_sso_user
    )
    VALUES (
      '00000000-0000-0000-0000-000000000000',
      gen_random_uuid(),
      'authenticated', 'authenticated',
      'dos2@rukara.edu',
      crypt('dos123', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"email":"dos2@rukara.edu"}',
      now(), now(), '',
      false
    )
    RETURNING id INTO v_uid;

    RAISE NOTICE 'Created auth.users row for dos2@rukara.edu with id: %', v_uid;
  ELSE
    -- User exists — make sure password, confirmation, and metadata are correct
    UPDATE auth.users
    SET
      encrypted_password = crypt('dos123', gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_app_meta_data  = '{"provider":"email","providers":["email"]}'::jsonb,
      raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"email":"dos2@rukara.edu"}'::jsonb,
      is_sso_user        = false,
      updated_at         = now(),
      aud                = 'authenticated',
      role               = 'authenticated'
    WHERE id = v_uid;

    RAISE NOTICE 'Updated auth.users row for dos2@rukara.edu (id: %)', v_uid;
  END IF;

  -- ---- Create the auth.identities row if missing ----------------------
  SELECT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = v_uid AND provider = 'email'
  ) INTO v_identity_exists;

  IF NOT v_identity_exists THEN
    INSERT INTO auth.identities (
      id, user_id, provider, provider_id,
      identity_data, last_sign_in_at, created_at, updated_at
    )
    VALUES (
      v_uid,                  -- id = same as user id
      v_uid,                  -- user_id
      'email',                -- provider
      v_uid::text,            -- provider_id (usually the user UUID as text)
      jsonb_build_object(
        'sub', v_uid::text,
        'email', 'dos2@rukara.edu',
        'email_verified', true,
        'phone_verified', false
      ),
      now(),                  -- last_sign_in_at
      now(),                  -- created_at
      now()                   -- updated_at
    );
    RAISE NOTICE 'Created auth.identities row for dos2@rukara.edu';
  ELSE
    RAISE NOTICE 'auth.identities row already exists for dos2@rukara.edu — OK';
  END IF;

  -- ---- Ensure public.users row exists and is correct -------------------
  INSERT INTO public.users (id, email, full_name, role, education_level, status)
  VALUES (v_uid, 'dos2@rukara.edu', 'DOS Secondary', 'dos', 'SECONDARY', 'active')
  ON CONFLICT (email) DO UPDATE
    SET id              = v_uid,
        full_name       = 'DOS Secondary',
        role            = 'dos',
        education_level = 'SECONDARY',
        status          = 'active';

  RAISE NOTICE 'public.users row confirmed for dos2@rukara.edu';
END $$;


-- ============================================================================
-- STEP 3: Also fix dos@rukara.edu identity (preventive)
-- ============================================================================
DO $$
DECLARE
  v_uid uuid;
  v_identity_exists boolean;
BEGIN
  SELECT id INTO v_uid
  FROM auth.users
  WHERE email = 'dos@rukara.edu'
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE NOTICE 'dos@rukara.edu not found in auth.users — skipping';
    RETURN;
  END IF;

  -- Ensure metadata is correct
  UPDATE auth.users
  SET
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    raw_app_meta_data  = '{"provider":"email","providers":["email"]}'::jsonb,
    raw_user_meta_data = COALESCE(raw_user_meta_data, '{}'::jsonb) || '{"email":"dos@rukara.edu"}'::jsonb,
    is_sso_user        = false,
    updated_at         = now(),
    aud                = 'authenticated',
    role               = 'authenticated'
  WHERE id = v_uid;

  -- Create identity if missing
  SELECT EXISTS (
    SELECT 1 FROM auth.identities
    WHERE user_id = v_uid AND provider = 'email'
  ) INTO v_identity_exists;

  IF NOT v_identity_exists THEN
    INSERT INTO auth.identities (
      id, user_id, provider, provider_id,
      identity_data, last_sign_in_at, created_at, updated_at
    )
    VALUES (
      v_uid, v_uid, 'email', v_uid::text,
      jsonb_build_object(
        'sub', v_uid::text,
        'email', 'dos@rukara.edu',
        'email_verified', true,
        'phone_verified', false
      ),
      now(), now(), now()
    );
    RAISE NOTICE 'Created auth.identities row for dos@rukara.edu';
  ELSE
    RAISE NOTICE 'auth.identities row already exists for dos@rukara.edu — OK';
  END IF;
END $$;


-- ============================================================================
-- STEP 4: Reload PostgREST schema cache
-- ============================================================================
NOTIFY pgrst, 'reload schema';


-- ============================================================================
-- STEP 5: VERIFICATION — run to confirm everything is correct
-- ============================================================================
SELECT '1. auth.users' AS check_step, au.id, au.email,
       au.email_confirmed_at IS NOT NULL AS email_confirmed,
       au.encrypted_password IS NOT NULL AS has_password,
       au.is_sso_user,
       au.aud, au.role AS auth_role
FROM auth.users au
WHERE au.email IN ('dos@rukara.edu', 'dos2@rukara.edu')
ORDER BY au.email;

SELECT '2. auth.identities' AS check_step, ai.user_id,
       ai.provider, ai.identity_data->>'email' AS identity_email
FROM auth.identities ai
WHERE ai.user_id IN (SELECT id FROM auth.users WHERE email IN ('dos@rukara.edu', 'dos2@rukara.edu'))
ORDER BY ai.identity_data->>'email';

SELECT '3. public.users' AS check_step, u.id, u.email, u.role,
       u.education_level, u.status
FROM public.users u
WHERE u.email IN ('dos@rukara.edu', 'dos2@rukara.edu')
ORDER BY u.email;
