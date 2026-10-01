-- ============================================================================
-- RMS-MIS — MASTER DATABASE SETUP (database.sql)
-- ----------------------------------------------------------------------------
-- ONE authoritative file to create the complete database from a clean
-- Supabase project. Run the whole file in Supabase SQL Editor.
-- Safe to re-run (idempotent): every object uses IF NOT EXISTS /
-- DROP IF EXISTS / CREATE OR REPLACE / ON CONFLICT guards.
--
-- Consolidated from (all previously under backend/sql/):
--   database.sql (base schema, seed, indexes, storage, link_auth_user)
--   migration-dos-education-level-scope.sql (users.education_level,
--     education_levels, DOS accounts, scope helpers, scoped RLS)
--   migration-enforce-dos-level-visibility.sql (RESTRICTIVE guards)
--   migration-account-isolation.sql (rms_account_* helpers, guard
--     triggers, account RLS, storage lockdown) — authoritative LAST
--   migration-dos-learner-write-access.sql (learner write scope)
--   migration-fix-dos-class-crud.sql + migration-fix-teacher-
--     registration-rls.sql (global-DOS + Both-level refinements)
--   delta-class-derived-teacher-scope.sql (assignment-derived teacher scope)
--   migration-rms-mis-rls.sql + migration-rms-mis-assessment-types-rls-
--     combined.sql (assessment/assignment scoped RLS)
--   migration-rms-mis-assessment-flexibility.sql (assessment_types table,
--     assessments.assessment_type_id/weight/description, unit optional)
--   migration-assessment-types-repair.sql + migration-assessment-
--     standardization-and-mark-conversion.sql (13 standard types,
--     period columns, marks original_* columns)
--   migration-assessment-abbreviations.sql (code backfill + unique index)
--   migration-assignments-multi-subject-per-class.sql (drop blocking
--     unique constraints, composite indexes)
--   migration-curriculum-subjects.sql + migration-subject-levels.sql +
--     migration-rwanda-subjects.sql + migration-full-v2.sql +
--     migration-class-management.sql (subjects catalogue columns,
--     class_subjects, 25 Rwanda subjects, classes year/status)
--   migration-education-level-class-grouping.sql (education_levels seed,
--     classes/subjects backfill)
--   migration-fix-all-404-403-accounts.sql (education_levels fix,
--     teacher_assignments 403 fix, account re-link)
--   migration-fix-dos-marks-visibility.sql (marks select scope)
--   migration-academic-year-management.sql (year lifecycle columns,
--     single-current rule, set_updated_at trigger)
--   migration-fix-academic-year-delete.sql (cascading year FKs)
--   migration-report-card-patch.sql (terms.term_no)
--   migration-grading-system.sql (grading_scales columns + 7-row seed)
--   migration-performance-comments.sql (performance_comments table+seed)
--   migration-import-system.sql + migration-marks-import.sql +
--     migration-report-center.sql (import_history superset, marks RLS)
--   migration-user-codes-account.sql (teacher/learner profile columns,
--     profile-photos bucket) — WITHOUT the 11-digit code CHECKs, per
--     fix-learner-import-code-check.sql (real codes are 12 digits)
--   migration-users-profile-photo.sql (users.profile_photo_url)
--   migration-school-settings-new-fields.sql (report header fields)
--   migration-notification-center.sql (notifications columns/checks,
--     announcements tables, helpers, indexes)
--   migration-communication-center.sql (messages/message_attachments,
--     triggers, policies, cron publisher, realtime)
--   migration-communication-files-and-dos-messages.sql (DOS-initiated
--     messages, message-attachments bucket)
--   migration-teacher-welcome-notifications.sql (email/sms/audit
--     tables, registration triggers)
--   migration-welcome-notifications-function.sql
--     (send_welcome_notifications — service_role only, per
--     account-isolation lockdown)
--   migration-documents.sql (documents table + bucket)
--   migration-report-generation-access.sql + migration-fix-report-
--     rls-recursion.sql (recursion-free report SELECT helpers/policies)
--   migration-fix-teacher-assignments-rls-recursion.sql
--     (rms_report_assignment_visible)
--   migration-fix-teacher-assessment-insert.sql (teacher draft insert)
--   migration-fix-403-400.sql (year/status columns, base grants)
--   migration-report-performance-indexes.sql + migration-report-
--     wizard-indexes.sql (report query indexes)
--
-- FINAL BEHAVIOR (preserved, not changed):
--   * Primary DOS sees/manages ONLY Primary data; Secondary DOS ONLY
--     Lower/Upper Secondary (users.education_level drives scope).
--   * Global DOS (education_level IS NULL) keeps full access.
--   * Teachers are assignment-scoped; teacher visibility is derived
--     from assignments (unassigned teachers are a shared pool).
--   * No 11-digit learner/teacher code format CHECKs (UNIQUE only).
-- ============================================================================

-- ============================================================================
-- 0) EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ============================================================================
-- 1) CORE TABLES (final columns merged from all migrations)
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('dos', 'teacher', 'headteacher')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  education_level TEXT CHECK (education_level IN ('PRIMARY', 'SECONDARY', 'primary', 'secondary', 'all')),
  phone TEXT,
  profile_photo_url TEXT,
  temporary_password_hash TEXT,
  must_change_password BOOLEAN DEFAULT FALSE,
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teachers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  teacher_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  gender TEXT CHECK (gender IN ('M', 'F')),
  date_of_birth DATE,
  address TEXT,
  profile_photo_url TEXT,
  education_level TEXT CHECK (education_level IS NULL OR education_level IN ('PRIMARY', 'SECONDARY', 'BOTH')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_by UUID REFERENCES users(id),
  email_verified BOOLEAN DEFAULT FALSE,
  phone_verified BOOLEAN DEFAULT FALSE,
  must_change_password BOOLEAN DEFAULT FALSE,
  registration_audit_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS education_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  level TEXT NOT NULL,
  stream TEXT,
  class_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  education_level TEXT,
  education_level_id UUID REFERENCES education_levels(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  level TEXT DEFAULT 'Both',
  category TEXT,
  grades TEXT,
  education_level TEXT DEFAULT 'Both'
);

CREATE TABLE IF NOT EXISTS class_subjects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(class_id, subject_id)
);

CREATE TABLE IF NOT EXISTS academic_years (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active', 'upcoming', 'archived', 'inactive')),
  start_year INTEGER,
  end_year INTEGER,
  is_current BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS terms (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  term_no INTEGER DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS learners (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  learner_code TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  gender TEXT NOT NULL CHECK (gender IN ('M', 'F')),
  class_id UUID REFERENCES classes(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  date_of_birth DATE,
  profile_photo_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  class_id UUID REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID REFERENCES subjects(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  term_id UUID REFERENCES terms(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessment_types (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  default_maximum_mark NUMERIC NOT NULL DEFAULT 30,
  weight NUMERIC,
  contributes_to_combined BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  period_hint TEXT CHECK (period_hint IN ('week', 'month', 'term', 'unit', 'other')),
  is_standard BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  unit TEXT,
  class_id UUID REFERENCES classes(id),
  subject_id UUID REFERENCES subjects(id),
  teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE,
  academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE,
  term_id UUID REFERENCES terms(id) ON DELETE SET NULL,
  assessment_type_id UUID REFERENCES assessment_types(id),
  weight NUMERIC,
  description TEXT,
  period_type TEXT CHECK (period_type IN ('week', 'month', 'term', 'unit', 'other')),
  period_value INTEGER,
  period_label TEXT,
  unit_number INTEGER,
  unit_name TEXT,
  display_name TEXT,
  maximum_mark NUMERIC NOT NULL DEFAULT 30,
  converted_from_maximum NUMERIC,
  converted_at TIMESTAMPTZ,
  converted_by UUID,
  assessment_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'locked')),
  rejection_reason TEXT,
  roster_learner_ids JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assessment_id UUID REFERENCES assessments(id) ON DELETE CASCADE,
  learner_id UUID REFERENCES learners(id) ON DELETE CASCADE,
  mark NUMERIC,
  original_mark NUMERIC,
  original_maximum NUMERIC,
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
  grade TEXT NOT NULL UNIQUE,
  descriptor TEXT,
  remark TEXT NOT NULL,
  comment TEXT,
  is_pass BOOLEAN NOT NULL DEFAULT TRUE,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (minimum_percentage >= 0 AND maximum_percentage <= 100 AND minimum_percentage <= maximum_percentage)
);

CREATE TABLE IF NOT EXISTS performance_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_percentage NUMERIC NOT NULL CHECK (min_percentage >= 0 AND min_percentage <= 100),
  max_percentage NUMERIC NOT NULL CHECK (max_percentage >= 0 AND max_percentage <= 100),
  comment TEXT NOT NULL,
  level TEXT DEFAULT 'All',
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
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

CREATE TABLE IF NOT EXISTS import_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  user_name TEXT,
  import_type TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT,
  academic_year_name TEXT,
  term_name TEXT,
  class_name TEXT,
  subject_name TEXT,
  assessment_name TEXT,
  assessment_id UUID,
  total_records INT DEFAULT 0,
  imported INT DEFAULT 0,
  updated INT DEFAULT 0,
  skipped INT DEFAULT 0,
  duplicates INT DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  details JSONB DEFAULT '[]'::jsonb,
  status TEXT DEFAULT 'completed' CHECK (status IN ('completed', 'partial', 'failed')),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  notification_type TEXT DEFAULT 'SYSTEM' CHECK (notification_type IN (
    'MARKS_SUBMITTED', 'MARKS_APPROVED', 'MARKS_REJECTED',
    'ASSESSMENT_CREATED', 'ASSESSMENT_REOPENED', 'ASSESSMENT_LOCKED',
    'ANNOUNCEMENT', 'TIMETABLE', 'MEETING', 'EXAMINATION', 'CPD', 'SYSTEM', 'REPORT', 'info'
  )),
  category TEXT DEFAULT 'system' CHECK (category IN ('marks', 'assessment', 'announcement', 'timetable', 'meeting', 'examination', 'cpd', 'system', 'report', 'important')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('normal', 'important', 'urgent')),
  entity_type TEXT,
  entity_id UUID,
  is_read BOOLEAN DEFAULT FALSE,
  is_archived BOOLEAN DEFAULT FALSE,
  requires_acknowledgement BOOLEAN DEFAULT FALSE,
  acknowledged_at TIMESTAMPTZ,
  action_url TEXT,
  attachment_path TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  read_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general', 'timetable', 'meeting', 'examination', 'assessment', 'academic', 'urgent', 'training', 'cpd', 'administrative', 'other')),
  priority TEXT NOT NULL CHECK (priority IN ('normal', 'important', 'urgent')),
  audience_type TEXT NOT NULL CHECK (audience_type IN ('all', 'primary', 'secondary', 'specific_teacher', 'specific_department', 'specific_class_teacher')),
  education_level TEXT CHECK (education_level IN ('primary', 'secondary', 'all')),
  target_subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  target_class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  target_user_ids UUID[] DEFAULT '{}',
  requires_acknowledgement BOOLEAN DEFAULT FALSE,
  attachment_path TEXT,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'expired'))
);

CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'direct' CHECK (message_type IN ('direct', 'announcement_reply', 'meeting_request', 'timetable_query', 'general')),
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied', 'archived')),
  thread_id UUID NOT NULL DEFAULT uuid_generate_v4(),
  parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  sender_email TEXT NOT NULL DEFAULT '',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  is_deleted_by_sender BOOLEAN DEFAULT FALSE,
  is_deleted_by_recipient BOOLEAN DEFAULT FALSE,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_size INTEGER,
  file_type TEXT,
  uploaded_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  template_name TEXT NOT NULL DEFAULT 'teacher_welcome',
  template_data JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  delivery_attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sms_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_phone TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  message TEXT NOT NULL,
  template_name TEXT NOT NULL DEFAULT 'teacher_welcome_sms',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'delivered')),
  delivery_attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS teacher_registration_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  registered_by_user_id UUID NOT NULL REFERENCES users(id),
  teacher_code TEXT NOT NULL,
  email_sent BOOLEAN DEFAULT FALSE,
  sms_sent BOOLEAN DEFAULT FALSE,
  email_delivery_status TEXT DEFAULT 'pending' CHECK (email_delivery_status IN ('pending', 'sent', 'failed', 'delivered')),
  sms_delivery_status TEXT DEFAULT 'pending' CHECK (sms_delivery_status IN ('pending', 'sent', 'failed', 'delivered')),
  welcome_email_id UUID REFERENCES email_notifications(id),
  welcome_sms_id UUID REFERENCES sms_notifications(id),
  temporary_password_hash TEXT,
  password_reset_link TEXT,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  email_sent_at TIMESTAMPTZ,
  sms_sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
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
  school_logo_url TEXT,
  ministry_logo_url TEXT,
  country TEXT DEFAULT 'Republic of Rwanda',
  ministry TEXT DEFAULT 'Ministry of Education',
  province TEXT DEFAULT 'Eastern Province',
  district TEXT DEFAULT 'Kayonza',
  sector TEXT DEFAULT 'Gahini',
  dos_primary_name TEXT DEFAULT '',
  dos_secondary_name TEXT DEFAULT '',
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

