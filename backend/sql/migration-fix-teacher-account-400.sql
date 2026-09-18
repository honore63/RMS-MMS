-- ============================================================
-- FIX: HTTP 400 on /rest/v1/teachers and /rest/v1/academic_years
-- Cause: legacy RLS policies referencing columns/relations that do
-- not exist on the deployed tables -> PostgREST schema cache error
-- -> HTTP 400.
--
-- Fix: bring RLS + policies back to the known-good state defined
-- in database.sql (wipe legacy policies, install clean CRUD
-- policies + grants). Safe to run again; idempotent (each policy
-- is dropped before being recreated).
-- Run in Supabase → SQL Editor.
-- ============================================================

-- 0) Ensure the teacher account columns exist (idempotent)
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS gender TEXT CHECK (gender IN ('M','F')),
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- 1) Enable RLS everywhere (already on for most tables; idempotent)
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learners            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scales      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents           ENABLE ROW LEVEL SECURITY;

-- 2) Drop ALL legacy policies (clean slate, recursion-free)
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- 3) Install clean CRUD policies (matches database.sql exactly)
--    Each is dropped first so re-running never errors with "already exists".
DROP POLICY IF EXISTS rms_users_all               ON public.users;
DROP POLICY IF EXISTS rms_teachers_all            ON public.teachers;
DROP POLICY IF EXISTS rms_learners_all            ON public.learners;
DROP POLICY IF EXISTS rms_classes_all             ON public.classes;
DROP POLICY IF EXISTS rms_subjects_all            ON public.subjects;
DROP POLICY IF EXISTS rms_academic_years_all      ON public.academic_years;
DROP POLICY IF EXISTS rms_terms_all               ON public.terms;
DROP POLICY IF EXISTS rms_teacher_assignments_all ON public.teacher_assignments;
DROP POLICY IF EXISTS rms_assessments_all         ON public.assessments;
DROP POLICY IF EXISTS rms_marks_all               ON public.marks;
DROP POLICY IF EXISTS rms_grading_scales_all      ON public.grading_scales;
DROP POLICY IF EXISTS rms_school_settings_all     ON public.school_settings;
DROP POLICY IF EXISTS rms_notifications_all       ON public.notifications;
DROP POLICY IF EXISTS rms_audit_logs_all          ON public.audit_logs;
DROP POLICY IF EXISTS rms_documents_all           ON public.documents;

CREATE POLICY rms_users_all               ON public.users               FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_teachers_all            ON public.teachers            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_learners_all            ON public.learners            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_classes_all             ON public.classes             FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_subjects_all            ON public.subjects            FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_academic_years_all      ON public.academic_years      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_terms_all               ON public.terms               FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_teacher_assignments_all ON public.teacher_assignments FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_assessments_all         ON public.assessments         FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_marks_all               ON public.marks               FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_grading_scales_all      ON public.grading_scales      FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_school_settings_all     ON public.school_settings     FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_notifications_all       ON public.notifications       FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_audit_logs_all          ON public.audit_logs          FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_documents_all           ON public.documents           FOR ALL USING (true) WITH CHECK (true);

-- 4) Grants so anon/authenticated can read & write
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public   TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO anon, authenticated;

-- 5) Sanity check: your live teachers policies should be exactly:
--    rms_teachers_all (FOR ALL USING true)
SELECT tablename, policyname, cmd, qual
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;