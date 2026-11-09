-- Ensure the Primary curriculum is consistently classified and use the same
-- normalized class/subject compatibility checks in every database write and
-- access path. French is allowed for P1-P6 and remains Primary-only;
-- existing assignments are preserved.
BEGIN;

INSERT INTO public.subjects (name, code, status, level, education_level)
SELECT subject.name, subject.code, 'active', subject.level, subject.level
FROM (VALUES
  ('Mathematics', 'MATH', 'Both'),
  ('English', 'ENG', 'Both'),
  ('Kinyarwanda', 'KIN', 'Both'),
  ('French', 'FRE', 'Primary'),
  ('Science and Elementary Technology', 'SET', 'Primary'),
  ('Social and Religious Studies', 'SRS', 'Primary'),
  ('Creative Arts', 'CA', 'Primary'),
  ('Physical Education', 'PE', 'Primary')
) AS subject(name, code, level)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.subjects AS existing
  WHERE upper(btrim(coalesce(existing.code, ''))) = upper(subject.code)
     OR upper(btrim(coalesce(existing.name, ''))) = upper(subject.name)
)
ON CONFLICT DO NOTHING;

UPDATE public.subjects
SET status = 'active',
    level = CASE
      WHEN upper(btrim(coalesce(code, ''))) IN ('FRE', 'SET', 'SRS', 'CA', 'PE')
        OR upper(btrim(coalesce(name, ''))) IN (
          'FRENCH', 'SCIENCE AND ELEMENTARY TECHNOLOGY',
          'SOCIAL AND RELIGIOUS STUDIES', 'CREATIVE ARTS', 'PHYSICAL EDUCATION'
        ) THEN 'Primary'
      ELSE 'Both'
    END,
    education_level = CASE
      WHEN upper(btrim(coalesce(code, ''))) IN ('FRE', 'SET', 'SRS', 'CA', 'PE')
        OR upper(btrim(coalesce(name, ''))) IN (
          'FRENCH', 'SCIENCE AND ELEMENTARY TECHNOLOGY',
          'SOCIAL AND RELIGIOUS STUDIES', 'CREATIVE ARTS', 'PHYSICAL EDUCATION'
        ) THEN 'Primary'
      ELSE 'Both'
    END
WHERE upper(btrim(coalesce(code, ''))) IN ('MATH', 'ENG', 'KIN', 'FRE', 'SET', 'SRS', 'CA', 'PE')
   OR upper(btrim(coalesce(name, ''))) IN (
     'MATHEMATICS', 'ENGLISH', 'KINYARWANDA', 'FRENCH',
     'SCIENCE AND ELEMENTARY TECHNOLOGY', 'SOCIAL AND RELIGIOUS STUDIES',
     'CREATIVE ARTS', 'PHYSICAL EDUCATION'
   );

-- French is part of the Primary curriculum for P1-P6. Remove stale
-- secondary-grade entries that conflict with its Primary-only classification.
UPDATE public.subjects
SET grades = 'P1,P2,P3,P4,P5,P6'
WHERE upper(btrim(coalesce(code, ''))) = 'FRE'
   OR upper(btrim(coalesce(name, ''))) = 'FRENCH';

