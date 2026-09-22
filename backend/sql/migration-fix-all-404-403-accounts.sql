-- ==============================================================================
-- RMS-MIS: MASTER FIX MIGRATION
-- Fixes: 1) education_levels 404, 2) teacher_assignments 403, 3) local-only accounts
-- Run this ENTIRE script in Supabase → SQL Editor → Run
-- ==============================================================================


-- ==============================================================================
-- PART 1: CREATE education_levels TABLE (fixes 404)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.education_levels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,
  code TEXT UNIQUE NOT NULL,
  description TEXT,
  display_order INT DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.education_levels ENABLE ROW LEVEL SECURITY;

-- Drop old policies if they exist
DROP POLICY IF EXISTS "everyone_read_education_levels" ON public.education_levels;
DROP POLICY IF EXISTS "anon_read_education_levels" ON public.education_levels;

-- Allow EVERYONE (anon + authenticated) to read
CREATE POLICY "everyone_read_education_levels"
  ON public.education_levels FOR SELECT
  USING (true);

-- Grant read access to both roles
GRANT SELECT ON TABLE public.education_levels TO authenticated, anon;

-- Seed default education levels
INSERT INTO public.education_levels (name, code, description, display_order, active)
VALUES
  ('Primary',         'PRIMARY',         'Primary Education (P1 - P6)',              1, true),
  ('Lower Secondary', 'LOWER_SECONDARY', 'Lower Secondary Education (S1 - S3)',       2, true),
  ('Upper Secondary', 'UPPER_SECONDARY', 'Upper Secondary Education (S4 - S6)',       3, true),
  ('Nursery',         'NURSERY',         'Pre-Primary / Nursery Education',           0, false),
  ('TVET',            'TVET',            'Technical & Vocational Education',          4, false)
ON CONFLICT (code) DO UPDATE SET
  name          = EXCLUDED.name,
  description   = EXCLUDED.description,
  display_order = EXCLUDED.display_order;

-- Add education_level columns to classes if not yet added
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS education_level TEXT;
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS education_level_id UUID REFERENCES public.education_levels(id);

-- Backfill existing classes
UPDATE public.classes
SET education_level    = 'Primary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'PRIMARY' LIMIT 1)
WHERE level IN ('P1','P2','P3','P4','P5','P6')
   OR level ILIKE 'P%'
   OR name  ILIKE 'P%';

UPDATE public.classes
SET education_level    = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE level IN ('S1','S2','S3')
   OR (name ~ '^S[1-3](\s|$)');

UPDATE public.classes
SET education_level    = 'Upper Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'UPPER_SECONDARY' LIMIT 1)
WHERE level IN ('S4','S5','S6')
   OR (name ~ '^S[4-6](\s|$)');

-- Default fallback for any still-unassigned classes
UPDATE public.classes
SET education_level    = 'Lower Secondary',
    education_level_id = (SELECT id FROM public.education_levels WHERE code = 'LOWER_SECONDARY' LIMIT 1)
WHERE education_level IS NULL;

-- Add level columns to subjects if not yet added
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'Both';
ALTER TABLE public.subjects ADD COLUMN IF NOT EXISTS education_level TEXT DEFAULT 'Both';
UPDATE public.subjects SET level = 'Both' WHERE level IS NULL;
UPDATE public.subjects SET education_level = level WHERE education_level IS NULL;


-- ==============================================================================
-- PART 2: FIX teacher_assignments RLS 403
-- ==============================================================================

-- Step 2a: Fix mismatched public.users.id vs auth.users.id (most common 403 cause)
UPDATE public.users u
SET id = au.id
FROM auth.users au
WHERE u.email = au.email
  AND u.id <> au.id
  AND NOT EXISTS (
    SELECT 1 FROM public.users other
    WHERE other.id = au.id AND other.email <> au.email
  );

