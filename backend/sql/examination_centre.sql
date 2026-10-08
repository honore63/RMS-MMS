-- RMS Examination Centre. Safe to run repeatedly on an existing project.

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('dos', 'teacher', 'headteacher', 'principal', 'parent', 'learner'));
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS learner_id UUID REFERENCES public.learners(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_learner_id
  ON public.users(learner_id) WHERE learner_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.examinations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 180),
  description TEXT NOT NULL DEFAULT '',
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE RESTRICT,
  academic_year_id UUID NOT NULL REFERENCES public.academic_years(id) ON DELETE CASCADE,
  term_id UUID REFERENCES public.terms(id) ON DELETE SET NULL,
  assessment_type_id UUID REFERENCES public.assessment_types(id) ON DELETE SET NULL,
  duration_minutes INTEGER CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600),
  pass_mark NUMERIC NOT NULL DEFAULT 50 CHECK (pass_mark BETWEEN 0 AND 100),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','open','closed','archived')),
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  attempt_limit INTEGER NOT NULL DEFAULT 1 CHECK (attempt_limit BETWEEN 1 AND 10),
  randomize_questions BOOLEAN NOT NULL DEFAULT FALSE,
  randomize_options BOOLEAN NOT NULL DEFAULT FALSE,
  allow_previous BOOLEAN NOT NULL DEFAULT TRUE,
  show_results BOOLEAN NOT NULL DEFAULT FALSE,
  results_released_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at IS NULL OR start_at IS NULL OR end_at > start_at)
);

CREATE TABLE IF NOT EXISTS public.examination_classes (
  exam_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  PRIMARY KEY (exam_id, class_id)
);
INSERT INTO public.examination_classes (exam_id, class_id)
SELECT id, class_id FROM public.examinations
ON CONFLICT DO NOTHING;
CREATE INDEX IF NOT EXISTS idx_examination_classes_class ON public.examination_classes(class_id, exam_id);

CREATE TABLE IF NOT EXISTS public.exam_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL CHECK (length(btrim(question_text)) BETWEEN 1 AND 10000),
  question_type TEXT NOT NULL DEFAULT 'mcq_single',
  options JSONB,
  correct_option TEXT,
  marks NUMERIC NOT NULL DEFAULT 1 CHECK (marks > 0 AND marks <= 1000),
  question_order INTEGER NOT NULL DEFAULT 0,
  image_url TEXT,
  video_url TEXT,
  explanation TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (exam_id, question_order)
);
ALTER TABLE public.exam_questions
  ADD COLUMN IF NOT EXISTS video_url TEXT;
ALTER TABLE public.exam_questions
  ALTER COLUMN options DROP NOT NULL,
  ALTER COLUMN correct_option DROP NOT NULL;
ALTER TABLE public.exam_questions
  DROP CONSTRAINT IF EXISTS exam_questions_question_type_check,
  DROP CONSTRAINT IF EXISTS exam_questions_options_check,
  DROP CONSTRAINT IF EXISTS exam_questions_correct_option_check,
  DROP CONSTRAINT IF EXISTS exam_questions_answer_format;
ALTER TABLE public.exam_questions
  ADD CONSTRAINT exam_questions_answer_format CHECK (
    (question_type = 'mcq_single'
      AND jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 5
      AND correct_option IN ('A','B','C','D','E'))
    OR (question_type = 'written_response' AND options = '[]'::jsonb AND correct_option IS NULL)
  );
ALTER TABLE public.exam_questions
  ADD CONSTRAINT exam_questions_question_type_check
  CHECK (question_type IN ('mcq_single','written_response'));

CREATE TABLE IF NOT EXISTS public.question_bank (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES public.teachers(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES public.subjects(id) ON DELETE CASCADE,
  class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL,
  academic_year_id UUID REFERENCES public.academic_years(id) ON DELETE SET NULL,
  assessment_type_id UUID REFERENCES public.assessment_types(id) ON DELETE SET NULL,
  question_text TEXT NOT NULL CHECK (length(btrim(question_text)) BETWEEN 1 AND 10000),
  options JSONB NOT NULL CHECK (jsonb_typeof(options) = 'array' AND jsonb_array_length(options) BETWEEN 2 AND 5),
  correct_option TEXT NOT NULL CHECK (correct_option IN ('A','B','C','D','E')),
  image_url TEXT,
  video_url TEXT,
  marks NUMERIC NOT NULL DEFAULT 1 CHECK (marks > 0 AND marks <= 1000),
  explanation TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT '',
  difficulty TEXT NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy','medium','hard')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS video_url TEXT;

CREATE TABLE IF NOT EXISTS public.exam_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  exam_id UUID NOT NULL REFERENCES public.examinations(id) ON DELETE CASCADE,
  learner_id UUID NOT NULL REFERENCES public.learners(id) ON DELETE CASCADE,
  question_order UUID[] NOT NULL,
  option_orders JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  submitted_at TIMESTAMPTZ,
  score NUMERIC,
  total_marks NUMERIC,
  percentage NUMERIC,
  correct_count INTEGER,
  wrong_count INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','timed_out')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.exam_attempts
  ALTER COLUMN learner_id DROP NOT NULL;
ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS guest_name TEXT,
  ADD COLUMN IF NOT EXISTS guest_class_id UUID REFERENCES public.classes(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS guest_access_token UUID;
DO $guest_attempt_constraint$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempts_one_identity'
      AND conrelid = 'public.exam_attempts'::regclass) THEN
    ALTER TABLE public.exam_attempts ADD CONSTRAINT exam_attempts_one_identity CHECK (
      (learner_id IS NOT NULL AND guest_name IS NULL AND guest_class_id IS NULL AND guest_access_token IS NULL)
      OR
      (learner_id IS NULL AND length(btrim(guest_name)) BETWEEN 1 AND 120
        AND guest_class_id IS NOT NULL AND guest_access_token IS NOT NULL)
    );
  END IF;
END;
$guest_attempt_constraint$;
ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS option_orders JSONB NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_exam_attempts_learner_exam ON public.exam_attempts(learner_id, exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_attempts_guest_identity
  ON public.exam_attempts(exam_id, guest_class_id, lower(btrim(guest_name)))
  WHERE learner_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_examinations_teacher_status ON public.examinations(teacher_id, status);
CREATE INDEX IF NOT EXISTS idx_examinations_class_status ON public.examinations(class_id, status);
CREATE INDEX IF NOT EXISTS idx_exam_questions_exam_order ON public.exam_questions(exam_id, question_order);
CREATE INDEX IF NOT EXISTS idx_question_bank_teacher_subject ON public.question_bank(teacher_id, subject_id);

CREATE OR REPLACE FUNCTION public.rms_exam_set_classes(p_exam_id UUID, p_class_ids UUID[])
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_exam public.examinations%ROWTYPE;
  v_class_count INTEGER;
BEGIN
  IF public.rms_account_role() IS DISTINCT FROM 'teacher' THEN
    RAISE EXCEPTION 'Only the owning teacher can assign examination classes.';
  END IF;
  SELECT * INTO v_exam FROM public.examinations
  WHERE id = p_exam_id AND teacher_id = public.rms_account_teacher_id()
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only assign classes to your own examination.'; END IF;
  IF p_class_ids IS NULL OR cardinality(p_class_ids) = 0 THEN
    RAISE EXCEPTION 'Select at least one class.';
  END IF;
  SELECT count(DISTINCT requested.class_id) INTO v_class_count
  FROM unnest(p_class_ids) AS requested(class_id);
  IF v_class_count <> cardinality(p_class_ids) THEN
    RAISE EXCEPTION 'A class can only be selected once.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(p_class_ids) requested(class_id)
    WHERE NOT public.rms_teacher_can_assessment_row(
      v_exam.teacher_id, requested.class_id, v_exam.subject_id, v_exam.academic_year_id
    )
  ) THEN
    RAISE EXCEPTION 'You can only assign this examination to classes and subjects assigned to you.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exam_attempts a WHERE a.exam_id = p_exam_id)
    AND (
      EXISTS (SELECT class_id FROM public.examination_classes WHERE exam_id = p_exam_id
        EXCEPT SELECT requested.class_id FROM unnest(p_class_ids) AS requested(class_id))
      OR EXISTS (SELECT requested.class_id FROM unnest(p_class_ids) AS requested(class_id)
        EXCEPT SELECT class_id FROM public.examination_classes WHERE exam_id = p_exam_id)
    ) THEN
    RAISE EXCEPTION 'Assessment classes cannot be changed after a learner has started.';
  END IF;
  DELETE FROM public.examination_classes ec
  WHERE ec.exam_id = p_exam_id AND NOT (ec.class_id = ANY(p_class_ids));
  INSERT INTO public.examination_classes (exam_id, class_id)
  SELECT p_exam_id, requested.class_id FROM unnest(p_class_ids) requested(class_id)
  ON CONFLICT DO NOTHING;
END;
$fn$;
REVOKE ALL ON FUNCTION public.rms_exam_set_classes(UUID, UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_exam_set_classes(UUID, UUID[]) TO authenticated;

CREATE TABLE IF NOT EXISTS public.student_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id UUID NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.exam_questions(id) ON DELETE CASCADE,
  selected_option TEXT,
  response_text TEXT,
  is_correct BOOLEAN,
  marks_awarded NUMERIC,
  teacher_feedback TEXT,
  marked_at TIMESTAMPTZ,
  answered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (attempt_id, question_id)
);
ALTER TABLE public.student_answers
  ALTER COLUMN selected_option DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS response_text TEXT,
  ADD COLUMN IF NOT EXISTS teacher_feedback TEXT,
  ADD COLUMN IF NOT EXISTS marked_at TIMESTAMPTZ,
  DROP CONSTRAINT IF EXISTS student_answers_selected_option_check,
  DROP CONSTRAINT IF EXISTS student_answers_answer_format;
ALTER TABLE public.student_answers
  ADD CONSTRAINT student_answers_selected_option_check
  CHECK (selected_option IS NULL OR selected_option IN ('A','B','C','D','E')),
  ADD CONSTRAINT student_answers_answer_format
  CHECK (selected_option IS NULL OR response_text IS NULL);
CREATE INDEX IF NOT EXISTS idx_student_answers_attempt ON public.student_answers(attempt_id);

CREATE OR REPLACE FUNCTION public.rms_exam_validate_options()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
DECLARE
  v_count INTEGER;
  v_distinct_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'exam_questions' THEN
    IF NEW.question_type = 'written_response' THEN
      IF NEW.options IS DISTINCT FROM '[]'::jsonb OR NEW.correct_option IS NOT NULL THEN
        RAISE EXCEPTION 'Written-response questions cannot have answer choices or a correct option.';
      END IF;
      RETURN NEW;
    END IF;
  END IF;
  SELECT count(*), count(DISTINCT (value->>'key'))
    INTO v_count, v_distinct_count
    FROM jsonb_array_elements(NEW.options) AS choices(value)
    WHERE jsonb_typeof(value) = 'object'
      AND value->>'key' IN ('A','B','C','D','E')
      AND length(btrim(coalesce(value->>'text', ''))) > 0;
  IF v_count <> jsonb_array_length(NEW.options) OR v_distinct_count <> v_count
    OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.options) AS choices(value)
      WHERE value->>'key' = NEW.correct_option) THEN
    RAISE EXCEPTION 'Question options must have unique A-E keys, non-empty text, and include the correct option.';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS rms_exam_questions_validate_options ON public.exam_questions;
