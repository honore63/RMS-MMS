function assertClassScope(cls) {
  if (!cls || !cls.id) throw new Error('Select a valid class.');
  if (typeof Scope !== 'undefined' && Scope.isScoped() && cls && cls.id && !Scope.matchesClass(cls)) {
    throw new Error(`Access restricted: ${EducationLevels.getCategory(cls)} classes are outside your ${Scope.label()} scope.`);
  }
}

function subjectMatchesReportScope(subject, cls = null) {
  if (!subject) return false;
  if (typeof Scope !== 'undefined' && Scope.isScoped() && !Scope.matchesSubject(subject)) return false;
  if (!cls) return true;
  const classLevel = EducationLevels.getCategory(cls);
  const subjectLevel = String(subject.level || 'Both').trim().toUpperCase();
  if (!subjectLevel || subjectLevel === 'BOTH') return true;
  if (classLevel === 'Primary') return subjectLevel === 'PRIMARY';
  if (String(classLevel).toUpperCase().includes('SECONDARY')) {
    return ['SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY'].includes(subjectLevel);
  }
  return false;
}

function filterReportSubjects(subjects, cls = null) {
  return (subjects || []).filter(subject => subjectMatchesReportScope(subject, cls));
}

function filterReportAssessments(assessments, subjects, cls = null) {
  const allowedSubjectIds = new Set(filterReportSubjects(subjects, cls).map(subject => String(subject.id)));
  return (assessments || []).filter(assessment => allowedSubjectIds.has(String(assessment.subject_id)));
}

function reportMarkMaximum(mark, assessmentsById, fallback = 0) {
  const assessment = assessmentsById.get(String(mark.assessment_id));
  return Number(mark.max_mark ?? assessment?.maximum_mark ?? fallback) || 0;
}

