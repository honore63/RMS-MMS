-- =====================================================
-- MIGRATION: LEARNER AVAILABILITY ACROSS THE SYSTEM
-- Run this in the Supabase SQL Editor.
--
-- Makes a registered/imported learner immediately available
-- everywhere: learner lists, teacher class rosters, marks
-- entry, assessments and all DOS/teacher reports.
--
-- Note: the learner's `learner_code` column is the school's
-- official student number (unique). Marks link to learners by
-- their database id (marks.learner_id), and `marks` already has
-- UNIQUE(assessment_id, learner_id) so marks are never
-- duplicated. This migration only adds the optional pieces.
-- =====================================================

-- 1. Optional Academic Year on learners (requirement: save the
--    Academic Year where applicable). NULL = not specified.
ALTER TABLE learners
  ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES academic_years(id);

-- 2. Assessment roster policy (requirement: how newly enrolled
--    learners behave for EXISTING assessments).
--    'auto_add'         = newly registered learners automatically
--                         appear in every assessment of their class.
--    'freeze_on_submit' = the roster is captured when marks are
--                         submitted; new learners only appear in
--                         assessments created afterwards.
ALTER TABLE school_settings
  ADD COLUMN IF NOT EXISTS assessment_roster_policy TEXT NOT NULL DEFAULT 'auto_add'
  CHECK (assessment_roster_policy IN ('auto_add', 'freeze_on_submit'));

-- 3. Roster snapshot: stored on the assessment row when marks are
--    submitted, used by the 'freeze_on_submit' policy.
ALTER TABLE assessments
  ADD COLUMN IF NOT EXISTS roster_learner_ids JSONB;

-- 4. Composite index for the most common learner lookup pattern
--    (class list + active status), used by teacher rosters and
--    marks entry.
CREATE INDEX IF NOT EXISTS idx_learners_class_status
  ON learners(class_id, status);

-- =====================================================
-- VERIFY
-- =====================================================
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('learners','assessments','school_settings')
  AND column_name IN ('academic_year_id','roster_learner_ids','assessment_roster_policy');