-- Step 2b: Ensure DOS/admin accounts have the correct role and are active
UPDATE public.users
SET role = 'dos', status = 'active'
WHERE email IN (
  'dos@rukara.edu',
  'admin@rukara.edu',
  'honore@rukara.edu'   -- add any other admin emails here
)
  AND (role <> 'dos' OR status <> 'active');

-- Step 2c: Drop and recreate teacher_assignments INSERT policy so DOS can write
DO $$
BEGIN
  -- Remove overly-restrictive old policy if present
  DROP POLICY IF EXISTS "rms_teacher_assignments_insert" ON public.teacher_assignments;
  DROP POLICY IF EXISTS "dos_insert_teacher_assignments"  ON public.teacher_assignments;
  DROP POLICY IF EXISTS "dos_delete_teacher_assignments"  ON public.teacher_assignments;
  DROP POLICY IF EXISTS "teacher_select_own_assignments"  ON public.teacher_assignments;
  DROP POLICY IF EXISTS "dos_select_all_assignments"      ON public.teacher_assignments;

  -- Make sure RLS is enabled
  ALTER TABLE public.teacher_assignments ENABLE ROW LEVEL SECURITY;

  -- DOS can SELECT all
  CREATE POLICY "dos_select_all_assignments"
    ON public.teacher_assignments FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'dos' AND status = 'active'
      )
    );

  -- Teachers can SELECT their own
  CREATE POLICY "teacher_select_own_assignments"
    ON public.teacher_assignments FOR SELECT
    USING (
      teacher_id IN (
        SELECT t.id FROM public.teachers t WHERE t.user_id = auth.uid()
      )
    );

  -- DOS can INSERT
  CREATE POLICY "dos_insert_teacher_assignments"
    ON public.teacher_assignments FOR INSERT
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'dos' AND status = 'active'
      )
    );

  -- DOS can DELETE
  CREATE POLICY "dos_delete_teacher_assignments"
    ON public.teacher_assignments FOR DELETE
    USING (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'dos' AND status = 'active'
      )
    );

  -- DOS can UPDATE
  DROP POLICY IF EXISTS "dos_update_teacher_assignments" ON public.teacher_assignments;
  CREATE POLICY "dos_update_teacher_assignments"
    ON public.teacher_assignments FOR UPDATE
    USING (
      EXISTS (
        SELECT 1 FROM public.users
        WHERE id = auth.uid() AND role = 'dos' AND status = 'active'
      )
    );
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.teacher_assignments TO authenticated;


-- ==============================================================================
-- PART 3: DIAGNOSE local-only accounts (users in public.users with no auth entry)
-- ==============================================================================
-- This SELECT shows which public.users rows have no matching auth.users row.
-- These accounts CAN'T log in because Supabase Auth doesn't know about them.
-- You need to create them via: Supabase Dashboard → Authentication → Users → "Add User"

SELECT
  u.id            AS public_user_id,
  u.email         AS email,
  u.full_name     AS full_name,
  u.role          AS role,
  u.status        AS status,
  CASE
    WHEN au.id IS NULL THEN '⚠️  NO AUTH ENTRY — must be created in Auth dashboard'
    WHEN u.id <> au.id THEN '⚠️  ID MISMATCH — was auto-fixed above'
    ELSE '✅ OK'
  END AS verdict
FROM public.users u
LEFT JOIN auth.users au ON au.email = u.email
ORDER BY verdict, u.email;


-- ==============================================================================
-- PART 4: RELOAD PostgREST so all changes take effect immediately
-- ==============================================================================
NOTIFY pgrst, 'reload schema';


-- ==============================================================================
-- VERIFICATION
-- ==============================================================================
SELECT 'education_levels rows' AS check_name, COUNT(*) AS count FROM public.education_levels
UNION ALL
SELECT 'teacher_assignments policies', COUNT(*) FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'teacher_assignments'
UNION ALL
SELECT 'classes with education_level set', COUNT(*) FROM public.classes
  WHERE education_level IS NOT NULL;
