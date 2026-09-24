const ReportUtils = {
  _cache: new Map(),

  invalidate(key) {
    if (key) this._cache.delete(key);
    else this._cache.clear();
  },

  async getSettings() {
    if (this._cache.has('settings')) return this._cache.get('settings');
    try {
      const value = (await DB.query('school_settings', '*'))[0] || {};
      this._cache.set('settings', value);
      return value;
    } catch (e) {
      return {};
    }
  },

  async getScale() {
    if (this._cache.has('scale')) return this._cache.get('scale');
    const value = typeof getGrading === 'function' ? await getGrading() : await Utils.getGradingScale();
    this._cache.set('scale', value || []);
    return value || [];
  },

  calcPct(mark, max) {
    return Utils.pct(mark, max);
  },

  calcGrade(pct, scale) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.calculateGradeSync(pct, scale);
    }
    return Utils.gradeInfo(pct, scale);
  },

  calcRemark(pct, scale) {
    return Utils.remark(pct, scale);
  },

  calcPassFail(pct, passMark) {
    return Utils.passFail(pct, passMark);
  },

  calcClassStats(marks, maxMark, passMark) {
    const stats = Utils.classStats(marks, maxMark);
    stats.passMark = passMark || 50;
    return stats;
  },

  async classifyGrades(pcts, scale) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.classifyPercentages(pcts, scale);
    }
    return { ranges: [], total: pcts.length };
  },

  getGradeDistribution(grades, scale) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.getGradeDistribution(grades, scale);
    }
    const counts = {};
    grades.forEach(g => { if (g) counts[g] = (counts[g] || 0) + 1; });
    const total = grades.length;
    return (scale || []).map(r => ({
      grade: r.grade, descriptor: r.descriptor, range: `${r.minimum_percentage}–${r.maximum_percentage}%`,
      count: counts[r.grade] || 0, percentage: total > 0 ? Math.round(((counts[r.grade] || 0) / total) * 1000) / 10 : 0, isPass: r.is_pass
    }));
  },

  async computeStats(pcts, passMark) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.computeStats(pcts, passMark);
    }
    const valid = pcts.filter(p => p != null && !isNaN(p));
    if (!valid.length) return { total: 0, assessed: 0, passed: 0, failed: 0, passRate: 0, avg: 0, high: 0, low: 0 };
    const sum = valid.reduce((a, b) => a + b, 0);
    const passed = valid.filter(p => p >= (passMark || 50)).length;
    return { total: valid.length, assessed: valid.length, passed, failed: valid.length - passed, passRate: Math.round((passed / valid.length) * 1000) / 10, avg: Math.round((sum / valid.length) * 100) / 100, high: Math.max(...valid), low: Math.min(...valid) };
  },

  async getLearnerClass(learnerId) {
    const learner = await DB.get('learners', { id: learnerId }).then(r => r[0]);
    if (!learner) return null;
    const cls = await DB.get('classes', { id: learner.class_id }).then(r => r[0]);
    return { learner, cls };
  },

  getEducationCategory(cls) {
    return cls ? EducationLevels.getCategory(cls) : 'Lower Secondary';
  },

  isLevelMatch(learnerLevel, subjectLevel) {
    if (!subjectLevel || subjectLevel === 'Both') return true;
    const learnerCat = this.getEducationCategory(learnerLevel).toUpperCase();
    const subjCat = subjectLevel.trim().toUpperCase();
    return learnerCat.includes(subjCat) || subjCat.includes(learnerCat);
  },

  async getActiveYear() {
    if (this._cache.has('activeYear')) return this._cache.get('activeYear');
    const years = await DB.get('academic_years');
    const value = years.find(y => y.status === 'active') || years[0] || {};
    this._cache.set('activeYear', value);
    return value;
  },

  async getActiveTerm() {
    if (this._cache.has('activeTerm')) return this._cache.get('activeTerm');
    const terms = await DB.get('terms');
    const value = terms.find(t => t.status === 'active' || t.is_current) || terms[0] || {};
    this._cache.set('activeTerm', value);
    return value;
  },

  async getYear(id) {
    if (!id || typeof id === 'object') return id || {};
    const key = `year:${id}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const value = (await DB.get('academic_years', { id }))[0] || {};
    this._cache.set(key, value);
    return value;
  },

  async getTerm(id) {
    if (!id || typeof id === 'object') return id || {};
    const key = `term:${id}`;
    if (this._cache.has(key)) return this._cache.get(key);
    const value = (await DB.get('terms', { id }))[0] || {};
    this._cache.set(key, value);
    return value;
  },

  async getClasses(filter = {}) {
    if (!Object.keys(filter || {}).length && this._cache.has('classes')) return this._cache.get('classes');
    if (!Object.keys(filter || {}).length) {
      const value = await DB.query('classes', '*', {}, { column: 'name', asc: true });
      this._cache.set('classes', value);
      return value;
    }
    return DB.query('classes', '*', filter || {}, { column: 'name', asc: true });
  },

  async getSubjects(filter = {}) {
    if (!Object.keys(filter || {}).length && this._cache.has('subjects')) return this._cache.get('subjects');
    if (!Object.keys(filter || {}).length) {
      const value = await DB.query('subjects', '*', {}, { column: 'name', asc: true });
      this._cache.set('subjects', value);
      return value;
    }
    return DB.query('subjects', '*', filter || {}, { column: 'name', asc: true });
  },

  /** Parse the class grade (P1-P6 / S1-S6) from level or name. */
  classGrade(cls) {
    if (!cls) return null;
    const m = String(cls.level || '') + ' ' + String(cls.name || '');
    const f = m.toUpperCase().match(/([PS][1-6])/);
    return f ? f[1] : null;
  },

  /** Subjects officially assigned to a class (empty array = not configured). */
  async getClassSubjects(classId) {
    if (!classId) return [];
    const cacheKey = `classSubjects:${classId}`;
    if (this._cache.has(cacheKey)) return this._cache.get(cacheKey);
    try {
      const { data, error } = await sbClient
        .from('class_subjects')
        .select('subject_id, subjects(*)')
        .eq('class_id', classId);
      if (error) throw error;
      const value = (data || []).map(r => r.subjects).filter(Boolean)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      this._cache.set(cacheKey, value);
      return value;
    } catch (e) {
      return [];
    }
  },

  async getAssessments(filter = {}) {
    return DB.query('assessments', '*', filter || {}, { column: 'assessment_date', asc: false });
  },

  async getAssessmentTypes() {
    if (this._cache.has('assessmentTypes')) return this._cache.get('assessmentTypes');
    try {
      const res = await DB.query('assessment_types', '*', {}, { column: 'name', asc: true });
      this._cache.set('assessmentTypes', res || []);
      return res || [];
    } catch (e) {
      return [];
    }
  },

  async getLearners(classId, activeOnly = true) {
    const filter = activeOnly ? { class_id: classId, status: 'active' } : { class_id: classId };
    return DB.query('learners', '*', filter, { column: 'full_name', asc: true });
  },

  async getMarksForLearners(learnerIds, filters = {}) {
    const ids = (learnerIds || []).filter(Boolean);
    if (!ids.length) return [];
    return DB.query('marks', '*', { ...filters, learner_id: ids });
  },

  formatPct(v) {
    return v == null || isNaN(v) ? 'N/A' : Math.round(v * 10) / 10 + '%';
  },

  formatMark(v, max) {
    if (v == null || isNaN(v)) return 'N/R';
    return `${v}/${max}`;
  },

  esc(str) {
    return Utils.escapeHtml(str);
  },

  /* ---------- Print-safe inline SVG charts (no canvas, works in PDF/print) ---------- */

  charts: {
    svgBars({ labels = [], values = [], colors = [], height = 104, valueSuffix = '%', decimals = 0, showValues = true }) {
      const data = labels.map((l, i) => ({
        label: l,
        value: Number(values[i] ?? 0),
        color: colors[i] || '#1e3a5f'
      }));
      if (!data.some(d => d.value > 0)) return ReportHeader.emptyState('No numeric data available for the chart.');

      const W = 680, H = height || 104;
      const padL = 8, padR = 8, padT = 7, padB = 28;
      const max = Math.max(...data.map(d => d.value), 5);
      const slot = (W - padL - padR) / data.length;
      const barW = Math.min(Math.max(slot * 0.58, 14), 84);
      const usable = H - padT - padB - 12;

      const bars = data.map((d, i) => {
        const h = Math.max((d.value / max) * usable, 1.5);
        const x = padL + i * slot + (slot - barW) / 2;
        const y = padT + usable - h;
        const label = String(d.label).length > 18 ? String(d.label).slice(0, 17) + '…' : String(d.label);
        return `
          <g>
            <rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="2" fill="${d.color}" opacity="0.92"></rect>
            ${showValues ? `<text x="${x + barW / 2}" y="${y - 3}" text-anchor="middle" font-size="9" font-weight="700" fill="#111827">${Number(d.value).toFixed(decimals)}${valueSuffix}</text>` : ''}
            <text x="${x + barW / 2}" y="${H - 10}" text-anchor="middle" font-size="8" fill="#334155">${Utils.escapeHtml(label)}</text>
          </g>`;
      }).join('');

      return `<div class="rms-chart-card">
        <svg class="rms-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Bar chart">
          <line x1="${padL}" y1="${padT + usable}" x2="${W - padR}" y2="${padT + usable}" stroke="#1e3a5f" stroke-width="1"></line>
          ${bars}
        </svg>
      </div>`;
    },

    svgDonut({ labels = [], values = [], colors = [], size = 112, centerLabel = '', centerValue = '' }) {
      const data = labels.map((l, i) => ({ label: l, value: Number(values[i] ?? 0), color: colors[i] || '#1e3a5f' }));
      const total = data.reduce((s, d) => s + d.value, 0);
      if (!total) return ReportHeader.emptyState('No data available for the chart.');

      const cx = 56, cy = 56, r = 42, sw = 17;
      const C = 2 * Math.PI * r;
      let offset = 0;
      const arcs = data.map(d => {
        const frac = d.value / total;
        const len = frac * C;
        const dash = `${len} ${C - len}`;
        const seg = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="${sw}" stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" opacity="0.9"></circle>`;
        offset += len;
        return seg;
      });
      const legend = data.map(d => `<span class="rms-chart-legend-item"><i style="background:${d.color}"></i><span>${Utils.escapeHtml(d.label)} <b>${d.value}</b></span></span>`).join('');

      return `<div class="rms-chart-card" style="min-width:170px;display:flex;align-items:center;gap:8px">
        <svg class="rms-chart" viewBox="0 0 112 112" style="width:96px;flex:none" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Doughnut chart">
          ${arcs.join('')}
          <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="15" font-weight="800" fill="#111827">${Utils.escapeHtml(centerValue || total)}</text>
          <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="8" fill="#475569">${Utils.escapeHtml(centerLabel || 'Total')}</text>
        </svg>
        <div class="rms-chart-legend" style="min-width:0">${legend}</div>
      </div>`;
    }
  }
};