CREATE TRIGGER rms_exam_questions_validate_options
  BEFORE INSERT OR UPDATE OF options, correct_option, question_type ON public.exam_questions
  FOR EACH ROW EXECUTE FUNCTION public.rms_exam_validate_options();
DROP TRIGGER IF EXISTS rms_question_bank_validate_options ON public.question_bank;
CREATE TRIGGER rms_question_bank_validate_options
  BEFORE INSERT OR UPDATE OF options, correct_option ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.rms_exam_validate_options();

CREATE OR REPLACE FUNCTION public.rms_exam_lock_questions_after_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_exam_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_exam_id := OLD.exam_id;
  ELSE
    v_exam_id := NEW.exam_id;
  END IF;
  PERFORM id FROM public.examinations WHERE id = v_exam_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.exam_attempts WHERE exam_id = v_exam_id) THEN
    RAISE EXCEPTION 'Questions cannot be changed after a learner has started this examination.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS rms_exam_questions_lock_attempted ON public.exam_questions;
CREATE TRIGGER rms_exam_questions_lock_attempted
  BEFORE INSERT OR UPDATE OR DELETE ON public.exam_questions
  FOR EACH ROW EXECUTE FUNCTION public.rms_exam_lock_questions_after_attempt();

CREATE OR REPLACE FUNCTION public.rms_exam_lock_scoring_settings_after_attempt()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.exam_attempts WHERE exam_id = OLD.id;
    DELETE FROM public.exam_questions WHERE exam_id = OLD.id;
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM public.exam_attempts WHERE exam_id = OLD.id)
    AND ROW(NEW.class_id, NEW.subject_id, NEW.academic_year_id, NEW.term_id,
      NEW.assessment_type_id, NEW.duration_minutes, NEW.pass_mark, NEW.attempt_limit,
      NEW.start_at, NEW.end_at, NEW.randomize_questions, NEW.randomize_options, NEW.allow_previous)
      IS DISTINCT FROM ROW(OLD.class_id, OLD.subject_id, OLD.academic_year_id, OLD.term_id,
      OLD.assessment_type_id, OLD.duration_minutes, OLD.pass_mark, OLD.attempt_limit,
      OLD.start_at, OLD.end_at, OLD.randomize_questions, OLD.randomize_options, OLD.allow_previous) THEN
    RAISE EXCEPTION 'Examination settings cannot be changed after a learner has started.';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS rms_examinations_lock_attempted ON public.examinations;
CREATE TRIGGER rms_examinations_lock_attempted
  BEFORE UPDATE OR DELETE ON public.examinations
  FOR EACH ROW EXECUTE FUNCTION public.rms_exam_lock_scoring_settings_after_attempt();

CREATE OR REPLACE FUNCTION public.rms_exam_validate_status_transition()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF OLD.results_released_at IS NOT NULL AND NEW.status = 'open' THEN
    RAISE EXCEPTION 'An examination cannot be reopened after its results have been released.';
  END IF;
  IF NOT (
    (OLD.status = 'draft' AND NEW.status = 'published')
    OR (OLD.status = 'published' AND NEW.status = 'open')
    OR (OLD.status = 'open' AND NEW.status = 'closed')
    OR (OLD.status = 'closed' AND NEW.status = 'open')
    OR (OLD.status = 'closed' AND NEW.status = 'archived')
  ) THEN
    RAISE EXCEPTION 'Invalid examination status transition: % -> %.', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'published' AND NOT EXISTS (
    SELECT 1 FROM public.exam_questions q WHERE q.exam_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Add at least one question before publishing the examination.';
  END IF;
  IF NEW.status = 'open' AND (
    NOT EXISTS (SELECT 1 FROM public.exam_questions q WHERE q.exam_id = NEW.id)
    OR (NEW.end_at IS NOT NULL AND NEW.end_at <= NOW())
  ) THEN
    RAISE EXCEPTION 'An examination can open only when it has questions and its closing time has not passed.';
  END IF;
  IF NEW.status = 'archived' AND EXISTS (
    SELECT 1 FROM public.exam_attempts a WHERE a.exam_id = NEW.id AND a.status = 'in_progress'
  ) THEN
    RAISE EXCEPTION 'An examination cannot be archived while learners have active attempts.';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS rms_examinations_status_transition ON public.examinations;
CREATE TRIGGER rms_examinations_status_transition
  BEFORE UPDATE OF status ON public.examinations
  FOR EACH ROW EXECUTE FUNCTION public.rms_exam_validate_status_transition();

CREATE OR REPLACE FUNCTION public.rms_exam_validate_result_release()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
BEGIN
  IF NEW.results_released_at IS NOT DISTINCT FROM OLD.results_released_at THEN
    RETURN NEW;
  END IF;
  IF OLD.results_released_at IS NOT NULL THEN
    RAISE EXCEPTION 'Released examination results cannot be withdrawn.';
  END IF;
  IF NEW.results_released_at IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.rms_account_role() IS DISTINCT FROM 'teacher'
    OR NOT EXISTS (SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.status = 'active')
    OR NEW.teacher_id IS DISTINCT FROM public.rms_account_teacher_id() THEN
    RAISE EXCEPTION 'Only the owning teacher can release examination results.';
  END IF;
  IF NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'Close the examination before releasing results.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.exam_attempts a
    WHERE a.exam_id = NEW.id AND a.status = 'in_progress') THEN
    RAISE EXCEPTION 'Wait until all active examination attempts are submitted before releasing results.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.exam_attempts a
    CROSS JOIN LATERAL unnest(a.question_order) ord(question_id)
    JOIN public.exam_questions q ON q.id = ord.question_id
    LEFT JOIN public.student_answers sa
      ON sa.attempt_id = a.id AND sa.question_id = q.id
    WHERE a.exam_id = NEW.id AND q.question_type = 'written_response'
      AND sa.marked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Mark all written responses before releasing results.';
  END IF;
  RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS rms_examinations_validate_result_release ON public.examinations;
CREATE TRIGGER rms_examinations_validate_result_release
  BEFORE UPDATE OF results_released_at ON public.examinations
  FOR EACH ROW EXECUTE FUNCTION public.rms_exam_validate_result_release();

CREATE OR REPLACE FUNCTION public.rms_learner_is_in_class(p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    JOIN public.learners l ON l.id = u.learner_id
    WHERE u.id = auth.uid() AND u.role = 'learner' AND u.status = 'active'
      AND l.status = 'active' AND l.class_id = p_class_id)
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_has_class(p_exam_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.examination_classes ec
    WHERE ec.exam_id = p_exam_id AND ec.class_id = p_class_id
  )
