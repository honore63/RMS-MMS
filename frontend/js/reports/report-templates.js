const ReportTemplates = {
  _wrap(templateFn, data) {
    const orientation = ReportHeader.getOrientation(data.type || templateFn.name);
    const html = templateFn(data);
    return ReportHeader.getA4Container(html, orientation);
  },

  studentCard(data) {
    const { settings, learner, cls, year, term, subjRows, overallPct, overallGrade, overallPf, totalSubjects, passed, failed, avg, totalObtained, totalMax, scale } = data;
    const levelLbl = (cls?.level || '').toUpperCase().includes('PRIMARY') ? 'PRIMARY' : (cls?.level || '').toUpperCase().includes('S') ? (['S1','S2','S3'].includes(cls.level.toUpperCase()) ? 'LOWER SECONDARY' : 'UPPER SECONDARY') : 'SECONDARY';
    const header = ReportHeader.getOfficialHeader({ settings, title: 'STUDENT REPORT CARD', subtitle: `${cls?.name || ''} – ${learner?.full_name || ''}`, levelLabel });

    let tbody = '';
    subjRows.forEach((row, i) => {
      tbody += `<tr><td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(row.subject)}</td><td class="text-center">${ReportUtils.formatMark(row.obtained, row.maxMark)}</td><td class="text-center">${ReportUtils.formatPct(row.pct)}</td><td class="text-center font-bold">${row.grade}</td><td class="text-center"><span class="badge ${row.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${row.passFail}</span></td><td class="text-center">${row.descriptor || '-'}</td></tr>`;
    });

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta-grid">
        <div><span class="rms-meta-lbl">Student:</span> ${Utils.escapeHtml(learner?.full_name || '-')}</div>
        <div><span class="rms-meta-lbl">Code:</span> ${Utils.escapeHtml(learner?.learner_code || '-')}</div>
        <div><span class="rms-meta-lbl">Class:</span> ${Utils.escapeHtml(cls?.name || '-')}</div>
        <div><span class="rms-meta-lbl">Level:</span> ${levelLbl}</div>
        <div><span class="rms-meta-lbl">Academic Year:</span> ${Utils.escapeHtml(year.name || '-')}</div>
        <div><span class="rms-meta-lbl">Term:</span> ${Utils.escapeHtml(term.name || '-')}</div>
      </div>
      <table class="rms-table">
        <thead><tr><th>No.</th><th>Subject</th><th>Total</th><th>%</th><th>Grade</th><th>Status</th><th>Remark</th></tr></thead>
        <tbody>${tbody}</tbody>
      </table>
      <div class="rms-summary">
        <div class="rms-stat"><span class="rms-stat-val">${totalSubjects}</span><span class="rms-stat-lbl">Subjects</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${passed}</span><span class="rms-stat-lbl">Passed</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${failed}</span><span class="rms-stat-lbl">Failed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val font-bold">${overallGrade.grade}</span><span class="rms-stat-lbl">Overall Grade</span></div>
      </div>
      ${footer}`;
  },

  examClassSummary(data) {
    const { settings, cls, year, term, assess, stats, learnerRows, positions, scale, totalLearners, assessedCount, missingMarks } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'EXAM CLASS PERFORMANCE SUMMARY', subtitle: `${cls?.name || ''} – ${assess?.name || ''}` });

    let tbody = '';
    const sorted = [...learnerRows].sort((a, b) => (positions[a.learner.id] || 999) - (positions[b.learner.id] || 999));
    sorted.forEach((row, i) => {
      const pos = positions[row.learner.id] || '-';
      tbody += `<tr><td class="text-center">${pos}</td><td>${Utils.escapeHtml(row.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(row.learner.learner_code || '-')}</td><td class="text-center">${row.pct != null ? ReportUtils.formatMark(row.pct * (assess?.maximum_mark || 100) / 100, assess?.maximum_mark || 100) : 'N/R'}</td><td class="text-center">${row.pct != null ? ReportUtils.formatPct(row.pct) : 'N/R'}</td><td class="text-center font-bold">${row.grade}</td><td class="text-center"><span class="badge ${row.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${row.passFail}</span></td></tr>`;
    });

    const gradeDist = ReportUtils.getGradeDistribution(learnerRows.filter(r => r.pct != null).map(r => r.grade), scale);
    const gradeDistHtml = (gradeDist || []).map(g => `<span class="badge badge-info">${g.grade}: ${g.count}</span>`).join(' ');

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">
        Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')} | Assessment: ${Utils.escapeHtml(assess?.name || '-')}
      </div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Total Learners</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${assessedCount}</span><span class="rms-stat-lbl">Marks Entered</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${missingMarks}</span><span class="rms-stat-lbl">Missing</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.high)}</span><span class="rms-stat-lbl">Highest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.low)}</span><span class="rms-stat-lbl">Lowest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${stats.passed}</span><span class="rms-stat-lbl">Passed</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${stats.failed}</span><span class="rms-stat-lbl">Failed</span></div>
      </div>
      <div class="rms-grade-dist"><strong>Grade Distribution:</strong> ${gradeDistHtml}</div>
      <table class="rms-table"><thead><tr><th>Pos</th><th>Name</th><th>Code</th><th>Total</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  subjectPerformance(data) {
    const { settings, cls, subject, year, term, stats, learnerRows, positions, scale, totalLearners } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'SUBJECT PERFORMANCE SUMMARY', subtitle: `${subject?.name || ''} – ${cls?.name || ''}` });

    let tbody = '';
    const sorted = [...learnerRows.filter(r => r.pct != null)].sort((a, b) => b.pct - a.pct);
    const posMap = {};
    Utils.positions(sorted.map(r => ({ id: r.learner.id, pct: r.pct }))).forEach(p => posMap[p.id] = p.position);
    sorted.forEach((row, i) => {
      tbody += `<tr><td class="text-center">${posMap[row.learner.id] || i + 1}</td><td>${Utils.escapeHtml(row.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(row.learner.learner_code || '-')}</td><td class="text-center">${ReportUtils.formatPct(row.pct)}</td><td class="text-center font-bold">${row.grade}</td><td class="text-center"><span class="badge ${row.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${row.passFail}</span></td></tr>`;
    });

    const gradeDist = ReportUtils.getGradeDistribution(learnerRows.filter(r => r.pct != null).map(r => r.grade), scale);
    const gradeDistHtml = (gradeDist || []).map(g => `<span class="badge badge-info">${g.grade}: ${g.count}</span>`).join(' ');

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')} | Subject: ${Utils.escapeHtml(subject?.name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Learners</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.high)}</span><span class="rms-stat-lbl">Highest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.low)}</span><span class="rms-stat-lbl">Lowest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
      </div>
      <table class="rms-table"><thead><tr><th>Pos</th><th>Name</th><th>Code</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  classPerformance(data) {
    const { settings, cls, year, term, stats, learnerStats, positions, scale, totalLearners } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'CLASS PERFORMANCE REPORT', subtitle: cls?.name || '' });

    let tbody = '';
    const sorted = [...learnerStats.filter(s => s.pct != null)].sort((a, b) => b.pct - a.pct);
    const posMap = {};
    Utils.positions(sorted.map(s => ({ id: s.learner.id, pct: s.pct }))).forEach(p => posMap[p.id] = p.position);
    sorted.forEach((s, i) => {
      tbody += `<tr><td class="text-center">${posMap[s.learner.id] || i + 1}</td><td>${Utils.escapeHtml(s.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(s.learner.learner_code || '-')}</td><td class="text-center">${ReportUtils.formatPct(s.pct)}</td><td class="text-center font-bold">${s.grade}</td><td class="text-center"><span class="badge ${s.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${s.passFail}</span></td></tr>`;
    });

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Learners</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.high)}</span><span class="rms-stat-lbl">Highest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.low)}</span><span class="rms-stat-lbl">Lowest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
      </div>
      <table class="rms-table"><thead><tr><th>Pos</th><th>Name</th><th>Code</th><th>Average</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  missingMarks(data) {
    const { settings, year, term, rows } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'MISSING MARKS REPORT', subtitle: `${year.name || ''} – ${term.name || ''}` });

    let tbody = '';
    rows.forEach(r => {
      const badgeClass = r.status === 'COMPLETE' ? 'badge-success' : r.status === 'PARTIALLY COMPLETE' ? 'badge-warning' : 'badge-danger';
      tbody += `<tr><td>${Utils.escapeHtml(r.class)}</td><td>${Utils.escapeHtml(r.subject)}</td><td class="text-center">${Utils.escapeHtml(r.teacher)}</td><td>${Utils.escapeHtml(r.assessment)}</td><td class="text-center">${r.expectedCount}</td><td class="text-center">${r.marksEntered}</td><td class="text-center" style="color:#dc2626">${r.missingCount}</td><td class="text-center">${r.completionPct}%</td><td class="text-center"><span class="badge ${badgeClass}">${r.status}</span></td></tr>`;
    });

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}</div>
      <table class="rms-table"><thead><tr><th>Class</th><th>Subject</th><th>Teacher</th><th>Assessment</th><th>Expected</th><th>Entered</th><th>Missing</th><th>Completion</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  schoolPerformance(data) {
    const { settings, year, term, totalLearners, totalClasses, overallAvg, overallPassRate, classReports } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'SCHOOL PERFORMANCE SUMMARY', subtitle: `${year.name || ''} – ${term.name || ''}` });

    let tbody = '';
    classReports.forEach((cr, i) => {
      tbody += `<tr><td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(cr.class)}</td><td class="text-center">${cr.learners}</td><td class="text-center">${ReportUtils.formatPct(cr.stats.avg)}</td><td class="text-center">${ReportUtils.formatPct(cr.stats.passRate)}</td><td class="text-center">${cr.stats.passed}</td><td class="text-center">${cr.stats.failed}</td></tr>`;
    });

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Total Learners</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${totalClasses}</span><span class="rms-stat-lbl">Classes</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(overallAvg)}</span><span class="rms-stat-lbl">Overall Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(overallPassRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
      </div>
      <table class="rms-table"><thead><tr><th>#</th><th>Class</th><th>Learners</th><th>Average</th><th>Pass Rate</th><th>Passed</th><th>Failed</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  teacherPerformance(data) {
    const { settings, year, term, teacher, assessments, approvedAssessments, submittedAssessments, stats } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'TEACHER PERFORMANCE REPORT', subtitle: teacher?.full_name || '' });

    const tbody = `
      <tr><td colspan="4"><strong>Teacher:</strong> ${Utils.escapeHtml(teacher?.full_name || '-')}</td></tr>
      <tr><td colspan="4"><strong>Total Assessments:</strong> ${assessments.length} | Approved/Locked: ${approvedAssessments.length} | Submitted: ${submittedAssessments.length}</td></tr>
      <tr><td colspan="4"><strong>Learners Assessed:</strong> ${stats.total} | Average: ${ReportUtils.formatPct(stats.avg)} | Pass Rate: ${ReportUtils.formatPct(stats.passRate)}</td></tr>
    `;

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}</div>
      <table class="rms-table"><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  gradeDistribution(data) {
    const { settings, year, term, distribution, totalLearners } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'GRADE DISTRIBUTION', subtitle: `${year.name || ''} – ${term.name || ''}` });

    let tbody = '';
    distribution.forEach(g => {
      tbody += `<tr><td class="text-center font-bold" style="color:${g.is_pass ? '#16a34a' : '#dc2626'}">${g.grade}</td><td class="text-center">${g.count}</td><td class="text-center">${g.percentage}%</td><td>${Utils.escapeHtml(g.descriptor)}</td></tr>`;
    });

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Total Learners: ${totalLearners} | Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}</div>
      <div class="rms-summary"><div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Total Learners</span></div></div>
      <table class="rms-table"><thead><tr><th>Grade</th><th>Learners</th><th>%</th><th>Descriptor</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  }
};