-- Link registration audit to teachers (FK added after both tables exist).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_registration_audit_id_fkey') THEN
    ALTER TABLE teachers ADD CONSTRAINT teachers_registration_audit_id_fkey
      FOREIGN KEY (registration_audit_id) REFERENCES teacher_registration_audit(id);
  END IF;
END $do$;

-- ============================================================================
-- 2) BACKFILL COLUMNS ON EXISTING DATABASES (all idempotent)
-- ============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;
DO $do$
BEGIN
  ALTER TABLE users DROP CONSTRAINT IF EXISTS users_education_level_check;
  ALTER TABLE users ADD CONSTRAINT users_education_level_check
    CHECK (education_level IS NULL OR education_level IN ('PRIMARY', 'SECONDARY', 'primary', 'secondary', 'all'));
EXCEPTION WHEN others THEN NULL;
END $do$;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS gender TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS registration_audit_id UUID;
DO $do$
BEGIN
  ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_education_level_check;
  ALTER TABLE teachers ADD CONSTRAINT teachers_education_level_check
    CHECK (education_level IS NULL OR education_level IN ('PRIMARY', 'SECONDARY', 'BOTH'));
EXCEPTION WHEN others THEN NULL;
END $do$;

ALTER TABLE classes ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE classes ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS education_level_id UUID REFERENCES education_levels(id);
ALTER TABLE classes ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_status_check') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_status_check CHECK (status IN ('active', 'inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_class_per_academic_year') THEN
    ALTER TABLE classes ADD CONSTRAINT unique_class_per_academic_year UNIQUE NULLS NOT DISTINCT (name, academic_year_id);
  END IF;
END $do$;

ALTER TABLE subjects ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Both';
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS category TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS grades TEXT;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS education_level TEXT DEFAULT 'Both';

ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS start_year INTEGER;
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS end_year INTEGER;
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS is_current BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE academic_years ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
DO $do$
BEGIN
  ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_status_check;
  ALTER TABLE academic_years ADD CONSTRAINT academic_years_status_check
    CHECK (status IN ('active', 'upcoming', 'archived', 'inactive'));
  ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_name_check;
  ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_year_range_check;
  ALTER TABLE academic_years DROP CONSTRAINT IF EXISTS academic_years_name_key;
EXCEPTION WHEN others THEN NULL;
END $do$;

ALTER TABLE terms ADD COLUMN IF NOT EXISTS term_no INTEGER DEFAULT 1;
ALTER TABLE terms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE learners ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE;
ALTER TABLE learners ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE learners ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE learners ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;
DO $do$
BEGIN
  -- Real codes are 12 digits: never enforce the old 11-digit format CHECKs.
  ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_learner_code_format;
  ALTER TABLE teachers DROP CONSTRAINT IF EXISTS teachers_teacher_code_format;
EXCEPTION WHEN others THEN NULL;
END $do$;

ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id) ON DELETE CASCADE;
ALTER TABLE teacher_assignments ADD COLUMN IF NOT EXISTS term_id UUID REFERENCES terms(id) ON DELETE SET NULL;

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS assessment_type_id UUID REFERENCES assessment_types(id);
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS weight NUMERIC;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS period_type TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS period_value INTEGER;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS period_label TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS unit_number INTEGER;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS unit_name TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS converted_from_maximum NUMERIC;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS converted_at TIMESTAMPTZ;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS converted_by UUID;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS roster_learner_ids JSONB;
ALTER TABLE assessments ALTER COLUMN unit DROP NOT NULL;
DO $do$
BEGIN
  ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_status_check;
  ALTER TABLE assessments ADD CONSTRAINT assessments_status_check
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'locked'));
EXCEPTION WHEN others THEN NULL;
END $do$;

ALTER TABLE marks ADD COLUMN IF NOT EXISTS original_mark NUMERIC;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS original_maximum NUMERIC;

ALTER TABLE grading_scales ADD COLUMN IF NOT EXISTS descriptor TEXT;
ALTER TABLE grading_scales ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE grading_scales ADD COLUMN IF NOT EXISTS is_pass BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE grading_scales ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE grading_scales ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS code TEXT;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS default_maximum_mark NUMERIC NOT NULL DEFAULT 30;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS weight NUMERIC;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS contributes_to_combined BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS period_hint TEXT;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS is_standard BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE assessment_types ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE messages ADD COLUMN IF NOT EXISTS thread_id UUID;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES messages(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_email TEXT NOT NULL DEFAULT '';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
UPDATE messages SET thread_id = id WHERE thread_id IS NULL;
UPDATE messages SET is_read = status IN ('read', 'replied', 'archived') WHERE status IS NOT NULL;

ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Republic of Rwanda';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS ministry TEXT DEFAULT 'Ministry of Education';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS province TEXT DEFAULT 'Eastern Province';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS district TEXT DEFAULT 'Kayonza';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'Gahini';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS ministry_logo_url TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS school_logo_url TEXT;
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_primary_name TEXT DEFAULT '';
ALTER TABLE school_settings ADD COLUMN IF NOT EXISTS dos_secondary_name TEXT DEFAULT '';

-- Phone login uniqueness (partial: multiple NULLs allowed).
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'teachers_phone_key') THEN
    ALTER TABLE teachers ADD CONSTRAINT teachers_phone_key UNIQUE (phone);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $do$;
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_phone_unique') THEN
    ALTER TABLE users ADD CONSTRAINT users_phone_unique UNIQUE (phone);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $do$;
-- NOTE: partial UNIQUE WHERE phone IS NOT NULL is stricter/cleaner on fresh
-- installs, but the plain UNIQUE above preserves the exact legacy behavior.

-- ============================================================================
-- 3) FOREIGN KEYS (cascading deletes for academic years / terms)
-- ============================================================================
DO $do$
BEGIN
  ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_academic_year_id_fkey;
  ALTER TABLE classes ADD CONSTRAINT classes_academic_year_id_fkey FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id) ON DELETE CASCADE;
  ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_academic_year_id_fkey;
  ALTER TABLE teacher_assignments ADD CONSTRAINT teacher_assignments_academic_year_id_fkey FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id) ON DELETE CASCADE;
  ALTER TABLE learners DROP CONSTRAINT IF EXISTS learners_academic_year_id_fkey;
  ALTER TABLE learners ADD CONSTRAINT learners_academic_year_id_fkey FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id) ON DELETE CASCADE;
  ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_academic_year_id_fkey;
  ALTER TABLE assessments ADD CONSTRAINT assessments_academic_year_id_fkey FOREIGN KEY (academic_year_id)
    REFERENCES academic_years(id) ON DELETE CASCADE;
  ALTER TABLE teacher_assignments DROP CONSTRAINT IF EXISTS teacher_assignments_term_id_fkey;
  ALTER TABLE teacher_assignments ADD CONSTRAINT teacher_assignments_term_id_fkey FOREIGN KEY (term_id)
    REFERENCES terms(id) ON DELETE SET NULL;
  ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_term_id_fkey;
  ALTER TABLE assessments ADD CONSTRAINT assessments_term_id_fkey FOREIGN KEY (term_id)
    REFERENCES terms(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN NULL;
END $do$;

-- DOS can delete a teacher with everything they own: assessments (cascade
-- deletes their marks), teacher_assignments, classes.class_teacher_id -> NULL,
-- teacher_registration_audit. The only NO-ACTION FK that can block removing a
-- teacher's login row is teacher_registration_audit.registered_by_user_id
-- (when the teacher registered other accounts), so that one is NULLed.
-- NOTE: audit_logs / import_history use a free-form user_id (no FK), so they
-- never block user deletion.
DO $do$
BEGIN
  ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_teacher_id_fkey;
  ALTER TABLE assessments ADD CONSTRAINT assessments_teacher_id_fkey FOREIGN KEY (teacher_id)
    REFERENCES teachers(id) ON DELETE CASCADE;
  ALTER TABLE teacher_registration_audit DROP CONSTRAINT IF EXISTS teacher_registration_audit_registered_by_user_id_fkey;
  ALTER TABLE teacher_registration_audit ADD CONSTRAINT teacher_registration_audit_registered_by_user_id_fkey FOREIGN KEY (registered_by_user_id)
    REFERENCES users(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN NULL;
END $do$;

-- One current year + one active term per year.
CREATE UNIQUE INDEX IF NOT EXISTS academic_years_one_current ON academic_years((TRUE)) WHERE is_current = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS terms_active_one_per_year ON terms(academic_year_id) WHERE is_active = TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_name_key ON assessment_types(name);
CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_code_key ON assessment_types(code);
DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'unique_subject_name') THEN
    ALTER TABLE subjects ADD CONSTRAINT unique_subject_name UNIQUE (name);
  END IF;
EXCEPTION WHEN others THEN NULL;
END $do$;

-- Drop blocking unique constraints that prevent multi-subject-per-class
-- assignments (keep only the primary key).
DO $do$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.teacher_assignments'::regclass
      AND contype IN ('u', 'x') AND conname <> 'teacher_assignments_pkey'
      AND pg_get_constraintdef(oid) ILIKE '%teacher_id%'
      AND (pg_get_constraintdef(oid) ILIKE '%class_id%' OR pg_get_constraintdef(oid) ILIKE '%subject_id%')
  LOOP
    EXECUTE format('ALTER TABLE public.teacher_assignments DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $do$;

-- ============================================================================
-- 4) HELPER FUNCTIONS (dependency order)
-- ============================================================================

CREATE OR REPLACE FUNCTION link_auth_user(p_email TEXT, p_name TEXT, p_role TEXT)
RETURNS TEXT AS $fn$
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
$fn$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $fn$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$fn$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS academic_years_set_updated_at ON academic_years;
CREATE TRIGGER academic_years_set_updated_at BEFORE UPDATE ON academic_years
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- --- DOS scope helpers ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_is_dos()
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM users u WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active');
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_education_level()
RETURNS TEXT LANGUAGE sql STABLE AS $fn$
  SELECT u.education_level FROM public.users u
  WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.rms_is_scoped_dos()
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT public.rms_dos_education_level() IS NOT NULL;
$fn$;

-- Global DOS (education_level IS NULL) keeps full access; scoped DOS is
-- limited to its own level. Fail-closed for unresolvable scoped DOS.
CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN p_level IS NULL OR p_level = 'Both' THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'Primary'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level IN ('Secondary', 'Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
$fn$;

-- Teacher / user record level labels. A scoped DOS may never write the
-- opposite level onto a record it manages. NULL and 'BOTH' stay writable so
-- existing unlabelled/shared records remain editable (no functional break).
CREATE OR REPLACE FUNCTION public.rms_dos_can_teacher_level(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN p_level IS NULL THEN true
    WHEN upper(p_level) = 'BOTH' OR upper(p_level) = 'ALL' THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN upper(p_level) <> 'SECONDARY'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN upper(p_level) <> 'PRIMARY'
    ELSE false
  END;
$fn$;

-- Audit helper: DOS accounts and whether they carry a valid education level.
CREATE OR REPLACE FUNCTION public.rms_dos_level_audit()
RETURNS TABLE(full_name TEXT, email TEXT, education_level TEXT, scope_status TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.full_name, u.email, u.education_level,
    CASE
      WHEN u.education_level IS NULL THEN 'GLOBAL - no level assigned (sees whole school)'
      WHEN upper(u.education_level) NOT IN ('PRIMARY', 'SECONDARY') THEN 'INVALID - must be PRIMARY or SECONDARY'
      ELSE 'OK - isolated to ' || upper(u.education_level)
    END
  FROM public.users u
  WHERE u.role = 'dos' AND u.status = 'active'
  ORDER BY u.full_name;
$fn$;

REVOKE ALL ON FUNCTION public.rms_dos_level_audit() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_dos_level_audit() TO authenticated;

-- Legacy helper (kept for compatibility; scoping is assignment-derived).
CREATE OR REPLACE FUNCTION public.rms_dos_can_teacher(p_level TEXT)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN p_level IS NULL OR p_level = 'BOTH' THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY' THEN p_level = 'PRIMARY'
    WHEN public.rms_dos_education_level() = 'SECONDARY' THEN p_level = 'SECONDARY'
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM teachers t WHERE t.user_id = auth.uid() AND t.id = p_teacher_id
      AND EXISTS (SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id
        AND (ta.class_id IS NULL OR ta.class_id = p_class_id)
        AND (ta.subject_id IS NULL OR ta.subject_id = p_subject_id)
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL OR ta.academic_year_id = p_academic_year_id))
  );
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_can_view_assessment_row(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
) RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT (EXISTS (SELECT 1 FROM teachers t WHERE t.user_id = auth.uid() AND t.id = p_teacher_id)
    OR EXISTS (SELECT 1 FROM teacher_assignments ta JOIN teachers t ON t.id = ta.teacher_id
      WHERE t.user_id = auth.uid()
        AND (ta.class_id IS NULL OR ta.class_id = p_class_id)
        AND (ta.subject_id IS NULL OR ta.subject_id = p_subject_id)
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL OR ta.academic_year_id = p_academic_year_id)));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_can_assessment(p_assessment_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM teachers t JOIN assessments a ON a.id = p_assessment_id
    WHERE t.user_id = auth.uid()
      AND (a.teacher_id = t.id OR EXISTS (
        SELECT 1 FROM teacher_assignments ta WHERE ta.teacher_id = t.id
          AND ta.class_id = a.class_id AND ta.subject_id = a.subject_id
          AND (ta.academic_year_id IS NULL OR a.academic_year_id IS NULL OR ta.academic_year_id = a.academic_year_id)))
  );
$fn$;

-- Assignment-derived teacher visibility: unassigned teachers are a shared
-- pool; otherwise visible only with an in-scope assignment.
CREATE OR REPLACE FUNCTION public.rms_teacher_in_scope(p_teacher_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id)
    AND (NOT EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = p_teacher_id)
      OR EXISTS (SELECT 1 FROM public.teacher_assignments ta JOIN public.classes c ON c.id = ta.class_id
        WHERE ta.teacher_id = p_teacher_id AND public.rms_dos_can_level(c.education_level)));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_marks(p_assessment_id UUID)
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT public.rms_dos_can_level(
    (SELECT c.education_level FROM public.assessments a JOIN public.classes c ON c.id = a.class_id WHERE a.id = p_assessment_id));
