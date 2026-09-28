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
  Realtime.route('admin/announcements', ['announcements', 'notifications']);
  Realtime.route('admin/messages', ['messages', 'notifications', 'classes', 'teachers']);

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

  /* Bulk Convert: never auto-rebuild the page mid-conversion. */
  Realtime.route('teacher/convert-marks', ['assessments', 'assessment_types', 'marks'], () => {
    return typeof bulkApplying === 'undefined' || !bulkApplying;
  });

Realtime.route('teacher/analytics', ['assessments', 'assessment_types', 'marks', 'learners', 'classes', 'subjects', 'teacher_assignments', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
   Realtime.route('teacher/notifications', ['notifications']);
  Realtime.route('admin/notifications', ['notifications']);
  Realtime.route('teacher/messages', ['messages', 'notifications', 'classes', 'teacher_assignments']);

  /* ---------- Targeted in-place updates ----------
     Note: Realtime._fire already calls DB.invalidate(table) for every
     shared table event. Handlers below add cross-table dependency
     invalidation + report/analytics context resets. */

  /* Every marks/assessment change must invalidate all data caches
      so Analytics, Reports, DOS dashboards and teacher views see fresh
      marks immediately — no stale DB cache. */
  Realtime.on('marks', () => {
    DB.invalidateMany(['marks', 'assessments']);
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') {
      ReportUtils.invalidate(); // clear any report caches that used marks
    }
    // Force Utils grading cache refresh if needed
    if (typeof Utils !== 'undefined' && Utils._gradingCache) Utils._gradingCache = null;
  });
  Realtime.on('assessments', () => {
    DB.invalidateMany(['assessments', 'marks']);
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
  Realtime.on('subjects', () => {
    DB.invalidate('subjects');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
  });
  Realtime.on('teachers', () => {
    DB.invalidateMany(['teachers', 'teacher_assignments']);
  });
  Realtime.on('teacher_assignments', () => {
    DB.invalidate('teacher_assignments');
  });
  Realtime.on('academic_years', () => {
    DB.invalidate('academic_years');
    if (typeof invalidateHeaderYears === 'function') invalidateHeaderYears();
  });
  Realtime.on('terms', () => DB.invalidate('terms'));
  Realtime.on('users', () => DB.invalidate('users'));
  Realtime.on('assessment_types', () => {
    DB.invalidate('assessment_types');
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('assessmentTypes');
  });
  Realtime.on('audit_logs', () => DB.invalidate('audit_logs'));

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

  /* Keep the unread-notification badge live. NotificationCenter owns the
     toast and in-page list to avoid duplicate realtime alerts. */
  Realtime.on('notifications', payload => {
    refreshNotificationBadge();
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
    const n = await DB.count('notifications', { recipient_user_id: Auth.currentUser.id, is_read: false });
    const badge = document.getElementById('notif-badge');
    const link = document.getElementById('nav-notifications-link');
    if (link) link.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications');
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
    await sbClient.from('notifications').update({ is_read: true }).eq('recipient_user_id', userId).eq('is_read', false);
    DB.invalidate('notifications');
    refreshNotificationBadge();
  } catch (e) {
    console.warn('[Sync] mark read:', e);
  }
}