const ReportEngine = {
  current: null,

  async generate(config) {
    const { reportType, academicYear, term, classId, subjectId, subjectIds, teacherId, assessmentId, studentId } = config;
    // Normalize array selections (wizard uses arrays)
    const classIds = config.classIds || (classId ? [classId] : []);
    const allSubjectIds = config.subjectIds || (subjectId ? [subjectId] : (subjectIds || []));
    const assessmentIds = config.assessmentIds || (assessmentId ? [assessmentId] : []);
    const studentIds = config.studentIds || (studentId ? [studentId] : []);
    const termIds = config.termIds || (term ? [term] : []);
    const teacherIds = config.teacherIds || (teacherId ? [teacherId] : []);
    const [settings, scale] = await Promise.all([
      ReportUtils.getSettings(),
      ReportUtils.getScale()
    ]);
    const passMark = settings.pass_mark || 50;

    const [year, activeTerm] = await Promise.all([
      academicYear ? ReportUtils.getYear(academicYear) : ReportUtils.getActiveYear(),
      term ? ReportUtils.getTerm(term) : (termIds[0] ? ReportUtils.getTerm(termIds[0]) : ReportUtils.getActiveTerm())
    ]);
    // For multi-term reports, keep full termIds for engine filtering; also keep activeTerm for display fallback
    const termObj = termIds.length ? (await ReportUtils.getTerm(termIds[0])) : activeTerm;

    const ctx = { settings, scale, passMark, year, term: termObj, activeTerm, classId: classIds[0]||classId, classIds, subjectId, subjectIds: allSubjectIds, teacherId: teacherIds[0]||teacherId, teacherIds, assessmentId, assessmentIds, studentId, studentIds, termIds,
      assessmentTypeId: config.assessmentTypeId, teacherComment: config.teacherComment,
      dosComment: config.dosComment, decisionOverride: config.decisionOverride, options: config.options };

    switch (reportType) {
      case 'student-card': return this.generateStudentCard(ctx);
      case 'exam-class-summary': return this.generateExamClassSummary(ctx);
      case 'subject-performance': return this.generateSubjectPerformance(ctx);
      case 'class-performance': return this.generateClassPerformance(ctx);
      case 'missing-marks': return this.generateMissingMarks(ctx);
      case 'school-performance': return this.generateSchoolPerformance(ctx);
      case 'teacher-performance': return this.generateTeacherPerformance(ctx);
      case 'grade-distribution': return this.generateGradeDistribution(ctx);
      case 'student-performance': {
        const card = await this.generateStudentCard(ctx);
        card.type = 'student-performance';
        card.title = 'STUDENT PERFORMANCE REPORT';
        return card;
      }
      case 'class-marks-sheet': return this.generateMarksMatrix(ctx, 'class');
      case 'subject-marks-sheet': return this.generateMarksMatrix(ctx, 'subject');
      case 'student-marks': return this.generateStudentMarks(ctx);
      case 'subject-assessment-comparison': return this.generateSubjectAssessmentComparison(ctx);
      case 'assessment-summary': return this.generateAssessmentSummary(ctx);
      case 'assessment-completion': return this.generateAssessmentCompletion(ctx);
      case 'teacher-assessment-submission': return this.generateTeacherAssessmentSubmission(ctx);
      case 'subject-grade-distribution': {
        const d = await this.generateGradeDistribution(ctx);
        d.type = 'subject-grade-distribution';
        d.title = 'SUBJECT GRADE DISTRIBUTION';
        return d;
      }
      case 'class-ranking': {
        const d = await this.generateClassPerformance(ctx);
        d.type = 'class-ranking';
        d.title = 'CLASS RANKING REPORT';
        return d;
      }
      case 'term-performance-summary': {
        const d = await this.generateSchoolPerformance(ctx);
        d.type = 'term-performance-summary';
        d.title = 'TERM PERFORMANCE SUMMARY';
        const termName = d.term && d.term.name ? d.term.name : ctx.termIds && ctx.termIds.length > 1 ? 'All Terms' : '';
        d.term = d.term ? { ...d.term, name: termName } : { name: termName };
        d.scopeLabel = 'Term';
        return d;
      }
      case 'academic-year-performance': {
        const d = await this.generateSchoolPerformance(ctx);
        d.type = 'academic-year-performance';
        d.title = 'ACADEMIC YEAR PERFORMANCE REPORT';
        const termName = ctx.termIds && ctx.termIds.length > 1 ? 'All Terms (Annual)' : (d.term && d.term.name ? d.term.name : '');
        d.term = d.term ? { ...d.term, name: termName } : { name: termName };
        d.scopeLabel = 'Academic Year';
        return d;
      }
      default: throw new Error(`Unknown report type: ${reportType}`);
    }
  },

  async generateStudentCard(ctx) {
    // Single source of truth: delegate to the dynamic ReportStudent module.
    if (typeof ReportStudent !== 'undefined' && ctx.studentId && ctx.classId) {
      const yearId = ctx.year && ctx.year.id ? ctx.year.id : ctx.year;
      const termId = ctx.term && ctx.term.id ? ctx.term.id : ctx.term;
      const termIds = ctx.termIds && ctx.termIds.length ? ctx.termIds : (termId ? [termId] : null);
      return ReportStudent.fetchCardData({
        learnerId: ctx.studentId, classId: ctx.classId, yearId, termId: termIds && termIds.length===1 ? termIds[0] : termId, termIds,
        subjectIds: (ctx.subjectIds && ctx.subjectIds.length) ? ctx.subjectIds : (ctx.subjectId ? [ctx.subjectId] : null),
        assessmentIds: ctx.assessmentIds && ctx.assessmentIds.length ? ctx.assessmentIds : null,
        assessmentTypeId: ctx.assessmentTypeId || null,
        teacherComment: ctx.teacherComment || '', dosComment: ctx.dosComment || '',
        decisionOverride: ctx.decisionOverride || ''
      });
    }
    const { settings, scale, passMark, year, term, classId, studentId } = ctx;
    const learner = await DB.get('learners', { id: studentId }).then(r => r[0]);
    if (!learner) throw new Error('Student not found');
    const cls = await DB.get('classes', { id: learner.class_id }).then(r => r[0]);
    assertClassScope(cls);
    const eduCat = EducationLevels.getCategory(cls);

    const subjects = await ReportUtils.getSubjects({ status: 'active' });
    const levelSubjects = filterReportSubjects(subjects, cls).filter(s => !s.level || s.level === 'Both' || s.level === eduCat);

    const yearScope = year && year.id ? year.id : undefined;
    const assessFilter = { class_id: classId, status: ['approved', 'locked'] };
    if (yearScope) assessFilter.academic_year_id = yearScope;
    if (term && term.id) assessFilter.term_id = term.id;
    const assessments = await DB.query('assessments', '*', assessFilter, { column: 'assessment_date', asc: false });
    const validAssessments = assessments.filter(a => levelSubjects.some(s => s.id === a.subject_id));
    const assessIds = validAssessments.map(a => a.id);

    let allMarks = [];
    if (assessIds.length) {
      for (let i = 0; i < assessIds.length; i += 50) {
        const batch = assessIds.slice(i, i + 50);
        const marks = await DB.query('marks', '*', { learner_id: studentId, assessment_id: batch });
        allMarks = allMarks.concat(marks);
      }
    }

    const termIds = [term.id];
    const filteredTerms = [term];
    let totalObt = 0, totalMax = 0, subjCount = 0, passed = 0, failed = 0;

    const subjRows = await Promise.all(levelSubjects.map(async (subj) => {
      const subjAssessments = validAssessments.filter(a => a.subject_id === subj.id);
      const subjAssessIds = subjAssessments.map(a => a.id);
      const subjMarks = allMarks.filter(m => subjAssessIds.includes(m.assessment_id));
      const maxMark = subjAssessments.reduce((sum, a) => sum + (Number(a.maximum_mark) || 0), 0);
      const obtained = subjMarks.reduce((sum, m) => sum + (Number(m.mark) || 0), 0);
      const pct = maxMark > 0 ? Utils.pct(obtained, maxMark) : 0;
      const gradeInfo = ReportUtils.calcGrade(pct, scale);
      const pf = ReportUtils.calcPassFail(pct, passMark);
      if (pf === 'PASS') passed++; else failed++;
      totalObt += obtained; totalMax += maxMark; subjCount++;
      return { subject: subj.name, unit: subj.unit, maxMark, obtained, pct, grade: gradeInfo.grade, descriptor: gradeInfo.descriptor, passFail: pf, isPass: gradeInfo.isPass };
    }));

    const overallPct = totalMax > 0 ? Utils.pct(totalObt, totalMax) : 0;
    const overallGrade = ReportUtils.calcGrade(overallPct, scale);
    const overallPf = ReportUtils.calcPassFail(overallPct, passMark);
    const avg = subjCount > 0 ? Math.round((overallPct / subjCount) * 100) / 100 : 0;

    return {
      type: 'student-card', title: 'STUDENT REPORT CARD',
      settings, learner, cls, year, term, subjRows, overallPct, overallGrade, overallPf,
      totalSubjects: subjCount, passed, failed, avg, totalObtained: totalObt, totalMax,
      scale, passMark
    };
  },

  async generateExamClassSummary(ctx) {
    const { settings, scale, passMark, year, term, classId, assessmentId, assessmentIds, termIds } = ctx;
    const cls = await DB.get('classes', { id: classId }).then(r => r[0]);
    assertClassScope(cls);
    const learners = await ReportUtils.getLearners(classId);
    let assessments;
    if (assessmentIds && assessmentIds.length) {
      assessments = await DB.query('assessments', '*', { id: assessmentIds, class_id: classId }, { column: 'assessment_date', asc: false });
    } else if (assessmentId) {
      assessments = await DB.get('assessments', { id: assessmentId }).then(r => r[0] ? [r[0]] : []);
    } else {
      const f={ class_id: classId, academic_year_id: year.id || undefined, status: ['approved', 'locked'] };
      if (termIds && termIds.length) f.term_id = termIds;
      else if (term && term.id) f.term_id = term.id;
      assessments = await DB.query('assessments', '*', f, { column: 'assessment_date', asc: false });
    }
    if (termIds && termIds.length && !(assessmentIds && assessmentIds.length)) {
      const tSet=new Set(termIds.map(String));
      assessments = assessments.filter(a=> !a.term_id || tSet.has(String(a.term_id)));
    }
    const subjects = await DB.get('subjects');
    const scopedAssessments = filterReportAssessments(assessments, subjects, cls);

    const assess = scopedAssessments[0];
    if (!assess) throw new Error('No assessment found');

    const assessIds = scopedAssessments.map(a => a.id);
    const allMarks = await DB.query('marks', '*', { assessment_id: assessIds }, { column: 'learner_id' });
    const assessmentsById = new Map(scopedAssessments.map(a => [String(a.id), a]));
    const marksByLearner = new Map();
    allMarks.forEach(mark => {
      const key = String(mark.learner_id);
      if (!marksByLearner.has(key)) marksByLearner.set(key, []);
      marksByLearner.get(key).push(mark);
    });

    const totalLearners = learners.length;
    let assessedCount = 0;
    const pcts = [];
    const learnerRows = [];

    for (const learner of learners) {
      const marks = marksByLearner.get(String(learner.id)) || [];
      const validMarks = marks.filter(m => m.mark != null);
      if (validMarks.length) {
        assessedCount++;
        const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = validMarks.reduce((s, m) => s + reportMarkMaximum(m, assessmentsById), 0);
        const pct = totalMax > 0 ? Utils.pct(totalObtained, totalMax) : 0;
        pcts.push(pct);
        learnerRows.push({ learner, pct, grade: ReportUtils.calcGrade(pct, scale).grade, passFail: ReportUtils.calcPassFail(pct, passMark) });
      } else {
        learnerRows.push({ learner, pct: null, grade: '-', passFail: '-' });
      }
    }

    const stats = await ReportUtils.computeStats(pcts, passMark);
    const sorted = [...learnerRows.filter(r => r.pct != null)].sort((a, b) => b.pct - a.pct);
    const positions = Utils.positions(sorted.map(r => ({ id: r.learner.id, pct: r.pct })));
    const posMap = {};
    positions.forEach(p => posMap[p.id] = p.position);

    return {
      type: 'exam-class-summary', title: 'EXAM CLASS PERFORMANCE SUMMARY',
      settings, cls, year, term, assess, totalLearners, assessedCount,
      missingMarks: totalLearners - assessedCount, stats, learnerRows, positions: posMap, scale, passMark
    };
  },

  async generateSubjectPerformance(ctx) {
    const { settings, scale, passMark, year, term, classId, subjectId, subjectIds, teacherId, assessmentIds, termIds } = ctx;
    const cls = await DB.get('classes', { id: classId }).then(r => r[0]);
    assertClassScope(cls);
    const selectedSubjectIds = (subjectIds && subjectIds.length) ? subjectIds : (subjectId ? [subjectId] : []);
    const selectedSubjects = selectedSubjectIds.length
      ? await DB.query('subjects', '*', { id: selectedSubjectIds })
      : await ReportUtils.getSubjects({ status: 'active' });
    const scopedSubjects = filterReportSubjects(selectedSubjects, cls);
    if (selectedSubjectIds.length && scopedSubjects.length !== selectedSubjects.length) {
      throw new Error('One or more selected subjects are outside the current education-level scope.');
    }
    const subject = selectedSubjects.length === 1
      ? selectedSubjects[0]
      : { name: selectedSubjects.map(item => item.name).join(', ') || 'Selected Subjects' };
    const learners = await ReportUtils.getLearners(classId);

    const filter = { class_id: classId, academic_year_id: year.id || undefined, subject_id: selectedSubjectIds, status: ['approved', 'locked'] };
    if (teacherId) filter.teacher_id = teacherId;
    if (assessmentIds && assessmentIds.length) filter.id = assessmentIds;
    if (termIds && termIds.length) filter.term_id = termIds;
    else if (term && term.id && !assessmentIds) filter.term_id = term.id;
    let rawAssess = await DB.query('assessments', '*', filter, { column: 'assessment_date', asc: false });
    if (termIds && termIds.length){
      const tSet=new Set(termIds.map(String));
      rawAssess = rawAssess.filter(a=> !a.term_id || tSet.has(String(a.term_id)));
    }
    if (assessmentIds && assessmentIds.length){
      const aSet=new Set(assessmentIds.map(String));
      rawAssess = rawAssess.filter(a=> aSet.has(String(a.id)));
    }
    const assessments = filterReportAssessments(rawAssess, scopedSubjects, cls);
    const assessIds = assessments.map(a => a.id);

    const allMarks = await DB.query('marks', '*', { assessment_id: assessIds }, { column: 'learner_id' });
    const assessmentsById = new Map(assessments.map(a => [String(a.id), a]));
    const marksByLearner = new Map();
    allMarks.forEach(mark => {
      const key = String(mark.learner_id);
      if (!marksByLearner.has(key)) marksByLearner.set(key, []);
      marksByLearner.get(key).push(mark);
    });
    const learnerRows = [];
    const pcts = [];
    for (const learner of learners) {
      const marks = marksByLearner.get(String(learner.id)) || [];
      const validMarks = marks.filter(m => m.mark != null);
      if (validMarks.length) {
        const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = validMarks.reduce((s, m) => s + reportMarkMaximum(m, assessmentsById), 0);
        const pct = totalMax > 0 ? Utils.pct(totalObtained, totalMax) : 0;
        pcts.push(pct);
        learnerRows.push({ learner, pct, grade: ReportUtils.calcGrade(pct, scale).grade, passFail: ReportUtils.calcPassFail(pct, passMark) });
      } else {
        learnerRows.push({ learner, pct: null, grade: '-', passFail: '-' });
      }
    }

    const stats = await ReportUtils.computeStats(pcts, passMark);
    const sorted = [...learnerRows.filter(r => r.pct != null)].sort((a, b) => b.pct - a.pct);
    const positions = Utils.positions(sorted.map(r => ({ id: r.learner.id, pct: r.pct })));
    const posMap = {};
    positions.forEach(p => posMap[p.id] = p.position);

    return {
      type: 'subject-performance', title: 'SUBJECT PERFORMANCE SUMMARY',
      settings, cls, subject, year, term, teacherId, totalLearners: learners.length,
      stats, learnerRows, positions: posMap, scale, passMark, assessments
    };
  },

  async generateClassPerformance(ctx) {
    const { settings, scale, passMark, year, term, classId, subjectIds, assessmentIds, termIds } = ctx;
    const cls = await DB.get('classes', { id: classId }).then(r => r[0]);
    assertClassScope(cls);
    const learners = await ReportUtils.getLearners(classId);
    const subjects = await DB.get('subjects');
    // apply subject/assessment/term multi-select filters
    let filteredSubjects = subjects;
    if (subjectIds && subjectIds.length){
      const sSet=new Set(subjectIds.map(String));
      filteredSubjects = subjects.filter(s=> sSet.has(String(s.id)));
    }
    const qFilter={ class_id: classId, academic_year_id: year.id || undefined, status: ['approved', 'locked'] };
    if (termIds && termIds.length) qFilter.term_id = termIds;
    else if (term && term.id) qFilter.term_id = term.id;
    if (assessmentIds && assessmentIds.length) qFilter.id = assessmentIds;
    if (subjectIds && subjectIds.length) qFilter.subject_id = subjectIds;
    let raw = await DB.query('assessments', '*', qFilter, { column: 'assessment_date', asc: false });
    if (termIds && termIds.length){ const tSet=new Set(termIds.map(String)); raw=raw.filter(a=> !a.term_id || tSet.has(String(a.term_id))); }
    if (assessmentIds && assessmentIds.length){ const aSet=new Set(assessmentIds.map(String)); raw=raw.filter(a=> aSet.has(String(a.id))); }
    const assessments = filterReportAssessments(raw, filteredSubjects, cls);
    const assessIds = assessments.map(a => a.id);
    const allMarks = assessIds.length ? await DB.query('marks', '*', { assessment_id: assessIds }, { column: 'learner_id' }) : [];
    const assessmentsById = new Map(assessments.map(a => [String(a.id), a]));
    const marksByLearner = new Map();
    allMarks.forEach(mark => {
      const key = String(mark.learner_id);
      if (!marksByLearner.has(key)) marksByLearner.set(key, []);
      marksByLearner.get(key).push(mark);
    });
    const learnerStats = [];

    for (const learner of learners) {
      const marks = marksByLearner.get(String(learner.id)) || [];
      const validMarks = marks.filter(m => m.mark != null);
      if (validMarks.length) {
        const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = validMarks.reduce((s, m) => s + reportMarkMaximum(m, assessmentsById, 100), 0);
        const pct = totalMax > 0 ? Utils.pct(totalObtained, totalMax) : 0;
        learnerStats.push({ learner, pct, grade: ReportUtils.calcGrade(pct, scale).grade, passFail: ReportUtils.calcPassFail(pct, passMark) });
      } else {
        learnerStats.push({ learner, pct: null, grade: '-', passFail: '-' });
      }
    }

    const allPcts = learnerStats.filter(s => s.pct != null).map(s => s.pct);
    const stats = await ReportUtils.computeStats(allPcts, passMark);
    const sorted = [...learnerStats.filter(s => s.pct != null)].sort((a, b) => b.pct - a.pct);
    const positions = Utils.positions(sorted.map(s => ({ id: s.learner.id, pct: s.pct })));
    const posMap = {};
    positions.forEach(p => posMap[p.id] = p.position);

    return {
      type: 'class-performance', title: 'CLASS PERFORMANCE REPORT',
      settings, cls, year, term, totalLearners: learners.length, stats,
      learnerStats, positions: posMap, scale, passMark
    };
  },

  async generateMissingMarks(ctx) {
    const { settings, year, term, classId, classIds, subjectIds, assessmentIds, termIds } = ctx;
    let classes;
    if (classIds && classIds.length) classes = await DB.query('classes', '*', { id: classIds });
    else if (classId) classes = await DB.get('classes', { id: classId }).then(r => r[0] ? [r[0]] : []);
    else classes = await DB.get('classes', typeof Scope !== 'undefined' && Scope.isScoped() ? { education_level: Scope.categories() } : {});
    classes = (classes||[]).filter(c=> { if(typeof Scope!=='undefined'&&Scope.isScoped()) return Scope.matchesClass(c); return true; });
    let subjects = await DB.get('subjects');
    if (subjectIds && subjectIds.length){ const sSet=new Set(subjectIds.map(String)); subjects=subjects.filter(s=> sSet.has(String(s.id))); }
    const teachers = await DB.get('teachers');
    const qf={ academic_year_id: year.id || undefined };
    if (termIds && termIds.length) qf.term_id = termIds;
    else if (term && term.id) qf.term_id = term.id;
    if (classIds && classIds.length) qf.class_id = classIds;
    else if (classId) qf.class_id = classId;
    if (assessmentIds && assessmentIds.length) qf.id = assessmentIds;
    if (subjectIds && subjectIds.length) qf.subject_id = subjectIds;
    let assessments = await DB.query('assessments', '*', qf, { column: 'created_at', asc: false });
    if (termIds && termIds.length){ const tSet=new Set(termIds.map(String)); assessments=assessments.filter(a=> !a.term_id || tSet.has(String(a.term_id))); }
    if (assessmentIds && assessmentIds.length){ const aSet=new Set(assessmentIds.map(String)); assessments=assessments.filter(a=> aSet.has(String(a.id))); }

    const rows = [];
    for (const cls of classes) {
      assertClassScope(cls);
      for (const subj of filterReportSubjects(subjects, cls)) {
        const subjAssessments = assessments.filter(a => a.class_id === cls.id && a.subject_id === subj.id);
        if (!subjAssessments.length) continue;
        const assessIds = subjAssessments.map(a => a.id);
        const expectedLearners = await DB.query('learners', '*', { class_id: cls.id, status: 'active' });
        const expectedCount = expectedLearners.length;
        let marksEntered = 0;
        const { count: totalMarks } = await sbClient.from('marks').select('*', { count: 'exact', head: true }).in('assessment_id', assessIds);
        const { count: nonNullMarks } = await sbClient.from('marks').select('*', { count: 'exact', head: true }).in('assessment_id', assessIds).not('mark', 'null');
        marksEntered = nonNullMarks || 0;
        const missingCount = expectedCount * subjAssessments.length - marksEntered;
        const completionPct = expectedCount * subjAssessments.length > 0 ? Math.round((marksEntered / (expectedCount * subjAssessments.length)) * 1000) / 10 : 0;
        const teacher = teachers.find(t => t.id === subjAssessments[0]?.teacher_id);
        let status = 'COMPLETE';
        if (completionPct < 50) status = 'MISSING';
        else if (completionPct < 100) status = 'PARTIALLY COMPLETE';

        rows.push({ class: cls.name, subject: subj.name, teacher: teacher?.full_name || '-', assessment: subjAssessments.map(a => a.name).join(', '), expectedCount, marksEntered, missingCount: Math.max(0, missingCount), completionPct, status });
      }
    }

    rows.sort((a, b) => a.status.localeCompare(b.status) || b.completionPct - a.completionPct);
    return { type: 'missing-marks', title: 'MISSING MARKS REPORT', settings, year, term, rows };
  },

  async generateSchoolPerformance(ctx) {
    const { settings, scale, passMark, year, term, classIds: cfgClassIds, subjectIds, assessmentIds, termIds } = ctx;
    let classes;
    if (cfgClassIds && cfgClassIds.length) classes = await DB.query('classes', '*', { id: cfgClassIds });
    else {
      const classFilters = typeof Scope !== 'undefined' && Scope.isScoped() ? { education_level: Scope.categories() } : {};
      classes = await DB.get('classes', classFilters);
    }
    classes = (classes||[]).filter(c=> { if(typeof Scope!=='undefined'&&Scope.isScoped()) return Scope.matchesClass(c); return true; });
    let subjects = await DB.get('subjects');
    if (subjectIds && subjectIds.length){ const sSet=new Set(subjectIds.map(String)); subjects=subjects.filter(s=> sSet.has(String(s.id))); }
    const classIds = classes.map(cls => cls.id);
    const learners = classIds.length ? await DB.query('learners', '*', { class_id: classIds, status: 'active' }) : [];
    const qf={ class_id: classIds.length? classIds: undefined, academic_year_id: year.id || undefined, status: ['approved', 'locked'] };
    if (termIds && termIds.length) qf.term_id = termIds;
    else if (term && term.id) qf.term_id = term.id;
    if (assessmentIds && assessmentIds.length) qf.id = assessmentIds;
    if (subjectIds && subjectIds.length) qf.subject_id = subjectIds;
    if (!qf.class_id) delete qf.class_id;
    let raw = qf.class_id || qf.term_id || qf.subject_id || qf.id ? await DB.query('assessments', '*', qf, { column: 'assessment_date', asc: false }) : await DB.query('assessments', '*', { academic_year_id: year.id||undefined, status:['approved','locked'] }, {column:'assessment_date', asc:false});
    if (termIds && termIds.length){ const tSet=new Set(termIds.map(String)); raw=raw.filter(a=> !a.term_id || tSet.has(String(a.term_id))); }
    if (assessmentIds && assessmentIds.length){ const aSet=new Set(assessmentIds.map(String)); raw=raw.filter(a=> aSet.has(String(a.id))); }
    if (cfgClassIds && cfgClassIds.length){ const cSet=new Set(cfgClassIds.map(String)); raw=raw.filter(a=> cSet.has(String(a.class_id))); }
    const assessments = filterReportAssessments(raw, subjects).filter(assessment => {
      const cls = classes.find(item => String(item.id) === String(assessment.class_id));
      return subjectMatchesReportScope(subjects.find(subject => String(subject.id) === String(assessment.subject_id)), cls);
    });
    const assessIds = assessments.map(a => a.id);
    const allMarks = assessIds.length ? await DB.query('marks', '*', { assessment_id: assessIds }, { column: 'learner_id' }) : [];
    const assessmentsById = new Map(assessments.map(a => [String(a.id), a]));
    const marksByLearner = new Map();
    allMarks.forEach(mark => {
      const key = String(mark.learner_id);
      if (!marksByLearner.has(key)) marksByLearner.set(key, []);
      marksByLearner.get(key).push(mark);
    });
    const classReports = [];

    for (const cls of classes) {
      const classLearners = learners.filter(learner => String(learner.class_id) === String(cls.id));
      const allPcts = [];
      for (const learner of classLearners) {
        const marks = marksByLearner.get(String(learner.id)) || [];
        const validMarks = marks.filter(m => m.mark != null);
        if (validMarks.length) {
          const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
          const totalMax = validMarks.reduce((s, m) => s + reportMarkMaximum(m, assessmentsById, 100), 0);
          if (totalMax > 0) allPcts.push(Utils.pct(totalObtained, totalMax));
        }
      }
      const stats = await ReportUtils.computeStats(allPcts, passMark);
      classReports.push({ class: cls.name, learners: classLearners.length, stats });
    }

    const totalLearners = classReports.reduce((s, c) => s + c.learners, 0);
    const allClassPcts = classReports.filter(c => c.stats.avg > 0).map(c => c.stats.avg);
    const overallAvg = allClassPcts.length > 0 ? allClassPcts.reduce((a, b) => a + b, 0) / allClassPcts.length : 0;
    const overallPassRate = classReports.reduce((s, c) => s + c.stats.passRate, 0) / Math.max(classReports.length, 1);

    return { type: 'school-performance', title: 'SCHOOL PERFORMANCE SUMMARY', settings, year, term, totalLearners, totalClasses: classes.length, overallAvg, overallPassRate, classReports };
  },

  async generateTeacherPerformance(ctx) {
    const { settings, year, term, teacherId: selectedTeacherId, teacherIds, classIds: cfgClassIds, subjectIds: cfgSubjectIds, assessmentIds, termIds } = ctx;
    const effTeacherIds = (teacherIds && teacherIds.length) ? teacherIds : (selectedTeacherId ? [selectedTeacherId] : (Auth.getTeacherId() ? [Auth.getTeacherId()] : []));
    if (!effTeacherIds.length) throw new Error('Select a teacher.');
    const teacherId = effTeacherIds[0];
    const teacher = await DB.get('teachers', { id: teacherId }).then(r => r[0]);
    if (!teacher) throw new Error('Selected teacher was not found.');
    const assignments = await DB.query('teacher_assignments', '*', { teacher_id: effTeacherIds });
    const classes = await DB.get('classes');
    const subjects = await DB.get('subjects');
    const classMap = new Map(classes.map(cls => [String(cls.id), cls]));
    const subjectMap = new Map(subjects.map(subject => [String(subject.id), subject]));
    const scopedAssignments = assignments.filter(assignment => subjectMatchesReportScope(subjectMap.get(String(assignment.subject_id)), classMap.get(String(assignment.class_id))));
    let classIds = [...new Set(scopedAssignments.map(a => a.class_id))];
    let assignedSubjectIds = [...new Set(scopedAssignments.map(a => a.subject_id))];
    if (cfgClassIds && cfgClassIds.length){ const cSet=new Set(cfgClassIds.map(String)); classIds = classIds.filter(id=> cSet.has(String(id))); }
    if (cfgSubjectIds && cfgSubjectIds.length){ const sSet=new Set(cfgSubjectIds.map(String)); assignedSubjectIds = assignedSubjectIds.filter(id=> sSet.has(String(id))); }
    const scopedClasses = classes.filter(cls => classIds.some(id => String(id) === String(cls.id)));
    let rawAssess = await DB.query('assessments', '*', { teacher_id: effTeacherIds, academic_year_id: year.id || undefined }, { column: 'assessment_date', asc: false });
    if (cfgClassIds && cfgClassIds.length){ const cSet=new Set(cfgClassIds.map(String)); rawAssess=rawAssess.filter(a=> cSet.has(String(a.class_id))); }
    if (cfgSubjectIds && cfgSubjectIds.length){ const sSet=new Set(cfgSubjectIds.map(String)); rawAssess=rawAssess.filter(a=> sSet.has(String(a.subject_id))); }
    if (termIds && termIds.length){ const tSet=new Set(termIds.map(String)); rawAssess=rawAssess.filter(a=> !a.term_id || tSet.has(String(a.term_id))); }
    if (assessmentIds && assessmentIds.length){ const aSet=new Set(assessmentIds.map(String)); rawAssess=rawAssess.filter(a=> aSet.has(String(a.id))); }
    const assessments = filterReportAssessments(rawAssess, subjects).filter(assessment => scopedAssignments.some(assignment => String(assignment.class_id) === String(assessment.class_id) && String(assignment.subject_id) === String(assessment.subject_id)));
    const approvedAssessments = assessments.filter(a => ['approved', 'locked'].includes(a.status));
    const submittedAssessments = assessments.filter(a => a.status === 'submitted');
    const assessIds = approvedAssessments.map(a => a.id);
    const learners = await DB.query('learners', '*', { class_id: classIds, status: 'active' });
    const allMarks = assessIds.length ? await DB.query('marks', '*', { assessment_id: assessIds }, { column: 'learner_id' }) : [];
    const assessmentsById = new Map(assessments.map(a => [String(a.id), a]));
    const marksByLearner = new Map();
    allMarks.forEach(mark => {
      const key = String(mark.learner_id);
      if (!marksByLearner.has(key)) marksByLearner.set(key, []);
      marksByLearner.get(key).push(mark);
    });
    const learnerStats = [];
    for (const classId of classIds) {
      const classLearners = learners.filter(learner => String(learner.class_id) === String(classId));
      for (const learner of classLearners) {
        const marks = marksByLearner.get(String(learner.id)) || [];
        const validMarks = marks.filter(m => m.mark != null);
        if (validMarks.length) {
          const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
          const totalMax = validMarks.reduce((s, m) => s + reportMarkMaximum(m, assessmentsById, 100), 0);
          const pct = totalMax > 0 ? Utils.pct(totalObtained, totalMax) : 0;
          learnerStats.push(pct);
        }
      }
    }

    const stats = await ReportUtils.computeStats(learnerStats);
    return { type: 'teacher-performance', title: 'TEACHER PERFORMANCE REPORT', settings, year, term, teacher, assignments: scopedAssignments, classes: scopedClasses, subjects: subjects.filter(subject => assignedSubjectIds.some(id => String(id) === String(subject.id))), assessments, approvedAssessments, submittedAssessments, stats };
  },

  async generateGradeDistribution(ctx) {
    const { settings, scale, passMark, year, term, classId, classIds: cfgClassIds, subjectIds, assessmentIds, termIds } = ctx;
    let classes;
    if (cfgClassIds && cfgClassIds.length) classes = await DB.query('classes', '*', { id: cfgClassIds });
    else if (classId) classes = await DB.get('classes', { id: classId }).then(r => r[0] ? [r[0]] : []);
    else classes = await DB.get('classes', typeof Scope !== 'undefined' && Scope.isScoped() ? { education_level: Scope.categories() } : {});
    classes = (classes||[]).filter(c=> { if(typeof Scope!=='undefined'&&Scope.isScoped()) return Scope.matchesClass(c); return true; });
    let subjects = await DB.get('subjects');
    if (subjectIds && subjectIds.length){ const sSet=new Set(subjectIds.map(String)); subjects=subjects.filter(s=> sSet.has(String(s.id))); }
    const classIds = classes.map(cls => cls.id);
    const learners = classIds.length ? await DB.query('learners', '*', { class_id: classIds, status: 'active' }) : [];
    const qf={ class_id: classIds.length? classIds: undefined, academic_year_id: year.id || undefined, status: ['approved', 'locked'] };
    if (termIds && termIds.length) qf.term_id = termIds;
    else if (term && term.id) qf.term_id = term.id;
    if (assessmentIds && assessmentIds.length) qf.id = assessmentIds;
    if (subjectIds && subjectIds.length) qf.subject_id = subjectIds;
    if (!qf.class_id) delete qf.class_id;
    let raw = qf.class_id || qf.term_id || qf.subject_id || qf.id ? await DB.query('assessments', '*', qf, { column: 'assessment_date', asc: false }) : await DB.query('assessments', '*', { academic_year_id: year.id||undefined, status:['approved','locked'] }, {column:'assessment_date', asc:false});
    if (termIds && termIds.length){ const tSet=new Set(termIds.map(String)); raw=raw.filter(a=> !a.term_id || tSet.has(String(a.term_id))); }
    if (assessmentIds && assessmentIds.length){ const aSet=new Set(assessmentIds.map(String)); raw=raw.filter(a=> aSet.has(String(a.id))); }
    if (cfgClassIds && cfgClassIds.length){ const cSet=new Set(cfgClassIds.map(String)); raw=raw.filter(a=> cSet.has(String(a.class_id))); }
    const assessments = filterReportAssessments(raw, subjects).filter(assessment => {
      const cls = classes.find(item => String(item.id) === String(assessment.class_id));
      return subjectMatchesReportScope(subjects.find(subject => String(subject.id) === String(assessment.subject_id)), cls);
    });
    const assessIds = assessments.map(a => a.id);
    const allMarks = assessIds.length ? await DB.query('marks', '*', { assessment_id: assessIds }, { column: 'learner_id' }) : [];
    const assessmentsById = new Map(assessments.map(a => [String(a.id), a]));
    const marksByLearner = new Map();
    allMarks.forEach(mark => {
      const key = String(mark.learner_id);
      if (!marksByLearner.has(key)) marksByLearner.set(key, []);
      marksByLearner.get(key).push(mark);
    });
    const gradeData = [];
    const allPcts = [];

    for (const cls of classes) {
      const classLearners = learners.filter(learner => String(learner.class_id) === String(cls.id));
      for (const learner of classLearners) {
        const marks = marksByLearner.get(String(learner.id)) || [];
        const validMarks = marks.filter(m => m.mark != null);
        if (validMarks.length) {
          const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
          const totalMax = validMarks.reduce((s, m) => s + reportMarkMaximum(m, assessmentsById, 100), 0);
          if (totalMax > 0) allPcts.push(Utils.pct(totalObtained, totalMax));
        }
      }
    }

    const dist = await ReportUtils.getGradeDistribution(allPcts.map(p => ReportUtils.calcGrade(p, scale).grade), scale);
    return { type: 'grade-distribution', title: 'GRADE DISTRIBUTION', settings, year, term, classes, distribution: dist, totalLearners: allPcts.length };
  }
};
