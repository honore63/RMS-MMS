-- =====================================================
-- MIGRATION: ENABLE RLS ON LEARNERS TABLE (OPTIONAL)
-- Run this when you are ready to re-enable RLS.
-- Note: The base schema currently disables RLS to avoid
-- 500 recursion errors. This script first removes old policies,
-- enables RLS, then creates policies for DOS admin and
-- teacher read-only access to assigned classes only.
-- =====================================================

-- 1. Drop old learner policies
DROP POLICY IF EXISTS "DOS can manage learners" ON learners;
DROP POLICY IF EXISTS "Teachers can view learners in assigned classes" ON learners;

-- 2. Enable RLS on the learners table
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;

-- 3. DOS / admin users can perform all learner operations
CREATE POLICY "DOS can manage learners" ON learners
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'dos'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'dos'
    )
  );

-- 4. Teachers may SELECT learners only in classes they are assigned to
CREATE POLICY "Teachers can view learners in assigned classes" ON learners
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users u
      JOIN teachers t ON t.user_id = u.id
      JOIN teacher_assignments ta ON ta.teacher_id = t.id
      WHERE u.id = auth.uid()
        AND u.role = 'teacher'
        AND ta.class_id = learners.class_id
    )
  );

-- Verify
SELECT tablename, policyname FROM pg_policies WHERE tablename = 'learners';
