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
    ├── teacher_registration_users_rls.sql # Existing-project secured DOS RPC for teacher profile creation
    ├── teacher_submitted_marks_edit.sql # Allow teacher corrections before approval/locking
    ├── assessment_no_approval.sql # Make submitted results immediately reportable; remove approval/rejection transitions
    ├── analytics_marks_rls_fix.sql # Prevent nested RLS from breaking DOS analytics reads
    ├── class_teacher_access.sql  # Class Teacher read access, DOS assignment RPC and audit trail
    ├── admin_dashboard_count_upgrade.sql # Scoped dashboard learner-count RPC
    ├── learner_select_performance_upgrade.sql # Remove redundant per-row DOS learner lookup while retaining level RLS
    ├── primary_subjects_catalog_upgrade.sql # Ensure all Primary curriculum subjects are available
    ├── secondary_subjects_catalog_upgrade.sql # Ensure all Secondary curriculum subjects are available
    ├── parent_student_marks_portal.sql # Public single-learner marks portal RPCs
    ├── digital_library.sql       # Public resource library with teacher-only uploads
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
5. Run `backend/sql/learner_select_performance_upgrade.sql` to avoid redundant DOS learner lookups while retaining the existing level-scope RLS policies.
6. If using the public single-learner marks portal, run `backend/sql/parent_student_marks_portal.sql`.
7. Run `backend/sql/digital_library.sql` to create the public resource catalogue, private storage bucket with signed public-resource access, teacher assignment controls, DOS review workflow, and audit/statistics functions.
8. Verify the required tables/functions/policies (checks are listed at the end of `database.sql`).
9. Start the frontend (open `frontend/index.html` or deploy to Vercel).

> All SQL is pasted and run **manually** in the SQL Editor — there is no migration runner. Prefer paste-ready queries with no placeholders.
> On an existing project where teacher registration fails with a row-level security error, run `sql/teacher_registration_users_rls.sql` in the SQL Editor. It installs the secured `rms_register_teacher` RPC, which verifies the DOS account and education-level scope and creates both the teacher login profile and teacher record without a direct browser table upsert.
> On an existing project, run `sql/teacher_submitted_marks_edit.sql` in the SQL Editor to allow teachers to edit assessment details and marks, including on submitted or legacy-approved assessments. Locked assessments remain read-only. DOS no longer approves or rejects submissions; submitted marks are immediately available in reports and parent portals.
> On an existing project, run `sql/assessment_no_approval.sql` in the SQL Editor to block new approved/rejected status transitions while preserving old records.
> If analytics returns a 500 error while loading marks, run `sql/analytics_marks_rls_fix.sql` in the SQL Editor. It checks DOS visibility without recursively re-evaluating assessment RLS.
> For an existing project, run `sql/assessment_normalization_upgrade.sql` to add and backfill the nullable `marks.normalized_mark` field. The original `marks.mark` value remains unchanged; `marks.percentage` remains supported as the same normalized percentage.
> If a previous setup run failed while relinking profile IDs because notifications reference `public.users`, run `sql/user_id_fk_upgrade.sql` first, then rerun `sql/database.sql`.
> For the dashboard's scoped learner total on an existing project, run `sql/admin_dashboard_count_upgrade.sql` in Supabase SQL Editor before publishing the frontend that calls it.
> If learner management times out with `canceling statement due to statement timeout`, run `sql/learner_select_performance_upgrade.sql` in the Supabase SQL Editor. DOS class-level access remains enforced by the existing RLS scope policies.
> On an existing project, run `sql/primary_subjects_catalog_upgrade.sql` to ensure the four Primary-only subjects and four shared subjects are active in the catalogue with the correct education levels. Primary report cards include all eight even when `class_subjects` only lists a subset.
> On an existing project, run `sql/secondary_subjects_catalog_upgrade.sql` to ensure the 21 Secondary-only subjects and four shared subjects are active in the catalogue with the correct education levels. Secondary reports show Secondary-compatible subjects and exclude Primary-only subjects, even when `class_subjects` only lists a subset.
> `database.sql` assigns the seeded level-specific subjects to Primary or Secondary, filters subject choices and academic read permissions by the selected class, and rejects cross-level class/subject links in database triggers. On an existing project, rerun the updated `database.sql` and `sql/parent_student_marks_portal.sql` so existing RPCs and policies use the same checks. DOS reports and parent portals include submitted assessments without requiring approval or locking; the parent report card uses the same shared card builder as admin and class-teacher reports. Existing custom subjects should have `subjects.level` or `subjects.education_level` configured correctly; existing mismatched records are hidden from views but are not deleted.

