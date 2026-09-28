-- RMS-MIS account isolation hardening.
-- Run after migration-dos-education-level-scope.sql and
-- migration-enforce-dos-level-visibility.sql in the Supabase SQL Editor.
-- This migration is idempotent. Keep it last when applying older migrations.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.rms_is_dos()') IS NULL
     OR to_regprocedure('public.rms_dos_can_level(text)') IS NULL
     OR to_regprocedure('public.rms_dos_can_subject(text)') IS NULL
     OR to_regprocedure('public.rms_teacher_in_scope(uuid)') IS NULL
     OR to_regprocedure('public.rms_teacher_can_assessment(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run the DOS education-level and enforcement migrations first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rms_account_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.role
  FROM public.users u
  WHERE u.id = auth.uid() AND u.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_teacher_id()
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT t.id FROM public.teachers t WHERE t.user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_access_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE
    WHEN p_user_id = auth.uid() THEN true
    WHEN public.rms_account_role() = 'dos' THEN EXISTS (
      SELECT 1
      FROM public.users target
      JOIN public.teachers t ON t.user_id = target.id
      WHERE target.id = p_user_id
        AND target.role = 'teacher'
        AND public.rms_teacher_in_scope(t.id)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_teacher(p_teacher_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN public.rms_is_scoped_dos() AND public.rms_teacher_in_scope(p_teacher_id)
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = p_teacher_id AND t.user_id = auth.uid()
    )
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = p_teacher_id AND t.user_id = auth.uid()
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_class(p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = p_class_id AND public.rms_dos_can_level(c.education_level)
    )
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.class_id = p_class_id
        AND ta.teacher_id = public.rms_account_teacher_id()
    )
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.class_id = p_class_id
        AND ta.teacher_id = public.rms_account_teacher_id()
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_subject(p_subject_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (
      SELECT 1 FROM public.subjects s
      WHERE s.id = p_subject_id AND public.rms_dos_can_subject(s.level)
    )
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.subject_id = p_subject_id
        AND ta.teacher_id = public.rms_account_teacher_id()
    )
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.subject_id = p_subject_id
        AND ta.teacher_id = public.rms_account_teacher_id()
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (
      SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND public.rms_dos_can_level(c.education_level)
    )
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.learners l
      JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id()
    )
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.learners l
      JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id()
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assessment(p_assessment_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (
      SELECT 1 FROM public.assessments a
      JOIN public.classes c ON c.id = a.class_id
      JOIN public.subjects s ON s.id = a.subject_id
      WHERE a.id = p_assessment_id
        AND public.rms_dos_can_level(c.education_level)
        AND public.rms_dos_can_subject(s.level)
    )
    WHEN 'teacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
    WHEN 'headteacher' THEN public.rms_teacher_can_assessment(p_assessment_id)
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assessment_fields(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID, p_academic_year_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (
      SELECT 1
      FROM public.classes c CROSS JOIN public.subjects s
      WHERE c.id = p_class_id AND s.id = p_subject_id
        AND public.rms_dos_can_level(c.education_level)
        AND public.rms_dos_can_subject(s.level)
    )
    WHEN 'teacher' THEN p_teacher_id = public.rms_account_teacher_id() AND EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.teacher_id = public.rms_account_teacher_id()
        AND ta.class_id = p_class_id AND ta.subject_id = p_subject_id
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
             OR ta.academic_year_id = p_academic_year_id)
    )
    WHEN 'headteacher' THEN p_teacher_id = public.rms_account_teacher_id() AND EXISTS (
      SELECT 1 FROM public.teacher_assignments ta
      WHERE ta.teacher_id = public.rms_account_teacher_id()
        AND ta.class_id = p_class_id AND ta.subject_id = p_subject_id
        AND (ta.academic_year_id IS NULL OR p_academic_year_id IS NULL
             OR ta.academic_year_id = p_academic_year_id)
    )
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_assignment(
  p_teacher_id UUID, p_class_id UUID, p_subject_id UUID
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT CASE public.rms_account_role()
    WHEN 'dos' THEN EXISTS (
      SELECT 1 FROM public.classes c JOIN public.subjects s ON s.id = p_subject_id
      WHERE c.id = p_class_id
        AND public.rms_dos_can_level(c.education_level)
        AND public.rms_dos_can_subject(s.level)
    )
    WHEN 'teacher' THEN p_teacher_id = public.rms_account_teacher_id()
    WHEN 'headteacher' THEN p_teacher_id = public.rms_account_teacher_id()
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_document(p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.documents d
    WHERE d.id = p_document_id
      AND (
        (d.learner_id IS NOT NULL AND public.rms_account_can_learner(d.learner_id))
        OR (d.uploaded_by = auth.uid())
        OR (d.uploaded_by IS NULL AND d.learner_id IS NULL
            AND public.rms_account_role() IN ('dos', 'teacher', 'headteacher'))
        OR (public.rms_account_role() = 'dos'
            AND public.rms_account_can_access_user(d.uploaded_by))
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.rms_account_can_send_notification(
  p_recipient_id UUID, p_entity_type TEXT, p_entity_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_recipient_level TEXT;
  v_class_level TEXT;
BEGIN
  IF p_recipient_id = auth.uid() THEN RETURN true; END IF;

  IF public.rms_account_role() = 'dos' THEN
    RETURN public.rms_account_can_access_user(p_recipient_id);
  END IF;

  IF public.rms_account_role() NOT IN ('teacher', 'headteacher')
     OR p_entity_type <> 'assessments'
     OR NOT public.rms_account_can_assessment(p_entity_id) THEN
    RETURN false;
  END IF;

  SELECT recipient.education_level, c.education_level
    INTO v_recipient_level, v_class_level
  FROM public.users recipient
  JOIN public.users sender ON sender.id = auth.uid()
  JOIN public.assessments a ON a.id = p_entity_id
  JOIN public.classes c ON c.id = a.class_id
  WHERE recipient.id = p_recipient_id
    AND recipient.role = 'dos' AND recipient.status = 'active';

  RETURN CASE
    WHEN v_recipient_level = 'PRIMARY' THEN v_class_level = 'Primary'
    WHEN v_recipient_level = 'SECONDARY' THEN v_class_level IN ('Lower Secondary', 'Upper Secondary')
    ELSE false
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.rms_dos_notification_recipients(p_assessment_id UUID)
RETURNS TABLE(user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT u.id
  FROM public.users u
  JOIN public.assessments a ON a.id = p_assessment_id
  JOIN public.classes c ON c.id = a.class_id
  WHERE u.role = 'dos' AND u.status = 'active'
    AND public.rms_account_role() IN ('teacher', 'headteacher')
    AND public.rms_account_can_assessment(p_assessment_id)
    AND (
      (u.education_level = 'PRIMARY' AND c.education_level = 'Primary')
      OR (u.education_level = 'SECONDARY' AND c.education_level IN ('Lower Secondary', 'Upper Secondary'))
    );
$$;

CREATE OR REPLACE FUNCTION public.rms_account_guard_user_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Account IDs cannot be changed';
  END IF;
  IF auth.uid() IS NOT NULL AND OLD.id = auth.uid()
     AND (NEW.role IS DISTINCT FROM OLD.role
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.education_level IS DISTINCT FROM OLD.education_level) THEN
    RAISE EXCEPTION 'Account role, status, and scope can only be changed by an administrator';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.rms_account_guard_teacher_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
     ) THEN
    RAISE EXCEPTION 'Teacher account IDs cannot be changed';
  END IF;
  IF auth.uid() IS NOT NULL AND public.rms_account_role() IN ('teacher', 'headteacher')
     AND OLD.user_id = auth.uid()
     AND (NEW.teacher_code IS DISTINCT FROM OLD.teacher_code
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.education_level IS DISTINCT FROM OLD.education_level) THEN
    RAISE EXCEPTION 'Only an administrator can change protected teacher account fields';
  END IF;
  RETURN NEW;
END;
$$;

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

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'users' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.users', p.policyname);
  END LOOP;
END $$;
CREATE POLICY rms_account_users_select ON public.users
  FOR SELECT TO authenticated USING (public.rms_account_can_access_user(id));
CREATE POLICY rms_account_users_insert ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (
    (id = auth.uid() AND role = 'teacher')
    OR (public.rms_account_role() = 'dos' AND role = 'teacher')
  );
CREATE POLICY rms_account_users_update ON public.users
  FOR UPDATE TO authenticated
  USING (public.rms_account_can_access_user(id))
  WITH CHECK (public.rms_account_can_access_user(id));
DROP TRIGGER IF EXISTS rms_account_guard_user_fields ON public.users;
CREATE TRIGGER rms_account_guard_user_fields
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.rms_account_guard_user_fields();

DROP TRIGGER IF EXISTS rms_account_guard_teacher_fields ON public.teachers;
CREATE TRIGGER rms_account_guard_teacher_fields
  BEFORE UPDATE ON public.teachers
  FOR EACH ROW EXECUTE FUNCTION public.rms_account_guard_teacher_fields();

DROP POLICY IF EXISTS rms_account_teacher_self_insert ON public.teachers;
CREATE POLICY rms_account_teacher_self_insert ON public.teachers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.rms_account_role() IN ('teacher', 'headteacher')
    AND user_id = auth.uid()
  );

DROP POLICY IF EXISTS rms_account_teacher_rows ON public.teachers;
CREATE POLICY rms_account_teacher_rows ON public.teachers
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_teacher(id))
  WITH CHECK (
    public.rms_account_can_teacher(id)
    OR (public.rms_account_role() = 'teacher' AND user_id = auth.uid())
    OR (public.rms_account_role() = 'dos' AND public.rms_is_scoped_dos())
  );

DROP POLICY IF EXISTS rms_account_class_scope ON public.classes;
CREATE POLICY rms_account_class_scope ON public.classes
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_class(id))
  WITH CHECK (public.rms_account_can_class(id));
DROP POLICY IF EXISTS rms_account_subject_scope ON public.subjects;
CREATE POLICY rms_account_subject_scope ON public.subjects
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_subject(id))
  WITH CHECK (public.rms_account_can_subject(id));
