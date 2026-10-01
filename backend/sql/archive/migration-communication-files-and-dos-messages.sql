-- Extend the communication center with DOS-initiated teacher messages
-- and private media/document attachments.
-- Apply after migration-dos-education-level-scope.sql,
-- migration-enforce-dos-level-visibility.sql, migration-account-isolation.sql,
-- migration-notification-center.sql, and migration-communication-center.sql.

DO $$
BEGIN
  IF to_regclass('public.messages') IS NULL
     OR to_regclass('public.message_attachments') IS NULL
     OR to_regprocedure('public.rms_communication_dos_scope(text)') IS NULL
     OR to_regprocedure('public.rms_dos_can_level(text)') IS NULL
    OR to_regprocedure('public.rms_account_role()') IS NULL
    OR to_regprocedure('public.rms_account_can_class(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run migration-dos-education-level-scope.sql, migration-account-isolation.sql, and migration-communication-center.sql first';
  END IF;
END $$;

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
    IF p_parent_message_id IS NULL THEN
      RETURN p_thread_id IS NOT NULL AND p_class_id IS NOT NULL
        AND public.rms_communication_dos_scope(
          (SELECT education_level FROM public.users WHERE id = auth.uid())
        )
        AND EXISTS (
          SELECT 1 FROM public.teachers t
          JOIN public.teacher_assignments ta ON ta.teacher_id = t.id
          JOIN public.classes c ON c.id = ta.class_id
          WHERE t.user_id = p_recipient AND c.id = p_class_id
            AND public.rms_dos_can_level(c.education_level)
        );
    END IF;

    RETURN p_thread_id IS NOT NULL
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

REVOKE ALL ON FUNCTION public.rms_communication_can_send_message(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_communication_can_send_message(UUID, UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_communication_dos_for_class(p_class_id UUID)
RETURNS TABLE(user_id UUID, full_name TEXT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
  SELECT dos.id, dos.full_name
  FROM public.users dos
  JOIN public.classes c ON (
    (c.education_level = 'Primary' AND dos.education_level = 'PRIMARY')
    OR (c.education_level IN ('Lower Secondary', 'Upper Secondary') AND dos.education_level = 'SECONDARY')
  )
  JOIN public.teacher_assignments ta ON ta.class_id = c.id
  JOIN public.teachers t ON t.id = ta.teacher_id
  WHERE c.id = p_class_id
    AND t.user_id = auth.uid()
    AND public.rms_account_role() = 'teacher'
    AND dos.role = 'dos' AND dos.status = 'active'
  ORDER BY dos.full_name
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.rms_communication_dos_for_class(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_communication_dos_for_class(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_notify_message_recipient()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.notifications (
    recipient_user_id, sender_user_id, title, message, notification_type,
    category, priority, entity_type, entity_id, action_url, is_read
  ) VALUES (
    NEW.recipient_user_id, NEW.sender_user_id, 'New message: ' || NEW.subject,
    NEW.body, 'SYSTEM', 'system', 'normal', 'teacher_message', NEW.id,
    CASE WHEN (SELECT role FROM public.users WHERE id = NEW.recipient_user_id) = 'dos'
      THEN '/#admin/messages' ELSE '/#teacher/messages' END,
    FALSE
  );
  RETURN NEW;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments', 'message-attachments', FALSE, 52428800,
  ARRAY['image/*', 'video/*', 'audio/*', 'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain', 'application/zip', 'application/octet-stream']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS communication_message_files_insert ON storage.objects;
CREATE POLICY communication_message_files_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

DROP POLICY IF EXISTS communication_message_files_select ON storage.objects;
CREATE POLICY communication_message_files_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND EXISTS (
      SELECT 1 FROM public.message_attachments a
      JOIN public.messages m ON m.id = a.message_id
      WHERE a.file_path = storage.objects.name
        AND (m.sender_user_id = auth.uid() OR m.recipient_user_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS communication_message_files_delete ON storage.objects;
CREATE POLICY communication_message_files_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'message-attachments'
    AND (storage.foldername(name))[1] = auth.uid()::TEXT
  );

GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;