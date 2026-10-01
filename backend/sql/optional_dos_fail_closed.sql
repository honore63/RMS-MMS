-- ============================================================================
-- OPTIONAL — make DOS education level fail-closed
-- ============================================================================
-- !! DO NOT RUN UNTIL rms_dos_level_audit() SHOWS EVERY DOS ROW AS
--    "OK - isolated to PRIMARY" or "OK - isolated to SECONDARY" !!
--
-- Today a DOS account whose users.education_level is NULL is treated as a
-- whole-school administrator and can read/write BOTH levels. This script
-- removes that fallback: a DOS with a missing or invalid level gets no
-- level-specific access at all.
--
-- Run backend/sql/deployment_pending.sql block 7b first and paste the result if
-- you are unsure. To assign a level to a specific account first:
--
--   UPDATE public.users SET education_level = 'PRIMARY'   WHERE email = '...';
--   UPDATE public.users SET education_level = 'SECONDARY' WHERE email = '...';
--
-- All statements are idempotent.
-- ============================================================================


-- ============================================================================
-- STEP 1 — Hard fail on an unusable level
-- rms_dos_education_level() previously returned the raw column, so a NULL or
-- misspelt value silently behaved like "global". It now returns NULL for any
-- value that is not exactly PRIMARY or SECONDARY, which the helpers below
-- treat as "no access".
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rms_dos_education_level()
RETURNS TEXT LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN upper(u.education_level) IN ('PRIMARY', 'SECONDARY') THEN upper(u.education_level)
    ELSE NULL
  END
  FROM public.users u
  WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active';
$fn$;


-- ============================================================================
-- STEP 2 — Unscoped means "no level access", not "all levels"
-- Previously:  WHEN rms_dos_education_level() IS NULL THEN true   (allow all)
-- Now:         a NULL level falls through to ELSE false            (deny all)
-- Non-DOS callers (teachers, headteachers) are still unrestricted here; their
-- visibility is governed by the assignment-scoped policies elsewhere.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Secondary', 'Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_teacher(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level IS NULL OR p_level = 'PRIMARY' OR p_level = 'BOTH'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IS NULL OR p_level = 'SECONDARY' OR p_level = 'BOTH'
    ELSE false
  END;
$fn$;


-- ============================================================================
-- STEP 3 — Re-verify
-- Expect every active DOS to read "OK - isolated to ...".
-- ============================================================================
SELECT * FROM public.rms_dos_level_audit();

-- Rollback: re-apply the permissive variants from backend/sql/database.sql
-- (functions rms_dos_education_level, rms_dos_can_level, rms_dos_can_subject,
-- rms_dos_can_teacher) to restore whole-school access for NULL-level DOS.
