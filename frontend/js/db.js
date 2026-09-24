/* ============================================================
   DB — Centralized data-access + cache layer (RMS-MIS)
   • Per-table TTLs (config short-lived, marks very short)
   • Cache keys include table, user scope, select, filters, order, limit
   • Stale-while-revalidate for reference/dashboard data only
   • In-flight request deduplication
   • Write-through invalidation (insert/update/remove)
   • User-scoped cache isolation + clearUserCache on auth change
   • Debug logging + getStats()
   RLS remains authoritative — cache never bypasses Supabase security.
   ============================================================ */

const DB = {
  _cache: new Map(),          // key -> { data, ts, table }
  _pending: new Map(),        // key -> Promise (request dedup)
  _uid: null,                 // auth user scope for cache keys
  _gen: 0,                    // generation: bump clears without race
  debug: false,               // set true to log [CACHE HIT/MISS/...]
  _stats: { hits: 0, misses: 0, sets: 0, invalidations: 0, avoided: 0, swr: 0, network: 0, errors: 0 },

  /* Per-table TTL (ms). Frequently changing data = shorter. */
  TTL: {
    school_settings: 30 * 60 * 1000,
    grading_scales: 30 * 60 * 1000,
    academic_years: 30 * 60 * 1000,
    terms: 30 * 60 * 1000,
    assessment_types: 30 * 60 * 1000,
    performance_comments: 10 * 60 * 1000,
    subjects: 10 * 60 * 1000,
    classes: 10 * 60 * 1000,
    teachers: 10 * 60 * 1000,
    users: 5 * 60 * 1000,
    documents: 5 * 60 * 1000,
    learners: 5 * 60 * 1000,
    teacher_assignments: 5 * 60 * 1000,
    assessments: 2 * 60 * 1000,
    marks: 60 * 1000,
    audit_logs: 60 * 1000,
    import_history: 60 * 1000,
    notifications: 30 * 1000
  },
  DEFAULT_TTL: 5 * 60 * 1000,

  /* Tables allowed to serve slightly stale data while revalidating in background.
     NEVER marks, assessments, notifications, audit_logs (critical / high-churn). */
  SWR_TABLES: new Set([
    'school_settings', 'grading_scales', 'academic_years', 'terms',
    'assessment_types', 'subjects', 'classes', 'teachers', 'users',
    'learners', 'teacher_assignments', 'performance_comments', 'documents'
  ]),

  /* ---------- internals ---------- */

  _log(action, key) {
    if (!this.debug) return;
    try { console.log(`[CACHE ${action}] ${key}`); } catch (e) { /* noop */ }
  },

  _ttlFor(table) {
    return this.TTL[table] ?? this.DEFAULT_TTL;
  },

  applyFilters(query, filters = {}) {
    let q = query;
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === 'all') continue;
      if (Array.isArray(value)) {
        if (!value.length) continue;
        q = q.in(key, value);
      } else {
        q = q.eq(key, value);
      }
    }
    return q;
  },

  _cacheKey(table, select, filters, order, limit) {
    const uid = this._uid || 'anon';
    return `${table}:${uid}:${select}:${JSON.stringify(filters || {})}:${order?.column || ''}:${order?.asc || ''}:${limit || ''}`;
  },

  _setCache(key, table, data) {
    this._cache.set(key, { data, ts: Date.now(), table });
    this._stats.sets++;
    this._log('SET', key);
  },

  /* Fresh entry within TTL, or (for SWR tables) stale-but-usable within 2×TTL. */
  _read(key, table) {
    const entry = this._cache.get(key);
    if (!entry || entry.table !== table) return null;
    const age = Date.now() - entry.ts;
    const ttl = this._ttlFor(table);
    if (age < ttl) {
      this._stats.hits++;
      this._stats.avoided++;
      this._log('HIT', key);
      return { data: entry.data, stale: false };
    }
    if (this.SWR_TABLES.has(table) && age < ttl * 2) {
      this._stats.hits++;
      this._stats.swr++;
      this._stats.avoided++;
      this._log('SWR', key);
      return { data: entry.data, stale: true };
    }
    if (entry) this._cache.delete(key);
    return null;
  },

  /* Deduplicate identical in-flight Supabase requests. */
  _dedup(key, runner) {
    const existing = this._pending.get(key);
    if (existing) {
      this._stats.avoided++;
      this._log('DEDUP', key);
      return existing;
    }
    const gen = this._gen;
    const p = (async () => {
      try {
        this._stats.network++;
        const result = await runner();
        if (this._gen === gen) return result;
        /* user changed mid-flight — do not cache or return cross-user data */
        throw new Error('DB cache generation changed');
      } finally {
        if (this._pending.get(key) === p) this._pending.delete(key);
      }
    })();
    this._pending.set(key, p);
    return p;
  },

  async _runQuery(table, select, filters, order, limit) {
    try {
      let q = this.applyFilters(sbClient.from(table).select(select), filters);
      if (order) q = q.order(order.column, { ascending: order.asc ?? false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      this._stats.errors++;
      if (e?.code === '42P01' || e?.status === 404 || e?.message?.includes('does not exist') || e?.message?.includes('not found')) {
        return [];
      }
      throw e;
    }
  },

  _revalidate(key, table, select, filters, order, limit) {
    if (this._pending.has(key)) return;
    const gen = this._gen;
    this._log('REFRESH', key);
    this._dedup(key, async () => {
      const result = await this._runQuery(table, select, filters, order, limit);
      if (this._gen === gen) this._setCache(key, table, result);
      return result;
    }).catch(() => { /* background refresh must never throw */ });
  },

  /* Unified read path used by get / getRelated / query / getFresh. */
  async _select(table, select, filters, order, limit, opts = {}) {
    const { cache = true, fresh = false } = opts;
    const key = this._cacheKey(table, select, filters, order, limit);

    if (cache && !fresh) {
      const hit = this._read(key, table);
      if (hit) {
        if (hit.stale) this._revalidate(key, table, select, filters, order, limit);
        return hit.data;
      }
    } else if (fresh) {
      this._log('FRESH', key);
    } else {
      this._log('MISS', key);
    }

    if (!cache) this._log('BYPASS', key);
    else this._stats.misses++;

    return this._dedup(key, async () => {
      const result = await this._runQuery(table, select, filters, order, limit);
      if (cache) this._setCache(key, table, result);
      return result;
    });
  },

  /* ---------- public API ---------- */

  /* Cached read (default). Returns [] on missing table. */
  async get(table, filters = {}, opts = {}) {
    return this._select(table, opts.select || '*', filters, null, null, opts);
  },

  /* Alias for get() — explicit “cache-first read” naming. */
  async getCached(table, filters = {}, opts = {}) {
    return this.get(table, filters, opts);
  },

  /* Same as get — kept for existing call sites. */
  async getRelated(table, select, filters = {}, opts = {}) {
    return this._select(table, select, filters, null, null, opts);
  },

  /* Cached query with order/limit. */
  async query(table, select, filters = {}, order = null, limit = null, opts = {}) {
    return this._select(table, select, filters, order, limit, opts);
  },

  /* Force a fresh Supabase read (still stores result for later reuse). */
  async getFresh(table, filters = {}, opts = {}) {
    return this._select(table, opts.select || '*', filters, null, null, { ...opts, cache: true, fresh: true });
  },

  async getFreshQuery(table, select, filters = {}, order = null, limit = null, opts = {}) {
    return this._select(table, select, filters, order, limit, { ...opts, cache: true, fresh: true });
  },

  /* Alias used by reports: invalidate + force next read to hit network. */
  refresh(...tables) {
    if (!tables.length) { this._cache.clear(); return; }
    tables.forEach(t => this.invalidate(t));
  },

  /* Invalidate every cache entry for a table (partial key match by table field). */
  invalidate(table) {
    if (!table) { this._cache.clear(); this._stats.invalidations++; this._log('CLEAR', '*'); return; }
    let n = 0;
    for (const [key, entry] of this._cache.entries()) {
      if (entry.table === table || key.startsWith(`${table}:`)) {
        this._cache.delete(key);
        n++;
      }
    }
    if (n) {
      this._stats.invalidations += n;
      this._log('INVALIDATE', `${table} (${n})`);
    }
  },

  /* Explicit alias */
  invalidateTable(table) { this.invalidate(table); },

  /* Invalidate several related tables at once (write dependency graph). */
  invalidateMany(tables = []) {
    (tables || []).forEach(t => this.invalidate(t));
  },

  /* Drop everything (no args) — same as invalidate(). */
  clear() { this.invalidate(); },

  /* Call on login / logout / user switch — prevents cross-user data leaks. */
  clearUserCache() {
    this._gen++;
    this._cache.clear();
    this._pending.clear();
    this._uid = null;
    this._log('CLEAR_USER', '*');
  },

  setUserScope(userId) {
    const id = userId || null;
    if (id !== this._uid) {
      this.clearUserCache();
      this._uid = id;
    }
  },

  has(table) {
    if (!table) return this._cache.size > 0;
    for (const entry of this._cache.values()) {
      if (entry.table === table) return true;
    }
    return false;
  },

  getStats() {
    const tables = {};
    for (const entry of this._cache.values()) {
      tables[entry.table] = (tables[entry.table] || 0) + 1;
    }
    return {
      ...this._stats,
      size: this._cache.size,
      pending: this._pending.size,
      userScope: this._uid,
      generation: this._gen,
      tables
    };
  },

  /* Background prewarm of common reference datasets (fire-and-forget). */
  warm(tables = []) {
    tables.forEach(t => {
      this.get(t).catch(() => { /* prewarm must never break the page */ });
    });
  },

  /* Count with dedup (not stored — badge/counts stay fresh). */
  async count(table, filters = {}) {
    const key = `count:${this._cacheKey(table, 'id', filters, null, null)}`;
    return this._dedup(key, async () => {
      try {
        const q = this.applyFilters(sbClient.from(table).select('id', { count: 'exact', head: true }), filters);
        const { count, error } = await q;
        if (error) throw error;
        return count || 0;
      } catch (e) {
        if (e?.code === '42P01' || e?.status === 404) return 0;
        throw e;
      }
    });
  },

  /* Uncached single read (existing helper). */
  async getOnce(table, select, filters = {}) {
    return this._select(table, select, filters, null, null, { cache: false });
  },

  /* ---------- writes (always invalidate affected table) ---------- */

  async insert(table, row) {
    const { data, error } = await sbClient.from(table).insert([row]).select();
    if (error) throw error;
    this.invalidate(table);
    return data?.[0];
  },

  async update(table, id, row) {
    const { data, error } = await sbClient.from(table).update(row).eq('id', id).select();
    if (error) throw error;
    this.invalidate(table);
    return data?.[0];
  },

  async remove(table, id) {
    const { error } = await sbClient.from(table).delete().eq('id', id);
    if (error) throw error;
    this.invalidate(table);
  },

  /* Alias — some pages call DB.delete */
  delete(table, id) { return this.remove(table, id); }
};

/* Expose for console debugging: DB.getStats(), DB.debug = true */
if (typeof window !== 'undefined') window.DB = DB;