$fn$;
REVOKE ALL ON FUNCTION public.rms_exam_has_class(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_exam_has_class(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_learner_has_exam_attempt(p_exam_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.exam_attempts a
    JOIN public.users u ON u.learner_id = a.learner_id
    JOIN public.learners l ON l.id = a.learner_id
    WHERE a.exam_id = p_exam_id AND a.status = 'in_progress'
      AND l.class_id = p_class_id
      AND public.rms_exam_has_class(a.exam_id, p_class_id)
      AND u.id = auth.uid() AND u.role = 'learner' AND u.status = 'active'
      AND l.status = 'active')
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_class_visible(p_exam_id UUID, p_class_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.examinations e
    JOIN public.classes c ON c.id = p_class_id
    WHERE e.id = p_exam_id AND public.rms_exam_has_class(e.id, c.id)
      AND (
        e.teacher_id = public.rms_account_teacher_id()
        OR (public.rms_is_scoped_dos() AND public.rms_dos_can_level(c.education_level))
        OR (e.status IN ('published','open')
          AND public.rms_account_role() = 'learner'
          AND public.rms_learner_is_in_class(c.id))
        OR (e.status = 'closed'
          AND public.rms_account_role() = 'learner'
          AND public.rms_learner_has_exam_attempt(e.id, c.id))
      )
  )
$fn$;
REVOKE ALL ON FUNCTION public.rms_exam_class_visible(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_exam_class_visible(UUID, UUID) TO authenticated;

ALTER TABLE public.examinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.examination_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_bank ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rms_examinations_select ON public.examinations;
CREATE POLICY rms_examinations_select ON public.examinations FOR SELECT TO authenticated
  USING (
    teacher_id = public.rms_account_teacher_id()
    OR (public.rms_is_scoped_dos() AND EXISTS (
      SELECT 1 FROM public.examination_classes ec
      WHERE ec.exam_id = examinations.id
        AND public.rms_exam_class_visible(ec.exam_id, ec.class_id)))
    OR (status IN ('published','open')
      AND public.rms_account_role() = 'learner'
      AND public.rms_learner_is_in_class(
        (SELECT l.class_id FROM public.users u JOIN public.learners l ON l.id = u.learner_id WHERE u.id = auth.uid()))
      AND public.rms_exam_has_class(examinations.id,
        (SELECT l.class_id FROM public.users u JOIN public.learners l ON l.id = u.learner_id WHERE u.id = auth.uid())))
    OR (status = 'closed'
      AND public.rms_account_role() = 'learner'
      AND public.rms_learner_has_exam_attempt(examinations.id,
        (SELECT l.class_id FROM public.users u JOIN public.learners l ON l.id = u.learner_id WHERE u.id = auth.uid())))
  );
DROP POLICY IF EXISTS rms_examinations_insert ON public.examinations;
CREATE POLICY rms_examinations_insert ON public.examinations FOR INSERT TO authenticated
  WITH CHECK (teacher_id = public.rms_account_teacher_id()
    AND public.rms_teacher_can_assessment_row(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_examinations_update ON public.examinations;
CREATE POLICY rms_examinations_update ON public.examinations FOR UPDATE TO authenticated
  USING (teacher_id = public.rms_account_teacher_id())
  WITH CHECK (teacher_id = public.rms_account_teacher_id()
    AND public.rms_teacher_can_assessment_row(teacher_id, class_id, subject_id, academic_year_id));
DROP POLICY IF EXISTS rms_examinations_delete ON public.examinations;
CREATE POLICY rms_examinations_delete ON public.examinations FOR DELETE TO authenticated
  USING (teacher_id = public.rms_account_teacher_id());

DROP POLICY IF EXISTS rms_examination_classes_select ON public.examination_classes;
CREATE POLICY rms_examination_classes_select ON public.examination_classes FOR SELECT TO authenticated
  USING (public.rms_exam_class_visible(exam_id, class_id));
DROP POLICY IF EXISTS rms_examination_classes_insert ON public.examination_classes;
CREATE POLICY rms_examination_classes_insert ON public.examination_classes FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id()
      AND public.rms_teacher_can_assessment_row(e.teacher_id, class_id, e.subject_id, e.academic_year_id)));
DROP POLICY IF EXISTS rms_examination_classes_delete ON public.examination_classes;
CREATE POLICY rms_examination_classes_delete ON public.examination_classes FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id()));

DROP POLICY IF EXISTS rms_exam_questions_teacher ON public.exam_questions;
DROP POLICY IF EXISTS rms_exam_questions_select ON public.exam_questions;
CREATE POLICY rms_exam_questions_select ON public.exam_questions FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id())
    OR EXISTS (SELECT 1 FROM public.examinations e
      WHERE e.id = exam_id AND public.rms_is_scoped_dos()
        AND EXISTS (SELECT 1 FROM public.examination_classes ec
          JOIN public.classes c ON c.id = ec.class_id
          WHERE ec.exam_id = e.id AND public.rms_dos_can_level(c.education_level))));
DROP POLICY IF EXISTS rms_exam_questions_insert ON public.exam_questions;
CREATE POLICY rms_exam_questions_insert ON public.exam_questions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id()
      AND public.rms_teacher_can_assessment_row(e.teacher_id, e.class_id, e.subject_id, e.academic_year_id)));
DROP POLICY IF EXISTS rms_exam_questions_update ON public.exam_questions;
CREATE POLICY rms_exam_questions_update ON public.exam_questions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id()
      AND public.rms_teacher_can_assessment_row(e.teacher_id, e.class_id, e.subject_id, e.academic_year_id)));
DROP POLICY IF EXISTS rms_exam_questions_delete ON public.exam_questions;
CREATE POLICY rms_exam_questions_delete ON public.exam_questions FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.examinations e
    WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id()));

DROP POLICY IF EXISTS rms_question_bank_owner ON public.question_bank;
CREATE POLICY rms_question_bank_owner ON public.question_bank FOR ALL TO authenticated
  USING (teacher_id = public.rms_account_teacher_id())
  WITH CHECK (teacher_id = public.rms_account_teacher_id()
    AND public.rms_account_can_subject(subject_id));

DROP POLICY IF EXISTS rms_exam_attempts_scope ON public.exam_attempts;
CREATE POLICY rms_exam_attempts_scope ON public.exam_attempts FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.examinations e
      WHERE e.id = exam_id AND e.teacher_id = public.rms_account_teacher_id())
    OR EXISTS (SELECT 1 FROM public.examinations e
      WHERE e.id = exam_id AND public.rms_is_scoped_dos()
        AND EXISTS (SELECT 1 FROM public.examination_classes ec
          JOIN public.classes c ON c.id = ec.class_id
          WHERE ec.exam_id = e.id AND public.rms_dos_can_level(c.education_level)))
  );

CREATE OR REPLACE FUNCTION public.rms_exam_learner_can_view_answers(p_attempt_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.exam_attempts a
    JOIN public.users u ON u.learner_id = a.learner_id
    JOIN public.examinations e ON e.id = a.exam_id
    WHERE a.id = p_attempt_id
      AND u.id = auth.uid() AND u.role = 'learner' AND u.status = 'active'
      AND a.status <> 'in_progress'
      AND e.results_released_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(a.question_order) ord(question_id)
        JOIN public.exam_questions q ON q.id = ord.question_id
        LEFT JOIN public.student_answers marked
          ON marked.attempt_id = a.id AND marked.question_id = q.id
        WHERE q.question_type = 'written_response' AND marked.marked_at IS NULL
      )
  )
$fn$;
REVOKE ALL ON FUNCTION public.rms_exam_learner_can_view_answers(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_exam_learner_can_view_answers(UUID) TO authenticated;

DROP POLICY IF EXISTS rms_student_answers_select_scope ON public.student_answers;
CREATE POLICY rms_student_answers_select_scope ON public.student_answers FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.exam_attempts a
      JOIN public.examinations e ON e.id = a.exam_id
      WHERE a.id = attempt_id
        AND (e.teacher_id = public.rms_account_teacher_id()
          OR (public.rms_is_scoped_dos() AND EXISTS (
            SELECT 1 FROM public.examination_classes ec
            JOIN public.classes c ON c.id = ec.class_id
            WHERE ec.exam_id = e.id AND public.rms_dos_can_level(c.education_level)))))
    OR public.rms_exam_learner_can_view_answers(attempt_id)
  );

CREATE OR REPLACE FUNCTION public.rms_exam_teacher_can_manage_media_path(p_path TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT public.rms_account_role() = 'teacher'
    AND EXISTS (
      SELECT 1 FROM public.examinations e
      WHERE e.id::text = split_part(coalesce(p_path, ''), '/', 1)
        AND e.teacher_id = public.rms_account_teacher_id()
        AND public.rms_teacher_can_assessment_row(
          e.teacher_id, e.class_id, e.subject_id, e.academic_year_id
        )
    )
$fn$;
REVOKE ALL ON FUNCTION public.rms_exam_teacher_can_manage_media_path(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_exam_teacher_can_manage_media_path(TEXT) TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'examination-media',
  'examination-media',
  TRUE,
  104857600,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm', 'video/ogg']
)
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      public = TRUE,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS rms_exam_media_public_read ON storage.objects;
CREATE POLICY rms_exam_media_public_read ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'examination-media');
DROP POLICY IF EXISTS rms_exam_media_teacher_insert ON storage.objects;
CREATE POLICY rms_exam_media_teacher_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'examination-media'
    AND public.rms_exam_teacher_can_manage_media_path(name));
