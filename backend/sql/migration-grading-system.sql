-- ============================================================
-- RMS-MIS GRADING SYSTEM ENHANCEMENT
-- Run in Supabase SQL Editor (idempotent).
-- 1. Enhances grading_scales table with descriptor, comment, is_pass, display_order, is_active
-- 2. Seeds the official RMS-MIS grading configuration
-- 3. Adds validation constraints
-- ============================================================

-- ------------------------------------------------------------
-- 1) ENHANCE grading_scales TABLE
-- ------------------------------------------------------------
ALTER TABLE public.grading_scales
  ADD COLUMN IF NOT EXISTS descriptor TEXT,
  ADD COLUMN IF NOT EXISTS comment TEXT,
  ADD COLUMN IF NOT EXISTS is_pass BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Add constraints to prevent invalid/overlapping ranges
-- We need a way to validate ranges - create a function for this
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'grading_scales_valid_range'
  ) THEN
    ALTER TABLE public.grading_scales
      ADD CONSTRAINT grading_scales_valid_range
      CHECK (minimum_percentage >= 0 AND maximum_percentage <= 100 AND minimum_percentage <= maximum_percentage);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'grading_scales_unique_grade'
  ) THEN
    ALTER TABLE public.grading_scales
      ADD CONSTRAINT grading_scales_unique_grade
      UNIQUE (grade);
  END IF;
END $$;

-- Create index for active scales ordered by display_order
CREATE INDEX IF NOT EXISTS idx_grading_scales_active_order
  ON public.grading_scales (is_active, display_order);

-- ------------------------------------------------------------
-- 2) SEED OFFICIAL RMS-MIS GRADING CONFIGURATION
-- ------------------------------------------------------------
-- Clear existing and insert the official configuration
DELETE FROM public.grading_scales;

INSERT INTO public.grading_scales
  (minimum_percentage, maximum_percentage, grade, descriptor, remark, comment, is_pass, display_order, is_active)
VALUES
  (80, 100, 'A', 'Excellent', 'Excellent', 
   'Excellent performance. Keep up the outstanding work and continue striving for greater achievement.',
   TRUE, 1, TRUE),
  (75, 79, 'B', 'Very Good', 'Very Good',
   'Very good performance. You have demonstrated strong understanding and consistent effort. Keep working hard.',
   TRUE, 2, TRUE),
  (70, 74, 'C', 'Good', 'Good',
   'Good performance. You have shown a good understanding of the subject. Continue practicing to improve further.',
   TRUE, 3, TRUE),
  (65, 69, 'D', 'Satisfactory', 'Satisfactory',
   'Satisfactory performance. You are making good progress. More practice and revision will help you achieve higher results.',
   TRUE, 4, TRUE),
  (60, 64, 'E', 'Adequate', 'Adequate',
   'Adequate performance. You have met the basic expectations. Continue working consistently to strengthen your understanding.',
   TRUE, 5, TRUE),
  (50, 59, 'S', 'Minimum Pass', 'Minimum Pass',
   'Minimum pass achieved. Increase your effort, revise regularly, and focus on areas that need improvement.',
   TRUE, 6, TRUE),
  (0, 49, 'F', 'Fail', 'Fail',
   'Performance needs improvement. Review the fundamental concepts, practice regularly, and seek support from your teacher where necessary.',
   FALSE, 7, TRUE);

-- ------------------------------------------------------------
-- 3) VERIFICATION QUERIES
-- ------------------------------------------------------------
-- Verify table structure
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'grading_scales'
ORDER BY ordinal_position;

-- Verify seeded data
SELECT minimum_percentage, maximum_percentage, grade, descriptor, remark, 
       is_pass, display_order, is_active, comment
FROM public.grading_scales
WHERE is_active = TRUE
ORDER BY display_order;

-- Verify no gaps in coverage (should cover 0-100)
SELECT 
  MIN(minimum_percentage) as min_boundary,
  MAX(maximum_percentage) as max_boundary,
  COUNT(*) as range_count
FROM public.grading_scales
WHERE is_active = TRUE;

-- Check for overlaps (should return 0 rows)
SELECT gs1.grade as grade1, gs2.grade as grade2
FROM public.grading_scales gs1
JOIN public.grading_scales gs2 ON gs1.id < gs2.id
WHERE gs1.is_active = TRUE AND gs2.is_active = TRUE
  AND gs1.minimum_percentage <= gs2.maximum_percentage
  AND gs1.maximum_percentage >= gs2.minimum_percentage;

-- ------------------------------------------------------------
-- 4) NOTIFY POSTGREST TO RELOAD SCHEMA
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';