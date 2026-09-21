-- ==============================================================================
-- RMS-MIS: MIGRATION FOR EDUCATION LEVEL & CLASS GROUPING
-- Group classes into Primary, Lower Secondary, and Upper Secondary
-- Extensible reference table + backfilling existing class records safely.
-- ==============================================================================

-- 1. Create education_levels reference table
CREATE TABLE IF NOT EXISTS public.education_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS & Grants for education_levels
ALTER TABLE public.education_levels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "everyone_read_education_levels" ON public.education_levels;
CREATE POLICY "everyone_read_education_levels" ON public.education_levels FOR SELECT USING (true);
GRANT SELECT ON TABLE public.education_levels TO authenticated, anon;

-- 2. Seed Default Education Levels
INSERT INTO public.education_levels (name, code, description, display_order, active)
VALUES 
  ('Primary', 'PRIMARY', 'Primary Education (P1 - P6)', 1, true),
  ('Lower Secondary', 'LOWER_SECONDARY', 'Lower Secondary Education (S1 - S3)', 2, true),
  ('Upper Secondary', 'UPPER_SECONDARY', 'Upper Secondary Education (S4 - S6)', 3, true),
  ('Nursery', 'NURSERY', 'Pre-Primary / Nursery Education', 0, false),
  ('TVET', 'TVET', 'Technical & Vocational Education', 4, false)
ON CONFLICT (code) DO UPDATE SET 
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order;

-- 3. Enhance classes table with education_level and education_level_id
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS education_level_id UUID REFERENCES public.education_levels(id);

-- 4. Backfill existing classes based on level / name
UPDATE public.classes
SET education_level = 'Primary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'PRIMARY' LIMIT 1)
WHERE level IN ('P1','P2','P3','P4','P5','P6') OR level ILIKE 'P%' OR name ILIKE 'P%';

UPDATE public.classes
SET education_level = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE level IN ('S1','S2','S3') OR (name ~ '^S[1-3](\s|$)');

UPDATE public.classes
SET education_level = 'Upper Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'UPPER_SECONDARY' LIMIT 1)
WHERE level IN ('S4','S5','S6') OR (name ~ '^S[4-6](\s|$)');

-- Default fallback for any unassigned classes
UPDATE public.classes
SET education_level = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE education_level IS NULL;

-- 5. Ensure subjects table has level / education_level support
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Both';
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS education_level TEXT DEFAULT 'Both';

-- Backfill subjects level if empty
UPDATE public.subjects SET level = 'Both' WHERE level IS NULL;
UPDATE public.subjects SET education_level = level WHERE education_level IS NULL;