DROP POLICY IF EXISTS rms_exam_media_teacher_update ON storage.objects;
CREATE POLICY rms_exam_media_teacher_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'examination-media'
    AND public.rms_exam_teacher_can_manage_media_path(name))
  WITH CHECK (bucket_id = 'examination-media'
    AND public.rms_exam_teacher_can_manage_media_path(name));
DROP POLICY IF EXISTS rms_exam_media_teacher_delete ON storage.objects;
CREATE POLICY rms_exam_media_teacher_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'examination-media'
    AND public.rms_exam_teacher_can_manage_media_path(name));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.examinations, public.exam_questions, public.question_bank TO authenticated;
REVOKE ALL ON public.examination_classes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.examination_classes TO authenticated;
GRANT SELECT ON public.exam_attempts, public.student_answers TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_account_can_learner(p_learner_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT CASE public.rms_account_role()
    WHEN 'learner' THEN EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = auth.uid() AND u.status = 'active'
        AND u.learner_id = p_learner_id)
    WHEN 'dos' THEN true
    WHEN 'teacher' THEN EXISTS (
      SELECT 1 FROM public.learners l
      JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR EXISTS (
      SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND c.class_teacher_id = public.rms_account_teacher_id())
    WHEN 'headteacher' THEN EXISTS (
      SELECT 1 FROM public.learners l
      JOIN public.teacher_assignments ta ON ta.class_id = l.class_id
      WHERE l.id = p_learner_id AND ta.teacher_id = public.rms_account_teacher_id())
      OR EXISTS (
      SELECT 1 FROM public.learners l JOIN public.classes c ON c.id = l.class_id
      WHERE l.id = p_learner_id AND c.class_teacher_id = public.rms_account_teacher_id())
    ELSE false
  END;
$fn$;
REVOKE ALL ON FUNCTION public.rms_account_can_learner(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_account_can_learner(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.rms_exam_start(p_exam_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_user public.users%ROWTYPE;
  v_learner public.learners%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_attempt public.exam_attempts%ROWTYPE;
  v_order UUID[];
  v_question_count INTEGER;
  v_attempt_count INTEGER;
  v_questions JSONB;
  v_answers JSONB;
  v_responses JSONB;
  v_option_order JSONB;
  v_option_keys JSONB;
  v_q RECORD;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() AND role = 'learner' AND status = 'active';
  IF NOT FOUND OR v_user.learner_id IS NULL THEN RAISE EXCEPTION 'Learner account is not linked to an active learner.'; END IF;
  SELECT * INTO v_learner FROM public.learners WHERE id = v_user.learner_id AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Learner record is inactive or unavailable.'; END IF;
  SELECT * INTO v_exam FROM public.examinations
    WHERE id = p_exam_id
      AND public.rms_exam_has_class(id, v_learner.class_id)
      AND status IN ('open','closed')
    FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'This examination is not available to your learner account.'; END IF;
  IF v_exam.start_at IS NOT NULL AND NOW() < v_exam.start_at THEN RAISE EXCEPTION 'This examination has not opened yet.'; END IF;
  SELECT count(*) INTO v_question_count FROM public.exam_questions WHERE exam_id = v_exam.id;
  IF v_question_count = 0 THEN RAISE EXCEPTION 'This examination has no questions yet.'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_exam.id::text || v_learner.id::text, 0));
  SELECT * INTO v_attempt FROM public.exam_attempts
    WHERE exam_id = v_exam.id AND learner_id = v_learner.id AND status = 'in_progress'
    ORDER BY created_at DESC LIMIT 1;
  IF FOUND THEN
    IF (v_exam.duration_minutes IS NOT NULL
        AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes))
       OR (v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at) THEN
      RETURN public.rms_exam_submit(v_attempt.id);
    END IF;
  ELSE
    IF v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at THEN
      RAISE EXCEPTION 'The examination availability period has ended.';
    END IF;
    IF v_exam.status = 'closed' THEN RAISE EXCEPTION 'This examination is closed to new attempts.'; END IF;
    SELECT count(*) INTO v_attempt_count FROM public.exam_attempts
      WHERE exam_id = v_exam.id AND learner_id = v_learner.id;
    IF v_attempt_count >= v_exam.attempt_limit THEN RAISE EXCEPTION 'You have used all attempts for this examination.'; END IF;
    SELECT array_agg(q.id ORDER BY CASE WHEN v_exam.randomize_questions THEN gen_random_uuid() END, q.question_order)
      INTO v_order FROM public.exam_questions q WHERE q.exam_id = v_exam.id;
    v_option_order := '{}'::jsonb;
    FOR v_q IN SELECT id, options FROM public.exam_questions WHERE exam_id = v_exam.id LOOP
      IF v_exam.randomize_options THEN
        SELECT jsonb_agg(opt->>'key' ORDER BY gen_random_uuid())
          INTO v_option_keys
          FROM jsonb_array_elements(v_q.options) opt;
      ELSE
        SELECT jsonb_agg(opt->>'key' ORDER BY ordinality)
          INTO v_option_keys
          FROM jsonb_array_elements(v_q.options) WITH ORDINALITY AS opts(opt, ordinality);
      END IF;
      v_option_order := v_option_order || jsonb_build_object(v_q.id::text, coalesce(v_option_keys, '[]'::jsonb));
    END LOOP;
    INSERT INTO public.exam_attempts(exam_id, learner_id, question_order, option_orders)
      VALUES (v_exam.id, v_learner.id, v_order, v_option_order) RETURNING * INTO v_attempt;
  END IF;
  SELECT jsonb_agg(jsonb_build_object(
    'id', q.id, 'question_text', q.question_text, 'question_type', q.question_type,
    'options', CASE WHEN q.question_type = 'mcq_single' THEN (
      SELECT jsonb_agg(jsonb_build_object(
        'key', chr(64 + displayed.ordinality::integer), 'text', canonical.opt->>'text'
      ) ORDER BY displayed.ordinality)
      FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(v_attempt.option_orders -> q.id::text) = 'array'
          THEN v_attempt.option_orders -> q.id::text
        ELSE '[]'::jsonb END)
        WITH ORDINALITY displayed(canonical_key, ordinality)
      JOIN LATERAL jsonb_array_elements(q.options) canonical(opt)
        ON canonical.opt->>'key' = displayed.canonical_key
    ) ELSE '[]'::jsonb END, 'marks', q.marks, 'question_order', ord.ordinality,
    'image_url', q.image_url, 'video_url', q.video_url
  ) ORDER BY ord.ordinality)
  INTO v_questions
  FROM unnest(v_attempt.question_order) WITH ORDINALITY ord(question_id, ordinality)
  JOIN public.exam_questions q ON q.id = ord.question_id;
  SELECT coalesce(jsonb_object_agg(a.question_id::text, chr(64 + displayed.ordinality::integer)), '{}'::jsonb)
    INTO v_answers
    FROM public.student_answers a
    JOIN LATERAL jsonb_array_elements_text(CASE
      WHEN jsonb_typeof(v_attempt.option_orders -> a.question_id::text) = 'array'
        THEN v_attempt.option_orders -> a.question_id::text
      ELSE '[]'::jsonb END)
      WITH ORDINALITY displayed(canonical_key, ordinality)
      ON displayed.canonical_key = a.selected_option
    WHERE a.attempt_id = v_attempt.id;
  SELECT coalesce(jsonb_object_agg(a.question_id::text, a.response_text), '{}'::jsonb)
    INTO v_responses
    FROM public.student_answers a
    WHERE a.attempt_id = v_attempt.id AND a.response_text IS NOT NULL;
  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id, 'exam_id', v_exam.id, 'title', v_exam.title,
    'description', v_exam.description, 'duration_minutes', v_exam.duration_minutes,
    'end_at', v_exam.end_at,
    'started_at', v_attempt.started_at, 'allow_previous', v_exam.allow_previous,
    'question_count', v_question_count, 'questions', coalesce(v_questions, '[]'::jsonb),
    'answers', coalesce(v_answers, '{}'::jsonb),
    'responses', coalesce(v_responses, '{}'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_save_answer(p_attempt_id UUID, p_question_id UUID, p_option TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_user public.users%ROWTYPE;
  v_question public.exam_questions%ROWTYPE;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_user FROM public.users WHERE id = auth.uid() AND role = 'learner' AND status = 'active';
  IF NOT FOUND OR v_user.learner_id IS NULL THEN RAISE EXCEPTION 'Learner account is not linked.'; END IF;
  SELECT * INTO v_attempt FROM public.exam_attempts
    WHERE id = p_attempt_id AND learner_id = v_user.learner_id AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF v_exam.duration_minutes IS NOT NULL AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes)
    THEN RAISE EXCEPTION 'Examination time has expired.'; END IF;
  IF v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at THEN RAISE EXCEPTION 'Examination availability period has ended.'; END IF;
  IF NOT p_question_id = ANY(v_attempt.question_order) THEN RAISE EXCEPTION 'Question is not part of this examination attempt.'; END IF;
  SELECT * INTO v_question FROM public.exam_questions WHERE id = p_question_id AND exam_id = v_exam.id;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(CASE
      WHEN jsonb_typeof(v_attempt.option_orders -> p_question_id::text) = 'array'
        THEN v_attempt.option_orders -> p_question_id::text
      ELSE '[]'::jsonb END)
      WITH ORDINALITY mapped(canonical_key, ordinality)
    WHERE chr(64 + mapped.ordinality::integer) = upper(p_option))
    INTO v_allowed;
  IF NOT coalesce(v_allowed, false) THEN RAISE EXCEPTION 'Select one of the available answer options.'; END IF;
  INSERT INTO public.student_answers(attempt_id, question_id, selected_option, answered_at)
    VALUES (v_attempt.id, v_question.id,
      (v_attempt.option_orders -> (p_question_id::text))->>(ascii(upper(p_option)) - 65), NOW())
  ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option = EXCLUDED.selected_option, answered_at = NOW();
  RETURN jsonb_build_object('saved', true, 'saved_at', NOW());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_save_written_answer(
  p_attempt_id UUID, p_question_id UUID, p_response TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_learner_id UUID;
BEGIN
  SELECT learner_id INTO v_learner_id FROM public.users
    WHERE id = auth.uid() AND role = 'learner' AND status = 'active';
  IF v_learner_id IS NULL THEN RAISE EXCEPTION 'Learner account is not linked.'; END IF;
  IF p_response IS NULL OR length(p_response) > 10000 THEN
    RAISE EXCEPTION 'Written responses must be 10,000 characters or fewer.';
  END IF;
  SELECT * INTO v_attempt FROM public.exam_attempts
    WHERE id = p_attempt_id AND learner_id = v_learner_id AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF (v_exam.duration_minutes IS NOT NULL
      AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes))
    OR (v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at) THEN
    RAISE EXCEPTION 'Examination time has expired.';
  END IF;
  IF NOT p_question_id = ANY(v_attempt.question_order) OR NOT EXISTS (
    SELECT 1 FROM public.exam_questions
    WHERE id = p_question_id AND exam_id = v_exam.id AND question_type = 'written_response'
  ) THEN RAISE EXCEPTION 'Written question is not part of this examination attempt.'; END IF;
  INSERT INTO public.student_answers(attempt_id, question_id, response_text, answered_at)
    VALUES (v_attempt.id, p_question_id, p_response, NOW())
  ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option = NULL, response_text = EXCLUDED.response_text,
      marks_awarded = NULL, teacher_feedback = NULL, marked_at = NULL, answered_at = NOW();
  RETURN jsonb_build_object('saved', true, 'saved_at', NOW());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_submit(p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_learner_id UUID;
  v_total NUMERIC;
  v_score NUMERIC;
  v_correct INTEGER;
  v_wrong INTEGER;
  v_percentage NUMERIC;
  v_timed_out BOOLEAN;
  v_manual_pending BOOLEAN;
  v_score_ready BOOLEAN;
BEGIN
  SELECT learner_id INTO v_learner_id FROM public.users
    WHERE id = auth.uid() AND role = 'learner' AND status = 'active';
  IF v_learner_id IS NULL THEN RAISE EXCEPTION 'Learner account is not linked.'; END IF;
  SELECT * INTO v_attempt FROM public.exam_attempts
    WHERE id = p_attempt_id AND learner_id = v_learner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF v_attempt.status <> 'in_progress' THEN
    SELECT EXISTS (
      SELECT 1 FROM unnest(v_attempt.question_order) ord(question_id)
      JOIN public.exam_questions q ON q.id = ord.question_id
      LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id
      WHERE q.question_type = 'written_response' AND a.marked_at IS NULL
    ) INTO v_manual_pending;
    v_score_ready := NOT v_manual_pending;
    RETURN jsonb_build_object('submitted', true, 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'title', v_exam.title,
      'score', CASE WHEN v_score_ready THEN v_attempt.score END,
      'total_marks', CASE WHEN v_score_ready THEN v_attempt.total_marks END,
      'percentage', CASE WHEN v_score_ready THEN v_attempt.percentage END,
      'correct_count', CASE WHEN v_score_ready THEN v_attempt.correct_count END,
      'wrong_count', CASE WHEN v_score_ready THEN v_attempt.wrong_count END,
      'results_released', v_exam.results_released_at IS NOT NULL AND NOT v_manual_pending,
      'score_available', v_score_ready, 'manual_marking_pending', v_manual_pending,
      'review', public.rms_exam_review_payload(v_attempt.id));
  END IF;
  v_timed_out := (v_exam.duration_minutes IS NOT NULL
      AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes))
    OR (v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at);
  SELECT coalesce(sum(q.marks), 0),
    coalesce(sum(CASE WHEN a.selected_option = q.correct_option THEN q.marks ELSE 0 END), 0),
    count(*) FILTER (WHERE q.question_type = 'mcq_single' AND a.selected_option = q.correct_option),
    count(*) FILTER (WHERE q.question_type = 'mcq_single' AND a.selected_option IS DISTINCT FROM q.correct_option)
  INTO v_total, v_score, v_correct, v_wrong
  FROM unnest(v_attempt.question_order) ord(question_id)
  JOIN public.exam_questions q ON q.id = ord.question_id
  LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id;
  UPDATE public.student_answers a SET
    is_correct = (a.selected_option = q.correct_option),
    marks_awarded = CASE WHEN a.selected_option = q.correct_option THEN q.marks ELSE 0 END
  FROM public.exam_questions q WHERE a.question_id = q.id AND a.attempt_id = v_attempt.id
    AND q.question_type = 'mcq_single';
  v_percentage := CASE WHEN v_total > 0 THEN round(v_score / v_total * 100, 2) ELSE 0 END;
  SELECT EXISTS (
    SELECT 1 FROM unnest(v_attempt.question_order) ord(question_id)
    JOIN public.exam_questions q ON q.id = ord.question_id
    LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id
    WHERE q.question_type = 'written_response' AND a.marked_at IS NULL
  ) INTO v_manual_pending;
  UPDATE public.exam_attempts SET
    status = CASE WHEN v_timed_out THEN 'timed_out' ELSE 'submitted' END,
    submitted_at = NOW(), score = v_score, total_marks = v_total,
    percentage = v_percentage, correct_count = v_correct, wrong_count = v_wrong
  WHERE id = v_attempt.id RETURNING * INTO v_attempt;
  v_score_ready := NOT v_manual_pending;
  RETURN jsonb_build_object(
    'submitted', true, 'attempt_id', v_attempt.id, 'status', v_attempt.status, 'title', v_exam.title,
    'results_released', v_exam.results_released_at IS NOT NULL AND NOT v_manual_pending,
    'score_available', v_score_ready, 'manual_marking_pending', v_manual_pending,
    'score', CASE WHEN v_score_ready THEN v_score END,
    'total_marks', CASE WHEN v_score_ready THEN v_total END,
    'percentage', CASE WHEN v_score_ready THEN v_percentage END,
    'correct_count', CASE WHEN v_score_ready THEN v_correct END,
    'wrong_count', CASE WHEN v_score_ready THEN v_wrong END,
    'review', public.rms_exam_review_payload(v_attempt.id)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_mark_written_answer(
  p_attempt_id UUID, p_question_id UUID, p_marks_awarded NUMERIC, p_teacher_feedback TEXT DEFAULT ''
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_question public.exam_questions%ROWTYPE;
  v_score NUMERIC;
  v_total NUMERIC;
  v_pending BOOLEAN;
BEGIN
  IF public.rms_account_role() IS DISTINCT FROM 'teacher'
    OR NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active') THEN
    RAISE EXCEPTION 'An active teacher account is required to mark responses.';
  END IF;
  IF p_marks_awarded IS NULL OR p_marks_awarded < 0
    OR length(coalesce(p_teacher_feedback, '')) > 2000 THEN
    RAISE EXCEPTION 'Enter valid marks and feedback.';
  END IF;
  SELECT * INTO v_attempt FROM public.exam_attempts
    WHERE id = p_attempt_id AND status IN ('submitted','timed_out') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations
    WHERE id = v_attempt.exam_id AND teacher_id = public.rms_account_teacher_id();
  IF NOT FOUND THEN RAISE EXCEPTION 'You can only mark responses for your own examinations.'; END IF;
  SELECT * INTO v_question FROM public.exam_questions
    WHERE id = p_question_id AND exam_id = v_exam.id AND question_type = 'written_response';
  IF NOT FOUND OR NOT p_question_id = ANY(v_attempt.question_order) THEN
    RAISE EXCEPTION 'Written question is not part of this attempt.';
  END IF;
  IF p_marks_awarded > v_question.marks THEN
    RAISE EXCEPTION 'Marks awarded cannot exceed the question maximum of %.', v_question.marks;
  END IF;
  INSERT INTO public.student_answers(
    attempt_id, question_id, marks_awarded, teacher_feedback, marked_at, answered_at
  ) VALUES (
    v_attempt.id, v_question.id, p_marks_awarded, coalesce(p_teacher_feedback, ''), NOW(), NOW()
  )
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET
    marks_awarded = EXCLUDED.marks_awarded,
    teacher_feedback = EXCLUDED.teacher_feedback,
    marked_at = EXCLUDED.marked_at;
  SELECT coalesce(sum(q.marks), 0), coalesce(sum(coalesce(a.marks_awarded, 0)), 0)
    INTO v_total, v_score
    FROM unnest(v_attempt.question_order) ord(question_id)
    JOIN public.exam_questions q ON q.id = ord.question_id
    LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id;
  SELECT EXISTS (
    SELECT 1 FROM unnest(v_attempt.question_order) ord(question_id)
    JOIN public.exam_questions q ON q.id = ord.question_id
    LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id
    WHERE q.question_type = 'written_response' AND a.marked_at IS NULL
  ) INTO v_pending;
  UPDATE public.exam_attempts SET
    score = v_score, total_marks = v_total,
    percentage = CASE WHEN v_total > 0 THEN round(v_score / v_total * 100, 2) ELSE 0 END
  WHERE id = v_attempt.id;
  RETURN jsonb_build_object('saved', true, 'manual_marking_pending', v_pending);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_review_payload(p_attempt_id UUID)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', q.id,
    'question_order', ord.ordinality,
    'question_text', q.question_text,
    'question_type', q.question_type,
    'image_url', q.image_url,
    'video_url', q.video_url,
    'options', CASE WHEN q.question_type = 'mcq_single' THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'key', chr(64 + displayed.ordinality::integer),
        'text', canonical.opt->>'text',
        'selected', displayed.canonical_key = sa.selected_option,
        'correct', displayed.canonical_key = q.correct_option
      ) ORDER BY displayed.ordinality)
      FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(a.option_orders -> q.id::text) = 'array'
          THEN a.option_orders -> q.id::text
        ELSE '[]'::jsonb END)
        WITH ORDINALITY displayed(canonical_key, ordinality)
      JOIN LATERAL jsonb_array_elements(q.options) canonical(opt)
        ON canonical.opt->>'key' = displayed.canonical_key
    ), '[]'::jsonb) ELSE '[]'::jsonb END,
    'selected_option', CASE WHEN q.question_type = 'mcq_single' THEN (
      SELECT chr(64 + displayed.ordinality::integer)
      FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(a.option_orders -> q.id::text) = 'array'
          THEN a.option_orders -> q.id::text
        ELSE '[]'::jsonb END)
        WITH ORDINALITY displayed(canonical_key, ordinality)
      WHERE displayed.canonical_key = sa.selected_option
    ) END,
    'correct_option', CASE WHEN q.question_type = 'mcq_single' THEN (
      SELECT chr(64 + displayed.ordinality::integer)
      FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(a.option_orders -> q.id::text) = 'array'
          THEN a.option_orders -> q.id::text
        ELSE '[]'::jsonb END)
        WITH ORDINALITY displayed(canonical_key, ordinality)
      WHERE displayed.canonical_key = q.correct_option
    ) END,
    'response_text', sa.response_text,
    'is_correct', sa.is_correct,
    'marks', q.marks,
    'marks_awarded', sa.marks_awarded,
    'marked_at', sa.marked_at,
    'teacher_feedback', sa.teacher_feedback,
    'explanation', q.explanation
  ) ORDER BY ord.ordinality), '[]'::jsonb)
  FROM public.exam_attempts a
  CROSS JOIN LATERAL unnest(a.question_order) WITH ORDINALITY ord(question_id, ordinality)
  JOIN public.exam_questions q ON q.id = ord.question_id
  LEFT JOIN public.student_answers sa
    ON sa.attempt_id = a.id AND sa.question_id = q.id
  WHERE a.id = p_attempt_id
