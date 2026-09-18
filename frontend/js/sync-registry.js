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
  Realtime.route('admin/assessments', ['assessments', 'teacher_assignments', 'marks', 'teachers', 'academic_years', 'terms']);
  Realtime.route('admin/marks', ['assessments', 'marks', 'learners', 'teachers', 'classes']);
  Realtime.route('admin/reports', ['assessments', 'marks', 'learners', 'classes', 'subjects', 'academic_years', 'terms', 'school_settings', 'grading_scales']);
  Realtime.route('admin/analytics', ['assessments', 'marks', 'learners', 'classes', 'subjects', 'grading_scales']);
  Realtime.route('admin/audit-logs', ['audit_logs']);
  Realtime.route('admin/documents', ['documents']);
  Realtime.route('admin/settings', ['school_settings', 'grading_scales']);

  Realtime.route('teacher/dashboard', ['teacher_assignments', 'assessments', 'marks', 'classes', 'notifications']);
  Realtime.route('teacher/my-classes', ['learners', 'classes', 'teacher_assignments']);
  Realtime.route('teacher/my-subjects', ['subjects', 'teacher_assignments']);
  Realtime.route('teacher/submitted-marks', ['assessments', 'marks']);

  /* Marks entry: refresh the list live, but NEVER rebuild the page
     while the teacher is actively entering marks (guarded below). */
  Realtime.route('teacher/enter-marks', ['teacher_assignments', 'assessments', 'academic_years', 'terms', 'learners'], () => {
    return typeof marksView === 'undefined' || marksView !== 'entry';
  });

  Realtime.route('teacher/reports', ['assessments', 'marks', 'learners', 'school_settings', 'grading_scales']);
  Realtime.route('teacher/notifications', ['notifications']);

  /* ---------- Targeted in-place updates ---------- */

  /* School settings / grading scale changes invalidate report caches
     so reports always regenerate from fresh Supabase data. */
  Realtime.on('school_settings', () => { schoolSettingsCache = null; });
  Realtime.on('grading_scales', () => { gradingScaleCache = null; });

  /* While inside the marks entry screen, if the open assessment's
     status changes from another user/device (submitted -> approved,
     rejected, locked), re-fetch and re-render so the grid locks or
     shows the rejection reason immediately. */
  Realtime.on('assessments', payload => {
    if (typeof marksView === 'undefined' || marksView !== 'entry') return;
    if (typeof markAssessment === 'undefined' || !markAssessment) return;
    const changed = payload.new || payload.old;
    if (!changed || changed.id !== markAssessment.id) return;
    if (changed.status !== markAssessment.status) {
      renderEnterMarks();
    }
  });

  /* Keep the sidebar unread-notification badge live. */
  Realtime.on('notifications', () => refreshNotificationBadge());

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