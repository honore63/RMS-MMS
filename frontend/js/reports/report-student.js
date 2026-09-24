/* ============================================================
   report-student.js
   Dynamic official Student Report Card for RMS-MIS.
   Uses ONLY existing database records + existing RMS-MIS
   calculation rules (AnalyticsEngine weighting, GradingEngine,
   ReportComments). No hard-coded marks, subjects or grades.
   Depends on: DB, sbClient, Utils, EducationLevels,
               AnalyticsEngine, GradingEngine (optional),
               ReportUtils, ReportComments, ReportHeader, Auth
   ============================================================ */

const ReportStudent = {
  /* ---------- Level helpers ---------- */

  levelOfClass(cls) {
    const cat = EducationLevels.getCategory(cls);
    if (cat === 'Primary') return { short: 'PRIMARY', label: 'PRIMARY LEVEL' };
    return { short: 'SECONDARY', label: 'SECONDARY LEVEL' };
  },

  subjectMatchesLevel(subjectLevel, eduCat) {
    const s = String(subjectLevel || 'Both').trim().toUpperCase();
    if (s === 'BOTH' || s === '') return true;
    const cat = String(eduCat || '').toUpperCase();
    if (s === 'PRIMARY') return cat === 'PRIMARY';
    if (s === 'SECONDARY') return cat.includes('SECONDARY');
    return cat.includes(s) || s.includes(cat);
  },

  /* ---------- Bulk fetch helpers (efficient batch queries) ---------- */

  async fetchMarksByAssessments(assessIds, learnerIds = null) {
    if (!assessIds || !assessIds.length) return [];
    const chunk = (arr, size) => {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    };
    const assessBatches = chunk(assessIds, 50);
    const learnerBatches = learnerIds && learnerIds.length ? chunk(learnerIds, 100) : [null];
    let out = [];
    for (const aBatch of assessBatches) {
      for (const lBatch of learnerBatches) {
        let q = sbClient.from('marks').select('*').in('assessment_id', aBatch);
        if (lBatch) q = q.in('learner_id', lBatch);
        const { data, error } = await q;
        if (error) throw error;
        out = out.concat(data || []);
      }
    }
    return out;
  },

  /* ---------- Validation ---------- */

  validateSelection({ year, term, cls, learner }) {
    if (!year || !year.id) throw new Error('Select an academic year.');
    if (!term || !term.id) throw new Error('Select a term.');
    if (!cls || !cls.id) throw new Error('Select a class.');
    if (typeof Scope !== 'undefined' && Scope.isScoped() && !Scope.matchesClass(cls)) {
      throw new Error(`Access restricted: ${EducationLevels.getCategory(cls)} classes are outside your ${Scope.label()} scope.`);
    }
    if (learner && String(learner.class_id) !== String(cls.id)) {
      throw new Error('The selected student does not belong to the selected class.');
    }
  },

  /* ---------- Core builders ---------- */

  async loadContext({ classId, yearId, termId, assessmentTypeId }) {
    const [years, terms, classes, subjects, types, settings, scale] = await Promise.all([
      DB.get('academic_years'), DB.get('terms'), DB.get('classes'),
      DB.get('subjects'), ReportUtils.getAssessmentTypes(),
      ReportUtils.getSettings(), ReportUtils.getScale()
    ]);
    const year = years.find(y => String(y.id) === String(yearId)) || {};
    const term = terms.find(t => String(t.id) === String(termId)) || {};
    const cls = classes.find(c => String(c.id) === String(classId)) || null;
    const passMark = settings.pass_mark != null ? Number(settings.pass_mark) : 50;
    return { years, terms, classes, subjects, types, settings, scale, passMark, year, term, cls };
  },

  async loadAssessments({ classId, yearId, termId, termIds, assessmentTypeId, subjectIds, assessmentIds }) {
    const filter = { class_id: classId, academic_year_id: yearId || undefined };
    if (termIds && termIds.length) filter.term_id = termIds;
    else if (termId) filter.term_id = termId;
    if (assessmentTypeId) filter.assessment_type_id = assessmentTypeId;
    if (assessmentIds && assessmentIds.length) filter.id = assessmentIds;
    if (typeof Auth !== 'undefined' && Auth.isTeacher && Auth.isTeacher()) filter.teacher_id = Auth.getTeacherId();
    let list = await DB.query('assessments', '*', filter, { column: 'assessment_date', asc: true });
    if (subjectIds && subjectIds.length) {
      const set = new Set(subjectIds.map(String));
      list = list.filter(a => set.has(String(a.subject_id)));
    }
    if (termIds && termIds.length) {
      const tSet = new Set(termIds.map(String));
      list = list.filter(a => !a.term_id || tSet.has(String(a.term_id)));
    }
    const official = list.filter(a => ['approved', 'locked'].includes(a.status));
    const pending = list.filter(a => a.status === 'submitted');
    const drafts = list.filter(a => !['approved', 'locked', 'submitted'].includes(a.status));
    let approval = 'DRAFT';
    if (official.length && !pending.length && !drafts.length) approval = 'APPROVED';
    else if (official.length || pending.length) approval = 'PENDING APPROVAL';
    return { all: list, official, pending, drafts, approval };
  },

  typeColumns(official, types) {
    const seen = new Map();
    official.forEach(a => {
      const t = (types || []).find(x => String(x.id) === String(a.assessment_type_id));
      const key = String(a.assessment_type_id || a.name || 'GEN');
      if (!seen.has(key)) {
        const nm = t ? t.name : (a.name || 'Assessment');
        const storedCode = t && t.code ? String(t.code).trim().toUpperCase() : '';
        seen.set(key, {
          key,
          name: nm,
          code: storedCode || String(nm).split(/\s+/).map(w => w[0]).join('').slice(0, 6).toUpperCase(),
          typeId: a.assessment_type_id || null
        });
      }
    });
    return [...seen.values()];
  },

  effWeight(a, types) {
    if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.effWeight === 'function') {
      return AnalyticsEngine.effWeight(a, types);
    }
    if (a && a.weight != null) return Number(a.weight);
    const t = (types || []).find(x => String(x.id) === String(a && a.assessment_type_id));
    if (t && t.weight != null) return Number(t.weight);
    return null;
  },

  subjectPct(marks, assessments, types) {
    if (typeof AnalyticsEngine !== 'undefined' && typeof AnalyticsEngine.learnerPct === 'function') {
      return AnalyticsEngine.learnerPct(marks, assessments, types);
    }
    const valid = (marks || []).filter(m => m.mark != null && m.mark !== '');
    if (!valid.length) return null;
    const units = valid.map(m => ({ m, a: (assessments || []).find(x => String(x.id) === String(m.assessment_id)) })).filter(u => u.a);
    if (!units.length) return null;
    const allW = units.every(u => { const w = this.effWeight(u.a, types); return w != null && w > 0; });
    if (allW) {
      const num = units.reduce((s, u) => s + Utils.pct(Number(u.m.mark), Number(u.a.maximum_mark || 0)) * this.effWeight(u.a, types), 0);
      const den = units.reduce((s, u) => s + this.effWeight(u.a, types), 0);
      return den > 0 ? Math.round((num / den) * 100) / 100 : null;
    }
    const obt = units.reduce((s, u) => s + Number(u.m.mark), 0);
    const mx = units.reduce((s, u) => s + Number(u.a.maximum_mark || 0), 0);
    return mx > 0 ? Math.round((obt / mx) * 10000) / 100 : null;
  },

  colMatches(col, a) {
    return String(a.assessment_type_id || a.name) === String(col.typeId || col.name)
      || String(a.assessment_type_id) === String(col.key)
      || col.key === String(a.assessment_type_id || a.name);
  },

  async buildCard({ learner, cls, year, term, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride }) {
    const level = this.levelOfClass(cls);
    const eduCat = EducationLevels.getCategory(cls);
    let levelSubjects = (subjects || [])
      .filter(s => s.status === 'active' || !s.status)
      .filter(s => this.subjectMatchesLevel(s.level, eduCat));
    // Prefer the official class → subject assignment; fall back to grade band.
    const grade = ReportUtils.classGrade(cls);
    let assigned = [];
    try { assigned = await ReportUtils.getClassSubjects(cls.id); } catch (e) { assigned = []; }
    if (assigned.length) {
      const ids = new Set(assigned.map(s => String(s.id)));
      levelSubjects = levelSubjects.filter(s => ids.has(String(s.id)));
    } else if (grade) {
      levelSubjects = levelSubjects.filter(s => {
        if (!s.grades) return true;
        return String(s.grades).split(',').map(x => x.trim().toUpperCase()).includes(String(grade).toUpperCase());
      });
    }
    if (subjectIds && subjectIds.length) {
      const set = new Set(subjectIds.map(String));
      levelSubjects = levelSubjects.filter(s => set.has(String(s.id)));
    }
    levelSubjects.sort((a, b) => String(a.name).localeCompare(String(b.name)));

    // Final hard enforcement: never mix levels in one card
    const mixed = levelSubjects.filter(s => !this.subjectMatchesLevel(s.level, eduCat));
    if (mixed.length) throw new Error('Level restriction violated: cannot mix Primary and Secondary subjects in one report card.');

    const myMarks = (allMarks || []).filter(m => String(m.learner_id) === String(learner.id));
    const columns = this.typeColumns(official, types);

    // Per-component column metadata: max sums + weight shares (reference Total row)
    const allWeighted = official.length > 0 && official.every(a => {
      const w = this.effWeight(a, types);
      return w != null && w > 0;
    });
    const totalWeight = allWeighted
      ? official.reduce((s, a) => s + this.effWeight(a, types), 0)
      : 0;
    const columnMeta = columns.map(col => {
      const colAssess = official.filter(a => this.colMatches(col, a));
      const max = colAssess.reduce((s, a) => s + Number(a.maximum_mark || 0), 0);
      const wsum = allWeighted ? colAssess.reduce((s, a) => s + this.effWeight(a, types), 0) : 0;
      return {
        ...col,
        max,
        sub: allWeighted && totalWeight > 0 ? `(${Math.round((wsum / totalWeight) * 100)}%)` : (max ? `(${max})` : '')
      };
    });

    const subjRows = [];
    let totObt = 0, totMax = 0, withMarks = 0, passed = 0, failed = 0;
    for (const subj of levelSubjects) {
      const sAssess = official.filter(a => String(a.subject_id) === String(subj.id));
      const sMarks = myMarks.filter(m => sAssess.some(a => String(a.id) === String(m.assessment_id)));
      const valid = sMarks.filter(m => m.mark != null && m.mark !== '');
      if (!sAssess.length || !valid.length) {
        subjRows.push({ subject: subj, components: columns.map(() => null), obtained: null, maxMark: sAssess.reduce((s, a) => s + Number(a.maximum_mark || 0), 0), pct: null, grade: '—', status: 'Missing', remark: 'No mark available.', hasMarks: false });
        continue;
      }
      const components = columns.map(col => {
        const colAssess = sAssess.filter(a => this.colMatches(col, a));
        const rel = valid.filter(m => colAssess.some(a => String(a.id) === String(m.assessment_id)));
        if (!rel.length) return null;
        const obt = rel.reduce((s, m) => s + Number(m.mark), 0);
        const mx = colAssess.reduce((s, a) => s + Number(a.maximum_mark || 0), 0);
        return { obtained: obt, max: mx };
      });
      const obt = valid.reduce((s, m) => s + Number(m.mark), 0);
      const mx = sAssess.reduce((s, a) => {
        const has = valid.some(m => String(m.assessment_id) === String(a.id));
        return has ? s + Number(a.maximum_mark || 0) : s;
      }, 0);
      const pct = this.subjectPct(valid, sAssess, types);
      const g = ReportUtils.calcGrade(pct == null ? 0 : pct, scale);
      const pf = pct == null ? 'Missing' : ReportUtils.calcPassFail(pct, passMark);
      const remark = pct == null ? 'No mark available.' : await ReportComments.getSubjectRemark(pct, { level: level.short, scale });
      if (pct != null) { withMarks++; totObt += obt; totMax += mx; if (pf === 'PASS') passed++; else failed++; }
      subjRows.push({ subject: subj, components, obtained: obt, maxMark: mx, pct, grade: pct == null ? '—' : g.grade, descriptor: g.descriptor, status: pf, remark, hasMarks: pct != null });
    }

    // Reference-style Total row: per-component sums across subjects with marks
    const columnTotals = columnMeta.map((col, ci) => {
      let obt = 0, has = false;
      subjRows.forEach(r => {
        const c = r.components && r.components[ci];
        if (c != null && r.hasMarks) { obt += Number(c.obtained || 0); has = true; }
      });
      return { obtained: obt, max: col.max, has };
    });

    const overallPct = totMax > 0 && withMarks > 0 ? Math.round((totObt / totMax) * 10000) / 100 : null;
    const overallGrade = overallPct == null ? { grade: '—', descriptor: '' } : ReportUtils.calcGrade(overallPct, scale);
    const overallPf = overallPct == null ? 'Incomplete' : ReportUtils.calcPassFail(overallPct, passMark);
    const overallComment = overallPct == null
      ? 'Some assessment marks are missing. Final performance may be incomplete.'
      : await ReportComments.getPerformanceComment(overallPct, { level: level.short, scale });
    const teacherAuto = overallComment;
    const dosAuto = overallComment;
    const teacherFinal = ReportComments.resolve(teacherComment, teacherAuto);
    const dosFinal = ReportComments.resolve(dosComment, dosAuto);
    const autoDecision = overallPf === 'PASS' ? 'PASS' : overallPf === 'FAIL' ? 'FAIL' : 'INCOMPLETE';
    const decision = decisionOverride && String(decisionOverride).trim() ? String(decisionOverride).trim().toUpperCase() : autoDecision;

    const grades = subjRows.filter(r => r.hasMarks).map(r => r.grade);
    const gradeDist = ReportUtils.getGradeDistribution(grades, scale);

    // Class teacher: explicitly assigned by DOS, falling back to the most active assessor only if needed.
    let teacherName = '';
    if (cls?.class_teacher_id) {
      const t = await DB.get('teachers', { id: cls.class_teacher_id }).then(r => r[0]).catch(() => null);
      teacherName = t ? t.full_name : '';
    }
    if (!teacherName) {
      const tCount = {};
      official.forEach(a => { if (a.teacher_id) tCount[a.teacher_id] = (tCount[a.teacher_id] || 0) + 1; });
      const topTeacherId = Object.entries(tCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
      if (topTeacherId) {
        const t = await DB.get('teachers', { id: topTeacherId }).then(r => r[0]).catch(() => null);
        teacherName = t ? t.full_name : '';
      }
    }

    return {
      type: 'student-card', title: 'STUDENT REPORT CARD',
      settings, learner, cls, year, term, level, eduCat,
      subjRows, columns, columnMeta, columnTotals,
      totalSubjects: levelSubjects.length, withMarks,
      passed, failed, totalObtained: Number(totObt || 0), totalMax: Number(totMax || 0),
      overallPct, overallGrade, overallPf, avg: overallPct,
      gradeDist, teacherName, teacherComment: teacherFinal, dosComment: dosFinal,
      decision, autoDecision, overallComment,
      scale, passMark, position: null, positionOutOf: null,
      hasMissing: subjRows.some(r => !r.hasMarks)
    };
  },

  normalizeCardTotals(card) {
    if (!card) return card;
    card.totalObtained = Number(card.totalObtained ?? 0);
    card.totalMax = Number(card.totalMax ?? 0);
    if (card.totalMax === 0 && Array.isArray(card.subjRows)) {
      const sumMax = card.subjRows.reduce((s, r) => s + Number(r.maxMark || 0), 0);
      card.totalMax = sumMax;
    }
    return card;
  },

  async computePositions(cards) {
    const scored = cards.filter(c => c.overallPct != null).map(c => ({ id: c.learner.id, pct: c.overallPct }));
    const pos = Utils.positions(scored);
    const map = {};
    pos.forEach(p => { map[p.id] = p.position; });
    cards.forEach(c => {
      c.position = map[c.learner.id] || null;
      c.positionOutOf = scored.length || null;
    });
    return cards;
  },

  /* ---------- Public entry points ---------- */

  async fetchCardData({ learnerId, classId, yearId, termId, termIds, subjectIds, assessmentIds, assessmentTypeId, teacherComment, dosComment, decisionOverride }) {
    const ctx = await this.loadContext({ classId, yearId, termId, assessmentTypeId });
    const { year, term, cls, subjects, types, settings, scale, passMark } = ctx;
    if (!cls) throw new Error('Select a valid class.');
    const learner = await DB.get('learners', { id: learnerId }).then(r => r[0]);
    if (!learner) throw new Error('Select a valid student.');
    this.validateSelection({ year, term, cls, learner });
    const effTermIds = termIds && termIds.length ? termIds : (termId ? [termId] : null);
    const { official, approval } = await this.loadAssessments({ classId, yearId, termId, termIds: effTermIds, assessmentTypeId, subjectIds, assessmentIds });
    const allMarks = await this.fetchMarksByAssessments(official.map(a => a.id), [learnerId]);
    const card = await this.buildCard({ learner, cls, year, term, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride });
    this.normalizeCardTotals(card);
    card.approval = approval;
    card.pendingCount = 0;
    await this.computePositions([card]);
    // Single-card position needs class peers: compute cheaply
    const peers = await this.classOverallPcts({ classId, yearId, termId, assessmentTypeId, subjectIds, ctx, official });
    const ranked = Utils.positions(peers);
    const mine = ranked.find(r => String(r.id) === String(learnerId));
    card.position = mine ? mine.position : null;
    card.positionOutOf = peers.length || null;
    return card;
  },

  async classOverallPcts({ classId, yearId, termId, assessmentTypeId, subjectIds, ctx, official }) {
    const context = ctx || await this.loadContext({ classId, yearId, termId, assessmentTypeId });
    const off = official || (await this.loadAssessments({ classId, yearId, termId, assessmentTypeId, subjectIds })).official;
    if (!off.length) return [];
    const learners = await ReportUtils.getLearners(classId);
    const allMarks = await this.fetchMarksByAssessments(off.map(a => a.id), learners.map(l => l.id));
    const eduCat = EducationLevels.getCategory(context.cls);
    const levelSubjectIds = new Set((context.subjects || [])
      .filter(s => this.subjectMatchesLevel(s.level, eduCat))
      .filter(s => !subjectIds || !subjectIds.length || subjectIds.map(String).includes(String(s.id)))
      .map(s => String(s.id)));
    const relAssess = off.filter(a => levelSubjectIds.has(String(a.subject_id)));
    return learners.map(l => {
      const lm = allMarks.filter(m => String(m.learner_id) === String(l.id));
      const valid = lm.filter(m => m.mark != null && m.mark !== '');
      if (!valid.length) return null;
      const pct = this.subjectPct(valid, relAssess, context.types);
      return pct == null ? null : { id: l.id, pct };
    }).filter(Boolean);
  },

  async fetchClassCards({ classId, yearId, termId, termIds, subjectIds, assessmentIds, assessmentTypeId, teacherComment, dosComment, decisionOverride }) {
    const ctx = await this.loadContext({ classId, yearId, termId, assessmentTypeId });
    const { year, term, cls, subjects, types, settings, scale, passMark } = ctx;
    if (!cls) throw new Error('Select a valid class.');
    this.validateSelection({ year, term, cls, learner: null });
    const learners = await ReportUtils.getLearners(classId);
    if (!learners.length) throw new Error('No active learners found in the selected class.');
    const effTermIds = termIds && termIds.length ? termIds : (termId ? [termId] : null);
    const { official, approval } = await this.loadAssessments({ classId, yearId, termId, termIds: effTermIds, assessmentTypeId, subjectIds, assessmentIds });
    if (!official.length) throw new Error('No approved or locked assessments found for this class, year and term. This report cannot be finalized because marks are incomplete.');
    const allMarks = await this.fetchMarksByAssessments(official.map(a => a.id), learners.map(l => l.id));
    const cards = [];
    for (const learner of learners) {
      const card = await this.buildCard({ learner, cls, year, term, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride });
      this.normalizeCardTotals(card);
      card.approval = approval;
      cards.push(card);
    }
    await this.computePositions(cards);
    cards.sort((a, b) => (a.position || 9999) - (b.position || 9999));
    return { cards, meta: { cls, year, term, approval, count: cards.length } };
  },

  /* ---------- Rendering (A4 portrait) ---------- */

  abbrList(card) {
    const out = [];
    (card.columns || []).forEach(c => out.push([c.code, c.name]));
    out.push(['TOT', 'Total'], ['MAX', 'Maximum'], ['GR', 'Grade']);
    return out;
  },

  shortRemark(pct, scale) {
    if (pct == null) return '—';
    if (typeof GradingEngine !== 'undefined' && scale && scale.length) {
      try {
        const info = GradingEngine.calculateGradeSync(pct, scale);
        if (info.descriptor) return info.descriptor;
        if (info.grade) return info.grade;
      } catch (e) { /* fallback below */ }
    }
    if (pct >= 90) return 'Outstanding';
    if (pct >= 80) return 'Excellent';
    if (pct >= 70) return 'Very Good';
    if (pct >= 60) return 'Good';
    if (pct >= 50) return 'Satisfactory';
    if (pct >= 40) return 'Needs Improvement';
    return 'Fail';
  },

  gradeBars(dist) {
    const items = (dist || []).filter(g => g.count > 0);
    if (!items.length) return '<div class="src-chart-title">Grade Distribution</div><p class="text-sm text-muted">No grade data</p>';
    const colors = ['#4ade80', '#60a5fa', '#f59e0b', '#f97316', '#ef4444', '#a855f7'];
    const max = Math.max(...items.map(g => g.count));
    const W = 220, H = 110, padB = 18, padT = 14;
    const slot = W / items.length;
    const bw = Math.min(30, slot * 0.55);
    let bars = '';
    items.forEach((g, i) => {
      const h = max > 0 ? Math.max(2, ((H - padB - padT) * g.count) / max) : 0;
      const x = slot * i + (slot - bw) / 2;
      const y = H - padB - h;
      const col = colors[i % colors.length];
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="2"><title>${Utils.escapeHtml(g.grade)}: ${g.count}</title></rect>`;
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 3).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="#1e293b">${g.count}</text>`;
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle" font-size="9" font-weight="600" fill="#1e293b">${Utils.escapeHtml(g.grade)}</text>`;
    });
    return `<div class="src-chart-title">Grade Distribution</div><svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Grade distribution">${bars}</svg>`;
  },

  passDonut(passed, failed) {
    const total = passed + failed;
    if (!total) return '<div class="src-chart-title">Pass/Fail Summary</div><p class="text-sm text-muted">No data</p>';
    const rate = Math.round((passed / total) * 100);
    const size = 120, stroke = 16, r = (size - stroke) / 2, c = size / 2;
    const C = 2 * Math.PI * r;
    const passLen = (C * passed) / total;
    return `<div class="src-chart-title">Pass/Fail Summary</div>
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Pass fail summary">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#ef4444" stroke-width="${stroke}" />
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#10b981" stroke-width="${stroke}" stroke-dasharray="${passLen.toFixed(1)} ${(C - passLen).toFixed(1)}" transform="rotate(-90 ${c} ${c})" />
        <text x="${c}" y="${c + 5}" text-anchor="middle" font-size="15" font-weight="800" fill="#0d47a1">${rate}%</text>
      </svg>
      <div class="src-legend"><span><span class="src-dot" style="background:#10b981"></span>Passed&nbsp;${passed}</span><span><span class="src-dot" style="background:#ef4444"></span>Failed&nbsp;${failed}</span></div>`;
  },

  renderCardInner(card) {
    const { settings, learner, cls, year, term, level, subjRows } = card;
    const cols = card.columnMeta && card.columnMeta.length ? card.columnMeta : (card.columns || []);
    const densityClass = subjRows.length > 12 || cols.length > 6
      ? 'src-sheet-ultra'
      : subjRows.length > 8 || cols.length > 4
        ? 'src-sheet-compact'
        : '';
    const totals = card.columnTotals || [];
    const s = settings || {};
    const ministryLogo = s.ministry_logo_url || 'public/logo.webp';
    const schoolLogo = s.school_logo_url || s.logo_url || 'public/logo.webp';
    const motto = 'Education, Work and Success';
    const stream = cls?.stream || learner?.stream || 'General';
    const dob = learner?.date_of_birth || learner?.dob || '';
    const now = new Date();
    const genDate = Utils.dateStr(now) + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const headRows = subjRows.map((r, i) => {
      const compTds = (r.components || []).map(c => c == null
        ? '<td>—</td>'
        : `<td>${c.obtained}</td>`).join('');
      return `<tr><td class="src-subject">${Utils.escapeHtml(r.subject.name)}</td>${compTds}<td><strong>${r.hasMarks ? r.obtained : '—'}</strong></td><td><strong>${r.pct == null ? 'N/A' : r.pct.toFixed(1)}</strong></td><td><strong>${r.grade}</strong></td></tr>`;
    }).join('');

    const compHeaders = cols.map(c => `<th>${Utils.escapeHtml(c.code)}<br><span style="font-size:8px;font-weight:400">${Utils.escapeHtml(c.sub || '')}</span></th>`).join('');
    const totalTds = cols.map((c, ci) => {
      const t = totals[ci];
      return `<td>${t && t.has ? t.obtained : '—'}</td>`;
    }).join('');
    const overallShort = this.shortRemark(card.overallPct, card.scale);
    const posText = card.position ? `${card.position} out of ${card.positionOutOf}` : 'Not available';

    return `
    <div class="src-sheet ${densityClass}">
      <div class="src-header">
        <div class="src-head-left">
          <img src="${Utils.escapeHtml(ministryLogo)}" class="src-logo" alt="Ministry logo" onerror="this.style.display='none'">
          <div class="src-logo-caption">REPUBLIC OF RWANDA<br>MINISTRY OF EDUCATION</div>
        </div>
        <div class="src-head-center">
          <div class="src-school-line small">REPUBLIC OF RWANDA</div>
          <div class="src-school-line mid">MINISTRY OF EDUCATION</div>
          <div class="src-school-line small">${Utils.escapeHtml(s.province || 'EASTERN PROVINCE')}</div>
          <div class="src-school-line small">${Utils.escapeHtml(s.district || 'KAYONZA DISTRICT')}</div>
          <div class="src-school-line small">${Utils.escapeHtml(s.sector || 'GAHINI SECTOR')}</div>
          <div class="src-school-line big">${Utils.escapeHtml(s.school_name || 'RUKARA MODEL SCHOOL')}</div>
          <div class="src-school-meta">School Code: ${Utils.escapeHtml(s.school_code || '541023')}</div>
          <div class="src-school-meta">E-mail: ${Utils.escapeHtml(s.school_email || s.email || '')} &nbsp;|&nbsp; Phone: ${Utils.escapeHtml(s.school_phone || s.phone || '')}</div>
        </div>
        <div class="src-head-right">
          <img src="${Utils.escapeHtml(schoolLogo)}" class="src-logo" alt="School logo" onerror="this.style.display='none'">
          <div class="src-logo-caption">${Utils.escapeHtml(motto)}</div>
          <div class="src-logo-caption">RUKARA MODEL SCHOOL</div>
        </div>
      </div>
      <hr class="src-head-rule">
      <div class="src-title-main">STUDENT REPORT CARD</div>
      <div class="src-title-sub">${level.label}</div>
      <div class="src-info">
        <div class="src-info-col">
          <div class="src-info-row"><span class="src-info-lbl">Student Name</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(learner?.full_name || '-')}</span></div>
          <div class="src-info-row"><span class="src-info-lbl">Student Code</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(learner?.learner_code || '-')}</span></div>
          <div class="src-info-row"><span class="src-info-lbl">Class</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(cls?.name || '-')}</span></div>
          <div class="src-info-row"><span class="src-info-lbl">Stream</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(stream)}</span></div>
        </div>
        <div class="src-info-col">
          <div class="src-info-row"><span class="src-info-lbl">Academic Year</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(year?.name || '-')}</span></div>
          <div class="src-info-row"><span class="src-info-lbl">Term</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(term?.name || '-')}</span></div>
          ${dob ? `<div class="src-info-row"><span class="src-info-lbl">Date of Birth</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(dob)}</span></div>` : ''}
          <div class="src-info-row"><span class="src-info-lbl">Gender</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(learner?.gender === 'M' ? 'Male' : learner?.gender === 'F' ? 'Female' : (learner?.gender || '-'))}</span></div>
        </div>
      </div>
      <table class="src-table">
        <thead>
          <tr><th rowspan="2" style="text-align:left">Subject</th><th colspan="${cols.length || 1}">Assessment Components</th><th rowspan="2">Total</th><th rowspan="2">Percentage<br><span style="font-size:8px;font-weight:400">(%)</span></th><th rowspan="2">Grade</th></tr>
          <tr>${compHeaders}</tr>
        </thead>
        <tbody>${headRows}</tbody>
        <tfoot><tr><td class="src-subject">Total</td>${totalTds}<td>${card.totalObtained}</td><td>${card.overallPct == null ? 'N/A' : card.overallPct.toFixed(1)}</td><td>${card.overallGrade?.grade || '—'}</td></tr></tfoot>
      </table>
      <div class="src-panels">
        <div class="src-panel src-summary">
          <div class="src-panel-title">Summary</div>
          <div class="src-panel-body">
            <div class="src-kv"><span>Total Subjects</span><b>${card.totalSubjects}</b></div>
            <div class="src-kv"><span>Subjects Passed</span><b>${card.passed}</b></div>
            <div class="src-kv"><span>Subjects Failed</span><b>${card.failed}</b></div>
            <div class="src-kv"><span>Overall Average</span><b>${card.overallPct == null ? 'N/A' : card.overallPct.toFixed(1) + '%'}</b></div>
            <div class="src-kv"><span>Overall Grade</span><b>${card.overallGrade?.grade || '—'}</b></div>
            <div class="src-kv"><span>Class Position</span><b>${Utils.escapeHtml(posText)}</b></div>
          </div>
        </div>
        <div class="src-panel src-performance">
          <div class="src-panel-title">Overall Performance</div>
          <div class="src-panel-body">
            <div style="font-size:10px;font-weight:800;margin-bottom:4px">Performance Analysis</div>
            <div class="src-charts">
              <div class="src-chart-box">${this.gradeBars(card.gradeDist)}</div>
              <div class="src-chart-box">${this.passDonut(card.passed, card.failed)}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="src-comments">
        <div class="src-comment"><h5>Teacher's Comment</h5><p>${Utils.escapeHtml(card.teacherComment || '')}</p></div>
        <div class="src-comment"><h5>DOS Comment</h5><p>${Utils.escapeHtml(card.dosComment || '')}</p></div>
        <div class="src-comment"><h5>Parent's Comment</h5><p>${Utils.escapeHtml(card.parentComment || '')}</p></div>
      </div>
      <div class="src-signatures">
        <div class="src-sig">
          <h5>Class Teacher's Signature</h5>
          <div class="sig-name">${Utils.escapeHtml(card.teacherName || '')}</div>
          <div>Date:&nbsp; ${Utils.escapeHtml(Utils.dateStr(now))}</div>
          <div style="margin-top:8px;font-family:cursive;font-size:16px;color:#0d47a1;height:24px;display:flex;align-items:flex-end">${Utils.escapeHtml(card.teacherName ? card.teacherName.split(' ')[0] : 'Signature')}</div>
        </div>
        <div class="src-sig">
          <h5>DOS Signature</h5>
          <div class="sig-name">${Utils.escapeHtml(s.dos_name || '')}</div>
          <div>Date:&nbsp; ${Utils.escapeHtml(Utils.dateStr(now))}</div>
          <div style="margin-top:8px;font-family:cursive;font-size:16px;color:#0d47a1;height:24px;display:flex;align-items:flex-end">${Utils.escapeHtml(s.dos_name ? s.dos_name.split(' ')[0] : 'Signature')}</div>
        </div>
        <div class="src-sig">
          <h5>Parent/Guardian Signature</h5>
          <div class="sig-name">&nbsp;</div>
          <div>Date:&nbsp; __________________</div>
          <div class="sig-line"></div>
        </div>
      </div>
      <div class="src-footer">
        <div class="src-footer-row">
          <div><strong>RMS-MIS &nbsp;|&nbsp; ${Utils.escapeHtml(s.school_name || 'Rukara Model School')}</strong><br>Marks Information System</div>
          <div style="text-align:center">Academic Year: ${Utils.escapeHtml(year?.name || '-')}<br>Term: ${Utils.escapeHtml(term?.name || '-')}</div>
          <div style="text-align:right">Generated: ${Utils.escapeHtml(genDate)}</div>
        </div>
        <div class="src-footer-motto">Education, Work and Success</div>
        <div class="src-wave"></div>
      </div>
    </div>`;
  },

  renderCard(card) {
    return ReportHeader.getA4Container(this.renderCardInner(card), 'portrait');
  },

  renderBatch(cards) {
    return cards.map(c => ReportHeader.getA4Container(this.renderCardInner(c), 'portrait')).join(ReportHeader.getPageBreak());
  }
};
