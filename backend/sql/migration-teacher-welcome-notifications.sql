-- ============================================================================
-- RMS-MIS: TEACHER WELCOME EMAIL & SMS NOTIFICATION SYSTEM
-- ============================================================================
-- Creates tables for tracking welcome email/SMS delivery to newly registered
-- teachers. Integrates with existing auth, notifications, and audit_logs.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) EMAIL NOTIFICATIONS QUEUE
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_email_notifications_recipient ON email_notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_email_notifications_status ON email_notifications(status);
CREATE INDEX IF NOT EXISTS idx_email_notifications_created ON email_notifications(created_at);

-- ---------------------------------------------------------------------------
-- 2) SMS NOTIFICATIONS QUEUE
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_sms_notifications_recipient ON sms_notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_status ON sms_notifications(status);
CREATE INDEX IF NOT EXISTS idx_sms_notifications_created ON sms_notifications(created_at);

-- ---------------------------------------------------------------------------
-- 3) TEACHER REGISTRATION AUDIT (links registration to welcome delivery)
-- ---------------------------------------------------------------------------
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

CREATE INDEX IF NOT EXISTS idx_tchg_reg_audit_teacher ON teacher_registration_audit(teacher_id);
CREATE INDEX IF NOT EXISTS idx_tchg_reg_audit_user ON teacher_registration_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_tchg_reg_audit_registered_by ON teacher_registration_audit(registered_by_user_id);

-- ---------------------------------------------------------------------------
-- 4) ENSURE EXISTING TABLES HAVE REQUIRED COLUMNS
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS education_level TEXT CHECK (education_level IN ('primary', 'secondary', 'all'));
ALTER TABLE users ADD COLUMN IF NOT EXISTS temporary_password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_token TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires_at TIMESTAMPTZ;

ALTER TABLE teachers ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES users(id);
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS registration_audit_id UUID REFERENCES teacher_registration_audit(id);

-- ---------------------------------------------------------------------------
-- 5) RLS POLICIES FOR NEW TABLES
-- ---------------------------------------------------------------------------
ALTER TABLE email_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_registration_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY rms_email_notif_all ON public.email_notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_sms_notif_all ON public.sms_notifications FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY rms_tchg_reg_audit_all ON public.teacher_registration_audit FOR ALL USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- 6) GRANTS
-- ---------------------------------------------------------------------------
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7) TRIGGER: Auto-create registration_audit on teacher insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_teacher_registration_audit()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO teacher_registration_audit (
    teacher_id, user_id, registered_by_user_id, teacher_code,
    email_sent, sms_sent, email_delivery_status, sms_delivery_status
  ) VALUES (
    NEW.id, NEW.user_id, NEW.created_by, NEW.teacher_code,
    FALSE, FALSE, 'pending', 'pending'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_teacher_registration_audit ON public.teachers;
CREATE TRIGGER trg_teacher_registration_audit
  AFTER INSERT ON public.teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_teacher_registration_audit();

-- ---------------------------------------------------------------------------
-- 8) TRIGGER: Auto-create audit log entry on registration
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_teacher_registration_log()
RETURNS TRIGGER AS $$
DECLARE
  v_registered_by_name TEXT;
BEGIN
  SELECT full_name INTO v_registered_by_name FROM users WHERE id = NEW.created_by;
  INSERT INTO audit_logs (user_id, user_name, role, action, assessment_id, learner_id, old_value, new_value, timestamp)
  VALUES (
    NEW.created_by, v_registered_by_name, 'dos',
    'TEACHER_REGISTERED:' || NEW.teacher_code,
    NULL, NULL,
    'teacher:' || NEW.full_name,
    'code:' || NEW.teacher_code || ',email:' || NEW.email || ',phone:' || NEW.phone,
    NOW()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_teacher_registration_log ON public.teachers;
CREATE TRIGGER trg_teacher_registration_log
  AFTER INSERT ON public.teachers
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_teacher_registration_log();

-- ---------------------------------------------------------------------------
-- 9) VERIFY
-- ---------------------------------------------------------------------------
SELECT 'email_notifications' AS table_name, COUNT(*) FROM email_notifications
UNION ALL SELECT 'sms_notifications', COUNT(*) FROM sms_notifications
UNION ALL SELECT 'teacher_registration_audit', COUNT(*) FROM teacher_registration_audit;
