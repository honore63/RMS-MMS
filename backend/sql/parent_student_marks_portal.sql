-- Public, single-learner results portal.
-- Run after backend/sql/database.sql. The functions are the only public
-- interface: this migration does not grant direct access to academic tables.

CREATE OR REPLACE FUNCTION public.student_marks_portal_options()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
  SELECT jsonb_build_object(
    'classes',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', c.id,
          'name', c.name,
          'stream', c.stream
        )
        ORDER BY c.name, c.stream NULLS FIRST
      )
      FROM public.classes AS c
      WHERE c.status = 'active'
    ), '[]'::jsonb),
    'years',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ay.id,
          'name', ay.name,
          'status', ay.status,
          'is_current', ay.is_current
        )
        ORDER BY ay.is_current DESC, ay.start_year DESC NULLS LAST, ay.name DESC
      )
      FROM public.academic_years AS ay
      WHERE ay.status <> 'inactive'
    ), '[]'::jsonb),
    'terms',
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', t.id,
          'name', t.name,
          'academic_year_id', t.academic_year_id,
          'term_no', t.term_no,
          'is_active', t.is_active
        )
        ORDER BY t.academic_year_id, t.term_no, t.name
      )
      FROM public.terms AS t
      JOIN public.academic_years AS ay ON ay.id = t.academic_year_id
      WHERE ay.status <> 'inactive'
    ), '[]'::jsonb)
  );
$function$;

