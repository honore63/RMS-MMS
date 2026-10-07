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
    ├── assessment_normalization_upgrade.sql # Existing-project upgrade for normalized mark storage
    ├── user_id_fk_upgrade.sql    # Existing-project fix for auth/profile ID relinking
    ├── class_teacher_access.sql  # Class Teacher read access, DOS assignment RPC and audit trail
    ├── admin_dashboard_count_upgrade.sql # Scoped dashboard learner-count RPC
    ├── primary_subjects_catalog_upgrade.sql # Ensure all Primary curriculum subjects are available
    ├── secondary_subjects_catalog_upgrade.sql # Ensure all Secondary curriculum subjects are available
    ├── parent_student_marks_portal.sql # Public single-learner marks portal RPCs
    └── clear-data.sql            # Operational utility: wipe imported data, keep logins (NOT setup)
```

> `database.sql` is the authoritative base setup. `class_teacher_access.sql` is the current
> security extension for Class Teacher access and assignment auditing. Historical migrations
> live in the root `archive/` folder (see `archive/README.md`) and should not be run.

## Setup

1. Open your Supabase project → **SQL Editor**.
2. **New query** → paste the entire `backend/sql/database.sql` → **Run**.
3. Run `backend/sql/class_teacher_access.sql` to install the Class Teacher read policies, DOS-only class assignment function, and assignment audit trigger.
4. Run `backend/sql/admin_dashboard_count_upgrade.sql` to install the secured scoped dashboard learner-count RPC.
5. If using the public single-learner marks portal, run `backend/sql/parent_student_marks_portal.sql`.
6. Verify the required tables/functions/policies (checks are listed at the end of `database.sql`).
7. Start the frontend (open `frontend/index.html` or deploy to Vercel).

> All SQL is pasted and run **manually** in the SQL Editor — there is no migration runner. Prefer paste-ready queries with no placeholders.
> For an existing project, run `sql/assessment_normalization_upgrade.sql` to add and backfill the nullable `marks.normalized_mark` field. The original `marks.mark` value remains unchanged; `marks.percentage` remains supported as the same normalized percentage.
> If a previous setup run failed while relinking profile IDs because notifications reference `public.users`, run `sql/user_id_fk_upgrade.sql` first, then rerun `sql/database.sql`.
> For the dashboard's scoped learner total on an existing project, run `sql/admin_dashboard_count_upgrade.sql` in Supabase SQL Editor before publishing the frontend that calls it.
> On an existing project, run `sql/primary_subjects_catalog_upgrade.sql` to ensure the four Primary-only subjects and four shared subjects are active in the catalogue with the correct education levels. Primary report cards include all eight even when `class_subjects` only lists a subset.
> On an existing project, run `sql/secondary_subjects_catalog_upgrade.sql` to ensure the 21 Secondary-only subjects and four shared subjects are active in the catalogue with the correct education levels. Secondary reports show Secondary-compatible subjects and exclude Primary-only subjects, even when `class_subjects` only lists a subset.
> `database.sql` assigns the seeded level-specific subjects to Primary or Secondary, filters subject choices and academic read permissions by the selected class, and rejects cross-level class/subject links in database triggers. On an existing project, rerun the updated `database.sql` and `sql/parent_student_marks_portal.sql` so existing RPCs and policies use the same checks. The parent portal exposes approved and locked assessments only, and its report card uses the same shared card builder as admin and class-teacher reports. Existing custom subjects should have `subjects.level` or `subjects.education_level` configured correctly; existing mismatched records are hidden from views but are not deleted.

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
