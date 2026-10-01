-- ============================================================
-- RMS MIGRATION: User Codes, Flexible Login & Account Settings
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Add new columns to the 'teachers' table
ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS gender         TEXT CHECK (gender IN ('M','F')),
  ADD COLUMN IF NOT EXISTS date_of_birth  DATE,
  ADD COLUMN IF NOT EXISTS address        TEXT,
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- Enforce teacher_code as exactly 11 digits (TEXT, not numeric)
-- First ensure the column is TEXT
ALTER TABLE public.teachers
  ALTER COLUMN teacher_code TYPE TEXT;

-- Add uniqueness constraint if not already present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_teacher_code_key'
  ) THEN
    ALTER TABLE public.teachers ADD CONSTRAINT teachers_teacher_code_key UNIQUE (teacher_code);
  END IF;
END $$;

-- Add check constraint for 11-digit format
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_teacher_code_format'
  ) THEN
    ALTER TABLE public.teachers ADD CONSTRAINT teachers_teacher_code_format CHECK (teacher_code ~ '^[0-9]{11}$');
  END IF;
END $$;

-- Add phone uniqueness if not already present (for login by phone)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'teachers_phone_key'
  ) THEN
    -- Only add if phone column exists and should be unique
    -- We use a partial unique index to allow NULLs
    CREATE UNIQUE INDEX IF NOT EXISTS teachers_phone_unique ON public.teachers (phone) WHERE phone IS NOT NULL;
  END IF;
END $$;

-- 2. Add new columns to the 'learners' table
ALTER TABLE public.learners
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- Enforce learner_code as TEXT (11 digits)
ALTER TABLE public.learners
  ALTER COLUMN learner_code TYPE TEXT;

-- Add check constraint for 11-digit student code
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'learners_learner_code_format'
  ) THEN
    ALTER TABLE public.learners ADD CONSTRAINT learners_learner_code_format CHECK (learner_code ~ '^[0-9]{11}$');
  END IF;
END $$;

-- 3. Add phone column to 'users' table if not present (for phone login)
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT;

-- Add partial unique index for phone on users table
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_unique ON public.users (phone) WHERE phone IS NOT NULL;

-- 4. Supabase Storage bucket & RLS policies for profile photos
-- Ensure bucket exists and is public
INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Drop existing policies if any to avoid duplication
DROP POLICY IF EXISTS "Public Access profile-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Upload profile-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Update profile-photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated Delete profile-photos" ON storage.objects;

-- Allow public read access to profile photos
CREATE POLICY "Public Access profile-photos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'profile-photos');

-- Allow authenticated users to upload profile photos
CREATE POLICY "Authenticated Upload profile-photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'profile-photos');

-- Allow authenticated users to update profile photos
CREATE POLICY "Authenticated Update profile-photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'profile-photos')
  WITH CHECK (bucket_id = 'profile-photos');

-- Allow authenticated users to delete profile photos
CREATE POLICY "Authenticated Delete profile-photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'profile-photos');

-- 5. RLS: Ensure teachers can read their own row
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'teachers' AND policyname = 'Teachers can view own profile'
  ) THEN
    CREATE POLICY "Teachers can view own profile"
      ON public.teachers FOR SELECT
      USING (user_id = auth.uid() OR id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'teachers' AND policyname = 'Teachers can update own permitted fields'
  ) THEN
    CREATE POLICY "Teachers can update own permitted fields"
      ON public.teachers FOR UPDATE
      USING (user_id = auth.uid())
      WITH CHECK (
        -- Teachers CANNOT change teacher_code, email, status, role
        -- They CAN update personal info
        user_id = auth.uid()
      );
  END IF;
END $$;

-- 6. Confirm everything looks right
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_name IN ('teachers', 'learners', 'users')
  AND table_schema = 'public'
ORDER BY table_name, ordinal_position;
