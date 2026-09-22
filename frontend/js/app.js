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

  const forgot = document.getElementById('forgot-link');
  forgot.onclick = (e) => { e.preventDefault(); showResetView(); };

  const back = document.getElementById('reset-back');
  back.onclick = () => showSignInView();

  const reset = document.getElementById('reset-form');
  reset.onsubmit = submitForgot;

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
  const resetView = document.getElementById('login-reset-view');
  if (resetView) resetView.style.display = 'none';
  hideLoginError();
  const resetMsg = document.getElementById('reset-message');
  if (resetMsg) resetMsg.style.display = 'none';
}

function showResetView() {
  document.getElementById('login-signin-view').style.display = 'none';
  document.getElementById('login-reset-view').style.display = '';
  hideLoginError();
  const resetMsg = document.getElementById('reset-message');
  if (resetMsg) resetMsg.style.display = 'none';
  document.getElementById('reset-email').value = document.getElementById('login-email').value.trim();
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

async function submitForgot(e) {
  e.preventDefault();
  const email = document.getElementById('reset-email').value.trim();
  const btn = document.getElementById('reset-btn');
  const msgEl = document.getElementById('reset-message');

  msgEl.style.display = 'none';

  if (!email) {
    msgEl.className = 'login-reset-message';
    msgEl.style.display = 'flex';
    msgEl.innerHTML = '<i data-lucide="alert-circle"></i><span>Please enter your email address.</span>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px"></div> Sending...';
  btn.disabled = true;

  try {
    const error = await Auth.resetPassword(email);
    if (error) {
      throw new Error(error.message);
    }
    msgEl.className = 'login-reset-message';
    msgEl.style.display = 'flex';
    msgEl.innerHTML = '<i data-lucide="check-circle-2"></i><span>A password reset link has been sent to <strong>' +
      email + '</strong>. Please check your inbox and follow the instructions.</span>';
  } catch (err) {
    msgEl.className = 'login-reset-message';
    msgEl.style.display = 'flex';
    msgEl.innerHTML = '<i data-lucide="alert-circle"></i><span>We couldn\u2019t send a reset link right now. ' +
      'Please try again in a few minutes or contact the school administrator.</span>';
  } finally {
    btn.innerHTML = '<i data-lucide="send" style="width:18px;height:18px"></i> Send Reset Link';
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
  document.getElementById('login-page').style.display = 'none';
  document.getElementById('app-layout').style.display = 'flex';
  const role = Auth.getRole();
  Sidebar.render(role);
  Sidebar.init();
  const list = await ensureHeaderYears();
  const sel = document.getElementById('global-year-select');
  if (sel) {
    sel.innerHTML = list.map(y => `<option value="${y.id}">${Utils.escapeHtml(y.name)} ${y.status === 'active' ? '(System)' : ''}</option>`).join('');
    sel.value = getActiveYearId(list) || '';
    const lbl = document.getElementById('acad-year-label');
    if (lbl) lbl.style.display = 'inline';
  }
  registerRoutes();
  Router.init();
  if (typeof Realtime !== 'undefined') Realtime.init();
  if (typeof refreshNotificationBadge === 'function') refreshNotificationBadge();
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
  Router.register('admin/import-history', renderImportHistory);
  Router.register('admin/reports', renderReportCenter || (() => { setHeader('Report Center', 'Reporting System'); setContent('<div class="card"><div class="card-body"><p>Report Center loading...</p></div></div>'); }));
  Router.register('admin/analytics', renderAnalytics);
  Router.register('admin/audit-logs', renderAuditLogs || (() => { setHeader('Audit Logs', 'Audit log viewer'); setContent('<div class="card"><div class="card-body"><p>Coming soon.</p></div></div>'); }));
  Router.register('admin/documents', renderDocuments);
  Router.register('admin/settings', renderSettings || (() => { setHeader('School Settings', 'Configure school settings'); setContent('<div class="card"><div class="card-body"><p>Settings module under development.</p></div></div>'); }));

  Router.register('teacher/dashboard', renderTeacherDashboard);
  Router.register('teacher/my-classes', renderMyClasses);
  Router.register('teacher/my-subjects', renderMySubjects);
  Router.register('teacher/enter-marks', renderEnterMarks);
  Router.register('teacher/import-marks', () => { setHeader('Import Marks', 'Bulk import learner marks from Excel, CSV, Word or PDF'); MarksImport.open(); });
  Router.register('teacher/submitted-marks', renderSubmittedMarks);
  Router.register('teacher/reports', renderTeacherReports || (() => { setHeader('Reports', 'Reports'); setContent('<div class="card"><div class="card-body"><p>Reports module is being updated.</p></div></div>'); }));
  Router.register('teacher/analytics', renderTeacherAnalytics);
  Router.register('teacher/notifications', renderNotifications);
  Router.register('teacher/account', renderTeacherAccount);
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
    if (typeof Realtime !== 'undefined') Realtime.stop();
    window.location.hash = '';
    document.getElementById('app-layout').style.display = 'none';
    showLogin();
  }
};

document.addEventListener('DOMContentLoaded', initApp);