CREATE OR REPLACE FUNCTION public.rms_dos_can_level(p_level TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY'
      THEN upper(regexp_replace(btrim(coalesce(p_level, '')), '[[:space:]_-]+', ' ', 'g'))
        IN ('PRIMARY', 'LOWER PRIMARY')
    WHEN public.rms_dos_education_level() = 'SECONDARY'
      THEN upper(regexp_replace(btrim(coalesce(p_level, '')), '[[:space:]_-]+', ' ', 'g'))
        IN ('SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_dos_can_subject(p_level TEXT)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN NOT public.rms_is_dos() THEN true
    WHEN public.rms_dos_education_level() IS NULL THEN true
    WHEN p_level IS NULL
      OR upper(regexp_replace(btrim(p_level), '[[:space:]_-]+', ' ', 'g')) IN ('BOTH', 'ALL') THEN true
    WHEN public.rms_dos_education_level() = 'PRIMARY'
      THEN upper(regexp_replace(btrim(p_level), '[[:space:]_-]+', ' ', 'g'))
        IN ('PRIMARY', 'LOWER PRIMARY')
    WHEN public.rms_dos_education_level() = 'SECONDARY'
      THEN upper(regexp_replace(btrim(p_level), '[[:space:]_-]+', ' ', 'g'))
        IN ('SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    ELSE false
  END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_level_allows(
  p_teacher_id UUID,
  p_education_level TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN upper(regexp_replace(btrim(coalesce(t.education_level, '')), '[[:space:]_-]+', ' ', 'g'))
      IN ('BOTH', 'ALL') THEN true
    WHEN upper(regexp_replace(btrim(coalesce(t.education_level, '')), '[[:space:]_-]+', ' ', 'g')) = 'PRIMARY'
      THEN upper(regexp_replace(btrim(coalesce(p_education_level, '')), '[[:space:]_-]+', ' ', 'g'))
        IN ('PRIMARY', 'LOWER PRIMARY')
    WHEN upper(regexp_replace(btrim(coalesce(t.education_level, '')), '[[:space:]_-]+', ' ', 'g')) = 'SECONDARY'
      THEN upper(regexp_replace(btrim(coalesce(p_education_level, '')), '[[:space:]_-]+', ' ', 'g'))
        IN ('SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    ELSE false
  END
  FROM public.teachers t
  WHERE t.id = p_teacher_id AND t.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.rms_teacher_subject_level_allows(
  p_teacher_id UUID,
  p_subject_level TEXT
)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT CASE
    WHEN upper(regexp_replace(btrim(coalesce(t.education_level, '')), '[[:space:]_-]+', ' ', 'g'))
      IN ('BOTH', 'ALL') THEN true
    WHEN upper(regexp_replace(btrim(coalesce(p_subject_level, '')), '[[:space:]_-]+', ' ', 'g'))
      IN ('BOTH', 'ALL') THEN true
    WHEN upper(regexp_replace(btrim(coalesce(t.education_level, '')), '[[:space:]_-]+', ' ', 'g')) = 'PRIMARY'
      THEN upper(regexp_replace(btrim(coalesce(p_subject_level, '')), '[[:space:]_-]+', ' ', 'g'))
        IN ('PRIMARY', 'LOWER PRIMARY')
    WHEN upper(regexp_replace(btrim(coalesce(t.education_level, '')), '[[:space:]_-]+', ' ', 'g')) = 'SECONDARY'
      THEN upper(regexp_replace(btrim(coalesce(p_subject_level, '')), '[[:space:]_-]+', ' ', 'g'))
        IN ('SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY')
    ELSE false
  END
  FROM public.teachers t
  WHERE t.id = p_teacher_id AND t.status = 'active';
$fn$;

CREATE OR REPLACE FUNCTION public.rms_subject_matches_class(p_subject_id UUID, p_class_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(bool_or(CASE
    WHEN s.grades IS NOT NULL AND btrim(s.grades) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(string_to_array(s.grades, ',')) AS configured_grade(value)
        WHERE upper(regexp_replace(btrim(configured_grade.value), '[[:space:]_-]+', '', 'g'))
          = class_info.class_grade
      ) THEN false
    WHEN subject_info.subject_level IN ('', 'BOTH', 'ALL') THEN true
    WHEN subject_info.subject_level = 'LOWER PRIMARY'
      THEN class_info.class_grade IN ('P1', 'P2', 'P3')
        OR (class_info.class_grade IS NULL AND class_info.class_text LIKE '%LOWER PRIMARY%')
    WHEN subject_info.subject_level = 'PRIMARY'
      THEN class_info.class_text LIKE '%PRIMARY%'
        OR class_info.class_grade IN ('P1', 'P2', 'P3', 'P4', 'P5', 'P6')
    WHEN subject_info.subject_level = 'SECONDARY'
      THEN class_info.class_text LIKE '%SECONDARY%'
        OR class_info.class_grade IN ('S1', 'S2', 'S3', 'S4', 'S5', 'S6')
    WHEN subject_info.subject_level = 'LOWER SECONDARY'
      THEN class_info.class_text LIKE '%LOWER SECONDARY%'
        OR class_info.class_grade IN ('S1', 'S2', 'S3')
    WHEN subject_info.subject_level = 'UPPER SECONDARY'
      THEN class_info.class_text LIKE '%UPPER SECONDARY%'
        OR class_info.class_grade IN ('S4', 'S5', 'S6')
    ELSE subject_info.subject_level = class_info.class_level
  END), false)
  FROM public.classes c
  JOIN public.subjects s ON s.id = p_subject_id
  CROSS JOIN LATERAL (
    SELECT upper(regexp_replace(
        coalesce(c.education_level, '') || ' ' || coalesce(c.level, '') || ' ' || coalesce(c.name, ''),
        '[[:space:]_-]+', ' ', 'g')) AS class_text,
      upper(regexp_replace(coalesce(c.education_level, ''), '[[:space:]_-]+', ' ', 'g')) AS class_level,
      (regexp_match(
        upper(regexp_replace(coalesce(c.level, '') || ' ' || coalesce(c.name, ''),
          '[[:space:]_-]+', ' ', 'g')),
        '(^|[^A-Z0-9])(P[1-6]|S[1-6])([A-Z]|[^A-Z0-9]|$)'
      ))[2] AS class_grade
  ) AS class_info
  CROSS JOIN LATERAL (
    SELECT coalesce(
      nullif(upper(regexp_replace(btrim(s.level), '[[:space:]_-]+', ' ', 'g')), 'BOTH'),
      nullif(upper(regexp_replace(btrim(s.education_level), '[[:space:]_-]+', ' ', 'g')), 'BOTH'),
      'BOTH'
    ) AS subject_level
  ) AS subject_info
  WHERE c.id = p_class_id;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_enforce_subject_class_level()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.class_id IS NOT NULL AND NEW.subject_id IS NOT NULL
    AND NOT public.rms_subject_matches_class(NEW.subject_id, NEW.class_id) THEN
    RAISE EXCEPTION 'Subject is not available for the selected class education level'
      USING ERRCODE = 'check_violation';
  END IF;
  IF TG_TABLE_NAME = 'teacher_assignments'
    AND NEW.class_id IS NOT NULL AND NEW.subject_id IS NOT NULL THEN
    -- Serialize writes for this class/subject/year before checking for conflicts.
    PERFORM pg_advisory_xact_lock(hashtextextended(
      NEW.class_id::TEXT || '|' || NEW.subject_id::TEXT || '|' || coalesce(NEW.academic_year_id::TEXT, '<NULL>'),
      0
    ));
    IF EXISTS (
      SELECT 1
      FROM public.teacher_assignments existing
      WHERE existing.class_id = NEW.class_id
        AND existing.subject_id = NEW.subject_id
        AND existing.academic_year_id IS NOT DISTINCT FROM NEW.academic_year_id
        AND (TG_OP <> 'UPDATE' OR existing.id IS DISTINCT FROM NEW.id)
    ) THEN
      RAISE EXCEPTION 'This class and subject already have an assignment for the selected academic year.'
        USING ERRCODE = 'unique_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS rms_class_subject_level_guard ON public.class_subjects;
CREATE TRIGGER rms_class_subject_level_guard
  BEFORE INSERT OR UPDATE OF class_id, subject_id ON public.class_subjects
  FOR EACH ROW EXECUTE FUNCTION public.rms_enforce_subject_class_level();
DROP TRIGGER IF EXISTS rms_teacher_assignment_level_guard ON public.teacher_assignments;
CREATE TRIGGER rms_teacher_assignment_level_guard
  BEFORE INSERT OR UPDATE OF class_id, subject_id, academic_year_id ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.rms_enforce_subject_class_level();
DROP TRIGGER IF EXISTS rms_assessment_subject_level_guard ON public.assessments;
CREATE TRIGGER rms_assessment_subject_level_guard
  BEFORE INSERT OR UPDATE OF class_id, subject_id ON public.assessments
  FOR EACH ROW EXECUTE FUNCTION public.rms_enforce_subject_class_level();

REVOKE ALL ON FUNCTION public.rms_dos_can_level(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_dos_can_subject(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_teacher_level_allows(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_teacher_subject_level_allows(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_subject_matches_class(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_level(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_dos_can_subject(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_teacher_level_allows(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_teacher_subject_level_allows(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_subject_matches_class(UUID, UUID) TO authenticated;

COMMIT;
