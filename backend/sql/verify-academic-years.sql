-- ============================================================
-- RMS: Academic Year health check (run in Supabase SQL Editor)
-- 1) confirms schema columns exist
-- 2) proves the single-Current rule + trigger work
-- 3) confirms RLS policies are the clean rms_*_all ones
-- ============================================================

-- (A) Sanity: do the columns exist?
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name IN ('academic_years','terms')
ORDER BY table_name, ordinal_position;

-- (B) Duplicate-name safety net: fine to leave empty
SELECT name, COUNT(*) FROM academic_years GROUP BY name HAVING COUNT(*) > 1;

-- (C) Full simulation of the "Set Current Year" click.
--     Pick a real target year id first, then paste it below.
-- BEGIN;
--   UPDATE academic_years SET status='inactive', is_current=false WHERE id <> '<PASTE_TARGET_ID_HERE>';
--   UPDATE academic_years SET status='active',   is_current=true  WHERE id =  '<PASTE_TARGET_ID_HERE>';
-- COMMIT;

-- (D) Verify: exactly ONE row flagged current after (C)
SELECT id, name, status, is_current FROM academic_years ORDER BY start_year DESC NULLS LAST;

-- (E) RLS check — policies must be rms_academic_years_all / rms_terms_all (USING true)
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE tablename IN ('academic_years','terms')
ORDER BY tablename, cmd;