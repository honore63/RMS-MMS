<p align="center">
  <img src="frontend/public/logo.webp" alt="RMS-MIS Logo" width="120" />
</p>

<h1 align="center">RMS-MIS – Rukara Model School Marks Information System</h1>

<p align="center">
  A professional, secure, responsive web application built with
  <strong>HTML5 + CSS3 + Vanilla JavaScript + Supabase</strong>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/frontend-vanilla%20JS-blue" alt="Frontend" />
  <img src="https://img.shields.io/badge/backend-supabase--postgres-3ecf8e" alt="Supabase" />
  <img src="https://img.shields.io/badge/security-RLS%20enforced-red" alt="RLS" />
  <img src="https://img.shields.io/badge/deploy-vercel-green" alt="Vercel" />
</p>

---

## Table of Contents

1. [Overview](#overview)
2. [Logo & Branding](#logo--branding)
3. [Technology Stack](#technology-stack)
4. [Project Structure](#project-structure)
5. [Quick Start](#quick-start)
6. [Features](#features)
7. [Teacher Welcome Notifications](#teacher-welcome-notifications)
8. [Roles & Permissions](#roles--permissions)
9. [How It Works](#how-it-works)
10. [Data Caching & Performance](#data-caching--performance)
11. [Security](#security)
12. [Reporting](#reporting)
13. [Realtime Sync](#realtime-sync)
14. [Deployment](#deployment)
15. [Development Notes](#development-notes)
16. [Database Schema Overview](#database-schema-overview)
17. [Browser Support](#browser-support)
18. [License](#license)

---

## Overview

RMS-MIS manages end-of-unit assessment marks for Rukara Model School. It covers the full lifecycle:

- Teacher registration with automatic welcome email & SMS
- Class/subject assignment (multi-subject per class)
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
| Favicon | `frontend/public/favicon.svg` |
| School photo | `frontend/public/school1.jpeg` |

School name, motto, address, phone, email, and logo URL are configurable at runtime via **Admin → Settings** (`school_settings` table). The login screen and official report headers read from these settings.

---

## Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | HTML5, CSS3, Vanilla JavaScript ES6+, Supabase JS Client, Lucide icons |
| Backend | Supabase (PostgreSQL, Auth, RLS, Realtime) — fully managed |
| Charts | In-house SVG chart primitives (`charts.js`) |
| Imports | SheetJS (xlsx) for Excel/CSV |
| Build step | **None** — pure vanilla JS, edit and refresh |
| Deployment | Vercel (automatic from `origin/main`) |

---

## Project Structure

```
rms-eua/
├── frontend/                       # All client-side code (SPA)
│   ├── index.html                  # Main entry point and CSP
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
│   │   ├── welcome-notification.js # Welcome email & SMS service
│   │   ├── charts.js               # SVG chart primitives
│   │   ├── analytics-engine.js     # Analytics aggregation
│   │   ├── grading-engine.js       # Grading scale engine
│   │   ├── import-system.js        # Excel import core
│   │   ├── marks-import.js         # Marks spreadsheet import
│   │   ├── components/
│   │   │   ├── sidebar.js          # Sidebar nav + profile chip
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
│   │       ├── admin-dashboard.js      # DOS dashboard
│   │       ├── admin-teachers.js       # Teacher management + registration
│   │       ├── admin-classes.js        # Class management
│   │       ├── admin-subjects.js       # Subject CRUD
│   │       ├── admin-assignments.js    # Assignments
│   │       ├── admin-assessments.js    # Assessment CRUD + workflow
│   │       ├── admin-assessment-types.js # Configurable assessment types
│   │       ├── admin-marks.js          # View all marks
│   │       ├── admin-reports.js        # Report Center hub
│   │       ├── admin-audit-logs.js     # Audit trail viewer
│   │       ├── admin-settings.js       # School settings
│   │       ├── teacher-pages.js        # Teacher dashboard, classes, subjects
│   │       ├── teacher-enter-marks.js  # Mark entry + auto-save + submit
│   │       └── teacher-account.js      # Teacher account settings
│   └── public/
│       ├── logo.webp               # Application logo
│       ├── favicon.svg             # Favicon
│       └── school1.jpeg            # School photo
├── backend/
│   ├── README.md                   # Supabase setup guide
│   ├── sql/
│   │   ├── database.sql            # MASTER setup: full schema + RLS + triggers + seeds (run this)
│   │   └── clear-data.sql          # Operational utility: wipe imported data, keep logins
│   └── functions/
│       └── welcome-teacher/
│           └── main.ts             # Supabase Edge Function: sends welcome email/SMS
├── api/
│   └── reports/
│       └── pdf.js                  # Vercel serverless PDF endpoint (must stay at root for routing)
├── archive/                        # Historical reference only (see archive/README.md)
├── tests/
│   └── calculation-check.test.js   # Calculation tests (run: node --test tests/)
├── vercel.json                     # Vercel deployment config (rewrites + headers)
├── .gitignore                      # Git ignore rules
└── README.md                       # This file
```

---

## Quick Start

### 1. Backend (Supabase)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**
2. Run the master setup file (creates the complete database, idempotent — safe to re-run):

   ```sql
   -- Paste and run the whole file:
   -- backend/sql/database.sql
   ```

3. Verify tables:

   ```sql
   SELECT 'users' AS table_name, COUNT(*) FROM users
   UNION ALL SELECT 'teachers', COUNT(*) FROM teachers
   UNION ALL SELECT 'email_notifications', COUNT(*) FROM email_notifications
   UNION ALL SELECT 'sms_notifications', COUNT(*) FROM sms_notifications;
   ```

### 2. Deploy to Vercel

The app is deployed at `https://rms-p3owfjjev-honore63s-projects.vercel.app/`. Push to `origin/main` triggers automatic deployment.

```bash
git add .
git commit -m "your message"
git push origin main
```

### 3. Run Locally

Serve the `frontend/` folder (it is the document root):

```bash
cd frontend
python -m http.server 8000
# or
npx serve .
```

Open http://localhost:8000

> **Cache busting:** script tags in `index.html` use `?v=YYYYMMDD-N`. After any JS/CSS change, bump the version and hard-refresh with `Ctrl+Shift+R`.

---

## Features

### DOS / Administrator
- Dashboard with stats overview and education-level scope filter
- Manage academic years, terms, classes, subjects (level-aware CRUD with FK-usage delete guard)
- Add/edit/deactivate teachers and learners (manual + Excel import)
- Assign teachers to classes with **multiple subjects per class**
- Create, approve, reject, lock, reopen assessments (single-page modals, validations)
- Manage configurable assessment types with weights
- View all marks across the system (filter by education level / assessment type)
- **Report Center** — categorized hub of 11+ report types with print-identical preview, Excel/PDF export
- Student report card: compact/ultra density tables, charts, landscape orientation
- Analytics by class and subject
- Audit log tracking
- Configurable grading scale and settings

### Teacher
- Dashboard with assignments and pending/approved/rejected assessment stats
- View assigned classes and subjects (live learner rosters)
- Enter marks with real-time auto-calculation (%, grade, pass/fail, remark)
- Auto-save (saves after 2 seconds of inactivity)
- Submit marks with confirmation dialog
- View submitted marks status
- Generate and print reports
- View notifications
- Account settings (name, profile photo)
- **Welcome Email & SMS** — automatic on registration

---

---

## Teacher Welcome Notifications

When a DOS successfully registers a new teacher, the system automatically sends professional welcome messages:

### Email (HTML)
- **Subject**: `Welcome to RMS-MIS – Your Teacher Account Has Been Created`
- **Content**:
  - Welcome message confirming successful registration
  - Teacher's full name, email, temporary password link
  - Classes assigned, subjects assigned, education level
  - RMS-MIS login link
  - Clear instructions for starting to record and submit marks
  - Support/contact information (school name, email, phone, website)
  - Rukara Model School branding with logo

### SMS
- **Message**: Shorter version with teacher name, email, classes, subjects, login link

### Security Requirements
- Never expose passwords in application logs or audit logs
- Prefer sending a secure password-setup link instead of permanent password
- If temporary password sent, force teacher to change it on first login
- Only send credentials to verified email/phone from registration
- Record notification delivery status (sent/failed/pending)
- Show DOS a clear warning if delivery fails

### Registration Success Modal
After registration, DOS sees:
```
✓ Teacher Registered Successfully
  Email: Sent ✓
  SMS: Sent ✓

[Resend Email] | [Resend SMS]
```

### Database Tables
- `email_notifications` — tracks email delivery
- `sms_notifications` — tracks SMS delivery
- `teacher_registration_audit` — links registration to welcome delivery
- `notifications` — system notification for DOS

### Triggers
- `trg_teacher_registration_audit` — auto-creates audit record on teacher insert
- `trg_teacher_registration_log` — auto-creates audit log entry

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
| Receive welcome email/SMS | ✅ (sends) | ❌ |
| Manage welcome notifications | ✅ (resend) | ❌ |

---

## How It Works

```
DOS creates assessment → DOS assigns teacher → Teacher enters marks →
System auto-calculates → Teacher saves/submits → DOS reviews →
DOS approves → Assessment locked → Reports available

DOS registers teacher → System sends welcome email & SMS →
Teacher logs in → Forced password change → Ready to enter marks
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
| `teacher_registration_audit`, `email_notifications`, `sms_notifications` | 10 min |
| `assessments` | 2 min |
| `marks`, `audit_logs`, `import_history` | 1 min |
| `notifications` | 30 s |
| Default | 5 min |

- **Stale-while-revalidate** applies only to reference/config tables — never marks, assessments, notifications, or audit logs.
- **Cache keys** include table, user scope, select, filters, order, and limit.
- **Request deduplication** — five simultaneous calls share one Supabase request.
- **User isolation** — cache is scoped by auth user; `DB.clearUserCache()` on login/logout.
- **RLS remains authoritative** — caching never bypasses Row Level Security.

### Cache API

```javascript
DB.get(table, filters, opts)        // cache-first read
DB.query(table, select, filters, order, limit, opts)
DB.getFresh(table, filters)         // force network read
DB.invalidate(table)                // drop one table
DB.invalidateMany([t1, t2])         // drop several
DB.clearUserCache()                 // drop on auth change
DB.getStats()                       // hits, misses, size, pending
DB.warm(['classes','subjects',…])   // background prewarm
DB.debug = true                     // enable [CACHE HIT/MISS/…] logs
```

After any **raw** `sbClient` write, call `DB.invalidate(tableName)`.

---

## Security

- Supabase Row Level Security (RLS) on all tables
- Teachers can only access their own assigned assessments and classes
- DOS education-level scope helpers enforce Primary/Secondary separation
- **Welcome notifications**: passwords never logged, secure setup links preferred
- Audit trail for all modifications (teacher registration, mark changes, assessments)
- **CSP**: Content Security Policy allows external scripts (`unpkg.com`, `cdn.jsdelivr.net`) and inline execution
- No passwords or tokens stored in application caches

---

## Reporting

- Report Center hub with category navigation and stat pills
- Preview toolbar: Close · Excel · Print · PDF
- Print output matches preview exactly (same HTML/CSS)
- Page numbering in `ReportCenter.printDocument`
- Landscape orientation for wide tables
- Density modes: normal / compact / ultra
- Official letterhead from `school_settings`
- Critical report-card generation uses `DB.getFresh('marks', …)` to force a live read

---

## Realtime Sync

- **One** Supabase channel (`rms-realtime-sync`) subscribes to all shared tables
- Events fan out to registered handlers **and** invalidate the affected table's cache
- Route → table mappings (`sync-registry.js`) re-render only the active page
- Shared tables include: `users`, `teachers`, `learners`, `classes`, `subjects`, `academic_years`, `terms`, `teacher_assignments`, `assessments`, `assessment_types`, `marks`, `grading_scales`, `school_settings`, `notifications`, `announcements`, `messages`, `announcement_acknowledgements`, `audit_logs`, `teacher_registration_audit`, `email_notifications`, `sms_notifications`

---

## Deployment

- **Platform**: Vercel
- **URL**: `https://rms-p3owfjjev-honore63s-projects.vercel.app/`
- **Branch**: `origin/main`
- **Auto-deploy**: Push to `main` triggers Vercel build
- **Config**: `vercel.json` handles rewrites, cache headers, and CORS
- **Cache**: `index.html` has `Cache-Control: no-store` for fresh deploys
- **Static files**: `public/` served with `Cache-Control: public, max-age=31536000, immutable`

### Vercel Configuration (`vercel.json`)
- Catch-all rewrite: `/(.*)` → `/frontend/$1`
- Public files: `/public/(.*)` → `/frontend/public/$1`
- `index.html`: `Cache-Control: no-store`
- Static assets: long-term caching

---

## Development Notes

- **No build step** — edit files directly; validate JS with brace/paren balance checks
- **DB cache** — after any raw `sbClient` write call `DB.invalidate(tableName)`
- **Cache busting** — bump `?v=` in `frontend/index.html` for every edited JS/CSS file; hard-refresh `Ctrl+Shift+R`
- **SQL** — paste-ready queries only (no placeholders); run manually in Supabase SQL Editor
- **Git** — commit/push only on explicit request; remote: `https://github.com/honore63/RMS-MMS.git`
- **Debug cache** — in browser console: `DB.debug = true; DB.getStats()`
- **CSP** — if external scripts fail, check `Content-Security-Policy` meta tag
- **Supabase auth** — 400 errors on token refresh = expired session; sign out and sign back in

---

## Database Schema Overview

**Core Tables:** `users`, `academic_years`, `terms`, `classes`, `subjects`, `teachers`, `learners`, `teacher_assignments`, `assessments`, `assessment_types`, `marks`, `grading_scales`, `school_settings`, `audit_logs`, `notifications`, `documents`, `performance_comments`

**Notification Tables:** `email_notifications`, `sms_notifications`, `teacher_registration_audit`, `announcements`, `announcement_acknowledgements`

### Key relationships
- `learners` — `learner_code` unique student number; links to `classes` by `class_id`
- `teacher_assignments` — one row per (teacher, class, subject, academic_year, term); **multiple subjects per class allowed**
- `assessments` — `teacher_id` + `class_id` + `subject_id`; `roster_learner_ids` snapshots the roster on submission
- `marks` — UNIQUE(assessment_id, learner_id) prevents duplicates
- `teacher_registration_audit` — links teacher registration to welcome email/SMS delivery

---

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

---

## License

Private — Rukara Model School