The Digital Library is available at `frontend/digital-library.html`. Anyone can browse, preview, and download published files or open shared HTTPS learning links; signed-in teachers can upload files or share web links, and manage resources only for their assigned classes or subjects. Link-only resources are opened in a separate tab and are not indexed by RMS AI. DOS users have an education-level-scoped dashboard for review, publishing, returning, archiving, and resource statistics. Uploaded files are private in Storage and public downloads use short-lived signed links. File uploads are limited to 25 MB.

Run `sql/digital_library.sql` in Supabase before deploying the library frontend. Every teacher upload is published immediately and becomes visible in the public library, regardless of resource category or the legacy `digital_library_settings.require_review` value. A single upload assigned to multiple classes is shown as one public card with all class names listed. DOS users can subsequently review, return, or archive resources within their education-level scope. If a teacher edits a returned resource, it is republished immediately.

### RMS AI Learning Assistant

The public library's Ask RMS AI experience uses the `digital-library-ai` and `digital-library-index` Supabase Edge Functions. Run the updated `sql/digital_library.sql` migration first; it enables pgvector, creates the private chunk/embedding index, adds the DOS AI enable switch and scoped usage statistics, and configures Storage read policies. Both functions verify published, public, AI-enabled resources through the caller's RLS context before processing files; retrieval is restricted to the resource IDs selected by the learner and rechecks current publication/AI settings in the database.

When a supported resource is uploaded, RMS AI extracts text, splits it into chunks, creates Gemini embeddings, and stores them with their source resource and section. Older resources are indexed on first use if still authorized. Questions are embedded and matched against only the selected resources; the answer cites retrieved resources and available section labels. DOS can disable the assistant globally or exclude individual resources. Questions and answers are not stored.

AI indexing currently supports PDF, TXT, JPEG, PNG, and WebP files up to 12 MiB per resource and 100,000 extracted characters. Text files use direct UTF-8 extraction; PDFs and images use Gemini text extraction/OCR. Office documents, video/audio transcription, and teacher-private AI conversations are not supported yet; those files remain available for normal library viewing/download. The service atomically limits each authenticated user or anonymous requester to 30 questions/hour and 300/day; anonymous requester identifiers are hashed before storage.

**Important:** Run only `backend/sql/digital_library.sql` in the Supabase Dashboard's SQL Editor. The commands below are PowerShell/terminal commands, not SQL; run them in a terminal opened at the repository root (the folder containing `supabase/`), not in the SQL Editor.

The function sources live under `supabase/functions/` so the Supabase CLI can bundle their shared `_shared/rms-ai.ts` module. From the repository root, authenticate and link the CLI to the RMS project, then deploy:

```powershell
supabase login
supabase link --project-ref ztlfidglxfwjpxkqfviy
supabase functions deploy digital-library-ai
supabase functions deploy digital-library-index
supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

The project config enables JWT verification for both functions. The browser call includes the Supabase anon key as its bearer token; resource permissions are still checked through the user's RLS context inside the function. Keep the Gemini key and Supabase service-role key in Edge Function secrets only; never add either to frontend code. The service-role client is used only for rate-limited usage logging and restricted RPCs that store/retrieve chunks after the caller's RLS check. DOS can enable/disable the assistant, manage per-resource AI access, and view scoped usage statistics from the library dashboard. Deploy the updated frontend after the SQL and Edge Functions are ready. If a key is missing, the functions return a configuration error rather than exposing a provider key or silently switching providers.

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