$fn$;
REVOKE ALL ON FUNCTION public.rms_exam_review_payload(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.rms_exam_learner_review(p_attempt_id UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_learner_id UUID;
  v_manual_pending BOOLEAN;
BEGIN
  SELECT learner_id INTO v_learner_id FROM public.users
  WHERE id = auth.uid() AND role = 'learner' AND status = 'active';
  IF v_learner_id IS NULL THEN RAISE EXCEPTION 'An active learner account is required.'; END IF;
  SELECT * INTO v_attempt FROM public.exam_attempts
  WHERE id = p_attempt_id AND learner_id = v_learner_id
    AND status IN ('submitted', 'timed_out');
  IF NOT FOUND THEN RAISE EXCEPTION 'Submitted examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF v_exam.results_released_at IS NULL THEN
    RAISE EXCEPTION 'Your teacher has not released the examination results yet.';
  END IF;
  SELECT EXISTS (
    SELECT 1
    FROM unnest(v_attempt.question_order) ord(question_id)
    JOIN public.exam_questions q ON q.id = ord.question_id
    LEFT JOIN public.student_answers sa
      ON sa.attempt_id = v_attempt.id AND sa.question_id = q.id
    WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
  ) INTO v_manual_pending;
  IF v_manual_pending THEN
    RAISE EXCEPTION 'Your teacher is still marking written responses.';
  END IF;
  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id,
    'title', v_exam.title,
    'submitted_at', v_attempt.submitted_at,
    'score', v_attempt.score,
    'total_marks', v_attempt.total_marks,
    'percentage', v_attempt.percentage,
    'questions', public.rms_exam_review_payload(v_attempt.id)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_my_results()
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_learner_id UUID;
  v_results JSONB;
BEGIN
  SELECT learner_id INTO v_learner_id FROM public.users
    WHERE id = auth.uid() AND role = 'learner' AND status = 'active';
  IF v_learner_id IS NULL THEN RAISE EXCEPTION 'Learner account is not linked.'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'attempt_id', a.id, 'exam_id', e.id, 'title', e.title,
    'status', a.status, 'submitted_at', a.submitted_at,
    'score', CASE WHEN e.results_released_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(a.question_order) ord(question_id)
        JOIN public.exam_questions q ON q.id = ord.question_id
        LEFT JOIN public.student_answers sa ON sa.attempt_id = a.id AND sa.question_id = q.id
        WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
      ) THEN a.score END,
    'total_marks', CASE WHEN e.results_released_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(a.question_order) ord(question_id)
        JOIN public.exam_questions q ON q.id = ord.question_id
        LEFT JOIN public.student_answers sa ON sa.attempt_id = a.id AND sa.question_id = q.id
        WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
      ) THEN a.total_marks END,
    'percentage', CASE WHEN e.results_released_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(a.question_order) ord(question_id)
        JOIN public.exam_questions q ON q.id = ord.question_id
        LEFT JOIN public.student_answers sa ON sa.attempt_id = a.id AND sa.question_id = q.id
        WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
      ) THEN a.percentage END,
    'correct_count', CASE WHEN e.results_released_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(a.question_order) ord(question_id)
        JOIN public.exam_questions q ON q.id = ord.question_id
        LEFT JOIN public.student_answers sa ON sa.attempt_id = a.id AND sa.question_id = q.id
        WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
      ) THEN a.correct_count END,
    'wrong_count', CASE WHEN e.results_released_at IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM unnest(a.question_order) ord(question_id)
        JOIN public.exam_questions q ON q.id = ord.question_id
        LEFT JOIN public.student_answers sa ON sa.attempt_id = a.id AND sa.question_id = q.id
        WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
      ) THEN a.wrong_count END,
    'manual_marking_pending', EXISTS (
      SELECT 1 FROM unnest(a.question_order) ord(question_id)
      JOIN public.exam_questions q ON q.id = ord.question_id
      LEFT JOIN public.student_answers sa ON sa.attempt_id = a.id AND sa.question_id = q.id
      WHERE q.question_type = 'written_response' AND sa.marked_at IS NULL
    )
  ) ORDER BY a.submitted_at DESC), '[]'::jsonb)
  INTO v_results
  FROM public.exam_attempts a
  JOIN public.examinations e ON e.id = a.exam_id
  WHERE a.learner_id = v_learner_id
    AND ((a.status = 'in_progress' AND (e.status = 'closed'
          OR (e.end_at IS NOT NULL AND e.end_at <= NOW())
          OR (e.duration_minutes IS NOT NULL
            AND a.started_at + make_interval(mins => e.duration_minutes) <= NOW())))
      OR a.status <> 'in_progress');
  RETURN v_results;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_link_learner_account(p_learner_id UUID, p_email TEXT)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, pg_temp AS $fn$
