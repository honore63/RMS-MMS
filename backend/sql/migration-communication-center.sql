-- ============================================================================
-- RMS — COMMUNICATION CENTER
-- ----------------------------------------------------------------------------
-- Adds level-scoped announcements and teacher-to-DOS messaging.
-- Run AFTER migration-dos-education-level-scope.sql and migration-notification-center.sql.
-- ============================================================================

-- ============================================================================
-- 1) CREATE messages table
-- ============================================================================
DO $$
BEGIN
  IF to_regclass('public.notifications') IS NULL OR to_regclass('public.announcements') IS NULL
     OR to_regprocedure('public.rms_dos_can_level(text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'education_level')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'classes' AND column_name = 'education_level') THEN
    RAISE EXCEPTION 'Run migration-dos-education-level-scope.sql and migration-notification-center.sql first';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'direct' CHECK (message_type IN ('direct', 'announcement_reply', 'meeting_request', 'timetable_query', 'general')),
  status TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'replied', 'archived')),
  is_deleted_by_sender BOOLEAN DEFAULT FALSE,
  is_deleted_by_recipient BOOLEAN DEFAULT FALSE,
  replied_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS thread_id UUID;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS parent_message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_name TEXT NOT NULL DEFAULT '';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS sender_email TEXT NOT NULL DEFAULT '';
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS is_read BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
UPDATE public.messages SET thread_id = id WHERE thread_id IS NULL;
UPDATE public.messages SET is_read = status IN ('read', 'replied', 'archived');
ALTER TABLE public.messages ALTER COLUMN thread_id SET DEFAULT uuid_generate_v4();
ALTER TABLE public.messages ALTER COLUMN thread_id SET NOT NULL;

-- ============================================================================
-- 2) CREATE message_attachments table (optional attachments)
-- ============================================================================
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

-- ============================================================================
-- 3) RLS POLICIES
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'message_attachments' AND policyname = 'rms_message_attachments_all') THEN
    CREATE POLICY rms_message_attachments_all ON public.message_attachments FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT tablename, policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename IN ('messages', 'message_attachments')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rms_communication_dos_scope(p_level TEXT)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'dos' AND u.status = 'active'
      AND lower(u.education_level) = lower(p_level)
  );
$$;

CREATE OR REPLACE FUNCTION public.rms_communication_can_read_announcement(p_id UUID)
RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.announcements a
    JOIN public.users u ON u.id = auth.uid()
    WHERE a.id = p_id AND u.status = 'active'
      AND (
        (u.role = 'dos' AND public.rms_communication_dos_scope(a.education_level))
        OR (
          u.role = 'teacher' AND a.status = 'active'
          AND a.published_at IS NOT NULL AND a.published_at <= NOW()
          AND (a.expires_at IS NULL OR a.expires_at > NOW())
          AND (
            a.education_level = 'all'
            OR EXISTS (
              SELECT 1 FROM public.teachers t
              JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
              JOIN public.classes c ON c.id = ta.class_id
              WHERE t.user_id = u.id AND (
                (a.education_level = 'primary' AND c.education_level = 'Primary')
                OR (a.education_level = 'secondary' AND c.education_level IN ('Lower Secondary', 'Upper Secondary'))
              )
            )
            OR NOT EXISTS (
              SELECT 1 FROM public.teachers t
              JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
              WHERE t.user_id = u.id
            )
          )
          AND (
            a.target_user_ids @> ARRAY[u.id]
            OR (a.audience_type = 'all')
            OR (a.audience_type = 'primary' AND a.education_level = 'primary')
            OR (a.audience_type = 'secondary' AND a.education_level = 'secondary')
          )
        )
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.rms_communication_can_send_message(
  p_recipient UUID, p_class_id UUID, p_thread_id UUID, p_parent_message_id UUID
)
RETURNS BOOLEAN LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_sender_role TEXT; v_recipient_role TEXT;
BEGIN
  SELECT role INTO v_sender_role FROM public.users WHERE id = auth.uid() AND status = 'active';
  SELECT role INTO v_recipient_role FROM public.users WHERE id = p_recipient AND status = 'active';

  IF v_sender_role = 'teacher' AND v_recipient_role = 'dos' THEN
    RETURN p_thread_id IS NOT NULL AND p_class_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.teachers t
      JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
      JOIN public.classes c ON c.id = ta.class_id
      JOIN public.users dos ON dos.id = p_recipient
      WHERE t.user_id = auth.uid() AND c.id = p_class_id AND dos.status = 'active'
        AND ((c.education_level = 'Primary' AND dos.education_level = 'PRIMARY')
          OR (c.education_level IN ('Lower Secondary', 'Upper Secondary') AND dos.education_level = 'SECONDARY'))
        AND (p_parent_message_id IS NULL OR EXISTS (
          SELECT 1 FROM public.messages parent
          WHERE parent.id = p_parent_message_id AND parent.thread_id = p_thread_id
            AND parent.class_id = p_class_id
            AND parent.sender_user_id = p_recipient AND parent.recipient_user_id = auth.uid()
        ))
    );
  END IF;

  IF v_sender_role = 'dos' AND v_recipient_role = 'teacher' THEN
    RETURN p_parent_message_id IS NOT NULL AND p_thread_id IS NOT NULL
      AND public.rms_communication_dos_scope(
        (SELECT education_level FROM public.users WHERE id = auth.uid())
      )
      AND EXISTS (
        SELECT 1 FROM public.teachers t
        JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
        JOIN public.classes c ON c.id = ta.class_id
        JOIN public.messages parent ON parent.id = p_parent_message_id
        WHERE t.user_id = p_recipient AND c.id = p_class_id
          AND public.rms_dos_can_level(c.education_level)
          AND parent.thread_id = p_thread_id AND parent.class_id = p_class_id
          AND ((parent.sender_user_id = p_recipient AND parent.recipient_user_id = auth.uid())
            OR (parent.sender_user_id = auth.uid() AND parent.recipient_user_id = p_recipient))
          AND EXISTS (
            SELECT 1 FROM public.messages original
            JOIN public.users original_sender ON original_sender.id = original.sender_user_id
            WHERE original.thread_id = p_thread_id AND original_sender.role = 'teacher'
          )
      );
  END IF;

  RETURN FALSE;
