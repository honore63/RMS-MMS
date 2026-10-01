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
--   Run blocks 1-7 in order. Each block is self-contained; a failure in one
--   block does not invalidate the others.
--
-- REMOVED: the password_recovery_attempts table (and the /api/auth/recover
-- endpoint that used it) has been deleted from the project, so the
-- self-service password-recovery flow no longer exists.
-- ============================================================================


-- ============================================================================
-- BLOCK 1 — DOS level helpers
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
-- BLOCK 2 — Teacher table read/write policies
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
-- BLOCK 3 — Cross-level write guards
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
-- BLOCK 4 — DOS delete policy (teacher deletion work)
-- ============================================================================
DROP POLICY IF EXISTS rms_account_users_delete ON public.users;
CREATE POLICY rms_account_users_delete ON public.users FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos'
    AND id <> auth.uid()
    AND role = 'teacher'
    AND public.rms_account_can_access_user(id));


-- ============================================================================
-- BLOCK 5 — Atomic teacher deletion
-- Removes the teacher, their login row, assignments, assessments and every
-- mark recorded against them, in one transaction.
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
-- BLOCK 6 — RESTORE STANDARD ASSESSMENT TYPES
-- The 13 standard assessment types are seeded by the master script. If the
-- live database was built without that seed section the table is empty, the
-- Assessment Types page reports nothing available, and assessment creation has
-- no category to choose. This block is idempotent (ON CONFLICT DO UPDATE).
-- Run it whenever SELECT count(*) FROM assessment_types returns 0.
-- ============================================================================
INSERT INTO assessment_types (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status, period_hint, is_standard)
SELECT * FROM (VALUES
  ('Weekly Test','WKT','Weekly classroom test',10,NULL::NUMERIC,TRUE,1,'active','week',TRUE),
  ('Monthly Test','MLT','Monthly assessment',20,NULL::NUMERIC,TRUE,2,'active','month',TRUE),
  ('Beginning of Term Exam','BOT','Beginning of term examination',50,NULL::NUMERIC,TRUE,3,'active','term',TRUE),
  ('Mid-Term Exam','MTE','Mid-term examination',50,NULL::NUMERIC,TRUE,4,'active','term',TRUE),
  ('End of Term Exam','EOT','End of term examination',100,NULL::NUMERIC,TRUE,5,'active','term',TRUE),
  ('Quiz','QUIZ','Short quiz',20,NULL::NUMERIC,TRUE,6,'active',NULL,TRUE),
  ('Assignment','ASGMT','Take-home assignment',20,NULL::NUMERIC,TRUE,7,'active',NULL,TRUE),
  ('Practical','PRAC','Practical assessment',30,NULL::NUMERIC,TRUE,8,'active',NULL,TRUE),
  ('Class Exercise','CEXE','Class exercise',10,NULL::NUMERIC,TRUE,9,'active',NULL,TRUE),
  ('Homework','HW','Homework',10,NULL::NUMERIC,TRUE,10,'active',NULL,TRUE),
  ('Oral','ORAL','Oral assessment',10,NULL::NUMERIC,TRUE,11,'active',NULL,TRUE),
  ('End of Unit','EOU','End-of-unit assessment',30,NULL::NUMERIC,TRUE,12,'active','unit',TRUE),
  ('Other','OTHER','Other assessment',30,NULL::NUMERIC,TRUE,13,'active','other',TRUE)
) AS v (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status, period_hint, is_standard)
ON CONFLICT (name) DO UPDATE SET code = EXCLUDED.code, description = EXCLUDED.description,
  default_maximum_mark = EXCLUDED.default_maximum_mark, display_order = EXCLUDED.display_order,
  status = EXCLUDED.status, period_hint = EXCLUDED.period_hint, is_standard = EXCLUDED.is_standard;


-- ============================================================================
-- BLOCK 7 — REPAIR MISSING TABLE GRANTS (fixes HTTP 403)
-- Symptom: reading a table returns 403 from PostgREST, e.g.
--   .../rest/v1/assessment_types?select=*  ->  403
-- and the page shows "no data" because RLS/grants deny the read entirely.
-- Cause: "GRANT ... ON ALL TABLES IN SCHEMA" is a snapshot that only covers
-- tables existing when it ran, so any table created later has no privilege for
-- the authenticated role.
--
-- 7a. FIND the affected tables (run this first, read-only).
-- ============================================================================
-- SELECT c.relname AS table_missing_select_grant
-- FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
--   AND NOT has_table_privilege('authenticated', c.oid, 'SELECT')
-- ORDER BY 1;

-- 7b. APPLY. Grants the authenticated role full CRUD on every table in public
--      (RLS still decides which ROWS each role may see, so this does not widen
--      data visibility), and makes it automatic for tables created later.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;

-- 7c. Re-apply the narrower grants the master intends for a few tables, so
--      7b does not leave them wider than designed.
GRANT SELECT, INSERT ON public.messages TO authenticated;
REVOKE ALL ON TABLE public.messages FROM anon;
REVOKE ALL ON TABLE public.message_attachments FROM anon;

-- 7d. Targeted alternative if you only want assessment_types fixed:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.assessment_types TO authenticated;

-- 7e. VERIFY: must return 0 rows.
-- SELECT c.relname FROM pg_class c
-- JOIN pg_namespace n ON n.oid = c.relnamespace
-- WHERE n.nspname = 'public' AND c.relkind = 'r'
--   AND NOT has_table_privilege('authenticated', c.oid, 'SELECT');


-- ============================================================================
-- BLOCK 8 — VERIFY (read-only)
-- Run these after blocks 1-7.
-- ============================================================================

-- 6a. Did every object land? Expect 0 rows.
-- (cast to text: to_regclass and to_regprocedure return different types)
SELECT 'missing objects' AS check_name, count(*) AS problems FROM (
  SELECT to_regprocedure('public.rms_dos_level_audit()')::text AS o
  UNION ALL SELECT to_regprocedure('public.rms_dos_can_teacher_level(text)')::text
  UNION ALL SELECT to_regprocedure('public.rms_delete_teacher(uuid)')::text
  UNION ALL SELECT to_regprocedure('public.rms_release_fk_refs(regclass,uuid)')::text
) x WHERE o IS NULL;

-- 6b. DOS accounts and their level. READ THIS BEFORE ANYTHING ELSE.
SELECT * FROM public.rms_dos_level_audit();

-- 6c. Every restrictive level guard should still be installed (expect 8 rows).
SELECT tablename, policyname FROM pg_policies
WHERE policyname = 'rms_dos_level_guard' ORDER BY tablename;

-- 6d. Assessment types must be present (expect 13 or more).
SELECT count(*) AS assessment_types_total FROM public.assessment_types;
SELECT name, code, default_maximum_mark, status FROM public.assessment_types ORDER BY display_order;


-- ============================================================================
-- BLOCK 9 — OPTIONAL, DO NOT RUN YET
-- Fail-closed behaviour (a DOS with NULL/invalid education_level gets no
-- level-specific access) lives in a separate file on purpose:
--   backend/sql/optional_dos_fail_closed.sql
-- Only run it after 8b shows every DOS row reading "OK - isolated to ...".
-- ============================================================================
