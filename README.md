# RMS End-of-Unit Assessment Management System

## Rukara Model School — End-of-Unit Assessment Marks Management System

A professional, secure, responsive web-based marks management system built with **HTML + CSS + JavaScript + Supabase**.

---

## Technology Stack

- **Frontend:** HTML5, CSS3, Vanilla JavaScript (ES6+), Supabase JS client
- **Backend:** Supabase (PostgreSQL, Auth, RLS) — fully managed cloud backend
- **No frameworks** — pure vanilla JS

---

## Project Structure

The codebase is split into two top-level folders:

```
rms-eua/
├── frontend/                   # All client-side code (SPA)
│   ├── index.html              # Main entry point
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── config.js           # Supabase configuration (URL + anon key)
│   │   ├── auth.js             # Authentication module
│   │   ├── db.js               # Database query helpers
│   │   ├── utils.js            # Calculations, utilities
│   │   ├── router.js           # Client-side hash router
│   │   ├── app.js              # Main app initialization
│   │   ├── realtime.js         # Supabase Realtime subscriptions
│   │   ├── sync-registry.js    # Route → realtime table mappings
│   │   ├── reports.js          # Report builders (class lists, mark sheets, etc.)
│   │   ├── components/
│   │   │   ├── sidebar.js      # Sidebar navigation
│   │   │   └── ui.js           # Modal, header, content helpers
│   │   └── pages/
│   │       ├── admin-dashboard.js   # DOS dashboard
│   │       ├── admin-academic.js    # Academic years, terms, classes, subjects
│   │       ├── admin-teachers.js    # Teacher management
│   │       ├── admin-learners.js    # Learner management
│   │       ├── admin-assignments.js # Teacher assignments
│   │       ├── admin-assessments.js # Assessment CRUD + workflow
│   │       ├── admin-marks.js       # View all marks
│   │       ├── admin-reports.js     # Reports, analytics, audit, settings
│   │       ├── teacher-pages.js     # Teacher dashboard, classes, subjects, etc.
│   │       └── teacher-enter-marks.js # Mark entry with auto-calculation
│   └── public/
│       ├── logo.webp
│       └── school1.jpeg
├── backend/                    # Backend layer (Supabase)
│   ├── README.md               # Setup guide for the Supabase backend
│   └── sql/
│       ├── database.sql               # Full database schema + RLS
│       ├── seed-data.sql            # Sample data + setup guide
│       ├── rms-full-setup.sql       # One-shot full setup
│       ├── rms-run-now.sql          # Quick reference script
│       ├── rms-rls-policies.sql     # Row Level Security policies
│       ├── migration-*.sql          # Incremental migrations
│       └── performance-indexes.sql  # Performance indexes
└── README.md
```

---

## Quick Start

### 1. Backend (Supabase)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Open your project → **SQL Editor**
3. Run scripts from `backend/sql/` in this order:
   - `rms-full-setup.sql` (schema + RLS + defaults) — or `database.sql` + `migration-*.sql` individually
   - `migration-documents.sql` (Documents page — table + storage bucket)
   - `migration-academic-year-management.sql` (Academic Year Management)
   - `seed-data.sql` (optional sample data)

See `backend/README.md` for full details.

### 2. Authentication Setup

In Supabase Dashboard → **Authentication → Users → Add User**:

| Role    | Email               | Password   | Auto Confirm |
|---------|---------------------|------------|--------------|
| DOS     | dos@rukara.edu      | dos123     | Yes          |
| Teacher | teacher@rukara.edu  | teacher123 | Yes          |

Then run the corresponding INSERT statements from `backend/sql/seed-data.sql`.

### 3. Run the Application

Serve the `frontend/` folder (it is the document root):

```bash
cd frontend
python -m http.server 8000

# or
cd frontend
npx serve .

# or
cd frontend
php -S localhost:8000
```

Open http://localhost:8000

---

## Features

### DOS / Administrator
- Dashboard with stats overview
- Manage academic years, terms, classes, subjects
- Add/edit/deactivate teachers and learners (manual + Excel import)
- Assign teachers to classes and subjects
- Create, approve, reject, lock, reopen assessments
- View all marks across the system
- Generate reports with print support
- Analytics by class and subject
- Audit log tracking
- Configurable grading scale and settings (incl. assessment roster policy)

### Teacher
- Dashboard with assignments overview
- View assigned classes and subjects (live learner rosters)
- Enter marks with real-time auto-calculation (% , grade, pass/fail, remark)
- Auto-save (saves after 2 seconds of inactivity)
- Submit marks with confirmation dialog
- View submitted marks status
- Generate and print reports
- View notifications

### Security
- Supabase Row Level Security (RLS) on all tables
- Teachers can only access their own assigned assessments
- DOS has full system access
- Audit trail for all modifications

---

## How It Works

```
DOS creates assessment → DOS assigns teacher → Teacher enters marks →
System auto-calculates → Teacher saves/submits → DOS reviews →
DOS approves → Assessment locked → Reports available
```

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