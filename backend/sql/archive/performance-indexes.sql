-- =====================================================
-- PERFORMANCE INDEXES - Run in Supabase SQL Editor
-- =====================================================

-- Users
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- Teachers
CREATE INDEX IF NOT EXISTS idx_teachers_user_id ON teachers(user_id);
CREATE INDEX IF NOT EXISTS idx_teachers_code ON teachers(teacher_code);

-- Learners
CREATE INDEX IF NOT EXISTS idx_learners_class_id ON learners(class_id);
CREATE INDEX IF NOT EXISTS idx_learners_code ON learners(learner_code);
CREATE INDEX IF NOT EXISTS idx_learners_status ON learners(status);

-- Teacher Assignments
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_id ON teacher_assignments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_class_id ON teacher_assignments(class_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_subject_id ON teacher_assignments(subject_id);

-- Assessments
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_id ON assessments(teacher_id);
CREATE INDEX IF NOT EXISTS idx_assessments_class_id ON assessments(class_id);
CREATE INDEX IF NOT EXISTS idx_assessments_subject_id ON assessments(subject_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status ON assessments(status);

-- Marks
CREATE INDEX IF NOT EXISTS idx_marks_assessment_id ON marks(assessment_id);
CREATE INDEX IF NOT EXISTS idx_marks_learner_id ON marks(learner_id);

-- Audit Logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

-- Notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);

-- =====================================================
-- COMPOSITE INDEXES for common query patterns
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_assessments_teacher_class ON assessments(teacher_id, class_id);
CREATE INDEX IF NOT EXISTS idx_marks_assessment_learner ON marks(assessment_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_teacher_assignments_teacher_class_subject ON teacher_assignments(teacher_id, class_id, subject_id);