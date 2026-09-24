const AnalyticsEngine = {
  _contextCache: null,

  passMark(settings) {
    const v = Number(settings && settings.pass_mark);
    return v > 0 ? v : 50;
  },

  target() {
    const raw = localStorage.getItem('rms.analytics.target');
    const v = Number(raw);
    return v > 0 ? v : 70;
  },

  setTarget(v) {
    const n = Number(v);
    localStorage.setItem('rms.analytics.target', n > 0 ? String(n) : '70');
  },

  async resetContext() {
    this._contextCache = null;
  },

  async context(filters = {}, isTeacher = false) {
    if (this._contextCache) return this._contextCache;
    const ctx = {
      classes: (await DB.get('classes')) || [],
      subjects: (await DB.get('subjects')) || [],
      years: (await DB.get('academic_years')) || [],
      terms: (await DB.get('terms')) || [],
      learners: (await DB.get('learners')) || [],
      teachers: (await DB.get('teachers')) || [],
      types: (await getAssessmentTypes(true)) || [],
      scale: (await Utils.getGradingScale()) || [],
      settings: (await getSchoolSettings()) || { pass_mark: 50 }
    };
    if (typeof Scope !== 'undefined' && Scope.isScoped()) {
      ctx.classes = ctx.classes.filter(c => Scope.matchesClass(c));
      ctx.subjects = ctx.subjects.filter(s => Scope.matchesSubject(s));
      const classIds = new Set(ctx.classes.map(c => String(c.id)));
      ctx.learners = ctx.learners.filter(l => classIds.has(String(l.class_id)));
    }
    ctx.classByName = id => ctx.classes.find(c => c.id === id);
    ctx.subjectById = id => ctx.subjects.find(s => s.id === id);
    ctx.termById = id => ctx.terms.find(t => t.id === id);
    ctx.yearById = id => ctx.years.find(y => y.id === id);
    ctx.learnerById = id => ctx.learners.find(l => l.id === id);
    ctx.typeById = id => ctx.types.find(t => t.id === id);
    ctx.teacherById = id => ctx.teachers.find(t => t.id === id);

    if (isTeacher) {
      const teacherId = Auth.getTeacherId();
      ctx.teacherId = teacherId;
      ctx.assignments = (await DB.query('teacher_assignments', '*', { teacher_id: teacherId })) || [];
      const pairKeys = new Set();
      ctx.assignments.forEach(a => pairKeys.add(a.class_id + '|' + a.subject_id));
      ctx.isTeacherScoped = (a) => pairKeys.has(a.class_id + '|' + a.subject_id);
      const allowedClasses = new Set(ctx.assignments.map(a => a.class_id).filter(Boolean));
      const allowedSubjects = new Set(ctx.assignments.map(a => a.subject_id).filter(Boolean));
      ctx.classes = ctx.classes.filter(c => allowedClasses.has(c.id));
      ctx.subjects = ctx.subjects.filter(s => allowedSubjects.has(s.id));
      ctx.learners = ctx.learners.filter(l => allowedClasses.has(l.class_id));
    }
    this._contextCache = ctx;
    return ctx;
  },

  effWeight(a, types) {
    if (a == null) return null;
    if (a.weight != null) return Number(a.weight);
    const t = (types || []).find(x => x.id === a.assessment_type_id);
    if (t && t.weight != null) return Number(t.weight);
    return null;
  },

  educLevelOf(level) {
    const l = String(level || '').trim().toUpperCase();
    if (/^P[1-6]([\s]\S+)?$/.test(l)) return 'Primary';
    if (/^S[1-3]([\s]\S+)?$/.test(l)) return 'Lower Secondary';
    if (/^S[4-6]([\s]\S+)?$/.test(l)) return 'Upper Secondary';
    return l ? 'Other' : '';
  },

  pctFor(mark, assessment) {
    if (mark == null || assessment == null || assessment.maximum_mark == null) return null;
    return Utils.pct(Number(mark), Number(assessment.maximum_mark));
  },

  learnerPct(marks, assessments, types) {
    const has = marks.filter(m => m.mark != null && m.mark !== '');
    if (!has.length) return null;
    const units = has
      .map(m => {
        const a = assessments.find(x => x.id === m.assessment_id);
        return a ? { a, m } : null;
      })
      .filter(Boolean);
    if (!units.length) return null;
    const weighted = units.every(u => {
      const w = this.effWeight(u.a, types);
      return w != null && w > 0;
    });
    let pct;
    if (weighted) {
      const num = units.reduce((s, u) => s + this.pctFor(u.m.mark, u.a) * this.effWeight(u.a, types), 0);
      const den = units.reduce((s, u) => s + this.effWeight(u.a, types), 0);
      pct = den > 0 ? (num / den) : null;
    } else {
      const obtained = units.reduce((s, u) => s + Number(u.m.mark), 0);
      const maxTotal = units.reduce((s, u) => s + Number(u.a.maximum_mark || 0), 0);
      pct = maxTotal > 0 ? (obtained / maxTotal) * 100 : null;
    }
    return pct == null ? null : Math.round(pct * 100) / 100;
  },

  async load(filters, ctx, isTeacher) {
    let q = sbClient.from('assessments').select('*');
    const addEq = (k, v) => { if (v && v !== 'all') q = q.eq(k, v); };
    addEq('academic_year_id', filters.yearId);
    addEq('term_id', filters.termId);
    if (filters.classIds && Array.isArray(filters.classIds) && filters.classIds.length) {
      q = q.in('class_id', filters.classIds.filter(Boolean));
    } else {
      addEq('class_id', filters.classId);
    }
    addEq('subject_id', filters.subjectId);
    addEq('assessment_type_id', filters.typeId);
    if (!isTeacher && filters.teacherId && filters.teacherId !== 'all') addEq('teacher_id', filters.teacherId);

    let { data: assessments, error } = await q;
    if (error) throw error;
    assessments = assessments || [];

    if (typeof Scope !== 'undefined' && Scope.isScoped()) {
      const classIds = new Set((ctx.classes || []).map(c => String(c.id)));
      const subjectIds = new Set((ctx.subjects || []).map(s => String(s.id)));
      assessments = assessments.filter(a => classIds.has(String(a.class_id)) && subjectIds.has(String(a.subject_id)));
    }

    if (isTeacher) {
      assessments = assessments.filter(a => ctx.teacherId
        ? (a.teacher_id === ctx.teacherId || (ctx.isTeacherScoped && ctx.isTeacherScoped(a)))
        : (ctx.isTeacherScoped && ctx.isTeacherScoped(a)));
    }

    if (filters.stream && filters.stream !== 'all') {
      assessments = assessments.filter(a => {
        const c = ctx.classByName(a.class_id);
        return c && String(c.stream || '') === String(filters.stream);
      });
    }

    if (filters.levelId && filters.levelId !== 'all') {
      assessments = assessments.filter(a => {
        const c = ctx.classByName(a.class_id);
        return c && String(this.educLevelOf(c.level)) === String(filters.levelId);
      });
    }

    const statusMode = filters.status || 'official';
    if (statusMode === 'official') {
      assessments = assessments.filter(a => a.status === 'approved' || a.status === 'locked');
    } else if (statusMode !== 'all') {
      assessments = assessments.filter(a => a.status === statusMode);
    }

    assessments.sort((a, b) => String(a.assessment_date).localeCompare(String(b.assessment_date)) || String(a.name).localeCompare(String(b.name)));
    assessments.forEach(a => {
      a._typeName = assessmentTypeName(ctx.types, a.assessment_type_id, 'Assessment');
      a._effWeight = this.effWeight(a, ctx.types);
      a._class = ctx.classByName(a.class_id);
      a._subject = ctx.subjectById(a.subject_id);
      a._term = ctx.termById(a.term_id);
      a._year = ctx.yearById(a.academic_year_id);
    });

    if (filters.assessmentId && filters.assessmentId !== 'all') {
      assessments = assessments.filter(a => a.id === filters.assessmentId);
    }

    const ids = assessments.map(a => a.id);
    let marks = [];
    if (ids.length) {
      const { data, error: me } = await sbClient.from('marks').select('*').in('assessment_id', ids);
      if (me) throw me;
      marks = data || [];
    }

    if (filters.studentId && filters.studentId !== 'all') {
      marks = marks.filter(m => m.learner_id === filters.studentId);
    }

    if (filters.studentIds && Array.isArray(filters.studentIds) && filters.studentIds.length) {
      const set = new Set(filters.studentIds);
      marks = marks.filter(m => set.has(m.learner_id));
    }

    return { assessments, marks };
  },

  buildLearners(assessments, marks, ctx) {
    const byLearner = {};
    marks.forEach(m => {
      if (!m.learner_id) return;
      if (!byLearner[m.learner_id]) byLearner[m.learner_id] = [];
      byLearner[m.learner_id].push(m);
    });

    const assessmentsById = {};
    assessments.forEach(a => { assessmentsById[a.id] = a; });

    const rows = Object.keys(byLearner).map(id => {
      const learner = ctx.learnerById(id);
      if (!learner) return null;
      const ms = byLearner[id];
      const bySubject = {};
      const byAssessment = {};
      const byTerm = {};
      const byType = {};
      const subjectGrades = [];
      ms.forEach(m => {
        const a = assessmentsById[m.assessment_id];
        if (!a) return;
        const pct = this.pctFor(m.mark, a);
        if (pct == null) return;
        byAssessment[a.id] = pct;
        if (m.mark != null && m.mark !== '') {
          if (a.subject_id != null) {
            if (!(a.subject_id in bySubject)) bySubject[a.subject_id] = [];
            bySubject[a.subject_id].push(m);
            subjectGrades.push({ pct, assessment: a, mark: m });
          }
          if (a.term_id != null) {
            if (!(a.term_id in byTerm)) byTerm[a.term_id] = [];
            byTerm[a.term_id].push(m);
          }
          if (a.assessment_type_id != null) {
            if (!(a.assessment_type_id in byType)) byType[a.assessment_type_id] = [];
            byType[a.assessment_type_id].push(m);
          }
        }
      });

      const subjectPct = {};
      Object.keys(bySubject).forEach(sid => {
        subjectPct[sid] = this.learnerPct(bySubject[sid], assessments, ctx.types);
      });
      const termPct = {};
      Object.keys(byTerm).forEach(tid => {
        termPct[tid] = this.learnerPct(byTerm[tid], assessments, ctx.types);
      });
      const typePct = {};
      Object.keys(byType).forEach(tid => {
        typePct[tid] = this.learnerPct(byType[tid], assessments, ctx.types);
      });

      const overall = this.learnerPct(ms, assessments, ctx.types);
      const grade = overall == null ? 'N/R' : Utils.grade(overall, ctx.scale);
      const pass = ctx.settings && this.passMark(ctx.settings);
      const pf = overall == null ? 'N/R' : (overall >= pass ? 'PASS' : 'FAIL');
      const gradeDist = Utils.gradeDist(subjectGrades.map(g => Utils.grade(g.pct, ctx.scale)));

      return {
        id,
        code: learner.learner_code || '-',
        name: learner.full_name,
        gender: learner.gender || '-',
        classId: learner.class_id,
        className: learner.class_id ? ctx.classByName(learner.class_id)?.name || '-' : '-',
        marks: ms,
        pct: overall,
        grade,
        pf,
        passed: pf === 'PASS',
        subjectPct,
        subjectGrades,
        termPct,
        assessmentPct: byAssessment,
        typePct,
        gradeDist
      };
    }).filter(Boolean);

    rows.sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct));
    let pos = 1;
    rows.forEach((r, i) => {
      if (i > 0 && rows[i - 1].pct != null && r.pct != null && r.pct < rows[i - 1].pct) pos = i + 1;
      r.position = r.pct == null ? null : pos;
    });
    return rows;
  },

  avgValues(vals) {
    const v = vals.filter(x => x != null && !isNaN(x));
    if (!v.length) return 0;
    return Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100;
  },

  compute(filters, ctx, result, isTeacher) {
    const { assessments, marks } = result;
    const learners = this.buildLearners(assessments, marks, ctx);
    const passMark = this.passMark(ctx.settings);
    const target = this.target();

    const theLearners = learners.filter(l => l.pct != null);
    const overall = this.avgValues(theLearners.map(l => l.pct));

    const subjectMap = {};
    assessments.forEach(a => {
      if (!a.subject_id) return;
      if (!subjectMap[a.subject_id]) subjectMap[a.subject_id] = { id: a.subject_id, name: a._subject?.name || 'Unknown', assessments: [] };
      subjectMap[a.subject_id].assessments.push(a);
    });

    const subjectPerf = Object.keys(subjectMap).map(sid => {
      const group = assessments.filter(a => a.subject_id === sid);
      const marksIn = marks.filter(m => group.some(a => a.id === m.assessment_id));
      const pcts = marksIn.map(m => this.pctFor(m.mark, group.find(a => a.id === m.assessment_id)));
      const valid = pcts.filter(p => p != null);
      return {
        id: sid,
        name: subjectMap[sid].name,
        avg: this.avgValues(pcts),
        count: valid.length,
        passRate: valid.length ? Math.round((valid.filter(p => p >= passMark).length / valid.length) * 1000) / 10 : 0
      };
    }).sort((a, b) => b.avg - a.avg);

    const classMap = {};
    learners.forEach(l => {
      const key = l.className || 'Ungrouped';
      if (!classMap[key]) classMap[key] = [];
      classMap[key].push(l);
    });
    const classPerf = Object.keys(classMap).map(name => {
      const ls = classMap[name].filter(l => l.pct != null);
      return {
        name,
        avg: this.avgValues(ls.map(l => l.pct)),
        passRate: ls.length ? Math.round((ls.filter(l => l.passed).length / ls.length) * 1000) / 10 : 0,
        count: ls.length
      };
    }).sort((a, b) => b.avg - a.avg);

    const assessmentPerf = assessments.map(a => {
      const ms = marks.filter(m => m.assessment_id === a.id);
      const valid = ms.map(m => this.pctFor(m.mark, a)).filter(p => p != null);
      return {
        id: a.id,
        name: a.name,
        typeName: a._typeName,
        unit: a.unit || '',
        date: a.assessment_date,
        max: Number(a.maximum_mark) || 0,
        avg: this.avgValues(valid),
        count: valid.length,
        weight: a._effWeight,
        termId: a.term_id,
        termName: a._term?.name || '',
        passRate: valid.length ? Math.round((valid.filter(p => p >= passMark).length / valid.length) * 1000) / 10 : 0
      };
    }).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name)));

    const termMap = {};
    for (const a of assessments) {
      if (!a.term_id) continue;
      if (!termMap[a.term_id]) termMap[a.term_id] = { id: a.term_id, name: a._term?.name || 'Term', assessments: [] };
      termMap[a.term_id].assessments.push(a);
    }
    const termIds = Object.keys(termMap).sort((a, b) => {
      const ta = ctx.termById(a), tb = ctx.termById(b);
      return (Number(ta?.term_no) || 0) - (Number(tb?.term_no) || 0);
    });
    const termPerf = termIds.map(tid => {
      const ta = ctx.termById(tid);
      const names = String(ta?.name || '').match(/\d+/g);
      const ctxLearners = learners.map(l => {
        const marksIn = l.marks.filter(m => assessments.some(a => a.id === m.assessment_id && a.term_id === tid));
        return { l, pct: this.learnerPct(marksIn, assessments, ctx.types) };
      }).filter(x => x.pct != null);
      return {
        id: tid,
        name: names ? 'Term ' + names[0] : (ta?.name || 'Term'),
        avg: this.avgValues(ctxLearners.map(x => x.pct)),
        passRate: ctxLearners.length ? Math.round((ctxLearners.filter(x => x.pct >= passMark).length / ctxLearners.length) * 1000) / 10 : 0,
        count: ctxLearners.length
      };
    });

    const typeMap = {};
    assessments.forEach(a => {
      const tid = a.assessment_type_id || 'none';
      if (!typeMap[tid]) typeMap[tid] = { id: tid, name: a._typeName, assessments: [] };
      typeMap[tid].assessments.push(a);
    });
    const typePerf = Object.keys(typeMap).map(tid => {
      const group = assessments.filter(a => (a.assessment_type_id || 'none') === tid);
      const marksIn = marks.filter(m => group.some(a => a.id === m.assessment_id));
      const valid = marksIn.map(m => this.pctFor(m.mark, group.find(a => a.id === m.assessment_id))).filter(p => p != null);
      return {
        id: tid,
        name: typeMap[tid].name,
        avg: this.avgValues(valid),
        count: valid.length
      };
    }).sort((a, b) => b.avg - a.avg);

    const gradeDist = {};
    theLearners.forEach(l => { const g = l.grade; gradeDist[g] = (gradeDist[g] || 0) + 1; });
    const gradeOrder = ['A', 'B', 'C', 'D', 'E', 'F'];
    const gradeKeys = Object.keys(gradeDist).sort((a, b) => {
      const ia = gradeOrder.indexOf(a), ib = gradeOrder.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || String(a).localeCompare(String(b));
    });
    const gradeRows = gradeKeys.map(g => ({ label: g, value: gradeDist[g], remark: (ctx.scale.find(s => s.grade === g) || {}).remark || '' }));

    const passed = theLearners.filter(l => l.passed).length;
    const failed = theLearners.length - passed;

    const aboveTarget = theLearners.filter(l => l.pct >= target).length;
    const belowTarget = theLearners.filter(l => l.pct < target).length;

    const heatRows = [];
    const heatCols = subjectPerf.map(s => s.name);
    const classKeys = Object.keys(classMap).sort();
    classKeys.forEach(cname => {
      heatRows.push({
        label: cname,
        values: heatCols.map(subName => {
          const subEntry = Object.keys(subjectMap).find(sid => subjectMap[sid].name === subName);
          if (!subEntry) return null;
          const ls = classMap[cname].filter(l => l.subjectPct && l.subjectPct[subEntry] != null).map(l => l.subjectPct[subEntry]);
          return ls.length ? this.avgValues(ls) : null;
        })
      });
    });

    const studentsMajors = theLearners.filter(l => l.pct != null);
    const limit = filters.limit === 'all' ? Infinity : (Number(filters.limit) || 10);
    const top = studentsMajors.slice(0, limit).filter(l => l.pct != null);
    const bottom = [...studentsMajors].reverse().slice(0, limit).filter(l => l.pct != null).reverse();

    const teacherPerf = [];
    const teacherIds = [...new Set(assessments.map(a => a.teacher_id).filter(Boolean))];
    teacherIds.forEach(tid => {
      const teacher = ctx.teacherById(tid);
      const ta = assessments.filter(a => a.teacher_id === tid);
      const marksIn = marks.filter(m => ta.some(a => a.id === m.assessment_id));
      const valid = marksIn.map(m => this.pctFor(m.mark, ta.find(a => a.id === m.assessment_id))).filter(p => p != null);
      const subjects = [...new Set(ta.map(a => a._subject?.name).filter(Boolean))].join(', ');
      const classesIn = [...new Set(ta.map(a => a._class?.name).filter(Boolean))].join(', ');
      const learnerCount = new Set(marksIn.map(m => m.learner_id).filter(Boolean)).size;
      teacherPerf.push({
        name: teacher?.full_name || 'Unknown',
        code: teacher?.teacher_code || '',
        subjects,
        classes: classesIn,
        assessments: ta.length,
        avg: this.avgValues(valid),
        passRate: valid.length ? Math.round((valid.filter(p => p >= passMark).length / valid.length) * 1000) / 10 : 0,
        students: learnerCount
      });
    });
    teacherPerf.sort((a, b) => b.avg - a.avg);

    const kpis = {
      students: learners.length,
      assessed: theLearners.length,
      subjects: subjectPerf.length,
      assessments: assessments.length,
      overall,
      classAverage: filters.classId && filters.classId !== 'all' ? overall : null,
      highest: theLearners.length ? Math.max(...theLearners.map(l => l.pct)) : null,
      lowest: theLearners.length ? Math.min(...theLearners.map(l => l.pct)) : null,
      passRate: theLearners.length ? Math.round((passed / theLearners.length) * 1000) / 10 : 0,
      failRate: theLearners.length ? Math.round((failed / theLearners.length) * 1000) / 10 : 0,
      passed,
      failed,
      passMark,
      target,
      aboveTarget,
      belowTarget,
      marksCount: marks.length
    };

    const insights = this.insights(filters, ctx, { kpis, subjectPerf, classPerf, assessmentPerf, termPerf, learners, passMark, target, theLearners });

    return {
      ctx,
      assessments,
      marks,
      learners,
      kpis,
      subjectPerf,
      classPerf,
      assessmentPerf,
      termPerf,
      typePerf,
      gradeDist,
      gradeRows,
      passed,
      failed,
      aboveTarget,
      belowTarget,
      heatRows,
      heatCols,
      top,
      bottom,
      teacherPerf,
      insights
    };
  },

  insights(filters, ctx, d) {
    const out = [];
    const { kpis, subjectPerf, classPerf, assessmentPerf, termPerf, passMark, target, theLearners } = d;

    if (theLearners.length) {
      out.push({ text: `${theLearners.length} assessed student${theLearners.length === 1 ? '' : 's'} scored an overall average of ${kpis.overall}%.`, tone: kpis.overall >= kpis.passMark ? 'good' : 'warn' });
      out.push({ text: `${kpis.passRate}% of assessed students achieved the configured pass mark of ${passMark}%.`, tone: kpis.passRate >= 50 ? 'good' : 'warn' });
      out.push({ text: `${kpis.aboveTarget} student${kpis.aboveTarget === 1 ? '' : 's'} met or exceeded the performance target of ${target}%, and ${kpis.belowTarget} student${kpis.belowTarget === 1 ? '' : 's'} are below it.`, tone: kpis.aboveTarget >= kpis.belowTarget ? 'good' : 'warn' });
    }

    if (subjectPerf.length) {
      const best = subjectPerf[0];
      const worst = subjectPerf[subjectPerf.length - 1];
      out.push({ text: `${best.name} has the highest average at ${best.avg}%.`, tone: 'good' });
      out.push({ text: `${worst.name} has the lowest average at ${worst.avg}%${worst.avg < passMark ? ' and may require academic intervention' : ''}.`, tone: worst.avg < passMark ? 'warn' : 'info' });
    }

    if (classPerf.length > 1) {
      const bestC = classPerf[0];
      const worstC = classPerf[classPerf.length - 1];
      out.push({ text: `${bestC.name} leads with an average of ${bestC.avg}%, while ${worstC.name} averages ${worstC.avg}% (a ${this.round(bestC.avg - worstC.avg, 1)} percentage-point gap).`, tone: 'info' });
    }

    if (termPerf.length > 1) {
      for (let i = 1; i < termPerf.length; i++) {
        const prev = termPerf[i - 1].avg;
        const cur = termPerf[i].avg;
        const diff = this.round(cur - prev, 1);
        if (Math.abs(diff) >= 0.05) {
          out.push({ text: `${termPerf[i].name} average ${diff >= 0 ? 'increased' : 'decreased'} by ${Math.abs(diff)} percentage points from ${termPerf[i - 1].name} (${prev}% to ${cur}%).`, tone: diff >= 0 ? 'good' : 'warn' });
        }
      }
    }

    if (assessmentPerf.length > 1) {
      const firstA = assessmentPerf[0];
      const lastA = assessmentPerf[assessmentPerf.length - 1];
      const diff = this.round(lastA.avg - firstA.avg, 1);
      out.push({ text: `From ${firstA.name} (${firstA.avg}%) to ${lastA.name} (${lastA.avg}%), performance ${diff >= 0 ? 'improved' : 'declined'} by ${Math.abs(diff)} percentage points across assessments.`, tone: diff >= 0 ? 'good' : 'warn' });
    }

    const struggling = subjectPerf.filter(s => s.avg < passMark);
    if (struggling.length) {
      out.push({ text: `Subjects with averages below the pass mark (${passMark}%): ${struggling.map(s => s.name).join(', ')}.`, tone: 'warn' });
    }

    return out;
  },

  round(v, d) {
    if (v == null || isNaN(v)) return 0;
    const p = Math.pow(10, d || 0);
    return Math.round(Number(v) * p) / p;
  }
};