/* ============================================================
   REALTIME SYNC — Centralized Supabase Realtime subscription manager
   Single source of truth is Supabase. This service:
     1. Opens ONE channel subscribed to every shared table.
     2. Fans out INSERT/UPDATE/DELETE events to registered handlers.
      3. Invalidates affected data caches when shared tables change.
      4. Leaves page refreshes under explicit user control.
   No duplicate subscriptions: one channel, one listener per table.
   ============================================================ */

const Realtime = {
  _channel: null,
  inited: false,
  _handlers: {},       /* table -> Set<fn(payload)> */
  _routes: {},         /* baseRoute -> { tables:Set, guard:fn|null } */
  _pending: new Set(),
  _pollTimer: null,

  /* Every shared table that drives the UI (spec: learners, teachers,
     classes, subjects, academic_years, terms, teacher_assignments,
     assessments, marks, grading_scales, school_settings,
     notifications, audit_logs). */
  TABLES: [
    'users',
    'teachers',
    'learners',
    'classes',
    'subjects',
    'academic_years',
    'terms',
    'teacher_assignments',
    'assessments',
    'assessment_types',
    'marks',
    'grading_scales',
    'school_settings',
    'notifications',
    'audit_logs'
  ],

  init() {
    if (this.inited) return;
    const client = typeof sbClient !== 'undefined' ? sbClient : window.sbClient;
    if (!client || typeof client.channel !== 'function') {
      console.warn('[Realtime] Supabase client not available, realtime disabled');
      return;
    }
    this.inited = true;

    try {
      this._channel = sbClient.channel('rms-realtime-sync');
      this.TABLES.forEach(t => {
        this._channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: t },
          payload => this._fire(t, payload)
        );
      });
      this._channel.subscribe(status => {
        if (status !== 'SUBSCRIBED') {
          console.warn('[Realtime] channel status:', status);
        }
      });
    } catch (e) {
      console.warn('[Realtime] init error:', e);
    }

  },

  stop() {
    if (this._channel) {
      try { sbClient.removeChannel(this._channel); } catch (e) { /* noop */ }
      this._channel = null;
    }
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    this.inited = false;
    this._pending.clear();
  },

  /* Register a handler for a specific table's changes. */
  on(table, fn) {
    if (!this._handlers[table]) this._handlers[table] = new Set();
    this._handlers[table].add(fn);
    return fn;
  },

  off(table, fn) {
    const s = this._handlers[table];
    if (s) s.delete(fn);
  },

  /* Register which tables a route depends on. When any of them change,
     the active route re-renders (unless an optional guard returns false). */
  route(baseRoute, tables, guard) {
    this._routes[baseRoute] = { tables: new Set(tables), guard: guard || null };
  },

  activeRoute() {
    return Router.current || (window.location.hash || '').slice(1);
  },

  baseRoute(route) {
    const i = route ? route.indexOf('?') : -1;
    return i >= 0 ? route.slice(0, i) : route || '';
  },

  _fire(table, payload) {
    const fns = this._handlers[table];
    if (fns) {
      fns.forEach(fn => {
        try { fn(payload); } catch (e) { console.error('[Realtime] handler:', e); }
      });
    }
  },

};