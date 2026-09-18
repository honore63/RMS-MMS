-- =====================================================
-- MIGRATION: Add rejection_reason to assessments table
-- Run this in Supabase SQL Editor AFTER the main schema
-- =====================================================

ALTER TABLE assessments ADD COLUMN IF NOT EXISTS rejection_reason TEXT;

-- Update the existing assessment status check to include all needed values
ALTER TABLE assessments DROP CONSTRAINT IF EXISTS assessments_status_check;
ALTER TABLE assessments ADD CONSTRAINT assessments_status_check
  CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'locked'));
