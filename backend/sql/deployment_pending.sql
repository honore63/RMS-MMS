-- ============================================================================
-- RMS-MIS — PENDING PRODUCTION DATABASE CHANGES
-- ============================================================================
-- WHY THIS FILE EXISTS
--   SQL committed to GitHub does NOT execute against the live Supabase project.
--   This file collects every schema change that still has to be applied by hand
--   in the Supabase SQL Editor (Dashboard > SQL Editor > New query > Run).
--
--   It is safe to run more than once: every statement is idempotent
--   (IF NOT EXISTS / OR REPLACE / DROP ... IF EXISTS).
--
--   It intentionally does NOT touch accounts or data - only schema, functions
--   and policies. Nothing here deletes or rewrites school records.
--
-- HOW TO APPLY
--   Run blocks 1-4 in order. Each block is self-contained; a failure in one
--   block does not invalidate the others.
-- ============================================================================


-- ============================================================================
-- BLOCK 1 — Password recovery rate-limit store
-- Without this table /api/auth/recover refuses to issue credentials (HTTP 503)
-- rather than running without abuse protection.
-- ============================================================================
CREATE TABLE IF NOT EXISTS password_recovery_attempts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE password_recovery_attempts ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_recovery_attempts_email ON password_recovery_attempts(email);
-- No RLS policies on purpose: only the service role (server-side) touches it.


-- ============================================================================
-- BLOCK 2 — DOS level helpers
-- rms_dos_can_teacher_level : stops a scoped DOS writing the opposite level
--                             onto a teacher or account record.
-- rms_dos_level_audit       : reports every DOS account and whether its level
--                             is valid (used to decide the fail-closed step).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rms_dos_can_teacher_level(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN p_level IS NULL THEN true
    WHEN upper(p_level) = 'BOTH' OR upper(p_level) = 'ALL' THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN upper(p_level) <> 'SECONDARY'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN upper(p_level) <> 'PRIMARY'
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_level_audit()
RETURNS TABLE(full_name TEXT, email TEXT, education_level TEXT, scope_status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.full_name, u.email, u.education_level,
    CASE
      WHEN u.education_level IS NULL THEN 'GLOBAL - no level assigned (sees whole school)'
      WHEN upper(u.education_level) NOT IN ('PRIMARY', 'SECONDARY') THEN 'INVALID - must be PRIMARY or SECONDARY'
      ELSE 'OK - isolated to ' || upper(u.education_level)
    END
  FROM public.users u
  WHERE u.role = 'dos' AND u.status = 'active'
  ORDER BY u.full_name;
$fn$;

REVOKE ALL ON FUNCTION public.rms_dos_level_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_dos_level_audit() TO authenticated;


-- ============================================================================
-- BLOCK 3 — Teacher table read/write policies
-- The teachers table previously had only RESTRICTIVE policies. A restrictive
-- policy narrows access but never grants it, so a database built purely from
-- the master script resolved zero teachers for every role. These two PERMISSIVE
-- policies restore reads and updates; the existing restrictive policies still
-- cap visibility to the caller's own education level.
-- ============================================================================
DROP POLICY IF EXISTS rms_account_teachers_select ON public.teachers;
CREATE POLICY rms_account_teachers_select ON public.teachers FOR SELECT TO authenticated
  USING (public.rms_account_role() = 'dos' OR user_id = auth.uid());

DROP POLICY IF EXISTS rms_account_teachers_update ON public.teachers;
CREATE POLICY rms_account_teachers_update ON public.teachers FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos' OR user_id = auth.uid())
  WITH CHECK (public.rms_account_role() = 'dos' OR user_id = auth.uid());


-- ============================================================================
-- BLOCK 4 — Cross-level write guards
-- A scoped DOS may create/update a teacher, and may update a managed account,
-- but may never label either with the opposite education level.
-- ============================================================================
DROP POLICY IF EXISTS rms_dos_teacher_level_write ON public.teachers;
CREATE POLICY rms_dos_teacher_level_write ON public.teachers AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_teacher_level(education_level));

DROP POLICY IF EXISTS rms_dos_teacher_level_write_upd ON public.teachers;
CREATE POLICY rms_dos_teacher_level_write_upd ON public.teachers AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_teacher_level(education_level));

DROP POLICY IF EXISTS rms_dos_user_level_write ON public.users;
CREATE POLICY rms_dos_user_level_write ON public.users AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_teacher_level(education_level));


