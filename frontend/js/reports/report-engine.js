const ReportEngine = {
  current: null,

  async generate(config) {
    const { reportType, academicYear, term, classId, subjectId, subjectIds, teacherId, assessmentId, studentId } = config;
    const settings = await ReportUtils.getSettings();
    const scale = await ReportUtils.getScale();
    const passMark = settings.pass_mark || 50;

    const year = academicYear || await ReportUtils.getActiveYear();
    const activeTerm = term || await ReportUtils.getActiveTerm();

    const ctx = { settings, scale, passMark, year, term: activeTerm, classId, subjectId, subjectIds, teacherId, assessmentId, studentId,
      assessmentTypeId: config.assessmentTypeId, teacherComment: config.teacherComment,
      dosComment: config.dosComment, decisionOverride: config.decisionOverride };

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
      default: throw new Error(`Unknown report type: ${reportType}`);
    }
  },

  async generateStudentCard(ctx) {
    // Single source of truth: delegate to the dynamic ReportStudent module.
    if (typeof ReportStudent !== 'undefined' && ctx.studentId && ctx.classId) {
      const yearId = ctx.year && ctx.year.id ? ctx.year.id : ctx.year;
      const termId = ctx.term && ctx.term.id ? ctx.term.id : ctx.term;
      return ReportStudent.fetchCardData({
        learnerId: ctx.studentId, classId: ctx.classId, yearId, termId,
        subjectIds: (ctx.subjectIds && ctx.subjectIds.length) ? ctx.subjectIds : (ctx.subjectId ? [ctx.subjectId] : null),
        assessmentTypeId: ctx.assessmentTypeId || null,
        teacherComment: ctx.teacherComment || '', dosComment: ctx.dosComment || '',
        decisionOverride: ctx.decisionOverride || ''
      });
    }
    const { settings, scale, passMark, year, term, classId, studentId } = ctx;
    const learner = await DB.get('learners', { id: studentId }).then(r => r[0]);
    if (!learner) throw new Error('Student not found');
    const cls = await DB.get('classes', { id: learner.class_id }).then(r => r[0]);
    const eduCat = EducationLevels.getCategory(cls);

    const subjects = await ReportUtils.getSubjects({ status: 'active' });
    const levelSubjects = subjects.filter(s => !s.level || s.level === 'Both' || s.level === eduCat);

    const assessments = await DB.query('assessments', '*', { class_id: classId, academic_year_id: year.id || year.id === 0 ? undefined : year.id, status: ['approved', 'locked'] }, { column: 'assessment_date', asc: false });
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
    const { settings, scale, passMark, year, term, classId, assessmentId } = ctx;
    const cls = await DB.get('classes', { id: classId }).then(r => r[0]);
    const learners = await ReportUtils.getLearners(classId);
    const assessments = assessmentId
      ? await DB.get('assessments', { id: assessmentId }).then(r => r[0] ? [r[0]] : [])
      : await DB.query('assessments', '*', { class_id: classId, academic_year_id: year.id || undefined, status: ['approved', 'locked'] }, { column: 'assessment_date', asc: false });

    const assess = assessments[0];
    if (!assess) throw new Error('No assessment found');

    const assessIds = assessments.map(a => a.id);
    const allMarks = await DB.query('marks', '*', { assessment_id: assessIds, mark: null }, { column: 'learner_id' });
    const allMarksWithValue = await DB.query('marks', '*', { assessment_id: assessIds, mark: null }, { column: 'learner_id' });

    const totalLearners = learners.length;
    let assessedCount = 0;
    const pcts = [];
    const learnerRows = [];

    for (const learner of learners) {
      const marks = await DB.query('marks', '*', { learner_id: learner.id, assessment_id: assessIds });
      const validMarks = marks.filter(m => m.mark != null);
      if (validMarks.length) {
        assessedCount++;
        const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = validMarks.reduce((s, m) => s + Number(m.max_mark || assess.maximum_mark || 0), 0);
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
    const { settings, scale, passMark, year, term, classId, subjectId, teacherId } = ctx;
    const cls = await DB.get('classes', { id: classId }).then(r => r[0]);
    const subject = await DB.get('subjects', { id: subjectId }).then(r => r[0]);
    const learners = await ReportUtils.getLearners(classId);

    const filter = { class_id: classId, academic_year_id: year.id || undefined, subject_id: subjectId, status: ['approved', 'locked'] };
    if (teacherId) filter.teacher_id = teacherId;
    const assessments = await DB.query('assessments', '*', filter, { column: 'assessment_date', asc: false });
    const assessIds = assessments.map(a => a.id);

    const learnerRows = [];
    const pcts = [];
    for (const learner of learners) {
      const marks = await DB.query('marks', '*', { learner_id: learner.id, assessment_id: assessIds });
      const validMarks = marks.filter(m => m.mark != null);
      if (validMarks.length) {
        const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = validMarks.reduce((s, m) => s + Number(m.max_mark || assessments[0]?.maximum_mark || 0), 0);
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
    const { settings, scale, passMark, year, term, classId } = ctx;
    const cls = await DB.get('classes', { id: classId }).then(r => r[0]);
    const learners = await ReportUtils.getLearners(classId);
    const learnerStats = [];

    for (const learner of learners) {
      const marks = await DB.query('marks', '*', { learner_id: learner.id, academic_year_id: year.id || undefined, term_id: term.id || undefined });
      const validMarks = marks.filter(m => m.mark != null);
      if (validMarks.length) {
        const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
        const totalMax = validMarks.reduce((s, m) => s + Number(m.max_mark || 100), 0);
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
    const { settings, year, term, classId } = ctx;
    const classes = classId ? await DB.get('classes', { id: classId }).then(r => r[0] ? [r[0]] : []) : await DB.get('classes');
    const subjects = await DB.get('subjects');
    const teachers = await DB.get('teachers');
    const assessments = await DB.query('assessments', '*', { academic_year_id: year.id || undefined, term_id: term.id || undefined }, { column: 'created_at', asc: false });

    const rows = [];
    for (const cls of classes) {
      for (const subj of subjects) {
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
    const { settings, scale, passMark, year, term } = ctx;
    const classes = await DB.get('classes');
    const classReports = [];

    for (const cls of classes) {
      const learners = await ReportUtils.getLearners(cls.id);
      const allPcts = [];
      for (const learner of learners) {
        const marks = await DB.query('marks', '*', { learner_id: learner.id, academic_year_id: year.id || undefined, term_id: term.id || undefined });
        const validMarks = marks.filter(m => m.mark != null);
        if (validMarks.length) {
          const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
          const totalMax = validMarks.reduce((s, m) => s + Number(m.max_mark || 100), 0);
          if (totalMax > 0) allPcts.push(Utils.pct(totalObtained, totalMax));
        }
      }
      const stats = await ReportUtils.computeStats(allPcts, passMark);
      classReports.push({ class: cls.name, learners: learners.length, stats });
    }

    const totalLearners = classReports.reduce((s, c) => s + c.learners, 0);
    const allClassPcts = classReports.filter(c => c.stats.avg > 0).map(c => c.stats.avg);
    const overallAvg = allClassPcts.length > 0 ? allClassPcts.reduce((a, b) => a + b, 0) / allClassPcts.length : 0;
    const overallPassRate = classReports.reduce((s, c) => s + c.stats.passRate, 0) / Math.max(classReports.length, 1);

    return { type: 'school-performance', title: 'SCHOOL PERFORMANCE SUMMARY', settings, year, term, totalLearners, totalClasses: classes.length, overallAvg, overallPassRate, classReports };
  },

  async generateTeacherPerformance(ctx) {
    const { settings, year, term } = ctx;
    const teacherId = Auth.getTeacherId();
    const teacher = await DB.get('teachers', { id: Auth.getTeacherId() }).then(r => r[0]);
    const assignments = await DB.query('teacher_assignments', '*', { teacher_id: teacherId });
    const classIds = [...new Set(assignments.map(a => a.class_id))];
    const subjectIds = [...new Set(assignments.map(a => a.subject_id))];
    const classes = await DB.get('classes');
    const subjects = await DB.get('subjects');
    const assessments = await DB.query('assessments', '*', { teacher_id: teacherId, academic_year_id: year.id || undefined }, { column: 'assessment_date', asc: false });
    const approvedAssessments = assessments.filter(a => ['approved', 'locked'].includes(a.status));
    const submittedAssessments = assessments.filter(a => a.status === 'submitted');

    const learnerStats = [];
    for (const classId of classIds) {
      const learners = await ReportUtils.getLearners(classId);
      for (const learner of learners) {
        const marks = await DB.query('marks', '*', { learner_id: learner.id, academic_year_id: year.id || undefined });
        const validMarks = marks.filter(m => m.mark != null);
        if (validMarks.length) {
          const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
          const totalMax = validMarks.reduce((s, m) => s + Number(m.max_mark || 100), 0);
          const pct = totalMax > 0 ? Utils.pct(totalObtained, totalMax) : 0;
          learnerStats.push(pct);
        }
      }
    }

    const stats = await ReportUtils.computeStats(learnerStats);
    return { type: 'teacher-performance', title: 'TEACHER PERFORMANCE REPORT', settings, year, term, teacher, assignments, classes, subjects, assessments, approvedAssessments, submittedAssessments, stats };
  },

  async generateGradeDistribution(ctx) {
    const { settings, scale, passMark, year, term, classId } = ctx;
    const classes = classId ? await DB.get('classes', { id: classId }).then(r => r[0] ? [r[0]] : []) : await DB.get('classes');
    const gradeData = [];
    const allPcts = [];

    for (const cls of classes) {
      const learners = await ReportUtils.getLearners(cls.id);
      for (const learner of learners) {
        const marks = await DB.query('marks', '*', { learner_id: learner.id, academic_year_id: year.id || undefined, term_id: term.id || undefined });
        const validMarks = marks.filter(m => m.mark != null);
        if (validMarks.length) {
          const totalObtained = validMarks.reduce((s, m) => s + Number(m.mark), 0);
          const totalMax = validMarks.reduce((s, m) => s + Number(m.max_mark || 100), 0);
          if (totalMax > 0) allPcts.push(Utils.pct(totalObtained, totalMax));
        }
      }
    }

    const dist = await ReportUtils.getGradeDistribution(allPcts.map(p => ReportUtils.calcGrade(p, scale).grade), scale);
    return { type: 'grade-distribution', title: 'GRADE DISTRIBUTION', settings, year, term, classes, distribution: dist, totalLearners: allPcts.length };
  }
};