END;
$$;

CREATE POLICY communication_messages_select ON public.messages
  FOR SELECT TO authenticated
  USING (sender_user_id = auth.uid() OR recipient_user_id = auth.uid());
CREATE POLICY communication_messages_insert ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid() AND public.rms_communication_can_send_message(
    recipient_user_id, class_id, thread_id, parent_message_id
  ));
CREATE POLICY communication_messages_update_read ON public.messages
  FOR UPDATE TO authenticated USING (recipient_user_id = auth.uid())
  WITH CHECK (recipient_user_id = auth.uid());

REVOKE ALL ON public.messages FROM anon, authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.messages TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_message_before_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  SELECT COALESCE(full_name, ''), COALESCE(email, '')
    INTO NEW.sender_name, NEW.sender_email FROM public.users WHERE id = NEW.sender_user_id;
  NEW.status := 'unread';
  NEW.is_read := FALSE;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_sender_snapshot ON public.messages;
CREATE TRIGGER message_sender_snapshot BEFORE INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rms_message_before_insert();

CREATE OR REPLACE FUNCTION public.rms_message_read_status()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.status := CASE WHEN NEW.is_read THEN 'read' ELSE 'unread' END;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_read_status ON public.messages;
CREATE TRIGGER message_read_status BEFORE UPDATE OF is_read ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rms_message_read_status();

CREATE OR REPLACE FUNCTION public.rms_notify_message_recipient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.notifications (
    recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read
  ) VALUES (
    NEW.recipient_user_id, NEW.sender_user_id, 'New teacher message: ' || NEW.subject,
    NEW.body, 'SYSTEM', 'system', 'normal', 'teacher_message', NEW.id,
    CASE WHEN (SELECT role FROM public.users WHERE id = NEW.recipient_user_id) = 'dos'
      THEN '/#admin/messages' ELSE '/#teacher/messages' END,
    FALSE
  );
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS message_notification ON public.messages;
CREATE TRIGGER message_notification AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.rms_notify_message_recipient();

-- Existing notification policies are permissive. Restrict private-message
-- notification previews to their recipient without changing other alerts.
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS communication_private_notifications_select ON public.notifications;
CREATE POLICY communication_private_notifications_select ON public.notifications
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (entity_type IS DISTINCT FROM 'teacher_message' OR recipient_user_id = auth.uid());
DROP POLICY IF EXISTS communication_private_notifications_update ON public.notifications;
CREATE POLICY communication_private_notifications_update ON public.notifications
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (entity_type IS DISTINCT FROM 'teacher_message' OR recipient_user_id = auth.uid())
  WITH CHECK (entity_type IS DISTINCT FROM 'teacher_message' OR recipient_user_id = auth.uid());

-- Only a DOS scoped to the announcement's education level may manage it.
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'announcements'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.announcements', p.policyname);
  END LOOP;
END $$;

CREATE POLICY communication_announcements_select ON public.announcements
  FOR SELECT TO authenticated
  USING (public.rms_communication_can_read_announcement(id));
CREATE POLICY communication_announcements_insert ON public.announcements
  FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level));