$fn$;

-- --- Report helpers (recursion-free, SECURITY DEFINER) ----------------------
CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_class(p_class_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND ta.class_id = p_class_id);
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_subject(p_subject_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u JOIN public.teachers t ON t.user_id = u.id
    JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
    WHERE u.id = auth.uid() AND u.role = 'teacher' AND u.status = 'active' AND ta.subject_id = p_subject_id);
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_teacher_has_learner(p_class_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.rms_report_teacher_has_class(p_class_id);
$fn$;

CREATE OR REPLACE FUNCTION public.rms_report_assignment_visible(p_teacher_id UUID, p_class_id UUID, p_subject_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id AND t.user_id = auth.uid())
    OR public.rms_is_dos();
$fn$;

-- --- Account isolation helpers (authoritative, run last) --------------------
CREATE OR REPLACE FUNCTION public.rms_account_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.role FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active' LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_teacher_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT t.id FROM public.teachers t WHERE t.user_id = auth.uid() LIMIT 1;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_access_user(p_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE WHEN p_user_id = auth.uid() THEN true
    WHEN public.rms_account_role() = 'dos' THEN EXISTS (
      SELECT 1 FROM public.users target JOIN public.teachers t ON t.user_id = target.id
      WHERE target.id = p_user_id AND target.role = 'teacher' AND public.rms_teacher_in_scope(t.id))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_teacher(p_teacher_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(p_teacher_id)
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id AND t.user_id = auth.uid())
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = p_teacher_id AND t.user_id = auth.uid())
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c WHERE c.id = p_class_id AND public.rms_dos_can_level(c.education_level))
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.class_id = p_class_id AND ta.teacher_id = public.rms_account_teacher_id())
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.class_id = p_class_id AND ta.teacher_id = public.rms_account_teacher_id())
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_subject(p_subject_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.subjects s WHERE s.id = p_subject_id AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.subject_id = p_subject_id AND ta.teacher_id = public.rms_account_teacher_id())
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.subject_id = p_subject_id AND ta.teacher_id = public.rms_account_teacher_id())
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND public.rms_dos_can_level(c.education_level))
    WHEN 'teacher' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id())
    WHEN 'headteacher' THEN EXISTS (SELECT 1 FROM public.learners l JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id())
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.assessments a JOIN public.classes c ON c.id = a.class_id
      JOIN public.subjects s ON s.id = a.subject_id WHERE a.id = p_assessment_id
      AND public.rms_dos_can_level(c.education_level) AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
    WHEN 'headteacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assessment_fields(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c CROSS JOIN public.subjects s
      WHERE c.id = p_class_id AND s.id = p_subject_id
      AND public.rms_dos_can_level(c.education_level) AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN p_teacher_id = public.rms_account_teacher_id() AND EXISTS (
      SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = public.rms_account_teacher_id()
        AND ta.class_id = p_class_id AND ta.subject_id = p_subject_id
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL OR ta.academic_year_id = p_academic_year_id))
    WHEN 'headteacher' THEN p_teacher_id = public.rms_account_teacher_id() AND EXISTS (
      SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = public.rms_account_teacher_id()
        AND ta.class_id = p_class_id AND ta.subject_id = p_subject_id
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL OR ta.academic_year_id = p_academic_year_id))
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assignment(p_teacher_id UUID, p_class_id UUID, p_subject_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (SELECT 1 FROM public.classes c JOIN public.subjects s ON s.id = p_subject_id
      WHERE c.id = p_class_id AND public.rms_dos_can_level(c.education_level) AND public.rms_dos_can_subject(s.level))
    WHEN 'teacher' THEN p_teacher_id = public.rms_account_teacher_id()
    WHEN 'headteacher' THEN p_teacher_id = public.rms_account_teacher_id()
    ELSE false END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_document(p_document_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.documents d WHERE d.id = p_document_id
    AND ((d.learner_id IS NOT NULL AND public.rms_account_can_learner(d.learner_id))
      OR (d.uploaded_by = auth.uid())
      OR (d.uploaded_by IS NULL AND d.learner_id IS NULL AND public.rms_account_role() IN ('dos', 'teacher', 'headteacher'))
      OR (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(d.uploaded_by))));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_can_send_notification(p_recipient_id UUID, p_entity_type TEXT, p_entity_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_recipient_level TEXT; v_class_level TEXT;
BEGIN
  IF p_recipient_id = auth.uid() THEN RETURN true; END IF;
  IF public.rms_account_role() = 'dos' THEN RETURN public.rms_account_can_access_user(p_recipient_id); END IF;
  IF public.rms_account_role() NOT IN ('teacher', 'headteacher') OR p_entity_type <> 'assessments'
     OR NOT public.rms_account_can_assessment(p_entity_id) THEN RETURN false; END IF;
  SELECT recipient.education_level, c.education_level INTO v_recipient_level, v_class_level
  FROM public.users recipient JOIN public.users sender ON sender.id = auth.uid()
  JOIN public.assessments a ON a.id = p_entity_id JOIN public.classes c ON c.id = a.class_id
  WHERE recipient.id = p_recipient_id AND recipient.role = 'dos' AND recipient.status = 'active';
  RETURN CASE WHEN v_recipient_level = 'PRIMARY' THEN v_class_level = 'Primary'
    WHEN v_recipient_level = 'SECONDARY' THEN v_class_level IN ('Lower Secondary', 'Upper Secondary')
    ELSE false END;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_notification_recipients(p_assessment_id UUID)
RETURNS TABLE(user_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.id FROM public.users u JOIN public.assessments a ON a.id = p_assessment_id
  JOIN public.classes c ON c.id = a.class_id
  WHERE u.role = 'dos' AND u.status = 'active'
    AND public.rms_account_role() IN ('teacher', 'headteacher')
    AND public.rms_account_can_assessment(p_assessment_id)
    AND ((u.education_level = 'PRIMARY' AND c.education_level = 'Primary')
      OR (u.education_level = 'SECONDARY' AND c.education_level IN ('Lower Secondary', 'Upper Secondary')));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_guard_user_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Account IDs cannot be changed';
  END IF;
  IF auth.uid() IS NOT NULL AND OLD.id = auth.uid()
     AND (NEW.role IS DISTINCT FROM OLD.role OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.education_level IS DISTINCT FROM OLD.education_level) THEN
    RAISE EXCEPTION 'Account role, status, and scope can only be changed by an administrator';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_account_guard_teacher_fields()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.user_id IS DISTINCT FROM OLD.user_id) THEN
    RAISE EXCEPTION 'Teacher account IDs cannot be changed';
  END IF;
  IF auth.uid() IS NOT NULL AND public.rms_account_role() IN ('teacher', 'headteacher')
     AND OLD.user_id = auth.uid()
     AND (NEW.teacher_code IS DISTINCT FROM OLD.teacher_code OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.created_by IS DISTINCT FROM OLD.created_by OR NEW.education_level IS DISTINCT FROM OLD.education_level) THEN
    RAISE EXCEPTION 'Only an administrator can change protected teacher account fields';
  END IF;
  RETURN NEW;
END;
$fn$;

-- --- Communication helpers --------------------------------------------------
CREATE OR REPLACE FUNCTION public.rms_communication_dos_scope(p_level TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active'
    AND lower(u.education_level) = lower(p_level));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_communication_can_read_announcement(p_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a JOIN public.users u ON u.id = auth.uid()
    WHERE a.id = p_id AND u.status = 'active'
      AND ((u.role = 'dos' AND public.rms_communication_dos_scope(a.education_level))
        OR (u.role = 'teacher' AND a.status = 'active' AND a.published_at IS NOT NULL AND a.published_at <= NOW()
          AND (a.expires_at IS NULL OR a.expires_at > NOW())
          AND (a.education_level = 'all'
            OR EXISTS (SELECT 1 FROM public.teachers t JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
              JOIN public.classes c ON c.id = ta.class_id WHERE t.user_id = u.id
              AND ((a.education_level = 'primary' AND c.education_level = 'Primary')
                OR (a.education_level = 'secondary' AND c.education_level IN ('Lower Secondary', 'Upper Secondary'))))
            OR NOT EXISTS (SELECT 1 FROM public.teachers t JOIN public.teacher_assignments ta ON ta.teacher_id = t.id WHERE t.user_id = u.id))
          AND (a.target_user_ids @> ARRAY[u.id] OR a.audience_type = 'all'
            OR (a.audience_type = 'primary' AND a.education_level = 'primary')
            OR (a.audience_type = 'secondary' AND a.education_level = 'secondary')))));
$fn$;

-- DOS may initiate threads (parent NULL); teachers reply only within a
-- thread on their assigned class.
CREATE OR REPLACE FUNCTION public.rms_communication_can_send_message(
  p_recipient UUID, p_class_id UUID, p_thread_id UUID, p_parent_message_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_sender_role TEXT; v_recipient_role TEXT;
BEGIN
  SELECT role INTO v_sender_role FROM public.users WHERE id = auth.uid() AND status = 'active';
  SELECT role INTO v_recipient_role FROM public.users WHERE id = p_recipient AND status = 'active';
  IF v_sender_role = 'teacher' AND v_recipient_role = 'dos' THEN
    RETURN p_thread_id IS NOT NULL AND p_class_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.teachers t JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
      JOIN public.classes c ON c.id = ta.class_id JOIN public.users dos ON dos.id = p_recipient
      WHERE t.user_id = auth.uid() AND c.id = p_class_id AND dos.status = 'active'
        AND ((c.education_level = 'Primary' AND dos.education_level = 'PRIMARY')
          OR (c.education_level IN ('Lower Secondary', 'Upper Secondary') AND dos.education_level = 'SECONDARY'))
        AND (p_parent_message_id IS NULL OR EXISTS (
          SELECT 1 FROM public.messages parent WHERE parent.id = p_parent_message_id AND parent.thread_id = p_thread_id
            AND parent.class_id = p_class_id AND parent.sender_user_id = p_recipient AND parent.recipient_user_id = auth.uid())));
  END IF;
  IF v_sender_role = 'dos' AND v_recipient_role = 'teacher' THEN
    RETURN public.rms_communication_dos_scope((SELECT education_level FROM public.users WHERE id = auth.uid()))
      AND (p_parent_message_id IS NULL OR (p_thread_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.teachers t JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
        JOIN public.classes c ON c.id = ta.class_id JOIN public.messages parent ON parent.id = p_parent_message_id
        WHERE t.user_id = p_recipient AND (p_class_id IS NULL OR c.id = p_class_id)
          AND public.rms_dos_can_level(c.education_level)
          AND parent.thread_id = p_thread_id
          AND ((parent.sender_user_id = p_recipient AND parent.recipient_user_id = auth.uid())
            OR (parent.sender_user_id = auth.uid() AND parent.recipient_user_id = p_recipient)))));
  END IF;
  RETURN FALSE;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_communication_dos_for_class(p_class_id UUID)
RETURNS TABLE(user_id UUID, full_name TEXT) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.id, u.full_name FROM public.users u JOIN public.classes c ON c.id = p_class_id
  WHERE u.role = 'dos' AND u.status = 'active'
    AND ((c.education_level = 'Primary' AND u.education_level = 'PRIMARY')
      OR (c.education_level IN ('Lower Secondary', 'Upper Secondary') AND u.education_level = 'SECONDARY'));
$fn$;

CREATE OR REPLACE FUNCTION public.rms_message_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  SELECT COALESCE(full_name, ''), COALESCE(email, '') INTO NEW.sender_name, NEW.sender_email
  FROM public.users WHERE id = NEW.sender_user_id;
  NEW.status := 'unread'; NEW.is_read := FALSE; RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_message_read_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $fn$
BEGIN
  NEW.status := CASE WHEN NEW.is_read THEN 'read' ELSE 'unread' END;
  NEW.updated_at := NOW(); RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_notify_message_recipient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  INSERT INTO public.notifications (recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read) VALUES (
    NEW.recipient_user_id, NEW.sender_user_id, 'New message: ' || NEW.subject, NEW.body,
    'SYSTEM', 'system', 'normal', 'teacher_message', NEW.id,
    CASE WHEN (SELECT role FROM public.users WHERE id = NEW.recipient_user_id) = 'dos'
      THEN '/#admin/messages' ELSE '/#teacher/messages' END, FALSE);
  RETURN NEW;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_publish_due_announcements()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE v_inserted INTEGER;
BEGIN
  INSERT INTO public.notifications (recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read)
  SELECT DISTINCT u.id, a.sender_user_id, a.title, a.message,
    CASE a.category WHEN 'timetable' THEN 'TIMETABLE' WHEN 'meeting' THEN 'MEETING'
      WHEN 'examination' THEN 'EXAMINATION' WHEN 'cpd' THEN 'CPD' WHEN 'training' THEN 'CPD'
      ELSE 'ANNOUNCEMENT' END,
    'announcement', a.priority, 'announcement', a.id, '/#teacher/notifications', FALSE
  FROM public.announcements a JOIN public.users u ON u.role = 'teacher' AND u.status = 'active'
  LEFT JOIN public.teachers t ON t.user_id = u.id
  WHERE a.status = 'active' AND a.published_at IS NOT NULL AND a.published_at <= NOW()
    AND (a.expires_at IS NULL OR a.expires_at > NOW())
    AND (a.target_user_ids @> ARRAY[u.id] OR a.audience_type = 'all'
      OR (a.audience_type = 'primary' AND a.education_level = 'primary')
      OR (a.audience_type = 'secondary' AND a.education_level = 'secondary'))
    AND (a.education_level = 'all'
      OR EXISTS (SELECT 1 FROM public.teacher_assignments ta JOIN public.classes c ON c.id = ta.class_id
        WHERE ta.teacher_id = t.id AND ((a.education_level = 'primary' AND c.education_level = 'Primary')
          OR (a.education_level = 'secondary' AND c.education_level IN ('Lower Secondary', 'Upper Secondary'))))
      OR NOT EXISTS (SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = t.id))
    AND NOT EXISTS (SELECT 1 FROM public.notifications n WHERE n.recipient_user_id = u.id
      AND n.entity_type = 'announcement' AND n.entity_id = a.id);
  GET DIAGNOSTICS v_inserted = ROW_COUNT; RETURN v_inserted;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_announcement_publish_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN PERFORM public.rms_publish_due_announcements(); RETURN NEW; END;
$fn$;

-- --- Notification helpers ---------------------------------------------------
CREATE OR REPLACE FUNCTION create_notification(
  p_recipient_id UUID, p_title TEXT, p_message TEXT,
  p_notification_type TEXT DEFAULT 'info', p_category TEXT DEFAULT 'system',
  p_priority TEXT DEFAULT 'normal', p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL, p_action_url TEXT DEFAULT NULL,
  p_sender_id UUID DEFAULT NULL
) RETURNS UUID AS $fn$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read, is_archived)
  VALUES (p_recipient_id, p_sender_id, p_title, p_message, p_notification_type, p_category,
    p_priority, p_entity_type, p_entity_id, p_action_url, FALSE, FALSE) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION rms_publish_notification(
  p_recipient_id UUID, p_title TEXT, p_message TEXT,
  p_notification_type TEXT, p_category TEXT, p_priority TEXT
) RETURNS UUID AS $fn$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read, is_archived)
  VALUES (p_recipient_id, auth.uid(), p_title, p_message, p_notification_type, p_category,
    p_priority, NULL, NULL, NULL, FALSE, FALSE) RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- Welcome notifications (called by the welcome-teacher Edge Function with the
-- service role; browsers must NOT call it directly).
CREATE OR REPLACE FUNCTION public.send_welcome_notifications(
  p_teacher_name TEXT, p_email TEXT, p_phone TEXT, p_teacher_code TEXT,
  p_classes JSONB DEFAULT '[]'::JSONB, p_subjects JSONB DEFAULT '[]'::JSONB,
  p_education_level TEXT DEFAULT 'Primary', p_login_link TEXT DEFAULT '',
  p_temp_password_link TEXT DEFAULT '', p_registered_by UUID DEFAULT NULL, p_audit_id UUID DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS $fn$
DECLARE v_email_id UUID; v_sms_id UUID; v_sms_message TEXT; v_class_names TEXT[]; v_subject_names TEXT[];
BEGIN
  v_class_names := ARRAY(SELECT jsonb_array_elements_text(p_classes));
  v_subject_names := ARRAY(SELECT jsonb_array_elements_text(p_subjects));
  v_sms_message := 'Welcome ' || p_teacher_name || '. Your RMS-MIS account has been created. Email: ' || p_email
    || '. Classes: ' || COALESCE(array_to_string(v_class_names, ', '), 'None')
    || '. Subjects: ' || COALESCE(array_to_string(v_subject_names, ', '), 'None')
    || '. Login: ' || p_login_link || '. Please use your temporary credentials to log in and change your password.';
  INSERT INTO email_notifications (recipient_user_id, recipient_email, recipient_name, subject, body_html, body_text,
    template_name, template_data, status) VALUES (
    p_registered_by, p_email, p_teacher_name, 'Welcome to RMS-MIS – Your Teacher Account Has Been Created',
    '<html><body><h1>Welcome</h1><p>Dear ' || p_teacher_name || ',</p><p>Your teacher account has been created.</p><p>Email: '
      || p_email || '</p><p>Teacher Code: ' || p_teacher_code || '</p><p>Education Level: ' || p_education_level
      || '</p><p>Login: ' || p_login_link || '</p><p>Set Password: ' || p_temp_password_link || '</p></body></html>',
    'Welcome ' || p_teacher_name || '! Email: ' || p_email || '. Teacher Code: ' || p_teacher_code || '. Login: ' || p_login_link || '.',
    'teacher_welcome', jsonb_build_object('teacher_name', p_teacher_name, 'email', p_email, 'phone', p_phone,
      'teacher_code', p_teacher_code, 'classes', p_classes, 'subjects', p_subjects, 'education_level', p_education_level),
    'pending') RETURNING id INTO v_email_id;
  INSERT INTO sms_notifications (recipient_user_id, recipient_phone, recipient_name, message, template_name, status)
  VALUES (p_registered_by, COALESCE(p_phone, ''), p_teacher_name, v_sms_message, 'teacher_welcome_sms', 'pending')
  RETURNING id INTO v_sms_id;
  IF p_audit_id IS NOT NULL THEN
    UPDATE teacher_registration_audit SET welcome_email_id = v_email_id, welcome_sms_id = v_sms_id,
      email_delivery_status = 'pending', sms_delivery_status = 'pending', email_sent = FALSE, sms_sent = FALSE,
      updated_at = NOW() WHERE id = p_audit_id;
  END IF;
  INSERT INTO notifications (recipient_user_id, sender_user_id, title, message, notification_type, category,
    priority, entity_type, entity_id, is_read, action_url) VALUES (
    p_registered_by, p_registered_by, 'Teacher Registered Successfully',
    p_teacher_name || ' has been registered. Email: pending. SMS: pending.',
    'SYSTEM', 'system', 'important', 'teacher_registration', p_registered_by, FALSE, '/admin/teachers');
  RETURN jsonb_build_object('success', true, 'email_notification_id', v_email_id,
    'sms_notification_id', v_sms_id, 'email_status', 'pending', 'sms_status', 'pending');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.handle_teacher_registration_audit()
RETURNS TRIGGER AS $fn$
BEGIN
  INSERT INTO teacher_registration_audit (teacher_id, user_id, registered_by_user_id, teacher_code,
    email_sent, sms_sent, email_delivery_status, sms_delivery_status)
  VALUES (NEW.id, NEW.user_id, NEW.created_by, NEW.teacher_code, FALSE, FALSE, 'pending', 'pending');
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.handle_teacher_registration_log()
RETURNS TRIGGER AS $fn$
DECLARE v_registered_by_name TEXT;
BEGIN
  SELECT full_name INTO v_registered_by_name FROM users WHERE id = NEW.created_by;
  INSERT INTO audit_logs (user_id, user_name, role, action, assessment_id, learner_id, old_value, new_value, timestamp)
  VALUES (NEW.created_by, v_registered_by_name, 'dos', 'TEACHER_REGISTERED:' || NEW.teacher_code,
    NULL, NULL, 'teacher:' || NEW.full_name, 'code:' || NEW.teacher_code || ',email:' || NEW.email || ',phone:' || NEW.phone, NOW());
  RETURN NEW;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- Legacy helper (UI writes through RLS now; locked to service_role below).
CREATE OR REPLACE FUNCTION send_message(
  p_sender_id UUID, p_recipient_id UUID, p_subject TEXT, p_body TEXT, p_message_type TEXT DEFAULT 'direct'
) RETURNS UUID AS $fn$
DECLARE v_id UUID;
BEGIN
  INSERT INTO messages (sender_user_id, recipient_user_id, subject, body, message_type, status)
  VALUES (p_sender_id, p_recipient_id, p_subject, p_body, p_message_type, 'unread') RETURNING id INTO v_id;
  RETURN v_id;
END;
$fn$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 5) DOS ACCOUNTS + REFERENCE BACKFILL
-- ============================================================================
INSERT INTO public.education_levels (name, code, description, display_order, active)
VALUES
  ('Primary', 'PRIMARY', 'Primary Education (P1 - P6)', 1, true),
  ('Lower Secondary', 'LOWER_SECONDARY', 'Lower Secondary Education (S1 - S3)', 2, true),
  ('Upper Secondary', 'UPPER_SECONDARY', 'Upper Secondary Education (S4 - S6)', 3, true),
  ('Nursery', 'NURSERY', 'Pre-Primary / Nursery Education', 0, false),
  ('TVET', 'TVET', 'Technical & Vocational Education', 4, false)
ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name,
  description = EXCLUDED.description, display_order = EXCLUDED.display_order;

