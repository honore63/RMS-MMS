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
    // RLS limits subject teachers to assigned assessments and Class Teachers
    // to assessments in their assigned classes.
    let list = await DB.query('assessments', '*', filter, { column: 'assessment_date', asc: true });
    /* Bulk-combine conversion helpers never feed report cards. */
    list = (list || []).filter(a => !(Utils.isConversionHelper && Utils.isConversionHelper(a)));
    if (subjectIds && subjectIds.length) {
      const set = new Set(subjectIds.map(String));
      list = list.filter(a => set.has(String(a.subject_id)));
    }
    if (termIds && termIds.length) {
      const tSet = new Set(termIds.map(String));
      list = list.filter(a => !a.term_id || tSet.has(String(a.term_id)));
    }
    const official = list.filter(a => ['submitted', 'approved', 'locked'].includes(a.status));
    if (assessmentIds && assessmentIds.length) {
      const selectedIds = new Set(assessmentIds.map(String));
      const foundIds = new Set(list
        .filter(assessment => selectedIds.has(String(assessment.id)))
        .map(assessment => String(assessment.id)));
      if (assessmentIds.some(id => !foundIds.has(String(id)))) {
        throw new Error('One or more selected assessments do not match the chosen class, year, subject, or term.');
      }
      if (list.some(assessment =>
        selectedIds.has(String(assessment.id))
        && !['submitted', 'approved', 'locked'].includes(assessment.status))) {
        throw new Error('Every selected assessment must be submitted, approved, or locked before a report card can be generated.');
      }
    }
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
      const typeName = t ? t.name : (a.name || 'Assessment');
      const key = String(a.assessment_type_id || `name:${typeName}`);
      if (!seen.has(key)) {
        const nm = typeName;
        const storedCode = t?.code || a.type_code || '';
        seen.set(key, {
          key,
          name: nm,
          code: String(storedCode).trim().toUpperCase()
            || String(nm).split(/\s+/).map(w => w[0]).join('').slice(0, 6).toUpperCase(),
          typeId: a.assessment_type_id || null
        });
      }
    });
    const order = new Map((types || []).map((type, index) => [
      String(type.id),
      Number(type.display_order ?? index)
    ]));
    return [...seen.values()].sort((a, b) =>
      (order.get(String(a.typeId)) ?? Number.MAX_SAFE_INTEGER)
        - (order.get(String(b.typeId)) ?? Number.MAX_SAFE_INTEGER)
    );
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

  buildPeriodReports({ subjects, assessments, marks, types, terms, scale }) {
    const termMap = new Map((terms || []).map(item => [String(item.id), item]));
    const groups = new Map();
    (assessments || []).forEach(assessment => {
      const termKey = String(assessment.term_id || assessment.term || 'period');
      if (!groups.has(termKey)) groups.set(termKey, []);
      groups.get(termKey).push(assessment);
    });
    return [...groups.entries()]
      .sort(([a], [b]) => {
        const aTerm = termMap.get(a);
        const bTerm = termMap.get(b);
        return Number(aTerm?.term_no || 0) - Number(bTerm?.term_no || 0)
          || String(aTerm?.name || a).localeCompare(String(bTerm?.name || b));
      })
      .map(([termKey, periodAssessments]) => {
        const term = termMap.get(termKey);
        const weights = periodAssessments.map(assessment => this.effWeight(assessment, types));
        const weighted = weights.length > 0 && weights.every(weight => weight != null && weight > 0);
        const totalWeight = weighted ? weights.reduce((sum, weight) => sum + weight, 0) : 0;
        const columns = this.typeColumns(periodAssessments, types).map(column => {
          const related = periodAssessments.filter(assessment => this.colMatches(column, assessment));
          const weight = weighted
            ? related.reduce((sum, assessment) => sum + this.effWeight(assessment, types), 0)
            : 0;
          return {
            ...column,
            sub: weighted && totalWeight > 0 ? `${Math.round(weight / totalWeight * 100)}%` : ''
          };
        });
        const rows = (subjects || []).map(subject => {
          const related = periodAssessments.filter(assessment =>
            String(assessment.subject_id) === String(subject.id));
          const valid = related
            .map(assessment => marks.find(mark =>
              String(mark.assessment_id) === String(assessment.id)))
            .filter(mark => mark && mark.mark != null && mark.mark !== '');
          const components = columns.map(column => {
            const componentAssessments = related.filter(assessment => this.colMatches(column, assessment));
            const componentMarks = componentAssessments
              .map(assessment => marks.find(mark =>
                String(mark.assessment_id) === String(assessment.id)))
              .filter(mark => mark && mark.mark != null && mark.mark !== '');
            if (!componentMarks.length) return null;
            const maximum = componentMarks.reduce((sum, mark) => {
              const assessment = componentAssessments.find(item =>
                String(item.id) === String(mark.assessment_id));
              return sum + Number(assessment?.maximum_mark || 0);
            }, 0);
            return {
              obtained: componentMarks.reduce((sum, mark) => sum + Number(mark.mark), 0),
              maximum
            };
          });
          const percentage = valid.length
            ? this.subjectPct(valid, related, types)
            : null;
          const obtained = valid.reduce((sum, mark) => sum + Number(mark.mark), 0);
          const maximum = valid.reduce((sum, mark) => {
            const assessment = related.find(item =>
              String(item.id) === String(mark.assessment_id));
            return sum + Number(assessment?.maximum_mark || 0);
          }, 0);
          return {
            subject,
            components,
            maximumComponents: columns.map(column => periodAssessments
              .filter(assessment => String(assessment.subject_id) === String(subject.id)
                && this.colMatches(column, assessment))
              .reduce((sum, assessment) => sum + Number(assessment.maximum_mark || 0), 0)),
            obtained: valid.length ? obtained : null,
            maximum,
            percentage,
            grade: percentage == null ? '—' : ReportUtils.calcGrade(percentage, scale).grade
          };
        });
        return {
          id: termKey,
          name: term?.name || periodAssessments[0]?.term || 'Reporting Period',
          columns,
          weighted,
          rows
        };
      });
  },

  async buildCard({ learner, cls, year, term, terms = [], subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride }) {
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
    const periodReports = this.buildPeriodReports({
      subjects: levelSubjects,
      assessments: official,
      marks: myMarks,
      types,
      terms,
      scale
    });

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
    const weightByComponent = new Map(columns.map(column => [column.key, 0]));
    let maximumWeight = 0;
    let hasAllWeights = official.length > 0;
    official.forEach(assessment => {
      const weight = this.effWeight(assessment, types);
      if (weight == null || weight <= 0) {
        hasAllWeights = false;
        return;
      }
      const column = columns.find(item => this.colMatches(item, assessment));
      if (column) weightByComponent.set(column.key, weightByComponent.get(column.key) + weight);
      maximumWeight += weight;
    });
    const maximumWeights = hasAllWeights && maximumWeight > 0
      ? Object.fromEntries(columns.map(column => [
        column.key,
        Math.round(weightByComponent.get(column.key) / maximumWeight * 100)
      ]))
      : null;

    const subjRows = [];
    let totObt = 0, withMarks = 0, passed = 0, failed = 0;
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
      if (pct != null) { withMarks++; totObt += obt; if (pf === 'PASS') passed++; else failed++; }
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

    const scoredPercentages = subjRows.filter(row => row.hasMarks && row.pct != null)
      .map(row => row.pct);
    const overallPct = scoredPercentages.length
      ? Math.round(scoredPercentages.reduce((sum, percentage) => sum + percentage, 0)
        / scoredPercentages.length * 100) / 100
      : null;
    const totalMax = levelSubjects.reduce((sum, subject) => sum + official
      .filter(assessment => String(assessment.subject_id) === String(subject.id))
      .reduce((subjectMax, assessment) => subjectMax + Number(assessment.maximum_mark || 0), 0), 0);
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
      periodReports, maximumWeights,
      totalSubjects: levelSubjects.length, withMarks,
      passed, failed, totalObtained: Number(totObt || 0), totalMax: Number(totalMax || 0),
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
    const { year, term, terms, cls, subjects, types, settings, scale, passMark } = ctx;
    if (!cls) throw new Error('Select a valid class.');
    const learner = await DB.get('learners', { id: learnerId }).then(r => r[0]);
    if (!learner) throw new Error('Select a valid student.');
    this.validateSelection({ year, term, cls, learner });
    const effTermIds = termIds && termIds.length ? termIds : (termId ? [termId] : null);
    const { official, approval } = await this.loadAssessments({ classId, yearId, termId, termIds: effTermIds, assessmentTypeId, subjectIds, assessmentIds });
    const allMarks = await this.fetchMarksByAssessments(official.map(a => a.id), [learnerId]);
    const card = await this.buildCard({ learner, cls, year, term, terms, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride });
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
    const { year, term, terms, cls, subjects, types, settings, scale, passMark } = ctx;
    if (!cls) throw new Error('Select a valid class.');
    this.validateSelection({ year, term, cls, learner: null });
    const learners = await ReportUtils.getLearners(classId);
    if (!learners.length) throw new Error('No active learners found in the selected class.');
    const effTermIds = termIds && termIds.length ? termIds : (termId ? [termId] : null);
    const { official, approval } = await this.loadAssessments({ classId, yearId, termId, termIds: effTermIds, assessmentTypeId, subjectIds, assessmentIds });
    if (!official.length) throw new Error('No submitted, approved or locked assessments found for this class, year and term. This report cannot be finalized because marks are incomplete.');
    const allMarks = await this.fetchMarksByAssessments(official.map(a => a.id), learners.map(l => l.id));
    const cards = [];
    for (const learner of learners) {
      const card = await this.buildCard({ learner, cls, year, term, terms, subjects, official, types, allMarks, settings, scale, passMark, subjectIds, teacherComment, dosComment, decisionOverride });
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
    const W = 180, H = 78, padB = 14, padT = 11;
    const slot = W / items.length;
    const bw = Math.min(22, slot * 0.55);
    let bars = '';
    items.forEach((g, i) => {
      const h = max > 0 ? Math.max(2, ((H - padB - padT) * g.count) / max) : 0;
      const x = slot * i + (slot - bw) / 2;
      const y = H - padB - h;
      const col = colors[i % colors.length];
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${col}" rx="1.5"><title>${Utils.escapeHtml(g.grade)}: ${g.count}</title></rect>`;
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 2).toFixed(1)}" text-anchor="middle" font-size="8" font-weight="700" fill="#1e293b">${g.count}</text>`;
      bars += `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle" font-size="8" font-weight="600" fill="#1e293b">${Utils.escapeHtml(g.grade)}</text>`;
    });
    return `<div class="src-chart-title">Grade Distribution</div><svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Grade distribution">${bars}</svg>`;
  },

  passDonut(passed, failed) {
    const total = passed + failed;
    if (!total) return '<div class="src-chart-title">Pass/Fail Summary</div><p class="text-sm text-muted">No data</p>';
    const rate = Math.round((passed / total) * 100);
    const size = 86, stroke = 12, r = (size - stroke) / 2, c = size / 2;
    const C = 2 * Math.PI * r;
    const passLen = (C * passed) / total;
    return `<div class="src-chart-title">Pass/Fail Summary</div>
      <svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Pass fail summary">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#ef4444" stroke-width="${stroke}" />
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#10b981" stroke-width="${stroke}" stroke-dasharray="${passLen.toFixed(1)} ${(C - passLen).toFixed(1)}" transform="rotate(-90 ${c} ${c})" />
        <text x="${c}" y="${c + 4}" text-anchor="middle" font-size="13" font-weight="800" fill="#0d47a1">${rate}%</text>
      </svg>
      <div class="src-legend"><span><span class="src-dot" style="background:#10b981"></span>Passed&nbsp;${passed}</span><span><span class="src-dot" style="background:#ef4444"></span>Failed&nbsp;${failed}</span></div>`;
  },

  renderCardInner(card) {
    const { settings, learner, cls, year, term, level, subjRows } = card;
    const cols = card.columnMeta && card.columnMeta.length ? card.columnMeta : (card.columns || []);
    // Density is driven by how WIDE the table is (number of mark columns).
    // A long subject list with few columns must stay readable, not get squeezed.
    const densityClass = cols.length > 6 || subjRows.length > 22
      ? 'src-sheet-ultra'
      : cols.length > 3 || subjRows.length > 16
        ? 'src-sheet-compact'
        : '';
    const s = settings || {};
    const ministryLogo = s.ministry_logo_url || 'public/logo.webp';
    const schoolLogo = s.school_logo_url || s.logo_url || 'public/logo.webp';
    const { email, phone } = ReportHeader.getSchoolContact(s);
    const motto = 'Education, Work and Success';
    const stream = cls?.stream || learner?.stream || 'General';
    const dob = learner?.date_of_birth || learner?.dob || '';
    const now = new Date();
    const genDate = Utils.dateStr(now) + ' ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const fmtMark = value => Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 });
    const periods = card.periodReports || [];
    const termDisplay = periods.map(period => period.name).join(', ') || term?.name || '-';
    const periodRow = (period, subjectId) => period.rows.find(row =>
      String(row.subject.id) === String(subjectId));
    const allPeriodColumns = new Map(periods.flatMap(period => period.columns)
      .map(column => [column.key, column]));
    const configuredColumns = card.columnMeta?.length
      ? card.columnMeta
      : card.columns || [];
    const componentColumns = [
      ...configuredColumns.filter(column => allPeriodColumns.has(column.key)),
      ...[...allPeriodColumns.values()].filter(column =>
        !configuredColumns.some(configured => configured.key === column.key))
    ];
    const componentIndex = (period, column) =>
      period.columns.findIndex(item => item.key === column.key);
    const maximumForSubject = (subject, column) => periods.reduce((sum, period) => {
      const row = periodRow(period, subject.id);
      const index = componentIndex(period, column);
      return sum + Number(index < 0 ? 0 : row?.maximumComponents?.[index] || 0);
    }, 0);
    const totalMaximumForSubject = subject => componentColumns.reduce(
      (sum, column) => sum + maximumForSubject(subject, column),
      0
    );
    const maximumTotal = subjRows.reduce((sum, row) => sum + totalMaximumForSubject(row.subject), 0);
    const termHeader = periods.map(period =>
      `<th colspan="${period.columns.length + 3}">${Utils.escapeHtml(period.name)}${year?.name ? ` / ${Utils.escapeHtml(year.name)}` : ''}</th>`
    ).join('');
    const termSubHeaders = periods.map(period =>
      `${period.columns.map(column => `<th title="${Utils.escapeHtml(column.name)}">${Utils.escapeHtml(column.code || column.name)}</th>`).join('')}<th>TOT</th><th>%</th><th>GR</th>`
    ).join('');
    const termWeightHeaders = periods.map(period =>
      `${period.columns.map(column => `<th>${Utils.escapeHtml(column.sub || '')}</th>`).join('')}<th>${period.weighted ? '100%' : ''}</th><th></th><th></th>`
    ).join('');
    const rowMarkup = subjRows.map(subjectRow => {
      const cells = periods.map(period => {
        const row = periodRow(period, subjectRow.subject.id);
        const components = period.columns.map((column, index) => {
          const value = row?.components[index]?.obtained;
          return `<td>${value == null ? '' : fmtMark(value)}</td>`;
        }).join('');
        return `${components}<td>${row?.obtained == null ? '' : fmtMark(row.obtained)}</td><td>${row?.percentage == null ? '' : `${row.percentage.toFixed(1)}%`}</td><td>${Utils.escapeHtml(row?.grade || '—')}</td>`;
      }).join('');
      const total = subjectRow.hasMarks
        ? `<td>${fmtMark(subjectRow.obtained)}</td><td>${fmtMark(totalMaximumForSubject(subjectRow.subject))}</td><td>${subjectRow.pct.toFixed(1)}%</td><td>${Utils.escapeHtml(subjectRow.grade)}</td>`
        : `<td></td><td>${fmtMark(totalMaximumForSubject(subjectRow.subject))}</td><td></td><td></td>`;
      const maximumCells = componentColumns.map(column =>
        `<td class="src-maximum-cell">${maximumForSubject(subjectRow.subject, column) || ''}</td>`
      ).join('');
      return `<tr><td class="src-subject">${Utils.escapeHtml(subjectRow.subject.name)}</td>${maximumCells}<td class="src-maximum-cell">${totalMaximumForSubject(subjectRow.subject) || ''}</td>${cells}${total}</tr>`;
    }).join('');
    const totalsCells = periods.map(period => {
      const valid = period.rows.filter(row => row.percentage != null);
      const componentTotals = period.columns.map((column, index) => {
        const obtained = valid.reduce((sum, row) =>
          sum + Number(row.components[index]?.obtained || 0), 0);
        return `<td>${valid.length ? fmtMark(obtained) : ''}</td>`;
      }).join('');
      const obtained = valid.reduce((sum, row) => sum + Number(row.obtained || 0), 0);
      const percentages = valid.map(row => row.percentage);
      const pct = percentages.length
        ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
        : null;
      const grade = pct == null ? '' : ReportUtils.calcGrade(pct, card.scale).grade;
      return `${componentTotals}<td>${valid.length ? fmtMark(obtained) : ''}</td><td>${pct == null ? '' : `${pct.toFixed(1)}%`}</td><td>${Utils.escapeHtml(grade)}</td>`;
    }).join('');
    const overallGrade = card.overallGrade?.grade || '—';
    const maximumCells = componentColumns.map(column => {
      const maximum = subjRows.reduce((sum, row) => sum + maximumForSubject(row.subject, column), 0);
      return `<td>${fmtMark(maximum)}</td>`;
    }).join('');
    const maximumWeightCells = componentColumns.map(column =>
      `<th>${card.maximumWeights?.[column.key] == null ? '' : `${card.maximumWeights[column.key]}%`}</th>`
    ).join('');
    const allSubjectsColumnCount = 1 + componentColumns.length + 1
      + periods.reduce((sum, period) => sum + period.columns.length + 3, 0) + 4;
    const table = `<div class="src-multi-term-wrap"><table class="src-table src-multi-term-table">
      <thead>
        <tr><th rowspan="2" class="src-subject-heading">SUBJECT</th><th colspan="${componentColumns.length + 1}">MAXIMUM</th>${termHeader}<th colspan="4">Total</th></tr>
        <tr class="src-multi-term-subhead">${componentColumns.map(column => `<th title="${Utils.escapeHtml(column.name)}">${Utils.escapeHtml(column.code || column.name)}</th>`).join('')}<th>TOT</th>${termSubHeaders}<th>TOT</th><th>MAX</th><th>%</th><th>GR</th></tr>
        <tr class="src-multi-term-weight"><th>WEIGHT</th>${maximumWeightCells}<th>${card.maximumWeights ? '100%' : ''}</th>${termWeightHeaders}<th></th><th></th><th></th><th></th></tr>
      </thead>
      <tbody>
        <tr class="src-all-subjects-row"><td colspan="${allSubjectsColumnCount}">All Subjects</td></tr>
        ${rowMarkup}
      </tbody>
      <tfoot><tr><td class="src-subject">Total</td>${maximumCells}<td>${fmtMark(maximumTotal)}</td>${totalsCells}<td>${fmtMark(card.totalObtained)}</td><td>${fmtMark(maximumTotal)}</td><td>${card.overallPct == null ? '' : `${card.overallPct.toFixed(1)}%`}</td><td>${Utils.escapeHtml(overallGrade)}</td></tr></tfoot>
    </table></div>`;
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
          <div class="src-school-meta">E-mail: ${Utils.escapeHtml(email)} &nbsp;|&nbsp; Phone: ${Utils.escapeHtml(phone)}</div>
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
          <div class="src-info-row"><span class="src-info-lbl">Term(s)</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(termDisplay)}</span></div>
          ${dob ? `<div class="src-info-row"><span class="src-info-lbl">Date of Birth</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(dob)}</span></div>` : ''}
          <div class="src-info-row"><span class="src-info-lbl">Gender</span><span class="src-info-sep">:</span><span class="src-info-val">${Utils.escapeHtml(learner?.gender === 'M' ? 'Male' : learner?.gender === 'F' ? 'Female' : (learner?.gender || '-'))}</span></div>
        </div>
      </div>
      ${table}
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
          <div class="sig-name">&nbsp;</div>
          <div>Date:&nbsp; __________________</div>
          <div class="sig-line"></div>
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
          <div style="text-align:center">Academic Year: ${Utils.escapeHtml(year?.name || '-')}<br>Term(s): ${Utils.escapeHtml(termDisplay)}</div>
          <div style="text-align:right">Generated: ${Utils.escapeHtml(genDate)}</div>
        </div>
        <div class="src-footer-motto">Education, Work and Success</div>
        <div class="src-wave"></div>
      </div>
    </div>`;
  },

  renderCard(card) {
    const orientation = (card.periodReports || []).length > 1 ? 'landscape' : 'portrait';
    return ReportHeader.getA4Container(this.renderCardInner(card), orientation);
  },

  renderBatch(cards) {
    const orientation = (cards || []).some(card => (card.periodReports || []).length > 1)
      ? 'landscape'
      : 'portrait';
    return cards.map(card => ReportHeader.getA4Container(
      this.renderCardInner(card),
      orientation
    )).join(ReportHeader.getPageBreak());
  }
};
