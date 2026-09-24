-- Allow a DOS to delete an archived academic year and its dependent records.
-- Current years remain protected by the application before this constraint runs.

-- Classes already use a cascading year relationship in the class migration.
ALTER TABLE public.classes
  DROP CONSTRAINT IF EXISTS classes_academic_year_id_fkey;
ALTER TABLE public.classes
  ADD CONSTRAINT classes_academic_year_id_fkey
  FOREIGN KEY (academic_year_id)
  REFERENCES public.academic_years(id)
  ON DELETE CASCADE;

ALTER TABLE public.teacher_assignments
  DROP CONSTRAINT IF EXISTS teacher_assignments_academic_year_id_fkey;
ALTER TABLE public.teacher_assignments
  ADD CONSTRAINT teacher_assignments_academic_year_id_fkey
  FOREIGN KEY (academic_year_id)
  REFERENCES public.academic_years(id)
  ON DELETE CASCADE;

ALTER TABLE public.learners
  DROP CONSTRAINT IF EXISTS learners_academic_year_id_fkey;
ALTER TABLE public.learners
  ADD CONSTRAINT learners_academic_year_id_fkey
  FOREIGN KEY (academic_year_id)
  REFERENCES public.academic_years(id)
  ON DELETE CASCADE;

ALTER TABLE public.assessments
  DROP CONSTRAINT IF EXISTS assessments_academic_year_id_fkey;
ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_academic_year_id_fkey
  FOREIGN KEY (academic_year_id)
  REFERENCES public.academic_years(id)
  ON DELETE CASCADE;

-- Terms cascade when their year is deleted. These nullable references must not
-- block that cascade when an assessment or assignment also references a term.
ALTER TABLE public.teacher_assignments
  DROP CONSTRAINT IF EXISTS teacher_assignments_term_id_fkey;
ALTER TABLE public.teacher_assignments
  ADD CONSTRAINT teacher_assignments_term_id_fkey
  FOREIGN KEY (term_id)
  REFERENCES public.terms(id)
  ON DELETE SET NULL;

ALTER TABLE public.assessments
  DROP CONSTRAINT IF EXISTS assessments_term_id_fkey;
ALTER TABLE public.assessments
  ADD CONSTRAINT assessments_term_id_fkey
  FOREIGN KEY (term_id)
  REFERENCES public.terms(id)
  ON DELETE SET NULL;

NOTIFY pgrst, 'reload schema';