-- ============================================================
-- RMS-MIS: Configurable performance comments for report cards
-- Run this in Supabase SQL Editor (Dashboard -> SQL Editor)
-- Deterministic mark-range remarks used by subject remarks,
-- overall comments and teacher/DOS default comments.
-- ============================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.performance_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_percentage NUMERIC NOT NULL CHECK (min_percentage >= 0 AND min_percentage <= 100),
  max_percentage NUMERIC NOT NULL CHECK (max_percentage >= 0 AND max_percentage <= 100),
  comment TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT 'All',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.performance_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_performance_comments_all ON public.performance_comments;
CREATE POLICY rms_performance_comments_all ON public.performance_comments
  FOR ALL USING (true) WITH CHECK (true);

GRANT SELECT ON public.performance_comments TO anon, authenticated;

CREATE INDEX IF NOT EXISTS idx_performance_comments_active_range
  ON public.performance_comments(active, min_percentage DESC);

-- Seed official default bands (only when table is empty)
INSERT INTO public.performance_comments (min_percentage, max_percentage, comment, level, active)
SELECT * FROM (VALUES
  (90, 100, 'Outstanding performance. Continue demonstrating excellence and consistency.', 'All', TRUE),
  (80, 89.99, 'Excellent performance. Keep up the good work and continue striving for higher achievement.', 'All', TRUE),
  (70, 79.99, 'Very good performance. Continue working consistently to improve further.', 'All', TRUE),
  (60, 69.99, 'Good performance. Continue practicing and focus on areas that need improvement.', 'All', TRUE),
  (50, 59.99, 'Satisfactory performance. More effort and regular practice are needed to improve.', 'All', TRUE),
  (40, 49.99, 'Performance needs improvement. Give more attention to learning activities and seek support where necessary.', 'All', TRUE),
  (0, 39.99, 'Needs significant improvement. Regular practice, guidance and additional support are recommended.', 'All', TRUE)
) AS seed(min_percentage, max_percentage, comment, level, active)
WHERE NOT EXISTS (SELECT 1 FROM public.performance_comments);

-- Verify
SELECT min_percentage, max_percentage, level, active, left(comment, 60) AS comment_preview
FROM public.performance_comments
ORDER BY min_percentage DESC;

COMMIT;