DROP POLICY IF EXISTS rms_account_learner_scope ON public.learners;
CREATE POLICY rms_account_learner_scope ON public.learners
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_learner(id))
  WITH CHECK (public.rms_account_can_learner(id));
DROP POLICY IF EXISTS rms_account_assignment_scope ON public.teacher_assignments;
CREATE POLICY rms_account_assignment_scope ON public.teacher_assignments
  AS RESTRICTIVE FOR ALL TO authenticated
  USING (public.rms_account_can_assignment(teacher_id, class_id, subject_id))
  WITH CHECK (public.rms_account_can_assignment(teacher_id, class_id, subject_id));

DROP POLICY IF EXISTS rms_account_assessment_select_scope ON public.assessments;
CREATE POLICY rms_account_assessment_select_scope ON public.assessments
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.rms_account_can_assessment(id));
DROP POLICY IF EXISTS rms_account_assessment_insert_scope ON public.assessments;
CREATE POLICY rms_account_assessment_insert_scope ON public.assessments
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_can_assessment_fields(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_account_assessment_update_scope ON public.assessments;
CREATE POLICY rms_account_assessment_update_scope ON public.assessments
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.rms_account_can_assessment(id))
  WITH CHECK (public.rms_account_can_assessment_fields(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_account_assessment_delete_scope ON public.assessments;
CREATE POLICY rms_account_assessment_delete_scope ON public.assessments
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.rms_account_can_assessment(id));

DROP POLICY IF EXISTS rms_account_marks_select_scope ON public.marks;
CREATE POLICY rms_account_marks_select_scope ON public.marks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_account_marks_insert_scope ON public.marks;
CREATE POLICY rms_account_marks_insert_scope ON public.marks
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_account_marks_update_scope ON public.marks;
CREATE POLICY rms_account_marks_update_scope ON public.marks
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (public.rms_account_can_assessment(assessment_id))
  WITH CHECK (public.rms_account_can_assessment(assessment_id));
DROP POLICY IF EXISTS rms_account_marks_delete_scope ON public.marks;
CREATE POLICY rms_account_marks_delete_scope ON public.marks
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (public.rms_account_can_assessment(assessment_id));

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'notifications' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.notifications', p.policyname);
  END LOOP;
END $$;
CREATE POLICY rms_account_notifications_select ON public.notifications
  FOR SELECT TO authenticated USING (recipient_user_id = auth.uid());
CREATE POLICY rms_account_notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    AND public.rms_account_can_send_notification(recipient_user_id, entity_type, entity_id)
  );
