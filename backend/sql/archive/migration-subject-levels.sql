-- ============================================================
-- RMS-MIS: Subject Levels SQL Patch
-- Run this in Supabase → SQL Editor ONCE
-- Adds level column to the subjects table to distinguish
-- Primary vs Secondary subjects.
-- ============================================================

ALTER TABLE public.subjects
  ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Both';

-- Optional: auto-categorize some defaults if we know them
UPDATE public.subjects SET level = 'Primary' WHERE name ILIKE '%Elementary Technology%' OR name ILIKE '%Social Studies%';
UPDATE public.subjects SET level = 'Secondary' WHERE name ILIKE '%Chemistry%' OR name ILIKE '%Physics%' OR name ILIKE '%Biology%';

GRANT ALL ON public.subjects TO anon, authenticated;
