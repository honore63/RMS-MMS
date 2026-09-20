-- ============================================================================
-- RMS-MIS MIGRATION: Class Management & Expansion (S1-S6, Streams, RLS)
-- Safe to execute multiple times (idempotent).
-- ============================================================================

-- 1) Expand classes table with academic_year_id and status columns
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE CASCADE;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'));

-- 2) Unique constraint for duplicate prevention per academic year
-- Note: NULL academic_year_id is treated as default/global system classes
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'unique_class_per_academic_year'
  ) THEN
    ALTER TABLE public.classes ADD CONSTRAINT unique_class_per_academic_year UNIQUE NULLS NOT DISTINCT (name, academic_year_id);
  END IF;
EXCEPTION
  WHEN duplicate_table THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

-- 3) Seed the new requested secondary classes (if they do not already exist)
INSERT INTO public.classes (name, level, stream, status)
SELECT * FROM (VALUES
  ('S1', 'S1', NULL, 'active'),
  ('S2', 'S2', NULL, 'active'),
  ('S3', 'S3', NULL, 'active'),
  ('S4 – Stream 1', 'S4', 'Stream 1', 'active'),
  ('S4 – Stream 2', 'S4', 'Stream 2', 'active'),
  ('S5 – Stream 1', 'S5', 'Stream 1', 'active'),
  ('S5 – Stream 2', 'S5', 'Stream 2', 'active'),
  ('S6 – MEG', 'S6', 'MEG', 'active'),
  ('S6 – PCM', 'S6', 'PCM', 'active'),
  ('S6 – MCE', 'S6', 'MCE', 'active')
) AS v (name, level, stream, status)
WHERE NOT EXISTS (
  SELECT 1 FROM public.classes c WHERE c.name = v.name AND c.academic_year_id IS NULL
);

-- 4) Add indexes for high-performance querying
CREATE INDEX IF NOT EXISTS idx_classes_academic_year_id ON public.classes(academic_year_id);
CREATE INDEX IF NOT EXISTS idx_classes_status ON public.classes(status);
CREATE INDEX IF NOT EXISTS idx_classes_level ON public.classes(level);

-- 5) RLS Policies for Classes Table
-- Allow full access for anon/authenticated to ensure maximum compatibility with client application
-- (The UI enforces role-based rules for DOS editing vs Teacher read-only of assigned classes)
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_classes_all ON public.classes;
CREATE POLICY rms_classes_all ON public.classes FOR ALL USING (true) WITH CHECK (true);

GRANT ALL ON public.classes TO anon, authenticated;
