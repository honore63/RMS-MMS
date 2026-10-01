-- Fix DOS marks visibility when the dashboard shows assessments but the
-- Marks page returns no rows. Run after the education-level scope migration.

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS education_level TEXT;

UPDATE public.classes
SET education_level = 'Primary'
WHERE level ILIKE 'P%'
   OR name ILIKE 'P%';

UPDATE public.classes
SET education_level = 'Lower Secondary'
WHERE (level ILIKE 'S1%' OR level ILIKE 'S2%' OR level ILIKE 'S3%'
    OR name ILIKE 'S1%' OR name ILIKE 'S2%' OR name ILIKE 'S3%');

UPDATE public.classes
SET education_level = 'Upper Secondary'
WHERE (level ILIKE 'S4%' OR level ILIKE 'S5%' OR level ILIKE 'S6%'
    OR name ILIKE 'S4%' OR name ILIKE 'S5%' OR name ILIKE 'S6%');

ALTER TABLE public.marks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_marks_select ON public.marks;

CREATE POLICY rms_marks_select
ON public.marks
FOR SELECT
USING (
  public.rms_dos_can_marks(marks.assessment_id)
  OR public.rms_teacher_can_assessment(marks.assessment_id)
);

GRANT SELECT ON public.marks TO authenticated;

NOTIFY pgrst, 'reload schema';

-- Verification: the P5A assessment and its marks should be returned here.
SELECT
  a.id AS assessment_id,
  a.name AS assessment_name,
  a.status AS assessment_status,
  c.name AS class_name,
  c.level AS class_level,
  c.education_level,
  COUNT(m.id) AS mark_count,
  COUNT(m.id) FILTER (WHERE m.status = 'submitted') AS submitted_mark_count
FROM public.assessments a
JOIN public.classes c ON c.id = a.class_id
LEFT JOIN public.marks m ON m.assessment_id = a.id
WHERE c.name ILIKE 'P5A'
GROUP BY a.id, a.name, a.status, c.name, c.level, c.education_level
ORDER BY a.created_at DESC;