-- ============================================================================
-- BLOCK 5 — DOS delete policy (from the teacher-deletion work)
-- ============================================================================
DROP POLICY IF EXISTS rms_account_users_delete ON public.users;
CREATE POLICY rms_account_users_delete ON public.users FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos'
    AND id <> auth.uid()
    AND role = 'teacher'
    AND public.rms_account_can_access_user(id));


-- ============================================================================
-- BLOCK 6 — Atomic teacher deletion (drops teacher + login + assignments +
-- assessments + every mark recorded against them, in one transaction)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rms_release_fk_refs(p_parent REGCLASS, p_key UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r RECORD;
  v_sql TEXT;
BEGIN
  IF p_key IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col, a.attnotnull AS required
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = p_parent
      AND c.confdeltype IN ('a', 'r')
      AND array_length(c.conkey, 1) = 1
  LOOP
    IF r.required THEN
      v_sql := 'DELETE FROM ' || r.tbl || ' WHERE ' || quote_ident(r.col) || ' = $1';
    ELSE
      v_sql := 'UPDATE ' || r.tbl || ' SET ' || quote_ident(r.col) || ' = NULL WHERE ' || quote_ident(r.col) || ' = $1';
    END IF;
    EXECUTE v_sql USING p_key;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_release_fk_refs(REGCLASS, UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.rms_delete_teacher(p_teacher_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user_id UUID;
  a_id UUID;
BEGIN
  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Teacher not found';
  END IF;
  IF public.rms_account_role() <> 'dos' OR NOT public.rms_is_scoped_dos()
     OR NOT public.rms_teacher_in_scope(p_teacher_id) THEN
    RAISE EXCEPTION 'Not permitted to delete this teacher';
  END IF;
  SELECT t.user_id INTO v_user_id FROM public.teachers t WHERE t.id = p_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher not found';
  END IF;
  FOR a_id IN SELECT a.id FROM public.assessments a WHERE a.teacher_id = p_teacher_id LOOP
    PERFORM public.rms_release_fk_refs('public.assessments'::regclass, a_id);
  END LOOP;
  DELETE FROM public.marks
  WHERE assessment_id IN (SELECT a.id FROM public.assessments a WHERE a.teacher_id = p_teacher_id);
  DELETE FROM public.assessments WHERE teacher_id = p_teacher_id;
  DELETE FROM public.teacher_assignments WHERE teacher_id = p_teacher_id;
  DELETE FROM public.teacher_registration_audit WHERE teacher_id = p_teacher_id;
  UPDATE public.classes SET class_teacher_id = NULL WHERE class_teacher_id = p_teacher_id;
  IF v_user_id IS NOT NULL THEN
    PERFORM public.rms_release_fk_refs('public.users'::regclass, v_user_id);
    DELETE FROM public.users WHERE id = v_user_id;
  END IF;
  PERFORM public.rms_release_fk_refs('public.teachers'::regclass, p_teacher_id);
  DELETE FROM public.teachers WHERE id = p_teacher_id;
  RETURN TRUE;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.rms_delete_teacher(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rms_delete_teacher(UUID) FROM anon;


-- ============================================================================
-- BLOCK 7 — VERIFY (read-only)
-- Run these after blocks 1-6.
-- ============================================================================

-- 7a. Did every object land? Expect 0 rows.
-- (cast to text: to_regclass and to_regprocedure return different types)
SELECT 'missing objects' AS check_name, count(*) AS problems FROM (
  SELECT to_regclass('public.password_recovery_attempts')::text AS o
  UNION ALL SELECT to_regprocedure('public.rms_dos_level_audit()')::text
  UNION ALL SELECT to_regprocedure('public.rms_dos_can_teacher_level(text)')::text
  UNION ALL SELECT to_regprocedure('public.rms_delete_teacher(uuid)')::text
  UNION ALL SELECT to_regprocedure('public.rms_release_fk_refs(regclass,uuid)')::text
) x WHERE o IS NULL;

-- 7b. DOS accounts and their level. READ THIS BEFORE ANYTHING ELSE.
SELECT * FROM public.rms_dos_level_audit();

-- 7c. Every restrictive level guard should still be installed.
SELECT tablename, policyname FROM pg_policies
WHERE policyname = 'rms_dos_level_guard' ORDER BY tablename;


-- ============================================================================
-- BLOCK 8 — OPTIONAL, DO NOT RUN YET
-- Fail-closed behaviour (a DOS with NULL/invalid education_level gets no
-- level-specific access) lives in a separate file on purpose:
--   backend/sql/optional_dos_fail_closed.sql
-- Only run it after 7b shows every DOS row reading "OK - isolated to ...".
-- ============================================================================
