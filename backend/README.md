# Backend — Supabase

The RMS backend is **Supabase** (fully managed PostgreSQL) — there is no separate application server. The frontend talks to Supabase directly through its REST + Realtime + Auth APIs, guarded by Row Level Security.

This folder contains everything that defines the backend:

## Structure

```
backend/
└── sql/
    ├── rms-full-setup.sql          # ONE-SHOT: full schema + RLS + default data
    ├── database-schema.sql         # Tables, columns, keys
    ├── rms-rls-policies.sql        # Row Level Security policies
    ├── seed-data.sql               # Sample data for DOS + Teacher + learners
    ├── rms-run-now.sql             # Quick reference setup script
    ├── migration-school-settings.sql      # Settings schema (pass mark, grading)
    ├── migration-learner-import-rls.sql   # Learner import RLS
    ├── migration-rejection-reason.sql     # Assessment rejection reason column
    ├── migration-fix-rls-users.sql        # RLS fix for user management
    ├── migration-learner-availability.sql # Learner → roster availability (recent)
    ├── migration-documents.sql       # Documents table + storage bucket (recent)
    ├── migration-academic-year-management.sql  # Academic year lifecycle (recent)
    ├── performance-indexes.sql    # Optimised indexes
    └── Image/                     # Supporting images
```

## Setup

1. Open your Supabase project → **SQL Editor**.
2. **New query** → paste → **Run**.
3. Order:
   1. `rms-full-setup.sql` — everything needed to start.
   2. `migration-learner-availability.sql` — required for the student-registration → automatic availability feature (`academic_year_id` on learners, `assessment_roster_policy` setting, `roster_learner_ids` snapshot).
   3. `migration-documents.sql` — required for the Documents page (uploads/downloads of images, Excel, Word, PDF via a public `documents` storage bucket).
   4. `migration-academic-year-management.sql` — required for the Academic Year Management UI (start/end years, statuses, current-year rule, terms upgrade, year RLS).
    5. `seed-data.sql` — optionally with `migration-learner-import-rls.sql` — sample data.

## Authentication

Create users in Supabase → **Authentication → Users**:

| Role    | Email               | Password   | Auto Confirm |
|---------|---------------------|------------|--------------|
| DOS     | dos@rukara.edu      | dos123     | Yes          |
| Teacher | teacher@rukara.edu  | teacher123 | Yes          |

Then insert the matching `profiles` / `teachers` rows from `seed-data.sql`.

## Schema Overview (tables)

`users`/`profiles`, `academic_years`, `terms`, `classes`, `subjects`, `teachers`, `learners`, `teacher_assignments`, `assessments`, `marks`, `grading_scales`, `school_settings`, `audit_logs`, `notifications`, `documents`.

### Key relationships
- `learners` — `learner_code` is the unique **student number**; links to `classes` by `class_id`.
- `teacher_assignments` — `teacher_id` + `class_id` + `subject_id` (+ year/term).
- `assessments` — `teacher_id` + `class_id` + `subject_id`; `roster_learner_ids` snapshots the roster on submission.
- `marks` — `assessment_id` + `learner_id`; UNIQUE(assessment_id, learner_id) prevents duplicate marks.

## Security

- Row Level Security enabled on every table.
- DOS role: full system access.
- Teacher role: only rows linked to their own assignments.
- Live subscriptions require Realtime enabled on the `learners`, `assessments`, `marks`, `classes`, `subjects`, `teacher_assignments` tables.

## Frontend config

The frontend `js/config.js` holds the Supabase project URL and anon key. Update it to point to your project.