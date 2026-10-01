-- ============================================================================
-- RMS — FULL SYSTEM CRUD PERMISSIONS MIGRATION
-- ----------------------------------------------------------------------------
-- Paste this script into the Supabase SQL Editor to grant full CRUD
-- (Create, Read, Update, Delete) permissions on all tables to anon & authenticated.
-- ============================================================================

-- 1) Drop all existing policies
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

-- 2) Enable Row Level Security on all tables
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

-- 3) Install unrestricted ALL (CRUD) policies for every table
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

-- 4) Grant full privileges to anon and authenticated roles
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO anon, authenticated;

-- 5) Verify permissions and RLS status
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
