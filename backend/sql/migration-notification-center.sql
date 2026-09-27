-- ============================================================================
-- RMS — NOTIFICATION CENTER ENHANCEMENT (CORRECTED v4)
-- ----------------------------------------------------------------------------
-- Run in Supabase SQL Editor. Idempotent — safe to re-run.
-- FIX: Drops old 'type' column and its CHECK constraint FIRST,
--      then adds new columns WITHOUT CHECK, migrates data, THEN adds CHECK.
-- ============================================================================

-- ============================================================================
-- STEP 1: Drop old 'type' column and its CHECK constraint if it exists
-- ============================================================================
DO $$
BEGIN
  -- Drop any CHECK constraint on the old 'type' column
  IF EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND constraint_name = 'notifications_type_check'
  ) THEN
    ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;
  END IF;

  -- Also try to drop any generic CHECK that might reference 'type'
  FOR r IN (
    SELECT c.constraint_name
    FROM information_schema.check_constraints c
    JOIN information_schema.table_constraints tc ON tc.constraint_name = c.constraint_name
    WHERE tc.table_schema = 'public' AND tc.table_name = 'notifications'
      AND c.constraint_name != 'notifications_notification_type_check'
  ) LOOP
    BEGIN
      ALTER TABLE notifications DROP CONSTRAINT r.constraint_name;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;

  -- Drop the old 'type' column if it still exists
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'type'
  ) THEN
    ALTER TABLE notifications DROP COLUMN type;
  END IF;

  -- Drop old 'read' column if it still exists (superseded by 'is_read')
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'read'
  ) THEN
    ALTER TABLE notifications DROP COLUMN read;
  END IF;
END $$;

-- ============================================================================
-- STEP 2: Add new columns WITHOUT CHECK constraints first
-- ============================================================================
DO $$
BEGIN
  -- recipient_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'recipient_user_id'
  ) THEN
    ALTER TABLE notifications ADD COLUMN recipient_user_id UUID;
  END IF;

  -- sender_user_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'sender_user_id'
  ) THEN
    ALTER TABLE notifications ADD COLUMN sender_user_id UUID;
  END IF;

  -- notification_type (add WITHOUT check constraint first)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'notification_type'
  ) THEN
    ALTER TABLE notifications ADD COLUMN notification_type TEXT DEFAULT 'info';
  END IF;

  -- category
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'category'
  ) THEN
    ALTER TABLE notifications ADD COLUMN category TEXT DEFAULT 'system';
  END IF;

  -- priority
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'priority'
  ) THEN
    ALTER TABLE notifications ADD COLUMN priority TEXT DEFAULT 'normal';
  END IF;

  -- entity_type
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'entity_type'
  ) THEN
    ALTER TABLE notifications ADD COLUMN entity_type TEXT;
  END IF;

  -- entity_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'entity_id'
  ) THEN
    ALTER TABLE notifications ADD COLUMN entity_id UUID;
  END IF;

  -- is_archived
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'is_archived'
  ) THEN
    ALTER TABLE notifications ADD COLUMN is_archived BOOLEAN DEFAULT FALSE;
  END IF;

  -- requires_acknowledgement
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'requires_acknowledgement'
  ) THEN
    ALTER TABLE notifications ADD COLUMN requires_acknowledgement BOOLEAN DEFAULT FALSE;
  END IF;

  -- acknowledged_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'acknowledged_at'
  ) THEN
    ALTER TABLE notifications ADD COLUMN acknowledged_at TIMESTAMPTZ;
  END IF;

  -- action_url
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'action_url'
  ) THEN
    ALTER TABLE notifications ADD COLUMN action_url TEXT;
  END IF;

  -- attachment_path
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'attachment_path'
  ) THEN
    ALTER TABLE notifications ADD COLUMN attachment_path TEXT;
  END IF;

  -- read_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'read_at'
  ) THEN
    ALTER TABLE notifications ADD COLUMN read_at TIMESTAMPTZ;
  END IF;

  -- is_read (replace old 'read' column)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'is_read'
  ) THEN
    ALTER TABLE notifications ADD COLUMN is_read BOOLEAN DEFAULT FALSE;
    UPDATE notifications SET is_read = read WHERE read IS NOT NULL AND is_read IS NULL;
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'notifications'
        AND column_name = 'read'
    ) THEN
      ALTER TABLE notifications DROP COLUMN read;
    END IF;
  END IF;

END $$;

-- ============================================================================
-- STEP 3: Migrate existing data to valid values
-- ============================================================================
UPDATE notifications
SET notification_type = CASE
  WHEN notification_type IN ('MARKS_SUBMITTED','MARKS_APPROVED','MARKS_REJECTED',
    'ASSESSMENT_CREATED','ASSESSMENT_REOPENED','ASSESSMENT_LOCKED',
    'ANNOUNCEMENT','TIMETABLE','MEETING','EXAMINATION','CPD','SYSTEM','REPORT')
    THEN notification_type
  ELSE 'SYSTEM'
END
WHERE notification_type IS NULL OR notification_type = '';

UPDATE notifications
SET category = CASE
  WHEN category IN ('marks','assessment','announcement','timetable','meeting',
    'examination','cpd','system','report','important') THEN category
  ELSE 'system'
END
WHERE category IS NULL OR category = '';

UPDATE notifications
SET priority = CASE
  WHEN priority IN ('normal','important','urgent') THEN priority
  ELSE 'normal'
END
WHERE priority IS NULL OR priority = '';

-- Fix recipient_user_id: set to sender_user_id for any null values
UPDATE notifications SET recipient_user_id = sender_user_id WHERE recipient_user_id IS NULL;
-- Remove any non-existent user references
DELETE FROM notifications WHERE recipient_user_id NOT IN (SELECT id FROM users);

