/* ============================================================
   report-comments.js
   Deterministic performance-comment engine for RMS-MIS reports.
   Priority: performance_comments table → grading-scale comment →
   descriptor → safe fallback. Same input always yields same remark.
   Depends on: DB, Utils, GradingEngine (optional)
   ============================================================ */

const ReportComments = {
  _cache: null,
  _promise: null,

  invalidate() {
    this._cache = null;
    this._promise = null;
  },

  async load() {
    if (this._cache) return this._cache;
    if (this._promise) return this._promise;
    this._promise = (async () => {
      try {
        const rows = await DB.query('performance_comments', '*', { active: true }, { column: 'min_percentage', asc: false });
        this._cache = (rows || [])
          .filter(r => r.min_percentage != null && r.max_percentage != null && r.comment)
          .map(r => ({
            min: Number(r.min_percentage),
            max: Number(r.max_percentage),
            comment: String(r.comment),
            level: String(r.level || 'All')
          }));
      } catch (e) {
        this._cache = [];
      }
      return this._cache;
    })();
    return this._promise;
  },

  /**
   * Get the official deterministic comment for a percentage.
   * @param {number|null} pct
   * @param {Object} opts - { level, scale, fallback }
   */
  async getPerformanceComment(pct, opts = {}) {
    if (pct == null || isNaN(Number(pct))) return opts.fallback || 'No mark available.';
    const p = Number(pct);
    const level = String(opts.level || 'All').toUpperCase();
    const bands = await this.load();
    const match = bands.find(b => {
      const lvl = String(b.level || 'All').toUpperCase();
      const levelOk = lvl === 'ALL' || lvl === level;
      return levelOk && p >= b.min && p <= b.max;
    });
    if (match) return match.comment;
    // Grading-scale comment (existing RMS-MIS configuration)
    try {
      if (typeof GradingEngine !== 'undefined') {
        const info = await GradingEngine.calculateGrade(p, opts.scale || null);
        if (info && info.comment) return info.comment;
        if (info && info.descriptor) return info.descriptor;
      }
    } catch (e) { /* fall through to safe fallback */ }
    return this.fallbackComment(p);
  },

  fallbackComment(p) {
    if (p >= 90) return 'Outstanding performance. Continue demonstrating excellence and consistency.';
    if (p >= 80) return 'Excellent performance. Keep up the good work and continue striving for higher achievement.';
    if (p >= 70) return 'Very good performance. Continue working consistently to improve further.';
    if (p >= 60) return 'Good performance. Continue practicing and focus on areas that need improvement.';
    if (p >= 50) return 'Satisfactory performance. More effort and regular practice are needed to improve.';
    if (p >= 40) return 'Performance needs improvement. Give more attention to learning activities and seek support where necessary.';
    return 'Needs significant improvement. Regular practice, guidance and additional support are recommended.';
  },

  /** Subject remark = deterministic performance comment. */
  async getSubjectRemark(pct, opts = {}) {
    return this.getPerformanceComment(pct, opts);
  },

  /**
   * Resolve manual-vs-auto comment priority.
   * Manual comments are never overwritten.
   */
  resolve(manual, auto) {
    return manual && String(manual).trim() ? String(manual).trim() : (auto || '');
  }
};