CREATE POLICY rms_account_notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());
CREATE POLICY rms_account_notifications_delete ON public.notifications
  FOR DELETE TO authenticated USING (recipient_user_id = auth.uid());

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'audit_logs' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_logs', p.policyname);
  END LOOP;
END $$;
CREATE POLICY rms_account_audit_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (public.rms_account_role() = 'dos' AND (
      (assessment_id IS NOT NULL AND public.rms_account_can_assessment(assessment_id))
      OR (learner_id IS NOT NULL AND public.rms_account_can_learner(learner_id))
    ))
  );
CREATE POLICY rms_account_audit_insert ON public.audit_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND (assessment_id IS NULL OR public.rms_account_can_assessment(assessment_id))
    AND (learner_id IS NULL OR public.rms_account_can_learner(learner_id))
  );

DO $$
DECLARE p RECORD;
BEGIN
  IF to_regclass('public.import_history') IS NOT NULL THEN
    ALTER TABLE public.import_history ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'import_history' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.import_history', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_import_history_select ON public.import_history
      FOR SELECT TO authenticated USING (user_id = auth.uid());
    CREATE POLICY rms_account_import_history_insert ON public.import_history
      FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
  END IF;

  IF to_regclass('public.teacher_registration_audit') IS NOT NULL THEN
    ALTER TABLE public.teacher_registration_audit ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'teacher_registration_audit' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.teacher_registration_audit', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_registration_audit_select ON public.teacher_registration_audit
      FOR SELECT TO authenticated
      USING (user_id = auth.uid() OR registered_by_user_id = auth.uid()
        OR public.rms_account_can_access_user(user_id));
    CREATE POLICY rms_account_registration_audit_insert ON public.teacher_registration_audit
      FOR INSERT TO authenticated
      WITH CHECK (registered_by_user_id = auth.uid() AND public.rms_account_role() = 'dos');
    CREATE POLICY rms_account_registration_audit_update ON public.teacher_registration_audit
      FOR UPDATE TO authenticated
      USING (registered_by_user_id = auth.uid() AND public.rms_account_role() = 'dos')
      WITH CHECK (registered_by_user_id = auth.uid() AND public.rms_account_role() = 'dos');
  END IF;

  IF to_regclass('public.email_notifications') IS NOT NULL THEN
    ALTER TABLE public.email_notifications ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'email_notifications' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.email_notifications', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_email_notifications_select ON public.email_notifications
      FOR SELECT TO authenticated
      USING (recipient_user_id = auth.uid() OR public.rms_account_can_access_user(recipient_user_id));
    CREATE POLICY rms_account_email_notifications_insert ON public.email_notifications
      FOR INSERT TO authenticated
      WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
    CREATE POLICY rms_account_email_notifications_update ON public.email_notifications
      FOR UPDATE TO authenticated
      USING (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id))
      WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
  END IF;

  IF to_regclass('public.sms_notifications') IS NOT NULL THEN
    ALTER TABLE public.sms_notifications ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'sms_notifications' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.sms_notifications', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_sms_notifications_select ON public.sms_notifications
      FOR SELECT TO authenticated
      USING (recipient_user_id = auth.uid() OR public.rms_account_can_access_user(recipient_user_id));
    CREATE POLICY rms_account_sms_notifications_insert ON public.sms_notifications
      FOR INSERT TO authenticated
      WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
    CREATE POLICY rms_account_sms_notifications_update ON public.sms_notifications
      FOR UPDATE TO authenticated
      USING (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id))
      WITH CHECK (public.rms_account_role() = 'dos' AND public.rms_account_can_access_user(recipient_user_id));
  END IF;
