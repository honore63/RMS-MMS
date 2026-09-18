-- =====================================================
-- RMS - FULL SETUP (CONSOLIDATED)
-- Paste this ENTIRE file into Supabase SQL Editor and run.
-- Safe to run multiple times (idempotent).
-- =====================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================
-- TABLES
-- =====================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dos', 'teacher', 'headteacher')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  teacher_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  stream TEXT
);

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'inactive'))
);

CREATE TABLE IF NOT EXISTS terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS learners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  learner_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
  class_id UUID REFERENCES classes(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id),
  term_id UUID REFERENCES terms(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  class_id UUID REFERENCES classes(id),
  subject_id UUID REFERENCES subjects(id),
  teacher_id UUID REFERENCES teachers(id),
  academic_year_id UUID REFERENCES academic_years(id),
  term_id UUID REFERENCES terms(id),
  maximum_mark NUMERIC NOT NULL DEFAULT 30,
  assessment_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
  learner_id UUID REFERENCES learners(id) ON DELETE CASCADE,
  mark NUMERIC,
  percentage NUMERIC,
  grade TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'locked')),
  remark TEXT,
  position INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(assessment_id, learner_id)
);

CREATE TABLE IF NOT EXISTS grading_scales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  minimum_percentage NUMERIC NOT NULL,
  maximum_percentage NUMERIC NOT NULL,
  grade TEXT NOT NULL,
  remark TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  user_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  assessment_id UUID,
  learner_id UUID,
  old_value TEXT,
  new_value TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  type TEXT DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS school_settings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_name TEXT NOT NULL DEFAULT 'Rukara Model School',
  school_address TEXT,
  school_logo TEXT,
  school_phone TEXT,
  school_email TEXT,
  school_website TEXT,
  school_motto TEXT,
  school_code TEXT,
  headteacher_name TEXT,
  headteacher_phone TEXT,
  headteacher_email TEXT,
  deputy_academic_name TEXT,
  deputy_academic_phone TEXT,
  deputy_admin_name TEXT,
  deputy_admin_phone TEXT,
  dos_name TEXT,
  dos_phone TEXT,
  dos_email TEXT,
  logo_url TEXT,
  pass_mark NUMERIC DEFAULT 50,
  ranking_enabled BOOLEAN DEFAULT TRUE,
  decimal_marks_enabled BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- BACKFILL MIGRATIONS (safe for existing older tables)
-- =====================================================

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_status_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'locked'));

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_email TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_website TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_motto TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_code TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS headteacher_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS headteacher_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS headteacher_email TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_academic_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_academic_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_admin_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS deputy_admin_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_name TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_phone TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_email TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS pass_mark NUMERIC;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS ranking_enabled BOOLEAN;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS decimal_marks_enabled BOOLEAN;

-- =====================================================
-- DEFAULT DATA (idempotent)
-- =====================================================

INSERT INTO grading_scales (minimum_percentage, maximum_percentage, grade, remark)
SELECT * FROM (VALUES
  (80, 100, 'A', 'Excellent'),
  (70, 79,  'B', 'Very Good'),
  (60, 69,  'C', 'Good'),
  (50, 59,  'D', 'Satisfactory'),
  (0,  49,  'F', 'Needs Improvement')
) AS v (minimum_percentage, maximum_percentage, grade, remark)
WHERE NOT EXISTS (SELECT 1 FROM grading_scales);

INSERT INTO school_settings (school_name, pass_mark, ranking_enabled, decimal_marks_enabled)
SELECT 'Rukara Model School', 50, TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM school_settings);

INSERT INTO classes (name, level, stream)
SELECT * FROM (VALUES
  ('P1A','P1','A'), ('P1B','P1','B'),
  ('P2A','P2','A'), ('P2B','P2','B'),
  ('P3A','P3','A'), ('P3B','P3','B'),
  ('P4A','P4','A'), ('P4B','P4','B'),
  ('P5A','P5','A'), ('P5B','P5','B'),
  ('P6A','P6','A'), ('P6B','P6','B')
) AS v (name, level, stream)
WHERE NOT EXISTS (SELECT 1 FROM classes);

INSERT INTO subjects (name, code)
SELECT * FROM (VALUES
  ('Mathematics', 'MATH'),
  ('English', 'ENG'),
  ('Kinyarwanda', 'KIN'),
  ('Science and Elementary Technology', 'SET'),
  ('Social and Religious Studies', 'SRS'),
  ('Creative Arts', 'CA'),
  ('Physical Education', 'PE'),
  ('ICT', 'ICT')
) AS v (name, code)
WHERE NOT EXISTS (SELECT 1 FROM subjects);

-- =====================================================
-- PERFORMANCE INDEXES
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_code ON teachers(teacher_code);
CREATE INDEX IF NOT EXISTS idx_learners_class_id ON learners(class_id);
CREATE INDEX IF NOT EXISTS idx_learners_code ON learners(learner_code);
CREATE INDEX IF NOT EXISTS idx_learners_status ON learners(status);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_id ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class_id ON teacher_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject_id ON teacher_assignments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_id ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_class_id ON assessments(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_subject_id ON assessments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status);
CREATE INDEX IF NOT EXISTS idx_marks_assessment_id ON marks(assessment_id);
CREATE INDEX IF NOT EXISTS idx_marks_learner_id ON marks(learner_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_class ON assessments(teacher_id, class_id);
CREATE INDEX IF NOT EXISTS idx_marks_assessment_learner ON marks(assessment_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class_subject ON teacher_assignments(teacher_id, class_id, subject_id);

-- =====================================================
-- DISABLE RLS TO FIX 500 INTERNAL SERVER ERRORS (RECURSION FREE)
-- =====================================================

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

-- =====================================================
-- LINK AUTH USER HELPER (run after creating auth users)
-- =====================================================
CREATE OR REPLACE FUNCTION link_auth_user(p_email TEXT, p_name TEXT, p_role TEXT)
RETURNS TEXT AS $$
DECLARE v_user_id UUID;
BEGIN
  SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
  IF v_user_id IS NULL THEN
    RETURN 'ERROR: Auth user not found. Create in Authentication > Users first.';
  END IF;
  INSERT INTO users (id, email, full_name, role, status)
  VALUES (v_user_id, p_email, p_name, p_role, 'active')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role;
  IF p_role = 'teacher' THEN
    INSERT INTO teachers (user_id, teacher_code, full_name, email, status)
    VALUES (v_user_id, 'T' || LPAD(FLOOR(RANDOM() * 999 + 1)::TEXT, 3, '0'), p_name, p_email, 'active')
    ON CONFLICT (teacher_code) DO NOTHING;
  END IF;
  RETURN 'SUCCESS: User linked - ' || p_email || ' (' || p_role || ')';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- AFTER RUNNING: Disable email confirmation in Supabase Dashboard → Auth → Providers → Email
-- Then use seed-data.sql to create roles, or run link_auth_user for each auth user.
-- =====================================================