-- ============================================================================
-- STEP 4: Now add CHECK constraints (data is already clean)
-- ============================================================================
DO $$
BEGIN
  -- notification_type CHECK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'notifications_notification_type_check'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_notification_type_check
      CHECK (notification_type IN ('MARKS_SUBMITTED','MARKS_APPROVED','MARKS_REJECTED',
        'ASSESSMENT_CREATED','ASSESSMENT_REOPENED','ASSESSMENT_LOCKED',
        'ANNOUNCEMENT','TIMETABLE','MEETING','EXAMINATION','CPD','SYSTEM','REPORT'));
  END IF;

  -- category CHECK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'notifications_category_check'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_category_check
      CHECK (category IN ('marks','assessment','announcement','timetable','meeting',
        'examination','cpd','system','report','important'));
  END IF;

  -- priority CHECK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.check_constraints
    WHERE constraint_name = 'notifications_priority_check'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_priority_check
      CHECK (priority IN ('normal','important','urgent'));
  END IF;
END $$;

-- ============================================================================
-- STEP 5: Add foreign key constraints and NOT NULL
-- ============================================================================
DO $$
BEGIN
  -- Make recipient_user_id NOT NULL after data is clean
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'recipient_user_id' AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE notifications ALTER COLUMN recipient_user_id SET NOT NULL;
  END IF;

  -- recipient_user_id FK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'notifications'
      AND constraint_name = 'notifications_recipient_user_id_fkey'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_recipient_user_id_fkey
      FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE;
  END IF;

  -- sender_user_id FK
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_type = 'FOREIGN KEY'
      AND table_name = 'notifications'
      AND constraint_name = 'notifications_sender_user_id_fkey'
  ) THEN
    ALTER TABLE notifications ADD CONSTRAINT notifications_sender_user_id_fkey
      FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;

END $$;

-- ============================================================================
-- STEP 6: Create announcements table
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sender_user_id UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('general','timetable','meeting','examination','assessment','academic','urgent','training','cpd','administrative','other')),
  priority TEXT NOT NULL CHECK (priority IN ('normal','important','urgent')),
  audience_type TEXT NOT NULL CHECK (audience_type IN ('all','primary','secondary','specific_teacher','specific_department','specific_class_teacher')),
  education_level TEXT CHECK (education_level IN ('primary','secondary','all')),
  target_subject_id UUID REFERENCES subjects(id) ON DELETE SET NULL,
  target_class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  target_user_ids UUID[] DEFAULT '{}',
  requires_acknowledgement BOOLEAN DEFAULT FALSE,
  attachment_path TEXT,
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived','expired'))
);

-- ============================================================================
-- STEP 7: Create announcement_acknowledgements table
-- ============================================================================
CREATE TABLE IF NOT EXISTS announcement_acknowledgements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  announcement_id UUID NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(announcement_id, user_id)
);

-- ============================================================================
-- STEP 8: RLS POLICIES
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND policyname = 'rms_notifications_all'
  ) THEN
    CREATE POLICY rms_notifications_all ON public.notifications FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'announcements' AND policyname = 'rms_announcements_all'
  ) THEN
    CREATE POLICY rms_announcements_all ON public.announcements FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'announcement_acknowledgements' AND policyname = 'rms_announcement_ack_all'
  ) THEN
    CREATE POLICY rms_announcement_ack_all ON public.announcement_acknowledgements FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;

-- ============================================================================
-- STEP 9: INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications(recipient_user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_priority ON notifications(priority);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(notification_type);
CREATE INDEX IF NOT EXISTS idx_notifications_entity ON notifications(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_announcements_sender ON announcements(sender_user_id);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_announcements_status ON announcements(status);
CREATE INDEX IF NOT EXISTS idx_announcement_ack_user ON announcement_acknowledgements(user_id);
CREATE INDEX IF NOT EXISTS idx_announcement_ack_announce ON announcement_acknowledgements(announcement_id);

-- ============================================================================
-- STEP 10: GRANTS
-- ============================================================================
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;

-- ============================================================================
-- STEP 11: HELPER FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION create_notification(
  p_recipient_id UUID, p_title TEXT, p_message TEXT,
  p_notification_type TEXT DEFAULT 'info', p_category TEXT DEFAULT 'system',
  p_priority TEXT DEFAULT 'normal', p_entity_type TEXT DEFAULT NULL,
  p_entity_id UUID DEFAULT NULL, p_action_url TEXT DEFAULT NULL,
  p_sender_id UUID DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (recipient_user_id, sender_user_id, title, message,
    notification_type, category, priority, entity_type, entity_id,
    action_url, is_read, is_archived)
  VALUES (p_recipient_id, p_sender_id, p_title, p_message,
    p_notification_type, p_category, p_priority, p_entity_type, p_entity_id,
    p_action_url, FALSE, FALSE) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 12: PUBLISH NOTIFICATION HELPER
-- ============================================================================
CREATE OR REPLACE FUNCTION rms_publish_notification(
  p_recipient_id UUID, p_title TEXT, p_message TEXT,
  p_notification_type TEXT, p_category TEXT, p_priority TEXT
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO notifications (recipient_user_id, sender_user_id, title, message,
    notification_type, category, priority, entity_type, entity_id,
    action_url, is_read, is_archived)
  VALUES (p_recipient_id, auth.uid(), p_title, p_message,
    p_notification_type, p_category, p_priority, NULL, NULL,
    NULL, FALSE, FALSE) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- VERIFICATION
-- ============================================================================
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'notifications'
ORDER BY ordinal_position;

SELECT COUNT(*) AS notification_types_total FROM assessment_types;
SELECT name, code, default_maximum_mark, status FROM assessment_types ORDER BY display_order;
