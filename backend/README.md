# Backend — Supabase

The RMS backend is **Supabase** (fully managed PostgreSQL) — there is no separate application server. The frontend talks to Supabase directly through its REST + Realtime + Auth APIs, guarded by Row Level Security.

This folder contains everything that defines the backend.

## Structure

```
backend/
└── sql/
    ├── rms-full-setup.sql              # ONE-SHOT: full schema + RLS + default data
    ├── database.sql                    # Tables, columns, keys
    ├── rms-rls-policies.sql            # Row Level Security policies
    ├── seed-data.sql                   # Sample data for DOS + Teacher + learners
    ├── rms-run-now.sql                 # Quick reference setup script
    ├── migration-documents.sql         # Documents table + storage bucket
    ├── migration-academic-year-management.sql  # Academic year lifecycle
    ├── migration-marks-import.sql      # Marks Excel import tables/columns
    ├── migration-rms-mis-assessment-flexibility.sql  # Configurable assessment types
    ├── migration-rms-mis-rls.sql       # Scoped RLS (types/assessments/assignments)
    ├── migration-dos-education-level-scope.sql  # DOS Primary/Secondary scope helpers
    ├── migration-subject-levels.sql    # subjects.level (Both/Primary/Secondary/…)
    ├── migration-education-level-class-grouping.sql  # Class → education level
    ├── migration-assignments-multi-subject-per-class.sql  # Multi-subject assignments
    ├── migration-users-profile-photo.sql  # users.profile_photo_url + name fixes
    ├── migration-fix-teacher-registration-rls.sql  # Teacher 409 / scoped teachers RLS
    ├── migration-performance-comments.sql  # Performance comments bank
    ├── migration-report-wizard-indexes.sql # Report performance indexes
    ├── performance-indexes.sql         # Optimised indexes
    └── Image/                          # Supporting images
```

> Many other `migration-*.sql` files exist for incremental fixes (RLS recursion, 403/404, grading, class management, curriculum subjects, etc.). Run only what you need, in chronological order.

## Setup

1. Open your Supabase project → **SQL Editor**.
2. **New query** → paste the script → **Run**.
3. Recommended order for a fresh install:
   1. `rms-full-setup.sql` — everything needed to start.
   2. `migration-documents.sql` — Documents page (uploads/downloads via `documents` bucket).
   3. `migration-academic-year-management.sql` — Academic Year Management UI.
   4. `migration-marks-import.sql` — Marks Excel import.
   5. `migration-rms-mis-assessment-flexibility.sql` — configurable assessment types.
   6. `migration-rms-mis-rls.sql` — scoped RLS.
   7. `migration-dos-education-level-scope.sql` — DOS level scope helpers.
   8. `migration-subject-levels.sql` — subject education levels.
   9. `migration-assignments-multi-subject-per-class.sql` — multi-subject assignments.
   10. `migration-users-profile-photo.sql` — profile photos + account name fixes.
   11. `seed-data.sql` — optional sample data.

> All SQL is pasted and run **manually** in the SQL Editor — there is no migration runner. Prefer paste-ready queries with no placeholders.

## Authentication

Create users in Supabase → **Authentication → Users**:

| Role    | Email               | Password   | Auto Confirm |
|---------|---------------------|------------|--------------|
| DOS     | dos@rukara.edu      | dos123     | Yes          |
| Teacher | teacher@rukara.edu  | teacher123 | Yes          |

Then insert the matching `users` / `teachers` rows from `seed-data.sql`. Set real names with the UPDATE examples in `migration-users-profile-photo.sql`.

## Schema Overview (tables)

`users`/`profiles`, `academic_years`, `terms`, `classes`, `subjects`, `teachers`, `learners`, `teacher_assignments`, `assessments`, `marks`, `grading_scales`, `school_settings`, `audit_logs`, `notifications`, `documents`, `assessment_types`, `performance_comments`.

### Key relationships
- `learners` — `learner_code` is the unique **student number**; links to `classes` by `class_id`.
- `teacher_assignments` — one row per (teacher, class, subject, academic_year, term); **multiple subjects per class are allowed** (non-unique index on teacher_id).
- `assessments` — `teacher_id` + `class_id` + `subject_id`; `roster_learner_ids` snapshots the roster on submission.
- `marks` — `assessment_id` + `learner_id`; UNIQUE(assessment_id, learner_id) prevents duplicate marks.
- `subjects.level` / class education level — Primary vs Secondary separation enforced by RLS helpers (`rms_dos_can_level`, `rms_dos_can_subject`, `rms_teacher_in_scope`).

## Security

- Row Level Security enabled on every table.
- DOS role: full system access within its education-level scope.
- Teacher role: only rows linked to their own assignments.
- Scope helpers: `rms_is_dos`, `rms_dos_education_level`, `rms_dos_can_subject`, `rms_dos_can_level`, `rms_teacher_in_scope`, `rms_is_scoped_dos`.
- Live subscriptions require Realtime enabled on the `learners`, `assessments`, `marks`, `classes`, `subjects`, `teacher_assignments` tables.

## Frontend config

The frontend `js/config.js` holds the Supabase project URL and anon key. Update it to point to your project.
