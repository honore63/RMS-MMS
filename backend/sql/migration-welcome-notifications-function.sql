-- ============================================================================
-- RMS-MIS: WELCOME NOTIFICATION DATABASE FUNCTION
-- ============================================================================
-- Creates a PostgreSQL function that sends welcome email/SMS notifications
-- when a teacher is registered. Called by the welcome-teacher Edge Function.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.send_welcome_notifications(
  p_teacher_name TEXT,
  p_email TEXT,
  p_phone TEXT,
  p_teacher_code TEXT,
  p_classes JSONB DEFAULT '[]'::JSONB,
  p_subjects JSONB DEFAULT '[]'::JSONB,
  p_education_level TEXT DEFAULT 'Primary',
  p_login_link TEXT DEFAULT '',
  p_temp_password_link TEXT DEFAULT '',
  p_registered_by UUID DEFAULT NULL,
  p_audit_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_email_id UUID;
  v_sms_id UUID;
  v_email_sent BOOLEAN := FALSE;
  v_sms_sent BOOLEAN := FALSE;
  v_sms_message TEXT;
  v_class_names TEXT[];
  v_subject_names TEXT[];
  v_notification_id UUID;
BEGIN
  -- Build class and subject arrays
  v_class_names := ARRAY(SELECT jsonb_array_elements_text(p_classes));
  v_subject_names := ARRAY(SELECT jsonb_array_elements_text(p_subjects));

  -- Build SMS message
  v_sms_message := 'Welcome ' || p_teacher_name || '. Your RMS-MIS account has been created. Email: ' || p_email || '. Classes: ' || COALESCE(array_to_string(v_class_names, ', '), 'None') || '. Subjects: ' || COALESCE(array_to_string(v_subject_names, ', '), 'None') || '. Login: ' || p_login_link || '. Please use your temporary credentials to log in and change your password. Contact ' || COALESCE(p_phone, '+250788123456') || ' for support.';

  -- Insert email notification record
  INSERT INTO email_notifications (
    recipient_user_id, recipient_email, recipient_name,
    subject, body_html, body_text, template_name, template_data, status
  ) VALUES (
    p_registered_by, p_email, p_teacher_name,
    'Welcome to RMS-MIS – Your Teacher Account Has Been Created',
    '<html><body><h1>Welcome to ' || COALESCE(current_setting('app.settings.school_name', true), 'Rukara Model School') || '</h1><p>Dear ' || p_teacher_name || ',</p><p>Your teacher account has been successfully created.</p><p>Email: ' || p_email || '</p><p>Teacher Code: ' || p_teacher_code || '</p><p>Education Level: ' || p_education_level || '</p><p>Login: ' || p_login_link || '</p><p>Set Password: ' || p_temp_password_link || '</p></body></html>',
    'Welcome ' || p_teacher_name || '! Your teacher account has been successfully created in the RMS-MIS system. Email: ' || p_email || '. Teacher Code: ' || p_teacher_code || '. Login: ' || p_login_link || '. Please change your password immediately.',
    'teacher_welcome',
    jsonb_build_object('teacher_name', p_teacher_name, 'email', p_email, 'phone', p_phone, 'teacher_code', p_teacher_code, 'classes', p_classes, 'subjects', p_subjects, 'education_level', p_education_level),
    'pending'
  )
  RETURNING id INTO v_email_id;

  -- Insert SMS notification record
  INSERT INTO sms_notifications (
    recipient_user_id, recipient_phone, recipient_name,
    message, template_name, status
  ) VALUES (
    p_registered_by, COALESCE(p_phone, ''), p_teacher_name,
    v_sms_message,
    'teacher_welcome_sms',
    CASE WHEN p_phone IS NOT NULL AND length(p_phone) >= 8 THEN 'pending' ELSE 'pending' END
  )
  RETURNING id INTO v_sms_id;

  -- Update audit record
  IF p_audit_id IS NOT NULL THEN
    UPDATE teacher_registration_audit SET
      welcome_email_id = v_email_id,
      welcome_sms_id = v_sms_id,
      email_delivery_status = 'pending',
      sms_delivery_status = CASE WHEN p_phone IS NOT NULL AND length(p_phone) >= 8 THEN 'pending' ELSE 'pending' END,
      email_sent = FALSE,
      sms_sent = FALSE,
      updated_at = NOW()
    WHERE id = p_audit_id;
  END IF;

  -- Insert system notification for the registering DOS
  INSERT INTO notifications (
    recipient_user_id, sender_user_id, title, message,
    notification_type, category, priority, entity_type, entity_id,
    is_read, action_url
  ) VALUES (
    p_registered_by, p_registered_by,
    'Teacher Registered Successfully',
    p_teacher_name || ' has been registered. Email: pending. SMS: pending.',
    'SYSTEM', 'system', 'important',
    'teacher_registration', p_registered_by,
    FALSE, '/admin/teachers'
  );

  -- Return result
  RETURN jsonb_build_object(
    'success', true,
    'email_sent', v_email_sent,
    'sms_sent', v_sms_sent,
    'email_notification_id', v_email_id,
    'sms_notification_id', v_sms_id,
    'email_status', 'pending',
    'sms_status', 'pending'
  );
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.send_welcome_notifications TO authenticated, anon;

-- Verify function exists
SELECT routine_name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name = 'send_welcome_notifications';
