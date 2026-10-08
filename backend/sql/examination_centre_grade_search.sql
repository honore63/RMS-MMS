-- Allow a grade-only guest search such as P4 to find examinations assigned
-- to its section classes, such as P4A and P4B. Exact class searches remain
-- supported, and section matching is limited to a single trailing letter.
CREATE OR REPLACE FUNCTION public.rms_exam_guest_list(p_class_name TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_exams JSONB;
  v_class_search TEXT;
BEGIN
  IF length(btrim(coalesce(p_class_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Enter your class name.';
  END IF;

  v_class_search := regexp_replace(lower(btrim(p_class_name)), '[[:space:]]+', '', 'g');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'title', e.title,
    'description', e.description,
    'duration_minutes', e.duration_minutes,
    'attempt_limit', e.attempt_limit,
    'status', e.status,
    'available', e.status = 'open'
      AND (e.start_at IS NULL OR e.start_at <= NOW())
      AND (e.end_at IS NULL OR e.end_at > NOW()),
    'class_names', (
      SELECT coalesce(jsonb_agg(DISTINCT c.name ORDER BY c.name), '[]'::jsonb)
      FROM public.examination_classes ec
      JOIN public.classes c ON c.id = ec.class_id
      CROSS JOIN LATERAL (
        SELECT regexp_replace(lower(btrim(c.name)), '[[:space:]]+', '', 'g') AS normalized_name
      ) AS class_name
      WHERE ec.exam_id = e.id
        AND c.status = 'active'
        AND (
          class_name.normalized_name = v_class_search
          OR (
            v_class_search ~ '^[a-z]+[0-9]+$'
            AND length(class_name.normalized_name) = length(v_class_search) + 1
            AND left(class_name.normalized_name, length(v_class_search)) = v_class_search
            AND right(class_name.normalized_name, 1) ~ '^[a-z]$'
          )
        )
    )
  ) ORDER BY e.title), '[]'::jsonb)
  INTO v_exams
  FROM public.examinations e
  WHERE EXISTS (
    SELECT 1
    FROM public.examination_classes ec
    JOIN public.classes c ON c.id = ec.class_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(lower(btrim(c.name)), '[[:space:]]+', '', 'g') AS normalized_name
    ) AS class_name
    WHERE ec.exam_id = e.id
      AND c.status = 'active'
      AND (
        class_name.normalized_name = v_class_search
        OR (
          v_class_search ~ '^[a-z]+[0-9]+$'
          AND length(class_name.normalized_name) = length(v_class_search) + 1
          AND left(class_name.normalized_name, length(v_class_search)) = v_class_search
          AND right(class_name.normalized_name, 1) ~ '^[a-z]$'
        )
      )
  )
    AND e.status <> 'archived';

  RETURN v_exams;
END;
$fn$;

REVOKE ALL ON FUNCTION public.rms_exam_guest_list(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rms_exam_guest_list(TEXT) TO anon, authenticated;
