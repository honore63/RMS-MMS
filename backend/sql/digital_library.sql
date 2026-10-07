-- Digital Library and resource management upgrade.
-- Run in the Supabase SQL Editor after database.sql.

CREATE TABLE IF NOT EXISTS public.digital_library_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 180),
  description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  resource_type text NOT NULL DEFAULT 'resource',
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id uuid REFERENCES public.subjects(id) ON DELETE SET NULL,
  class_name text NOT NULL DEFAULT '',
  subject_name text NOT NULL DEFAULT '',
  academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  term_id uuid REFERENCES public.terms(id) ON DELETE SET NULL,
  assessment_type_id uuid REFERENCES public.assessment_types(id) ON DELETE SET NULL,
  academic_year_name text NOT NULL DEFAULT '',
  term_name text NOT NULL DEFAULT '',
  assessment_type_name text NOT NULL DEFAULT '',
  unit text,
  topic text,
  education_level text,
  file_name text NOT NULL,
  storage_path text UNIQUE,
  resource_url text,
  mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size > 0 AND file_size <= 26214400),
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  teacher_id uuid NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  upload_group_id uuid,
  uploader_name text NOT NULL DEFAULT '',
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')
      || ' ' || coalesce(topic, '') || ' ' || coalesce(unit, '')
      || ' ' || coalesce(class_name, '') || ' ' || coalesce(subject_name, '')
      || ' ' || coalesce(uploader_name, ''))
  ) STORED,
  status text NOT NULL DEFAULT 'published',
  visibility text NOT NULL DEFAULT 'public',
  return_comment text,
  view_count bigint NOT NULL DEFAULT 0 CHECK (view_count >= 0),
  download_count bigint NOT NULL DEFAULT 0 CHECK (download_count >= 0),
  is_published boolean NOT NULL DEFAULT true,
  ai_enabled boolean NOT NULL DEFAULT true,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT digital_library_resource_source_check CHECK (
    (resource_url IS NULL AND storage_path IS NOT NULL)
    OR (resource_url IS NOT NULL AND storage_path IS NULL)
  ),
  CONSTRAINT digital_library_resource_url_check CHECK (
    resource_url IS NULL
    OR (char_length(resource_url) <= 2048
      AND resource_url ~* '^https://'
      AND resource_url !~ '^https://[^/]*@')
  )
);

ALTER TABLE public.digital_library_resources
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS term_id uuid REFERENCES public.terms(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assessment_type_id uuid REFERENCES public.assessment_types(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS academic_year_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS term_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS assessment_type_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS upload_group_id uuid,
  ADD COLUMN IF NOT EXISTS unit text,
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS education_level text,
  ADD COLUMN IF NOT EXISTS uploader_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(description, '')
      || ' ' || coalesce(topic, '') || ' ' || coalesce(unit, '')
      || ' ' || coalesce(class_name, '') || ' ' || coalesce(subject_name, '')
      || ' ' || coalesce(uploader_name, ''))
  ) STORED,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS visibility text,
  ADD COLUMN IF NOT EXISTS return_comment text,
  ADD COLUMN IF NOT EXISTS view_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS download_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS resource_url text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.digital_library_resources
  ALTER COLUMN storage_path DROP NOT NULL;
ALTER TABLE public.digital_library_resources
  DROP CONSTRAINT IF EXISTS digital_library_resource_source_check,
  ADD CONSTRAINT digital_library_resource_source_check CHECK (
    (resource_url IS NULL AND storage_path IS NOT NULL)
    OR (resource_url IS NOT NULL AND storage_path IS NULL)
  ),
  DROP CONSTRAINT IF EXISTS digital_library_resource_url_check,
  ADD CONSTRAINT digital_library_resource_url_check CHECK (
    resource_url IS NULL
    OR (char_length(resource_url) <= 2048
      AND resource_url ~* '^https://'
      AND resource_url !~ '^https://[^/]*@')
  );

-- Backfills below are administrative migration work, not user edits. Remove
-- existing resource triggers first so an older authorization trigger cannot
-- reject the migration while it normalizes existing rows.
DROP TRIGGER IF EXISTS rms_library_resource_before_write ON public.digital_library_resources;
DROP TRIGGER IF EXISTS rms_library_resource_audit ON public.digital_library_resources;

WITH duplicate_uploads AS (
  SELECT
    array_agg(id) AS resource_ids,
    gen_random_uuid() AS group_id
  FROM public.digital_library_resources
  WHERE upload_group_id IS NULL
  GROUP BY uploaded_by, teacher_id, title, description, resource_type,
    subject_id, academic_year_id, term_id, assessment_type_id, unit, topic,
    file_name, mime_type, file_size, created_at
  HAVING count(*) > 1 AND count(DISTINCT class_id) > 1
),
grouped_resources AS (
  SELECT unnest(resource_ids) AS resource_id, group_id
  FROM duplicate_uploads
)
UPDATE public.digital_library_resources AS resource
SET upload_group_id = grouped.group_id
FROM grouped_resources AS grouped
WHERE resource.id = grouped.resource_id
  AND resource.upload_group_id IS NULL;

ALTER TABLE public.digital_library_resources
  ALTER COLUMN status SET DEFAULT 'published',
  ALTER COLUMN visibility SET DEFAULT 'public';

UPDATE public.digital_library_resources
SET status = CASE WHEN is_published THEN 'published' ELSE 'draft' END
WHERE status IS NULL;

