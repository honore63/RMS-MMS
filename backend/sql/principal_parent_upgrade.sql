-- ============================================================================
-- RMS-MIS PRINCIPAL + PARENT/STUDENT UPGRADE
-- ============================================================================
-- This migration adds:
--   1. 'principal' and 'parent' roles to the users table
--   2. learner_id column on users (for parent → learner linking)
--   3. RLS policies for principal (school-wide, no level restriction)
--   4. RLS policies for parent (linked learner only, view-only published results)
--   5. Helper functions for principal and parent access checks
--
-- SAFE TO RUN MULTIPLE TIMES (idempotent).
-- ============================================================================

-- ============================================================================
-- 1. EXTEND ROLE CHECK CONSTRAINT
-- ============================================================================
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users ADD CONSTRAINT users_role_check
  CHECK (role IN ('dos', 'teacher', 'headteacher', 'principal', 'parent'));

-- ============================================================================
-- 2. ADD learner_id COLUMN TO users (for parent → learner linking)
-- ============================================================================
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS learner_id UUID REFERENCES public.learners(id);

-- ============================================================================
-- 3. HELPER FUNCTIONS
-- ============================================================================

-- Check if current user is an active principal
CREATE OR REPLACE FUNCTION public.rms_is_principal()
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'principal' AND u.status = 'active'
  );
$fn$;

-- Check if current user is an active parent
CREATE OR REPLACE FUNCTION public.rms_is_parent()
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'parent' AND u.status = 'active'
  );
$fn$;

-- Get the learner_id linked to the current parent account
CREATE OR REPLACE FUNCTION public.rms_parent_learner_id()
RETURNS UUID LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT u.learner_id FROM public.users u
  WHERE u.id = auth.uid() AND u.role = 'parent' AND u.status = 'active'
  LIMIT 1;
$fn$;

-- Check if a parent can access a specific learner
CREATE OR REPLACE FUNCTION public.rms_parent_can_learner(p_learner_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid()
      AND u.role = 'parent'
      AND u.status = 'active'
      AND u.learner_id = p_learner_id
  );
$fn$;

-- Check if a parent can access a specific assessment (via learner's class)
CREATE OR REPLACE FUNCTION public.rms_parent_can_assessment(p_assessment_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.learners l ON l.id = u.learner_id
    JOIN public.assessments a ON a.class_id = l.class_id
    WHERE u.id = auth.uid()
      AND u.role = 'parent'
      AND u.status = 'active'
      AND a.id = p_assessment_id
  );
$fn$;

-- Check if a parent can access a specific mark (via learner)
CREATE OR REPLACE FUNCTION public.rms_parent_can_mark(p_mark_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.marks m ON m.learner_id = u.learner_id
    WHERE u.id = auth.uid()
      AND u.role = 'parent'
      AND u.status = 'active'
      AND m.id = p_mark_id
  );
$fn$;

-- Check if a parent can access a specific performance comment
CREATE OR REPLACE FUNCTION public.rms_parent_can_comment(p_comment_id UUID)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    JOIN public.performance_comments pc ON pc.learner_id = u.learner_id
    WHERE u.id = auth.uid()
      AND u.role = 'parent'
      AND u.status = 'active'
      AND pc.id = p_comment_id
  );
$fn$;

-- ============================================================================
-- 4. PRINCIPAL RLS POLICIES (school-wide, no level restriction)
-- ============================================================================
-- Principal can read/write ALL data across both Primary and Secondary.
-- These policies are PERMISSIVE and do NOT have the rms_dos_level_guard.

