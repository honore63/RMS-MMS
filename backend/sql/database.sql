-- ============================================================================
-- RMS — MASTER SETUP SCRIPT (COMBINED)
-- ----------------------------------------------------------------------------
-- This is a single consolidated file combining all previous RMS schema files,
-- migrations, documents storage, indexes, auth links, and RLS policies.
-- Safe to run multiple times (idempotent).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- 1) SCHEMA (Base Tables)
-- ============================================================================

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
  stream TEXT,
  class_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL
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
  academic_year_id UUID REFERENCES academic_years(id), -- From availability migration
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
  roster_learner_ids JSONB, -- From availability migration
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
  assessment_roster_policy TEXT NOT NULL DEFAULT 'auto_add' CHECK (assessment_roster_policy IN ('auto_add', 'freeze_on_submit')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  file_name TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_size INTEGER,
  storage_path TEXT NOT NULL,
  learner_id UUID REFERENCES public.learners(id) ON DELETE CASCADE,
  uploaded_by UUID,
  uploaded_by_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- 2) ENSURE MISSING COLUMNS (Backward Compatibility Backfill)
-- ============================================================================

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_status_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'locked'));
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS roster_learner_ids JSONB;

-- School settings expansion backfill
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
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS assessment_roster_policy TEXT NOT NULL DEFAULT 'auto_add'
  CHECK (assessment_roster_policy IN ('auto_add', 'freeze_on_submit'));

ALTER TABLE learners ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);

-- ============================================================================
-- 3) ENABLE RLS
-- ============================================================================
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

-- ============================================================================
-- 4) DROP ALL existing legacy policies (clean slate, recursion-free)
-- ============================================================================
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

-- ============================================================================
-- 5) INSTALL CRUD POLICIES & GRANTS OVERRIDE
-- ============================================================================

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

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON FUNCTIONS TO anon, authenticated;

-- ============================================================================
-- 6) SEED REFERENCE DATA (Idempotent)
-- ============================================================================
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
  ('P6A','P6','A'), ('P6B','P6','B'),
  ('S1','S1',NULL),
  ('S2','S2',NULL),
  ('S3','S3',NULL),
  ('S4 – Stream 1','S4','Stream 1'),
  ('S4 – Stream 2','S4','Stream 2'),
  ('S5 – Stream 1','S5','Stream 1'),
  ('S5 – Stream 2','S5','Stream 2'),
  ('S6 – MEG','S6','MEG'),
  ('S6 – PCM','S6','PCM'),
  ('S6 – MCE','S6','MCE')
) AS v (name, level, stream)
WHERE NOT EXISTS (SELECT 1 FROM classes c WHERE c.name = v.name);

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

-- ============================================================================
-- 7) PERFORMANCE INDEXES
-- ============================================================================
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
CREATE INDEX IF NOT EXISTS idx_learners_class_status ON learners(class_id, status);

-- ============================================================================
-- 8) STORAGE SETUP (Documents Bucket)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS rms_documents_select ON storage.objects;
DROP POLICY IF EXISTS rms_documents_insert ON storage.objects;
DROP POLICY IF EXISTS rms_documents_update ON storage.objects;
DROP POLICY IF EXISTS rms_documents_delete ON storage.objects;

CREATE POLICY rms_documents_select ON storage.objects FOR SELECT USING (bucket_id = 'documents');
CREATE POLICY rms_documents_insert ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'documents');
CREATE POLICY rms_documents_update ON storage.objects FOR UPDATE USING (bucket_id = 'documents') WITH CHECK (bucket_id = 'documents');
CREATE POLICY rms_documents_delete ON storage.objects FOR DELETE USING (bucket_id = 'documents');

GRANT ALL ON storage.objects TO anon, authenticated;
GRANT ALL ON storage.buckets TO anon, authenticated;

-- ============================================================================
-- 9) HELPER FUNCTIONS
-- ============================================================================
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
