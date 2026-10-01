# RMS-MIS Archive

This folder contains historical and backup project files. **It is not part of the active application.**

- Nothing here is loaded by `frontend/index.html`.
- Nothing here is deployed to Vercel or to Supabase.
- The live database setup is `backend/sql/database.sql` (production master).

## Layout

```
backend/sql/archive/
├── sql/
│   └── combined-database.sql   # Consolidated reference snapshot (see below)
├── old-migrations/
│   └── *.sql                   # All 66 original historical SQL files, preserved untouched
└── README.md                   # This file
```

There is no `backups/` folder: no database dump/backup files were found in the archive,
so no extra category was created.

## SQL Archive

`sql/combined-database.sql` (consolidated 2026-10-01)

A single consolidated reference containing the database definitions found across the
66 archived SQL files, organized in dependency order (extensions → tables → columns/
constraints → foreign keys → indexes → functions → triggers → RLS → notifications →
seeds). Duplicate `CREATE TABLE` / function / trigger / policy / index definitions were
resolved in favor of the most complete/current version — which is exactly what the
production master `backend/sql/database.sql` contains. The combined file's body is
byte-identical to that master file as of the consolidation date; only the header
banner (this provenance note) differs.

Historical files combined (all preserved in `old-migrations/`):

- 46 `migration-*.sql` files — schema, DOS education-level scope, account isolation,
  RLS policies, communication center, notification center, grading system, assessment
  types + standardization, curriculum subjects, class management, import system,
  report center/indexes, teacher welcome notifications, and incremental fixes.
- `database-schema.sql`, `rms-full-setup.sql`, `rms-run-now.sql`, `rms-rls-policies.sql`
  — early full-schema snapshots (verified: every table/function they define exists
  in the combined file).
- `performance-indexes.sql` — early index set (superset present in combined file).
- `delta-class-derived-teacher-scope.sql`, `rls-post-assessment-reports.sql` —
  superseded refinements folded into the final definitions.
- `fix-dos2-auth-identity.sql`, `fix-learner-import-code-check.sql` — one-time
  repair operations; their lasting behavior (auth identity rows, no 11-digit code
  CHECKs) is folded into the combined file.
- `verify-academic-years.sql` — old diagnostic asserting obsolete policy names;
  superseded by the verification queries at the end of the combined file.
- `delete-tuyishime.sql`, `restore-teacher-tuyishime.sql` — one-off,
  person-specific data operations (not schema; not merged, kept for history).
- `seed-data.sql` — placeholder sample-data guide (`PASTE_*_HERE` placeholders,
  fictional demo rows; not runnable as-is, not schema — not merged, kept for history).
- 7 early files (`migration-documents.sql`, `migration-fix-rls-users.sql`,
  `migration-full-crud-permissions.sql`, `migration-learner-availability.sql`,
  `migration-learner-import-rls.sql`, `migration-rejection-reason.sql`,
  `migration-school-settings.sql`) — all objects verified present in the combined file.

## Rules for this folder

- The archive is for organization and historical preservation only.
- Never point the app, deployments, or fresh database setups at files in here —
  use `backend/sql/database.sql`.
- When in doubt, preserve the original file: nothing in `old-migrations/` should be
  deleted; git history retains every version regardless.
