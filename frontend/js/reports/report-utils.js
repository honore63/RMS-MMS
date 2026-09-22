const ReportUtils = {
  async getSettings() {
    try {
      const res = await DB.query('school_settings', '*');
      return res[0] || {};
    } catch (e) {
      return {};
    }
  },

  async getScale() {
    return typeof getGrading === 'function' ? getGrading() : await Utils.getGradingScale();
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
    const years = await DB.get('academic_years');
    return years.find(y => y.status === 'active') || years[0] || {};
  },

  async getActiveTerm() {
    const terms = await DB.get('terms');
    return terms.find(t => t.status === 'active' || t.is_current) || terms[0] || {};
  },

  async getClasses(filter = {}) {
    return DB.query('classes', '*', filter || {}, { column: 'name', asc: true });
  },

  async getSubjects(filter = {}) {
    return DB.query('subjects', '*', filter || {}, { column: 'name', asc: true });
  },

  async getAssessments(filter = {}) {
    return DB.query('assessments', '*', filter || {}, { column: 'assessment_date', asc: false });
  },

  async getAssessmentTypes() {
    try {
      const res = await DB.query('assessment_types', '*', {}, { column: 'name', asc: true });
      return res || [];
    } catch (e) {
      return [];
    }
  },

  async getLearners(classId, activeOnly = true) {
    const filter = activeOnly ? { class_id: classId, status: 'active' } : { class_id: classId };
    return DB.query('learners', '*', filter, { column: 'full_name', asc: true });
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
  }
};
