-- ============================================================
-- RMS-MIS: Report Card SQL Patch
-- Run this in Supabase → SQL Editor ONCE
-- Adds term_no (sort order) column to the terms table
-- Safe to run multiple times.
-- ============================================================

-- Add term sort-order column (1 = Term 1, 2 = Term 2, etc.)
ALTER TABLE public.terms
  ADD COLUMN IF NOT EXISTS term_no INTEGER DEFAULT 1;

-- Auto-populate term_no from the term name if it contains a number
UPDATE public.terms
SET term_no = CASE
  WHEN name ILIKE '%3%' THEN 3
  WHEN name ILIKE '%2%' THEN 2
  ELSE 1
END
WHERE term_no IS NULL OR term_no = 0;

-- Grant access
GRANT ALL ON public.terms TO anon, authenticated;

-- Verify
SELECT id, name, term_no, academic_year_id FROM public.terms ORDER BY academic_year_id, term_no;