CREATE POLICY communication_announcements_update ON public.announcements
  FOR UPDATE TO authenticated
  USING (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level))
  WITH CHECK (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level));
CREATE POLICY communication_announcements_delete ON public.announcements
  FOR DELETE TO authenticated
  USING (sender_user_id = auth.uid() AND public.rms_communication_dos_scope(education_level));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_publish_due_announcements()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_inserted INTEGER;
BEGIN
  INSERT INTO public.notifications (
    recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read
  )
  SELECT DISTINCT u.id, a.sender_user_id, a.title, a.message,
    CASE a.category
      WHEN 'timetable' THEN 'TIMETABLE'
      WHEN 'meeting' THEN 'MEETING'
      WHEN 'examination' THEN 'EXAMINATION'
      WHEN 'cpd' THEN 'CPD'
      WHEN 'training' THEN 'CPD'
      ELSE 'ANNOUNCEMENT'
    END,
    'announcement', a.priority, 'announcement', a.id, '/#teacher/notifications', FALSE
  FROM public.announcements a
  JOIN public.users u ON u.role = 'teacher' AND u.status = 'active'
  LEFT JOIN public.teachers t ON t.user_id = u.id
  WHERE a.status = 'active'
    AND a.published_at IS NOT NULL
    AND a.published_at <= NOW()
    AND (a.expires_at IS NULL OR a.expires_at > NOW())
    AND (
      a.target_user_ids @> ARRAY[u.id]
      OR (a.audience_type = 'all')
      OR (a.audience_type = 'primary' AND a.education_level = 'primary')
      OR (a.audience_type = 'secondary' AND a.education_level = 'secondary')
    )
    AND (
      a.education_level = 'all'
      OR EXISTS (
        SELECT 1 FROM public.teacher_assignments ta
        JOIN public.classes c ON c.id = ta.class_id
        WHERE ta.teacher_id = t.id AND (
          (a.education_level = 'primary' AND c.education_level = 'Primary')
          OR (a.education_level = 'secondary' AND c.education_level IN ('Lower Secondary', 'Upper Secondary'))
        )
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.teacher_assignments ta WHERE ta.teacher_id = t.id
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.recipient_user_id = u.id AND n.entity_type = 'announcement' AND n.entity_id = a.id
    );
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.rms_announcement_publish_trigger()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM public.rms_publish_due_announcements();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS announcement_publish_notifications ON public.announcements;
CREATE TRIGGER announcement_publish_notifications
  AFTER INSERT OR UPDATE OF published_at, status, audience_type, education_level, target_user_ids
  ON public.announcements FOR EACH ROW
  EXECUTE FUNCTION public.rms_announcement_publish_trigger();

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'rms-publish-due-announcements') THEN
    PERFORM cron.schedule('rms-publish-due-announcements', '* * * * *',
      'SELECT public.rms_publish_due_announcements()');
  END IF;
END $$;

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS rms_message_attachments_all ON public.message_attachments;
CREATE POLICY communication_attachments_participant ON public.message_attachments
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id
      AND (m.sender_user_id = auth.uid() OR m.recipient_user_id = auth.uid()))
  );
CREATE POLICY communication_attachments_insert ON public.message_attachments
  FOR INSERT TO authenticated WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (SELECT 1 FROM public.messages m WHERE m.id = message_id AND m.sender_user_id = auth.uid())
  );
REVOKE ALL ON public.message_attachments FROM anon, authenticated;
GRANT SELECT, INSERT ON public.message_attachments TO authenticated;

-- The old SECURITY DEFINER helper accepted arbitrary sender IDs. The UI now
-- writes through RLS, so callers must not bypass those checks via the helper.
DO $$
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
END $$;

-- ============================================================================
-- 4) INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient ON messages(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_subject ON messages(subject);
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages(recipient_user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON message_attachments(message_id);

-- Legacy helper retained for compatibility, but unavailable to app roles.
CREATE OR REPLACE FUNCTION send_message(
  p_sender_id UUID,
  p_recipient_id UUID,
  p_subject TEXT,
  p_body TEXT,
  p_message_type TEXT DEFAULT 'direct'
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO messages (sender_user_id, recipient_user_id, subject, body, message_type, status)
  VALUES (p_sender_id, p_recipient_id, p_subject, p_body, p_message_type, 'unread')
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.send_message(UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.messages FROM anon, authenticated;
GRANT SELECT, INSERT ON public.messages TO authenticated;
GRANT UPDATE (is_read, read_at) ON public.messages TO authenticated;
REVOKE ALL ON public.message_attachments FROM anon, authenticated;
GRANT SELECT, INSERT ON public.message_attachments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.announcements TO authenticated;
