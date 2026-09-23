const DB = {
  _cache: new Map(),
  _cacheTtl: 5 * 60 * 1000,
  _pending: new Map(),

  applyFilters(query, filters = {}) {
    let q = query;
    for (const [key, value] of Object.entries(filters)) {
      if (value === undefined || value === null || value === 'all') continue;
      q = Array.isArray(value) ? q.in(key, value) : q.eq(key, value);
    }
    return q;
  },

  _cacheKey(table, select, filters, order, limit) {
    return `${table}:${select}:${JSON.stringify(filters)}:${order?.column||''}:${order?.asc||''}:${limit||''}`;
  },

  _getCached(key) {
    const entry = this._cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > this._cacheTtl) {
      this._cache.delete(key);
      return null;
    }
    return entry.data;
  },

  _setCache(key, data) {
    this._cache.set(key, { data, ts: Date.now() });
  },

  invalidate(table) {
    if (!table) { this._cache.clear(); return; }
    for (const key of this._cache.keys()) {
      if (key.startsWith(`${table}:`)) this._cache.delete(key);
    }
  },

  async get(table, filters = {}, opts = {}) {
    const { cache = true, select = '*' } = opts;
    const key = cache ? this._cacheKey(table, select, filters, null, null) : null;
    if (key) {
      const cached = this._getCached(key);
      if (cached) return cached;
    }
    try {
      const q = this.applyFilters(sbClient.from(table).select(select), filters);
      const { data, error } = await q;
      if (error) throw error;
      const result = data || [];
      if (key) this._setCache(key, result);
      return result;
    } catch (e) {
      if (e?.code === '42P01' || e?.status === 404 || e?.message?.includes('does not exist') || e?.message?.includes('not found')) {
        return [];
      }
      throw e;
    }
  },

  async getRelated(table, select, filters = {}, opts = {}) {
    const { cache = true } = opts;
    const key = cache ? this._cacheKey(table, select, filters, null, null) : null;
    if (key) {
      const cached = this._getCached(key);
      if (cached) return cached;
    }
    try {
      const q = this.applyFilters(sbClient.from(table).select(select), filters);
      const { data, error } = await q;
      if (error) throw error;
      const result = data || [];
      if (key) this._setCache(key, result);
      return result;
    } catch (e) {
      if (e?.code === '42P01' || e?.status === 404 || e?.message?.includes('does not exist') || e?.message?.includes('not found')) {
        return [];
      }
      throw e;
    }
  },

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

  async query(table, select, filters = {}, order = null, limit = null, opts = {}) {
    const { cache = true } = opts;
    const key = cache ? this._cacheKey(table, select, filters, order, limit) : null;
    if (key) {
      const cached = this._getCached(key);
      if (cached) return cached;
    }
    try {
      let q = this.applyFilters(sbClient.from(table).select(select), filters);
      if (order) q = q.order(order.column, { ascending: order.asc ?? false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      const result = data || [];
      if (key) this._setCache(key, result);
      return result;
    } catch (e) {
      if (e?.code === '42P01' || e?.status === 404 || e?.message?.includes('does not exist') || e?.message?.includes('not found')) {
        return [];
      }
      throw e;
    }
  },

  async count(table, filters = {}) {
    const q = this.applyFilters(sbClient.from(table).select('id', { count: 'exact', head: true }), filters);
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  },

  async getOnce(table, select, filters = {}) {
    return this.query(table, select, filters, null, null, { cache: false });
  }
};
