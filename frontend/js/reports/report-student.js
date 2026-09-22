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
    let out = [];
    for (let i = 0; i < assessIds.length; i += 50) {
      const batch = assessIds.slice(i, i + 50);
      let q = sbClient.from('marks').select('*').in('assessment_id', batch);
      if (learnerIds && learnerIds.length) {
        for (let j = 0; j < learnerIds.length; j += 50) {
          const lb = learnerIds.slice(j, j + 50);
          const { data, error } = await q.in('learner_id', lb);
          if (error) throw error;
          out = out.concat(data || []);
        }
      } else {
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

  async loadAssessments({ classId, yearId, termId, assessmentTypeId, subjectIds }) {
    const filter = { class_id: classId, academic_year_id: yearId || undefined, term_id: termId || undefined };
    if (assessmentTypeId) filter.assessment_type_id = assessmentTypeId;
    let list = await DB.query('assessments', '*', filter, { column: 'assessment_date', asc: true });
    if (subjectIds && subjectIds.length) {
      const set = new Set(subjectIds.map(String));
      list = list.filter(a => set.has(String(a.subject_id)));
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
        seen.set(key, {
          key,
          name: nm,
          code: (t && t.code) || String(nm).split(/\s+/).map(w => w[0]).join('').slice(0, 4).toUpperCase(),
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

  async buildCard({ learner, cls, year, term, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride }) {
    const level = this.levelOfClass(cls);
    const eduCat = EducationLevels.getCategory(cls);
    let levelSubjects = (subjects || [])
      .filter(s => s.status === 'active' || !s.status)
      .filter(s => this.subjectMatchesLevel(s.level, eduCat));
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
        const colAssess = sAssess.filter(a => String(a.assessment_type_id || a.name) === String(col.typeId || col.name) || String(a.assessment_type_id) === String(col.key) || col.key === String(a.assessment_type_id || a.name));
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

    // Class teacher: teacher of most official assessments for this class
    const tCount = {};
    official.forEach(a => { if (a.teacher_id) tCount[a.teacher_id] = (tCount[a.teacher_id] || 0) + 1; });
    const topTeacherId = Object.entries(tCount).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    let teacherName = '';
    if (topTeacherId) {
      const t = await DB.get('teachers', { id: topTeacherId }).then(r => r[0]).catch(() => null);
      teacherName = t ? t.full_name : '';
    }

    return {
      type: 'student-card', title: 'STUDENT REPORT CARD',
      settings, learner, cls, year, term, level, eduCat,
      subjRows, columns, totalSubjects: levelSubjects.length, withMarks,
      passed, failed, totalObtained: totObt, totalMax,
      overallPct, overallGrade, overallPf, avg: overallPct,
      gradeDist, teacherName, teacherComment: teacherFinal, dosComment: dosFinal,
      decision, autoDecision, overallComment,
      scale, passMark, position: null, positionOutOf: null,
      hasMissing: subjRows.some(r => !r.hasMarks)
    };
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

  async fetchCardData({ learnerId, classId, yearId, termId, subjectIds, assessmentTypeId, teacherComment, dosComment, decisionOverride }) {
    const ctx = await this.loadContext({ classId, yearId, termId, assessmentTypeId });
    const { year, term, cls, subjects, types, settings, scale, passMark } = ctx;
    if (!cls) throw new Error('Select a valid class.');
    const learner = await DB.get('learners', { id: learnerId }).then(r => r[0]);
    if (!learner) throw new Error('Select a valid student.');
    this.validateSelection({ year, term, cls, learner });
    const { official, approval } = await this.loadAssessments({ classId, yearId, termId, assessmentTypeId, subjectIds });
    const allMarks = await this.fetchMarksByAssessments(official.map(a => a.id), [learnerId]);
    const card = await this.buildCard({ learner, cls, year, term, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride });
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

  async fetchClassCards({ classId, yearId, termId, subjectIds, assessmentTypeId, teacherComment, dosComment, decisionOverride }) {
    const ctx = await this.loadContext({ classId, yearId, termId, assessmentTypeId });
    const { year, term, cls, subjects, types, settings, scale, passMark } = ctx;
    if (!cls) throw new Error('Select a valid class.');
    this.validateSelection({ year, term, cls, learner: null });
    const learners = await ReportUtils.getLearners(classId);
    if (!learners.length) throw new Error('No active learners found in the selected class.');
    const { official, approval } = await this.loadAssessments({ classId, yearId, termId, assessmentTypeId, subjectIds });
    if (!official.length) throw new Error('No approved or locked assessments found for this class, year and term. This report cannot be finalized because marks are incomplete.');
    const allMarks = await this.fetchMarksByAssessments(official.map(a => a.id), learners.map(l => l.id));
    const cards = [];
    for (const learner of learners) {
      const card = await this.buildCard({ learner, cls, year, term, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride });
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

  renderCardInner(card) {
    const { settings, learner, cls, year, term, level, subjRows, columns } = card;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'STUDENT REPORT CARD', subtitle: `${cls?.name || ''}`, levelLabel: level.label });
    const stream = cls?.stream || learner?.stream || '—';
    const headRows = subjRows.map((r, i) => {
      const compTds = (r.components || []).map(c => c == null
        ? '<td class="text-center text-muted">—</td>'
        : `<td class="text-center">${c.obtained}</td>`).join('');
      return `<tr><td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(r.subject.name)}</td>${compTds}<td class="text-center font-bold">${r.hasMarks ? r.obtained : '—'}</td><td class="text-center">${r.hasMarks ? r.maxMark : '—'}</td><td class="text-center">${r.pct == null ? 'N/A' : r.pct.toFixed(1) + '%'}</td><td class="text-center font-bold">${r.grade}</td><td class="text-center"><span class="badge ${r.status === 'PASS' ? 'badge-success' : r.status === 'FAIL' ? 'badge-danger' : 'badge-warning'}">${r.status}</span></td><td>${Utils.escapeHtml(r.remark || '')}</td></tr>`;
    }).join('');
    const compHeaders = (columns || []).map(c => `<th>${Utils.escapeHtml(c.code)}</th>`).join('');
    const gradeRows = (card.scale || []).map(g => `<tr><td class="text-center font-bold">${Utils.escapeHtml(g.grade)}</td><td class="text-center">${g.minimum_percentage}–${g.maximum_percentage}%</td><td>${Utils.escapeHtml(g.descriptor || g.remark || '')}</td></tr>`).join('');
    const abbrRows = this.abbrList(card).map(([a, b]) => `<span class="rms-abbr"><strong>${Utils.escapeHtml(a)}</strong> = ${Utils.escapeHtml(b)}</span>`).join('');
    const distRows = (card.gradeDist || []).map(g => `<span class="badge badge-info">${Utils.escapeHtml(g.grade)}: ${g.count}</span>`).join(' ');
    const posText = card.position ? `${card.position} out of ${card.positionOutOf}` : 'Not available';
    const footer = ReportHeader.getFooter({ settings, academicYear: year?.name || '', term: term?.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${card.title} — ${level.label}</div>
      <div style="margin-bottom:8px"><span class="badge ${card.approval === 'APPROVED' ? 'badge-success' : card.approval === 'PENDING APPROVAL' ? 'badge-warning' : 'badge-gray'}">${Utils.escapeHtml(card.approval || 'DRAFT')}</span>
      ${card.hasMissing ? '<span class="badge badge-warning" style="margin-left:8px">Some assessment marks are missing. Final performance may be incomplete.</span>' : ''}</div>
      <div class="rms-meta-grid">
        <div><span class="rms-meta-lbl">Student Name:</span> ${Utils.escapeHtml(learner?.full_name || '-')}</div>
        <div><span class="rms-meta-lbl">Student Code:</span> ${Utils.escapeHtml(learner?.learner_code || '-')}</div>
        <div><span class="rms-meta-lbl">Level:</span> ${level.label}</div>
        <div><span class="rms-meta-lbl">Class:</span> ${Utils.escapeHtml(cls?.name || '-')}</div>
        <div><span class="rms-meta-lbl">Stream:</span> ${Utils.escapeHtml(stream)}</div>
        <div><span class="rms-meta-lbl">Gender:</span> ${Utils.escapeHtml(learner?.gender || '-')}</div>
        <div><span class="rms-meta-lbl">Academic Year:</span> ${Utils.escapeHtml(year?.name || '-')}</div>
        <div><span class="rms-meta-lbl">Term:</span> ${Utils.escapeHtml(term?.name || '-')}</div>
      </div>
      <table class="rms-table">
        <thead><tr><th>No.</th><th>Subject</th>${compHeaders}<th>Total</th><th>Max</th><th>%</th><th>Grade</th><th>Status</th><th>Remark</th></tr></thead>
        <tbody>${headRows}</tbody>
      </table>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${card.totalSubjects}</span><span class="rms-stat-lbl">Total Subjects</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${card.withMarks}</span><span class="rms-stat-lbl">With Marks</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${card.passed}</span><span class="rms-stat-lbl">Passed</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${card.failed}</span><span class="rms-stat-lbl">Failed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${card.overallPct == null ? 'N/A' : card.overallPct.toFixed(1) + '%'}</span><span class="rms-stat-lbl">Overall Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${card.overallGrade?.grade || '—'}</span><span class="rms-stat-lbl">Overall Grade</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${Utils.escapeHtml(posText)}</span><span class="rms-stat-lbl">Class Position</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${Utils.escapeHtml(card.decision || '')}</span><span class="rms-stat-lbl">Final Decision</span></div>
      </div>
      <div class="rms-grade-dist"><strong>Grade Distribution:</strong> ${distRows || '—'}</div>
      <div class="rms-meta" style="margin-bottom:12px"><strong>Overall Comment:</strong> ${Utils.escapeHtml(card.overallComment || '')}</div>
      <div class="rms-meta" style="margin-bottom:12px"><strong>Teacher's Comment:</strong> ${Utils.escapeHtml(card.teacherComment || '')}</div>
      <div class="rms-meta" style="margin-bottom:12px"><strong>DOS Comment:</strong> ${Utils.escapeHtml(card.dosComment || '')}</div>
      ${schoolSignatureSection(card.teacherName, settings.dos_name, settings.headteacher_name)}
      <h4 class="rms-report-title" style="margin-top:16px">Grading Scale</h4>
      <table class="rms-table"><thead><tr><th>Grade</th><th>Percentage Range</th><th>Description</th></tr></thead><tbody>${gradeRows}</tbody></table>
      <div class="rms-grade-dist"><strong>Abbreviations:</strong> ${abbrRows}</div>
      ${footer}`;
  },

  renderCard(card) {
    return ReportHeader.getA4Container(this.renderCardInner(card), 'portrait');
  },

  renderBatch(cards) {
    return cards.map(c => ReportHeader.getA4Container(this.renderCardInner(c), 'portrait')).join(ReportHeader.getPageBreak());
  }
};