END $$;

-- Shared settings remain readable before sign-in for login branding.
DO $$
DECLARE p RECORD;
BEGIN
  IF to_regclass('public.school_settings') IS NOT NULL THEN
    ALTER TABLE public.school_settings ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'school_settings' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.school_settings', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_school_settings_select ON public.school_settings
      FOR SELECT TO anon, authenticated USING (true);
    CREATE POLICY rms_account_school_settings_insert ON public.school_settings
      FOR INSERT TO authenticated WITH CHECK (public.rms_account_role() = 'dos');
    CREATE POLICY rms_account_school_settings_update ON public.school_settings
      FOR UPDATE TO authenticated USING (public.rms_account_role() = 'dos')
      WITH CHECK (public.rms_account_role() = 'dos');
    CREATE POLICY rms_account_school_settings_delete ON public.school_settings
      FOR DELETE TO authenticated USING (public.rms_account_role() = 'dos');
  END IF;
END $$;

-- Reference data is shared for reading; only DOS accounts may change it.
DO $$
DECLARE v_table TEXT; p RECORD;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['academic_years', 'terms', 'grading_scales', 'assessment_types', 'performance_comments'] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
      FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = v_table LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, v_table);
      END LOOP;
      EXECUTE format('CREATE POLICY rms_account_%I_select ON public.%I FOR SELECT TO authenticated USING (true)', v_table, v_table);
      EXECUTE format('CREATE POLICY rms_account_%I_insert ON public.%I FOR INSERT TO authenticated WITH CHECK (public.rms_account_role() = ''dos'')', v_table, v_table);
      EXECUTE format('CREATE POLICY rms_account_%I_update ON public.%I FOR UPDATE TO authenticated USING (public.rms_account_role() = ''dos'') WITH CHECK (public.rms_account_role() = ''dos'')', v_table, v_table);
      EXECUTE format('CREATE POLICY rms_account_%I_delete ON public.%I FOR DELETE TO authenticated USING (public.rms_account_role() = ''dos'')', v_table, v_table);
    END IF;
  END LOOP;