-- users table
DROP POLICY IF EXISTS rms_principal_users_select ON public.users;
CREATE POLICY rms_principal_users_select ON public.users
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_users_insert ON public.users;
CREATE POLICY rms_principal_users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_users_update ON public.users;
CREATE POLICY rms_principal_users_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_users_delete ON public.users;
CREATE POLICY rms_principal_users_delete ON public.users
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- teachers table
DROP POLICY IF EXISTS rms_principal_teachers_select ON public.teachers;
CREATE POLICY rms_principal_teachers_select ON public.teachers
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_teachers_insert ON public.teachers;
CREATE POLICY rms_principal_teachers_insert ON public.teachers
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_teachers_update ON public.teachers;
CREATE POLICY rms_principal_teachers_update ON public.teachers
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_teachers_delete ON public.teachers;
CREATE POLICY rms_principal_teachers_delete ON public.teachers
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- learners table
DROP POLICY IF EXISTS rms_principal_learners_select ON public.learners;
CREATE POLICY rms_principal_learners_select ON public.learners
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_learners_insert ON public.learners;
CREATE POLICY rms_principal_learners_insert ON public.learners
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_learners_update ON public.learners;
CREATE POLICY rms_principal_learners_update ON public.learners
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_learners_delete ON public.learners;
CREATE POLICY rms_principal_learners_delete ON public.learners
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- classes table
DROP POLICY IF EXISTS rms_principal_classes_select ON public.classes;
CREATE POLICY rms_principal_classes_select ON public.classes
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_classes_insert ON public.classes;
CREATE POLICY rms_principal_classes_insert ON public.classes
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_classes_update ON public.classes;
CREATE POLICY rms_principal_classes_update ON public.classes
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_classes_delete ON public.classes;
CREATE POLICY rms_principal_classes_delete ON public.classes
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- subjects table
DROP POLICY IF EXISTS rms_principal_subjects_select ON public.subjects;
CREATE POLICY rms_principal_subjects_select ON public.subjects
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_subjects_insert ON public.subjects;
CREATE POLICY rms_principal_subjects_insert ON public.subjects
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_subjects_update ON public.subjects;
CREATE POLICY rms_principal_subjects_update ON public.subjects
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_subjects_delete ON public.subjects;
CREATE POLICY rms_principal_subjects_delete ON public.subjects
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- assessments table
DROP POLICY IF EXISTS rms_principal_assessments_select ON public.assessments;
CREATE POLICY rms_principal_assessments_select ON public.assessments
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_assessments_insert ON public.assessments;
CREATE POLICY rms_principal_assessments_insert ON public.assessments
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_assessments_update ON public.assessments;
CREATE POLICY rms_principal_assessments_update ON public.assessments
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_assessments_delete ON public.assessments;
CREATE POLICY rms_principal_assessments_delete ON public.assessments
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- marks table
DROP POLICY IF EXISTS rms_principal_marks_select ON public.marks;
CREATE POLICY rms_principal_marks_select ON public.marks
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_marks_insert ON public.marks;
CREATE POLICY rms_principal_marks_insert ON public.marks
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_marks_update ON public.marks;
CREATE POLICY rms_principal_marks_update ON public.marks
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_marks_delete ON public.marks;
CREATE POLICY rms_principal_marks_delete ON public.marks
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- assessment_types table
DROP POLICY IF EXISTS rms_principal_assessment_types_select ON public.assessment_types;
CREATE POLICY rms_principal_assessment_types_select ON public.assessment_types
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_assessment_types_insert ON public.assessment_types;
CREATE POLICY rms_principal_assessment_types_insert ON public.assessment_types
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_assessment_types_update ON public.assessment_types;
CREATE POLICY rms_principal_assessment_types_update ON public.assessment_types
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_assessment_types_delete ON public.assessment_types;
CREATE POLICY rms_principal_assessment_types_delete ON public.assessment_types
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- teacher_assignments table
DROP POLICY IF EXISTS rms_principal_teacher_assignments_select ON public.teacher_assignments;
CREATE POLICY rms_principal_teacher_assignments_select ON public.teacher_assignments
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_teacher_assignments_insert ON public.teacher_assignments;
CREATE POLICY rms_principal_teacher_assignments_insert ON public.teacher_assignments
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_teacher_assignments_update ON public.teacher_assignments;
CREATE POLICY rms_principal_teacher_assignments_update ON public.teacher_assignments
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_teacher_assignments_delete ON public.teacher_assignments;
CREATE POLICY rms_principal_teacher_assignments_delete ON public.teacher_assignments
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- notifications table
DROP POLICY IF EXISTS rms_principal_notifications_select ON public.notifications;
CREATE POLICY rms_principal_notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_notifications_insert ON public.notifications;
CREATE POLICY rms_principal_notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_notifications_update ON public.notifications;
CREATE POLICY rms_principal_notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_notifications_delete ON public.notifications;
CREATE POLICY rms_principal_notifications_delete ON public.notifications
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- announcements table
DROP POLICY IF EXISTS rms_principal_announcements_select ON public.announcements;
CREATE POLICY rms_principal_announcements_select ON public.announcements
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_announcements_insert ON public.announcements;
CREATE POLICY rms_principal_announcements_insert ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_announcements_update ON public.announcements;
CREATE POLICY rms_principal_announcements_update ON public.announcements
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_announcements_delete ON public.announcements;
CREATE POLICY rms_principal_announcements_delete ON public.announcements
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- audit_logs table
DROP POLICY IF EXISTS rms_principal_audit_logs_select ON public.audit_logs;
CREATE POLICY rms_principal_audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_audit_logs_insert ON public.audit_logs;
CREATE POLICY rms_principal_audit_logs_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