UPDATE public.classes
SET education_level = 'Primary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'PRIMARY' LIMIT 1)
WHERE (education_level IS NULL OR education_level <> 'Primary')
  AND (level IN ('P1','P2','P3','P4','P5','P6') OR level ILIKE 'P%' OR name ILIKE 'P%'
       OR level ~ '^P[0-9]' OR name ~ '^P[0-9]');
UPDATE public.classes
SET education_level = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE (education_level IS NULL OR education_level <> 'Lower Secondary')
  AND (level IN ('S1','S2','S3') OR name ~ '^S[1-3](\s|$)' OR level ~ '^S[1-3]');
UPDATE public.classes
SET education_level = 'Upper Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'UPPER_SECONDARY' LIMIT 1)
WHERE (education_level IS NULL OR education_level <> 'Upper Secondary')
  AND (level IN ('S4','S5','S6') OR name ~ '^S[4-6](\s|$)' OR level ~ '^S[4-6]');
UPDATE public.classes
SET education_level = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE education_level IS NULL;
UPDATE public.subjects SET level = 'Both' WHERE level IS NULL;
UPDATE public.subjects SET education_level = level WHERE education_level IS NULL;
UPDATE public.teachers SET education_level = COALESCE(education_level, 'BOTH');
UPDATE public.terms SET term_no = CASE
  WHEN name ILIKE '%3%' THEN 3 WHEN name ILIKE '%2%' THEN 2 ELSE 1 END
WHERE term_no IS NULL OR term_no = 0;

-- Two level-specific DOS administrators (self-healing, idempotent).
DO $do$
DECLARE r record; v_keeper uuid; v_row record; v_email text; v_lvl text; v_name text;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('dos@rukara.edu'::text, 'PRIMARY'::text, 'DOS Primary'::text),
    ('dos2@rukara.edu'::text, 'SECONDARY'::text, 'DOS Secondary'::text)) t(email, lvl, nm)
  LOOP
    v_email := r.email; v_lvl := r.lvl; v_name := r.nm;
    SELECT id INTO v_keeper FROM auth.users u WHERE lower(u.email) = v_email
      AND crypt('dos123', u.encrypted_password) = u.encrypted_password
      AND u.email_confirmed_at IS NOT NULL
      AND exists(SELECT 1 FROM auth.identities i WHERE i.user_id = u.id)
    ORDER BY u.created_at DESC LIMIT 1;
    IF v_keeper IS NULL THEN
      SELECT id INTO v_keeper FROM auth.users u WHERE lower(u.email) = v_email ORDER BY u.created_at DESC LIMIT 1;
    END IF;
    FOR v_row IN SELECT id FROM auth.users u WHERE lower(u.email) = v_email LOOP
      IF v_row.id IS DISTINCT FROM v_keeper THEN
        DELETE FROM auth.identities WHERE user_id = v_row.id;
        DELETE FROM auth.users WHERE id = v_row.id;
      END IF;
    END LOOP;
    IF v_keeper IS NULL THEN
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token)
      VALUES ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', v_email,
        crypt('dos123', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '')
      RETURNING id INTO v_keeper;
    ELSE
      UPDATE auth.users SET encrypted_password = crypt('dos123', gen_salt('bf')),
        email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()), updated_at = now() WHERE id = v_keeper;
    END IF;
    IF NOT exists(SELECT 1 FROM auth.identities WHERE user_id = v_keeper AND provider = 'email') THEN
      INSERT INTO auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES (v_keeper, v_keeper, v_keeper::text,
        jsonb_build_object('sub', v_keeper::text, 'email', v_email, 'email_verified', true, 'phone_verified', false),
        'email', now(), now(), now());
    END IF;
    BEGIN
      INSERT INTO public.users (id, email, full_name, role, education_level, status)
      VALUES (v_keeper, v_email, v_name, 'dos', v_lvl, 'active')
      ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id, full_name = EXCLUDED.full_name,
        role = EXCLUDED.role, education_level = EXCLUDED.education_level, status = EXCLUDED.status;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'Profile re-link deferred for %: %', v_email, SQLERRM;
      UPDATE public.users u SET full_name = v_name, role = 'dos',
        education_level = v_lvl, status = 'active' WHERE u.email = v_email;
    END;
  END LOOP;
