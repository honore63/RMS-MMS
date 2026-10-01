-- ============================================================================
-- RMS-MIS — DOS EDUCATION-LEVEL ISOLATION VERIFICATION
-- Run in the Supabase SQL Editor. Read-only: every check is a SELECT inside a
-- transaction that is ROLLED BACK, so no data is changed.
--
-- HOW IT WORKS
--   SET LOCAL ROLE authenticated  -> queries run with RLS enforced
--   SET LOCAL "request.jwt.claims" -> makes auth.uid() return the test user
--   ROLLBACK                      -> nothing is persisted
--
-- STEP 1: list the DOS accounts and their assigned level.
-- ============================================================================

SELECT * FROM public.rms_dos_level_audit();

-- ============================================================================
-- STEP 2: note the two DOS user UUIDs from step 1 (primary + secondary).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- TEST 1 & 2 — PRIMARY DOS sees PRIMARY data only
-- Replace <PRIMARY_DOS_UUID> with the Primary DOS id from step 1.
-- Expected: every "leak_count" is 0.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<PRIMARY_DOS_UUID>","role":"authenticated"}';

SELECT 'primary_dos_identity' AS check_name,
       (SELECT education_level FROM public.users WHERE id = auth.uid()) AS resolved_level;

SELECT 'classes' AS entity,
       count(*) FILTER (WHERE public.rms_dos_can_level(education_level)) AS allowed,
       count(*) AS total
FROM public.classes;

-- Direct leakage probes: rows a Primary DOS must never resolve.
SELECT 'LEAK classes' AS check_name, count(*) AS leak_count
FROM public.classes
WHERE education_level IN ('Lower Secondary', 'Upper Secondary');

SELECT 'LEAK subjects' AS check_name, count(*) AS leak_count
FROM public.subjects
WHERE level IN ('Secondary', 'Lower Secondary', 'Upper Secondary');

SELECT 'LEAK assessments' AS check_name, count(*) AS leak_count
FROM public.assessments
WHERE public.rms_dos_can_level(
        (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)) = false;

SELECT 'LEAK marks' AS check_name, count(*) AS leak_count
FROM public.marks
WHERE NOT public.rms_dos_can_marks(assessment_id);

SELECT 'LEAK learners' AS check_name, count(*) AS leak_count
FROM public.learners
WHERE public.rms_dos_can_level(
        (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)) = false;

SELECT 'LEAK teacher_assignments' AS check_name, count(*) AS leak_count
FROM public.teacher_assignments
WHERE NOT public.rms_dos_can_level(
        (SELECT c.education_level FROM public.classes c WHERE c.id = teacher_assignments.class_id));

-- Teachers must be assignment-scoped to this DOS.
SELECT 'LEAK teachers (out of scope)' AS check_name, count(*) AS leak_count
FROM public.teachers
WHERE NOT public.rms_teacher_in_scope(id);

-- Cross-level WRITE attempts must be rejected (expect errors on both).
-- Uncomment one at a time to see the rejection:
-- INSERT INTO public.classes (name, education_level) VALUES ('LEAK-TEST', 'Upper Secondary');
-- UPDATE public.teachers SET education_level = 'SECONDARY'
--   WHERE id = (SELECT id FROM public.teachers LIMIT 1);
ROLLBACK;

-- ---------------------------------------------------------------------------
-- TEST 3 & 4 — SECONDARY DOS sees SECONDARY data only
-- Replace <SECONDARY_DOS_UUID> with the Secondary DOS id from step 1.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<SECONDARY_DOS_UUID>","role":"authenticated"}';

SELECT 'secondary_dos_identity' AS check_name,
       (SELECT education_level FROM public.users WHERE id = auth.uid()) AS resolved_level;

SELECT 'LEAK classes' AS check_name, count(*) AS leak_count
FROM public.classes
WHERE education_level = 'Primary';

SELECT 'LEAK subjects' AS check_name, count(*) AS leak_count
FROM public.subjects
WHERE level = 'Primary';

SELECT 'LEAK assessments' AS check_name, count(*) AS leak_count
FROM public.assessments
WHERE public.rms_dos_can_level(
        (SELECT c.education_level FROM public.classes c WHERE c.id = assessments.class_id)) = false;

SELECT 'LEAK marks' AS check_name, count(*) AS leak_count
FROM public.marks
WHERE NOT public.rms_dos_can_marks(assessment_id);

SELECT 'LEAK learners' AS check_name, count(*) AS leak_count
FROM public.learners
WHERE public.rms_dos_can_level(
        (SELECT c.education_level FROM public.classes c WHERE c.id = learners.class_id)) = false;

SELECT 'LEAK teachers (out of scope)' AS check_name, count(*) AS leak_count
FROM public.teachers
WHERE NOT public.rms_teacher_in_scope(id);
ROLLBACK;

-- ---------------------------------------------------------------------------
-- TEST 5 & 6 — TEACHER accounts are confined to their own rows
-- Replace with a Primary teacher id, then a Secondary teacher id.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<TEACHER_UUID>","role":"authenticated"}';

SELECT 'teacher_sees_own_row' AS check_name, count(*) AS visible_rows
FROM public.teachers WHERE user_id = auth.uid();

SELECT 'teacher_sees_other_teachers' AS check_name, count(*) AS leak_count
FROM public.teachers WHERE user_id IS DISTINCT FROM auth.uid();

-- A teacher must not be able to relabel their own level.
-- UPDATE public.users SET education_level = 'SECONDARY' WHERE id = auth.uid();  -- expect error
ROLLBACK;

-- ---------------------------------------------------------------------------
-- TEST 7 & 8 — LEARNER-level reach follows the learner's class level
-- Confirms the Class -> Education Level -> Learner inheritance chain.
-- Run as each DOS in turn; both leak counts must be 0.
-- ---------------------------------------------------------------------------
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claims" = '{"sub":"<PRIMARY_DOS_UUID>","role":"authenticated"}';

SELECT 'learners_in_scope' AS check_name, count(*) AS visible_rows
FROM public.learners;

SELECT 'learner_level_chain' AS check_name,
       c.education_level AS class_level,
       count(*) AS learners
FROM public.learners l
JOIN public.classes c ON c.id = l.class_id
GROUP BY c.education_level
ORDER BY 1;
ROLLBACK;

-- ============================================================================
-- EXPECTED RESULT: every "leak_count" is 0 for both DOS accounts, and the
-- DOS identity rows resolve to PRIMARY and SECONDARY respectively.
-- Any non-zero leak_count is a genuine isolation failure to investigate.
-- ============================================================================
