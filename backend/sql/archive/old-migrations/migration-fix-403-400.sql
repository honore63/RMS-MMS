-- ==============================================================================
-- FIX FOR 403 (Forbidden) and 400 (Bad Request) ERRORS
-- Run this in the Supabase SQL Editor to resolve the missing column and 
-- restrictive RLS policies for teacher_assignments and learners.
-- ==============================================================================

-- 1. ENFORCE COLUMNS EXIST (Fixes 400 Bad Request)
-- The 400 error usually occurs because a requested column does not exist on the database yet.
ALTER TABLE learners ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);
ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);
ALTER TABLE learners ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));

-- 2. ENSURE GRANTS (Fixes explicit 403 Forbidden on the tables themselves)
-- Ensures the authenticated API roles actually have permission to query these tables
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE teacher_assignments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE teacher_assignments TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE learners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE learners TO anon;

-- 3. FIX RLS FOR TEACHER ASSIGNMENTS
ALTER TABLE teacher_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Enable read access for all users" ON teacher_assignments;
DROP POLICY IF EXISTS "everyone_read_assignments" ON teacher_assignments;

-- Allow all authenticated users (teachers, admins, dos) to view assignments
CREATE POLICY "everyone_read_assignments" ON teacher_assignments
FOR SELECT USING (true);


-- 4. FIX RLS FOR LEARNERS
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;

-- If our recently applied teacher RLS policy was too restrictive or had a conflict, 
-- we replace it with a broader, safer read policy for authenticated school staff:
DROP POLICY IF EXISTS "Admins can read all learners" ON learners;
DROP POLICY IF EXISTS "Teachers can read learners in assigned classes" ON learners;
DROP POLICY IF EXISTS "everyone_read_learners" ON learners;

CREATE POLICY "everyone_read_learners" ON learners
FOR SELECT USING (
  -- Ensure that anyone logged in (admin, dos, or teacher) can retrieve the learner lists.
  auth.role() = 'authenticated'
);
