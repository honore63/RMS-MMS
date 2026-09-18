-- =====================================================
-- RMS SEED DATA — STEP BY STEP GUIDE
-- =====================================================
-- Run this AFTER database-schema.sql
-- Follow each step in order
-- =====================================================

-- STEP 1: Create the DOS user in Supabase Auth first
-- Go to: Supabase Dashboard → Authentication → Users → Add User
-- Email: dos@rukara.edu
-- Password: dos123
-- Auto Confirm: Yes
-- Then copy the User UUID and paste it below

-- STEP 2: Insert DOS user record
-- Replace 'PASTE_DOS_UUID_HERE' with the actual UUID from Step 1
INSERT INTO users (id, email, full_name, role, status) VALUES
('PASTE_DOS_UUID_HERE', 'dos@rukara.edu', 'Director of Studies', 'dos', 'active');

-- STEP 3: Create a teacher user in Supabase Auth
-- Go to: Supabase Dashboard → Authentication → Users → Add User
-- Email: teacher@rukara.edu
-- Password: teacher123
-- Auto Confirm: Yes
-- Then copy the User UUID and paste it below

-- STEP 4: Insert teacher user and teacher profile
-- Replace 'PASTE_TEACHER_UUID_HERE' with the actual UUID from Step 3
INSERT INTO users (id, email, full_name, role, status) VALUES
('PASTE_TEACHER_UUID_HERE', 'teacher@rukara.edu', 'Teacher Alice', 'teacher', 'active');

INSERT INTO teachers (user_id, teacher_code, full_name, email, phone, status) VALUES
('PASTE_TEACHER_UUID_HERE', 'T001', 'Teacher Alice', 'teacher@rukara.edu', '+250788123456', 'active');

-- STEP 5: Create academic year and terms
INSERT INTO academic_years (name, status) VALUES ('2026-2027', 'active');

INSERT INTO terms (name, academic_year_id)
SELECT 'Term 1', id FROM academic_years WHERE name = '2026-2027';

INSERT INTO terms (name, academic_year_id)
SELECT 'Term 2', id FROM academic_years WHERE name = '2026-2027';

INSERT INTO terms (name, academic_year_id)
SELECT 'Term 3', id FROM academic_years WHERE name = '2026-2027';

-- STEP 6: Assign teacher to P4A Mathematics
INSERT INTO teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, term_id)
SELECT t.id, c.id, s.id, ay.id, te.id
FROM teachers t, classes c, subjects s, academic_years ay, terms te
WHERE t.teacher_code = 'T001'
  AND c.name = 'P4A'
  AND s.code = 'MATH'
  AND ay.name = '2026-2027'
  AND te.name = 'Term 1'
  AND te.academic_year_id = ay.id;

-- STEP 7: Add sample learners
INSERT INTO learners (learner_code, full_name, gender, class_id, status)
SELECT 'L001', 'UWASE Alice', 'F', id, 'active' FROM classes WHERE name = 'P4A';

INSERT INTO learners (learner_code, full_name, gender, class_id, status)
SELECT 'L002', 'MUGISHA Eric', 'M', id, 'active' FROM classes WHERE name = 'P4A';

INSERT INTO learners (learner_code, full_name, gender, class_id, status)
SELECT 'L003', 'IRADUKUNDA Grace', 'F', id, 'active' FROM classes WHERE name = 'P4A';

INSERT INTO learners (learner_code, full_name, gender, class_id, status)
SELECT 'L004', 'NIYONKURU David', 'M', id, 'active' FROM classes WHERE name = 'P4A';

INSERT INTO learners (learner_code, full_name, gender, class_id, status)
SELECT 'L005', 'UMUTONI Claire', 'F', id, 'active' FROM classes WHERE name = 'P4A';

-- STEP 8: Create an assessment
INSERT INTO assessments (name, unit, class_id, subject_id, teacher_id, academic_year_id, term_id, maximum_mark, assessment_date, status)
SELECT 'End-of-Unit Assessment', 'Whole Numbers', c.id, s.id, t.id, ay.id, te.id, 30, '2026-09-01', 'draft'
FROM teachers t, classes c, subjects s, academic_years ay, terms te
WHERE t.teacher_code = 'T001'
  AND c.name = 'P4A'
  AND s.code = 'MATH'
  AND ay.name = '2026-2027'
  AND te.name = 'Term 1'
  AND te.academic_year_id = ay.id;

-- =====================================================
-- DONE! You can now login:
-- DOS: dos@rukara.edu / dos123
-- Teacher: teacher@rukara.edu / teacher123
-- =====================================================
