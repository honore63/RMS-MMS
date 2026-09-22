const DB = {
  async get(table, filters = {}) {
    try {
      let q = sbClient.from(table).select('*');
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== 'all') q = q.eq(k, v);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      if (e?.code === '42P01' || e?.status === 404 || e?.message?.includes('does not exist') || e?.message?.includes('not found')) {
        return [];
      }
      throw e;
    }
  },

  async getRelated(table, select, filters = {}) {
    try {
      let q = sbClient.from(table).select(select);
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== 'all') q = q.eq(k, v);
      }
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
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
    return data?.[0];
  },

  async update(table, id, row) {
    const { data, error } = await sbClient.from(table).update(row).eq('id', id).select();
    if (error) throw error;
    return data?.[0];
  },

  async remove(table, id) {
    const { error } = await sbClient.from(table).delete().eq('id', id);
    if (error) throw error;
  },

  async query(table, select, filters = {}, order = null, limit = null) {
    try {
      let q = sbClient.from(table).select(select);
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== 'all') q = q.eq(k, v);
      }
      if (order) q = q.order(order.column, { ascending: order.asc ?? false });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    } catch (e) {
      if (e?.code === '42P01' || e?.status === 404 || e?.message?.includes('does not exist') || e?.message?.includes('not found')) {
        return [];
      }
      throw e;
    }
  },

  async count(table, filters = {}) {
    let q = sbClient.from(table).select('id', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filters)) {
      if (v !== undefined && v !== null && v !== 'all') q = q.eq(k, v);
    }
    const { count, error } = await q;
    if (error) throw error;
    return count || 0;
  }
};
