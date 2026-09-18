-- =====================================================
-- FIX: "Not getting the users" — RLS / privileges fix
-- Run this in Supabase SQL Editor. Idempotent (safe).
-- =====================================================

-- 1. DISABLE ROW LEVEL SECURITY on all tables
--    (the main reason anonymous fetchOrCreateProfile INSERT is blocked)
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE teachers DISABLE ROW LEVEL SECURITY;
ALTER TABLE classes DISABLE ROW LEVEL SECURITY;
ALTER TABLE subjects DISABLE ROW LEVEL SECURITY;
ALTER TABLE academic_years DISABLE ROW LEVEL SECURITY;
ALTER TABLE terms DISABLE ROW LEVEL SECURITY;
ALTER TABLE learners DISABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_assignments DISABLE ROW LEVEL SECURITY;
ALTER TABLE assessments DISABLE ROW LEVEL SECURITY;
ALTER TABLE marks DISABLE ROW LEVEL SECURITY;
ALTER TABLE grading_scales DISABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs DISABLE ROW LEVEL SECURITY;
ALTER TABLE notifications DISABLE ROW LEVEL SECURITY;
ALTER TABLE school_settings DISABLE ROW LEVEL SECURITY;

-- 2. Drop any existing RLS policies
DO $$ BEGIN
  DROP POLICY IF EXISTS "Users can view own profile" ON users;
  DROP POLICY IF EXISTS "DOS can view all users" ON users;
  DROP POLICY IF EXISTS "DOS can insert users" ON users;
  DROP POLICY IF EXISTS "DOS can update users" ON users;
  DROP POLICY IF EXISTS "System can insert user profiles" ON users;
  DROP POLICY IF EXISTS "DOS can manage teachers" ON teachers;
  DROP POLICY IF EXISTS "Teachers can view own profile" ON teachers;
  DROP POLICY IF EXISTS "System can insert teachers" ON teachers;
  DROP POLICY IF EXISTS "Authenticated users can view classes" ON classes;
  DROP POLICY IF EXISTS "DOS can manage classes" ON classes;
  DROP POLICY IF EXISTS "Authenticated users can view subjects" ON subjects;
  DROP POLICY IF EXISTS "DOS can manage subjects" ON subjects;
  DROP POLICY IF EXISTS "Authenticated users can view years" ON academic_years;
  DROP POLICY IF EXISTS "DOS can manage years" ON academic_years;
  DROP POLICY IF EXISTS "Authenticated users can view terms" ON terms;
  DROP POLICY IF EXISTS "DOS can manage terms" ON terms;
  DROP POLICY IF EXISTS "DOS can manage learners" ON learners;
  DROP POLICY IF EXISTS "Teachers can view learners in assigned classes" ON learners;
  DROP POLICY IF EXISTS "DOS can manage assignments" ON teacher_assignments;
  DROP POLICY IF EXISTS "Teachers can view own assignments" ON teacher_assignments;
  DROP POLICY IF EXISTS "DOS can manage assessments" ON assessments;
  DROP POLICY IF EXISTS "Teachers can view assigned assessments" ON assessments;
  DROP POLICY IF EXISTS "Teachers can update own assessments" ON assessments;
  DROP POLICY IF EXISTS "DOS can manage all marks" ON marks;
  DROP POLICY IF EXISTS "Teachers can view marks for assigned assessments" ON marks;
  DROP POLICY IF EXISTS "Teachers can insert marks for assigned assessments" ON marks;
  DROP POLICY IF EXISTS "Teachers can update marks for assigned assessments" ON marks;
  DROP POLICY IF EXISTS "Authenticated users can view grading" ON grading_scales;
  DROP POLICY IF EXISTS "DOS can manage grading" ON grading_scales;
  DROP POLICY IF EXISTS "DOS can view all audit logs" ON audit_logs;
  DROP POLICY IF EXISTS "System can insert audit logs" ON audit_logs;
  DROP POLICY IF EXISTS "Users can view own notifications" ON notifications;
  DROP POLICY IF EXISTS "System can insert notifications" ON notifications;
  DROP POLICY IF EXISTS "Users can update own notifications" ON notifications;
  DROP POLICY IF EXISTS "Authenticated users can view settings" ON school_settings;
  DROP POLICY IF EXISTS "DOS can manage settings" ON school_settings;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 3. Grant anon + authenticated roles full access
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated;

-- 4. Verify: RLS should now be OFF for all tables
SELECT tablename, rowsecurity FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;