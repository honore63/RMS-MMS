const Sidebar = {
  STORAGE_KEY: 'rms_sidebar_state',

  isSmall() {
    return window.innerWidth <= 768;
  },

  isDrawerOpen() {
    const sb = document.getElementById('sidebar');
    return !!sb && sb.classList.contains('open');
  },

  isHidden() {
    return document.getElementById('app-layout').classList.contains('sidebar-hidden');
  },

  init() {
    this.applyState();
    this.updateToggleBtn();

    if (this._initialized) return;
    this._initialized = true;

    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'b' || e.key === 'B')) {
        const layout = document.getElementById('app-layout');
        if (layout && layout.style.display !== 'none') {
          e.preventDefault();
          this.toggle();
        }
      }
    });

    window.addEventListener('resize', () => {
      this.closeMobile();
      if (this.isSmall()) {
        document.getElementById('app-layout').classList.remove('sidebar-hidden');
      } else {
        this.applyState();
      }
    });
  },

  render(role) {
    const menu = role === 'dos' ? this.adminMenu() : this.teacherMenu();
    const user = Auth.currentUser;
    const initials = Utils.initials(user?.full_name);
    document.getElementById('sidebar').innerHTML = `
      <div class="sidebar-header">
        <div class="sidebar-logo">
          <img src="public/logo.webp" alt="RMS Logo" style="width:100%;height:100%;object-fit:contain;background:#fff;border-radius:8px;padding:3px">
        </div>
        <div class="sidebar-brand">
          <h3>RMS-MIS</h3>
          <p>Rukara Model School<br>Marks Information System</p>
        </div>
        <button class="sidebar-toggle" onclick="Sidebar.toggle()" aria-label="Close navigation"><i data-lucide="x"></i></button>
      </div>
      <nav class="sidebar-nav" id="sidebar-nav">${menu}</nav>
      <div class="sidebar-user">
        <div class="user-avatar">${initials}</div>
        <div class="user-info">
          <div class="name">${Utils.escapeHtml(user?.full_name || '')}</div>
          <div class="role">${user?.role || ''}</div>
        </div>
        ${role === 'dos' ? `<button class="btn-logout" onclick="Router.go('admin/settings')" title="Settings" aria-label="Settings"><i data-lucide="settings"></i></button>` : ''}
        <button class="btn-logout" onclick="App.logout()" title="Sign Out" aria-label="Sign Out"><i data-lucide="log-out"></i></button>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    if (this.isSmall()) {
      this.closeMobile();
    }
    this.highlight();
  },

  adminMenu() {
    return `
      <a class="nav-link" data-route="admin/dashboard" onclick="Router.go('admin/dashboard')">
        <i data-lucide="layout-dashboard"></i> Dashboard</a>
      <div class="sidebar-section">
        <div class="sidebar-section-title">School Management</div>
        <a class="nav-link" data-route="admin/classes" onclick="Router.go('admin/classes')">
          <i data-lucide="school"></i> Class Management</a>
        <a class="nav-link" data-route="admin/subjects" onclick="Router.go('admin/subjects')">
          <i data-lucide="book-open"></i> Subject Management</a>
        <a class="nav-link" data-route="admin/academic" onclick="Router.go('admin/academic')">
          <i data-lucide="calendar"></i> Academic Setup</a>
        <a class="nav-link" data-route="admin/teachers" onclick="Router.go('admin/teachers')">
          <i data-lucide="users"></i> Teachers</a>
        <a class="nav-link" data-route="admin/learners" onclick="Router.go('admin/learners')">
          <i data-lucide="user-check"></i> Learners</a>
        <a class="nav-link" data-route="admin/assignments" onclick="Router.go('admin/assignments')">
          <i data-lucide="link"></i> Assignments</a>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Evaluations & Reports</div>
        <a class="nav-link" data-route="admin/assessments" onclick="Router.go('admin/assessments')">
          <i data-lucide="file-text"></i> Assessments</a>
        <a class="nav-link" data-route="admin/marks" onclick="Router.go('admin/marks')">
          <i data-lucide="list-checks"></i> Marks</a>
        <a class="nav-link" data-route="admin/import-marks" onclick="Router.go('admin/import-marks')">
          <i data-lucide="file-up"></i> Import Marks</a>
        <a class="nav-link" data-route="admin/import-history" onclick="Router.go('admin/import-history')">
          <i data-lucide="archive"></i> Import History</a>
        <a class="nav-link" data-route="admin/reports" onclick="Router.go('admin/reports')">
          <i data-lucide="bar-chart-3"></i> Reports</a>
        <a class="nav-link" data-route="admin/documents" onclick="Router.go('admin/documents')">
          <i data-lucide="folder-open"></i> Documents</a>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-title">System Insights</div>
        <a class="nav-link" data-route="admin/analytics" onclick="Router.go('admin/analytics')">
          <i data-lucide="trending-up"></i> Analytics</a>
        <a class="nav-link" data-route="admin/audit-logs" onclick="Router.go('admin/audit-logs')">
          <i data-lucide="history"></i> Audit Logs</a>
      </div>`;
  },

  teacherMenu() {
    return `
      <a class="nav-link" data-route="teacher/dashboard" onclick="Router.go('teacher/dashboard')">
        <i data-lucide="layout-dashboard"></i> Dashboard</a>
      <a class="nav-link" data-route="teacher/enter-marks" onclick="Router.go('teacher/enter-marks')">
        <i data-lucide="clipboard-list"></i> Marks Recording</a>
      <a class="nav-link" data-route="teacher/import-marks" onclick="Router.go('teacher/import-marks')">
        <i data-lucide="file-up"></i> Import Marks</a>
      <div class="sidebar-section">
        <div class="sidebar-section-title">My Teaching</div>
        <a class="nav-link" data-route="teacher/my-classes" onclick="Router.go('teacher/my-classes')">
          <i data-lucide="school"></i> My Classes</a>
        <a class="nav-link" data-route="teacher/my-subjects" onclick="Router.go('teacher/my-subjects')">
          <i data-lucide="book-marked"></i> My Subjects</a>
      </div>
      <a class="nav-link" data-route="teacher/reports" onclick="Router.go('teacher/reports')">
        <i data-lucide="bar-chart-3"></i> Reports</a>
      <a class="nav-link" data-route="teacher/notifications" onclick="Router.go('teacher/notifications')">
        <i data-lucide="bell"></i> Notifications <span class="nav-badge" id="notif-badge"></span></a>
      <div class="sidebar-section">
        <div class="sidebar-section-title">Account</div>
        <a class="nav-link" data-route="teacher/account" onclick="Router.go('teacher/account')">
          <i data-lucide="user-cog"></i> My Account</a>
      </div>`;
  },

  highlight() {
    const route = Router.current;
    document.querySelectorAll('.nav-link').forEach(l => {
      l.classList.toggle('active', l.dataset.route === route);
    });
  },

  toggle() {
    if (this.isSmall()) {
      const sb = document.getElementById('sidebar');
      const willOpen = !sb.classList.contains('open');
      sb.classList.toggle('open', willOpen);
      document.getElementById('app-layout').classList.toggle('sb-mobile-open', willOpen);
    } else {
      const layout = document.getElementById('app-layout');
      const hidden = layout.classList.toggle('sidebar-hidden');
      try {
        localStorage.setItem(this.STORAGE_KEY, hidden ? 'collapsed' : 'expanded');
      } catch (err) { /* storage unavailable */ }
    }
    this.updateToggleBtn();
  },

  closeMobile() {
    const sb = document.getElementById('sidebar');
    if (sb) sb.classList.remove('open');
    document.getElementById('app-layout').classList.remove('sb-mobile-open');
    this.updateToggleBtn();
  },

  applyState() {
    let saved = null;
    try {
      saved = localStorage.getItem(this.STORAGE_KEY);
    } catch (err) { /* storage unavailable */ }
    document.getElementById('app-layout').classList.toggle('sidebar-hidden', !this.isSmall() && saved === 'collapsed');
    this.updateToggleBtn();
  },

  updateToggleBtn() {
    const btn = document.getElementById('sidebar-toggle');
    const layout = document.getElementById('app-layout');
    if (!btn || !layout) return;
    const drawerOpen = this.isDrawerOpen();
    const hidden = !this.isSmall() && layout.classList.contains('sidebar-hidden');
    const open = drawerOpen || !hidden;

    btn.setAttribute('aria-controls', 'sidebar');
    btn.setAttribute('aria-expanded', String(open));

    const icon = btn.querySelector('i');
    if (this.isSmall()) {
      btn.setAttribute('aria-label', drawerOpen ? 'Close navigation' : 'Open navigation');
      btn.title = drawerOpen ? 'Close navigation' : 'Open navigation';
      if (icon) icon.setAttribute('data-lucide', drawerOpen ? 'panel-left-close' : 'menu');
    } else {
      btn.setAttribute('aria-label', hidden ? 'Expand sidebar' : 'Collapse sidebar');
      btn.title = hidden ? 'Expand sidebar' : 'Collapse sidebar';
      if (icon) icon.setAttribute('data-lucide', hidden ? 'panel-left-open' : 'panel-left-close');
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
};