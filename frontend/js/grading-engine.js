/* ============================================================
   RMS-MIS GRADING ENGINE
   Centralized grading service used by ALL modules:
   - Mark Entry
   - Teacher Reports
   - DOS Reports
   - Student Report Card
   - Analytics
   - Performance Range Report
   - Assessment Reports
   
   Depends on: DB, Utils, sbClient
   ============================================================ */

const GradingEngine = {
  _cache: null,
  _promise: null,

  /* ---------- Cache Management ---------- */

  async loadScale() {
    if (this._cache) return this._cache;
    if (this._promise) return this._promise;
    this._promise = DB.get('grading_scales')
      .then(data => {
        const active = (data || []).filter(s => s.is_active).sort((a, b) => a.display_order - b.display_order);
        this._cache = active;
        return active;
      });
    return this._promise;
  },

  invalidate() {
    this._cache = null;
    this._promise = null;
  },

  /* ---------- Core Grade Calculation ---------- */

  /**
   * Calculate grade info for a percentage
   * @param {number} pct - Percentage (0-100)
   * @param {Array} scale - Optional custom scale, otherwise loads from DB
   * @returns {Object} { grade, descriptor, range, comment, isPass, minPct, maxPct }
   */
  async calculateGrade(pct, scale = null) {
    const s = scale || await this.loadScale();
    if (!s || !s.length) {
      return this._fallbackGrade(pct);
    }

    for (const range of s) {
      if (pct >= range.minimum_percentage && pct <= range.maximum_percentage) {
        return {
          grade: range.grade,
          descriptor: range.descriptor || range.grade,
          range: `${range.minimum_percentage}–${range.maximum_percentage}%`,
          comment: range.comment || '',
          isPass: range.is_pass === true,
          minPct: range.minimum_percentage,
          maxPct: range.maximum_percentage
        };
      }
    }
    // Fallback to lowest range if no match (shouldn't happen with proper config)
    const lowest = s[s.length - 1];
    return {
      grade: lowest.grade,
      descriptor: lowest.descriptor || lowest.grade,
      range: `${lowest.minimum_percentage}–${lowest.maximum_percentage}%`,
      comment: lowest.comment || '',
      isPass: lowest.is_pass === true,
      minPct: lowest.minimum_percentage,
      maxPct: lowest.maximum_percentage
    };
  },

  _fallbackGrade(pct) {
    if (pct >= 80) return { grade: 'A', descriptor: 'Excellent', range: '80–100%', comment: '', isPass: true, minPct: 80, maxPct: 100 };
    if (pct >= 75) return { grade: 'B', descriptor: 'Very Good', range: '75–79%', comment: '', isPass: true, minPct: 75, maxPct: 79 };
    if (pct >= 70) return { grade: 'C', descriptor: 'Good', range: '70–74%', comment: '', isPass: true, minPct: 70, maxPct: 74 };
    if (pct >= 65) return { grade: 'D', descriptor: 'Satisfactory', range: '65–69%', comment: '', isPass: true, minPct: 65, maxPct: 69 };
    if (pct >= 60) return { grade: 'E', descriptor: 'Adequate', range: '60–64%', comment: '', isPass: true, minPct: 60, maxPct: 64 };
    if (pct >= 50) return { grade: 'S', descriptor: 'Minimum Pass', range: '50–59%', comment: '', isPass: true, minPct: 50, maxPct: 59 };
    return { grade: 'F', descriptor: 'Fail', range: '0–49%', comment: '', isPass: false, minPct: 0, maxPct: 49 };
  },

  /**
   * Synchronous version using cached scale (must call loadScale first)
   */
  calculateGradeSync(pct, scale) {
    if (!scale || !scale.length) return this._fallbackGrade(pct);
    for (const range of scale) {
      if (pct >= range.minimum_percentage && pct <= range.maximum_percentage) {
        return {
          grade: range.grade,
          descriptor: range.descriptor || range.grade,
          range: `${range.minimum_percentage}–${range.maximum_percentage}%`,
          comment: range.comment || '',
          isPass: range.is_pass === true,
          minPct: range.minimum_percentage,
          maxPct: range.maximum_percentage
        };
      }
    }
    const lowest = scale[scale.length - 1];
    return {
      grade: lowest.grade,
      descriptor: lowest.descriptor || lowest.grade,
      range: `${lowest.minimum_percentage}–${lowest.maximum_percentage}%`,
      comment: lowest.comment || '',
      isPass: lowest.is_pass === true,
      minPct: lowest.minimum_percentage,
      maxPct: lowest.maximum_percentage
    };
  },

  /* ---------- Performance Ranges ---------- */

  /**
   * Get all performance ranges in order (for reports)
   * @returns {Array} [{ min, max, grade, descriptor, isPass, label, color }]
   */
  async getPerformanceRanges() {
    const scale = await this.loadScale();
    return scale.map(r => ({
      min: r.minimum_percentage,
      max: r.maximum_percentage,
      grade: r.grade,
      descriptor: r.descriptor,
      isPass: r.is_pass,
      label: `${r.minimum_percentage}–${r.maximum_percentage}%`,
      shortLabel: `${r.minimum_percentage}–${r.maximum_percentage}`,
      color: this._rangeColor(r.grade)
    }));
  },

  getPerformanceRangesSync(scale) {
    return (scale || []).map(r => ({
      min: r.minimum_percentage,
      max: r.maximum_percentage,
      grade: r.grade,
      descriptor: r.descriptor,
      isPass: r.is_pass,
      label: `${r.minimum_percentage}–${r.maximum_percentage}%`,
      shortLabel: `${r.minimum_percentage}–${r.maximum_percentage}`,
      color: this._rangeColor(r.grade)
    }));
  },

  _rangeColor(grade) {
    const colors = { A: '#166534', B: '#15803d', C: '#166534', D: '#854d0e', E: '#92400e', S: '#92400e', F: '#991b1b' };
    return colors[grade] || '#374151';
  },

  /* ---------- Classification ---------- */

  /**
   * Classify a set of percentages into performance ranges
   * @param {Array<number>} percentages - Array of student percentages
   * @param {Array} scale - Optional cached scale
   * @returns {Object} { ranges: [{ range, count, percentage, grade, descriptor }], total }
   */
  classifyPercentages(percentages, scale = null) {
    const s = scale || this._cache;
    if (!s || !s.length) return { ranges: [], total: 0 };

    const ranges = s.map(r => ({
      min: r.minimum_percentage,
      max: r.maximum_percentage,
      grade: r.grade,
      descriptor: r.descriptor,
      isPass: r.is_pass,
      label: `${r.minimum_percentage}–${r.maximum_percentage}%`,
      shortLabel: `${r.minimum_percentage}–${r.maximum_percentage}`,
      color: this._rangeColor(r.grade),
      count: 0
    }));

    const validPcts = percentages.filter(p => p != null && !isNaN(p));
    validPcts.forEach(pct => {
      for (const r of ranges) {
        if (pct >= r.min && pct <= r.max) {
          r.count++;
          break;
        }
      }
    });

    const total = validPcts.length;
    ranges.forEach(r => {
      r.percentage = total > 0 ? Math.round((r.count / total) * 1000) / 10 : 0;
    });

    return { ranges, total };
  },

  /* ---------- Grade Distribution ---------- */

  /**
   * Get grade distribution from array of grades
   * @param {Array<string>} grades - Array of grade letters
   * @param {Array} scale - Optional cached scale
   * @returns {Array} [{ grade, descriptor, range, count, percentage, isPass }]
   */
  getGradeDistribution(grades, scale = null) {
    const s = scale || this._cache;
    if (!s || !s.length) return [];

    const counts = {};
    grades.forEach(g => { if (g) counts[g] = (counts[g] || 0) + 1; });
    const total = grades.length;

    return s.map(r => ({
      grade: r.grade,
      descriptor: r.descriptor,
      range: `${r.minimum_percentage}–${r.maximum_percentage}%`,
      count: counts[r.grade] || 0,
      percentage: total > 0 ? Math.round(((counts[r.grade] || 0) / total) * 1000) / 10 : 0,
      isPass: r.is_pass
    }));
  },

  /* ---------- Pass/Fail ---------- */

  async getPassMark() {
    const settings = await DB.query('school_settings', '*');
    return (settings?.[0]?.pass_mark) ?? 50;
  },

  isPass(pct, passMark = 50) {
    return pct >= passMark;
  },

  /* ---------- Validation ---------- */

  /**
   * Validate a proposed grading scale
   * @param {Array} ranges - Array of { minimum_percentage, maximum_percentage, grade, descriptor, is_pass }
   * @returns {Object} { valid: boolean, errors: string[] }
   */
  validateScale(ranges) {
    const errors = [];

    if (!ranges || !ranges.length) {
      errors.push('At least one grading range is required');
      return { valid: false, errors };
    }

    const sorted = [...ranges].sort((a, b) => a.minimum_percentage - b.minimum_percentage);

    // Check each range
    sorted.forEach((r, i) => {
      if (r.minimum_percentage < 0) errors.push(`Range ${i + 1}: Minimum cannot be less than 0`);
      if (r.maximum_percentage > 100) errors.push(`Range ${i + 1}: Maximum cannot exceed 100`);
      if (r.minimum_percentage > r.maximum_percentage) errors.push(`Range ${i + 1}: Minimum cannot exceed maximum`);
      if (!r.grade || !r.grade.trim()) errors.push(`Range ${i + 1}: Grade is required`);
      if (!r.descriptor || !r.descriptor.trim()) errors.push(`Range ${i + 1}: Descriptor is required`);
    });

    // Check for duplicate grades
    const grades = sorted.map(r => r.grade?.trim().toUpperCase());
    const dupGrades = grades.filter((g, i) => grades.indexOf(g) !== i);
    if (dupGrades.length) errors.push(`Duplicate grades: ${[...new Set(dupGrades)].join(', ')}`);

    // Check for overlaps
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i].maximum_percentage >= sorted[i + 1].minimum_percentage) {
        errors.push(`Ranges overlap: ${sorted[i].grade} (${sorted[i].minimum_percentage}–${sorted[i].maximum_percentage}) overlaps with ${sorted[i + 1].grade} (${sorted[i + 1].minimum_percentage}–${sorted[i + 1].maximum_percentage})`);
      }
    }

    // Check coverage
    if (sorted[0].minimum_percentage > 0) errors.push(`Gap at start: no range covers 0–${sorted[0].minimum_percentage - 1}%`);
    if (sorted[sorted.length - 1].maximum_percentage < 100) errors.push(`Gap at end: no range covers ${sorted[sorted.length - 1].maximum_percentage + 1}–100%`);
    for (let i = 0; i < sorted.length - 1; i++) {
      const gap = sorted[i + 1].minimum_percentage - sorted[i].maximum_percentage - 1;
      if (gap > 0) errors.push(`Gap between ${sorted[i].grade} and ${sorted[i + 1].grade}: ${gap}% not covered`);
    }

    return { valid: errors.length === 0, errors };
  },

  /* ---------- Report Comment Override ---------- */

  /**
   * Get comment for a grade - checks for manual override first
   * @param {Object} params - { percentage, grade, assessmentId, learnerId, customComment }
   * @returns {string} The comment to use
   */
  async getComment(params) {
    // If there's a manual override for this specific context, use it
    if (params.customComment && params.customComment.trim()) {
      return params.customComment.trim();
    }

    // Otherwise use the default from the grading scale
    const gradeInfo = await this.calculateGrade(params.percentage);
    return gradeInfo.comment;
  },

  /* ---------- Stats Helpers ---------- */

  computeStats(pcts, passMark = 50) {
    const valid = pcts.filter(p => p != null && !isNaN(p));
    if (!valid.length) return { total: 0, assessed: 0, passed: 0, failed: 0, passRate: 0, avg: 0, high: 0, low: 0 };
    const sum = valid.reduce((a, b) => a + b, 0);
    const passed = valid.filter(p => p >= passMark).length;
    return {
      total: valid.length,
      assessed: valid.length,
      passed,
      failed: valid.length - passed,
      passRate: Math.round((passed / valid.length) * 1000) / 10,
      avg: Math.round((sum / valid.length) * 100) / 100,
      high: Math.max(...valid),
      low: Math.min(...valid)
    };
  }
};

/* Backward compatibility: expose async calculateGrade as GradingEngine.calculateGrade */
if (typeof window !== 'undefined') {
  window.GradingEngine = GradingEngine;
}