END $do$;
-- NOTE: after running this file, sign out/in again with the DOS accounts so
-- the JWT sub matches the surviving auth row.

-- Re-link any mis-linked public.users.id to auth.users.id (common 403 cause).
UPDATE public.users u SET id = au.id FROM auth.users au
WHERE u.email = au.email AND u.id <> au.id
  AND NOT EXISTS (SELECT 1 FROM public.users other WHERE other.id = au.id AND other.email <> au.email);

-- ============================================================================
-- 6) ENABLE RLS
-- ============================================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teachers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_subjects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.education_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grading_scales ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.performance_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcement_acknowledgements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sms_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.teacher_registration_audit ENABLE ROW LEVEL SECURITY;

-- Clean slate: drop every legacy policy on public tables (removes the old
-- open USING(true) policies and any partial fix-era policies).
DO $do$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $do$;

-- ============================================================================
-- 7) RLS POLICIES (final restrictive set)
-- ============================================================================

-- --- users ---
DROP POLICY IF EXISTS rms_account_users_select ON public.users;
CREATE POLICY rms_account_users_select ON public.users FOR SELECT TO authenticated
  USING (public.rms_account_can_access_user(id));
DROP POLICY IF EXISTS rms_account_users_insert ON public.users;
CREATE POLICY rms_account_users_insert ON public.users FOR INSERT TO authenticated
  WITH CHECK ((id = auth.uid() AND role = 'teacher') OR (public.rms_account_role() = 'dos' AND role = 'teacher'));
DROP POLICY IF EXISTS rms_account_users_update ON public.users;
CREATE POLICY rms_account_users_update ON public.users FOR UPDATE TO authenticated
  USING (public.rms_account_can_access_user(id)) WITH CHECK (public.rms_account_can_access_user(id));
DROP POLICY IF EXISTS rms_account_users_delete ON public.users;
CREATE POLICY rms_account_users_delete ON public.users FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos'
    AND id <> auth.uid()
    AND role = 'teacher'
    AND public.rms_account_can_access_user(id));
-- A scoped DOS may not relabel a managed account as the opposite level.
DROP POLICY IF EXISTS rms_dos_user_level_write ON public.users;
CREATE POLICY rms_dos_user_level_write ON public.users AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_teacher_level(education_level));

-- --- teachers ---
-- Permissive baseline: DOS may address any teacher row, everyone else only
-- their own. The RESTRICTIVE policies below narrow this to the DOS's own
-- education level (rms_account_teacher_rows + rms_dos_level_guard), so a
-- scoped DOS only ever resolves in-scope teachers.
DROP POLICY IF EXISTS rms_account_teachers_select ON public.teachers;
CREATE POLICY rms_account_teachers_select ON public.teachers FOR SELECT TO authenticated
  USING (public.rms_account_role() = 'dos' OR user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_teachers_update ON public.teachers;
CREATE POLICY rms_account_teachers_update ON public.teachers FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos' OR user_id = auth.uid())
  WITH CHECK (public.rms_account_role() = 'dos' OR user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_teacher_self_insert ON public.teachers;
CREATE POLICY rms_account_teacher_self_insert ON public.teachers FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() IN ('teacher', 'headteacher') AND user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_teacher_rows ON public.teachers;
CREATE POLICY rms_account_teacher_rows ON public.teachers AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_teacher(id))
  WITH CHECK (public.rms_account_can_teacher(id)
    OR (public.rms_account_role() = 'teacher' AND user_id = auth.uid())
    OR (public.rms_account_role() = 'dos' AND public.rms_is_scoped_dos()));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.teachers;
CREATE POLICY rms_dos_level_guard ON public.teachers AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR (public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(teachers.id)))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_is_scoped_dos());
-- A scoped DOS may not create or relabel a teacher as the opposite level.
DROP POLICY IF EXISTS rms_dos_teacher_level_write ON public.teachers;
CREATE POLICY rms_dos_teacher_level_write ON public.teachers AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_teacher_level(education_level));
DROP POLICY IF EXISTS rms_dos_teacher_level_write_upd ON public.teachers;
CREATE POLICY rms_dos_teacher_level_write_upd ON public.teachers AS RESTRICTIVE FOR UPDATE TO authenticated
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_teacher_level(education_level));
DROP POLICY IF EXISTS rms_account_teachers_delete ON public.teachers;
CREATE POLICY rms_account_teachers_delete ON public.teachers FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos'
    AND public.rms_is_scoped_dos()
    AND public.rms_teacher_in_scope(teachers.id));

-- --- classes ---
DROP POLICY IF EXISTS rms_classes_select ON public.classes;
CREATE POLICY rms_classes_select ON public.classes FOR SELECT
  USING (public.rms_dos_can_level(classes.education_level));
DROP POLICY IF EXISTS rms_classes_insert ON public.classes;
CREATE POLICY rms_classes_insert ON public.classes FOR INSERT
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));
DROP POLICY IF EXISTS rms_classes_update ON public.classes;
CREATE POLICY rms_classes_update ON public.classes FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level))
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));
DROP POLICY IF EXISTS rms_classes_delete ON public.classes;
CREATE POLICY rms_classes_delete ON public.classes FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(classes.education_level));
DROP POLICY IF EXISTS rms_account_class_scope ON public.classes;
CREATE POLICY rms_account_class_scope ON public.classes AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_class(id)) WITH CHECK (public.rms_account_can_class(id));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.classes;
CREATE POLICY rms_dos_level_guard ON public.classes AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_level(education_level))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_level(education_level));
DROP POLICY IF EXISTS rms_report_teacher_classes_select ON public.classes;
CREATE POLICY rms_report_teacher_classes_select ON public.classes FOR SELECT
  USING (public.rms_report_teacher_has_class(classes.id));

-- --- subjects ---
DROP POLICY IF EXISTS rms_subjects_select ON public.subjects;
CREATE POLICY rms_subjects_select ON public.subjects FOR SELECT
  USING (public.rms_dos_can_subject(subjects.level));
DROP POLICY IF EXISTS rms_subjects_insert ON public.subjects;
CREATE POLICY rms_subjects_insert ON public.subjects FOR INSERT
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level));
DROP POLICY IF EXISTS rms_subjects_update ON public.subjects;
CREATE POLICY rms_subjects_update ON public.subjects FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level))
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level));
DROP POLICY IF EXISTS rms_subjects_delete ON public.subjects;
CREATE POLICY rms_subjects_delete ON public.subjects FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_subject(subjects.level));
DROP POLICY IF EXISTS rms_account_subject_scope ON public.subjects;
CREATE POLICY rms_account_subject_scope ON public.subjects AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_subject(id)) WITH CHECK (public.rms_account_can_subject(id));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.subjects;
CREATE POLICY rms_dos_level_guard ON public.subjects AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_subject(level))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_subject(level));
DROP POLICY IF EXISTS rms_report_teacher_subjects_select ON public.subjects;
CREATE POLICY rms_report_teacher_subjects_select ON public.subjects FOR SELECT
  USING (public.rms_report_teacher_has_subject(subjects.id));

-- --- class_subjects ---
DROP POLICY IF EXISTS rms_dos_level_guard ON public.class_subjects;
CREATE POLICY rms_dos_level_guard ON public.class_subjects AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_subjects.class_id)))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)));
DROP POLICY IF EXISTS rms_class_subjects_all ON public.class_subjects;
CREATE POLICY rms_class_subjects_all ON public.class_subjects FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- --- education_levels (public reference) ---
DROP POLICY IF EXISTS "everyone_read_education_levels" ON public.education_levels;
CREATE POLICY "everyone_read_education_levels" ON public.education_levels FOR SELECT USING (true);

-- --- learners ---
DROP POLICY IF EXISTS rms_learners_select ON public.learners;
CREATE POLICY rms_learners_select ON public.learners FOR SELECT
  USING (public.rms_dos_can_level((SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)));
DROP POLICY IF EXISTS rms_learners_insert ON public.learners;
CREATE POLICY rms_learners_insert ON public.learners FOR INSERT
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)));
DROP POLICY IF EXISTS rms_learners_update ON public.learners;
CREATE POLICY rms_learners_update ON public.learners FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)))
  WITH CHECK (public.rms_is_dos() AND public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)));
DROP POLICY IF EXISTS rms_learners_delete ON public.learners;
CREATE POLICY rms_learners_delete ON public.learners FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)));
DROP POLICY IF EXISTS rms_account_learner_scope ON public.learners;
CREATE POLICY rms_account_learner_scope ON public.learners AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_learner(id))
  WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_class(class_id));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.learners;
CREATE POLICY rms_dos_level_guard ON public.learners AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)));
DROP POLICY IF EXISTS rms_report_teacher_learners_select ON public.learners;
CREATE POLICY rms_report_teacher_learners_select ON public.learners FOR SELECT
  USING (public.rms_report_teacher_has_learner(learners.class_id));

-- --- teacher_assignments ---
DROP POLICY IF EXISTS rms_teacher_assignments_select ON public.teacher_assignments;
CREATE POLICY rms_teacher_assignments_select ON public.teacher_assignments FOR SELECT
  USING (public.rms_dos_can_level((SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id))
    OR (class_id IS NULL)
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.id = teacher_assignments.teacher_id AND t.user_id = auth.uid()));
DROP POLICY IF EXISTS rms_teacher_assignments_insert ON public.teacher_assignments;
CREATE POLICY rms_teacher_assignments_insert ON public.teacher_assignments FOR INSERT
  WITH CHECK (public.rms_is_dos()
    AND public.rms_dos_can_level((SELECT c.education_level FROM public.classes c WHERE c.id = class_id))
    AND public.rms_dos_can_subject((SELECT s.level FROM public.subjects s WHERE s.id = subject_id)));
DROP POLICY IF EXISTS rms_teacher_assignments_update ON public.teacher_assignments;
CREATE POLICY rms_teacher_assignments_update ON public.teacher_assignments FOR UPDATE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)))
  WITH CHECK (public.rms_is_dos()
    AND public.rms_dos_can_level((SELECT c.education_level FROM public.classes c WHERE c.id = class_id))
    AND public.rms_dos_can_subject((SELECT s.level FROM public.subjects s WHERE s.id = subject_id)));
DROP POLICY IF EXISTS rms_teacher_assignments_delete ON public.teacher_assignments;
CREATE POLICY rms_teacher_assignments_delete ON public.teacher_assignments FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)));
DROP POLICY IF EXISTS rms_account_assignment_scope ON public.teacher_assignments;
CREATE POLICY rms_account_assignment_scope ON public.teacher_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_assignment(teacher_id, class_id, subject_id))
  WITH CHECK (public.rms_account_can_assignment(teacher_id, class_id, subject_id));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.teacher_assignments;
CREATE POLICY rms_dos_level_guard ON public.teacher_assignments AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR class_id IS NULL OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id)))
  WITH CHECK (NOT public.rms_is_dos() OR class_id IS NULL OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)));

-- --- assessments ---
DROP POLICY IF EXISTS rms_assessments_select ON public.assessments;
CREATE POLICY rms_assessments_select ON public.assessments FOR SELECT
  USING (public.rms_dos_can_level((SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id))
    OR public.rms_teacher_can_view_assessment_row(assessments.teacher_id, assessments.class_id, assessments.subject_id, assessments.academic_year_id));
DROP POLICY IF EXISTS rms_assessments_insert ON public.assessments;
CREATE POLICY rms_assessments_insert ON public.assessments FOR INSERT
  WITH CHECK ((public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)))
    OR public.rms_teacher_can_assessment_row(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_assessments_update ON public.assessments;
CREATE POLICY rms_assessments_update ON public.assessments FOR UPDATE
  USING ((public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)))
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id))
  WITH CHECK ((public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)))
    OR (teacher_id = assessments.teacher_id AND public.rms_teacher_can_assessment_row(teacher_id, class_id, subject_id, academic_year_id)));
DROP POLICY IF EXISTS rms_assessments_delete ON public.assessments;
CREATE POLICY rms_assessments_delete ON public.assessments FOR DELETE
  USING ((public.rms_is_dos() AND public.rms_dos_can_level(
      (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)))
    OR (assessments.status = 'draft' AND EXISTS (
      SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.id = assessments.teacher_id)));
DROP POLICY IF EXISTS rms_account_assessment_select_scope ON public.assessments;
CREATE POLICY rms_account_assessment_select_scope ON public.assessments AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.rms_account_can_assessment(id));
DROP POLICY IF EXISTS rms_account_assessment_insert_scope ON public.assessments;
CREATE POLICY rms_account_assessment_insert_scope ON public.assessments AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_can_assessment_fields(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_account_assessment_update_scope ON public.assessments;
CREATE POLICY rms_account_assessment_update_scope ON public.assessments AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.rms_account_can_assessment(id))
  WITH CHECK (public.rms_account_can_assessment_fields(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_account_assessment_delete_scope ON public.assessments;
CREATE POLICY rms_account_assessment_delete_scope ON public.assessments AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.rms_account_can_assessment(id));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.assessments;
CREATE POLICY rms_dos_level_guard ON public.assessments AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = class_id)));