END $$;

-- Documents are private objects; object access follows its documents row.
DO $$
DECLARE p RECORD;
BEGIN
  IF to_regclass('public.documents') IS NOT NULL THEN
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'documents' LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.documents', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_documents_select ON public.documents
      FOR SELECT TO authenticated USING (public.rms_account_can_document(id));
    CREATE POLICY rms_account_documents_insert ON public.documents
      FOR INSERT TO authenticated
      WITH CHECK (
        uploaded_by = auth.uid()
        AND (learner_id IS NULL OR public.rms_account_can_learner(learner_id))
      );
    CREATE POLICY rms_account_documents_update ON public.documents
      FOR UPDATE TO authenticated
      USING (public.rms_account_can_document(id))
      WITH CHECK (uploaded_by = auth.uid() OR public.rms_account_role() = 'dos');
    CREATE POLICY rms_account_documents_delete ON public.documents
      FOR DELETE TO authenticated USING (public.rms_account_can_document(id));
  END IF;

  IF to_regclass('storage.objects') IS NOT NULL THEN
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'storage' AND tablename = 'objects'
        AND (COALESCE(qual, '') ILIKE '%documents%'
          OR COALESCE(with_check, '') ILIKE '%documents%')
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', p.policyname);
    END LOOP;
    CREATE POLICY rms_account_documents_storage_select ON storage.objects
      FOR SELECT TO authenticated
      USING (bucket_id = 'documents' AND EXISTS (
        SELECT 1 FROM public.documents d
        WHERE d.storage_path = name AND public.rms_account_can_document(d.id)
      ));
    CREATE POLICY rms_account_documents_storage_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'documents' AND public.rms_account_role() = 'dos');
    CREATE POLICY rms_account_documents_storage_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'documents' AND public.rms_account_role() = 'dos')
      WITH CHECK (bucket_id = 'documents' AND public.rms_account_role() = 'dos');
    CREATE POLICY rms_account_documents_storage_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'documents' AND public.rms_account_role() = 'dos');
    UPDATE storage.buckets SET public = false WHERE id = 'documents';
  END IF;