DECLARE
  v_user_id UUID;
  v_email TEXT := lower(btrim(p_email));
  v_learner public.learners%ROWTYPE;
BEGIN
  IF public.rms_account_role() IS DISTINCT FROM 'dos' THEN RAISE EXCEPTION 'Only DOS accounts can link learner logins.'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.status = 'active') THEN
    RAISE EXCEPTION 'An active DOS account is required.';
  END IF;
  SELECT * INTO v_learner FROM public.learners WHERE id = p_learner_id AND status = 'active';
  IF NOT FOUND OR NOT public.rms_dos_can_level(
    (SELECT c.education_level FROM public.classes c WHERE c.id = v_learner.class_id)) THEN
    RAISE EXCEPTION 'Learner is unavailable or outside your education-level scope.';
  END IF;
  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = v_email;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Create this learner login in Supabase Authentication first.'; END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE learner_id = p_learner_id AND id <> v_user_id) THEN
    RAISE EXCEPTION 'This learner already has a linked login.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id
    AND learner_id IS NOT NULL AND learner_id <> p_learner_id) THEN
    RAISE EXCEPTION 'This authentication account is already linked to another learner.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = v_user_id AND role <> 'learner') THEN
    RAISE EXCEPTION 'This email already belongs to a non-learner RMS account.';
  END IF;
  INSERT INTO public.users(id, email, full_name, role, status, learner_id, must_change_password)
    VALUES (v_user_id, v_email, v_learner.full_name, 'learner', 'active', p_learner_id, TRUE)
  ON CONFLICT (id) DO UPDATE SET learner_id = EXCLUDED.learner_id,
    full_name = EXCLUDED.full_name, must_change_password = TRUE
  WHERE public.users.role = 'learner';
  RETURN v_user_id;
