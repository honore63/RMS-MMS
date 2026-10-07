const Router = {
  current: '',
  routes: {},
  prefetchers: {},
  _prefetched: new Set(),
  _initialized: false,
  _pendingHash: null,
  _lastHash: '',
  beforeNavigate: null,

  register(path, handler) {
    this.routes[path] = handler;
  },

  registerPrefetch(path, loader) {
    this.prefetchers[path] = loader;
  },

  clearPrefetch() {
    this._prefetched.clear();
  },

  async go(path) {
    const destination = String(path || '').split('?')[0];
    const current = this.current || window.location.hash.slice(1).split('?')[0];
    const currentHash = this._lastHash || window.location.hash.slice(1);
    if (current && (current !== destination || currentHash !== String(path)) && this.beforeNavigate) {
      const allowed = await this.beforeNavigate(current, path);
      if (allowed === false) return false;
    }
    this.current = path;
    if (window.location.hash.slice(1) !== path) this._pendingHash = path;
    window.location.hash = path;
    return this.render();
  },

  prefetch(path) {
    const route = String(path || '').split('?')[0];
    const loader = this.prefetchers[route];
    const userId = typeof Auth !== 'undefined' ? Auth.currentUser?.id : null;
    const key = `${userId || 'anon'}:${route}`;
    if (!loader || !userId || this._prefetched.has(key)) return;
    this._prefetched.add(key);
    const schedule = () => {
      if (typeof Auth === 'undefined' || Auth.currentUser?.id !== userId) {
        this._prefetched.delete(key);
        return;
      }
      Promise.resolve().then(loader).catch(error => {
        this._prefetched.delete(key);
        if (typeof DB !== 'undefined' && DB.debug) {
          console.warn(`[Router prefetch failed] ${route}:`, error);
        }
      });
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(schedule, { timeout: 1200 });
    else setTimeout(schedule, 0);
  },

  async render() {
    const fullRoute = this.current || window.location.hash.slice(1);
    const route = fullRoute.split('?')[0];
    if (!route) return;
    this.current = route;
    this._lastHash = fullRoute;
    if (!['admin/notifications', 'teacher/notifications'].includes(route)
        && typeof NotificationCenter !== 'undefined') {
      NotificationCenter.hideCenter();
    }
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
    if (!this._initialized) {
      window.addEventListener('hashchange', async () => {
        const target = window.location.hash.slice(1);
        if (this._pendingHash === target) {
          this._pendingHash = null;
          return;
        }
        const destination = target.split('?')[0];
        const current = this.current.split('?')[0];
        const previousHash = this._lastHash || current;
        if (current && destination && previousHash !== target && this.beforeNavigate) {
          const allowed = await this.beforeNavigate(previousHash, target);
          if (allowed === false) {
            this._pendingHash = previousHash || this.current;
            window.location.hash = this._pendingHash;
            return;
          }
        }
        this.current = target;
        this._lastHash = target;
        this.render();
      });
      document.addEventListener('pointerover', event => {
        const link = event.target.closest?.('[data-route]');
        if (link) this.prefetch(link.dataset.route);
      }, { passive: true });
      document.addEventListener('focusin', event => {
        const link = event.target.closest?.('[data-route]');
        if (link) this.prefetch(link.dataset.route);
      });
      this._initialized = true;
    }
    const route = window.location.hash.slice(1);
    if (route) {
      this.current = route;
      this._lastHash = route;
    }
  }
};
