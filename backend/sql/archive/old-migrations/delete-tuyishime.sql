-- ============================================================================
-- DELETE SPECIFIC TEACHER SCRIPT
-- ============================================================================
-- This will delete "Tuyishime Honore" from both the `users` and `teachers` 
-- tables in your database. 
-- (Because of the database rules, deleting the user automatically cascades 
-- and deletes their teacher record as well).

DELETE FROM public.users 
WHERE full_name ILIKE '%Tuyishime Honore%';
