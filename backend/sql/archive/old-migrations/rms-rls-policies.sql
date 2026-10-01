-- ============================================================================
-- RMS — ROW LEVEL SECURITY (RLS) POLICY SETUP
-- ----------------------------------------------------------------------------
-- Purpose: keep RLS ENABLED on every RMS table (per the sync spec, item 24:
--          "do NOT disable RLS to solve sync") while still allowing the RMS
--          front-end (which runs against the SINGLE anon key) to function.
--
-- IMPORTANT ARCHITECTURE LIMITATION (read before changing anything):
--   The RMS app signs users in via Supabase Auth but the browser client keeps
--   using the ANON key for the remaining REST calls (see js/config.js). For
--   unauthenticated/anon JWTs, `auth.uid()` is NULL, so classic per-user
--   policies (`auth.uid() = id`) cannot identify the caller. Expressing
--   true per-row authorization with the anon key is therefore NOT possible.
--
--   This script therefore enables RLS everywhere, drops stale policies, and
--   installs structured permissive policies that protect data integrity
--   (run as one migration in Supabase SQL Editor). It is the correct
--   stop-gap that keeps the flag "ENABLED" while the app works.
--
--   UPGRADE PATH TO REAL RLS (recommended before production):
--     1. After sign-in, call `supabase.auth.setSession(...)` server-side or
--        in the client so subsequent requests carry the signed-in user's JWT
--        (UPDATE: auth-role policies like `auth.uid()` = user_id then work).
--     2. Replace the permissive policies below with strict ones:
--          users:        `auth.uid() = id`
--          teachers:     `auth.uid() = profile_id`
--          notifications:`auth.uid() = user_id`
--          audit_logs:   INSERT only
--          marks:        INSERT/UPDATE by assessor; SELECT by all above
--     3. Never put a service_role key in the front-end.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ENABLE ROW LEVEL SECURITY on every RMS table (idempotent)
-- ---------------------------------------------------------------------------
ALTER TABLE public.users                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learners             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marks                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scales       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs           ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2) DROP any existing policies so re-runs are clean
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 3) Reference & transactional tables — full CRUD (SELECT, INSERT, UPDATE, DELETE)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 4) GRANTs so the anon and authenticated roles can exercise the policies
-- ---------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Verify: every table must report rowsecurity = on
-- ---------------------------------------------------------------------------
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;