-- school_settings table
DROP POLICY IF EXISTS rms_principal_school_settings_select ON public.school_settings;
CREATE POLICY rms_principal_school_settings_select ON public.school_settings
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_school_settings_insert ON public.school_settings;
CREATE POLICY rms_principal_school_settings_insert ON public.school_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_school_settings_update ON public.school_settings;
CREATE POLICY rms_principal_school_settings_update ON public.school_settings
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_school_settings_delete ON public.school_settings;
CREATE POLICY rms_principal_school_settings_delete ON public.school_settings
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- performance_comments table
DROP POLICY IF EXISTS rms_principal_performance_comments_select ON public.performance_comments;
CREATE POLICY rms_principal_performance_comments_select ON public.performance_comments
  FOR SELECT TO authenticated
  USING (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_performance_comments_insert ON public.performance_comments;
CREATE POLICY rms_principal_performance_comments_insert ON public.performance_comments
  FOR INSERT TO authenticated
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_performance_comments_update ON public.performance_comments;
CREATE POLICY rms_principal_performance_comments_update ON public.performance_comments
  FOR UPDATE TO authenticated
  USING (public.rms_is_principal())
  WITH CHECK (public.rms_is_principal());

DROP POLICY IF EXISTS rms_principal_performance_comments_delete ON public.performance_comments;
CREATE POLICY rms_principal_performance_comments_delete ON public.performance_comments
  FOR DELETE TO authenticated
  USING (public.rms_is_principal());

-- ============================================================================
-- 5. PARENT RLS POLICIES (linked learner only, view-only published results)
-- ============================================================================
-- Parents can ONLY read data for their linked learner.
-- They can ONLY see assessments that are 'approved' or 'locked' (published).
-- They can ONLY see marks that are 'locked' (published).
-- They CANNOT insert, update, or delete anything.

-- learners table (read-only, linked learner only)
DROP POLICY IF EXISTS rms_parent_learners_select ON public.learners;
CREATE POLICY rms_parent_learners_select ON public.learners
  FOR SELECT TO authenticated
  USING (public.rms_parent_can_learner(id));

-- assessments table (read-only, linked learner's class, approved/locked only)
DROP POLICY IF EXISTS rms_parent_assessments_select ON public.assessments;
CREATE POLICY rms_parent_assessments_select ON public.assessments
  FOR SELECT TO authenticated
  USING (
    public.rms_parent_can_assessment(id)
    AND status IN ('approved', 'locked')
  );

-- marks table (read-only, linked learner, locked only)
DROP POLICY IF EXISTS rms_parent_marks_select ON public.marks;
CREATE POLICY rms_parent_marks_select ON public.marks
  FOR SELECT TO authenticated
  USING (
    public.rms_parent_can_mark(id)
    AND status = 'locked'
  );

-- performance_comments table (read-only, linked learner)
DROP POLICY IF EXISTS rms_parent_performance_comments_select ON public.performance_comments;
CREATE POLICY rms_parent_performance_comments_select ON public.performance_comments
  FOR SELECT TO authenticated
  USING (public.rms_parent_can_comment(id));

-- assessment_types table (read-only, all types)
DROP POLICY IF EXISTS rms_parent_assessment_types_select ON public.assessment_types;
CREATE POLICY rms_parent_assessment_types_select ON public.assessment_types
  FOR SELECT TO authenticated
  USING (public.rms_is_parent());

-- classes table (read-only, linked learner's class)
DROP POLICY IF EXISTS rms_parent_classes_select ON public.classes;
CREATE POLICY rms_parent_classes_select ON public.classes
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.learners l ON l.id = u.learner_id
      WHERE u.id = auth.uid() AND u.role = 'parent' AND u.status = 'active'
        AND l.class_id = classes.id
    )
  );

-- subjects table (read-only, all subjects)
DROP POLICY IF EXISTS rms_parent_subjects_select ON public.subjects;
CREATE POLICY rms_parent_subjects_select ON public.subjects
  FOR SELECT TO authenticated
  USING (public.rms_is_parent());

-- notifications table (read-only, recipient only)
DROP POLICY IF EXISTS rms_parent_notifications_select ON public.notifications;
CREATE POLICY rms_parent_notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (
    recipient_user_id = auth.uid()
    AND public.rms_is_parent()
  );

-- announcements table (read-only, published announcements)
DROP POLICY IF EXISTS rms_parent_announcements_select ON public.announcements;
CREATE POLICY rms_parent_announcements_select ON public.announcements
  FOR SELECT TO authenticated
  USING (
    public.rms_is_parent()
    AND published_at IS NOT NULL
    AND published_at <= NOW()
    AND (expires_at IS NULL OR expires_at > NOW())
  );

-- ============================================================================
-- 6. GRANTS
-- ============================================================================
GRANT SELECT ON public.users TO authenticated;
GRANT SELECT ON public.teachers TO authenticated;
GRANT SELECT ON public.learners TO authenticated;
GRANT SELECT ON public.classes TO authenticated;
GRANT SELECT ON public.subjects TO authenticated;
GRANT SELECT ON public.assessments TO authenticated;
GRANT SELECT ON public.marks TO authenticated;
GRANT SELECT ON public.assessment_types TO authenticated;
GRANT SELECT ON public.teacher_assignments TO authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT SELECT ON public.announcements TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.school_settings TO authenticated;
GRANT SELECT ON public.performance_comments TO authenticated;

-- ============================================================================
-- 7. VERIFICATION QUERIES (run these after applying the migration)
-- ============================================================================
-- Check that principal role is allowed:
--   SELECT role FROM users WHERE role = 'principal';  -- should work

-- Check that parent role is allowed:
--   SELECT role FROM users WHERE role = 'parent';  -- should work

-- Check that a parent can only see their linked learner:
--   SET ROLE authenticated;
--   SELECT * FROM learners;  -- should only return the linked learner

-- Check that a principal can see all learners:
--   SET ROLE authenticated;
--   SELECT * FROM learners;  -- should return all learners
