-- Add normalized marks without changing the teacher-entered raw mark.
ALTER TABLE marks ADD COLUMN IF NOT EXISTS original_mark NUMERIC;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS original_maximum NUMERIC;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS normalized_mark NUMERIC;

UPDATE marks m
SET original_mark = COALESCE(m.original_mark, m.mark),
    original_maximum = COALESCE(m.original_maximum, a.maximum_mark)
FROM assessments a
WHERE a.id = m.assessment_id
  AND m.mark IS NOT NULL
  AND (m.original_mark IS NULL OR m.original_maximum IS NULL);

UPDATE marks m
SET normalized_mark = ROUND((m.mark / a.maximum_mark) * 100, 2),
    percentage = ROUND((m.mark / a.maximum_mark) * 100, 2)
FROM assessments a
WHERE a.id = m.assessment_id
  AND m.mark IS NOT NULL
  AND a.maximum_mark > 0
  AND m.normalized_mark IS NULL;