END $$;

-- Preserve public display of profile photos while limiting writes to their owner.
DO $$
DECLARE p RECORD;
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Authenticated Upload profile-photos" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated Update profile-photos" ON storage.objects;
    DROP POLICY IF EXISTS "Authenticated Delete profile-photos" ON storage.objects;
    CREATE POLICY rms_profile_photos_owner_insert ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (bucket_id = 'profile-photos' AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
          AND name LIKE 'teacher-photos/' || t.id::text || '.%'
      ));
    CREATE POLICY rms_profile_photos_owner_update ON storage.objects
      FOR UPDATE TO authenticated
      USING (bucket_id = 'profile-photos' AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
          AND name LIKE 'teacher-photos/' || t.id::text || '.%'
      ))
      WITH CHECK (bucket_id = 'profile-photos' AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
          AND name LIKE 'teacher-photos/' || t.id::text || '.%'
      ));
    CREATE POLICY rms_profile_photos_owner_delete ON storage.objects
      FOR DELETE TO authenticated
      USING (bucket_id = 'profile-photos' AND EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = auth.uid()
          AND name LIKE 'teacher-photos/' || t.id::text || '.%'
      ));
  END IF;
END $$;

-- Do not expose account-linked records to the anonymous API role.
DO $$
DECLARE v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'users', 'teachers', 'learners', 'classes', 'subjects', 'teacher_assignments',
    'assessments', 'marks', 'notifications', 'audit_logs', 'import_history',
    'teacher_registration_audit', 'email_notifications', 'sms_notifications', 'documents',
    'academic_years', 'terms', 'grading_scales', 'assessment_types', 'performance_comments'
  ] LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon', v_table);
    END IF;
  END LOOP;
  IF to_regclass('public.school_settings') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.school_settings FROM PUBLIC, anon;
    GRANT SELECT ON TABLE public.school_settings TO anon;
  END IF;
END $$;

-- Retire broad access to the obsolete welcome-notification RPC. The Edge
-- Function uses the service role; browsers and anonymous users must not call it.
DO $$
BEGIN
  IF to_regprocedure('public.send_welcome_notifications(text,text,text,text,jsonb,jsonb,text,text,text,uuid,uuid)') IS NOT NULL THEN
    ALTER FUNCTION public.send_welcome_notifications(text,text,text,text,jsonb,jsonb,text,text,text,uuid,uuid)
      SET search_path = public, pg_temp;
    REVOKE ALL ON FUNCTION public.send_welcome_notifications(text,text,text,text,jsonb,jsonb,text,text,text,uuid,uuid)
      FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION public.send_welcome_notifications(text,text,text,text,jsonb,jsonb,text,text,text,uuid,uuid)
      TO service_role;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- Post-migration checks: all policy guards should return only authenticated
-- rows. Verify policies and table RLS in Supabase after running this script.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'teachers', 'classes', 'subjects', 'learners', 'teacher_assignments',
    'assessments', 'marks', 'notifications', 'audit_logs', 'documents'
  )
ORDER BY tablename;

SELECT tablename, policyname, permissive, cmd, roles
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'users', 'teachers', 'classes', 'subjects', 'learners', 'teacher_assignments',
    'assessments', 'marks', 'notifications', 'audit_logs', 'documents'
  )
ORDER BY tablename, policyname;