UPDATE public.digital_library_resources
SET visibility = CASE WHEN is_published THEN 'public' ELSE 'private' END
WHERE visibility IS NULL;

UPDATE public.digital_library_resources AS resource
SET class_name = (SELECT class.name FROM public.classes AS class WHERE class.id = resource.class_id),
    subject_name = coalesce((SELECT subject.name FROM public.subjects AS subject WHERE subject.id = resource.subject_id), ''),
    education_level = (SELECT coalesce(class.education_level, class.level)
      FROM public.classes AS class WHERE class.id = resource.class_id),
    academic_year_name = coalesce((SELECT year.name FROM public.academic_years AS year WHERE year.id = resource.academic_year_id), ''),
    term_name = coalesce((SELECT term.name FROM public.terms AS term WHERE term.id = resource.term_id), ''),
    assessment_type_name = coalesce((SELECT assessment_type.name FROM public.assessment_types AS assessment_type WHERE assessment_type.id = resource.assessment_type_id), ''),
    uploader_name = coalesce((SELECT teacher.full_name FROM public.teachers AS teacher WHERE teacher.id = resource.teacher_id), ''),
    published_at = CASE
      WHEN resource.is_published THEN coalesce(resource.published_at, resource.created_at, now())
      ELSE resource.published_at
    END
WHERE EXISTS (SELECT 1 FROM public.classes AS class WHERE class.id = resource.class_id);

ALTER TABLE public.digital_library_resources
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN visibility SET NOT NULL;

ALTER TABLE public.digital_library_resources
  DROP CONSTRAINT IF EXISTS digital_library_resources_resource_type_check,
  DROP CONSTRAINT IF EXISTS digital_library_resources_status_check,
  DROP CONSTRAINT IF EXISTS digital_library_resources_visibility_check;

ALTER TABLE public.digital_library_resources
  ADD CONSTRAINT digital_library_resources_resource_type_check CHECK (
    resource_type IN (
      'lesson_plan', 'notes', 'presentation', 'teaching_material',
      'scheme_of_work', 'revision', 'assessment', 'past_paper',
      'class_test', 'mock_exam', 'marking_guide', 'answer_key',
      'video', 'audio', 'image', 'document', 'resource'
    )
  ),
  ADD CONSTRAINT digital_library_resources_status_check CHECK (
    status IN ('draft', 'submitted', 'approved', 'returned', 'published', 'archived')
  ),
  ADD CONSTRAINT digital_library_resources_visibility_check CHECK (
    visibility IN ('public', 'private')
  );