CREATE OR REPLACE FUNCTION public.get_student_marks_portal(
  p_class_id uuid,
  p_learner_code text,
  p_academic_year_id uuid,
  p_term_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_class public.classes%ROWTYPE;
  v_learner public.learners%ROWTYPE;
  v_year public.academic_years%ROWTYPE;
  v_term public.terms%ROWTYPE;
  v_category text;
  v_pass_mark numeric;
  v_subjects jsonb;
  v_assessments jsonb;
  v_grading_scale jsonb;
  v_settings jsonb;
  v_summary jsonb;
  v_position jsonb;
  v_teacher_name text;
  v_total_subjects integer;
  v_subjects_with_marks integer;
  v_passed integer;
  v_failed integer;
  v_total_obtained numeric;
  v_total_maximum numeric;
  v_average numeric;
  v_assessment_count integer;
  v_pass_rate numeric;
  v_pass_status text;
BEGIN
  IF p_class_id IS NULL
     OR p_academic_year_id IS NULL
     OR NULLIF(btrim(p_learner_code), '') IS NULL
     OR length(btrim(p_learner_code)) > 80 THEN
    RETURN NULL;
  END IF;

  SELECT c.*
  INTO v_class
  FROM public.classes AS c
  WHERE c.id = p_class_id
    AND c.status = 'active';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT ay.*
  INTO v_year
  FROM public.academic_years AS ay
  WHERE ay.id = p_academic_year_id
    AND ay.status <> 'inactive';

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF p_term_id IS NOT NULL THEN
    SELECT t.*
    INTO v_term
    FROM public.terms AS t
    WHERE t.id = p_term_id
      AND t.academic_year_id = p_academic_year_id;

    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT l.*
  INTO v_learner
  FROM public.learners AS l
  WHERE l.class_id = p_class_id
    AND upper(btrim(l.learner_code)) = upper(btrim(p_learner_code))
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_category := CASE
    WHEN upper(coalesce(nullif(v_class.education_level, ''), v_class.level, v_class.name, ''))
         LIKE '%PRIMARY%'
      OR upper(coalesce(nullif(v_class.education_level, ''), v_class.level, v_class.name, '')) ~ '^P[1-6]'
      THEN 'Primary'
    ELSE 'Secondary'
  END;
  SELECT coalesce(ss.pass_mark, 50)
  INTO v_pass_mark
  FROM public.school_settings AS ss
  ORDER BY ss.created_at
  LIMIT 1;
  v_pass_mark := coalesce(v_pass_mark, 50);

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'minimum_percentage', gs.minimum_percentage,
        'maximum_percentage', gs.maximum_percentage,
        'grade', gs.grade,
        'descriptor', gs.descriptor,
        'remark', gs.remark,
        'comment', gs.comment,
        'is_pass', gs.is_pass,
        'display_order', gs.display_order
      )
      ORDER BY gs.display_order, gs.minimum_percentage DESC
    ),
    '[]'::jsonb
  )
  INTO v_grading_scale
  FROM public.grading_scales AS gs
  WHERE gs.is_active;

  SELECT jsonb_build_object(
    'school_name', ss.school_name,
    'school_code', ss.school_code,
    'school_address', ss.school_address,
    'school_phone', ss.school_phone,
    'school_email', ss.school_email,
    'school_website', ss.school_website,
    'school_motto', ss.school_motto,
    'logo_url', coalesce(ss.logo_url, ss.school_logo_url, ss.school_logo),
    'school_logo_url', coalesce(ss.school_logo_url, ss.logo_url, ss.school_logo),
    'ministry_logo_url', ss.ministry_logo_url,
    'country', ss.country,
    'ministry', ss.ministry,
    'province', ss.province,
    'district', ss.district,
    'sector', ss.sector,
    'pass_mark', coalesce(ss.pass_mark, 50),
    'ranking_enabled', coalesce(ss.ranking_enabled, TRUE)
  )
  INTO v_settings
  FROM public.school_settings AS ss
  ORDER BY ss.created_at
  LIMIT 1;

  v_settings := coalesce(v_settings, jsonb_build_object(
    'school_name', 'Rukara Model School',
    'pass_mark', v_pass_mark
  ));

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'name', s.name,
        'code', s.code,
        'assessment_count', m.assessment_count,
        'maximum_marks', m.maximum_marks,
        'scored_maximum_marks', m.scored_maximum_marks,
        'marks_obtained', m.marks_obtained,
        'percentage', m.percentage,
        'grade', coalesce(g.grade, '—'),
        'status', CASE
          WHEN m.percentage IS NULL THEN 'Missing'
          WHEN m.percentage >= v_pass_mark THEN 'PASS'
          ELSE 'FAIL'
        END,
        'remark', CASE
          WHEN m.percentage IS NULL THEN 'No mark available.'
          ELSE coalesce(g.comment, g.remark, '')
        END
      )
      ORDER BY s.name
    ),
    '[]'::jsonb
  )
  INTO v_subjects
  FROM (
    SELECT subject.id, subject.name, subject.code
    FROM public.subjects AS subject
    WHERE subject.status = 'active'
      AND CASE
        WHEN upper(coalesce(nullif(subject.level, ''), 'Both')) = 'BOTH'
             AND upper(coalesce(nullif(subject.education_level, ''), 'Both')) <> 'BOTH'
          THEN CASE
            WHEN v_category = 'Primary' THEN upper(subject.education_level) LIKE '%PRIMARY%'
            ELSE upper(subject.education_level) LIKE '%SECONDARY%'
          END
        WHEN upper(coalesce(nullif(subject.level, ''), 'Both')) = 'BOTH'
          THEN TRUE
        WHEN v_category = 'Primary' THEN upper(subject.level) LIKE '%PRIMARY%'
        ELSE upper(subject.level) LIKE '%SECONDARY%'
      END
  ) AS s
  LEFT JOIN LATERAL (
    SELECT
      count(a.id)::integer AS assessment_count,
      coalesce(sum(a.maximum_mark), 0)::numeric AS maximum_marks,
      coalesce(sum(a.maximum_mark) FILTER (WHERE m.mark IS NOT NULL), 0)::numeric AS scored_maximum_marks,
      coalesce(sum(m.mark) FILTER (WHERE m.mark IS NOT NULL), 0)::numeric AS marks_obtained,
      CASE
        WHEN count(m.mark) = 0 THEN NULL
        WHEN bool_and(coalesce(coalesce(a.weight, atype.weight) > 0, FALSE))
             FILTER (WHERE m.mark IS NOT NULL)
          THEN round(
            sum((m.mark / nullif(a.maximum_mark, 0)) * 100 * coalesce(a.weight, atype.weight))
              FILTER (WHERE m.mark IS NOT NULL)
            / nullif(sum(coalesce(a.weight, atype.weight))
              FILTER (WHERE m.mark IS NOT NULL), 0),
            2
          )
        ELSE round(
          sum(m.mark) FILTER (WHERE m.mark IS NOT NULL)
          / nullif(sum(a.maximum_mark) FILTER (WHERE m.mark IS NOT NULL), 0) * 100,
          2
        )
      END AS percentage
    FROM public.assessments AS a
    LEFT JOIN public.assessment_types AS atype ON atype.id = a.assessment_type_id
    LEFT JOIN public.marks AS m
      ON m.assessment_id = a.id
     AND m.learner_id = v_learner.id
    WHERE a.class_id = p_class_id
      AND a.subject_id = s.id
      AND a.academic_year_id = p_academic_year_id
      AND (p_term_id IS NULL OR a.term_id = p_term_id)
      AND a.status IN ('submitted', 'approved', 'locked')
      AND NOT (
        coalesce(a.description, '') LIKE 'Combined marks conversion:%'
        OR (
          coalesce(a.period_type, '') = 'other'
          AND coalesce(a.period_label, '') LIKE 'Combined Conversion%'
        )
      )
  ) AS m ON TRUE
  LEFT JOIN LATERAL (
    SELECT gs.grade, gs.comment, gs.remark
    FROM public.grading_scales AS gs
    WHERE gs.is_active
      AND m.percentage BETWEEN gs.minimum_percentage AND gs.maximum_percentage
    ORDER BY gs.minimum_percentage DESC, gs.display_order
    LIMIT 1
  ) AS g ON m.percentage IS NOT NULL;

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE (portal_subject.value ->> 'percentage') IS NOT NULL)::integer,
    count(*) FILTER (WHERE portal_subject.value ->> 'status' = 'PASS')::integer,
    count(*) FILTER (WHERE portal_subject.value ->> 'status' = 'FAIL')::integer,
    coalesce(sum(coalesce((portal_subject.value ->> 'marks_obtained')::numeric, 0))
      FILTER (WHERE (portal_subject.value ->> 'percentage') IS NOT NULL), 0)::numeric,
    coalesce(sum(coalesce((portal_subject.value ->> 'scored_maximum_marks')::numeric, 0))
      FILTER (WHERE (portal_subject.value ->> 'percentage') IS NOT NULL), 0)::numeric,
    coalesce(sum(coalesce((portal_subject.value ->> 'assessment_count')::integer, 0)), 0)::integer
  INTO
    v_total_subjects,
    v_subjects_with_marks,
    v_passed,
    v_failed,
    v_total_obtained,
    v_total_maximum,
    v_assessment_count
  FROM jsonb_array_elements(v_subjects) AS portal_subject(value);

  v_average := CASE
    WHEN v_total_maximum > 0
      THEN round(v_total_obtained / v_total_maximum * 100, 2)
    ELSE NULL
  END;
  v_pass_rate := CASE
    WHEN v_subjects_with_marks > 0
      THEN round(v_passed::numeric / v_subjects_with_marks * 100, 2)
    ELSE NULL
  END;
  v_pass_status := CASE
    WHEN v_average IS NULL THEN 'INCOMPLETE'
    WHEN v_average >= v_pass_mark THEN 'PASS'
    ELSE 'FAIL'
  END;

  v_summary := jsonb_build_object(
    'total_subjects', v_total_subjects,
    'subjects_with_marks', v_subjects_with_marks,
    'passed_subjects', v_passed,
    'failed_subjects', v_failed,
    'marks_obtained', v_total_obtained,
    'maximum_marks', v_total_maximum,
    'average_percentage', v_average,
    'assessment_count', v_assessment_count,
    'pass_rate', v_pass_rate,
    'pass_status', v_pass_status
  );

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'subject', s.name,
        'subject_code', s.code,
        'assessment', coalesce(a.display_name, a.name, a.unit, 'Assessment'),
        'assessment_id', a.id,
        'type', coalesce(atype.name, 'Assessment'),
        'type_id', a.assessment_type_id,
        'type_code', coalesce(atype.code, left(upper(atype.name), 6), 'ASSESS'),
        'term', t.name,
        'term_id', a.term_id,
        'assessment_date', a.assessment_date,
        'maximum_mark', a.maximum_mark,
        'mark', mark.mark,
        'percentage', CASE
          WHEN mark.mark IS NOT NULL AND a.maximum_mark > 0
            THEN round(mark.mark / a.maximum_mark * 100, 2)
          ELSE NULL
        END,
        'grade', coalesce(grade.grade, '—'),
        'status', CASE
          WHEN mark.mark IS NULL THEN 'MISSING'
          WHEN mark.mark / nullif(a.maximum_mark, 0) * 100 >= v_pass_mark THEN 'PASS'
          ELSE 'FAIL'
        END
      )
      ORDER BY a.assessment_date, s.name, a.name
    ),
    '[]'::jsonb
  )
  INTO v_assessments
  FROM public.assessments AS a
  JOIN public.subjects AS s ON s.id = a.subject_id
  LEFT JOIN public.assessment_types AS atype ON atype.id = a.assessment_type_id
  LEFT JOIN public.terms AS t ON t.id = a.term_id
  LEFT JOIN public.marks AS mark
    ON mark.assessment_id = a.id
   AND mark.learner_id = v_learner.id
  LEFT JOIN LATERAL (
    SELECT gs.grade
    FROM public.grading_scales AS gs
    WHERE gs.is_active
      AND mark.mark IS NOT NULL
      AND a.maximum_mark > 0
      AND mark.mark / a.maximum_mark * 100
          BETWEEN gs.minimum_percentage AND gs.maximum_percentage
    ORDER BY gs.minimum_percentage DESC, gs.display_order
    LIMIT 1
  ) AS grade ON TRUE
  WHERE a.class_id = p_class_id
    AND a.academic_year_id = p_academic_year_id
    AND (p_term_id IS NULL OR a.term_id = p_term_id)
    AND a.status IN ('submitted', 'approved', 'locked')
    AND NOT (
      coalesce(a.description, '') LIKE 'Combined marks conversion:%'
      OR (
        coalesce(a.period_type, '') = 'other'
        AND coalesce(a.period_label, '') LIKE 'Combined Conversion%'
      )
    )
    AND NOT (
      coalesce(a.description, '') LIKE 'Combined marks conversion:%'
      OR (
        coalesce(a.period_type, '') = 'other'
        AND coalesce(a.period_label, '') LIKE 'Combined Conversion%'
      )
    )
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(v_subjects) AS portal_subject(value)
      WHERE portal_subject.value ->> 'code' = s.code
    );

  SELECT coalesce(
    jsonb_build_object(
      'position', ranked.position,
      'out_of', ranked.out_of
    ),
    jsonb_build_object('position', NULL, 'out_of', NULL)
  )
  INTO v_position
  FROM (
    WITH scoped_subjects AS (
      SELECT subject.id
      FROM public.subjects AS subject
      WHERE subject.status = 'active'
        AND CASE
          WHEN upper(coalesce(nullif(subject.level, ''), 'Both')) = 'BOTH'
               AND upper(coalesce(nullif(subject.education_level, ''), 'Both')) <> 'BOTH'
            THEN CASE
              WHEN v_category = 'Primary' THEN upper(subject.education_level) LIKE '%PRIMARY%'
              ELSE upper(subject.education_level) LIKE '%SECONDARY%'
            END
          WHEN upper(coalesce(nullif(subject.level, ''), 'Both')) = 'BOTH'
            THEN TRUE
          WHEN v_category = 'Primary' THEN upper(subject.level) LIKE '%PRIMARY%'
          ELSE upper(subject.level) LIKE '%SECONDARY%'
        END
    ),
    roster AS (
      SELECT learner.id
      FROM public.learners AS learner
      WHERE learner.class_id = p_class_id
        AND learner.status = 'active'
    ),
    learner_subject_scores AS (
      SELECT
        roster.id AS learner_id,
        subject.id AS subject_id,
        count(mark.mark)::integer AS marks_count,
        coalesce(sum(mark.mark), 0)::numeric AS obtained,
        coalesce(sum(assessment.maximum_mark)
          FILTER (WHERE mark.mark IS NOT NULL), 0)::numeric AS maximum
      FROM roster
      CROSS JOIN scoped_subjects AS subject
      LEFT JOIN public.assessments AS assessment
        ON assessment.class_id = p_class_id
       AND assessment.subject_id = subject.id
       AND assessment.academic_year_id = p_academic_year_id
       AND (p_term_id IS NULL OR assessment.term_id = p_term_id)
       AND assessment.status IN ('submitted', 'approved', 'locked')
       AND NOT (
         coalesce(assessment.description, '') LIKE 'Combined marks conversion:%'
         OR (
           coalesce(assessment.period_type, '') = 'other'
           AND coalesce(assessment.period_label, '') LIKE 'Combined Conversion%'
         )
       )
      LEFT JOIN public.marks AS mark
        ON mark.assessment_id = assessment.id
       AND mark.learner_id = roster.id
      GROUP BY roster.id, subject.id
    ),
    learner_totals AS (
      SELECT
        learner_id,
        round(sum(obtained) / nullif(sum(maximum), 0) * 100, 2) AS percentage
      FROM learner_subject_scores
      WHERE marks_count > 0
      GROUP BY learner_id
      HAVING sum(maximum) > 0
    ),
    ranked AS (
      SELECT
        learner_id,
        rank() OVER (ORDER BY percentage DESC)::integer AS position,
        count(*) OVER ()::integer AS out_of
      FROM learner_totals
    )
    SELECT position, out_of
    FROM ranked
    WHERE learner_id = v_learner.id
  ) AS ranked;

  IF coalesce((v_settings ->> 'ranking_enabled')::boolean, TRUE) IS FALSE THEN
    v_position := jsonb_build_object('position', NULL, 'out_of', NULL);
  END IF;

  SELECT coalesce(
    assigned_teacher.full_name,
    (
      SELECT teacher.full_name
      FROM public.assessments AS a
      JOIN public.teachers AS teacher ON teacher.id = a.teacher_id
      WHERE a.class_id = p_class_id
        AND a.academic_year_id = p_academic_year_id
        AND (p_term_id IS NULL OR a.term_id = p_term_id)
        AND a.status IN ('submitted', 'approved', 'locked')
      GROUP BY teacher.id, teacher.full_name
      ORDER BY count(*) DESC, teacher.full_name
      LIMIT 1
    ),
    ''
  )
  INTO v_teacher_name
  FROM (SELECT 1) AS singleton
  LEFT JOIN public.teachers AS assigned_teacher
    ON assigned_teacher.id = v_class.class_teacher_id;

  SELECT jsonb_build_object(
    'student', jsonb_build_object(
      'id', v_learner.id,
      'name', v_learner.full_name,
      'code', v_learner.learner_code,
      'gender', v_learner.gender,
      'date_of_birth', to_jsonb(v_learner) ->> 'date_of_birth',
      'class_id', v_class.id,
      'class_name', v_class.name,
      'stream', v_class.stream,
      'education_level', v_category,
      'teacher_name', v_teacher_name
    ),
    'subjects', v_subjects,
    'assessments', v_assessments,
    'summary', v_summary,
    'position', coalesce(v_position, jsonb_build_object('position', NULL, 'out_of', NULL)),
    'settings', v_settings,
    'academic_year', jsonb_build_object(
      'id', v_year.id,
      'name', v_year.name,
      'status', v_year.status,
      'is_current', v_year.is_current
    ),
    'term', CASE
      WHEN p_term_id IS NULL THEN NULL
      ELSE jsonb_build_object(
        'id', v_term.id,
        'name', v_term.name,
        'term_no', v_term.term_no,
        'academic_year_id', v_term.academic_year_id
      )
    END,
    'grading_scale', v_grading_scale,
    'report_comment', CASE
      WHEN v_average IS NULL THEN 'Some assessment marks are missing. Final performance may be incomplete.'
      ELSE coalesce((
        SELECT gs.comment
        FROM public.grading_scales AS gs
        WHERE gs.is_active
          AND v_average BETWEEN gs.minimum_percentage AND gs.maximum_percentage
        ORDER BY gs.minimum_percentage DESC, gs.display_order
        LIMIT 1
      ), '')
    END
  )
  INTO v_summary;

  RETURN v_summary;
END;
$function$;

REVOKE ALL ON FUNCTION public.student_marks_portal_options() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.student_marks_portal_options() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.student_marks_portal_options() TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_student_marks_portal(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_student_marks_portal(uuid, text, uuid, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_marks_portal(uuid, text, uuid, uuid) TO anon, authenticated;

COMMENT ON FUNCTION public.student_marks_portal_options() IS
  'Returns active classes and non-inactive academic periods for the public single-learner marks portal.';
COMMENT ON FUNCTION public.get_student_marks_portal(uuid, text, uuid, uuid) IS
  'Returns report data only for a learner matching the supplied class and code; callable by portal roles without direct table access.';
