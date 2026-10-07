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
  _cache: new Map(),          // LRU key -> { data, ts, accessedAt, table, rows }
  _pending: new Map(),        // key -> Promise (request dedup)
  _tableGen: new Map(),       // table -> invalidation generation
  _uid: null,                 // auth user scope for cache keys
  _gen: 0,                    // generation: bump clears without race
  MAX_ENTRIES: 120,
  MAX_ENTRY_ROWS: 5000,
  MAX_CACHE_ROWS: 15000,
  debug: false,               // set true to log [CACHE HIT/MISS/...]
  _cacheRows: 0,
  _stats: {
    hits: 0, misses: 0, sets: 0, invalidations: 0, invalidatedEntries: 0,
    avoided: 0, deduplicated: 0, swr: 0, network: 0, errors: 0,
    evictions: 0, prefetches: 0, revalidations: 0,
    requestCount: 0, requestMsTotal: 0, slowRequests: 0, criticalRequests: 0
  },

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
    notifications: 30 * 1000,
    announcements: 60 * 1000,
    announcement_acknowledgements: 60 * 1000,
    teacher_registration_audit: 10 * 60 * 1000,
    email_notifications: 10 * 60 * 1000,
    sms_notifications: 10 * 60 * 1000
  },
  DEFAULT_TTL: 5 * 60 * 1000,

  /* Tables allowed to serve slightly stale data while revalidating in background.
     NEVER marks, assessments, notifications, audit_logs (critical / high-churn). */
  SWR_TABLES: new Set([
    'school_settings', 'grading_scales', 'academic_years', 'terms',
    'assessment_types', 'subjects', 'classes', 'teachers', 'users',
    'learners', 'teacher_assignments', 'performance_comments', 'documents',
    'teacher_registration_audit', 'email_notifications', 'sms_notifications'
  ]),

  /* ---------- internals ---------- */

  _log(action, key) {
    if (!this.debug) return;
    try { console.log(`[CACHE ${action}] ${key}`); } catch (e) { /* noop */ }
  },

  _ttlFor(table) {
    return this.TTL[table] ?? this.DEFAULT_TTL;
  },

  _stableValue(value) {
    if (Array.isArray(value)) {
      const unique = new Map(value.map(item => {
          const normalized = this._stableValue(item);
          return [JSON.stringify(normalized), normalized];
      }));
      return [...unique.entries()]
          .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
          .map(([, item]) => item);
    }
    if (value && typeof value === 'object') {
      return Object.keys(value).sort().reduce((result, key) => {
        result[key] = this._stableValue(value[key]);
        return result;
      }, {});
    }
    return value;
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
    const normalizedFilters = {};
    Object.keys(filters || {}).sort().forEach(key => {
      const value = filters[key];
      if (value !== undefined && value !== null && value !== 'all') {
        normalizedFilters[key] = this._stableValue(value);
      }
    });
    const normalizedOrder = order
      ? { column: order.column, ascending: order.asc == null ? false : Boolean(order.asc) }
      : null;
    return `${table}:${uid}:${select}:${JSON.stringify(normalizedFilters)}:${JSON.stringify(normalizedOrder)}:${limit > 0 ? limit : ''}`;
  },

  _deleteCache(key, eviction = false) {
    const entry = this._cache.get(key);
    if (!entry) return false;
    this._cache.delete(key);
    this._cacheRows = Math.max(0, this._cacheRows - entry.rows);
    if (eviction) this._stats.evictions++;
    return true;
  },

  _touchCache(key, entry) {
    entry.accessedAt = Date.now();
    this._cache.delete(key);
    this._cache.set(key, entry);
  },

  _setCache(key, table, data) {
    const rows = Array.isArray(data) ? data.length : 1;
    if (rows > this.MAX_ENTRY_ROWS) {
      this._deleteCache(key);
      this._log('SKIP_LARGE', `${table} (${rows} rows)`);
      return;
    }
    this._deleteCache(key);
    const now = Date.now();
    this._cache.set(key, { data, ts: now, accessedAt: now, table, rows });
    this._cacheRows += rows;
    this._stats.sets++;
    while (this._cache.size > this.MAX_ENTRIES || this._cacheRows > this.MAX_CACHE_ROWS) {
      const oldest = this._cache.keys().next();
      if (oldest.done) break;
      this._deleteCache(oldest.value, true);
    }
    this._log('SET', key);
  },

  /* Fresh entry within TTL, or (for SWR tables) stale-but-usable within 2×TTL. */
  _read(key, table) {
    const entry = this._cache.get(key);
    if (!entry || entry.table !== table) return null;
    const age = Date.now() - entry.ts;
    const ttl = this._ttlFor(table);
    if (age < ttl) {
      this._touchCache(key, entry);
      this._stats.hits++;
      this._stats.avoided++;
      this._log('HIT', key);
      return { data: entry.data, stale: false };
    }
    if (this.SWR_TABLES.has(table) && age < ttl * 2) {
      this._touchCache(key, entry);
      this._stats.hits++;
      this._stats.swr++;
      this._stats.avoided++;
      this._log('SWR', key);
      return { data: entry.data, stale: true };
    }
    this._deleteCache(key);
    return null;
  },

  /* Deduplicate identical in-flight Supabase requests. */
  _dedup(key, runner) {
    const existing = this._pending.get(key);
    if (existing) {
      this._stats.avoided++;
      this._stats.deduplicated++;
      this._log('DEDUP', key);
      return existing;
    }
    const gen = this._gen;
    const p = (async () => {
      const start = typeof performance !== 'undefined' && performance.now
        ? performance.now() : Date.now();
      try {
        this._stats.network++;
        const result = await runner();
        if (this._gen === gen) return result;
        /* user changed mid-flight — do not cache or return cross-user data */
        throw new Error('DB cache generation changed');
      } finally {
        const end = typeof performance !== 'undefined' && performance.now
          ? performance.now() : Date.now();
        const duration = Math.max(0, end - start);
        this._stats.requestCount++;
        this._stats.requestMsTotal += duration;
        if (duration >= 1000) this._stats.slowRequests++;
        if (duration >= 3000) this._stats.criticalRequests++;
        if (this.debug && duration >= 1000) {
          console.warn(`[DB slow request] ${key} ${Math.round(duration)}ms`);
        }
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
    const tableGen = this._tableGen.get(table) || 0;
    this._stats.revalidations++;
    this._log('REFRESH', key);
    this._dedup(key, async () => {
      const result = await this._runQuery(table, select, filters, order, limit);
      if (this._gen === gen && (this._tableGen.get(table) || 0) === tableGen) this._setCache(key, table, result);
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

    const tableGen = this._tableGen.get(table) || 0;
    const result = await this._dedup(key, async () => {
      const result = await this._runQuery(table, select, filters, order, limit);
      if (cache && (this._tableGen.get(table) || 0) === tableGen) this._setCache(key, table, result);
      return result;
    });
    if ((this._tableGen.get(table) || 0) !== tableGen && !opts._retriedAfterInvalidation) {
      return this._select(table, select, filters, order, limit, {
        ...opts, fresh: true, _retriedAfterInvalidation: true
      });
    }
    return result;
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
    if (!tables.length) { this.invalidate(); return; }
    tables.forEach(t => this.invalidate(t));
  },

  /* Invalidate every cache entry for a table (partial key match by table field). */
  invalidate(table) {
    if (!table) {
      const removed = this._cache.size + this._pending.size;
      this._gen++;
      this._cache.clear();
      this._cacheRows = 0;
      this._pending.clear();
      this._stats.invalidations++;
      this._stats.invalidatedEntries += removed;
      this._log('CLEAR', '*');
      return;
    }
    this._tableGen.set(table, (this._tableGen.get(table) || 0) + 1);
    let removed = 0;
    for (const [key, entry] of this._cache.entries()) {
      if (entry.table === table) {
        this._deleteCache(key);
        removed++;
      }
    }
    for (const key of this._pending.keys()) {
      if (key.startsWith(`${table}:`) || key.startsWith(`count:${table}:`)) {
        this._pending.delete(key);
        removed++;
      }
    }
    this._stats.invalidations++;
    this._stats.invalidatedEntries += removed;
    this._log('INVALIDATE', `${table} (${removed})`);
  },

  /* Explicit alias */
  invalidateTable(table) { this.invalidate(table); },

  /* Invalidate several related tables at once (write dependency graph). */
  invalidateMany(tables = []) {
    [...new Set(tables || [])].forEach(t => this.invalidate(t));
  },

  /* Drop everything (no args) — same as invalidate(). */
  clear() { this.invalidate(); },

  /* Call on login / logout / user switch — prevents cross-user data leaks. */
  clearUserCache(userId = null) {
    this._gen++;
    this._cache.clear();
    this._cacheRows = 0;
    this._pending.clear();
    this._uid = userId || null;
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
      cachedRows: this._cacheRows,
      pending: this._pending.size,
      hitRate: this._stats.hits + this._stats.misses
        ? this._stats.hits / (this._stats.hits + this._stats.misses)
        : 0,
      averageRequestMs: this._stats.requestCount
        ? this._stats.requestMsTotal / this._stats.requestCount
        : 0,
      userScope: this._uid,
      generation: this._gen,
      tables
    };
  },

  /* Background reads are bounded and deduplicated with normal page requests. */
  async prefetch(requests = []) {
    const specs = (requests || []).map(request => typeof request === 'string'
      ? { table: request }
      : request).filter(request => request && request.table);
    const safe = specs.filter(request => {
      const filters = request.filters || {};
      const large = ['learners', 'marks', 'assessments', 'audit_logs', 'notifications'];
      const hasEffectiveFilter = Object.values(filters).some(value =>
        value !== undefined && value !== null && value !== 'all'
          && (!Array.isArray(value) || value.length > 0));
      return !large.includes(request.table) || hasEffectiveFilter;
    });
    this._stats.prefetches += safe.length;
    const results = new Array(safe.length);
    let next = 0;
    const worker = async () => {
      while (next < safe.length) {
        const index = next++;
        const { table, filters = {}, opts = {} } = safe[index];
        try {
          results[index] = await this.get(table, filters, opts);
        } catch (error) {
          results[index] = null;
          if (this.debug) console.warn(`[DB prefetch failed] ${table}:`, error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, safe.length) }, worker));
    return results;
  },

  warm(tables = []) {
    return this.prefetch(tables);
  },

  /* Count with dedup (not stored — badge/counts stay fresh). */
  async count(table, filters = {}, retriedAfterInvalidation = false) {
    const key = `count:${this._cacheKey(table, 'id', filters, null, null)}`;
    const tableGen = this._tableGen.get(table) || 0;
    const result = await this._dedup(key, async () => {
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
    if (!retriedAfterInvalidation && (this._tableGen.get(table) || 0) !== tableGen) {
      return this.count(table, filters, true);
    }
    return result;
  },

  async getPage(table, select, filters = {}, order = null, from = 0, pageSize = 100, search = null) {
    if (!Number.isInteger(from) || from < 0 || !Number.isInteger(pageSize) || pageSize < 1) {
      throw new RangeError('Page offset and size must be non-negative integers, with a positive size.');
    }
    let query = this.applyFilters(
      sbClient.from(table).select(select),
      filters
    );
    const term = search && typeof search.term === 'string'
      ? search.term.trim().slice(0, 80).replace(/[^\p{L}\p{N}\s'-]/gu, '')
      : '';
    const columns = search && Array.isArray(search.columns)
      ? search.columns.filter(column => /^[a-z_][a-z0-9_]*$/i.test(column))
      : [];
    if (term && columns.length) {
      const pattern = `%${term}%`;
      query = query.or(columns.map(column => `${column}.ilike."${pattern}"`).join(','));
    }
    if (order) query = query.order(order.column, { ascending: order.asc ?? false });
    this._stats.network++;
    const { data, error } = await query.range(from, from + pageSize);
    if (error) {
      this._stats.errors++;
      throw error;
    }
    const rows = data || [];
    return {
      data: rows.slice(0, pageSize),
      hasMore: rows.length > pageSize
    };
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
