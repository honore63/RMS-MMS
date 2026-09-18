-- ============================================================================
-- RMS — CLEAR "IMPORTED" DATA SCRIPT
-- ============================================================================
-- Run this in the Supabase SQL Editor to clear all imported students, teachers, 
-- and other operational information, while keeping your User logins intact.
-- ============================================================================

-- 1) Delete lowest level dependencies
DELETE FROM marks;
DELETE FROM documents;
DELETE FROM audit_logs;
DELETE FROM notifications;

-- 2) Delete operational data that relies on users, terms, and learners
DELETE FROM assessments;
DELETE FROM teacher_assignments;

-- 3) Delete imported learners and teachers
DELETE FROM learners;
DELETE FROM teachers;

-- 4) Delete term and academic year infrastructure
DELETE FROM terms;
DELETE FROM academic_years;

-- NOTE: 
-- 1. The `users` table is left completely untouched as requested.
-- 2. `classes`, `subjects`, `grading_scales`, and `school_settings` are also left 
--    alone because those are built-in core configurations that you typically 
--    don't want to re-type from zero. 
