# Backend — Supabase

The RMS backend is **Supabase** (fully managed PostgreSQL) — there is no separate application server. The frontend talks to Supabase directly through its REST + Realtime + Auth APIs, guarded by Row Level Security.

This folder contains everything that defines the backend.

## Structure

```
backend/
├── README.md                     # This guide
├── functions/
│   └── welcome-teacher/
│       └── main.ts               # Supabase Edge Function: sends welcome email/SMS
└── sql/
    ├── database.sql              # MASTER SETUP: complete schema + RLS + triggers + seeds (run this)
    ├── class_teacher_access.sql  # Class Teacher read access, DOS assignment RPC and audit trail
    └── clear-data.sql            # Operational utility: wipe imported data, keep logins (NOT setup)
```

> `database.sql` is the authoritative base setup. `class_teacher_access.sql` is the current
> security extension for Class Teacher access and assignment auditing. Historical migrations
> live in the root `archive/` folder (see `archive/README.md`) and should not be run.

## Setup

1. Open your Supabase project → **SQL Editor**.
2. **New query** → paste the entire `backend/sql/database.sql` → **Run**.
3. Run `backend/sql/class_teacher_access.sql` to install the Class Teacher read policies, DOS-only class assignment function, and assignment audit trigger.
4. Verify the required tables/functions/policies (checks are listed at the end of `database.sql`).
5. Start the frontend (open `frontend/index.html` or deploy to Vercel).

> All SQL is pasted and run **manually** in the SQL Editor — there is no migration runner. Prefer paste-ready queries with no placeholders.

## Authentication

Create users in Supabase → **Authentication → Users**:

| Role    | Email               | Password   | Auto Confirm |
|---------|---------------------|------------|--------------|
| DOS     | dos@rukara.edu      | dos123     | Yes          |
| Teacher | teacher@rukara.edu  | teacher123 | Yes          |

Then insert the matching `users` / `teachers` rows (the DOS accounts are created automatically
by `database.sql`; create any teacher Auth users first, then link them with the `link_auth_user`
helper defined at the end of `database.sql`).

## Schema Overview (tables)

`users`/`profiles`, `academic_years`, `terms`, `classes`, `subjects`, `teachers`, `learners`, `teacher_assignments`, `assessments`, `marks`, `grading_scales`, `school_settings`, `audit_logs`, `notifications`, `documents`, `assessment_types`, `performance_comments`.

### Key relationships
- `learners` — `learner_code` is the unique **student number**; links to `classes` by `class_id`.
- `teacher_assignments` — one row per (teacher, class, subject, academic_year, term); **multiple subjects per class are allowed** (non-unique index on teacher_id).
- `assessments` — `teacher_id` + `class_id` + `subject_id`; `roster_learner_ids` snapshots the roster on submission.
- `marks` — `assessment_id` + `learner_id`; UNIQUE(assessment_id, learner_id) prevents duplicate marks.
- `subjects.level` / class education level — Primary vs Secondary separation enforced by RLS helpers (`rms_dos_can_level`, `rms_dos_can_subject`, `rms_teacher_in_scope`).

## Security

- Row Level Security enabled and scoped by account, teacher assignment, and DOS education level.
- DOS role: full system access within its education-level scope.
- Teacher role: only rows linked to their own assignments.
- Teacher accounts carry a `teachers.education_level` of `PRIMARY`, `SECONDARY`, or `BOTH` (`users.education_level` mirrors it as `primary`, `secondary`, or `all`). RLS checks both that account level and the teacher's exact class/subject assignment before exposing academic data.
- Class Teachers: read-only class-level access for the class(es) explicitly linked through `classes.class_teacher_id`, further limited by the teacher's education level. DOS/Admin assignments use `rms_set_class_teacher_assignments`; each class has one primary Class Teacher and changes are recorded in `audit_logs`.
- Reports require one education grouping at a time (Primary or Secondary), including for a Both-level account.
- Scope helpers: `rms_is_dos`, `rms_dos_education_level`, `rms_dos_can_subject`, `rms_dos_can_level`, `rms_teacher_in_scope`, `rms_is_scoped_dos`.
- Live subscriptions require Realtime enabled on the `learners`, `assessments`, `marks`, `classes`, `subjects`, `teacher_assignments` tables.

## Frontend config

The frontend `js/config.js` holds the Supabase project URL and anon key. Update it to point to your project.