-- --- marks ---
DROP POLICY IF EXISTS rms_marks_select ON public.marks;
CREATE POLICY rms_marks_select ON public.marks FOR SELECT
  USING (public.rms_dos_can_marks(marks.assessment_id) OR public.rms_teacher_can_assessment(marks.assessment_id));
DROP POLICY IF EXISTS rms_marks_insert ON public.marks;
CREATE POLICY rms_marks_insert ON public.marks FOR INSERT
  WITH CHECK (public.rms_dos_can_marks(assessment_id) OR public.rms_teacher_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_marks_update ON public.marks;
CREATE POLICY rms_marks_update ON public.marks FOR UPDATE
  USING (public.rms_dos_can_marks(marks.assessment_id) OR public.rms_teacher_can_assessment(marks.assessment_id))
  WITH CHECK (public.rms_dos_can_marks(assessment_id) OR public.rms_teacher_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_marks_delete ON public.marks;
CREATE POLICY rms_marks_delete ON public.marks FOR DELETE
  USING (public.rms_is_dos() AND public.rms_dos_can_marks(marks.assessment_id));
DROP POLICY IF EXISTS rms_account_marks_select_scope ON public.marks;
CREATE POLICY rms_account_marks_select_scope ON public.marks AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_account_marks_insert_scope ON public.marks;
CREATE POLICY rms_account_marks_insert_scope ON public.marks AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_account_marks_update_scope ON public.marks;
CREATE POLICY rms_account_marks_update_scope ON public.marks AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.rms_account_can_assessment(assessment_id)) WITH CHECK (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_account_marks_delete_scope ON public.marks;
CREATE POLICY rms_account_marks_delete_scope ON public.marks AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_dos_level_guard ON public.marks;
CREATE POLICY rms_dos_level_guard ON public.marks AS RESTRICTIVE FOR ALL TO authenticated
  USING (NOT public.rms_is_dos() OR public.rms_dos_can_marks(assessment_id))
  WITH CHECK (NOT public.rms_is_dos() OR public.rms_dos_can_marks(assessment_id));

-- --- assessment_types / grading / comments / reference (read-shared, DOS writes) ---
DROP POLICY IF EXISTS rms_assessment_types_select ON public.assessment_types;
CREATE POLICY rms_assessment_types_select ON public.assessment_types FOR SELECT USING (true);
DROP POLICY IF EXISTS rms_assessment_types_modify ON public.assessment_types;
CREATE POLICY rms_assessment_types_modify ON public.assessment_types FOR ALL
  USING (public.rms_is_dos()) WITH CHECK (public.rms_is_dos());
DROP POLICY IF EXISTS rms_account_assessment_types_select ON public.assessment_types;
CREATE POLICY rms_account_assessment_types_select ON public.assessment_types FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_account_assessment_types_insert ON public.assessment_types;
CREATE POLICY rms_account_assessment_types_insert ON public.assessment_types FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_assessment_types_update ON public.assessment_types;
CREATE POLICY rms_account_assessment_types_update ON public.assessment_types FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos') WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_assessment_types_delete ON public.assessment_types;
CREATE POLICY rms_account_assessment_types_delete ON public.assessment_types FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_report_reference_assessment_types_select ON public.assessment_types;
CREATE POLICY rms_report_reference_assessment_types_select ON public.assessment_types FOR SELECT
  USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS rms_account_grading_scales_select ON public.grading_scales;
CREATE POLICY rms_account_grading_scales_select ON public.grading_scales FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_account_grading_scales_insert ON public.grading_scales;
CREATE POLICY rms_account_grading_scales_insert ON public.grading_scales FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_grading_scales_update ON public.grading_scales;
CREATE POLICY rms_account_grading_scales_update ON public.grading_scales FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos') WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_grading_scales_delete ON public.grading_scales;
CREATE POLICY rms_account_grading_scales_delete ON public.grading_scales FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_report_reference_grading_select ON public.grading_scales;
CREATE POLICY rms_report_reference_grading_select ON public.grading_scales FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS rms_performance_comments_all ON public.performance_comments;
CREATE POLICY rms_performance_comments_all ON public.performance_comments FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS rms_account_performance_comments_select ON public.performance_comments;
CREATE POLICY rms_account_performance_comments_select ON public.performance_comments FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_account_performance_comments_insert ON public.performance_comments;
CREATE POLICY rms_account_performance_comments_insert ON public.performance_comments FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_performance_comments_update ON public.performance_comments;
CREATE POLICY rms_account_performance_comments_update ON public.performance_comments FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos') WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_performance_comments_delete ON public.performance_comments;
CREATE POLICY rms_account_performance_comments_delete ON public.performance_comments FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_academic_years_select ON public.academic_years;
CREATE POLICY rms_account_academic_years_select ON public.academic_years FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_account_academic_years_insert ON public.academic_years;
CREATE POLICY rms_account_academic_years_insert ON public.academic_years FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_academic_years_update ON public.academic_years;
CREATE POLICY rms_account_academic_years_update ON public.academic_years FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos') WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_academic_years_delete ON public.academic_years;
CREATE POLICY rms_account_academic_years_delete ON public.academic_years FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_report_reference_years_select ON public.academic_years;
CREATE POLICY rms_report_reference_years_select ON public.academic_years FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS rms_account_terms_select ON public.terms;
CREATE POLICY rms_account_terms_select ON public.terms FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS rms_account_terms_insert ON public.terms;
CREATE POLICY rms_account_terms_insert ON public.terms FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_terms_update ON public.terms;
CREATE POLICY rms_account_terms_update ON public.terms FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos') WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_terms_delete ON public.terms;
CREATE POLICY rms_account_terms_delete ON public.terms FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_report_reference_terms_select ON public.terms;
CREATE POLICY rms_report_reference_terms_select ON public.terms FOR SELECT USING (auth.uid() IS NOT NULL);

-- --- school_settings (readable pre-login for branding; DOS writes) ---
DROP POLICY IF EXISTS rms_account_school_settings_select ON public.school_settings;
CREATE POLICY rms_account_school_settings_select ON public.school_settings FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS rms_account_school_settings_insert ON public.school_settings;
CREATE POLICY rms_account_school_settings_insert ON public.school_settings FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_school_settings_update ON public.school_settings;
CREATE POLICY rms_account_school_settings_update ON public.school_settings FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos') WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_school_settings_delete ON public.school_settings;
CREATE POLICY rms_account_school_settings_delete ON public.school_settings FOR DELETE TO authenticated
  USING (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_report_reference_settings_select ON public.school_settings;
CREATE POLICY rms_report_reference_settings_select ON public.school_settings FOR SELECT USING (auth.uid() IS NOT NULL);

-- --- notifications ---
DROP POLICY IF EXISTS rms_account_notifications_select ON public.notifications;
CREATE POLICY rms_account_notifications_select ON public.notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_notifications_insert ON public.notifications;
CREATE POLICY rms_account_notifications_insert ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid()
    AND public.rms_account_can_send_notification(recipient_user_id, entity_type, entity_id));
DROP POLICY IF EXISTS rms_account_notifications_update ON public.notifications;
CREATE POLICY rms_account_notifications_update ON public.notifications FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid()) WITH CHECK (recipient_user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_notifications_delete ON public.notifications;
CREATE POLICY rms_account_notifications_delete ON public.notifications FOR DELETE TO authenticated
  USING (recipient_user_id = auth.uid() OR (public.rms_account_role() = 'dos'));
DROP POLICY IF EXISTS communication_private_notifications_select ON public.notifications;
CREATE POLICY communication_private_notifications_select ON public.notifications AS RESTRICTIVE FOR SELECT TO authenticated
  USING (entity_type IS DISTINCT FROM 'teacher_message' OR recipient_user_id = auth.uid());
DROP POLICY IF EXISTS communication_private_notifications_update ON public.notifications;
CREATE POLICY communication_private_notifications_update ON public.notifications AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (entity_type IS DISTINCT FROM 'teacher_message' OR recipient_user_id = auth.uid())
  WITH CHECK (entity_type IS DISTINCT FROM 'teacher_message' OR recipient_user_id = auth.uid());

-- --- announcements ---
DROP POLICY IF EXISTS communication_announcements_select ON public.announcements;
CREATE POLICY communication_announcements_select ON public.announcements FOR SELECT TO authenticated
  USING (public.rms_communication_can_read_announcement(id));
DROP POLICY IF EXISTS communication_announcements_insert ON public.announcements;
CREATE POLICY communication_announcements_insert ON public.announcements FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level));
DROP POLICY IF EXISTS communication_announcements_update ON public.announcements;
CREATE POLICY communication_announcements_update ON public.announcements FOR UPDATE TO authenticated
  USING (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level))
  WITH CHECK (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level));
DROP POLICY IF EXISTS communication_announcements_delete ON public.announcements;
CREATE POLICY communication_announcements_delete ON public.announcements FOR DELETE TO authenticated
  USING (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level));
DROP POLICY IF EXISTS rms_announcement_ack_all ON public.announcement_acknowledgements;
CREATE POLICY rms_announcement_ack_all ON public.announcement_acknowledgements FOR ALL USING (true) WITH CHECK (true);

-- --- messages / attachments ---
DROP POLICY IF EXISTS communication_messages_select ON public.messages;
CREATE POLICY communication_messages_select ON public.messages FOR SELECT TO authenticated
  USING (sender_user_id = auth.uid() OR recipient_user_id = auth.uid());
DROP POLICY IF EXISTS communication_messages_insert ON public.messages;
CREATE POLICY communication_messages_insert ON public.messages FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid()
    AND public.rms_communication_can_send_message(recipient_user_id, class_id, thread_id, parent_message_id));
DROP POLICY IF EXISTS communication_messages_update_read ON public.messages;
CREATE POLICY communication_messages_update_read ON public.messages FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid()) WITH CHECK (recipient_user_id = auth.uid());
DROP POLICY IF EXISTS communication_attachments_participant ON public.message_attachments;
CREATE POLICY communication_attachments_participant ON public.message_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id
    AND (m.sender_user_id = auth.uid() OR m.recipient_user_id = auth.uid())));
DROP POLICY IF EXISTS communication_attachments_insert ON public.message_attachments;
CREATE POLICY communication_attachments_insert ON public.message_attachments FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_user_id = auth.uid()));

-- --- documents ---
DROP POLICY IF EXISTS rms_account_documents_select ON public.documents;
CREATE POLICY rms_account_documents_select ON public.documents FOR SELECT TO authenticated
  USING (public.rms_account_can_document(id));
DROP POLICY IF EXISTS rms_account_documents_insert ON public.documents;
CREATE POLICY rms_account_documents_insert ON public.documents FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() AND (learner_id IS NULL OR public.rms_account_can_learner(learner_id)));
DROP POLICY IF EXISTS rms_account_documents_update ON public.documents;
CREATE POLICY rms_account_documents_update ON public.documents FOR UPDATE TO authenticated
  USING (public.rms_account_can_document(id))
  WITH CHECK (uploaded_by = auth.uid() OR public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_documents_delete ON public.documents;
CREATE POLICY rms_account_documents_delete ON public.documents FOR DELETE TO authenticated
  USING (public.rms_account_can_document(id));

-- --- audit / import / registration / mail queues ---
DROP POLICY IF EXISTS rms_account_audit_select ON public.audit_logs;
CREATE POLICY rms_account_audit_select ON public.audit_logs FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (public.rms_account_role() = 'dos' AND (
    (assessment_id IS NOT NULL AND public.rms_account_can_assessment(assessment_id))
    OR (learner_id IS NOT NULL AND public.rms_account_can_learner(learner_id)))));
DROP POLICY IF EXISTS rms_account_audit_insert ON public.audit_logs;
CREATE POLICY rms_account_audit_insert ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid()
    AND (assessment_id IS NULL OR public.rms_account_can_assessment(assessment_id))
    AND (learner_id IS NULL OR public.rms_account_can_learner(learner_id)));
DROP POLICY IF EXISTS rms_dos_can_insert_audit_logs ON public.audit_logs;
CREATE POLICY rms_dos_can_insert_audit_logs ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_dos());
DROP POLICY IF EXISTS rms_account_import_history_select ON public.import_history;
CREATE POLICY rms_account_import_history_select ON public.import_history FOR SELECT TO authenticated
  USING (user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_import_history_insert ON public.import_history;
CREATE POLICY rms_account_import_history_insert ON public.import_history FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS rms_account_registration_audit_select ON public.teacher_registration_audit;
CREATE POLICY rms_account_registration_audit_select ON public.teacher_registration_audit FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR registered_by_user_id = auth.uid() OR public.rms_account_can_access_user(user_id));
DROP POLICY IF EXISTS rms_account_registration_audit_insert ON public.teacher_registration_audit;
CREATE POLICY rms_account_registration_audit_insert ON public.teacher_registration_audit FOR INSERT TO authenticated
  WITH CHECK (registered_by_user_id = auth.uid() AND public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_registration_audit_update ON public.teacher_registration_audit;
CREATE POLICY rms_account_registration_audit_update ON public.teacher_registration_audit FOR UPDATE TO authenticated
  USING (registered_by_user_id = auth.uid() AND public.rms_account_role() = 'dos')
  WITH CHECK (registered_by_user_id = auth.uid() AND public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_email_notifications_select ON public.email_notifications;
CREATE POLICY rms_account_email_notifications_select ON public.email_notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() OR public.rms_account_can_access_user(recipient_user_id));
DROP POLICY IF EXISTS rms_account_email_notifications_insert ON public.email_notifications;
CREATE POLICY rms_account_email_notifications_insert ON public.email_notifications FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
DROP POLICY IF EXISTS rms_account_email_notifications_update ON public.email_notifications;
CREATE POLICY rms_account_email_notifications_update ON public.email_notifications FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id))
  WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
