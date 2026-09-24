<p align="center">
  <img src="frontend/public/logo.webp" alt="RMS-MIS Logo" width="120" />
</p>

<h1 align="center">RMS-MIS – Rukara Model School Marks Information System</h1>

<p align="center">
  A professional, secure, responsive web-based marks management system built with
  <strong>HTML5 + CSS3 + Vanilla JavaScript + Supabase</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/frontend-vanilla%20JS-blue" alt="Frontend" />
  <img src="https://img.shields.io/badge/backend-supabase--postgres-3ecf8e" alt="Supabase" />
  <img src="https://img.shields.io/badge/security-RLS%20enforced-red" alt="RLS" />
  <img src="https://img.shields.io/badge/license-private-green" alt="License" />
</p>

---

## Table of Contents

1. [Overview](#overview)
2. [Logo & Branding](#logo--branding)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Quick Start](#quick-start)
6. [Features](#features)
7. [Roles & Permissions](#roles--permissions)
8. [How It Works](#how-it-works)
9. [Data Caching & Performance](#data-caching--performance)
10. [Security](#security)
11. [Reporting](#reporting)
12. [Realtime Sync](#realtime-sync)
13. [Development Notes](#development-notes)
14. [Database Schema Overview](#database-schema-overview)
15. [Browser Support](#browser-support)
16. [License](#license)

---

## Overview

RMS-MIS manages end-of-unit assessment marks for Rukara Model School. It covers the full lifecycle:

- Teacher registration and class/subject assignment (multi-subject per class)
- Configurable assessments (quiz, assignment, EOU, exam) with weights
- Mark entry with real-time auto-calculation, auto-save, and submission workflow
- DOS approval → lock/reopen
- Report Center: student report cards, class lists, mark sheets, analytics, school-wide reports
- Print-identical previews with Excel/PDF export

The system runs as a pure client-side SPA talking directly to Supabase (PostgreSQL, Auth, RLS, Realtime). There is no application server.

---

## Logo & Branding

| Asset | Path |
|-------|------|
| App logo | `frontend/public/logo.webp` |
| School photo | `frontend/public/school1.jpeg` |
| Backend image asset | `backend/sql/Image/school1.jpeg` |

School name, motto, address, phone, email, and logo URL are configurable at runtime via **Admin → Settings** (`school_settings` table). The login screen and official report headers read from these settings.

To set a custom logo:

1. Upload the image (or use a public URL)
2. Set `school_settings.logo_url`
3. The login page and report letterhead update automatically

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5, CSS3, Vanilla JavaScript ES6+, Supabase JS Client |
| Backend | Supabase (PostgreSQL, Auth, RLS, Realtime) — fully managed |
| Charts | In-house SVG chart primitives (`charts.js`) |
| Imports | SheetJS (xlsx) for Excel/CSV |
| Icons | Lucide |
| Build step | **None** — pure vanilla JS, edit and refresh |

---

## Project Structure

```
rms-eua/
├── frontend/                       # All client-side code (SPA)
│   ├── index.html                  # Main entry point (script order + cache versions)
│   ├── css/
│   │   └── styles.css              # Full design system + page styles
│   ├── js/
│   │   ├── config.js               # Supabase URL + anon key
│   │   ├── auth.js                 # Auth (login, profile, teacher row recovery)
│   │   ├── db.js                   # Centralized data-access + cache layer
│   │   ├── utils.js                # Calculations, EducationLevels, Scope helpers
│   │   ├── router.js               # Client-side hash router
│   │   ├── app.js                  # App init, routes, year selector, warm-up
│   │   ├── realtime.js             # Single-channel Supabase Realtime manager
│   │   ├── sync-registry.js        # Route → tables + targeted cache invalidation
│   │   ├── charts.js               # SVG chart primitives
│   │   ├── analytics-engine.js     # Analytics aggregation
│   │   ├── grading-engine.js       # Grading scale engine
│   │   ├── import-system.js        # Excel import core
│   │   ├── marks-import.js         # Marks spreadsheet import
│   │   ├── components/
│   │   │   ├── sidebar.js          # Sidebar nav + profile chip (photo, name, role)
│   │   │   └── ui.js               # Modal, header, content helpers
│   │   ├── reports/                # Report engine (print-identical previews)
│   │   │   ├── report-engine.js    # Orchestrates report types
│   │   │   ├── report-wizard.js    # Report Center wizard + preview map
│   │   │   ├── report-templates.js # HTML templates per report type
│   │   │   ├── report-header.js    # Official letterhead + signature blocks
│   │   │   ├── report-student.js   # Student report card renderer
│   │   │   ├── report-comments.js  # Performance comments bank
│   │   │   └── report-utils.js     # Orientation, charts, page-fit helpers
│   │   └── pages/
│   │       ├── admin-dashboard.js      # DOS dashboard (scope filter, stats)
│   │       ├── admin-academic.js       # Academic years, terms
│   │       ├── admin-classes.js        # Class management (level grouping)
│   │       ├── admin-subjects.js       # Subject CRUD (level-aware, FK guard)
│   │       ├── admin-teachers.js       # Teacher management (filters, avatars)
│   │       ├── admin-learners.js       # Learners (manual + Excel import)
│   │       ├── admin-assignments.js    # Assignments (multi-subject per class)
│   │       ├── admin-assessments.js    # Assessment CRUD + workflow
│   │       ├── admin-assessment-types.js # Configurable types (weights)
│   │       ├── admin-marks.js          # View all marks (level filter)
│   │       ├── admin-reports.js        # Report Center hub (11+ types)
│   │       ├── admin-report-card.js    # Report card generation
│   │       ├── admin-grading.js        # Grading scales / pass mark
│   │       ├── admin-audit-logs.js     # Audit trail viewer
│   │       ├── admin-settings.js       # School settings
│   │       ├── analytics.js            # Analytics by class/subject
│   │       ├── teacher-pages.js        # Teacher dashboard, classes, subjects
│   │       ├── teacher-enter-marks.js  # Mark entry + auto-save + submit
│   │       └── teacher-account.js      # Teacher account settings
│   └── public/
│       ├── logo.webp               # Application logo
│       └── school1.jpeg            # School photo
├── backend/
│   ├── README.md                   # Supabase setup guide
│   └── sql/
│       ├── database.sql            # Full schema + RLS
│       ├── seed-data.sql           # Sample data + setup guide
│       ├── rms-full-setup.sql      # One-shot full setup
│       ├── rms-run-now.sql         # Quick reference script
│       ├── rms-rls-policies.sql    # Row Level Security policies
│       ├── migration-*.sql         # Incremental migrations
│       └── performance-indexes.sql # Performance indexes
├── api/
│   └── reports/                    # Optional serverless PDF/ZIP endpoints
└── README.md
```

---

## Quick Start

### 1. Backend (Supabase)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
2. Run scripts from `backend/sql/` in this order:

   | # | Script | Purpose |
   |---|--------|---------|
   | 1 | `rms-full-setup.sql` | Schema + RLS + defaults (or `database.sql` + migrations) |
   | 2 | `migration-documents.sql` | Documents page + storage bucket |
   | 3 | `migration-academic-year-management.sql` | Academic year lifecycle |
   | 4 | `migration-marks-import.sql` | Marks Excel import |
   | 5 | `migration-rms-mis-assessment-flexibility.sql` | Configurable assessment types |
   | 6 | `migration-rms-mis-rls.sql` | Scoped RLS (types/assessments/assignments) |
   | 7 | `migration-dos-education-level-scope.sql` | DOS Primary/Secondary scope helpers |
   | 8 | `migration-subject-levels.sql` | `subjects.level` (Both/Primary/Secondary/…) |
   | 9 | `migration-education-level-class-grouping.sql` | Class → education level grouping |
   | 10 | `migration-assignments-multi-subject-per-class.sql` | Multi-subject assignments |
   | 11 | `migration-users-profile-photo.sql` | Profile photos + account name fixes |
   | 12 | `migration-performance-comments.sql` | Performance comments bank |
   | 13 | `migration-report-wizard-indexes.sql` | Report performance indexes |
   | 14 | `seed-data.sql` | Optional sample data |

> SQL migrations are pasted and run **manually** in the SQL Editor — there is no migration runner. Prefer paste-ready queries with no placeholders.

### 2. Authentication Setup

In Supabase → **Authentication → Users → Add User**:

| Role    | Email               | Password   | Auto Confirm |
|---------|---------------------|------------|--------------|
| DOS     | dos@rukara.edu      | dos123     | Yes          |
| Teacher | teacher@rukara.edu  | teacher123 | Yes          |

Then insert matching `users` / `teachers` rows from `seed-data.sql`. Set real names/photo with the UPDATE examples in `migration-users-profile-photo.sql`.

### 3. Run the Application

Serve the `frontend/` folder (it is the document root):

```bash
cd frontend
python -m http.server 8000

# or
npx serve .

# or
php -S localhost:8000
```

Open http://localhost:8000

> **Cache busting:** script tags in `index.html` use `?v=YYYYMMDD-N`. After any JS/CSS change, bump the version and hard-refresh with `Ctrl+Shift+R`.

---

## Features

### DOS / Administrator
- Dashboard with stats overview and education-level scope filter
- Manage academic years, terms, classes, subjects (level-aware CRUD with FK-usage delete guard)
- Add/edit/deactivate teachers and learners (manual + Excel import)
- Assign teachers to classes with **multiple subjects per class** (select-all subject picker, grouped assignment cards)
- Create, approve, reject, lock, reopen assessments (single-page modals, validations)
- Manage configurable assessment types (quiz, assignment, EOU, exam, …) with weights
- View all marks across the system (filter by education level / assessment type)
- **Report Center** — categorized hub of 11+ report types with print-identical preview, page numbering, Excel and PDF export
- Student report card: compact/ultra density tables, charts, landscape orientation, one-page print fit
- Analytics by class and subject
- Audit log tracking
- Configurable grading scale and settings (incl. assessment roster policy)
- Profile chip with photo, full name, and role in the sidebar

### Teacher
- Dashboard with assignments and pending/approved/rejected assessment stats (all assigned levels — no scope filter)
- View assigned classes and subjects (live learner rosters)
- Enter marks with real-time auto-calculation (%, grade, pass/fail, remark)
- Auto-save (saves after 2 seconds of inactivity)
- Submit marks with confirmation dialog
- View submitted marks status
- Generate and print reports
- View notifications
- Account settings (name, profile photo)

### Report Types (11+)
Student report card · Class performance · Class ranking · Subject performance · Student performance · Exam/class summary · Missing marks · Teacher performance · School performance · Grade distribution · Class lists / mark sheets

---

## Roles & Permissions

| Capability | DOS | Teacher |
|------------|-----|---------|
| Manage years/terms/classes/subjects | ✅ | ❌ |
| Manage teachers/learners | ✅ | ❌ |
| Create/approve/lock assessments | ✅ | Enter & submit own marks only |
| View all marks | ✅ (scoped by level) | Own assignments only |
| Generate all reports | ✅ | Own classes/subjects |
| Audit logs | ✅ | ❌ |

---

## How It Works

```
DOS creates assessment → DOS assigns teacher → Teacher enters marks →
System auto-calculates → Teacher saves/submits → DOS reviews →
DOS approves → Assessment locked → Reports available
```

---

## Data Caching & Performance

All Supabase reads go through the centralized `DB` layer in `frontend/js/db.js`. Pages do **not** open independent caches.

### Strategy

| Path | Behavior |
|------|----------|
| First visit | Cache MISS → Supabase → cache → UI |
| Subsequent navigation | Cache HIT → UI immediately |
| Slightly stale (reference data) | Serve cached → revalidate in background (SWR) |
| Expired / critical data | Fresh Supabase read → cache → UI |
| Write | Supabase write → `DB.invalidate(table)` → UI refresh |
| Realtime event | Targeted `DB.invalidate(table)` → only affected data refreshes |

### TTL Values

| Dataset | TTL |
|---------|-----|
| `school_settings`, `grading_scales`, `academic_years`, `terms`, `assessment_types` | 30 min |
| `subjects`, `classes`, `teachers`, `performance_comments` | 10 min |
| `users`, `learners`, `teacher_assignments`, `documents` | 5 min |
| `assessments` | 2 min |
| `marks`, `audit_logs`, `import_history` | 1 min |
| `notifications` | 30 s |
| Default | 5 min |

- **Stale-while-revalidate** applies only to reference/config tables — never marks, assessments, notifications, or audit logs.
- **Cache keys** include table, user scope, select, filters, order, and limit (different queries never collide).
- **Request deduplication** — five simultaneous `getSubjects()` calls share one Supabase request.
- **User isolation** — cache is scoped by auth user; `DB.clearUserCache()` runs on login/logout so one user never sees another’s data.
- **RLS remains authoritative** — caching never bypasses Row Level Security.

### Cache API

```javascript
DB.get(table, filters, opts)        // cache-first read
DB.getCached(table, filters)        // alias of get
DB.query(table, select, filters, order, limit, opts)
DB.getFresh(table, filters)         // force network read (still stores result)
DB.invalidate(table)                // drop one table
DB.invalidateMany([t1, t2])         // drop several
DB.refresh(table)                   // alias: invalidate + next read is fresh
DB.clear()                          // drop everything
DB.clearUserCache()                 // drop on auth change
DB.has(table)                       // does table have cached entries?
DB.getStats()                       // hits, misses, size, pending, per-table counts
DB.warm(['classes','subjects',…])   // background prewarm
DB.debug = true                     // enable [CACHE HIT/MISS/…] console logs
```

After any **raw** `sbClient` write, call `DB.invalidate(tableName)` or screens will show stale data.

---

## Security

- Supabase Row Level Security (RLS) on all tables
- Teachers can only access their own assigned assessments and classes
- DOS education-level scope helpers: `rms_is_dos`, `rms_dos_education_level`, `rms_dos_can_level`, `rms_dos_can_subject`, `rms_teacher_in_scope`, `rms_is_scoped_dos`
- **Primary learners/classes get Primary subjects only; Secondary get Secondary only** — enforced at the data/RLS layer *and* frontend (`Scope.matchesSubject`)
- Audit trail for all modifications
- Flexible assessments & report types filtered per-role through scoped RLS policies
- No passwords or tokens stored in application caches

---

## Reporting

- Report Center hub with category navigation and stat pills
- Preview toolbar: Close · Excel · Print · PDF
- Print output matches preview exactly (same HTML/CSS)
- Page numbering in `ReportCenter.printDocument`
- Landscape orientation for wide tables
- Density modes: normal / compact / ultra (width + subject-count driven)
- Official letterhead from `school_settings` (blank signature boxes for DOS lines)
- Critical final report-card generation uses `DB.getFresh('marks', …)` to force a live read

---

## Realtime Sync

- **One** Supabase channel (`rms-realtime-sync`) subscribes to all shared tables
- Events fan out to registered handlers **and** invalidate the affected table’s cache
- Route → table mappings (`sync-registry.js`) re-render only the active page
- Enter-marks route is guarded so the page never rebuilds mid-entry
- Marks/assessment events also reset Report Utils and Analytics Engine contexts

Shared tables: `users`, `teachers`, `learners`, `classes`, `subjects`, `academic_years`, `terms`, `teacher_assignments`, `assessments`, `assessment_types`, `marks`, `grading_scales`, `school_settings`, `notifications`, `audit_logs`.

---

## Development Notes

- **No build step** — edit files directly; validate JS with brace/paren balance checks if Node is unavailable
- **DB cache** — after any raw `sbClient` write call `DB.invalidate(tableName)`
- **Cache busting** — bump `?v=` in `frontend/index.html` for every edited JS/CSS file; hard-refresh `Ctrl+Shift+R`
- **SQL** — paste-ready queries only (no placeholders); run manually in Supabase SQL Editor
- **Git** — commit/push only on explicit request; remote: `https://github.com/honore63/RMS-MMS.git`
- **Debug cache** — in browser console: `DB.debug = true; DB.getStats()`

---

## Database Schema Overview

**Tables:** `users`, `academic_years`, `terms`, `classes`, `subjects`, `teachers`, `learners`, `teacher_assignments`, `assessments`, `assessment_types`, `marks`, `grading_scales`, `school_settings`, `audit_logs`, `notifications`, `documents`, `performance_comments`, `import_history`.

### Key relationships
- `learners` — `learner_code` unique student number; links to `classes` by `class_id`
- `teacher_assignments` — one row per (teacher, class, subject, academic_year, term); **multiple subjects per class allowed**
- `assessments` — `teacher_id` + `class_id` + `subject_id`; `roster_learner_ids` snapshots the roster on submission
- `marks` — UNIQUE(assessment_id, learner_id) prevents duplicates
- `subjects.level` / class education level — Primary vs Secondary separation enforced by RLS helpers

---

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile browsers (iOS Safari, Android Chrome)

---

## License

Private — Rukara Model School
