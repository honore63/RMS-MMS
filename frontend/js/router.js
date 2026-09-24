const Router = {
  current: '',
  routes: {},

  register(path, handler) {
    this.routes[path] = handler;
  },

  go(path) {
    this.current = path;
    window.location.hash = path;
    this.render();
  },

  async render() {
    const fullRoute = this.current || window.location.hash.slice(1);
    const route = fullRoute.split('?')[0];
    if (!route) return;
    this.current = route;
    const handler = this.routes[route];
    if (handler) {
      Sidebar.highlight();
      if (typeof Sidebar.isSmall === 'function' && Sidebar.isSmall()) {
        Sidebar.closeMobile();
      }
      try {
        await handler();
      } catch (e) {
        console.error('[Router] failed to render "' + route + '":', e);
        this.showError(e);
        if (typeof Utils !== 'undefined') Utils.toast('Failed to load page: ' + this.errorText(e), 'error');
      }
    }
  },

  errorText(e) {
    if (!e) return 'Unknown error';
    const msg = typeof e.message === 'string' ? e.message : '';
    const det = typeof e.details === 'string' ? e.details : '';
    const text = [msg, det].filter(Boolean)[0] || 'Unknown error';
    return text + (e.code ? ' (' + e.code + ')' : '');
  },

  showError(e) {
    const raw = this.errorText(e);
    const safe = typeof Utils !== 'undefined' && Utils.escapeHtml
      ? Utils.escapeHtml(raw) : String(raw).replace(/[<>&]/g, '');
    const notice = /does not exist|PGRST205|42P01/i.test(raw)
      ? '<div class="alert alert-warning" style="text-align:left;margin-bottom:20px"><i data-lucide="info"></i> This page needs SQL that has not been run in Supabase yet. Open the <strong>SQL Editor</strong> and run the migration files from <strong>backend/sql/</strong>.</div>'
      : '<div class="alert alert-warning" style="text-align:left;margin-bottom:20px"><i data-lucide="info"></i> Make sure you are online and Supabase is reachable, then try again.</div>';
    const html = `
      <div class="card" style="max-width:560px;margin:40px auto">
        <div style="padding:32px;text-align:center">
          <div style="width:52px;height:52px;margin:0 auto 14px;border-radius:50%;background:var(--amber-50);color:var(--amber-500);display:flex;align-items:center;justify-content:center"><i data-lucide="cloud-off" style="width:24px;height:24px"></i></div>
          <h3 style="margin:0 0 8px">Could not reach the database</h3>
          <p class="text-sm text-muted" style="margin:0 0 16px">${safe}</p>
          ${notice}
          <button class="btn btn-primary" onclick="Router.render()"><i data-lucide="refresh-cw"></i> Try Again</button>
        </div>
      </div>`;
    if (typeof setContent === 'function') setContent(html);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  init() {
    window.addEventListener('hashchange', () => this.render());
    const route = window.location.hash.slice(1);
    if (route) {
      this.current = route;
    }
  }
};