END;
$fn$;

DROP FUNCTION IF EXISTS public.rms_exam_guest_list(TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.rms_exam_guest_list(p_class_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_exams JSONB;
  v_class_search TEXT;
BEGIN
  IF length(btrim(coalesce(p_class_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Enter your class name.';
  END IF;
  v_class_search := regexp_replace(lower(btrim(p_class_name)), '[[:space:]]+', '', 'g');
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'title', e.title, 'description', e.description,
    'duration_minutes', e.duration_minutes, 'attempt_limit', e.attempt_limit,
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
    SELECT 1 FROM public.examination_classes ec
    JOIN public.classes c ON c.id = ec.class_id
    CROSS JOIN LATERAL (
      SELECT regexp_replace(lower(btrim(c.name)), '[[:space:]]+', '', 'g') AS normalized_name
    ) AS class_name
    WHERE ec.exam_id = e.id AND c.status = 'active'
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

CREATE OR REPLACE FUNCTION public.rms_exam_guest_start(
  p_exam_id UUID, p_full_name TEXT, p_class_name TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_exam public.examinations%ROWTYPE;
  v_attempt public.exam_attempts%ROWTYPE;
  v_class_id UUID;
  v_order UUID[];
  v_question_count INTEGER;
  v_attempt_count INTEGER;
  v_questions JSONB;
  v_answers JSONB;
  v_responses JSONB;
  v_option_order JSONB := '{}'::jsonb;
  v_option_keys JSONB;
  v_q RECORD;
BEGIN
  IF length(btrim(coalesce(p_full_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Enter your full name (up to 120 characters).';
  END IF;
  IF length(btrim(coalesce(p_class_name, ''))) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'Enter your class name.';
  END IF;
  SELECT e.* INTO v_exam
  FROM public.examinations e
  WHERE e.id = p_exam_id AND EXISTS (
    SELECT 1 FROM public.examination_classes ec
    JOIN public.classes c ON c.id = ec.class_id
    WHERE ec.exam_id = e.id AND c.status = 'active'
      AND lower(btrim(c.name)) = lower(btrim(p_class_name))
  )
    AND e.status IN ('open', 'closed')
  FOR UPDATE OF e;
  IF NOT FOUND THEN RAISE EXCEPTION 'This test is not open for the class entered.'; END IF;
  SELECT c.id INTO v_class_id
  FROM public.examination_classes ec
  JOIN public.classes c ON c.id = ec.class_id
  WHERE ec.exam_id = v_exam.id AND c.status = 'active'
    AND lower(btrim(c.name)) = lower(btrim(p_class_name))
  LIMIT 1;
  SELECT count(*) INTO v_question_count
  FROM public.exam_questions WHERE exam_id = v_exam.id;
  IF v_question_count = 0 THEN RAISE EXCEPTION 'This examination has no questions yet.'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_exam.id::text || lower(btrim(p_full_name)), 0));
  SELECT * INTO v_attempt FROM public.exam_attempts
  WHERE exam_id = v_exam.id
    AND lower(btrim(guest_name)) = lower(btrim(p_full_name))
    AND status = 'in_progress'
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    IF v_exam.status <> 'open' THEN
      RAISE EXCEPTION 'This examination is closed to new attempts.';
    END IF;
    IF v_exam.start_at IS NOT NULL AND NOW() < v_exam.start_at THEN
      RAISE EXCEPTION 'This examination has not opened yet.';
    END IF;
    IF v_exam.end_at IS NOT NULL AND NOW() >= v_exam.end_at THEN
      RAISE EXCEPTION 'The examination availability period has ended.';
    END IF;
    SELECT count(*) INTO v_attempt_count FROM public.exam_attempts
    WHERE exam_id = v_exam.id
      AND lower(btrim(guest_name)) = lower(btrim(p_full_name));
    IF v_attempt_count >= v_exam.attempt_limit THEN
      RAISE EXCEPTION 'You have used all attempts for this examination.';
    END IF;
    SELECT array_agg(q.id ORDER BY
      CASE WHEN v_exam.randomize_questions THEN gen_random_uuid() END, q.question_order)
    INTO v_order FROM public.exam_questions q WHERE q.exam_id = v_exam.id;
    FOR v_q IN SELECT id, options FROM public.exam_questions WHERE exam_id = v_exam.id LOOP
      IF v_exam.randomize_options THEN
        SELECT jsonb_agg(opt->>'key' ORDER BY gen_random_uuid())
          INTO v_option_keys FROM jsonb_array_elements(v_q.options) opt;
      ELSE
        SELECT jsonb_agg(opt->>'key' ORDER BY ordinality)
          INTO v_option_keys
          FROM jsonb_array_elements(v_q.options) WITH ORDINALITY AS opts(opt, ordinality);
      END IF;
      v_option_order := v_option_order || jsonb_build_object(v_q.id::text, coalesce(v_option_keys, '[]'::jsonb));
    END LOOP;
    INSERT INTO public.exam_attempts(
      exam_id, learner_id, guest_name, guest_class_id, guest_access_token,
      question_order, option_orders
    ) VALUES (
      v_exam.id, NULL, btrim(p_full_name), v_class_id, gen_random_uuid(),
      v_order, v_option_order
    ) RETURNING * INTO v_attempt;
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id', q.id, 'question_text', q.question_text, 'question_type', q.question_type,
    'options', CASE WHEN q.question_type = 'mcq_single' THEN (
      SELECT jsonb_agg(jsonb_build_object(
        'key', chr(64 + displayed.ordinality::integer), 'text', canonical.opt->>'text'
      ) ORDER BY displayed.ordinality)
      FROM jsonb_array_elements_text(CASE
        WHEN jsonb_typeof(v_attempt.option_orders -> q.id::text) = 'array'
          THEN v_attempt.option_orders -> q.id::text
        ELSE '[]'::jsonb END)
        WITH ORDINALITY displayed(canonical_key, ordinality)
      JOIN LATERAL jsonb_array_elements(q.options) canonical(opt)
        ON canonical.opt->>'key' = displayed.canonical_key
    ) ELSE '[]'::jsonb END, 'marks', q.marks, 'question_order', ord.ordinality,
    'image_url', q.image_url, 'video_url', q.video_url
  ) ORDER BY ord.ordinality)
  INTO v_questions
  FROM unnest(v_attempt.question_order) WITH ORDINALITY ord(question_id, ordinality)
  JOIN public.exam_questions q ON q.id = ord.question_id;
  SELECT coalesce(jsonb_object_agg(a.question_id::text, chr(64 + displayed.ordinality::integer)), '{}'::jsonb)
  INTO v_answers
  FROM public.student_answers a
  JOIN LATERAL jsonb_array_elements_text(CASE
    WHEN jsonb_typeof(v_attempt.option_orders -> a.question_id::text) = 'array'
      THEN v_attempt.option_orders -> a.question_id::text
    ELSE '[]'::jsonb END)
    WITH ORDINALITY displayed(canonical_key, ordinality)
    ON displayed.canonical_key = a.selected_option
  WHERE a.attempt_id = v_attempt.id;
  SELECT coalesce(jsonb_object_agg(a.question_id::text, a.response_text), '{}'::jsonb)
  INTO v_responses
  FROM public.student_answers a
  WHERE a.attempt_id = v_attempt.id AND a.response_text IS NOT NULL;
  RETURN jsonb_build_object(
    'attempt_id', v_attempt.id, 'guest_token', v_attempt.guest_access_token,
    'guest', true, 'exam_id', v_exam.id, 'title', v_exam.title,
    'description', v_exam.description, 'duration_minutes', v_exam.duration_minutes,
    'end_at', v_exam.end_at, 'started_at', v_attempt.started_at,
    'allow_previous', v_exam.allow_previous, 'question_count', v_question_count,
    'questions', coalesce(v_questions, '[]'::jsonb), 'answers', coalesce(v_answers, '{}'::jsonb),
    'responses', coalesce(v_responses, '{}'::jsonb)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_guest_save_answer(
  p_attempt_id UUID, p_guest_token UUID, p_question_id UUID, p_option TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_question public.exam_questions%ROWTYPE;
  v_allowed BOOLEAN;
BEGIN
  SELECT * INTO v_attempt FROM public.exam_attempts
  WHERE id = p_attempt_id AND guest_access_token = p_guest_token
    AND learner_id IS NULL AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active guest examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF v_exam.duration_minutes IS NOT NULL
    AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes) THEN
    RAISE EXCEPTION 'Examination time has expired.';
  END IF;
  IF v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at THEN
    RAISE EXCEPTION 'Examination availability period has ended.';
  END IF;
  IF NOT p_question_id = ANY(v_attempt.question_order) THEN
    RAISE EXCEPTION 'Question is not part of this examination attempt.';
  END IF;
  SELECT * INTO v_question FROM public.exam_questions
  WHERE id = p_question_id AND exam_id = v_exam.id;
  SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(CASE
      WHEN jsonb_typeof(v_attempt.option_orders -> p_question_id::text) = 'array'
        THEN v_attempt.option_orders -> p_question_id::text
      ELSE '[]'::jsonb END)
      WITH ORDINALITY mapped(canonical_key, ordinality)
    WHERE chr(64 + mapped.ordinality::integer) = upper(p_option)
  ) INTO v_allowed;
  IF NOT coalesce(v_allowed, false) THEN
    RAISE EXCEPTION 'Select one of the available answer options.';
  END IF;
  INSERT INTO public.student_answers(attempt_id, question_id, selected_option, answered_at)
  VALUES (v_attempt.id, v_question.id,
    (v_attempt.option_orders -> (p_question_id::text))->>(ascii(upper(p_option)) - 65), NOW())
  ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option = EXCLUDED.selected_option, answered_at = NOW();
  RETURN jsonb_build_object('saved', true, 'saved_at', NOW());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_guest_save_written_answer(
  p_attempt_id UUID, p_guest_token UUID, p_question_id UUID, p_response TEXT
)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
BEGIN
  IF p_response IS NULL OR length(p_response) > 10000 THEN
    RAISE EXCEPTION 'Written responses must be 10,000 characters or fewer.';
  END IF;
  SELECT * INTO v_attempt FROM public.exam_attempts
  WHERE id = p_attempt_id AND guest_access_token = p_guest_token
    AND learner_id IS NULL AND status = 'in_progress' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active guest examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF (v_exam.duration_minutes IS NOT NULL
      AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes))
    OR (v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at) THEN
    RAISE EXCEPTION 'Examination time has expired.';
  END IF;
  IF NOT p_question_id = ANY(v_attempt.question_order) OR NOT EXISTS (
    SELECT 1 FROM public.exam_questions
    WHERE id = p_question_id AND exam_id = v_exam.id AND question_type = 'written_response'
  ) THEN RAISE EXCEPTION 'Written question is not part of this examination attempt.'; END IF;
  INSERT INTO public.student_answers(attempt_id, question_id, response_text, answered_at)
    VALUES (v_attempt.id, p_question_id, p_response, NOW())
  ON CONFLICT (attempt_id, question_id) DO UPDATE
    SET selected_option = NULL, response_text = EXCLUDED.response_text,
      marks_awarded = NULL, teacher_feedback = NULL, marked_at = NULL, answered_at = NOW();
  RETURN jsonb_build_object('saved', true, 'saved_at', NOW());
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rms_exam_guest_submit(p_attempt_id UUID, p_guest_token UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_attempt public.exam_attempts%ROWTYPE;
  v_exam public.examinations%ROWTYPE;
  v_total NUMERIC;
  v_score NUMERIC;
  v_correct INTEGER;
  v_wrong INTEGER;
  v_percentage NUMERIC;
  v_timed_out BOOLEAN;
  v_score_ready BOOLEAN;
  v_manual_pending BOOLEAN;
BEGIN
  SELECT * INTO v_attempt FROM public.exam_attempts
  WHERE id = p_attempt_id AND guest_access_token = p_guest_token AND learner_id IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Guest examination attempt not found.'; END IF;
  SELECT * INTO v_exam FROM public.examinations WHERE id = v_attempt.exam_id;
  IF v_attempt.status <> 'in_progress' THEN
    SELECT EXISTS (
      SELECT 1 FROM unnest(v_attempt.question_order) ord(question_id)
      JOIN public.exam_questions q ON q.id = ord.question_id
      LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id
      WHERE q.question_type = 'written_response' AND a.marked_at IS NULL
    ) INTO v_manual_pending;
    v_score_ready := NOT v_manual_pending;
    RETURN jsonb_build_object('submitted', true, 'attempt_id', v_attempt.id,
      'status', v_attempt.status, 'title', v_exam.title,
      'results_released', v_exam.results_released_at IS NOT NULL AND NOT v_manual_pending,
      'score_available', v_score_ready, 'manual_marking_pending', v_manual_pending,
      'review', public.rms_exam_review_payload(v_attempt.id),
      'score', CASE WHEN v_score_ready THEN v_attempt.score END,
      'total_marks', CASE WHEN v_score_ready THEN v_attempt.total_marks END,
      'percentage', CASE WHEN v_score_ready THEN v_attempt.percentage END,
      'correct_count', CASE WHEN v_score_ready THEN v_attempt.correct_count END,
      'wrong_count', CASE WHEN v_score_ready THEN v_attempt.wrong_count END);
  END IF;
  v_timed_out := (v_exam.duration_minutes IS NOT NULL
      AND NOW() > v_attempt.started_at + make_interval(mins => v_exam.duration_minutes))
    OR (v_exam.end_at IS NOT NULL AND NOW() > v_exam.end_at);
  SELECT coalesce(sum(q.marks), 0),
    coalesce(sum(CASE WHEN a.selected_option = q.correct_option THEN q.marks ELSE 0 END), 0),
    count(*) FILTER (WHERE q.question_type = 'mcq_single' AND a.selected_option = q.correct_option),
    count(*) FILTER (WHERE q.question_type = 'mcq_single' AND a.selected_option IS DISTINCT FROM q.correct_option)
  INTO v_total, v_score, v_correct, v_wrong
  FROM unnest(v_attempt.question_order) ord(question_id)
  JOIN public.exam_questions q ON q.id = ord.question_id
  LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id;
  UPDATE public.student_answers a SET
    is_correct = (a.selected_option = q.correct_option),
    marks_awarded = CASE WHEN a.selected_option = q.correct_option THEN q.marks ELSE 0 END
  FROM public.exam_questions q WHERE a.question_id = q.id AND a.attempt_id = v_attempt.id
    AND q.question_type = 'mcq_single';
  v_percentage := CASE WHEN v_total > 0 THEN round(v_score / v_total * 100, 2) ELSE 0 END;
  SELECT EXISTS (
    SELECT 1 FROM unnest(v_attempt.question_order) ord(question_id)
    JOIN public.exam_questions q ON q.id = ord.question_id
    LEFT JOIN public.student_answers a ON a.attempt_id = v_attempt.id AND a.question_id = q.id
    WHERE q.question_type = 'written_response' AND a.marked_at IS NULL
  ) INTO v_manual_pending;
  UPDATE public.exam_attempts SET
    status = CASE WHEN v_timed_out THEN 'timed_out' ELSE 'submitted' END,
    submitted_at = NOW(), score = v_score, total_marks = v_total,
    percentage = v_percentage, correct_count = v_correct, wrong_count = v_wrong
  WHERE id = v_attempt.id RETURNING * INTO v_attempt;
  v_score_ready := NOT v_manual_pending;
  RETURN jsonb_build_object(
    'submitted', true, 'attempt_id', v_attempt.id, 'status', v_attempt.status,
    'title', v_exam.title,
    'results_released', v_exam.results_released_at IS NOT NULL AND NOT v_manual_pending,
    'score_available', v_score_ready, 'manual_marking_pending', v_manual_pending,
    'review', public.rms_exam_review_payload(v_attempt.id),
    'score', CASE WHEN v_score_ready THEN v_score END,
    'total_marks', CASE WHEN v_score_ready THEN v_total END,
    'percentage', CASE WHEN v_score_ready THEN v_percentage END,
    'correct_count', CASE WHEN v_score_ready THEN v_correct END,
    'wrong_count', CASE WHEN v_score_ready THEN v_wrong END
  );
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.rms_exam_start(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_save_answer(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_save_written_answer(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_submit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_mark_written_answer(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_my_results() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_learner_review(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rms_link_learner_account(UUID, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.rms_exam_start(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_save_answer(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_save_written_answer(UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_submit(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_mark_written_answer(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_my_results() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_learner_review(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_link_learner_account(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_validate_options() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_lock_questions_after_attempt() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_lock_scoring_settings_after_attempt() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_validate_status_transition() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_validate_result_release() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_exam_guest_list(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_guest_start(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_guest_save_answer(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_guest_save_written_answer(UUID, UUID, UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.rms_exam_guest_submit(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_exam_guest_list(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_guest_start(UUID, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_guest_save_answer(UUID, UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_guest_save_written_answer(UUID, UUID, UUID, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rms_exam_guest_submit(UUID, UUID) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.rms_learner_is_in_class(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_learner_is_in_class(UUID) TO authenticated;
REVOKE ALL ON FUNCTION public.rms_learner_has_exam_attempt(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rms_learner_has_exam_attempt(UUID, UUID) TO authenticated;
NOTIFY pgrst, 'reload schema';