DROP POLICY IF EXISTS rms_account_sms_notifications_select ON public.sms_notifications;
CREATE POLICY rms_account_sms_notifications_select ON public.sms_notifications FOR SELECT TO authenticated
  USING (recipient_user_id = auth.uid() OR public.rms_account_can_access_user(recipient_user_id));
DROP POLICY IF EXISTS rms_account_sms_notifications_insert ON public.sms_notifications;
CREATE POLICY rms_account_sms_notifications_insert ON public.sms_notifications FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
DROP POLICY IF EXISTS rms_account_sms_notifications_update ON public.sms_notifications;
CREATE POLICY rms_account_sms_notifications_update ON public.sms_notifications FOR UPDATE TO authenticated
  USING (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id))
  WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));

-- ============================================================================
-- 8) TRIGGERS
-- ============================================================================
DROP TRIGGER IF EXISTS rms_account_guard_user_fields ON public.users;
CREATE TRIGGER rms_account_guard_user_fields BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.rms_account_guard_user_fields();
DROP TRIGGER IF EXISTS rms_account_guard_teacher_fields ON public.teachers;
CREATE TRIGGER rms_account_guard_teacher_fields BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.rms_account_guard_teacher_fields();
DROP TRIGGER IF EXISTS message_sender_snapshot ON public.messages;
CREATE TRIGGER message_sender_snapshot BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rms_message_before_insert();
DROP TRIGGER IF EXISTS message_read_status ON public.messages;
CREATE TRIGGER message_read_status BEFORE UPDATE OF is_read ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rms_message_read_status();
DROP TRIGGER IF EXISTS message_notification ON public.messages;
CREATE TRIGGER message_notification AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rms_notify_message_recipient();
DROP TRIGGER IF EXISTS announcement_publish_notifications ON public.announcements;
CREATE TRIGGER announcement_publish_notifications
  AFTER INSERT OR UPDATE OF published_at, status, audience_type, education_level, target_user_ids
  ON public.announcements FOR EACH ROW EXECUTE FUNCTION public.rms_announcement_publish_trigger();
DROP TRIGGER IF EXISTS trg_teacher_registration_audit ON public.teachers;
CREATE TRIGGER trg_teacher_registration_audit AFTER INSERT ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.handle_teacher_registration_audit();
DROP TRIGGER IF EXISTS trg_teacher_registration_log ON public.teachers;
CREATE TRIGGER trg_teacher_registration_log AFTER INSERT ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.handle_teacher_registration_log();

-- ============================================================================
-- 9) SEED REFERENCE DATA (idempotent)
-- ============================================================================
INSERT INTO grading_scales (minimum_percentage, maximum_percentage, grade, descriptor, remark, comment, is_pass, display_order, is_active)
SELECT * FROM (VALUES
  (80, 100, 'A', 'Excellent', 'Excellent', 'Excellent performance. Keep up the outstanding work.', TRUE, 1, TRUE),
  (75, 79, 'B', 'Very Good', 'Very Good', 'Very good performance. Strong understanding and consistent effort.', TRUE, 2, TRUE),
  (70, 74, 'C', 'Good', 'Good', 'Good performance. Continue practicing to improve further.', TRUE, 3, TRUE),
  (65, 69, 'D', 'Satisfactory', 'Satisfactory', 'Satisfactory performance. More practice and revision will help.', TRUE, 4, TRUE),
  (60, 64, 'E', 'Adequate', 'Adequate', 'Adequate performance. Continue working consistently.', TRUE, 5, TRUE),
  (50, 59, 'S', 'Minimum Pass', 'Minimum Pass', 'Minimum pass achieved. Increase effort and revise regularly.', TRUE, 6, TRUE),
  (0, 49, 'F', 'Fail', 'Fail', 'Performance needs improvement. Review fundamentals and seek support.', FALSE, 7, TRUE)
) AS v (minimum_percentage, maximum_percentage, grade, descriptor, remark, comment, is_pass, display_order, is_active)
WHERE NOT EXISTS (SELECT 1 FROM grading_scales);

INSERT INTO school_settings (school_name, pass_mark, ranking_enabled, decimal_marks_enabled)
SELECT 'Rukara Model School', 50, TRUE, FALSE
WHERE NOT EXISTS (SELECT 1 FROM school_settings);
UPDATE school_settings SET country = COALESCE(country, 'Republic of Rwanda'),
  ministry = COALESCE(ministry, 'Ministry of Education'), province = COALESCE(province, 'Eastern Province'),
  district = COALESCE(district, 'Kayonza'), sector = COALESCE(sector, 'Gahini'),
  school_code = COALESCE(school_code, '541023'),
  dos_primary_name = COALESCE(NULLIF(dos_primary_name, ''), 'Primary DOS'),
  dos_secondary_name = COALESCE(NULLIF(dos_secondary_name, ''), 'Secondary DOS');

INSERT INTO classes (name, level, stream, status)
SELECT * FROM (VALUES
  ('P1A','P1','A','active'), ('P1B','P1','B','active'),
  ('P2A','P2','A','active'), ('P2B','P2','B','active'),
  ('P3A','P3','A','active'), ('P3B','P3','B','active'),
  ('P4A','P4','A','active'), ('P4B','P4','B','active'),
  ('P5A','P5','A','active'), ('P5B','P5','B','active'),
  ('P6A','P6','A','active'), ('P6B','P6','B','active'),
  ('S1','S1',NULL,'active'), ('S2','S2',NULL,'active'), ('S3','S3',NULL,'active'),
  ('S4 – Stream 1','S4','Stream 1','active'), ('S4 – Stream 2','S4','Stream 2','active'),
  ('S5 – Stream 1','S5','Stream 1','active'), ('S5 – Stream 2','S5','Stream 2','active'),
  ('S6 – MEG','S6','MEG','active'), ('S6 – PCM','S6','PCM','active'), ('S6 – MCE','S6','MCE','active')
) AS v (name, level, stream, status)
WHERE NOT EXISTS (SELECT 1 FROM classes c WHERE c.name = v.name);

INSERT INTO subjects (name, code, status)
SELECT * FROM (VALUES
  ('Mathematics','MATH','active'), ('English','ENG','active'), ('Kinyarwanda','KIN','active'),
  ('French','FRE','active'), ('Kiswahili','KISW','active'), ('Physics','PHY','active'),
  ('Chemistry','CHEM','active'), ('Biology and Health Sciences','BIO','active'),
  ('Geography and Environment','GEO','active'), ('History and Citizenship','HIST','active'),
  ('Entrepreneurship','ENT','active'), ('ICT','ICT','active'), ('Computer Science','CS','active'),
  ('Economics','ECON','active'), ('Psychology','PSY','active'), ('Literature in English','LIT','active'),
  ('General Studies and Communication Skills (GSCS)','GSCS','active'),
  ('Subsidiary Mathematics','SUB_MATH','active'), ('Religion and Ethics','REL_ETH','active'),
  ('Religious Studies','REL_STU','active'), ('Physical Education and Sports','PES','active'),
  ('Music, Dance and Drama','MDD','active'), ('Fine Arts and Crafts','FAC','active'),
  ('Home Sciences','HS','active'), ('Farming (Agriculture and Animal Husbandry)','FARM','active'),
  ('Science and Elementary Technology','SET','active'), ('Social and Religious Studies','SRS','active'),
  ('Creative Arts','CA','active'), ('Physical Education','PE','active')
) AS v (name, code, status)
WHERE NOT EXISTS (SELECT 1 FROM subjects s WHERE UPPER(TRIM(s.name)) = UPPER(TRIM(v.name)))
  AND NOT EXISTS (SELECT 1 FROM subjects s WHERE UPPER(TRIM(s.code)) = UPPER(TRIM(v.code)));

INSERT INTO assessment_types (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status, period_hint, is_standard)
SELECT * FROM (VALUES
  ('Weekly Test','WKT','Weekly classroom test',10,NULL::NUMERIC,TRUE,1,'active','week',TRUE),
  ('Monthly Test','MLT','Monthly assessment',20,NULL::NUMERIC,TRUE,2,'active','month',TRUE),
  ('Beginning of Term Exam','BOT','Beginning of term examination',50,NULL::NUMERIC,TRUE,3,'active','term',TRUE),
  ('Mid-Term Exam','MTE','Mid-term examination',50,NULL::NUMERIC,TRUE,4,'active','term',TRUE),
  ('End of Term Exam','EOT','End of term examination',100,NULL::NUMERIC,TRUE,5,'active','term',TRUE),
  ('Quiz','QUIZ','Short quiz',20,NULL::NUMERIC,TRUE,6,'active',NULL,TRUE),
  ('Assignment','ASGMT','Take-home assignment',20,NULL::NUMERIC,TRUE,7,'active',NULL,TRUE),
  ('Practical','PRAC','Practical assessment',30,NULL::NUMERIC,TRUE,8,'active',NULL,TRUE),
  ('Class Exercise','CEXE','Class exercise',10,NULL::NUMERIC,TRUE,9,'active',NULL,TRUE),
  ('Homework','HW','Homework',10,NULL::NUMERIC,TRUE,10,'active',NULL,TRUE),
  ('Oral','ORAL','Oral assessment',10,NULL::NUMERIC,TRUE,11,'active',NULL,TRUE),
  ('End of Unit','EOU','End-of-unit assessment',30,NULL::NUMERIC,TRUE,12,'active','unit',TRUE),
  ('Other','OTHER','Other assessment',30,NULL::NUMERIC,TRUE,13,'active','other',TRUE)
) AS v (name, code, description, default_maximum_mark, weight, contributes_to_combined, display_order, status, period_hint, is_standard)
ON CONFLICT (name) DO UPDATE SET code = EXCLUDED.code, description = EXCLUDED.description,
  default_maximum_mark = EXCLUDED.default_maximum_mark, display_order = EXCLUDED.display_order,
  status = EXCLUDED.status, period_hint = EXCLUDED.period_hint, is_standard = EXCLUDED.is_standard;

INSERT INTO performance_comments (min_percentage, max_percentage, comment, level, active)
SELECT * FROM (VALUES
  (90, 100, 'Outstanding performance. Keep it up.', 'All', TRUE),
  (80, 89.99, 'Excellent performance.', 'All', TRUE),
  (70, 79.99, 'Very good performance.', 'All', TRUE),
  (60, 69.99, 'Good performance.', 'All', TRUE),
  (50, 59.99, 'Satisfactory performance.', 'All', TRUE),
  (40, 49.99, 'Performance needs improvement.', 'All', TRUE),
  (0, 39.99, 'Needs significant improvement.', 'All', TRUE)
) AS v (min_percentage, max_percentage, comment, level, active)
WHERE NOT EXISTS (SELECT 1 FROM performance_comments);

-- Backfill assessment abbreviation codes where missing (unique initials).
DO $do$
DECLARE r RECORD; base TEXT; cand TEXT; n INT;
BEGIN
  FOR r IN SELECT id, name FROM assessment_types WHERE code IS NULL OR btrim(code) = '' LOOP
    base := upper(regexp_replace(split_part(btrim(r.name), ' ', 1), '[^A-Za-z]', '', 'g'));
    cand := substring(base, 1, 4); n := 1;
    WHILE EXISTS (SELECT 1 FROM assessment_types WHERE id <> r.id AND upper(btrim(code)) = cand) LOOP
      n := n + 1; cand := substring(base, 1, 3) || n::text;
    END LOOP;
    UPDATE assessment_types SET code = cand WHERE id = r.id;
  END LOOP;
END $do$;

-- Backfill assessments without a type to End of Unit.
UPDATE assessments SET assessment_type_id = (SELECT id FROM assessment_types WHERE code = 'EOU' LIMIT 1)
WHERE assessment_type_id IS NULL AND EXISTS (SELECT 1 FROM assessment_types WHERE code = 'EOU');

