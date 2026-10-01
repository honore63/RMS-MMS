async function initApp() {
  try {
    document.getElementById('login-year').textContent = String(new Date().getFullYear());
    const hasSession = await Auth.init();
    document.getElementById('loading-screen').style.display = 'none';

    if (hasSession) {
      if (Auth.currentUser && Auth.currentUser.status === 'inactive') {
        await Auth.signOut();
        showLogin('Your RMS account is currently inactive. Please contact the school administrator to reactivate it.');
      } else if (!Auth.currentUser) {
        await Auth.signOut();
        showLogin('Your account is active but the RMS profile could not be loaded. Please contact the school administrator.');
      } else {
        showApp();
      }
    } else {
      showLogin();
    }
  } catch (err) {
    console.error('Init error:', err);
    document.getElementById('loading-screen').style.display = 'none';
    showLogin();
  }
}

function showLogin(message) {
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app-layout').style.display = 'none';

  showSignInView();
  loadLoginBranding();

  const form = document.getElementById('login-form');
  form.removeEventListener('submit', handleLogin);
  form.addEventListener('submit', handleLogin);

  const eye = document.getElementById('toggle-password');
  eye.onclick = togglePasswordVisibility;

  const pwd = document.getElementById('login-password');
  pwd.value = '';
  pwd.type = 'password';
  eye.innerHTML = '<i data-lucide="eye"></i>';
  eye.setAttribute('aria-label', 'Show password');
  eye.setAttribute('aria-pressed', 'false');

  if (message) showLoginError(message);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function loadLoginBranding() {
  let settings = null;
  try {
    settings = typeof getSchoolSettings === 'function' ? await getSchoolSettings() : null;
  } catch (err) {
    console.error('Branding load error:', err);
  }
  settings = settings || {};

  const schoolName = settings.school_name || 'Rukara Model School';

  const nameEl = document.getElementById('login-school-name');
  let nameLine = document.getElementById('login-school-name-line');
  if (!nameLine && nameEl) {
    nameLine = document.createElement('p');
    nameLine.id = 'login-school-name-line';
    nameLine.className = 'login-brand-subtitle';
    nameEl.insertAdjacentElement('afterend', nameLine);
  }
  if (nameLine) nameLine.textContent = (schoolName && schoolName !== 'RMS-MIS') ? schoolName : 'Rukara Model School Marks Information System';

  const mottoEl = document.getElementById('login-brand-motto');
  if (mottoEl) mottoEl.textContent = settings.school_motto || 'Education, Work & Success';

  const setContact = (id, value) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (value) {
      el.textContent = value;
      el.closest('p').style.display = '';
    } else {
      el.closest('p').style.display = 'none';
    }
  };
  setContact('login-contact-address', settings.school_address || '');
  setContact('login-contact-phone', settings.school_phone || '');
  setContact('login-contact-email', settings.school_email || '');

  const footerSchool = document.getElementById('login-footer-school');
  if (footerSchool) footerSchool.textContent = schoolName;

  const img = document.getElementById('login-logo-img');
  const fallback = document.getElementById('login-logo-fallback');
  if (settings.logo_url && img) {
    img.onerror = () => {
      img.hidden = true;
      if (fallback) fallback.style.display = '';
    };
    img.src = settings.logo_url;
    img.hidden = false;
    if (fallback) fallback.style.display = 'none';
  } else {
    if (img) img.hidden = true;
    if (fallback) fallback.style.display = '';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function togglePasswordVisibility() {
  const pwd = document.getElementById('login-password');
  const eye = document.getElementById('toggle-password');
  const show = pwd.type === 'password';
  pwd.type = show ? 'text' : 'password';
  eye.innerHTML = show ? '<i data-lucide="eye-off"></i>' : '<i data-lucide="eye"></i>';
  eye.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  eye.setAttribute('aria-pressed', show ? 'true' : 'false');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showLoginError(message) {
  const errDiv = document.getElementById('login-error');
  errDiv.innerHTML = '<i data-lucide="alert-circle"></i><span>' + message + '</span>';
  errDiv.style.display = 'flex';
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function hideLoginError() {
  document.getElementById('login-error').style.display = 'none';
}

function showSignInView() {
  document.getElementById('login-signin-view').style.display = '';
  const npView = document.getElementById('login-newpass-view');
  if (npView) npView.style.display = 'none';
  hideLoginError();
}

function showCreatePassword(opts) {
  opts = opts || {};
  const forced = !!opts.forced;
  window._forcedPasswordChange = forced;
  document.getElementById('login-page').style.display = 'flex';
  document.getElementById('app-layout').style.display = 'none';
  document.getElementById('login-signin-view').style.display = 'none';
  const view = document.getElementById('login-newpass-view');
  view.style.display = '';
  const sub = view.querySelector('.login-card-sub');
  if (sub && forced) sub.textContent = 'You signed in with a temporary password. Create your personal password to continue.';
  hideLoginError();
  const errEl = document.getElementById('newpass-error');
  if (errEl) errEl.style.display = 'none';
  const p1 = document.getElementById('newpass-password');
  const p2 = document.getElementById('newpass-confirm');
  if (p1) p1.value = '';
  if (p2) p2.value = '';
  const form = document.getElementById('newpass-form');
  if (form) {
    form.removeEventListener('submit', submitNewPassword);
    form.addEventListener('submit', submitNewPassword);
  }
  const back = document.getElementById('newpass-back');
  if (back) {
    if (forced) {
      back.style.display = 'none';
    } else {
      back.style.display = '';
      back.onclick = () => showSignInView();
    }
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function mapLoginError(message) {
  const msg = message || '';
  if (msg === 'INVALID_CREDENTIALS') {
    return 'Unable to sign in. Please check your email and password and try again.';
  }
  if (msg === 'EMAIL_NOT_CONFIRMED') {
    return '<strong>Email Confirmation Required</strong><br><br>' +
      'Your email address has not been confirmed yet. Please check your inbox for the confirmation link,<br>' +
      'or ask the school administrator to verify your account.';
  }
  if (msg === 'EMAIL_PROVIDER_DISABLED' || /email (logins|provider) is disabled/i.test(msg)) {
    return 'Email sign-ins are currently disabled on this system. Please contact the school administrator.';
  }
  if (/row-level security|rls/i.test(msg)) {
    return 'Your RMS account is not fully configured yet. Please contact the school administrator.';
  }
  if (/network|fetch|failed to fetch|timeout|connection/i.test(msg)) {
    return 'We couldn\u2019t reach the RMS server. Please check your internet connection and try again.';
  }
  if (/invalid login|invalid credentials|user not found/i.test(msg)) {
    return 'Unable to sign in. Please check your email and password and try again.';
  }
  return 'Something went wrong while signing you in. Please try again.';
}


async function submitNewPassword(e) {
  e.preventDefault();
  const p1 = document.getElementById('newpass-password').value;
  const p2 = document.getElementById('newpass-confirm').value;
  const errEl = document.getElementById('newpass-error');
  const btn = document.getElementById('newpass-btn');
  const fail = (msg) => {
    errEl.innerHTML = '<i data-lucide="alert-circle"></i><span>' + msg + '</span>';
    errEl.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };
  errEl.style.display = 'none';

  if (!p1 || !p2) { fail('Please enter your new password twice.'); return; }
  if (p1.length < 6) { fail('Your password must be at least 6 characters long.'); return; }
  if (p1 !== p2) { fail('The two passwords do not match. Please try again.'); return; }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Saving...';
  try {
    const { error } = await sbClient.auth.updateUser({ password: p1 });
    if (error) throw error;
    // Retire the temporary-password flag on the signed-in user's own row
    // (permitted by the users UPDATE RLS policy).
    try {
      const { data: { session } } = await sbClient.auth.getSession();
      if (session && session.user) {
        await sbClient.from('users').update({
          must_change_password: false, temporary_password_hash: null, password_reset_expires_at: null
        }).eq('id', session.user.id);
      }
    } catch (e) { /* flag cleanup is best-effort */ }
    if (Auth.currentUser) Auth.currentUser.must_change_password = false;
    window._forcedPasswordChange = false;
    showApp();
    if (typeof Utils !== 'undefined' && Utils.toast) {
      Utils.toast('Your password has been changed successfully.', 'success');
    }
  } catch (err) {
    fail('We couldn\u2019t change your password. Please try again.');
  } finally {
    btn.innerHTML = '<i data-lucide="check" style="width:18px;height:18px"></i> Save Password';
    btn.disabled = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const identifier = document.getElementById('login-identifier')?.value?.trim() || document.getElementById('login-email')?.value?.trim();
  const password = document.getElementById('login-password').value;
  const btn = document.getElementById('login-btn');

  if (!identifier || !password) {
    showLoginError('Please enter your login details and password.');
    return;
  }
  if (password.length < 6) {
    showLoginError('Your password must be at least 6 characters long.');
    return;
  }

  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Signing in...';
  btn.disabled = true;
  hideLoginError();

  try {
    let emailToUse = identifier;
    let isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);

    // If it's not an email, try resolving it via the teachers table (by teacher_code or phone)
    if (!isEmail) {
      const { data: matchedTeacher, error: matchErr } = await sbClient
        .from('teachers')
        .select('email')
        .or(`teacher_code.eq.${identifier},phone.eq.${identifier}`)
        .maybeSingle();
      
      if (matchedTeacher && matchedTeacher.email) {
        emailToUse = matchedTeacher.email;
      } else {
        // Fallback for DOS matching the users table directly by phone (if admin)
        const { data: matchedUser } = await sbClient
          .from('users')
          .select('email')
          .eq('phone', identifier)
          .maybeSingle();
        if (matchedUser && matchedUser.email) {
          emailToUse = matchedUser.email;
        } else {
          throw new Error('IDENTIFIER_NOT_FOUND');
        }
      }
    }

    await Auth.signIn(emailToUse, password);

    if (!Auth.currentUser) {
      await Auth.signOut();
      throw new Error('PROFILE_MISSING');
    }
    if (Auth.currentUser.status === 'inactive') {
      await Auth.signOut();
      throw new Error('ACCOUNT_INACTIVE');
    }

    showApp();
  } catch (err) {
    const msg = err.message;
    if (msg === 'PROFILE_MISSING') {
      showLoginError('Your account could not be linked to an RMS profile. Please contact the school administrator.');
    } else if (msg === 'ACCOUNT_INACTIVE') {
      showLoginError('Your RMS account is currently inactive. Please contact the school administrator to reactivate it.');
    } else {
      showLoginError(mapLoginError(msg));
    }
  } finally {
    btn.innerHTML = '<i data-lucide="log-in" style="width:18px;height:18px"></i> Sign In';
    btn.disabled = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
}

// ---- Global Academic Year context (header selector) ----
let _headerYears = null; // cache of academic_years rows
const YEAR_STORE_KEY = 'rms.activeYearId';

async function ensureHeaderYears(force = false) {
  if (_headerYears && !force) return _headerYears;
  try {
    _headerYears = await DB.query('academic_years', '*', {}, { column: 'name', asc: false }) || [];
  } catch (e) {
    _headerYears = _headerYears || [];
  }
  return _headerYears;
}

function invalidateHeaderYears() {
  _headerYears = null;
  if (typeof DB !== 'undefined' && DB.invalidate) DB.invalidate('academic_years');
}

// returns the ID of the year the user currently has selected for the app.
// falls back to: stored preference -> current/active year -> most recent -> null.
function getActiveYearId(years) {
  const list = years || _headerYears || [];
  const stored = localStorage.getItem(YEAR_STORE_KEY);
  if (stored && list.some(y => y.id === stored)) return stored;
  const current = list.find(y => y.is_current);
  if (current) return current.id;
  const active = list.find(y => y.status === 'active');
  if (active) return active.id;
  return list[0] ? list[0].id : null;
}

function setActiveYearId(id) {
  if (id) localStorage.setItem(YEAR_STORE_KEY, id);
  else localStorage.removeItem(YEAR_STORE_KEY);
  if (typeof Router !== 'undefined') Router.render();
}

function refreshHeaderYearSelect() {
  ensureHeaderYears(true).then(() => {
    const el = document.getElementById('header-year');
    if (!el) return;
    const activeId = getActiveYearId(_headerYears);
    el.innerHTML = (_headerYears || []).map(y =>
      `<option value="${y.id}" ${y.id === activeId ? 'selected' : ''}>${typeof Utils !== 'undefined' ? Utils.escapeHtml(y.name) : y.name}${y.status === 'active' && y.is_current ? ' (Current)' : ''}</option>`
    ).join('');
  });
}

function yearById(id, years) {
  const list = years || _headerYears || [];
  return list.find(y => y.id === id) || null;
}

async function showApp() {
  // Accounts flagged must_change_password must set a personal password first.
  if (Auth.currentUser && Auth.currentUser.must_change_password) {
    showCreatePassword({ forced: true });
    return;
  }
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';
  const role = Auth.getRole();
  Sidebar.render(role);
  Sidebar.init();
  registerRoutes();
  Router.init();
  // Canonical assessment types are defined in code; quietly ensure their rows
  // exist so every dropdown is populated. Additive, best-effort, never blocks.
  try { await Utils.ensureAssessmentTypes(); } catch (e) { /* non-fatal */ }
  if (typeof Realtime !== 'undefined') Realtime.init();
if (typeof NotificationCenter !== 'undefined') {
      NotificationCenter.init();
      NotificationCenter.loadNotifications();
    }
    if (typeof refreshNotificationBadge === 'function') refreshNotificationBadge();
  /* Cache-first: prewarm common reference data in the background so the
     first dashboard → classes → subjects → teachers navigation is a HIT. */
  if (typeof DB !== 'undefined' && DB.warm) {
    DB.warm(['school_settings', 'grading_scales', 'academic_years', 'terms',
      'subjects', 'classes', 'teachers', 'assessment_types']);
  }
  ensureHeaderYears().then(list => {
    const sel = document.getElementById('global-year-select');
    if (!sel) return;
    sel.innerHTML = list.map(y => `<option value="${y.id}">${Utils.escapeHtml(y.name)} ${y.status === 'active' ? '(System)' : ''}</option>`).join('');
    sel.value = getActiveYearId(list) || '';
    const lbl = document.getElementById('acad-year-label');
    if (lbl) lbl.style.display = 'inline';
  });
  if (!window.location.hash || window.location.hash === '#') {
    if (role === 'dos') Router.go('admin/dashboard');
    else if (role === 'teacher') Router.go('teacher/dashboard');
    else Router.go('admin/dashboard');
  } else {
    Router.render();
  }
}

function registerRoutes() {
  Router.register('admin/dashboard', renderAdminDashboard);
  Router.register('admin/academic', renderAcademic);
  Router.register('admin/classes', renderClasses);
  Router.register('admin/subjects', renderSubjects);
  Router.register('admin/teachers', renderTeachers);
  Router.register('admin/learners', renderLearners);
  Router.register('admin/assignments', renderAssignments);
  Router.register('admin/assessments', renderAssessments);
  Router.register('admin/assessment-types', renderAssessmentTypes);
  Router.register('admin/marks', renderAdminMarks);
  Router.register('admin/reports', (typeof renderReportCenter !== 'undefined' ? renderReportCenter : () => { setHeader('Report Center', 'Reporting System'); setContent('<div class="card"><div class="card-body"><p>Report Center loading...</p></div></div>'); }));
  Router.register('admin/reports/cards', () => ReportCenter.open('student-card'));
  Router.register('admin/reports/class', () => ReportCenter.open('class-performance'));
  Router.register('admin/reports/class-ranking', () => ReportCenter.open('class-ranking'));
  Router.register('admin/reports/subject', () => ReportCenter.open('subject-performance'));
  Router.register('admin/reports/student', () => ReportCenter.open('student-performance'));
  Router.register('admin/reports/assessment', () => ReportCenter.open('exam-class-summary'));
  Router.register('admin/reports/marks', () => ReportCenter.open('missing-marks'));
  Router.register('admin/reports/teacher', () => ReportCenter.open('teacher-performance'));
  Router.register('admin/reports/school', () => ReportCenter.open('school-performance'));
  Router.register('admin/reports/grades', () => ReportCenter.open('grade-distribution'));
  Router.register('admin/analytics', renderAnalytics);
  Router.register('admin/messages', () => CommunicationCenter.render());
  Router.register('admin/audit-logs', renderAuditLogs);
  Router.register('admin/notifications', renderNotifications);
  Router.register('admin/settings', (typeof renderSettings !== 'undefined' ? renderSettings : () => { setHeader('School Settings', 'Configure school settings'); setContent('<div class="card"><div class="card-body"><p>Settings module under development.</p></div></div>'); }));

  Router.register('teacher/dashboard', renderTeacherDashboard);
  Router.register('teacher/my-classes', renderMyClasses);
  Router.register('teacher/my-subjects', renderMySubjects);
  Router.register('teacher/enter-marks', renderEnterMarks);
  Router.register('teacher/convert-marks', renderConvertMarks);
  Router.register('teacher/import-marks', () => { setHeader('Import Marks', 'Bulk import learner marks from Excel, CSV, Word or PDF'); MarksImport.open(); });
  Router.register('teacher/submitted-marks', renderSubmittedMarks);
  Router.register('teacher/reports', (typeof renderReportCenter !== 'undefined' ? renderReportCenter : () => ReportCenter.render()));
  Router.register('teacher/analytics', renderTeacherAnalytics);
  Router.register('teacher/messages', () => CommunicationCenter.render());
  Router.register('teacher/notifications', renderNotifications);
  Router.register('teacher/account', renderTeacherAccount);
}

function renderNotifications() {
  const hash = window.location.hash || '';
  if (!['#teacher/notifications', 'teacher/notifications', '#admin/notifications', 'admin/notifications'].includes(hash)) {
    // Not currently on notifications page, just update badge
    if (typeof NotificationCenter !== 'undefined') {
      NotificationCenter.hideCenter();
      NotificationCenter.updateUnreadCount();
    }
    return;
  }
  
  // We're on the notifications page
  if (typeof NotificationCenter === 'undefined') return;
  NotificationCenter.showCenter();
  NotificationCenter.renderNotifications();
}

const App = {
  setGlobalYear: (id) => { 
    setActiveYearId(id); 
    // Reflect the new value visually and refresh
    const sel = document.getElementById('global-year-select');
    if (sel) sel.value = id;
  },
  logout: async () => {
    await Auth.signOut();
    if (typeof DB !== 'undefined' && DB.clearUserCache) DB.clearUserCache();
    if (typeof Realtime !== 'undefined') Realtime.stop();
    window.location.hash = '';
    document.getElementById('app-layout').style.display = 'none';
    showLogin();
  }
};

// ============================================================
// NOTIFICATION CENTER HANDLER
// ============================================================
const NotificationCenter = {
  /* State */
  unreadCount: 0,
  allNotifications: [],
  filteredNotifications: [],
  _initialized: false,

  /* Initialize notification center */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    this.bell = document.getElementById('notify-bell');
    this.badge = document.getElementById('notify-badge');
    this.headerTitle = document.getElementById('header-title');
    this.dropdown = document.getElementById('notify-dropdown');
    this.notifyList = document.getElementById('notify-list');
    this.markAllRead = document.getElementById('mark-all-read');
    this.viewAllBtn = document.getElementById('view-all-notifications');
    this.notifyCenterPage = document.getElementById('notify-center-page');
    this.cardsContainer = document.getElementById('notify-cards-container');
    this.noNotifications = document.getElementById('no-notifications');
    this.tabButtons = document.querySelectorAll('#notify-center-page .tab-btn');
    this.filter = 'all';

    if (!this.bell) return;

    // Bell click → toggle dropdown
    this.bell.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleDropdown();
    });

    // Mark all as read
    if (this.markAllRead) {
      this.markAllRead.addEventListener('click', () => this.markAllAsRead());
    }

    // View all notifications
    if (this.viewAllBtn) {
      this.viewAllBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.showCenter();
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.bell.contains(e.target) && !this.dropdown.contains(e.target)) {
        this.hideDropdown();
      }
    });

    // Tab filtering
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        this.tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.filter = btn.dataset.filter;
        this.renderNotifications();
        if (this.filter === 'all') {
          this.showCenter();
        }
      });
    });

    // Load initial notifications
    this.loadNotifications();
  },

  toggleDropdown() {
    const isVisible = this.dropdown.style.display !== 'none';
    this.hideDropdown();
    if (!isVisible) this.showDropdown();
  },

  showDropdown() {
    this.dropdown.style.display = 'block';
    this.loadNotifications();
  },

  hideDropdown() {
    this.dropdown.style.display = 'none';
  },

  showCenter() {
    this.hideDropdown();
    const route = Auth.isAdmin() ? 'admin/notifications' : 'teacher/notifications';
    if (Router.current !== route) {
      Router.go(route);
      return;
    }
    this.notifyCenterPage.style.display = 'block';
    this.loadNotifications();
    // Activate all tab
    this.tabButtons.forEach(btn => btn.classList.add('active'));
    this.filter = 'all';
  },

  hideCenter() {
    if (this.notifyCenterPage) this.notifyCenterPage.style.display = 'none';
    this.tabButtons.forEach(btn => btn.classList.remove('active'));
    this.filter = 'all';
  },

  closeCenter() {
    Router.go(Auth.isAdmin() ? 'admin/dashboard' : 'teacher/dashboard');
  },

  /* Load notifications from Supabase */
  async loadNotifications() {
    try {
      const userId = Auth.currentUser?.id;
      if (!userId) return;

      const { data, error } = await sbClient
        .from('notifications')
        .select('*')
        .eq('recipient_user_id', userId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      this.allNotifications = data || [];
      this.updateUnreadCount();
      this.renderNotifications();
    } catch (err) {
      console.error('[NotificationCenter] load error:', err);
    }
  },

  updateUnreadCount() {
    const unread = this.allNotifications.filter(n => !n.is_read).length;
    this.unreadCount = unread;
    if (this.badge) {
      this.badge.textContent = unread > 99 ? '99+' : String(unread);
      this.badge.style.display = unread > 0 ? 'block' : 'none';
    }
    if (this.bell) {
      const ariaLabel = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';
      this.bell.setAttribute('aria-label', ariaLabel);
    }
    /* Also update sidebar nav badge */
    if (typeof refreshNotificationBadge === 'function') {
      refreshNotificationBadge();
    }
  },

  renderNotifications() {
    const notifications = this.filter === 'all' 
      ? this.allNotifications 
      : this.allNotifications.filter(n => this.matchesFilter(n));

    if (notifications.length === 0) {
      if (this.notifyList) this.notifyList.innerHTML = '';
      if (this.cardsContainer) this.cardsContainer.innerHTML = '';
      if (this.noNotifications) this.noNotifications.style.display = 'block';
      return;
    }

    if (this.noNotifications) this.noNotifications.style.display = 'none';

    // Render dropdown list
    if (this.notifyList) {
      this.notifyList.innerHTML = notifications.map(n => this.renderNotifyCard(n, true)).join('');
    }

    // Render center cards
    if (this.cardsContainer) {
      this.cardsContainer.innerHTML = notifications.map(n => this.renderNotifyCard(n, false)).join('');
    }
  },

  matchesFilter(notification) {
    if (this.filter === 'all') return true;
    if (this.filter === 'unread') return !notification.is_read;
    if (this.filter === 'important') {
      return notification.priority === 'important' || notification.priority === 'urgent';
    }
    // Category filters
    const categoryMap = {
      marks: ['MARKS_SUBMITTED', 'MARKS_APPROVED', 'MARKS_REJECTED'],
      assessments: ['ASSESSMENT_CREATED', 'ASSESSMENT_REOPENED', 'ASSESSMENT_LOCKED'],
      announcements: ['ANNOUNCEMENT'],
      timetable: ['TIMETABLE'],
      system: ['SYSTEM'],
      reports: ['REPORT'],
      important: [] // handled separately
    };
    const types = categoryMap[this.filter];
    if (this.filter === 'messages') return notification.entity_type === 'teacher_message';
    if (!types) return true;
    return types.includes(notification.notification_type);
  },

  renderNotifyCard(notification, isDropdown = false) {
    const priorityClass = `priority-${notification.priority}`;
    const isUnread = notification.is_read ? '' : 'unread';
    const priorityClass2 = isUnread ? '' : 'read';
    const typeIcons = {
      MARKS_SUBMITTED: '📤',
      MARKS_APPROVED: '✓',
      MARKS_REJECTED: '⚠',
      ASSESSMENT_CREATED: '📝',
      ASSESSMENT_REOPENED: '🔓',
      ASSESSMENT_LOCKED: '🔒',
      ANNOUNCEMENT: '📢',
      TIMETABLE: '📅',
      MEETING: '📅',
      EXAMINATION: '📝',
      CPD: '🎓',
      SYSTEM: 'ℹ️',
      REPORT: '📊'
    };

    const icon = typeIcons[notification.notification_type] || 'ℹ️';
    const category = notification.category || 'system';
    const priority = notification.priority || 'normal';
    const timeAgo = this.timeAgo(notification.created_at);
    const actionBtn = notification.action_url 
      ? `<button class="btn btn-sm notify-action" style="background:transparent;border:none;color:var(--blue-600);font-size:11px;text-decoration:underline;margin-top:4px;display:block;">View</button>`
      : '';
    const isDos = Auth.isAdmin();
    const canDelete = isDos;
    const deleteBtn = canDelete
      ? `<button type="button" class="btn btn-sm notify-delete" aria-label="Delete notification: ${Utils.escapeHtml(notification.title)}" title="Delete notification" onclick="event.stopPropagation();NotificationCenter.deleteNotification('${notification.id}')"><i data-lucide="trash-2"></i></button>`
      : '';
    const actions = actionBtn || deleteBtn ? `<div class="notify-actions">${actionBtn}${deleteBtn}</div>` : '';

    return `
      <div class="notify-card ${isUnread ? 'unread' : 'read'} ${priorityClass}" 
           data-id="${notification.id}" 
           data-type="${notification.notification_type}"
           tabindex="0" role="button" 
           onmouseover="this.classList.add('hover')" onmouseout="this.classList.remove('hover')"
           onclick="NotificationCenter.openNotification('${notification.id}')">
        <span class="notify-icon">${icon}</span>
        <div style="flex:1">
          <div class="notify-title">${Utils.escapeHtml(notification.title)}</div>
          <div class="notify-message">${Utils.escapeHtml(notification.message)}</div>
          <div class="notify-meta">
            <span class="notify-sender">${Utils.escapeHtml(notification.sender_user_name || '')}</span>
            <span class="notify-time">${timeAgo}</span>
          </div>
        </div>
        ${actions}
      </div>
    `;
  },

  timeAgo(isoString) {
    if (!isoString) return 'just now';
    const date = new Date(isoString);
    const now = new Date();
    const diffSec = Math.floor((now - date) / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay}d ago`;
    if (diffHour > 0) return `${diffHour}h ago`;
    if (diffMin > 0) return `${diffMin}min ago`;
    return `${diffSec}s ago`;
  },

  /* Open and mark a single notification as read */
  async openNotification(notificationId) {
    const notif = this.allNotifications.find(n => n.id === notificationId);
    if (!notif) return;

    // Mark as read
    await this.markRead(notificationId);

    if (notif.entity_type === 'teacher_message') {
      Router.go(`${Auth.isAdmin() ? 'admin/messages' : 'teacher/messages'}?message=${encodeURIComponent(notif.entity_id || '')}`);
      return;
    }

    // Handle action based on type
    switch (notif.notification_type) {
      case 'MARKS_SUBMITTED':
        // Navigate to submitted marks
        Router.go('teacher/submitted-marks');
        break;
      case 'MARKS_APPROVED':
        // Navigate to assessment
        if (notif.entity_id) Router.go(`assessment/${notif.entity_id}`);
        break;
      case 'MARKS_REJECTED':
        // Navigate to assessment for correction
        if (notif.entity_id) Router.go(`assessment/${notif.entity_id}`);
        break;
      case 'ASSESSMENT_REOPENED':
        if (notif.entity_id) Router.go(`assessment/${notif.entity_id}`);
        break;
      case 'ANNOUNCEMENT':
        if (notif.action_url) window.location.href = notif.action_url;
        break;
      case 'TIMETABLE':
        if (notif.action_url) window.location.href = notif.action_url;
        break;
      default:
        Router.go(Auth.isAdmin() ? 'admin/notifications' : 'teacher/notifications');
    }

    // Re-render to update unread count
    this.updateUnreadCount();
    this.renderNotifications();
  },

  async markRead(notificationId) {
    try {
      await sbClient
        .from('notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', notificationId);
      
      // Update local state
      const idx = this.allNotifications.findIndex(n => n.id === notificationId);
      if (idx !== -1) {
        this.allNotifications[idx].is_read = true;
        this.allNotifications[idx].read_at = new Date().toISOString();
      }
      this.updateUnreadCount();
      this.renderNotifications();
    } catch (err) {
      console.error('[NotificationCenter] mark read error:', err);
    }
  },

  async markAllAsRead() {
    const unread = this.allNotifications.filter(n => !n.is_read);
    if (unread.length === 0) return;

    const { error } = await sbClient
      .from('notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .in('id', unread.map(n => n.id));

    if (error) throw error;

    // Update local state
    unread.forEach(n => {
      const idx = this.allNotifications.findIndex(x => x.id === n.id);
      if (idx !== -1) {
        this.allNotifications[idx].is_read = true;
        this.allNotifications[idx].read_at = new Date().toISOString();
      }
    });
    this.updateUnreadCount();
    this.renderNotifications();
  },

  async deleteNotification(notificationId) {
    try {
      const userRole = Auth.getRole();
      const deleteQuery = userRole === 'dos'
        ? sbClient.from('notifications').delete().eq('id', notificationId)
        : sbClient.from('notifications').delete().eq('id', notificationId).eq('recipient_user_id', Auth.currentUser?.id);
      const { error } = await deleteQuery;
      if (error) throw error;

      // Update local state
      this.allNotifications = this.allNotifications.filter(n => n.id !== notificationId);
      this.updateUnreadCount();
      this.renderNotifications();
      Utils.toast('Notification deleted', 'success');
    } catch (err) {
      console.error('[NotificationCenter] delete error:', err);
      Utils.toast('Could not delete notification: ' + (err.message || 'Unknown error'), 'error');
    }
  }
};

// Register the NotificationCenter init with Realtime
if (typeof Realtime !== 'undefined') {
  Realtime.on('notifications', (payload) => {
    const newNotification = payload?.new;
    if (newNotification?.recipient_user_id === Auth.currentUser?.id) {
      NotificationCenter.handleNewNotification(newNotification);
    }
  });
}

/* Handle new notification from realtime */
NotificationCenter.handleNewNotification = async function(newNotification) {
  if (!newNotification || newNotification.recipient_user_id !== Auth.currentUser?.id) return;
  // Check if this notification already exists (duplicate prevention)
  if (this.allNotifications.some(n => n.id === newNotification.id)) return;
  
  // Add to the beginning of the list (most recent first)
  this.allNotifications.unshift({ ...newNotification, is_read: !!newNotification.is_read });
  
  // Update UI
  this.updateUnreadCount();
  this.renderNotifications();
  
  // Show toast for new notifications
  if (!newNotification.is_read) {
    this.showToast(newNotification);
  }
};

/* Show toast for new notifications */
NotificationCenter.showToast = function(notification) {
  const toastContainer = document.getElementById('toast-container');
  if (!toastContainer) return;
  
  const typeMap = {
    MARKS_SUBMITTED: 'success',
    MARKS_APPROVED: 'success',
    MARKS_REJECTED: 'error',
    ASSESSMENT_CREATED: 'info',
    ASSESSMENT_REOPENED: 'warning',
    ASSESSMENT_LOCKED: 'warning',
    ANNOUNCEMENT: 'info',
    TIMETABLE: 'info',
    MEETING: 'info',
    EXAMINATION: 'info',
    CPD: 'info',
    SYSTEM: 'info',
    REPORT: 'info'
  };
  
  const type = typeMap[notification.notification_type] || 'info';
  const priorityClass = notification.priority || 'normal';
  
  const urgentBadge = priorityClass === 'urgent' ? '<span class="font-bold text-red-600">URGENT</span>' : '';
  
  toastContainer.innerHTML += `
    <div class="toast toast-${type}" role="alert" aria-live="polite" aria-atomic="true">
      <i data-lucide="${type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : 'info'}" style="width:16px;height:16px"></i>
      <div style="flex:1">
        <div style="font-weight:600;color:white">${Utils.escapeHtml(notification.title)}</div>
        <div style="color:rgba(255,255,255,0.8);font-size:12px">${Utils.escapeHtml(notification.message)}</div>
      </div>
      ${urgentBadge}
      <button class="btn btn-sm btn-ghost text-white opacity-70 ml-auto close-toast" aria-label="Close">×</button>
    </div>
  `;
  
  // Re-init lucide icons
  if (typeof lucide !== 'undefined') lucide.createIcons();
  
  // Auto-dismiss after 5 seconds, but persistent for urgent
  const timeout = priorityClass === 'urgent' ? null : 5000;
  const toastEl = toastContainer.lastElementChild;
  if (toastEl) {
    setTimeout(() => {
      if (toastEl.parentNode) {
        toastEl.style.transition = 'opacity .3s';
        toastEl.style.opacity = '0';
        setTimeout(() => toastEl.remove?.(), 300);
      }
    }, timeout);
  }
  
  // Close button
  const closeBtn = toastEl?.querySelector('.close-toast');
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      toastEl.style.opacity = '0';
      setTimeout(() => toastEl.remove?.(), 300);
    });
  }
};

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  if (typeof Realtime !== 'undefined') Realtime.init();
});
