-- RMS-MIS: compact assessment abbreviations for report headers
-- Existing non-empty codes are preserved. Missing codes receive unique
-- initials derived from the assessment type name.

ALTER TABLE public.assessment_types ADD COLUMN IF NOT EXISTS code TEXT;

-- Official RMS-MIS assessment abbreviations used in report headers.
UPDATE public.assessment_types
SET code = CASE lower(btrim(name))
  WHEN 'assignment' THEN 'ASSG'
  WHEN 'beginning examination' THEN 'BE'
  WHEN 'continuous assessment test' THEN 'CAT'
  WHEN 'end-of-term examination' THEN 'ETE'
  WHEN 'end of term examination' THEN 'ETE'
  WHEN 'end-of-unit assessment' THEN 'EUA'
  WHEN 'end of unit assessment' THEN 'EUA'
  WHEN 'fat' THEN 'FAT'
  WHEN 'mid-term examination' THEN 'MTE'
  WHEN 'mid term examination' THEN 'MTE'
  WHEN 'monthly test' THEN 'MT'
  WHEN 'other assessment' THEN 'OA'
  WHEN 'practical assessment' THEN 'PA'
  WHEN 'project' THEN 'PROJ'
  WHEN 'quiz' THEN 'QUIZ'
  WHEN 'weekly test' THEN 'WT'
  WHEN 'practical' THEN 'PRAC'
  WHEN 'class test' THEN 'CT'
  WHEN 'continuous assessment' THEN 'CA'
  WHEN 'oral assessment' THEN 'ORAL'
  WHEN 'terminal examination' THEN 'TE'
  WHEN 'other' THEN 'OTHER'
  ELSE code
END
WHERE lower(btrim(name)) IN (
  'assignment', 'beginning examination', 'continuous assessment test',
  'end-of-term examination', 'end of term examination',
  'end-of-unit assessment', 'end of unit assessment', 'fat',
  'mid-term examination', 'mid term examination', 'monthly test',
  'other assessment', 'practical assessment', 'project', 'quiz',
  'weekly test', 'practical', 'class test', 'continuous assessment',
  'oral assessment', 'terminal examination', 'other'
);

DO $$
DECLARE
  item record;
  base_code TEXT;
  candidate TEXT;
  suffix INTEGER;
BEGIN
  FOR item IN
    SELECT id, name
    FROM public.assessment_types
    WHERE code IS NULL OR btrim(code) = ''
    ORDER BY display_order NULLS LAST, name
  LOOP
    base_code := upper(
      left(
        regexp_replace(
          coalesce(
            (SELECT string_agg(left(word, 1), '' ORDER BY ord)
             FROM regexp_split_to_table(btrim(item.name), '\s+') WITH ORDINALITY AS words(word, ord)
             WHERE word <> ''),
            'ASSESSMENT'
          ),
          '[^A-Z0-9]', '', 'g'
        ),
        6
      )
    );
    IF base_code = '' THEN base_code := 'ASSESS'; END IF;

    candidate := base_code;
    suffix := 1;
    WHILE EXISTS (
      SELECT 1 FROM public.assessment_types t
      WHERE upper(btrim(t.code)) = candidate AND t.id <> item.id
    ) LOOP
      suffix := suffix + 1;
      candidate := left(base_code, greatest(1, 6 - length(suffix::text))) || suffix::text;
    END LOOP;

    UPDATE public.assessment_types
    SET code = candidate
    WHERE id = item.id;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS assessment_types_code_key
  ON public.assessment_types (upper(btrim(code)))
  WHERE code IS NOT NULL AND btrim(code) <> '';

SELECT id, name, code
FROM public.assessment_types
ORDER BY display_order NULLS LAST, name;

-- All assessments currently stored in the database, including the short code
-- that will appear in report headers.
SELECT
  a.id,
  a.name AS assessment_name,
  a.unit,
  at.name AS assessment_type,
  at.code AS assessment_abbreviation,
  s.name AS subject,
  c.name AS class,
  ay.name AS academic_year,
  t.name AS term,
  a.maximum_mark,
  a.assessment_date,
  a.status
FROM public.assessments a
LEFT JOIN public.assessment_types at ON at.id = a.assessment_type_id
LEFT JOIN public.subjects s ON s.id = a.subject_id
LEFT JOIN public.classes c ON c.id = a.class_id
LEFT JOIN public.academic_years ay ON ay.id = a.academic_year_id
LEFT JOIN public.terms t ON t.id = a.term_id
ORDER BY a.assessment_date DESC NULLS LAST, c.name, s.name, a.name;
