const ReportTemplates = {
  _wrap(templateFn, data) {
    const orientation = ReportHeader.getOrientation(data.type || templateFn.name);
    const html = templateFn(data);
    return ReportHeader.getA4Container(html, orientation);
  },

  studentCard(data) {
    const { settings, learner, cls, year, term, subjRows, overallPct, overallGrade, overallPf, totalSubjects, passed, failed, avg } = data || {};
    const totalObtained = Number(data?.totalObtained ?? 0);
    const totalMax = Number(data?.totalMax ?? 0);
    const levelLbl = (cls?.level || '').toUpperCase().includes('PRIMARY') ? 'PRIMARY' : (cls?.level || '').toUpperCase().includes('S') ? (['S1','S2','S3'].includes(cls.level.toUpperCase()) ? 'LOWER SECONDARY' : 'UPPER SECONDARY') : 'SECONDARY';
    const header = ReportHeader.getOfficialHeader({ settings, title: 'STUDENT REPORT CARD', subtitle: `${cls?.name || ''} – ${learner?.full_name || ''}`, levelLabel: levelLbl });

    let tbody = '';
    subjRows.forEach((row, i) => {
      tbody += `<tr><td>${Utils.escapeHtml(row.subject?.name || row.subject)}</td><td class="text-center">${ReportUtils.formatMark(row.obtained, row.maxMark)}</td><td class="text-center">${ReportUtils.formatPct(row.pct)}</td><td class="text-center font-bold">${row.grade}</td></tr>`;
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
        <thead><tr><th>Subject</th><th>Total</th><th>%</th><th>Grade</th></tr></thead>
        <tbody>${tbody}</tbody>
      </table>
      <div class="rms-summary">
        <div class="rms-stat"><span class="rms-stat-val">${totalSubjects}</span><span class="rms-stat-lbl">Subjects</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${passed}</span><span class="rms-stat-lbl">Passed</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${failed}</span><span class="rms-stat-lbl">Failed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val font-bold">${overallGrade.grade}</span><span class="rms-stat-lbl">Overall Grade</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${totalObtained}/${totalMax || 0}</span><span class="rms-stat-lbl">Total Score</span></div>
        ${data.position ? `<div class="rms-stat"><span class="rms-stat-val font-bold">${data.position}</span><span class="rms-stat-lbl">of ${data.positionOutOf || ''} in Class</span></div>` : ''}
      </div>
      <div class="rms-comment-block"><strong>Class Teacher:</strong> ${Utils.escapeHtml(data.teacherComment || '')}</div>
      <div class="rms-comment-block"><strong>DOS:</strong> ${Utils.escapeHtml(data.dosComment || '')} ${data.decision ? `<span class="badge ${data.decision === 'PASS' ? 'badge-success' : data.decision === 'FAIL' ? 'badge-danger' : 'badge-warning'}" style="margin-left:6px">${Utils.escapeHtml(data.decision)}</span>` : ''}</div>
      ${footer}`;
  },

  studentPerformance(data) {
    const { settings, learner, cls, year, term, subjRows, overallPct, overallGrade, overallPf, totalSubjects, passed, failed } = data;
    const level = data.level || { label: '' };
    const header = ReportHeader.getOfficialHeader({ settings, title: 'STUDENT PERFORMANCE REPORT', subtitle: `${learner?.full_name || ''} – ${cls?.name || ''}`, levelLabel: level.label || '' });

    let tbody = '';
    (subjRows || []).forEach((row, i) => {
      tbody += `<tr><td>${Utils.escapeHtml(row.subject?.name || row.subject)}</td><td class="text-center">${row.hasMarks ? row.obtained : '—'}</td><td class="text-center">${row.hasMarks ? row.maxMark : '—'}</td><td class="text-center">${row.pct == null ? 'N/A' : row.pct.toFixed(1) + '%'}</td><td class="text-center font-bold">${row.grade}</td><td class="text-center"><span class="badge ${row.status === 'PASS' ? 'badge-success' : row.status === 'FAIL' ? 'badge-danger' : 'badge-warning'}">${row.status}</span></td><td>${Utils.escapeHtml(row.remark || '')}</td></tr>`;
    });

    const distRows = (data.gradeDist || []).map(g => `<span class="badge badge-info">${Utils.escapeHtml(g.grade)}: ${g.count}</span>`).join(' ');
    const posText = data.position ? `${data.position} out of ${data.positionOutOf}` : 'Not available';
    const footer = ReportHeader.getFooter({ settings, academicYear: year?.name || '', term: term?.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta-grid">
        <div><span class="rms-meta-lbl">Student Name:</span> ${Utils.escapeHtml(learner?.full_name || '-')}</div>
        <div><span class="rms-meta-lbl">Student Code:</span> ${Utils.escapeHtml(learner?.learner_code || '-')}</div>
        <div><span class="rms-meta-lbl">Level:</span> ${Utils.escapeHtml(level.label || '-')}</div>
        <div><span class="rms-meta-lbl">Class:</span> ${Utils.escapeHtml(cls?.name || '-')}</div>
        <div><span class="rms-meta-lbl">Stream:</span> ${Utils.escapeHtml(cls?.stream || learner?.stream || '-')}</div>
        <div><span class="rms-meta-lbl">Gender:</span> ${Utils.escapeHtml(learner?.gender || '-')}</div>
        <div><span class="rms-meta-lbl">Academic Year:</span> ${Utils.escapeHtml(year?.name || '-')}</div>
        <div><span class="rms-meta-lbl">Term:</span> ${Utils.escapeHtml(term?.name || '-')}</div>
      </div>
      <table class="rms-table">
        <thead><tr><th>Subject</th><th>Total</th><th>Max</th><th>%</th><th>Grade</th><th>Status</th><th>Remark</th></tr></thead>
        <tbody>${tbody}</tbody>
      </table>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalSubjects}</span><span class="rms-stat-lbl">Total Subjects</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${passed}</span><span class="rms-stat-lbl">Passed</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${failed}</span><span class="rms-stat-lbl">Failed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${overallPct == null ? 'N/A' : overallPct.toFixed(1) + '%'}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${overallGrade?.grade || '—'}</span><span class="rms-stat-lbl">Overall Grade</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${Utils.escapeHtml(overallPf || '')}</span><span class="rms-stat-lbl">Status</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${Utils.escapeHtml(posText)}</span><span class="rms-stat-lbl">Class Position</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${Utils.escapeHtml(data.decision || '')}</span><span class="rms-stat-lbl">Final Decision</span></div>
      </div>
      <div class="rms-grade-dist"><strong>Grade Distribution:</strong> ${distRows || '—'}</div>
      <div class="rms-meta" style="margin-bottom:12px"><strong>Overall Comment:</strong> ${Utils.escapeHtml(data.overallComment || '')}</div>
      <div class="rms-meta" style="margin-bottom:12px"><strong>Teacher's Comment:</strong> ${Utils.escapeHtml(data.teacherComment || '')}</div>
      <div class="rms-meta" style="margin-bottom:12px"><strong>DOS Comment:</strong> ${Utils.escapeHtml(data.dosComment || '')}</div>
      ${footer}`;
  },

  examClassSummary(data) {
    const { settings, cls, year, term, assess, stats, learnerRows, positions, scale, totalLearners, assessedCount, missingMarks } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: data.title || 'EXAM CLASS PERFORMANCE SUMMARY', subtitle: `${cls?.name || ''} – ${assess?.name || ''}` });

    let tbody = '';
    const sorted = [...learnerRows].sort((a, b) => (positions[a.learner.id] || 999) - (positions[b.learner.id] || 999));
    sorted.forEach((row, i) => {
      const pos = positions[row.learner.id] || '-';
      tbody += `<tr><td class="text-center">${pos}</td><td>${Utils.escapeHtml(row.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(row.learner.learner_code || '-')}</td><td class="text-center">${row.pct != null ? ReportUtils.formatMark(row.pct * (assess?.maximum_mark || 100) / 100, assess?.maximum_mark || 100) : 'N/R'}</td><td class="text-center">${row.pct != null ? ReportUtils.formatPct(row.pct) : 'N/R'}</td><td class="text-center font-bold">${row.grade}</td><td class="text-center"><span class="badge ${row.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${row.passFail}</span></td></tr>`;
    });

    const scored = learnerRows.filter(r => r.pct != null);
    const gradeDist = ReportUtils.getGradeDistribution(scored.map(r => r.grade), scale);
    const gradeDistBars = scored.length ? ReportUtils.charts.svgBars({
      labels: (gradeDist || []).map(g => g.grade), values: (gradeDist || []).map(g => g.count), valueSuffix: '', decimals: 0
    }) : '';
    const missingWarn = missingMarks > 0 ? ReportHeader.warningBanner(`${missingMarks} learner(s) have no marks recorded. This report cannot be finalized until marks are complete.`) : '';

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">
        Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')} | Assessment: ${Utils.escapeHtml(assess?.name || '-')}
      </div>
      ${missingWarn}
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
      ${scored.length ? gradeDistBars : ReportHeader.emptyState('No marks are currently available for the selected assessment.', { icon: 'file-x' })}
      <table class="rms-table"><thead><tr><th>Pos</th><th>Name</th><th>Code</th><th>Total</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  subjectPerformance(data) {
    const { settings, cls, subject, year, term, stats, learnerRows, positions, scale, totalLearners, assessedCount, missingMarks, rangeDistribution, gradeDistribution, passMark } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: data.title || 'SUBJECT PERFORMANCE SUMMARY', subtitle: `${subject?.name || ''} – ${cls?.name || ''}` });

    const scored = learnerRows.filter(r => r.pct != null);
    let tbody = '';
    const sorted = [...scored].sort((a, b) => b.pct - a.pct);
    const posMap = {};
    Utils.positions(sorted.map(r => ({ id: r.learner.id, pct: r.pct }))).forEach(p => posMap[p.id] = p.position);
    sorted.forEach((row, i) => {
      tbody += `<tr><td class="text-center">${posMap[row.learner.id] || i + 1}</td><td>${Utils.escapeHtml(row.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(row.learner.learner_code || '-')}</td><td class="text-center">${ReportUtils.formatPct(row.pct)}</td><td class="text-center font-bold">${row.grade}</td><td class="text-center"><span class="badge ${row.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${row.passFail}</span></td></tr>`;
    });

    const gradeDist = gradeDistribution || ReportUtils.getGradeDistribution(scored.map(r => r.grade), scale).map(g => ({ ...g, percentage: scored.length ? Math.round(g.count / scored.length * 1000) / 10 : 0 }));
    const gradeDistBars = scored.length ? ReportUtils.charts.svgBars({
      labels: gradeDist.map(g => g.grade), values: gradeDist.map(g => g.count), valueSuffix: '', decimals: 0
    }) : '';
    const rangeBars = scored.length ? ReportUtils.charts.svgBars({
      labels: (rangeDistribution || []).map(g => g.label), values: (rangeDistribution || []).map(g => g.count), valueSuffix: '', decimals: 0
    }) : '';
    const gradeRows = gradeDist.map(g => `<tr><td>${Utils.escapeHtml(g.grade)}</td><td class="text-center">${g.count}</td><td class="text-center">${ReportUtils.formatPct(g.percentage)}</td></tr>`).join('');
    const rangeRows = (rangeDistribution || []).map(g => `<tr><td>${g.label}%</td><td class="text-center">${g.count}</td><td class="text-center">${ReportUtils.formatPct(g.percentage)}</td></tr>`).join('');

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')} | Subject: ${Utils.escapeHtml(subject?.name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Total Students</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${assessedCount}</span><span class="rms-stat-lbl">Students Assessed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${missingMarks}</span><span class="rms-stat-lbl">Missing Marks</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.high)}</span><span class="rms-stat-lbl">Highest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.low)}</span><span class="rms-stat-lbl">Lowest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(passMark)}</span><span class="rms-stat-lbl">Pass Mark</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${stats.passed}</span><span class="rms-stat-lbl">Number Passed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${stats.failed}</span><span class="rms-stat-lbl">Number Failed</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(Math.max(0, 100 - stats.passRate))}</span><span class="rms-stat-lbl">Fail Rate</span></div>
      </div>
      ${scored.length ? `<div class="rms-chart-row">${rangeBars}${gradeDistBars}${ReportUtils.charts.svgDonut({ labels: ['Passed', 'Failed'], values: [stats.passed, stats.failed], colors: ['#16a34a', '#dc2626'], centerLabel: 'Pass rate', centerValue: `${Math.round(stats.passRate || 0)}%` })}</div>` : ReportHeader.emptyState('No marks are currently available for the selected subject.', { icon: 'file-x' })}
      <h3 class="rms-section-title">Marks Range Distribution</h3><table class="rms-table"><thead><tr><th>Mark Range</th><th>Students</th><th>Percentage</th></tr></thead><tbody>${rangeRows || `<tr><td colspan="3">No marks available</td></tr>`}</tbody></table>
      <h3 class="rms-section-title">Grade Distribution</h3><table class="rms-table"><thead><tr><th>Grade</th><th>Students</th><th>Percentage</th></tr></thead><tbody>${gradeRows || `<tr><td colspan="3">No grades available</td></tr>`}</tbody></table>
      <table class="rms-table"><thead><tr><th>Pos</th><th>Name</th><th>Code</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  classPerformance(data) {
    const { settings, cls, year, term, stats, learnerStats, positions, scale, totalLearners } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: data.title || 'CLASS PERFORMANCE REPORT', subtitle: cls?.name || '' });

    const scored = learnerStats.filter(s => s.pct != null);
    let tbody = '';
    const sorted = [...scored].sort((a, b) => b.pct - a.pct);
    const posMap = {};
    Utils.positions(sorted.map(s => ({ id: s.learner.id, pct: s.pct }))).forEach(p => posMap[p.id] = p.position);
    sorted.forEach((s, i) => {
      tbody += `<tr><td class="text-center">${posMap[s.learner.id] || i + 1}</td><td>${Utils.escapeHtml(s.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(s.learner.learner_code || '-')}</td><td class="text-center">${ReportUtils.formatPct(s.pct)}</td><td class="text-center font-bold">${s.grade}</td><td class="text-center"><span class="badge ${s.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${s.passFail}</span></td></tr>`;
    });

    const gradeDist = ReportUtils.getGradeDistribution(scored.map(s => s.grade), scale);
    const charts = scored.length ? `<div class="rms-chart-row">
        ${ReportUtils.charts.svgDonut({ labels: ['Passed', 'Failed'], values: [stats.passed, stats.failed], colors: ['#16a34a', '#dc2626'], size: 150, centerLabel: 'Learners', centerValue: scored.length })}
        ${ReportUtils.charts.svgBars({ labels: (gradeDist || []).map(g => g.grade), values: (gradeDist || []).map(g => g.count), valueSuffix: '', decimals: 0 })}
      </div>` : '';

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Learners</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.avg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.high)}</span><span class="rms-stat-lbl">Highest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.low)}</span><span class="rms-stat-lbl">Lowest</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
      </div>
      ${charts || ReportHeader.emptyState('No marks are currently available for the selected class.', { icon: 'file-x' })}
      <table class="rms-table"><thead><tr><th>Pos</th><th>Name</th><th>Code</th><th>Average</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  teacherStudentPerformance(data) {
    const { settings, cls, year, term, stats, learnerStats, positions, totalLearners, assessedCount, highestStudents, lowestStudents, supportStudents, missingStudents, passMark } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'STUDENT PERFORMANCE & ANALYSIS REPORT', subtitle: cls?.name || '' });
    const rowHtml = (row) => `<tr><td class="text-center">${row.pct == null ? '-' : positions[row.learner.id] || '-'}</td><td>${Utils.escapeHtml(row.learner.full_name)}</td><td>${Utils.escapeHtml(row.learner.learner_code || '-')}</td><td class="text-center">${row.pct == null ? '-' : ReportUtils.formatPct(row.pct)}</td><td class="text-center">${Utils.escapeHtml(row.grade)}</td><td class="text-center">${row.pct == null ? '<span class="badge badge-warning">MISSING</span>' : `<span class="badge ${row.passFail === 'PASS' ? 'badge-success' : 'badge-danger'}">${row.passFail}</span>`}</td></tr>`;
    const listTable = (title, rows, empty) => `<h3 class="rms-section-title">${title}</h3><table class="rms-table"><thead><tr><th>Position</th><th>Student</th><th>Student Code</th><th>Percentage</th><th>Grade</th><th>Status</th></tr></thead><tbody>${rows.length ? rows.map(rowHtml).join('') : `<tr><td colspan="6">${empty}</td></tr>`}</tbody></table>`;
    const allRows = [...learnerStats].sort((a, b) => (positions[a.learner.id] || 9999) - (positions[b.learner.id] || 9999));
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });
    return `${header}<div class="rms-report-title">${data.title}</div><div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')} | Pass Mark: ${ReportUtils.formatPct(passMark)}</div>
      <div class="rms-summary-grid"><div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Total Students</span></div><div class="rms-stat"><span class="rms-stat-val">${assessedCount}</span><span class="rms-stat-lbl">Students Assessed</span></div><div class="rms-stat"><span class="rms-stat-val">${data.missingStudents.length}</span><span class="rms-stat-lbl">Missing Marks</span></div><div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.avg)}</span><span class="rms-stat-lbl">Class Average</span></div><div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(stats.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div></div>
      ${listTable('Student Performance Table', allRows, 'No students found for the selected scope.')}
      ${listTable('Highest Performing Students', highestStudents, 'No assessed students.')}
      ${listTable('Lowest Performing Students', lowestStudents, 'No assessed students.')}
      ${listTable('Students Needing Support', supportStudents, 'No students below the configured pass mark.')}
      ${listTable('Missing Marks', missingStudents, 'No missing marks.')}${footer}`;
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
    const header = ReportHeader.getOfficialHeader({ settings, title: data.title || 'SCHOOL PERFORMANCE SUMMARY', subtitle: `${year.name || ''} – ${term.name || ''}` });

    let tbody = '';
    classReports.forEach((cr, i) => {
      tbody += `<tr><td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(cr.class)}</td><td class="text-center">${cr.learners}</td><td class="text-center">${ReportUtils.formatPct(cr.stats.avg)}</td><td class="text-center">${ReportUtils.formatPct(cr.stats.passRate)}</td><td class="text-center">${cr.stats.passed}</td><td class="text-center">${cr.stats.failed}</td></tr>`;
    });

    const charts = classReports.length ? `<div class="rms-chart-row">
        ${ReportUtils.charts.svgBars({ labels: classReports.map(c => c.class), values: classReports.map(c => c.stats.avg), colors: ['#1e3a5f'], height: 170 })}
        ${ReportUtils.charts.svgDonut({ label: 'Pass rate', labels: ['Pass', 'Fail'], values: [overallPassRate, Math.max(0, 100 - overallPassRate)], colors: ['#16a34a', '#dc2626'], centerLabel: 'Pass rate', centerValue: `${Math.round(overallPassRate)}%` })}
      </div>` : '';

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
      ${charts || ReportHeader.emptyState('No marks are currently available for the selected scope.', { icon: 'file-x' })}
      <table class="rms-table"><thead><tr><th>#</th><th>Class</th><th>Learners</th><th>Average</th><th>Pass Rate</th><th>Passed</th><th>Failed</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  teacherAssessmentClass(data) {
    const { settings, year, term, rows, completionRows, classRows, totalStudents, totalPassed, totalFailed, overallAverage, overallPassRate, passMark } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'ASSESSMENT & CLASS ANALYSIS REPORT', subtitle: `${year?.name || ''} - ${term?.name || ''}` });
    const comparison = (rows || []).map(row => `<tr><td>${Utils.escapeHtml(row.assessment?.name || '-')}</td><td>${Utils.escapeHtml(row.className || '-')}</td><td>${Utils.escapeHtml(row.subject || '-')}</td><td class="text-center">${ReportUtils.formatPct(row.avg)}</td><td class="text-center">${ReportUtils.formatPct(row.high)}</td><td class="text-center">${ReportUtils.formatPct(row.low)}</td><td class="text-center">${row.passed}</td><td class="text-center">${row.failed}</td><td class="text-center">${ReportUtils.formatPct(row.passRate)}</td></tr>`).join('');
    const classes = (classRows || []).map(row => `<tr><td>${Utils.escapeHtml(row.className)}</td><td class="text-center">${row.students}</td><td class="text-center">${ReportUtils.formatPct(row.average)}</td><td class="text-center">${ReportUtils.formatPct(row.highest)}</td><td class="text-center">${ReportUtils.formatPct(row.lowest)}</td><td class="text-center">${row.passed}</td><td class="text-center">${row.failed}</td><td class="text-center">${ReportUtils.formatPct(row.passRate)}</td></tr>`).join('');
    const completion = (completionRows || []).map(row => `<tr><td>${Utils.escapeHtml(row.assessment?.name || '-')}</td><td>${Utils.escapeHtml(row.className || '-')}</td><td>${Utils.escapeHtml(row.subject || '-')}</td><td class="text-center">${row.expected}</td><td class="text-center">${row.entered}</td><td class="text-center">${row.missing}</td><td class="text-center">${ReportUtils.formatPct(row.completionPct)}</td></tr>`).join('');
    const charts = rows?.length ? `<div class="rms-chart-row">${ReportUtils.charts.svgBars({ labels: rows.map(row => row.assessment?.name || 'Assessment'), values: rows.map(row => row.avg), colors: ['#1e3a5f'], height: 170 })}${ReportUtils.charts.svgDonut({ labels: ['Passed', 'Failed'], values: [totalPassed, totalFailed], colors: ['#16a34a', '#dc2626'], centerLabel: 'Pass rate', centerValue: `${Math.round(overallPassRate || 0)}%` })}</div>` : '';
    const footer = ReportHeader.getFooter({ settings, academicYear: year?.name || '', term: term?.name || '' });
    return `${header}<div class="rms-report-title">${data.title}</div><div class="rms-meta">Academic Year: ${Utils.escapeHtml(year?.name || '-')} | Term: ${Utils.escapeHtml(term?.name || '-')} | Pass Mark: ${ReportUtils.formatPct(passMark)}</div>
      <div class="rms-summary-grid"><div class="rms-stat"><span class="rms-stat-val">${totalStudents}</span><span class="rms-stat-lbl">Total Students</span></div><div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(overallAverage)}</span><span class="rms-stat-lbl">Class Average</span></div><div class="rms-stat"><span class="rms-stat-val">${totalPassed}</span><span class="rms-stat-lbl">Passed</span></div><div class="rms-stat"><span class="rms-stat-val">${totalFailed}</span><span class="rms-stat-lbl">Failed</span></div><div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(overallPassRate)}</span><span class="rms-stat-lbl">Overall Pass Rate</span></div></div>
      ${charts || ReportHeader.emptyState('No assessment marks are available for the selected scope.', { icon: 'file-x' })}
      <h3 class="rms-section-title">Assessment Comparison</h3><table class="rms-table"><thead><tr><th>Assessment</th><th>Class</th><th>Subject</th><th>Average</th><th>Highest</th><th>Lowest</th><th>Passed</th><th>Failed</th><th>Pass %</th></tr></thead><tbody>${comparison || `<tr><td colspan="9">No assessment data</td></tr>`}</tbody></table>
      <h3 class="rms-section-title">Class Analysis</h3><table class="rms-table"><thead><tr><th>Class</th><th>Students</th><th>Average</th><th>Highest Avg</th><th>Lowest Avg</th><th>Passed</th><th>Failed</th><th>Pass %</th></tr></thead><tbody>${classes || `<tr><td colspan="8">No class data</td></tr>`}</tbody></table>
      <h3 class="rms-section-title">Missing Marks / Completion</h3><table class="rms-table"><thead><tr><th>Assessment</th><th>Class</th><th>Subject</th><th>Expected</th><th>Entered</th><th>Missing</th><th>Completion %</th></tr></thead><tbody>${completion || `<tr><td colspan="7">No completion data</td></tr>`}</tbody></table>${footer}`;
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
    const subjText = data.subjectName ? ` | Subject: ${data.subjectName}` : '';
    const header = ReportHeader.getOfficialHeader({ settings, title: data.title || 'GRADE DISTRIBUTION', subtitle: `${year.name || ''} – ${term.name || ''}${subjText}` });

    let tbody = '';
    distribution.forEach(g => {
      tbody += `<tr><td class="text-center font-bold" style="color:${g.is_pass ? '#16a34a' : '#dc2626'}">${g.grade}</td><td class="text-center">${g.count}</td><td class="text-center">${g.percentage}%</td><td>${Utils.escapeHtml(g.descriptor)}</td></tr>`;
    });

    const donut = totalLearners ? ReportUtils.charts.svgDonut({
      labels: (distribution || []).map(g => `${g.grade} – ${g.descriptor}`.slice(0, 26)),
      values: (distribution || []).map(g => g.count),
      colors: (distribution || []).map(g => g.is_pass ? '#16a34a' : '#dc2626'),
      centerLabel: 'Learners', centerValue: totalLearners
    }) : (distribution || []).every(g => g.count === 0) ? ReportHeader.emptyState('No marks are currently available for the selected scope.', { icon: 'file-x' }) : '';

    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Total Learners: ${totalLearners} | Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}${subjText}</div>
      <div class="rms-summary"><div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Total Learners</span></div></div>
      ${donut}
      <table class="rms-table"><thead><tr><th>Grade</th><th>Learners</th><th>%</th><th>Descriptor</th></tr></thead><tbody>${tbody}</tbody></table>
      ${footer}`;
  },

  /* ---------- Extended report family ---------- */

  marksSheet(data) {
    const { settings, cls, subject, year, term, blocks, scale, passMark } = data;
    const subjText = subject ? ` | Subject: ${Utils.escapeHtml(subject.name || '')}` : '';
    const header = ReportHeader.getOfficialHeader({ settings, title: data.title || 'MARKS SHEET', subtitle: `${cls?.name || ''}${subjText}` });
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });
    const empty = (msg) => `<tr><td colspan="99">${ReportHeader.emptyState(msg)}</td></tr>`;

    const blocksHtml = (blocks || []).map((blk, bi) => {
      const cols = blk.assessments || [];
      const colHead = cols.map(a => `<th>${Utils.escapeHtml(a.name)}<br><span class="rms-th-sub">/ ${a.maximum_mark || 0}</span></th>`).join('');
      const colCell = (r) => cols.map((a, ci) => {
        const c = r.cells && r.cells[ci];
        if (!c || !c.present) return `<td class="text-center" style="color:#b91c1c">—</td>`;
        return `<td class="text-center">${c.mark}<span class="rms-cell-pct"> ${c.pct != null ? Math.round(c.pct) + '%' : ''}</span></td>`;
      }).join('');
      const rowsHtml = (blk.matrix && blk.matrix.length ? blk.matrix : []).map(r => `<tr>
        <td>${Utils.escapeHtml(r.learner.full_name)}</td><td class="text-center">${Utils.escapeHtml(r.learner.learner_code || '-')}</td>
        ${colCell(r)}
        <td class="text-center font-bold">${r.pct == null ? '—' : ReportUtils.formatPct(r.pct)}</td>
        <td class="text-center font-bold">${r.grade}</td>
        <td class="text-center"><span class="badge ${r.passFail === 'PASS' ? 'badge-success' : r.passFail === 'FAIL' ? 'badge-danger' : 'badge-warning'}">${Utils.escapeHtml(r.passFail)}</span></td>
      </tr>`).join('') || empty('No learners with marks are currently available.');

      const colSummary = (blk.colStats || []).map(cs => `<td class="text-center">${cs.entered}<span class="rms-cell-pct"> ${cs.missing ? 'M' + cs.missing : ''}</span><br><span class="rms-th-sub">avg ${cs.avg != null ? cs.avg.toFixed(1) : 0}%</span></td>`).join('');

      return `
        <div class="rms-report-title" style="margin-top:${bi ? '18px' : '0'};font-size:13px">${Utils.escapeHtml(blk.cls ? blk.cls.name : '')}${blk.subject ? ' – ' + Utils.escapeHtml(blk.subject.name || '') : ''} (${(blk.assessments || []).length} assessments)</div>
        <table class="rms-table"><thead><tr><th>Student</th><th>Code</th>${colHead}<th>Total %</th><th>Grade</th><th>Status</th></tr></thead><tbody>${rowsHtml}</tbody><tbody><tr class="rms-summary-row"><td colspan="2"><strong>Entered / Missing / Avg</strong></td>${colSummary}<td></td><td></td><td></td></tr></tbody></table>`;
    }).join('');

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')}${subjText}</div>
      <div class="rms-summary"><div class="rms-stat"><span class="rms-stat-val">${data.totalLearners || 0}</span><span class="rms-stat-lbl">Learners Shown</span></div></div>
      ${blocksHtml}
      ${footer}`;
  },

  studentMarks(data) {
    const { settings, learner, cls, year, term, level, rows, stats, overallGrade } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'STUDENT MARKS REPORT', subtitle: `${learner?.full_name || ''} – ${cls?.name || ''}`, levelLabel: level?.label || '' });
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    let tbody = '';
    (rows || []).forEach((r, i) => {
      const badge = r.passFail === 'PASS' ? 'badge-success' : r.passFail === 'FAIL' ? 'badge-danger' : 'badge-warning';
      tbody += `<tr><td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(r.assessment.name)}</td><td>${Utils.escapeHtml(r.type)}</td><td>${Utils.escapeHtml(r.subject)}</td><td class="text-center">${Utils.escapeHtml((r.date || '').slice(0, 10))}</td><td class="text-center">${r.max}</td><td class="text-center font-bold">${r.mark == null ? '—' : r.mark}</td><td class="text-center">${r.pct == null ? 'N/A' : r.pct.toFixed(1) + '%'}</td><td class="text-center font-bold">${r.grade}</td><td class="text-center"><span class="badge ${badge}">${Utils.escapeHtml(r.passFail)}</span></td></tr>`;
    });

    const incomplete = data.missingMarks > 0 ? ReportHeader.warningBanner(`${data.missingMarks} assessment mark(s) are missing for this student. The report cannot be finalised until they are entered.`) : '';

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta-grid">
        <div><span class="rms-meta-lbl">Student:</span> ${Utils.escapeHtml(learner?.full_name || '-')}</div>
        <div><span class="rms-meta-lbl">Code:</span> ${Utils.escapeHtml(learner?.learner_code || '-')}</div>
        <div><span class="rms-meta-lbl">Class:</span> ${Utils.escapeHtml(cls?.name || '-')}</div>
        <div><span class="rms-meta-lbl">Level:</span> ${Utils.escapeHtml(level?.label || '-')}</div>
        <div><span class="rms-meta-lbl">Academic Year:</span> ${Utils.escapeHtml(year.name || '-')}</div>
        <div><span class="rms-meta-lbl">Term:</span> ${Utils.escapeHtml(term.name || '-')}</div>
      </div>
      ${incomplete}
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${data.totalAssessments || 0}</span><span class="rms-stat-lbl">Assessments</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${data.withMarks || 0}</span><span class="rms-stat-lbl">With Marks</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${data.missingMarks || 0}</span><span class="rms-stat-lbl">Missing</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(data.overallAvg)}</span><span class="rms-stat-lbl">Average</span></div>
        <div class="rms-stat"><span class="rms-stat-val font-bold">${overallGrade?.grade || '—'}</span><span class="rms-stat-lbl">Overall Grade</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${data.overallMark || 0} / ${data.overallMax || 0}</span><span class="rms-stat-lbl">Total Score</span></div>
      </div>
      ${rows && rows.length ? `<table class="rms-table"><thead><tr><th>#</th><th>Assessment</th><th>Type</th><th>Subject</th><th>Date</th><th>Max</th><th>Mark</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>` : ReportHeader.emptyState('No assessment marks are currently available for this student.', { icon: 'file-x' })}
      ${footer}`;
  },

  subjectAssessmentComparison(data) {
    const { settings, cls, subject, year, term, teacher, rows, overall, bestAssessment, totalLearners } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'SUBJECT ASSESSMENT COMPARISON', subtitle: `${subject?.name || ''} – ${cls?.name || ''}` });
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    const tbody = (rows || []).map((r, i) => `<tr>
      <td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(r.assessment.name)}</td>
      <td class="text-center">${r.maximum}</td><td class="text-center">${r.entered}</td><td class="text-center" style="color:#b91c1c">${r.missing}</td>
      <td class="text-center font-bold">${ReportUtils.formatPct(r.avg)}</td><td class="text-center">${ReportUtils.formatPct(r.high)}</td><td class="text-center">${ReportUtils.formatPct(r.low)}</td>
      <td class="text-center">${ReportUtils.formatPct(r.passRate)}</td>
    </tr>`).join('');

    const bestText = bestAssessment ? Utils.escapeHtml(bestAssessment.name) : '-';
    const charts = rows && rows.length ? ReportUtils.charts.svgBars({ labels: (rows).map(r => r.assessment.name), values: (rows).map(r => r.avg), height: 170 }) : '';

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Class: ${Utils.escapeHtml(cls?.name || '-')} | Subject: ${Utils.escapeHtml(subject?.name || '-')} | Teacher: ${Utils.escapeHtml(teacher?.full_name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalLearners}</span><span class="rms-stat-lbl">Learners</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${rows ? rows.length : 0}</span><span class="rms-stat-lbl">Assessments</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(overall?.avg)}</span><span class="rms-stat-lbl">Subject Avg</span></div>
        <div class="rms-stat"><span class="rms-stat-val font-bold">${bestText}</span><span class="rms-stat-lbl">Best Assessment</span></div>
      </div>
      ${charts}
      ${rows && rows.length ? `<table class="rms-table"><thead><tr><th>#</th><th>Assessment</th><th>Max</th><th>Entered</th><th>Missing</th><th>Average</th><th>Highest</th><th>Lowest</th><th>Pass Rate</th></tr></thead><tbody>${tbody}</tbody></table>` : ReportHeader.emptyState('No approved assessments are available for comparison.', { icon: 'file-x' })}
      ${footer}`;
  },

  assessmentSummary(data) {
    const { settings, year, term, rows, summary, totalAssessments, totalMarks, totalMissing } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'ASSESSMENT SUMMARY', subtitle: `${year.name || ''} – ${term.name || ''}` });
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    const tbody = (rows || []).map((r, i) => `<tr>
      <td class="text-center">${i + 1}</td><td>${Utils.escapeHtml(r.assessment.name)}</td>
      <td>${Utils.escapeHtml(r.subject)}</td><td>${Utils.escapeHtml(r.className)}</td>
      <td class="text-center">${r.maximum}</td><td class="text-center">${r.expected}</td><td class="text-center">${r.entered}</td><td class="text-center" style="color:#b91c1c">${r.missing}</td>
      <td class="text-center font-bold">${ReportUtils.formatPct(r.avg)}</td><td class="text-center">${ReportUtils.formatPct(r.high)}</td><td class="text-center">${ReportUtils.formatPct(r.low)}</td><td class="text-center">${ReportUtils.formatPct(r.passRate)}</td>
    </tr>`).join('');

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${totalAssessments}</span><span class="rms-stat-lbl">Assessments</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${totalMarks}</span><span class="rms-stat-lbl">Marks Entered</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${totalMissing}</span><span class="rms-stat-lbl">Missing</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(summary?.avg)}</span><span class="rms-stat-lbl">Overall Avg</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${ReportUtils.formatPct(summary?.passRate)}</span><span class="rms-stat-lbl">Pass Rate</span></div>
      </div>
      ${rows && rows.length ? `<table class="rms-table"><thead><tr><th>#</th><th>Assessment</th><th>Subject</th><th>Class</th><th>Max</th><th>Expected</th><th>Entered</th><th>Missing</th><th>Avg</th><th>High</th><th>Low</th><th>Pass Rate</th></tr></thead><tbody>${tbody}</tbody></table>` : ReportHeader.emptyState('No assessment data is available for the selected period.', { icon: 'file-x' })}
      ${footer}`;
  },

  assessmentCompletion(data) {
    const { settings, year, term, rows, summary } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'ASSESSMENT COMPLETION REPORT', subtitle: `${year.name || ''} – ${term.name || ''}` });
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    const tbody = (rows || []).map(r => {
      const badgeClass = r.status === 'COMPLETE' ? 'badge-success' : r.status === 'PARTIALLY COMPLETE' ? 'badge-warning' : 'badge-danger';
      return `<tr><td>${Utils.escapeHtml(r.assessment.name)}</td><td>${Utils.escapeHtml(r.className)}</td><td>${Utils.escapeHtml(r.subject)}</td><td>${Utils.escapeHtml(r.teacher)}</td><td class="text-center">${r.expected}</td><td class="text-center">${r.entered}</td><td class="text-center" style="color:#b91c1c">${r.missing}</td><td class="text-center font-bold">${r.completionPct}%</td><td class="text-center"><span class="badge ${badgeClass}">${r.status}</span></td></tr>`;
    }).join('');

    const donut = (summary && summary.total) ? ReportUtils.charts.svgDonut({
      labels: ['Complete', 'Partial', 'Missing'],
      values: [summary.complete || 0, summary.partial || 0, summary.missing || 0],
      colors: ['#16a34a', '#f59e0b', '#dc2626'],
      centerLabel: 'Assessments', centerValue: summary.total
    }) : '';

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')}</div>
      <div class="rms-summary-grid">
        <div class="rms-stat"><span class="rms-stat-val">${summary?.total || 0}</span><span class="rms-stat-lbl">Assessments</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#16a34a">${summary?.complete || 0}</span><span class="rms-stat-lbl">Complete</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#f59e0b">${summary?.partial || 0}</span><span class="rms-stat-lbl">Partial</span></div>
        <div class="rms-stat"><span class="rms-stat-val" style="color:#dc2626">${summary?.missing || 0}</span><span class="rms-stat-lbl">Missing</span></div>
        <div class="rms-stat"><span class="rms-stat-val">${summary?.avgCompletion || 0}%</span><span class="rms-stat-lbl">Avg Completion</span></div>
      </div>
      ${donut}
      ${rows && rows.length ? `<table class="rms-table"><thead><tr><th>Assessment</th><th>Class</th><th>Subject</th><th>Teacher</th><th>Expected</th><th>Entered</th><th>Missing</th><th>Completion</th><th>Status</th></tr></thead><tbody>${tbody}</tbody></table>` : ReportHeader.emptyState('No assessments found for the selected period.', { icon: 'file-x' })}
      ${footer}`;
  },

  teacherAssessmentSubmission(data) {
    const { settings, year, term, rows, totalTeachers } = data;
    const header = ReportHeader.getOfficialHeader({ settings, title: 'TEACHER ASSESSMENT SUBMISSION REPORT', subtitle: `${year.name || ''} – ${term.name || ''}` });
    const footer = ReportHeader.getFooter({ settings, academicYear: year.name || '', term: term.name || '' });

    const badge = (k) => `<span class="badge ${k === 'approved' || k === 'locked' ? 'badge-success' : k === 'submitted' ? 'badge-info' : 'badge-warning'}">${Utils.escapeHtml(k)}</span>`;
    const tbody = (rows || []).map(r => `<tr>
      <td>${Utils.escapeHtml(r.teacher.full_name)}</td>
      <td class="text-center">${r.total}</td>
      <td class="text-center">${r.classes}</td><td class="text-center">${r.subjects}</td>
      <td class="text-center">${r.statusCounts.draft || 0}</td><td class="text-center">${r.statusCounts.submitted || 0}</td><td class="text-center">${(r.statusCounts.approved || 0) + (r.statusCounts.locked || 0)}</td><td class="text-center">${r.marksEntered}</td>
      <td class="text-center font-bold">${r.submittedPct}%</td>
    </tr>`).join('');

    return `
      ${header}
      <div class="rms-report-title">${data.title}</div>
      <div class="rms-meta">Academic Year: ${Utils.escapeHtml(year.name || '-')} | Term: ${Utils.escapeHtml(term.name || '-')} | Teachers: ${totalTeachers}</div>
      <div class="rms-info-banner" style="display:flex;gap:6px"><i data-lucide="info" style="width:14px;height:14px;flex:none"></i><span>Submitted % = assessments submitted, approved or locked (ready for reports).</span></div>
      ${rows && rows.length ? `<table class="rms-table"><thead><tr><th>Teacher</th><th>Total</th><th>Classes</th><th>Subjects</th><th>Draft</th><th>Submitted</th><th>Approved/Locked</th><th>Marks Entered</th><th>Submitted %</th></tr></thead><tbody>${tbody}</tbody></table>` : ReportHeader.emptyState('No teacher submissions found for the selected period.', { icon: 'file-x' })}
      ${footer}`;
  }
};
