-- ==============================================================================
-- RMS-MIS: POST-ASSESSMENT REPORTS RLS ENFORCEMENT
-- Enforces permissions for teachers at the database layer (RLS), ensuring they 
-- can only read assessments, marks, and learners for classes/subjects they are 
-- assigned to (via teacher_assignments) or assessments they authored.
-- ==============================================================================

-- 1. Enable RLS on core tables
ALTER TABLE assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE learners ENABLE ROW LEVEL SECURITY;

-- 2. Clean up existing read policies that might be too permissive for teachers
DROP POLICY IF EXISTS "Enable read access for all users" ON assessments;
DROP POLICY IF EXISTS "Enable read access for all users" ON marks;
DROP POLICY IF EXISTS "Enable read access for all users" ON learners;
DROP POLICY IF EXISTS "Teachers can view assigned assessments" ON assessments;
DROP POLICY IF EXISTS "Teachers can view marks for assigned classes" ON marks;
DROP POLICY IF EXISTS "Teachers can view learners for assigned classes" ON learners;

-- 3. ASSESSMENTS TABLE RLS
-- Admins/DOS can read everything.
CREATE POLICY "Admins can read all assessments" ON assessments
FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND (role = 'admin' OR role = 'dos'))
);

-- Teachers can read assessments if they authored them, OR if they are assigned to the class & subject.
CREATE POLICY "Teachers can read assigned assessments" ON assessments
FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'teacher')
  AND (
    teacher_id = (SELECT id FROM teachers WHERE user_id = auth.uid() LIMIT 1)
    OR EXISTS (
      SELECT 1 FROM teacher_assignments ta 
      WHERE ta.teacher_id = (SELECT id FROM teachers WHERE user_id = auth.uid() LIMIT 1)
      AND ta.class_id = assessments.class_id 
      AND ta.subject_id = assessments.subject_id
    )
  )
);

-- 4. MARKS TABLE RLS
-- Admins/DOS can read all marks.
CREATE POLICY "Admins can read all marks" ON marks
FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND (role = 'admin' OR role = 'dos'))
);

-- Teachers can read marks if the mark belongs to an assessment they have access to.
CREATE POLICY "Teachers can read marks for accessible assessments" ON marks
FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'teacher')
  AND EXISTS (
    SELECT 1 FROM assessments a 
    WHERE a.id = marks.assessment_id 
    AND (
      a.teacher_id = (SELECT id FROM teachers WHERE user_id = auth.uid() LIMIT 1)
      OR EXISTS (
        SELECT 1 FROM teacher_assignments ta 
        WHERE ta.teacher_id = (SELECT id FROM teachers WHERE user_id = auth.uid() LIMIT 1)
        AND ta.class_id = a.class_id 
        AND ta.subject_id = a.subject_id
      )
    )
  )
);

-- 5. LEARNERS TABLE RLS
-- Admins/DOS can read all learners.
CREATE POLICY "Admins can read all learners" ON learners
FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND (role = 'admin' OR role = 'dos'))
);

-- Teachers can read learners if the learner belongs to a class they are assigned to.
CREATE POLICY "Teachers can read learners in assigned classes" ON learners
FOR SELECT USING (
  EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'teacher')
  AND EXISTS (
    SELECT 1 FROM teacher_assignments ta 
    WHERE ta.teacher_id = (SELECT id FROM teachers WHERE user_id = auth.uid() LIMIT 1)
    AND ta.class_id = learners.class_id
  )
);
