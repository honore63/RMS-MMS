-- Report and DOS-scope query indexes.
-- Apply after the schema and education-level migrations.

CREATE INDEX IF NOT EXISTS idx_classes_education_level
  ON classes(education_level);

CREATE INDEX IF NOT EXISTS idx_terms_academic_year
  ON terms(academic_year_id);

CREATE INDEX IF NOT EXISTS idx_learners_class_academic_status
  ON learners(class_id, academic_year_id, status);

CREATE INDEX IF NOT EXISTS idx_teacher_assignments_scope
  ON teacher_assignments(class_id, subject_id, academic_year_id, term_id);

CREATE INDEX IF NOT EXISTS idx_assessments_report_scope
  ON assessments(class_id, academic_year_id, term_id, subject_id, status);

CREATE INDEX IF NOT EXISTS idx_marks_learner_assessment
  ON marks(learner_id, assessment_id);
