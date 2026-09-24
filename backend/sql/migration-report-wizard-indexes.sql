-- ============================================================
-- RMS-MIS: Report Wizard – Performance Indexes
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- Purpose: Accelerate the multi-step wizard's dependent queries
--   Period → Class(es) → Students → Subjects → Assessments → Terms
--   Supports multi-select arrays (IN / =ANY) and scope filtering.
--   Safe to re-run (idempotent – IF NOT EXISTS).
-- ============================================================

BEGIN;

-- 1) Learners: wizard loads students for selected classIds (IN)
--    query: WHERE class_id = ANY($1) AND status='active' ORDER BY full_name
CREATE INDEX IF NOT EXISTS idx_learners_wizard_class_status_name
  ON learners (class_id, status, full_name);
CREATE INDEX IF NOT EXISTS idx_learners_wizard_code
  ON learners (learner_code);

-- 2) Classes: wizard filters by education_level (Primary / Secondary)
--    query: WHERE education_level IN (...) ORDER BY name
--    Note: base table has `level`; education_level is added by
--    migration-education-level-class-grouping.sql – index both.
CREATE INDEX IF NOT EXISTS idx_classes_wizard_level
  ON classes (level, name);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='classes' AND column_name='education_level') THEN
    CREATE INDEX IF NOT EXISTS idx_classes_wizard_edu_level ON classes (education_level, name);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_classes_wizard_stream
  ON classes (stream) WHERE stream IS NOT NULL;

-- 3) Subjects: wizard scopes by level (Primary/Secondary/Both) and status
--    query: WHERE status='active' AND level IN (...) ORDER BY name
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='subjects' AND column_name='level') THEN
    CREATE INDEX IF NOT EXISTS idx_subjects_wizard_level_status ON subjects (level, status, name);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_subjects_wizard_code
  ON subjects (code) WHERE code IS NOT NULL;

-- 4) class_subjects junction: getClassSubjects(classId)
-- Guarded: table is created by migration-curriculum-subjects.sql
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='class_subjects') THEN
    CREATE INDEX IF NOT EXISTS idx_class_subjects_wizard_class ON class_subjects (class_id, subject_id);
    CREATE INDEX IF NOT EXISTS idx_class_subjects_wizard_subject ON class_subjects (subject_id, class_id);
  END IF;
END $$;

-- 5) Assessments: core wizard table – filtered by
--    class_id (ANY), subject_id (ANY), academic_year_id, term_id (ANY),
--    assessment_type_id, status (ANY), ordered by assessment_date DESC
--    Composite covers most wizard combinations.
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_main
  ON assessments (class_id, subject_id, academic_year_id, term_id, status, assessment_date DESC);
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_year_term
  ON assessments (academic_year_id, term_id, status);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='assessments' AND column_name='assessment_type_id') THEN
    CREATE INDEX IF NOT EXISTS idx_assessments_wizard_type_status ON assessments (assessment_type_id, status);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_assessments_wizard_teacher
  ON assessments (teacher_id, academic_year_id, status);

-- 6) Terms: wizard loads terms for selected academic_year_id (dynamic)
--    query: WHERE academic_year_id = $1 ORDER BY term_no
CREATE INDEX IF NOT EXISTS idx_terms_wizard_year_no
  ON terms (academic_year_id, term_no);
-- Note: base terms table has no `status` column; skip status index if column missing
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='terms' AND column_name='status') THEN
    CREATE INDEX IF NOT EXISTS idx_terms_wizard_status ON terms (status) WHERE status IS NOT NULL;
  END IF;
END $$;

-- 7) Academic years: for year selector
CREATE INDEX IF NOT EXISTS idx_academic_years_wizard_status
  ON academic_years (status, name);

-- 8) Marks: wizard preview aggregates marks by assessmentIds + learnerIds
--    query: WHERE assessment_id = ANY($1) AND learner_id = ANY($2)
CREATE INDEX IF NOT EXISTS idx_marks_wizard_assessment_learner
  ON marks (assessment_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_marks_wizard_learner_assessment
  ON marks (learner_id, assessment_id) WHERE mark IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_marks_wizard_percentage
  ON marks (percentage) WHERE percentage IS NOT NULL;

-- 9) Teacher assignments: wizard restricts classes/subjects for teacher role
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_wizard_teacher_class
  ON teacher_assignments (teacher_id, class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_wizard_all
  ON teacher_assignments (teacher_id, class_id, subject_id, academic_year_id, term_id);

-- 10) Grading: for options step (scale)
CREATE INDEX IF NOT EXISTS idx_grading_scales_wizard_range
  ON grading_scales (minimum_percentage, maximum_percentage);

-- Refresh stats (class_subjects only if exists)
ANALYZE learners;
ANALYZE classes;
ANALYZE subjects;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='class_subjects') THEN
    ANALYZE class_subjects;
  END IF;
END $$;
ANALYZE assessments;
ANALYZE terms;
ANALYZE academic_years;
ANALYZE marks;
ANALYZE teacher_assignments;

-- Verification (optional): show which wizard indexes exist
SELECT tablename, indexname
FROM pg_indexes
WHERE schemaname='public'
  AND indexname LIKE 'idx_%wizard%'
ORDER BY tablename, indexname;

COMMIT;
-- Run COMMIT; after reviewing verification output.