-- ============================================================================
-- 10) PERFORMANCE INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_education_level ON users(education_level);
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_code ON teachers(teacher_code);
CREATE INDEX IF NOT EXISTS idx_teachers_education_level ON teachers(education_level);
CREATE INDEX IF NOT EXISTS idx_learners_class_id ON learners(class_id);
CREATE INDEX IF NOT EXISTS idx_learners_code ON learners(learner_code);
CREATE INDEX IF NOT EXISTS idx_learners_status ON learners(status);
CREATE INDEX IF NOT EXISTS idx_learners_class_status ON learners(class_id, status);
CREATE INDEX IF NOT EXISTS idx_learners_class_academic_status ON learners(class_id, academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_learners_wizard_class_status_name ON learners(class_id, status, full_name);
CREATE INDEX IF NOT EXISTS idx_learners_wizard_code ON learners(learner_code);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_id ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class_id ON teacher_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject_id ON teacher_assignments(subject_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class_subject ON teacher_assignments(teacher_id, class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class ON teacher_assignments(teacher_id, class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_wizard_all ON teacher_assignments(teacher_id, class_id, subject_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_scope ON teacher_assignments(class_id, subject_id, academic_year_id, term_id);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_id ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_class_id ON assessments(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_subject_id ON assessments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status);
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_class ON assessments(teacher_id, class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_assessment_type_id ON assessments(assessment_type_id);
CREATE INDEX IF NOT EXISTS idx_assessments_period_type ON assessments(period_type);
CREATE INDEX IF NOT EXISTS idx_assessments_period_label ON assessments(period_label);
CREATE INDEX IF NOT EXISTS idx_assessments_unit_number ON assessments(unit_number);
CREATE INDEX IF NOT EXISTS idx_assessments_report_scope ON assessments(class_id, academic_year_id, term_id, subject_id, status);
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_main ON assessments(class_id, subject_id, academic_year_id, term_id, status, assessment_date DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_year_term ON assessments(academic_year_id, term_id, status);
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_type_status ON assessments(assessment_type_id, status);
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_teacher ON assessments(teacher_id, academic_year_id, status);
CREATE INDEX IF NOT EXISTS idx_marks_assessment_id ON marks(assessment_id);
CREATE INDEX IF NOT EXISTS idx_marks_learner_id ON marks(learner_id);
CREATE INDEX IF NOT EXISTS idx_marks_assessment_learner ON marks(assessment_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_marks_learner_assessment ON marks(learner_id, assessment_id);
CREATE INDEX IF NOT EXISTS idx_marks_wizard_learner_assessment ON marks(learner_id, assessment_id) WHERE mark IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marks_wizard_percentage ON marks(percentage) WHERE percentage IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_announcements_sender ON announcements(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcement_ack_user ON announcement_acknowledgements(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_ack_announce ON announcement_acknowledgements(announcement_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_subject ON messages(subject);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages(recipient_user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_recipient ON email_notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_status ON email_notifications(status);
CREATE INDEX IF NOT EXISTS idx_email_notifications_created ON email_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_recipient ON sms_notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_status ON sms_notifications(status);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_created ON sms_notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_tchg_reg_audit_teacher ON teacher_registration_audit(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tchg_reg_audit_user ON teacher_registration_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_tchg_reg_audit_registered_by ON teacher_registration_audit(registered_by_user_id);
CREATE INDEX IF NOT EXISTS idx_classes_level ON classes(level);
CREATE INDEX IF NOT EXISTS idx_classes_status ON classes(status);
CREATE INDEX IF NOT EXISTS idx_classes_academic_year_id ON classes(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_classes_education_level ON classes(education_level);
CREATE INDEX IF NOT EXISTS idx_classes_wizard_level ON classes(level, name);
CREATE INDEX IF NOT EXISTS idx_classes_wizard_edu_level ON classes(education_level, name);
CREATE INDEX IF NOT EXISTS idx_classes_wizard_stream ON classes(stream) WHERE stream IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_subjects_status ON subjects(status);
CREATE INDEX IF NOT EXISTS idx_subjects_code ON subjects(code);
CREATE INDEX IF NOT EXISTS idx_subjects_wizard_code ON subjects(code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_class_subjects_class ON class_subjects(class_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_subject ON class_subjects(subject_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_wizard_class ON class_subjects(class_id, subject_id);
CREATE INDEX IF NOT EXISTS idx_class_subjects_wizard_subject ON class_subjects(subject_id, class_id);
CREATE INDEX IF NOT EXISTS idx_terms_academic_year ON terms(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_terms_wizard_year_no ON terms(academic_year_id, term_no);
CREATE INDEX IF NOT EXISTS idx_academic_years_wizard_status ON academic_years(status, name);
CREATE INDEX IF NOT EXISTS idx_grading_scales_active_order ON grading_scales(is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_grading_scales_wizard_range ON grading_scales(minimum_percentage, maximum_percentage);
CREATE INDEX IF NOT EXISTS idx_performance_comments_active_range ON performance_comments(active, min_percentage DESC);

-- ============================================================================
-- 11) STORAGE (documents private, message-attachments private, photos public)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO UPDATE SET public = false;
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;
INSERT INTO storage.buckets (id, name, public, file_size_limit,
  allowed_mime_types)
VALUES ('message-attachments', 'message-attachments', false, 52428800,
  ARRAY['image/jpeg','image/png','image/gif','image/webp','video/mp4','audio/mpeg','application/pdf',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain','application/zip','application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public = false;

DO $do$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
  END LOOP;
END $do$;

DROP POLICY IF EXISTS rms_account_documents_storage_select ON storage.objects;
CREATE POLICY rms_account_documents_storage_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'documents' AND EXISTS (
    SELECT 1 FROM public.documents d WHERE d.storage_path = name AND public.rms_account_can_document(d.id)));
DROP POLICY IF EXISTS rms_account_documents_storage_insert ON storage.objects;
CREATE POLICY rms_account_documents_storage_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'documents' AND public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_documents_storage_update ON storage.objects;
CREATE POLICY rms_account_documents_storage_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'documents' AND public.rms_account_role() = 'dos')
  WITH CHECK (bucket_id = 'documents' AND public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS rms_account_documents_storage_delete ON storage.objects;
CREATE POLICY rms_account_documents_storage_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'documents' AND public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS communication_message_files_insert ON storage.objects;
CREATE POLICY communication_message_files_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'message-attachments');
DROP POLICY IF EXISTS communication_message_files_select ON storage.objects;
CREATE POLICY communication_message_files_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'message-attachments');
DROP POLICY IF EXISTS communication_message_files_delete ON storage.objects;
CREATE POLICY communication_message_files_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'message-attachments');
DROP POLICY IF EXISTS "Public Access profile-photos" ON storage.objects;
CREATE POLICY "Public Access profile-photos" ON storage.objects FOR SELECT USING (bucket_id = 'profile-photos');
DROP POLICY IF EXISTS rms_profile_photos_owner_insert ON storage.objects;
CREATE POLICY rms_profile_photos_owner_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-photos' AND EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND name LIKE 'teacher-photos/' || t.id::text || '.%'));
DROP POLICY IF EXISTS rms_profile_photos_owner_update ON storage.objects;
CREATE POLICY rms_profile_photos_owner_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-photos' AND EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND name LIKE 'teacher-photos/' || t.id::text || '.%'))
  WITH CHECK (bucket_id = 'profile-photos' AND EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND name LIKE 'teacher-photos/' || t.id::text || '.%'));
DROP POLICY IF EXISTS rms_profile_photos_owner_delete ON storage.objects;
CREATE POLICY rms_profile_photos_owner_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-photos' AND EXISTS (
    SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND name LIKE 'teacher-photos/' || t.id::text || '.%'));

-- ============================================================================
-- 12) GRANTS + FUNCTION LOCKDOWN (least privilege)
-- ============================================================================
-- NOTE: "GRANT ... ON ALL TABLES IN SCHEMA" is a one-time snapshot. It only
-- covers tables that already exist when it runs, so a table created afterwards
-- gets no grant and PostgREST answers 403 (not an empty list). ALTER DEFAULT
-- PRIVILEGES below is what keeps newly created tables accessible.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated;
GRANT SELECT ON TABLE public.education_levels TO authenticated, anon;
GRANT SELECT ON TABLE public.performance_comments TO anon, authenticated;
GRANT SELECT ON TABLE public.school_settings TO anon;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.messages TO authenticated;
GRANT SELECT, INSERT ON public.message_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
REVOKE ALL ON TABLE public.messages FROM anon;
REVOKE ALL ON TABLE public.message_attachments FROM anon;
DO $do$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['users','teachers','learners','classes','subjects','teacher_assignments',
    'assessments','marks','notifications','audit_logs','import_history','teacher_registration_audit',
    'email_notifications','sms_notifications','documents','academic_years','terms','grading_scales',
    'assessment_types','performance_comments'] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_table);
    END IF;
  END LOOP;
END $do$;

REVOKE ALL ON FUNCTION public.rms_account_role() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_teacher_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_access_user(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_teacher(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_class(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_subject(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_learner(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_assessment(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_assessment_fields(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_assignment(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_document(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_account_can_send_notification(UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_notification_recipients(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_account_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_teacher_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_access_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_teacher(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_subject(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_learner(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_assessment(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_assessment_fields(UUID, UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_assignment(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_document(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_account_can_send_notification(UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_notification_recipients(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_report_teacher_has_class(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_report_teacher_has_subject(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_report_teacher_has_learner(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.send_welcome_notifications(TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT,TEXT,TEXT,UUID,UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_welcome_notifications(TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,TEXT,TEXT,TEXT,UUID,UUID)
  TO service_role;
REVOKE ALL ON FUNCTION public.send_message(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- ============================================================================
-- 13) TEACHER DELETION (atomic, dependency-ordered)
-- Removes a teacher with everything they own in one transaction: their
-- assessments and every mark recorded against them, their class/subject
-- assignments, class headteacher links and registration audit rows, then the
-- teacher profile and login record. SECURITY DEFINER so dependent rows are
-- removed regardless of the caller's row-level visibility; the DOS scope check
-- below is what authorises it. Replaces the RLS DELETE policies on
-- users/teachers (kept as a fallback for direct deletes).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rms_release_fk_refs(p_parent REGCLASS, p_key UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  r RECORD;
  v_sql TEXT;
BEGIN
  IF p_key IS NULL THEN
    RETURN;
  END IF;
  -- Discover every single-column NO ACTION / RESTRICT foreign key that points
  -- at the given parent row and clear it, so a delete can never be blocked by
  -- schema drift (older tables added by earlier migrations). Required columns
  -- are removed with their row; optional ones are nulled (history preserved).
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname::text AS col, a.attnotnull AS required
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.confrelid = p_parent
      AND c.confdeltype IN ('a', 'r')
      AND array_length(c.conkey, 1) = 1
  LOOP
    IF r.required THEN
      v_sql := 'DELETE FROM ' || r.tbl || ' WHERE ' || quote_ident(r.col) || ' = $1';
    ELSE
      v_sql := 'UPDATE ' || r.tbl || ' SET ' || quote_ident(r.col) || ' = NULL WHERE ' || quote_ident(r.col) || ' = $1';
    END IF;
    EXECUTE v_sql USING p_key;
  END LOOP;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_release_fk_refs(REGCLASS, UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.rms_delete_teacher(p_teacher_id UUID)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user_id UUID;
  a_id UUID;
BEGIN
  IF p_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Teacher not found';
  END IF;
  IF public.rms_account_role() <> 'dos' OR NOT public.rms_is_scoped_dos()
     OR NOT public.rms_teacher_in_scope(p_teacher_id) THEN
    RAISE EXCEPTION 'Not permitted to delete this teacher';
  END IF;

  SELECT t.user_id INTO v_user_id FROM public.teachers t WHERE t.id = p_teacher_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Teacher not found';
  END IF;

  -- 1) Assessments owned by this teacher: clear anything pointing at them first,
  --    then their marks, then the assessments themselves.
  FOR a_id IN SELECT a.id FROM public.assessments a WHERE a.teacher_id = p_teacher_id LOOP
    PERFORM public.rms_release_fk_refs('public.assessments'::regclass, a_id);
  END LOOP;
  DELETE FROM public.marks
  WHERE assessment_id IN (SELECT a.id FROM public.assessments a WHERE a.teacher_id = p_teacher_id);
  DELETE FROM public.assessments WHERE teacher_id = p_teacher_id;

  -- 2) Everything attached to the teacher.
  DELETE FROM public.teacher_assignments WHERE teacher_id = p_teacher_id;
  DELETE FROM public.teacher_registration_audit WHERE teacher_id = p_teacher_id;
  UPDATE public.classes SET class_teacher_id = NULL WHERE class_teacher_id = p_teacher_id;

  -- 3) Login record, then the teacher profile (each preceded by a sweep of
  --    any remaining blocking references).
  IF v_user_id IS NOT NULL THEN
    PERFORM public.rms_release_fk_refs('public.users'::regclass, v_user_id);
    DELETE FROM public.users WHERE id = v_user_id;
  END IF;
  PERFORM public.rms_release_fk_refs('public.teachers'::regclass, p_teacher_id);
  DELETE FROM public.teachers WHERE id = p_teacher_id;
  RETURN TRUE;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.rms_delete_teacher(UUID) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rms_delete_teacher(UUID) FROM anon;

-- ============================================================================
-- 14) REALTIME + SCHEDULED PUBLISHER
-- ============================================================================
DO $do$
DECLARE v_table TEXT;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    FOREACH v_table IN ARRAY ARRAY['messages', 'announcements'] LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table) THEN
        EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      END IF;
    END LOOP;
  END IF;
END $do$;

DO $do$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rms-publish-due-announcements') THEN
    PERFORM cron.schedule('rms-publish-due-announcements', '* * * * *',
      'SELECT public.rms_publish_due_announcements()');
  END IF;
END $do$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- END OF MASTER SETUP. Verification (run after applying):
--   SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public' ORDER BY 1;
--   SELECT tablename, policyname, cmd FROM pg_policies WHERE schemaname='public' ORDER BY 1,2;
--   SELECT code FROM education_levels ORDER BY display_order;
--   SELECT count(*) FROM grading_scales; SELECT count(*) FROM assessment_types;
-- ============================================================================
