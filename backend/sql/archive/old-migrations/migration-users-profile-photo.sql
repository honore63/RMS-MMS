-- ============================================================
-- RMS MIGRATION: account profile photo + real display names
-- The sidebar account chip shows users.full_name with a photo
-- when one is set. Teachers already store photos on
-- teachers.profile_photo_url (via My Account); DOS/admin
-- accounts had no photo column until now.
-- Run in Supabase SQL Editor. Idempotent.
-- ============================================================

-- 1) Photo column on the account row (flows into the app via
--    the existing users SELECT * at login — no app change needed
--    for it to appear once set).
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT;

-- 2) Inspect the current display names vs login emails so any
--    auto-generated name (built from the email address, e.g. a
--    trailing "111" coming from the email itself) can be fixed.
SELECT id, email, full_name, role, status
FROM public.users
ORDER BY email;

-- 3) Fix a display name (example — edit the name and email,
--    then run). The chip shows full_name exactly as stored.
-- UPDATE public.users
-- SET full_name = 'TUYISHIME Honore'
-- WHERE email = 'tuyishimehonore111@gmail.com';

-- 4) Point a DOS account at a hosted photo (example — edit,
--    then run). Teacher accounts use the photo uploaded from
--    My Account instead.
-- UPDATE public.users
-- SET profile_photo_url = 'https://your-host/photos/dos.jpg'
-- WHERE email = 'tuyishimehonore111@gmail.com';

NOTIFY pgrst, 'reload schema';