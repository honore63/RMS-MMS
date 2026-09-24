/* ============================================================
   SYNC REGISTRY — Route → table dependencies + targeted handlers
   Keeps every page in sync with Supabase in real time:
     • Route mappings tell Realtime which tables each route reads,
       so the active page auto-refreshes when shared data changes.
     • Targeted handlers handle in-place updates that must not wipe
       the whole page (settings caches, marks-entry lock/reject,
       unread notification badge).
   ============================================================ */

(async () => {
  if (typeof Realtime === 'undefined') return;

  /* ---------- Route → tables (full-page auto refresh) ---------- */
  Realtime.route('admin/dashboard', ['learners', 'teachers', 'classes', 'assessments', 'marks']);
  Realtime.route('admin/academic', ['academic_years', 'terms', 'classes', 'subjects']);
  Realtime.route('admin/teachers', ['teachers', 'users', 'classes']);
  Realtime.route('admin/learners', ['learners', 'classes']);
  Realtime.route('admin/assignments', ['teacher_assignments', 'teachers', 'classes', 'subjects', 'academic_years', 'terms']);
  Realtime.route('admin/assessments', ['assessments', 'assessment_types', 'teacher_assignments', 'marks', 'teachers', 'academic_years', 'terms']);
  Realtime.route('admin/assessment-types', ['assessment_types', 'assessments']);
  Realtime.route('admin/marks', ['assessments', 'assessment_types', 'marks', 'learners', 'teachers', 'classes']);
  Realtime.route('admin/reports', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/reports/cards', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/reports/class', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/reports/subject', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/reports/student', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/reports/assessment', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/reports/school', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
Realtime.route('admin/analytics', ['assessments', 'marks', 'learners', 'classes', 'subjects', 'grading_scales']);
   Realtime.route('admin/audit-logs', ['audit_logs']);
  Realtime.route('admin/settings', ['school_settings', 'grading_scales']);

  Realtime.route('teacher/dashboard', ['teacher_assignments', 'assessments', 'marks', 'classes', 'notifications']);
  Realtime.route('teacher/my-classes', ['learners', 'classes', 'teacher_assignments']);
  Realtime.route('teacher/my-subjects', ['subjects', 'teacher_assignments']);
  Realtime.route('teacher/submitted-marks', ['assessments', 'marks']);
  Realtime.route('teacher/reports', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);

  /* Marks entry: refresh the list live, but NEVER rebuild the page
     while the teacher is actively entering marks (guarded below). */
  Realtime.route('teacher/enter-marks', ['teacher_assignments', 'assessments', 'academic_years', 'terms', 'learners'], () => {
    return typeof marksView === 'undefined' || marksView !== 'entry';
  });

Realtime.route('teacher/analytics', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'teacher_assignments', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
   Realtime.route('teacher/notifications', ['notifications']);

  /* ---------- Targeted in-place updates ---------- */

  /* Every marks/assessment change must invalidate all data caches
      so Analytics, Reports, DOS dashboards and teacher views see fresh
      marks immediately — no 5-minute stale DB cache. */
  Realtime.on('marks', () => {
    DB.invalidate('marks');
    DB.invalidate('assessments');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') {
      ReportUtils.invalidate(); // clear any report caches that used marks
    }
    // Force Utils grading cache refresh if needed
    if (typeof Utils !== 'undefined' && Utils._gradingCache) Utils._gradingCache = null;
  });
  Realtime.on('assessments', () => {
    DB.invalidate('assessments');
    DB.invalidate('marks');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
  });
  Realtime.on('learners', () => {
    DB.invalidate('learners');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
  });
  Realtime.on('classes', () => {
    DB.invalidate('classes');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
  });

  /* School settings / grading scale changes invalidate report caches
      so reports always regenerate from fresh Supabase data. */
  Realtime.on('school_settings', () => {
    DB.invalidate('school_settings');
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('settings');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
  });
  Realtime.on('grading_scales', () => {
    DB.invalidate('grading_scales');
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('scale');
    if (typeof Utils !== 'undefined') Utils._gradingCache = null;
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
  });

  /* Assessment type changes invalidate the shared types cache. */
  Realtime.on('assessment_types', () => {
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('assessmentTypes');
  });
  Realtime.on('classes', () => {
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('classes');
  });
  Realtime.on('subjects', () => {
    if (typeof ReportUtils !== 'undefined') {
      ReportUtils.invalidate('subjects');
      ReportUtils._cache.forEach((value, key) => {
        if (String(key).startsWith('classSubjects:')) ReportUtils.invalidate(key);
      });
    }
  });

  /* Keep the sidebar unread-notification badge live and surface new
     notification rows as in-app toast alerts for the current user. */
  Realtime.on('notifications', payload => {
    refreshNotificationBadge();
    const row = payload && payload.new ? payload.new : null;
    if (!row || !Auth.currentUser?.id || row.user_id !== Auth.currentUser.id) return;
    if (row.read) return;
    if (typeof Utils !== 'undefined' && Utils.toast) {
      const msg = row.title ? `${row.title} — ${row.message}` : row.message;
      Utils.toast(msg, row.type || 'info');
    }
  });

  /* ---------- Initial badge load (after login) ---------- */
  if (typeof Auth !== 'undefined' && Auth.currentUser?.id) {
    refreshNotificationBadge();
  }
})();

/* ============================================================
   Notification badge helpers
   ============================================================ */

async function refreshNotificationBadge() {
  if (typeof Auth === 'undefined' || !Auth.currentUser?.id) return;
  try {
    const n = await DB.count('notifications', { user_id: Auth.currentUser.id, read: false });
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.textContent = n > 99 ? '99+' : String(n);
      badge.style.display = n > 0 ? 'inline-flex' : 'none';
      badge.classList.toggle('nav-badge-empty', n === 0);
    }
  } catch (e) {
    console.warn('[Sync] badge:', e);
  }
}

async function markNotificationsRead() {
  const userId = Auth.currentUser?.id;
  if (!userId) return;
  try {
    await sbClient.from('notifications').update({ read: true }).eq('user_id', userId).eq('read', false);
    refreshNotificationBadge();
  } catch (e) {
    console.warn('[Sync] mark read:', e);
  }
}