CREATE INDEX IF NOT EXISTS digital_library_resources_public_order
  ON public.digital_library_resources(status, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS digital_library_resources_class_subject
  ON public.digital_library_resources(class_id, subject_id, resource_type);
CREATE INDEX IF NOT EXISTS digital_library_resources_teacher_order
  ON public.digital_library_resources(uploaded_by, created_at DESC);
CREATE INDEX IF NOT EXISTS digital_library_resources_period
  ON public.digital_library_resources(academic_year_id, term_id, assessment_type_id);
CREATE INDEX IF NOT EXISTS digital_library_resources_search
  ON public.digital_library_resources USING gin (search_vector);

CREATE TABLE IF NOT EXISTS public.digital_library_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  require_review boolean NOT NULL DEFAULT false,
  ai_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.digital_library_settings
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
INSERT INTO public.digital_library_settings (id, require_review)
VALUES (true, false)
ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.digital_library_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digital_library_settings FROM PUBLIC, anon;
GRANT SELECT, UPDATE ON public.digital_library_settings TO authenticated;
DROP POLICY IF EXISTS digital_library_settings_dos_manage ON public.digital_library_settings;
CREATE POLICY digital_library_settings_dos_manage
  ON public.digital_library_settings FOR ALL TO authenticated
  USING (public.rms_account_role() = 'dos')
  WITH CHECK (public.rms_account_role() = 'dos');
DROP POLICY IF EXISTS digital_library_settings_authenticated_read ON public.digital_library_settings;
CREATE POLICY digital_library_settings_authenticated_read
  ON public.digital_library_settings FOR SELECT TO authenticated
  USING (true);
DROP POLICY IF EXISTS digital_library_settings_anon_ai_read ON public.digital_library_settings;
CREATE POLICY digital_library_settings_anon_ai_read
  ON public.digital_library_settings FOR SELECT TO anon
  USING (true);
GRANT SELECT (ai_enabled) ON public.digital_library_settings TO anon;

CREATE TABLE IF NOT EXISTS public.digital_library_ai_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_ids uuid[] NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requester_hash text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.digital_library_ai_usage
  ADD COLUMN IF NOT EXISTS requester_hash text NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS digital_library_ai_usage_created_at
  ON public.digital_library_ai_usage(created_at DESC);
CREATE INDEX IF NOT EXISTS digital_library_ai_usage_requester_created_at
  ON public.digital_library_ai_usage(requester_hash, created_at DESC);
ALTER TABLE public.digital_library_ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digital_library_ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.digital_library_ai_usage TO service_role;

CREATE OR REPLACE FUNCTION public.rms_library_ai_log_attempt(
  p_resource_ids uuid[],
  p_user_id uuid,
  p_requester_hash text
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  hourly_count integer;
  daily_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF coalesce(array_length(p_resource_ids, 1), 0) NOT BETWEEN 1 AND 3
     OR p_requester_hash IS NULL
     OR p_requester_hash !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid AI request usage data';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_requester_hash, 0));
  SELECT count(*) FILTER (WHERE created_at >= now() - interval '1 hour'),
         count(*) FILTER (WHERE created_at >= now() - interval '1 day')
    INTO hourly_count, daily_count
  FROM public.digital_library_ai_usage
  WHERE requester_hash = p_requester_hash
    AND created_at >= now() - interval '1 day';
  IF hourly_count >= 30 OR daily_count >= 300 THEN
    RETURN false;
  END IF;

  INSERT INTO public.digital_library_ai_usage (resource_ids, user_id, requester_hash)
  VALUES (p_resource_ids, p_user_id, p_requester_hash);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_ai_log_attempt(uuid[], uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_library_ai_log_attempt(uuid[], uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.rms_library_ai_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF public.rms_account_role() <> 'dos' THEN
    RAISE EXCEPTION 'DOS access required';
  END IF;
  SELECT jsonb_build_object(
    'questions_today', count(*) FILTER (WHERE usage.created_at >= date_trunc('day', now())),
    'questions_this_month', count(*) FILTER (WHERE usage.created_at >= date_trunc('month', now())),
    'most_asked_subject', (
      SELECT subject_name FROM public.digital_library_ai_usage AS usage
      CROSS JOIN LATERAL unnest(usage.resource_ids) AS selected(resource_id)
      JOIN public.digital_library_resources AS resource ON resource.id = selected.resource_id
      WHERE public.rms_library_dos_can_manage(resource.class_id)
        AND resource.subject_name <> ''
      GROUP BY subject_name ORDER BY count(*) DESC LIMIT 1
    ),
    'most_asked_class', (
      SELECT class_name FROM public.digital_library_ai_usage AS usage
      CROSS JOIN LATERAL unnest(usage.resource_ids) AS selected(resource_id)
      JOIN public.digital_library_resources AS resource ON resource.id = selected.resource_id
      WHERE public.rms_library_dos_can_manage(resource.class_id)
      GROUP BY class_name ORDER BY count(*) DESC LIMIT 1
    ),
    'most_used_resource', (
      SELECT title FROM public.digital_library_ai_usage AS usage
      CROSS JOIN LATERAL unnest(usage.resource_ids) AS selected(resource_id)
      JOIN public.digital_library_resources AS resource ON resource.id = selected.resource_id
      WHERE public.rms_library_dos_can_manage(resource.class_id)
      GROUP BY title ORDER BY count(*) DESC LIMIT 1
    )
  ) INTO result
  FROM public.digital_library_ai_usage AS usage
  WHERE EXISTS (
    SELECT 1
    FROM unnest(usage.resource_ids) AS selected(resource_id)
    JOIN public.digital_library_resources AS resource ON resource.id = selected.resource_id
    WHERE public.rms_library_dos_can_manage(resource.class_id)
  );
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_ai_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rms_library_ai_stats() TO authenticated;

ALTER TABLE public.digital_library_resources ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.rms_library_teacher_can_manage(
  p_teacher_id uuid,
  p_class_id uuid,
  p_subject_id uuid
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.teachers AS teacher
    JOIN public.users AS account ON account.id = teacher.user_id
    JOIN public.classes AS cls ON cls.id = p_class_id
    WHERE teacher.id = p_teacher_id
      AND teacher.user_id = auth.uid()
      AND teacher.status = 'active'
      AND account.role = 'teacher'
      AND account.status = 'active'
      AND (
        cls.class_teacher_id = teacher.id
        OR EXISTS (
          SELECT 1
          FROM public.teacher_assignments AS assignment
          WHERE assignment.teacher_id = teacher.id
            AND (assignment.class_id IS NULL OR assignment.class_id = cls.id)
            AND (
              assignment.subject_id IS NULL
              OR (p_subject_id IS NOT NULL AND assignment.subject_id = p_subject_id)
            )
        )
      )
      AND (p_subject_id IS NULL OR public.rms_subject_matches_class(p_subject_id, cls.id))
  );
$function$;

CREATE OR REPLACE FUNCTION public.rms_library_dos_can_manage(p_class_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT public.rms_account_role() = 'dos'
    AND EXISTS (
      SELECT 1
      FROM public.classes AS cls
      WHERE cls.id = p_class_id
        AND public.rms_dos_can_level(coalesce(cls.education_level, cls.level))
    );
$function$;

CREATE OR REPLACE FUNCTION public.rms_library_teacher_can_manage_path(p_path text)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  path_parts text[];
  parsed_class_id uuid;
  parsed_user_id uuid;
  class_level text;
BEGIN
  path_parts := string_to_array(p_path, '/');
  IF array_length(path_parts, 1) < 5
     OR path_parts[2] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR path_parts[3] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR path_parts[4] !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN false;
  END IF;
  parsed_class_id := path_parts[2]::uuid;
  parsed_user_id := path_parts[3]::uuid;

  SELECT CASE
    WHEN upper(coalesce(cls.education_level, '') || ' ' || coalesce(cls.level, '') || ' ' || cls.name) LIKE '%PRIMARY%'
      OR upper(coalesce(cls.level, '') || ' ' || cls.name) ~ '(^|[^A-Z0-9])P[1-6]'
      THEN 'primary'
    ELSE 'secondary'
  END
  INTO class_level
  FROM public.classes AS cls
  WHERE cls.id = parsed_class_id;
  IF class_level IS NULL OR path_parts[1] <> class_level
     OR parsed_user_id <> auth.uid() THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.teachers AS teacher
    JOIN public.users AS account ON account.id = teacher.user_id
    JOIN public.classes AS cls ON cls.id = parsed_class_id
    WHERE teacher.user_id = parsed_user_id
      AND teacher.status = 'active'
      AND account.role = 'teacher'
      AND account.status = 'active'
      AND (
        cls.class_teacher_id = teacher.id
        OR EXISTS (
          SELECT 1 FROM public.teacher_assignments AS assignment
          WHERE assignment.teacher_id = teacher.id
            AND (assignment.class_id IS NULL OR assignment.class_id = cls.id)
        )
      )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rms_library_teacher_can_manage(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rms_library_dos_can_manage(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rms_library_teacher_can_manage_path(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rms_library_teacher_can_manage(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_library_dos_can_manage(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_library_teacher_can_manage_path(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_library_resource_before_write()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  class_row public.classes%ROWTYPE;
  subject_label text;
  teacher_label text;
  year_label text;
  term_label text;
  assessment_type_label text;
  expected_level text;
BEGIN
  IF TG_OP = 'UPDATE'
     AND current_setting('rms.library.track_event', true) = 'true'
     AND NEW.view_count >= OLD.view_count
     AND NEW.download_count >= OLD.download_count
     AND (to_jsonb(NEW) - ARRAY['view_count', 'download_count', 'updated_at'])
         = (to_jsonb(OLD) - ARRAY['view_count', 'download_count', 'updated_at']) THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;
  SELECT * INTO class_row FROM public.classes WHERE id = NEW.class_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Select a valid class for this resource';
  END IF;
  expected_level := CASE
    WHEN upper(coalesce(class_row.education_level, '') || ' ' || coalesce(class_row.level, '') || ' ' || class_row.name) LIKE '%PRIMARY%'
      OR upper(coalesce(class_row.level, '') || ' ' || class_row.name) ~ '(^|[^A-Z0-9])P[1-6]'
      THEN 'primary'
    ELSE 'secondary'
  END;
  IF NEW.subject_id IS NOT NULL
     AND NOT public.rms_subject_matches_class(NEW.subject_id, NEW.class_id) THEN
    RAISE EXCEPTION 'The selected subject is not available for this class';
  END IF;
  SELECT name INTO subject_label FROM public.subjects WHERE id = NEW.subject_id;
  SELECT full_name INTO teacher_label FROM public.teachers WHERE id = NEW.teacher_id;
  SELECT name INTO year_label FROM public.academic_years WHERE id = NEW.academic_year_id;
  SELECT name INTO term_label FROM public.terms WHERE id = NEW.term_id;
  SELECT name INTO assessment_type_label FROM public.assessment_types WHERE id = NEW.assessment_type_id;
  NEW.class_name := class_row.name;
  NEW.subject_name := coalesce(subject_label, '');
  NEW.academic_year_name := coalesce(year_label, '');
  NEW.term_name := coalesce(term_label, '');
  NEW.assessment_type_name := coalesce(assessment_type_label, '');
  NEW.education_level := coalesce(class_row.education_level, class_row.level);
  NEW.uploader_name := coalesce(teacher_label, '');
  NEW.updated_at := now();

  IF TG_OP = 'INSERT' THEN
    IF public.rms_account_role() = 'teacher' THEN
      IF NEW.uploaded_by <> auth.uid()
         OR NOT public.rms_library_teacher_can_manage(NEW.teacher_id, NEW.class_id, NEW.subject_id)
         OR (NEW.resource_url IS NULL AND (
           split_part(NEW.storage_path, '/', 2) <> NEW.class_id::text
           OR split_part(NEW.storage_path, '/', 3) <> auth.uid()::text
           OR split_part(NEW.storage_path, '/', 4) <> NEW.id::text
           OR split_part(NEW.storage_path, '/', 1) <> expected_level
         ))
         OR (NEW.resource_url IS NOT NULL AND NEW.storage_path IS NOT NULL) THEN
        RAISE EXCEPTION 'You can only upload for your assigned classes and subjects';
      END IF;
      NEW.status := 'published';
      NEW.visibility := 'public';
      NEW.is_published := true;
      NEW.published_at := now();
      NEW.return_comment := NULL;
    ELSIF public.rms_account_role() = 'dos'
      AND public.rms_library_dos_can_manage(NEW.class_id) THEN
      NEW.status := 'published';
      NEW.visibility := 'public';
      NEW.is_published := true;
      NEW.published_at := now();
    ELSE
      RAISE EXCEPTION 'Only an assigned teacher or authorized DOS can add resources';
    END IF;
    NEW.view_count := 0;
    NEW.download_count := 0;
    RETURN NEW;
  END IF;

  IF public.rms_account_role() = 'teacher'
     AND OLD.uploaded_by = auth.uid() THEN
    IF NEW.uploaded_by <> OLD.uploaded_by OR NEW.teacher_id <> OLD.teacher_id
       OR NEW.class_id <> OLD.class_id
     OR NOT public.rms_library_teacher_can_manage(NEW.teacher_id, NEW.class_id, NEW.subject_id)
     OR NEW.ai_enabled IS DISTINCT FROM OLD.ai_enabled
     OR (NEW.storage_path IS DISTINCT FROM OLD.storage_path
       AND (split_part(NEW.storage_path, '/', 2) <> NEW.class_id::text
         OR split_part(NEW.storage_path, '/', 3) <> auth.uid()::text
         OR split_part(NEW.storage_path, '/', 4) <> NEW.id::text
         OR split_part(NEW.storage_path, '/', 1) <> expected_level)) THEN
      RAISE EXCEPTION 'Resource ownership and class cannot be changed';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.visibility IS DISTINCT FROM OLD.visibility
       OR NEW.is_published IS DISTINCT FROM OLD.is_published
       OR NEW.published_at IS DISTINCT FROM OLD.published_at
       OR NEW.view_count IS DISTINCT FROM OLD.view_count
       OR NEW.download_count IS DISTINCT FROM OLD.download_count THEN
      IF NOT (OLD.status = 'returned' AND NEW.status = OLD.status
          AND NEW.visibility = OLD.visibility AND NEW.is_published = OLD.is_published
          AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
          AND NEW.view_count = OLD.view_count AND NEW.download_count = OLD.download_count) THEN
        RAISE EXCEPTION 'Teachers cannot change publication status or library statistics';
      END IF;
    END IF;
    IF OLD.status = 'returned' AND NEW.status = OLD.status THEN
      NEW.status := 'published';
      NEW.visibility := 'public';
      NEW.is_published := true;
      NEW.published_at := now();
      NEW.return_comment := NULL;
    END IF;
    RETURN NEW;
  END IF;

  IF public.rms_account_role() = 'dos'
     AND public.rms_library_dos_can_manage(OLD.class_id) THEN
    IF NEW.class_id <> OLD.class_id OR NEW.uploaded_by <> OLD.uploaded_by
       OR NEW.teacher_id <> OLD.teacher_id THEN
      RAISE EXCEPTION 'DOS cannot change resource ownership or class';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      IF NEW.status NOT IN ('approved', 'returned', 'published', 'archived') THEN
        RAISE EXCEPTION 'Invalid DOS resource status transition';
      END IF;
      IF NEW.status = 'returned' AND nullif(btrim(NEW.return_comment), '') IS NULL THEN
        RAISE EXCEPTION 'Provide a return comment so the teacher knows what to correct';
      END IF;
      IF NEW.status IN ('approved', 'published') THEN
        NEW.visibility := 'public';
        NEW.is_published := true;
        NEW.published_at := coalesce(OLD.published_at, now());
        NEW.return_comment := NULL;
      ELSIF NEW.status IN ('returned', 'archived') THEN
        NEW.visibility := CASE WHEN NEW.status = 'archived' THEN OLD.visibility ELSE 'private' END;
        NEW.is_published := NEW.visibility = 'public';
        IF NOT NEW.is_published THEN NEW.published_at := NULL; END IF;
      END IF;
    ELSIF NEW.visibility IS DISTINCT FROM OLD.visibility
       OR NEW.is_published IS DISTINCT FROM OLD.is_published
       OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
      RAISE EXCEPTION 'Use a publication status action to change public visibility';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'You are not authorized to manage this resource';
END;
$function$;

DROP TRIGGER IF EXISTS rms_library_resource_before_write ON public.digital_library_resources;
CREATE TRIGGER rms_library_resource_before_write
  BEFORE INSERT OR UPDATE ON public.digital_library_resources
  FOR EACH ROW EXECUTE FUNCTION public.rms_library_resource_before_write();

CREATE OR REPLACE FUNCTION public.rms_library_resource_audit()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  actor_name text;
  actor_role text;
  event_name text;
BEGIN
  IF current_setting('rms.library.track_event', true) = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  SELECT full_name, role INTO actor_name, actor_role
  FROM public.users WHERE id = auth.uid();
  IF TG_OP = 'INSERT' THEN
    event_name := 'DIGITAL_LIBRARY_RESOURCE_UPLOADED';
    INSERT INTO public.audit_logs(user_id, user_name, role, action, old_value, new_value, timestamp)
    VALUES (auth.uid(), actor_name, actor_role, event_name, NULL,
      jsonb_build_object('resource_id', NEW.id, 'title', NEW.title, 'status', NEW.status)::text, now());
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    event_name := 'DIGITAL_LIBRARY_RESOURCE_DELETED';
    INSERT INTO public.audit_logs(user_id, user_name, role, action, old_value, new_value, timestamp)
    VALUES (auth.uid(), actor_name, actor_role, event_name,
      jsonb_build_object('resource_id', OLD.id, 'title', OLD.title, 'status', OLD.status)::text, NULL, now());
    RETURN OLD;
  END IF;
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path THEN
    event_name := 'DIGITAL_LIBRARY_FILE_REPLACED';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    event_name := 'DIGITAL_LIBRARY_STATUS_' || upper(NEW.status);
  ELSE
    event_name := 'DIGITAL_LIBRARY_RESOURCE_UPDATED';
  END IF;
  INSERT INTO public.audit_logs(user_id, user_name, role, action, old_value, new_value, timestamp)
  VALUES (auth.uid(), actor_name, actor_role, event_name,
    jsonb_build_object('resource_id', OLD.id, 'title', OLD.title, 'status', OLD.status)::text,
    jsonb_build_object('resource_id', NEW.id, 'title', NEW.title, 'status', NEW.status,
      'return_comment', NEW.return_comment)::text, now());
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS rms_library_resource_audit ON public.digital_library_resources;
CREATE TRIGGER rms_library_resource_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.digital_library_resources
  FOR EACH ROW EXECUTE FUNCTION public.rms_library_resource_audit();

DROP POLICY IF EXISTS digital_library_public_read ON public.digital_library_resources;
CREATE POLICY digital_library_public_read
  ON public.digital_library_resources FOR SELECT TO anon, authenticated
  USING (status = 'published' AND visibility = 'public' AND is_published);
DROP POLICY IF EXISTS digital_library_teacher_read_own ON public.digital_library_resources;
CREATE POLICY digital_library_teacher_read_own
  ON public.digital_library_resources FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid() AND public.rms_account_role() = 'teacher');
DROP POLICY IF EXISTS digital_library_dos_read_scope ON public.digital_library_resources;
CREATE POLICY digital_library_dos_read_scope
  ON public.digital_library_resources FOR SELECT TO authenticated
  USING (public.rms_library_dos_can_manage(class_id));

DROP POLICY IF EXISTS digital_library_teacher_insert ON public.digital_library_resources;
CREATE POLICY digital_library_teacher_insert
  ON public.digital_library_resources FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.rms_account_role() = 'teacher'
    AND public.rms_library_teacher_can_manage(teacher_id, class_id, subject_id)
    AND (resource_url IS NOT NULL OR split_part(storage_path, '/', 3) = auth.uid()::text)
  );
DROP POLICY IF EXISTS digital_library_teacher_update ON public.digital_library_resources;
CREATE POLICY digital_library_teacher_update
  ON public.digital_library_resources FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() AND public.rms_account_role() = 'teacher')
  WITH CHECK (
    uploaded_by = auth.uid()
    AND public.rms_library_teacher_can_manage(teacher_id, class_id, subject_id)
  );
DROP POLICY IF EXISTS digital_library_teacher_delete ON public.digital_library_resources;
CREATE POLICY digital_library_teacher_delete
  ON public.digital_library_resources FOR DELETE TO authenticated
  USING (uploaded_by = auth.uid() AND public.rms_account_role() = 'teacher');
DROP POLICY IF EXISTS digital_library_dos_update_scope ON public.digital_library_resources;
CREATE POLICY digital_library_dos_update_scope
  ON public.digital_library_resources FOR UPDATE TO authenticated
  USING (public.rms_library_dos_can_manage(class_id))
  WITH CHECK (public.rms_library_dos_can_manage(class_id));
DROP POLICY IF EXISTS digital_library_dos_delete_scope ON public.digital_library_resources;
CREATE POLICY digital_library_dos_delete_scope
  ON public.digital_library_resources FOR DELETE TO authenticated
  USING (public.rms_library_dos_can_manage(class_id));

REVOKE ALL ON public.digital_library_resources FROM PUBLIC, anon, authenticated;
GRANT SELECT (
  id, title, description, resource_type, class_id, subject_id,
  class_name, subject_name, academic_year_id, term_id, assessment_type_id,
  academic_year_name, term_name, assessment_type_name,
  unit, topic, education_level, file_name, storage_path, resource_url, mime_type,
  file_size, uploader_name, status, visibility, view_count, download_count,
  is_published, ai_enabled, published_at, created_at, updated_at, search_vector,
  upload_group_id
) ON public.digital_library_resources TO anon;
GRANT SELECT ON public.digital_library_resources TO authenticated;
GRANT INSERT (
  id, title, description, resource_type, class_id, subject_id,
  academic_year_id, term_id, assessment_type_id, academic_year_name,
  term_name, assessment_type_name, unit, topic, upload_group_id,
  file_name, storage_path, resource_url, mime_type, file_size, uploaded_by, teacher_id
) ON public.digital_library_resources TO authenticated;
GRANT UPDATE (
  title, description, resource_type, subject_id, academic_year_id,
  term_id, assessment_type_id, unit, topic, file_name, storage_path, resource_url,
  mime_type, file_size, status, visibility, is_published, published_at,
  return_comment, ai_enabled
) ON public.digital_library_resources TO authenticated;
GRANT DELETE ON public.digital_library_resources TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'digital-library',
  'digital-library',
  false,
  26214400,
  ARRAY[
    'application/pdf', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip', 'text/plain', 'image/jpeg', 'image/png', 'image/webp',
    'audio/mpeg', 'audio/wav', 'audio/x-wav', 'video/mp4', 'video/webm'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS digital_library_public_object_read ON storage.objects;
CREATE POLICY digital_library_public_object_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (
    bucket_id = 'digital-library'
    AND EXISTS (
      SELECT 1 FROM public.digital_library_resources AS resource
      WHERE resource.storage_path = name
        AND resource.status = 'published'
        AND resource.visibility = 'public'
        AND resource.is_published
    )
  );
DROP POLICY IF EXISTS digital_library_authorized_object_read ON storage.objects;
CREATE POLICY digital_library_authorized_object_read
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'digital-library'
    AND EXISTS (
      SELECT 1 FROM public.digital_library_resources AS resource
      WHERE resource.storage_path = name
        AND (
          (resource.uploaded_by = auth.uid() AND public.rms_account_role() = 'teacher')
          OR public.rms_library_dos_can_manage(resource.class_id)
        )
    )
  );
DROP POLICY IF EXISTS digital_library_teacher_object_insert ON storage.objects;
CREATE POLICY digital_library_teacher_object_insert
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'digital-library'
    AND public.rms_library_teacher_can_manage_path(name)
  );
DROP POLICY IF EXISTS digital_library_teacher_object_update ON storage.objects;
CREATE POLICY digital_library_teacher_object_update
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'digital-library' AND public.rms_library_teacher_can_manage_path(name))
  WITH CHECK (bucket_id = 'digital-library' AND public.rms_library_teacher_can_manage_path(name));
DROP POLICY IF EXISTS digital_library_teacher_object_delete ON storage.objects;
CREATE POLICY digital_library_teacher_object_delete
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'digital-library'
    AND (
      public.rms_library_teacher_can_manage_path(name)
      OR EXISTS (
        SELECT 1 FROM public.digital_library_resources AS resource
        WHERE resource.storage_path = name
          AND (
            public.rms_library_dos_can_manage(resource.class_id)
            OR resource.uploaded_by = auth.uid()
          )
      )
    )
  );

CREATE OR REPLACE FUNCTION public.rms_library_track_event(
  p_resource_id uuid,
  p_event text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF p_event NOT IN ('view', 'download') THEN
    RAISE EXCEPTION 'Unsupported resource event';
  END IF;
  PERFORM set_config('rms.library.track_event', 'true', true);
  UPDATE public.digital_library_resources
  SET view_count = view_count + CASE WHEN p_event = 'view' THEN 1 ELSE 0 END,
      download_count = download_count + CASE WHEN p_event = 'download' THEN 1 ELSE 0 END
  WHERE id = p_resource_id
    AND status = 'published'
    AND visibility = 'public'
    AND is_published;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Published resource not found';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_track_event(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rms_library_track_event(uuid, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.rms_library_dos_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  result jsonb;
BEGIN
  IF public.rms_account_role() <> 'dos' THEN
    RAISE EXCEPTION 'DOS access required';
  END IF;
  SELECT jsonb_build_object(
    'total_resources', count(*),
    'lesson_plans', count(*) FILTER (WHERE resource_type = 'lesson_plan'),
    'pending_reviews', count(*) FILTER (WHERE status = 'submitted'),
    'published_resources', count(*) FILTER (WHERE status = 'published'),
    'teachers_contributing', count(DISTINCT teacher_id),
    'total_downloads', coalesce(sum(download_count), 0),
    'total_views', coalesce(sum(view_count), 0),
    'top_downloaded', coalesce((
      SELECT jsonb_agg(to_jsonb(top_item))
      FROM (
        SELECT id, title, class_name, subject_name, download_count
        FROM public.digital_library_resources AS ranked
        WHERE public.rms_library_dos_can_manage(ranked.class_id)
        ORDER BY download_count DESC, created_at DESC
        LIMIT 5
      ) AS top_item
    ), '[]'::jsonb)
  ) INTO result
  FROM public.digital_library_resources AS resource
  WHERE public.rms_library_dos_can_manage(resource.class_id);
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_dos_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rms_library_dos_stats() TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_library_teacher_stats()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  current_teacher_id uuid;
  result jsonb;
BEGIN
  IF public.rms_account_role() <> 'teacher' THEN
    RAISE EXCEPTION 'Teacher access required';
  END IF;
  SELECT teacher.id INTO current_teacher_id
  FROM public.teachers AS teacher
  WHERE teacher.user_id = auth.uid()
    AND teacher.status = 'active';
  IF current_teacher_id IS NULL THEN
    RAISE EXCEPTION 'Active teacher profile not found';
  END IF;
  SELECT jsonb_build_object(
    'total_resources', count(*),
    'published_resources', count(*) FILTER (WHERE status = 'published'),
    'pending_reviews', count(*) FILTER (WHERE status = 'submitted'),
    'returned_resources', count(*) FILTER (WHERE status = 'returned'),
    'total_downloads', coalesce(sum(download_count), 0),
    'total_views', coalesce(sum(view_count), 0)
  ) INTO result
  FROM public.digital_library_resources AS resource
  WHERE resource.teacher_id = current_teacher_id;
  RETURN result;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_teacher_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rms_library_teacher_stats() TO authenticated;

COMMENT ON TABLE public.digital_library_resources IS
  'RMS educational resources with teacher assignment, DOS scope, publication, and audit controls.';
COMMENT ON COLUMN public.digital_library_settings.require_review IS
  'Retained for compatibility. Teacher uploads are published immediately regardless of this setting.';
COMMENT ON COLUMN public.digital_library_resources.ai_enabled IS
  'DOS-controlled flag indicating whether this resource may be used as AI context.';

-- RMS AI content index. Only the Edge Functions can access these chunks;
-- callers must pass the public-resource RLS check before using service RPCs.
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.digital_library_ai_chunks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id uuid NOT NULL REFERENCES public.digital_library_resources(id) ON DELETE CASCADE,
  source_fingerprint text NOT NULL,
  chunk_index integer NOT NULL CHECK (chunk_index >= 0),
  section text NOT NULL DEFAULT 'Resource content' CHECK (char_length(section) <= 160),
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 6000),
  embedding extensions.vector(768) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, source_fingerprint, chunk_index)
);
CREATE INDEX IF NOT EXISTS digital_library_ai_chunks_resource
  ON public.digital_library_ai_chunks(resource_id, source_fingerprint);
CREATE INDEX IF NOT EXISTS digital_library_ai_chunks_embedding
  ON public.digital_library_ai_chunks USING hnsw (embedding extensions.vector_cosine_ops);
ALTER TABLE public.digital_library_ai_chunks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.digital_library_ai_chunks FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rms_library_ai_clear_stale_chunks()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.status <> 'published'
     OR NEW.visibility <> 'public'
     OR NOT NEW.is_published
     OR NOT NEW.ai_enabled THEN
    DELETE FROM public.digital_library_ai_chunks WHERE resource_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_ai_clear_stale_chunks() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS rms_library_ai_clear_stale_chunks ON public.digital_library_resources;
CREATE TRIGGER rms_library_ai_clear_stale_chunks
  AFTER UPDATE OF storage_path, status, visibility, is_published, ai_enabled
  ON public.digital_library_resources
  FOR EACH ROW EXECUTE FUNCTION public.rms_library_ai_clear_stale_chunks();

CREATE OR REPLACE FUNCTION public.rms_library_ai_indexed_resources(
  p_resource_ids uuid[],
  p_fingerprints jsonb
) RETURNS SETOF uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF coalesce(array_length(p_resource_ids, 1), 0) NOT BETWEEN 1 AND 10
     OR jsonb_typeof(p_fingerprints) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'Invalid AI index lookup';
  END IF;
  RETURN QUERY
    SELECT DISTINCT resource.id
    FROM public.digital_library_resources AS resource
    JOIN public.digital_library_ai_chunks AS chunk ON chunk.resource_id = resource.id
    WHERE resource.id = ANY(p_resource_ids)
      AND resource.status = 'published'
      AND resource.visibility = 'public'
      AND resource.is_published
      AND resource.ai_enabled
      AND chunk.source_fingerprint = p_fingerprints ->> resource.id::text
      AND EXISTS (SELECT 1 FROM public.digital_library_settings WHERE id AND ai_enabled);
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_ai_indexed_resources(uuid[], jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_library_ai_indexed_resources(uuid[], jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rms_library_ai_replace_chunks(
  p_resource_id uuid,
  p_source_fingerprint text,
  p_chunks jsonb
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  inserted_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF p_resource_id IS NULL OR p_source_fingerprint IS NULL
     OR char_length(p_source_fingerprint) > 1024
     OR jsonb_typeof(p_chunks) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid AI index data';
  END IF;
  IF jsonb_array_length(p_chunks) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Invalid AI index data';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.digital_library_resources AS resource
    WHERE resource.id = p_resource_id
      AND resource.status = 'published'
      AND resource.visibility = 'public'
      AND resource.is_published
      AND resource.ai_enabled
      AND p_source_fingerprint = resource.storage_path || '|' ||
        resource.file_size::text || '|' || resource.mime_type
      AND EXISTS (SELECT 1 FROM public.digital_library_settings WHERE id AND ai_enabled)
  ) THEN
    RAISE EXCEPTION 'Resource is not currently authorized for RMS AI indexing';
  END IF;

  DELETE FROM public.digital_library_ai_chunks WHERE resource_id = p_resource_id;
  INSERT INTO public.digital_library_ai_chunks (
    resource_id, source_fingerprint, chunk_index, section, content, embedding
  )
  SELECT p_resource_id, p_source_fingerprint,
    (chunk ->> 'chunk_index')::integer,
    left(coalesce(nullif(chunk ->> 'section', ''), 'Resource content'), 160),
    chunk ->> 'content',
    (chunk -> 'embedding')::text::extensions.vector(768)
  FROM jsonb_array_elements(p_chunks) AS chunk
  WHERE jsonb_typeof(chunk) = 'object'
    AND (chunk ->> 'chunk_index')::integer >= 0
    AND char_length(chunk ->> 'content') BETWEEN 1 AND 6000
    AND CASE WHEN jsonb_typeof(chunk -> 'embedding') = 'array'
      THEN jsonb_array_length(chunk -> 'embedding') = 768
      ELSE false END;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count <> jsonb_array_length(p_chunks) THEN
    RAISE EXCEPTION 'Invalid RMS AI chunk data';
  END IF;
  RETURN inserted_count;
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_ai_replace_chunks(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_library_ai_replace_chunks(uuid, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rms_library_ai_match_chunks(
  p_resource_ids uuid[],
  p_embedding extensions.vector(768),
  p_limit integer DEFAULT 12
) RETURNS TABLE (
  resource_id uuid,
  title text,
  class_name text,
  subject_name text,
  section text,
  content text,
  similarity real
)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required';
  END IF;
  IF coalesce(array_length(p_resource_ids, 1), 0) NOT BETWEEN 1 AND 3
     OR p_embedding IS NULL THEN
    RAISE EXCEPTION 'Invalid RMS AI search request';
  END IF;
  RETURN QUERY
    SELECT resource.id, resource.title, resource.class_name, resource.subject_name,
      chunk.section, chunk.content, (1 - (chunk.embedding <=> p_embedding))::real
    FROM public.digital_library_ai_chunks AS chunk
    JOIN public.digital_library_resources AS resource ON resource.id = chunk.resource_id
    WHERE resource.id = ANY(p_resource_ids)
      AND resource.status = 'published'
      AND resource.visibility = 'public'
      AND resource.is_published
      AND resource.ai_enabled
      AND chunk.source_fingerprint = resource.storage_path || '|' ||
        resource.file_size::text || '|' || resource.mime_type
      AND EXISTS (SELECT 1 FROM public.digital_library_settings WHERE id AND ai_enabled)
      AND chunk.embedding <=> p_embedding <= 0.8
    ORDER BY chunk.embedding <=> p_embedding
    LIMIT least(greatest(coalesce(p_limit, 8), 1), 16);
END;
$function$;
REVOKE ALL ON FUNCTION public.rms_library_ai_match_chunks(uuid[], extensions.vector, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_library_ai_match_chunks(uuid[], extensions.vector, integer) TO service_role;
