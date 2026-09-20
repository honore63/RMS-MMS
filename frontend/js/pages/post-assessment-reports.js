/* ============================================================
   POST-ASSESSMENT TEACHER REPORTS
   1. Subject Performance Report
   2. Performance Range Report
   3. Students Requiring Academic Support
   4. Grade Distribution Report
   5. Assessment Analysis & Comparison Report

   All figures are computed live from the RMS-MIS database using
   the existing calculation engine (AnalyticsEngine / ReportEngine
   weight rules, school_settings.pass_mark, grading_scales).
   Teachers are scoped to their assigned classes, subjects and
   assessments; DOS/Admin can access every report. RLS remains the
   authority - all queries run as the signed-in user.
   ============================================================ */

function renderPostAssessmentReports() { psrRefresh(); }

let psrState = {
  yearId: '', termId: 'all', classId: 'all', subjectId: 'all', typeId: 'all',
  assessmentId: 'all', report: '1', cmp: {}
};
let psrRaw = null;
let psrData = null;
let psrCtx = null;
let psrList = [];
let psrBusy = false;

function psrIsTeacher() {
  try { return typeof Auth !== 'undefined' && Auth.getRole && Auth.getRole() === 'teacher'; }
  catch (e) { return false; }
}

const PStr = {
  esc(v) { return Utils.escapeHtml(v == null ? '' : String(v)); },
  num(x) { return (x == null || isNaN(x)) ? 0 : Number(x); },
  round(x, d) { const p = Math.pow(10, d == null ? 1 : d); return Math.round(PStr.num(x) * p) / p; },
  fmt(x) { return x == null || isNaN(x) ? 'N/A' : PStr.round(x) + '%'; }
};

function psrTeacherName(ctx) {
  const isT = psrIsTeacher();
  if (isT && ctx) {
    const prof = ctx.teacherById && ctx.teacherById(ctx.teacherId);
    if (prof && prof.full_name) return prof.full_name;
  }
  return (Auth.currentUser && Auth.currentUser.full_name) || 'RMS-MIS';
}

async function psrRefresh() {
  if (psrBusy) return;
  psrBusy = true;
  const isT = psrIsTeacher();
  setHeader('Post-Assessment Reports',
    isT ? 'Generate performance reports for your assigned classes, subjects and assessments'
        : 'Teacher post-assessment performance reports (full access)');
  setContent(Utils.loading());
  try {
    AnalyticsEngine.resetContext();
    const ctx = await AnalyticsEngine.context(psrState, isT);
    psrCtx = ctx;

    if (!psrState.yearId) {
      if (isT) {
        const yrs = [...new Set((ctx.assignments || []).map(a => a.academic_year_id).filter(Boolean))];
        psrState.yearId = yrs.length ? yrs[0] : (ctx.years.find(y => y.status === 'active')?.id || 'all');
      } else {
        psrState.yearId = (typeof getActiveYearId === 'function' ? getActiveYearId(ctx.years) : null)
          || (ctx.years.find(y => y.status === 'active')?.id || 'all');
      }
    }

    const ddFilter = { ...psrState, assessmentId: 'all' };
    const dd = await AnalyticsEngine.load(ddFilter, ctx, isT);
    psrList = dd.assessments;

    psrRaw = await AnalyticsEngine.load(psrState, ctx, isT);
    psrData = AnalyticsEngine.compute(psrState, ctx, psrRaw, isT);

    psrRenderScreen();
  } catch (e) {
    console.error('[psr]', e);
    setContent(`<div class="card"><div class="card-body" style="padding:40px;text-align:center">
      <i data-lucide="alert-triangle" style="width:36px;height:36px;color:var(--red-500);margin-bottom:12px"></i>
      <h3>Unable to load reports</h3>
      <p style="color:var(--gray-500);margin:8px 0 16px">${PStr.esc(e.message || 'An unexpected error occurred.')}</p>
      <button class="btn btn-primary" onclick="psrRefresh()"><i data-lucide="refresh-cw"></i> Retry</button>
    </div></div>`);
    Utils.toast(e.message || 'Failed to load reports', 'error');
  } finally {
    psrBusy = false;
  }
}

function psrRenderScreen() {
  const s = psrState;
  const ctx = psrCtx;
  const isT = psrIsTeacher();

  let classRows = isT ? (ctx.assignments || []) : ctx.classes;
  if (s.yearId && s.yearId !== 'all') classRows = classRows.filter(c => c.academic_year_id === s.yearId);
  const classNames = new Map();
  classRows.forEach(c => classNames.set(c.id, c));
  (ctx.assignments || []).forEach(a => { const c = ctx.classByName(a.class_id); if (c) classNames.set(c.id, c); });
  const classOpts = [...classNames.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const streamList = [...new Set(classOpts.map(c => c.stream).filter(Boolean))].sort();

  let subjectOpts = [];
  if (isT) {
    const subIds = new Set((ctx.assignments || []).map(a => a.subject_id));
    subjectOpts = ctx.subjects.filter(su => subIds.has(su.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } else {
    subjectOpts = ctx.subjects.filter(su => !su.status || su.status === 'active').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  let termsOpts = ctx.terms;
  if (s.yearId && s.yearId !== 'all') termsOpts = termsOpts.filter(t => t.academic_year_id === s.yearId);
  termsOpts = [...termsOpts].sort((a, b) => (PStr.num(a.term_no) - PStr.num(b.term_no)) || String(a.name).localeCompare(String(b.name)));

  const assessOpts = psrList.map(a => ({
    value: a.id,
    label: (a._subject ? a._subject.name : '') + ' - ' + (a.name || a.unit) + (a._term ? ' (' + a._term.name + ')' : '')
  }));

  const tabs = [
    { id: '1', icon: 'clipboard-list', label: 'Subject Performance' },
    { id: '2', icon: 'bar-chart-3', label: 'Performance Range' },
    { id: '3', icon: 'life-buoy', label: 'Academic Support' },
    { id: '4', icon: 'graduation-cap', label: 'Grade Distribution' },
    { id: '5', icon: 'git-compare', label: 'Assessment Comparison' }
  ].map(t => `<button class="psr-tab ${s.report === t.id ? 'active' : ''}" onclick="psrSetTab('${t.id}')" role="tab" aria-selected="${s.report === t.id}">
      <i data-lucide="${t.icon}"></i>${t.label}</button>`).join('');

  const fields = [];
  fields.push(analyticsField('Academic Year', analyticsSelect('yearId', [{ value: 'all', label: 'All Years' }].concat(ctx.years.map(y => ({ value: y.id, label: y.name + (y.is_current ? ' (Current)' : '') }))), s.yearId)));
  fields.push(analyticsField('Term', analyticsSelect('termId', [{ value: 'all', label: 'All Terms' }].concat(termsOpts.map(t => ({ value: t.id, label: t.name }))), s.termId)));
  fields.push(analyticsField('Class', analyticsSelect('classId', [{ value: 'all', label: 'All Classes' }].concat(classOpts.map(c => ({ value: c.id, label: c.name }))), s.classId)));
  fields.push(analyticsField('Subject', analyticsSelect('subjectId', [{ value: 'all', label: 'All Subjects' }].concat(subjectOpts.map(x => ({ value: x.id, label: x.name }))), s.subjectId)));
  fields.push(analyticsField('Assessment Type', analyticsSelect('typeId', [{ value: 'all', label: 'All Types' }].concat(ctx.types.map(x => ({ value: x.id, label: x.name }))), s.typeId)));
  fields.push(analyticsField('Assessment', analyticsSelect('assessmentId', [{ value: 'all', label: 'All Assessments' }].concat(assessOpts.length ? assessOpts : [{ value: 'none', label: 'No assessments in scope' }]), s.assessmentId)));

  const scopeParts = [];
  if (ctx.yearById(s.yearId)) scopeParts.push(ctx.yearById(s.yearId).name);
  if (ctx.termById(s.termId)) scopeParts.push(ctx.termById(s.termId).name);
  if (ctx.classByName(s.classId)) scopeParts.push(ctx.classByName(s.classId).name);
  if (ctx.subjectById(s.subjectId)) scopeParts.push(ctx.subjectById(s.subjectId).name);
  if (s.typeId !== 'all') { const t = ctx.types.find(x => x.id === s.typeId); if (t) scopeParts.push(t.name); }
  if (s.assessmentId !== 'all') { const a = psrList.find(x => x.id === s.assessmentId); if (a) scopeParts.push(a.name || a.unit); }

  const teacherScopeNote = isT
    ? `Scoped to your assigned classes and subjects${ctx.assignments && ctx.assignments.length ? ' (' + ctx.assignments.length + ' assignment records)' : ''}. RLS restricts all data at the database level.`
    : 'Full DOS/Admin access.';

  const exportBar = `<div class="analysis-bar psr-export-bar">
    <span class="text-sm text-muted" style="margin-right:auto">${teacherScopeNote}</span>
    <button class="btn btn-secondary" onclick="psrExportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
    <button class="btn btn-secondary" onclick="psrPrint()"><i data-lucide="printer"></i> Print / PDF</button>
  </div>`;

  setContent(`<div class="psr-page">
    <div class="card mb-6 psr-filters-card">
      <div class="card-header psr-card-header">
        <h3><i data-lucide="sliders-horizontal"></i> Report Filters</h3>
        <div class="analytics-header-actions">
          <button class="btn btn-sm btn-secondary" onclick="psrResetFilters()"><i data-lucide="rotate-ccw"></i> Reset Filters</button>
        </div>
      </div>
      <div class="psr-tabs report-tabs">${tabs}</div>
      <div class="filters-grid">${fields.join('')}</div>
      <div class="analytics-scope">Scope: <strong>${scopeParts.length ? PStr.esc(scopeParts.join(' &bull; ')) : 'Whole school'}</strong> &middot; Assessments in scope: <strong>${psrRaw.assessments.length}</strong> &middot; Default status: Approved + Locked</div>
    </div>
    ${exportBar}
    <div id="psr-sections" class="psr-sections"></div>
  </div>`);
  psrDrawSection();
}

function psrSetTab(id) {
  psrState.report = id;
  document.querySelectorAll('.psr-tab').forEach(b => {
    const on = b.getAttribute('onclick').indexOf("'" + id + "'") !== -1;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on);
  });
  psrDrawSection();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function psrSetFilter(prop, value) {
  psrState[prop] = value;
  if (prop === 'yearId') { psrState.termId = 'all'; psrState.classId = 'all'; }
  if (['termId', 'classId', 'subjectId', 'typeId', 'yearId'].indexOf(prop) !== -1) { psrState.assessmentId = 'all'; }
  psrState.cmp = {};
  psrRefresh();
}

function psrResetFilters() {
  psrState = { yearId: '', termId: 'all', classId: 'all', subjectId: 'all', typeId: 'all', assessmentId: 'all', report: psrState.report, cmp: {} };
  psrRefresh();
}

function psrToggleCmp(id, checked) {
  psrState.cmp[id] = checked;
  psrDrawSection();
}

/* ============================================================
   Unified report model -> screen renderer
   ============================================================ */

function psrChartCard(c) {
  return `<div class="card mb-6"><div class="card-header"><h3>${AStrs.icon(c.icon || 'chart-bar')}${PStr.esc(c.title)}</h3>${c.sub ? `<span class="text-sm text-muted">${PStr.esc(c.sub)}</span>` : ''}</div>
    <div id="${c.id}" class="chart-box"></div></div>`;
}

function psrTableCard(t) {
  const ths = t.cols.map(h => `<th class="text-center">${PStr.esc(h)}</th>`).join('');
  const trs = t.rows.map(r => `<tr>${r.map((cell, i) => {
    let cls = '';
    if (t.centerCols && t.centerCols.indexOf(i) !== -1) cls = 'text-center';
    return `<td class="${cls}">${cell}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="card mb-6"><div class="card-header"><h3>${AStrs.icon(t.icon || 'table')}${PStr.esc(t.title)}</h3>${t.note ? `<span class="text-sm text-muted">${PStr.esc(t.note)}</span>` : ''}</div>
    <div class="table-box"><div class="table-container table-scroll"><table class="data-table"><thead><tr>${ths}</tr></thead>
    <tbody>${trs || `<tr><td colspan="${t.cols.length}" style="text-align:center;color:var(--gray-400)">No records.</td></tr>`}</tbody></table></div></div></div>`;
}

function psrPromptCard(title, msg) {
  return `<div class="card mt-6"><div class="card-body" style="padding:48px;text-align:center">
    <i data-lucide="mouse-pointer-click" style="width:36px;height:36px;color:var(--blue-300);margin-bottom:12px"></i>
    <h3>${PStr.esc(title)}</h3><p style="color:var(--gray-500);margin:8px auto 0;max-width:440px">${PStr.esc(msg)}</p>
  </div></div>`;
}

function psrDrawSection() {
  const el = document.getElementById('psr-sections');
  if (!el) return;
  const m = psrSectionModel();
  if (m.prompt) {
    el.innerHTML = `<div class="card"><div class="card-body" style="padding:40px;text-align:center">
      <i data-lucide="info" style="width:32px;height:32px;color:var(--gray-300);margin-bottom:10px"></i>
      <h3>${PStr.esc(m.prompt.title)}</h3><p style="color:var(--gray-500)">${PStr.esc(m.prompt.msg)}</p></div></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return;
  }

  let html = m.printHeader || '';
  if (m.kpis.length) html += `<div class="grid-4 mb-6">${m.kpis.map(k => analyticsStat(k.label, k.value, k.icon, k.tone, k.sub)).join('')}</div>`;

  for (let i = 0; i < m.charts.length; i++) {
    const c = m.charts[i];
    if (c.half && i + 1 < m.charts.length && m.charts[i + 1].half) {
      html += `<div class="grid-2 mb-6">${psrChartCard(c)}${psrChartCard(m.charts[i + 1])}</div>`;
      i++;
    } else {
      html += psrChartCard(c);
    }
  }
  if (m.chips) html += `<div class="card mb-6"><div class="card-header"><h3>${AStrs.icon('checkbox')}Select Assessments to Compare</h3></div><div class="cmp-chips">${m.chips}</div></div>`;
  m.tables.forEach(t => { html += psrTableCard(t); });
  if (m.printSignature) html += m.printSignature;

  el.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  m.charts.forEach(c => {
    const cEl = document.getElementById(c.id);
    if (cEl && RMSCharts[c.type]) RMSCharts[c.type](cEl, c.opts);
  });
}

/* ============================================================
   Report model builders
   ============================================================ */

function psrSectionModel() {
  switch (psrState.report) {
    case '2': return psrRangeModel();
    case '3': return psrSupportModel();
    case '4': return psrGradesModel();
    case '5': return psrComparisonModel();
    default: return psrSubjectModel();
  }
}

function psrScopeMeta() {
  const ctx = psrCtx;
  const isT = psrIsTeacher();
  const assessments = psrRaw.assessments;
  const official = assessments.length > 0 && assessments.every(a => a.status === 'approved' || a.status === 'locked');
  return {
    className: (psrState.classId && ctx.classByName(psrState.classId)) ? ctx.classByName(psrState.classId).name : (isT ? 'Assigned classes' : 'Selected class'),
    subjectName: (psrState.subjectId && ctx.subjectById(psrState.subjectId)) ? ctx.subjectById(psrState.subjectId).name : 'Subject',
    yearName: ctx.yearById(psrState.yearId) ? ctx.yearById(psrState.yearId).name : '',
    termName: ctx.termById(psrState.termId) ? ctx.termById(psrState.termId).name : '',
    teacherName: psrTeacherName(ctx),
    settings: ctx.settings,
    isOfficial: official,
    totalMax: assessments.reduce((a, x) => a + (Number(x.maximum_mark) || 0), 0)
  };
}

function psrReportHeader(title, subtitle) {
  const meta = psrScopeMeta();
  const opts = {
    settings: meta.settings,
    className: meta.className,
    subject: meta.subjectName,
    academicYear: meta.yearName,
    term: meta.termName,
    teacher: meta.teacherName,
    date: Utils.dateStr(new Date()),
    assessmentsCount: psrRaw.assessments.length,
    totalMax: meta.totalMax,
    isOfficial: meta.isOfficial
  };
  return `<div class="psr-print-header">${schoolReportHeader(PStr.esc(title), opts)}${subtitle ? `<div class="psr-print-subtitle">${PStr.esc(subtitle)}</div>` : ''}</div>`;
}

function psrReportSignature() {
  const meta = psrScopeMeta();
  return `<div class="psr-print-signature">${schoolSignatureSection(meta.teacherName, meta.settings.dos_name, meta.settings.headteacher_name)}</div>`;
}

function psrBadgePct(pct, passMark) {
  const p = PStr.num(pct);
  const ok = !isNaN(p) && p >= passMark;
  return `<span class="badge ${ok ? 'badge-green' : 'badge-red'}"><i data-lucide="${ok ? 'check-circle-2' : 'x-circle'}" style="width:12px;height:12px;vertical-align:middle;margin-right:3px"></i>${ok ? 'PASS' : 'FAIL'}</span>`;
}

function psrGradeBadge(g) {
  return g ? `<span class="badge badge-purple">${PStr.esc(g)}</span>` : '-';
}

/* ---------- Report 1: Subject Performance ---------- */

function psrSubjectModel() {
  const d = psrData;
  const ctx = psrCtx;
  const k = d.kpis;
  const passMark = k.passMark;

  if (!psrState.subjectId || psrState.subjectId === 'all' || !psrState.classId || psrState.classId === 'all') {
    return { prompt: { title: 'Select a class and subject', msg: 'The Subject Performance Report shows one class and subject at a time. Choose a class and a subject from the filters above (teachers only see their assigned ones).' } };
  }
  if (!d.learners.length) {
    return { prompt: { title: 'No learners assessed', msg: 'No assessed students were found for the selected class, subject and assessment scope. Missing marks are never treated as zero.' } };
  }

  const meta = psrScopeMeta();
  const assessments = psrRaw.assessments;
  const assessed = k.assessed;

  const kpis = [
    { label: 'Students Assessed', value: assessed, icon: 'users-round', tone: 'blue' },
    { label: 'Class Average', value: PStr.fmt(k.overall), icon: 'calculator', tone: 'blue' },
    { label: 'Highest Average', value: PStr.fmt(k.highest), icon: 'trending-up', tone: 'green' },
    { label: 'Lowest Average', value: PStr.fmt(k.lowest), icon: 'trending-down', tone: 'red' },
    { label: 'Pass Rate', value: PStr.fmt(k.passRate), icon: 'badge-check', tone: 'green', sub: 'Pass mark ' + PStr.round(passMark) + '%' },
    { label: 'Fail Rate', value: PStr.fmt(k.failRate), icon: 'alert-triangle', tone: 'red' }
  ];

  const assessStats = assessments.map(a => {
    const ms = psrRaw.marks.filter(m => m.assessment_id === a.id);
    const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, a)).filter(p => p != null);
    return {
      id: a.id,
      name: a.name || a.unit,
      max: Number(a.maximum_mark) || 0,
      weight: a._effWeight,
      avg: valid.length ? PStr.round(valid.reduce((x, y) => x + y, 0) / valid.length) : null,
      high: valid.length ? PStr.round(Math.max(...valid)) : null,
      low: valid.length ? PStr.round(Math.min(...valid)) : null,
      passRate: valid.length ? PStr.round(valid.filter(p => p >= passMark).length / valid.length * 100) : null,
      count: valid.length
    };
  });

  const studentCols = ['#', 'Student ID', 'Student Name', 'Gender'].concat(assessments.map(a => (a.name || a.unit).length > 16 ? (a.name || a.unit).slice(0, 14) + '…' : (a.name || a.unit))).concat(['Overall %', 'Grade', 'Result', 'Position']);
  const centerCols = [];
  for (let i = 0; i < studentCols.length; i++) centerCols.push(i);
  const studentRows = d.learners.map((l, idx) => {
    const row = [idx + 1, PStr.esc(l.code), `<span class="col-name">${PStr.esc(l.name)}</span>`, PStr.esc(l.gender)];
    assessments.forEach(a => {
      const v = l.assessmentPct ? l.assessmentPct[a.id] : null;
      row.push(v != null ? `<span class="font-semibold">${PStr.round(v)}%</span>` : '<span class="text-muted">-</span>');
    });
    row.push(`<span class="font-semibold">${PStr.fmt(l.pct)}</span>`, psrGradeBadge(l.grade), psrBadgePct(l.pct, passMark), l.position != null ? '#' + l.position : '-');
    return row;
  });

  return {
    printHeader: psrReportHeader('SUBJECT PERFORMANCE REPORT', 'Number of students assessed, class average, highest / lowest average, pass / fail rate, student-by-student results and grade distribution.'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-sub-avg', title: 'Assessment Averages', sub: 'Weighted handling of different maximum marks', icon: 'chart-bar', type: 'bar', half: true,
        opts: { items: assessStats.map(a => ({ label: a.name, value: a.avg, sub: a.weight ? ('Weight ' + PStr.round(a.weight)) : '', color: undefined })), title: 'Assessment averages' } },
      { id: 'psr-sub-pf', title: 'Pass / Fail', sub: 'Pass mark ' + PStr.round(passMark) + '%', icon: 'circle-dot', type: 'donut', half: true,
        opts: { items: [{ label: 'Pass', value: k.passed, color: '#16a34a' }, { label: 'Fail', value: k.failed, color: '#dc2626' }], centerLabel: PStr.fmt(k.passRate), centerSub: 'pass rate', title: 'Pass/Fail' } },
      { id: 'psr-sub-grades', title: 'Grade Distribution', sub: 'School grading scale from the database', icon: 'graduation-cap', type: 'bar', half: false,
        opts: { items: d.gradeRows.map(g => ({ label: 'Grade ' + g.label, value: g.value, sub: g.remark || '' })), title: 'Grades' } }
    ],
    tables: [
      { title: 'Assessment Summary', icon: 'list-checks', note: 'Computed per assessment from actual marks',
        cols: ['Assessment', 'Type', 'Max Mark', 'Weight', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Assessed'],
        centerCols: [2, 3, 4, 5, 6, 7, 8],
        rows: assessStats.map(a => [PStr.esc(a.name), PStr.esc((psrRaw.assessments.find(x => x.id === a.id) || {})._typeName || '-'), a.max, a.weight != null ? PStr.round(a.weight) : '-', PStr.fmt(a.avg), PStr.fmt(a.high), PStr.fmt(a.low), PStr.fmt(a.passRate), a.count]) },
      { title: 'Student-by-Student Results', icon: 'users', note: 'Per-assessment percentage and weighted overall (existing RMS-MIS engine)',
        cols: studentCols, centerCols, rows: studentRows }
    ]
  };
}

/* ---------- Report 2: Performance Range ---------- */

function psrRangeModel() {
  const d = psrData;
  const k = d.kpis;
  const passMark = k.passMark;
  if (!d.learners.length) {
    return { prompt: { title: 'No learners assessed', msg: 'No assessed students were found for the selected filters.' } };
  }

  // Use the centralized GradingEngine performance ranges from database
  const perfRanges = typeof GradingEngine !== 'undefined' && psrCtx?.scale
    ? GradingEngine.getPerformanceRangesSync(psrCtx.scale)
    : psrRangeFallback();

  const assessed = d.learners.filter(l => l.pct != null);
  const buckets = perfRanges.map(r => {
    const inRange = assessed.filter(l => l.pct >= r.min && l.pct <= r.max);
    return {
      label: r.label,
      shortLabel: r.shortLabel,
      grade: r.grade,
      descriptor: r.descriptor,
      isPass: r.isPass,
      color: r.color,
      count: inRange.length,
      pct: assessed.length ? PStr.round(inRange.length / assessed.length * 100) : 0,
      students: inRange.map(l => ({ name: l.name, code: l.code, className: l.className, pct: l.pct, grade: l.grade, pf: l.pf }))
    };
  });
  const largest = buckets.reduce((a, b) => b.count > a.count ? b : a, buckets[0]);
  const bottomRange = buckets[buckets.length - 1];

  const kpis = [
    { label: 'Students Assessed', value: assessed.length, icon: 'users-round', tone: 'blue' },
    { label: 'Class Average', value: PStr.fmt(k.overall), icon: 'calculator', tone: 'blue' },
    { label: 'Most Populated Range', value: PStr.esc(largest.label), icon: 'trending-up', tone: 'green', sub: largest.count + ' students' },
    { label: 'Students in Lowest Range', value: bottomRange.count, icon: 'alert-triangle', tone: 'red', sub: PStr.fmt(bottomRange.pct) + ' of assessed' }
  ];

  const rangeRows = buckets.map(b => [PStr.esc(b.label), b.count, PStr.fmt(b.pct)]);
  const chipsHtml = buckets.map(b =>
    `<div class="rms-donut-legend-item"><span class="rms-legend-swatch" style="background:${b.color}"></span><span>${PStr.esc(b.label)}</span><span class="font-semibold">${b.count}</span><span class="text-muted">(${PStr.fmt(b.pct)})</span></div>`).join('');

  const studentCols = ['Range', 'Student', 'Student ID', 'Class', 'Overall %', 'Grade', 'Result'];
  const studentRows = [];
  buckets.forEach(b => {
    b.students.slice().sort((x, y) => y.pct - x.pct).forEach(s => {
      studentRows.push([`<span class="badge" style="background:${b.color};color:#fff">${PStr.esc(b.label)}</span>`, `<span class="col-name">${PStr.esc(s.name)}</span>`, PStr.esc(s.code), PStr.esc(s.className), PStr.fmt(s.pct), psrGradeBadge(s.grade), psrBadgePct(s.pct, passMark)]);
    });
  });

  return {
    printHeader: psrReportHeader('PERFORMANCE RANGE REPORT', 'Student distribution across percentage ranges with counts, share of the class and a bar chart.'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-range-bar', title: 'Students per Performance Range', sub: 'Overall percentage from the existing calculation engine', icon: 'bar-chart-3', type: 'bar', half: false,
        opts: { items: buckets.map(b => ({ label: b.label, value: b.count, color: b.color, sub: PStr.fmt(b.pct) + ' of assessed' })), title: 'Performance ranges' } }
    ],
    tables: [
      { title: 'Range Summary', icon: 'list-checks', cols: ['Performance Range', 'Students', '% of Assessed'], centerCols: [1, 2],
        rows: rangeRows.concat([[PStr.esc('Total'), assessed.length, PStr.fmt(100)]]) },
      { title: 'Students in each Performance Range', icon: 'users', cols: studentCols, centerCols: [4, 6], rows: studentRows }
    ]
  };
}

function psrRangeFallback() {
  return [
    { label: '80–100%', shortLabel: '80–100%', min: 80, max: 100, grade: 'A', descriptor: 'Excellent', isPass: true, color: '#166534' },
    { label: '75–79%', shortLabel: '75–79%', min: 75, max: 79, grade: 'B', descriptor: 'Very Good', isPass: true, color: '#15803d' },
    { label: '70–74%', shortLabel: '70–74%', min: 70, max: 74, grade: 'C', descriptor: 'Good', isPass: true, color: '#166534' },
    { label: '65–69%', shortLabel: '65–69%', min: 65, max: 69, grade: 'D', descriptor: 'Satisfactory', isPass: true, color: '#854d0e' },
    { label: '60–64%', shortLabel: '60–64%', min: 60, max: 64, grade: 'E', descriptor: 'Adequate', isPass: true, color: '#92400e' },
    { label: '50–59%', shortLabel: '50–59%', min: 50, max: 59, grade: 'S', descriptor: 'Minimum Pass', isPass: true, color: '#92400e' },
    { label: '0–49%', shortLabel: '0–49%', min: 0, max: 49, grade: 'F', descriptor: 'Fail', isPass: false, color: '#991b1b' }
  ];
}

/* ---------- Report 3: Students Requiring Academic Support ---------- */

function psrSupportModel() {
  const d = psrData;
  const ctx = psrCtx;
  const passMark = d.kpis.passMark;
  if (!d.learners.length) {
    return { prompt: { title: 'No learners assessed', msg: 'No assessed students were found for the selected filters.' } };
  }

  // Use GradingEngine to determine pass/fail instead of just passMark
  const scale = ctx.scale || [];

  const posByAssessment = {};
  psrRaw.assessments.forEach(a => {
    const ms = psrRaw.marks.filter(m => m.assessment_id === a.id && m.mark != null && m.mark !== '')
      .map(m => ({ id: m.learner_id, pct: AnalyticsEngine.pctFor(m.mark, a) }))
      .filter(x => x.pct != null)
      .sort((x, y) => y.pct - x.pct);
    const map = {};
    let p = 1;
    ms.forEach((s, i) => { if (i > 0 && s.pct < ms[i - 1].pct) p = i + 1; map[s.id] = p; });
    posByAssessment[a.id] = map;
  });

  const entries = [];
  psrRaw.assessments.forEach(a => {
    psrRaw.marks.filter(m => m.assessment_id === a.id && m.mark != null && m.mark !== '').forEach(m => {
      const pct = AnalyticsEngine.pctFor(m.mark, a);
      if (pct == null) return;
      
      // Use GradingEngine to determine if this is a fail
      const gradeInfo = typeof GradingEngine !== 'undefined' && scale.length
        ? GradingEngine.calculateGradeSync(pct, scale)
        : { isPass: pct >= passMark, grade: Utils.grade(pct, scale) };
      
      if (gradeInfo.isPass) return;
      
      const l = ctx.learnerById(m.learner_id);
      if (!l) return;
      entries.push({
        name: l.full_name,
        code: l.learner_code || '-',
        className: l.class_id ? (ctx.classByName(l.class_id)?.name || '-') : '-',
        mark: m.mark,
        max: a.maximum_mark,
        pct,
        grade: gradeInfo.grade || m.grade || Utils.grade(pct, scale),
        pos: posByAssessment[a.id][m.learner_id],
        assessment: a.name || a.unit,
        subject: a._subject ? a._subject.name : '-',
        type: a._typeName,
        date: a.assessment_date
      });
    });
  });
  entries.sort((a, b) => a.pct - b.pct);

  const distinct = new Set(entries.map(e => e.name)).size;
  const shareOfAssessed = d.kpis.assessed ? PStr.round(distinct / d.kpis.assessed * 100) : 0;
  const avgEntry = entries.length ? PStr.round(entries.reduce((a, x) => a + x.pct, 0) / entries.length) : null;

  const kpis = [
    { label: 'Students Requiring Academic Support', value: distinct, icon: 'life-buoy', tone: 'amber', sub: 'Below the pass threshold (Grade F)' },
    { label: 'Support Entries', value: entries.length, icon: 'clipboard-list', tone: 'amber', sub: 'One entry per below-pass assessment mark' },
    { label: 'Share of Assessed', value: PStr.fmt(shareOfAssessed), icon: 'percent', tone: 'red' },
    { label: 'Support Entry Average', value: PStr.fmt(avgEntry), icon: 'calculator', tone: 'red' }
  ];

  const rows = entries.map(e => [
    `<span class="col-name">${PStr.esc(e.name)}</span>`, PStr.esc(e.code), PStr.esc(e.assessment), PStr.esc(e.subject), PStr.esc(e.type),
    `<span class="font-semibold">${e.mark}</span>`, e.max, `<span class="font-semibold">${PStr.round(e.pct)}%</span>`,
    psrGradeBadge(e.grade), e.pos ? '#' + e.pos : '-', PStr.esc(e.className), PStr.esc(e.date || '-')
  ]);

  const charts = entries.length && distinct
    ? [{ id: 'psr-support-pf', title: 'Students Needing Support vs Assessed', sub: 'Based on grading scale fail range', icon: 'circle-dot', type: 'donut', half: true,
        opts: { items: [{ label: 'Requiring support (Fail range)', value: distinct, color: '#f59e0b' }, { label: 'At or above pass threshold', value: Math.max(d.kpis.assessed - distinct, 0), color: '#16a34a' }], centerLabel: distinct + '', centerSub: 'students', title: 'Academic support' } }]
    : [];

  return {
    printHeader: psrReportHeader('STUDENTS REQUIRING ACADEMIC SUPPORT', 'Students in the fail range (Grade F) of the school grading scale, with mark, percentage, grade, position where available, assessment and subject.'),
    printSignature: psrReportSignature(),
    kpis,
    charts,
    tables: [
      { title: 'Academic Support List', icon: 'life-buoy', note: 'Fail range determined by school grading scale configuration',
        cols: ['Student', 'Student ID', 'Assessment', 'Subject', 'Type', 'Mark', 'Max', 'Percentage', 'Grade', 'Position', 'Class', 'Date'],
        centerCols: [5, 6, 7, 9, 11], rows }
    ]
  };
}

/* ---------- Report 4: Grade Distribution ---------- */

function psrGradesModel() {
  const d = psrData;
  const ctx = psrCtx;
  const passMark = d.kpis.passMark;
  if (!d.learners.length) {
    return { prompt: { title: 'No learners assessed', msg: 'No assessed students were found for the selected filters.' } };
  }

  // Use centralized GradingEngine for grade distribution
  const gradeDist = typeof GradingEngine !== 'undefined' && ctx.scale
    ? GradingEngine.getGradeDistribution(d.learners.map(l => l.grade).filter(Boolean), ctx.scale)
    : [];

  const assessed = d.learners.filter(l => l.pct != null);
  const used = gradeDist.filter(g => g.count > 0).length;
  const modal = gradeDist.reduce((a, b) => b.count > a.count ? b : a, gradeDist[0]);

  const kpis = [
    { label: 'Students Assessed', value: assessed.length, icon: 'users-round', tone: 'blue' },
    { label: 'Grade Bands Used', value: used, icon: 'graduation-cap', tone: 'purple', sub: 'of ' + gradeDist.length + ' configured' },
    { label: 'Modal Grade', value: modal ? PStr.esc(modal.grade) : '-', icon: 'medal', tone: 'green', sub: modal ? modal.count + ' students' : '' },
    { label: 'Pass Mark', value: PStr.round(passMark) + '%', icon: 'badge-check', tone: 'amber' }
  ];

  return {
    printHeader: psrReportHeader('GRADE DISTRIBUTION REPORT', 'Number and percentage of students in every grade of the school grading scale (loaded from the RMS-MIS database, never hard-coded).'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-grade-bar', title: 'Grade Distribution', sub: 'From grading_scales configuration', icon: 'bar-chart-3', type: 'bar', half: false,
        opts: { items: gradeDist.map(g => ({ label: 'Grade ' + g.grade, value: g.count, sub: g.descriptor || g.range, color: GradingEngine._rangeColor(g.grade) })), title: 'Grades' } }
    ],
    tables: [
      { title: 'Grade Distribution', icon: 'graduation-cap', note: 'Percentages are of students with a computed overall average',
        cols: ['Grade', 'Descriptor', 'Percentage Range', 'Students', '% of Assessed', 'Pass/Fail'], centerCols: [2, 3, 4],
        rows: gradeDist.map(g => [psrGradeBadge(g.grade), PStr.esc(g.descriptor), PStr.esc(g.range), g.count, PStr.fmt(g.percentage), g.isPass ? '<span class="badge badge-success">Pass</span>' : '<span class="badge badge-danger">Fail</span>']).concat([['<span class="font-semibold">Total</span>', '', '', assessed.length, PStr.fmt(100), '']]) }
    ]
  };
}

/* ---------- Report 5: Assessment Analysis & Comparison ---------- */

function psrComparisonModel() {
  const ctx = psrCtx;
  const passMark = psrData.kpis.passMark;
  const all = psrRaw.assessments;
  const selected = all.filter(a => psrState.cmp[a.id] !== false);
  if (!selected.length) {
    return { prompt: { title: 'No assessments selected', msg: 'Select at least one assessment using the checkboxes above (they compare automatically).' } };
  }

  const stats = selected.map(a => {
    const ms = psrRaw.marks.filter(m => m.assessment_id === a.id);
    const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, a)).filter(p => p != null);
    return {
      id: a.id,
      name: a.name || a.unit,
      type: a._typeName,
      weight: a._effWeight,
      max: Number(a.maximum_mark) || 0,
      date: a.assessment_date,
      avg: PStr.round(valid.length ? valid.reduce((x, y) => x + y, 0) / valid.length : 0),
      high: valid.length ? PStr.round(Math.max(...valid)) : null,
      low: valid.length ? PStr.round(Math.min(...valid)) : null,
      passRate: PStr.round(valid.length ? valid.filter(p => p >= passMark).length / valid.length * 100 : 0),
      count: valid.length
    };
  });
  stats.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.name).localeCompare(String(b.name)));

  const involved = new Set();
  selected.forEach(a => psrRaw.marks.filter(m => m.assessment_id === a.id && m.mark != null).forEach(m => involved.add(m.learner_id)));
  const overallAvg = stats.length ? PStr.round(stats.reduce((a, s) => a + s.avg, 0) / stats.length) : 0;
  const best = stats.reduce((a, b) => b.avg > a.avg ? b : a, stats[0]);

  const chips = all.map(a => {
    const on = psrState.cmp[a.id] !== false;
    return `<label class="cmp-chip ${on ? 'on' : ''}"><input type="checkbox" ${on ? 'checked' : ''} onchange="psrToggleCmp('${a.id}', this.checked)">${PStr.esc(a.name || a.unit)}<span class="text-muted">${PStr.esc(a._typeName)}</span></label>`;
  }).join('');

  const kpis = [
    { label: 'Assessments Compared', value: selected.length, icon: 'git-compare', tone: 'blue' },
    { label: 'Learners Involved', value: involved.size, icon: 'users-round', tone: 'purple' },
    { label: 'Average Across Assessments', value: PStr.fmt(overallAvg), icon: 'calculator', tone: 'blue' },
    { label: 'Best Performing', value: PStr.esc(best.name), icon: 'medal', tone: 'green', sub: PStr.fmt(best.avg) + ' average' }
  ];

  return {
    printHeader: psrReportHeader('ASSESSMENT ANALYSIS & COMPARISON REPORT', 'Comparison of multiple assessments for the selected class and subject on average, highest / lowest mark, pass rate and number assessed.'),
    printSignature: psrReportSignature(),
    kpis,
    chips,
    charts: [
      { id: 'psr-cmp-line', title: 'Performance Trend Across Assessments', sub: 'Chronological order by assessment date', icon: 'line-chart', type: 'line', half: false,
        opts: { labels: stats.map(s => s.name), series: [{ name: 'Average %', values: stats.map(s => s.avg) }, { name: 'Pass Rate %', values: stats.map(s => s.passRate) }], title: 'Assessment comparison' } }
    ],
    tables: [
      { title: 'Assessment Comparison', icon: 'git-compare', note: 'All statistics computed from the actual marks in the database',
        cols: ['Assessment', 'Type', 'Weight', 'Max Mark', 'Date', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Assessed'],
        centerCols: [2, 3, 5, 6, 7, 8, 9],
        rows: stats.map(s => [PStr.esc(s.name), PStr.esc(s.type), s.weight != null ? PStr.round(s.weight) : '-', s.max, PStr.esc(s.date || '-'), PStr.fmt(s.avg), PStr.fmt(s.high), PStr.fmt(s.low), PStr.fmt(s.passRate), s.count]) }
    ]
  };
}

/* ============================================================
   Export: Excel and Print / PDF
   ============================================================ */

function psrPrint() {
  document.body.classList.add('printing-report', 'psr-printing');
  setTimeout(() => { window.print(); }, 80);
}
document.addEventListener('afterprint', function onAfterPrint() {
  document.body.classList.remove('printing-report', 'psr-printing');
});

function psrExcelSheets() {
  const d = psrData;
  const ctx = psrCtx;
  const passMark = d.kpis.passMark;
  const sheets = [];
  const meta = psrScopeMeta();

  const subjectStats = psrRaw.assessments.map(a => {
    const ms = psrRaw.marks.filter(m => m.assessment_id === a.id);
    const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, a)).filter(p => p != null);
    return { name: a.name || a.unit, type: a._typeName, max: a.maximum_mark, weight: a._effWeight,
      avg: valid.length ? PStr.round(valid.reduce((x, y) => x + y, 0) / valid.length) : null,
      high: valid.length ? PStr.round(Math.max(...valid)) : null, low: valid.length ? PStr.round(Math.min(...valid)) : null,
      passRate: valid.length ? PStr.round(valid.filter(p => p >= passMark).length / valid.length * 100) : null,
      count: valid.length };
  });

  if (psrState.report === '1' || psrState.report === '2' || psrState.report === '3' || psrState.report === '4') {
    const kpis = [
      ['Students Assessed', d.kpis.assessed], ['Overall Average %', d.kpis.overall], ['Highest Average %', d.kpis.highest],
      ['Lowest Average %', d.kpis.lowest], ['Pass Rate %', d.kpis.passRate], ['Fail Rate %', d.kpis.failRate],
      ['Pass Mark %', d.kpis.passMark]
    ];
    sheets.push({ name: 'Summary', head: ['Metric', 'Value'], rows: kpis });
  }

  if (psrState.report === '1') {
    sheets.push({
      name: 'Students', head: ['#', 'Student ID', 'Student Name', 'Gender'].concat(psrRaw.assessments.map(a => (a.name || a.unit) + ' (%)')).concat(['Overall %', 'Grade', 'Result', 'Position']),
      rows: d.learners.map((l, i) => {
        const row = [i + 1, l.code, l.name, l.gender];
        psrRaw.assessments.forEach(a => { const v = l.assessmentPct ? l.assessmentPct[a.id] : null; row.push(v != null ? PStr.round(v) : 'N/R'); });
        row.push(l.pct != null ? PStr.round(l.pct) : 'N/R', l.grade, l.pf, l.position || '-');
        return row;
      })
    });
    sheets.push({ name: 'Assessment Stats', head: ['Assessment', 'Type', 'Max', 'Weight', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Assessed'],
      rows: subjectStats.map(s => [s.name, s.type, s.max, s.weight != null ? s.weight : '-', s.avg, s.high, s.low, s.passRate, s.count]) });
    sheets.push({ name: 'Grade Distribution', head: ['Grade', 'Students', '% of Assessed'],
      rows: d.gradeRows.map(g => [g.label, g.value, d.kpis.assessed ? PStr.round(g.value / d.kpis.assessed * 100) : 0]) });
  }

  if (psrState.report === '2') {
    const ranges = [
      { label: '90-100%', min: 90, max: 100 }, { label: '80-89%', min: 80, max: 89 },
      { label: '70-79%', min: 70, max: 79 }, { label: '60-69%', min: 60, max: 69 },
      { label: '50-59%', min: 50, max: 59 }, { label: '0-49%', min: 0, max: 49 }
    ];
    const assessed = d.learners.filter(l => l.pct != null);
    const bucketRows = ranges.map(r => {
      const inRange = assessed.filter(l => l.pct >= r.min && l.pct <= r.max);
      return { label: r.label, list: inRange.map(l => [l.name, l.code, l.className, PStr.round(l.pct), l.grade, l.pf]) };
    });
    sheets.push({ name: 'Range Summary', head: ['Range', 'Students', '% of Assessed'],
      rows: bucketRows.map(b => [b.label, b.list.length, assessed.length ? PStr.round(b.list.length / assessed.length * 100) : 0]) });
  }

  if (psrState.report === '3') {
    const rows = [];
    psrRaw.assessments.forEach(a => {
      psrRaw.marks.filter(m => m.assessment_id === a.id && m.mark != null && m.mark !== '').forEach(m => {
        const pct = AnalyticsEngine.pctFor(m.mark, a);
        if (pct == null || pct >= passMark) return;
        const l = ctx.learnerById(m.learner_id);
        if (!l) return;
        rows.push([l.full_name, l.learner_code || '-', a.name || a.unit, a._subject ? a._subject.name : '-', m.mark, a.maximum_mark, PStr.round(pct), m.grade || Utils.grade(pct, ctx.scale), a.assessment_date || '']);
      });
    });
    rows.sort((a, b) => a[6] - b[6]);
    sheets.push({ name: 'Academic Support', head: ['Student', 'Student ID', 'Assessment', 'Subject', 'Mark', 'Max', '%', 'Grade', 'Date'], rows });
  }

  if (psrState.report === '4') {
    const scale = [...ctx.scale].sort((a, b) => Number(b.minimum_percentage) - Number(a.minimum_percentage));
    const assessed = d.learners.filter(l => l.pct != null);
    sheets.push({ name: 'Grade Distribution', head: ['Grade', 'Range %', 'Students', '% of Assessed', 'Remark'],
      rows: scale.map(g => {
        const c = assessed.filter(l => (l.grade || '') === g.grade).length;
        return [g.grade, g.minimum_percentage + '-' + g.maximum_percentage, c, assessed.length ? PStr.round(c / assessed.length * 100) : 0, g.remark || ''];
      }) });
  }

  if (psrState.report === '5') {
    const selected = psrRaw.assessments.filter(a => psrState.cmp[a.id] !== false);
    const rows = selected.map(a => {
      const ms = psrRaw.marks.filter(m => m.assessment_id === a.id);
      const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, a)).filter(p => p != null);
      return [a.name || a.unit, a._typeName, a._effWeight != null ? a._effWeight : '-', a.maximum_mark, a.assessment_date || '-',
        valid.length ? PStr.round(valid.reduce((x, y) => x + y, 0) / valid.length) : 'N/R',
        valid.length ? PStr.round(Math.max(...valid)) : 'N/R', valid.length ? PStr.round(Math.min(...valid)) : 'N/R',
        valid.length ? PStr.round(valid.filter(p => p >= passMark).length / valid.length * 100) : 'N/R', valid.length];
    });
    sheets.push({ name: 'Comparison', head: ['Assessment', 'Type', 'Weight', 'Max', 'Date', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Assessed'], rows });
  }

  sheets.forEach(s => { s.row0 = ['RMS-MIS Post-Assessment Report', s.name]; });
  return { sheets, meta };
}

function psrExportExcel() {
  if (!psrData) return Utils.toast('No report to export', 'error');
  if (typeof XLSX === 'undefined') return Utils.toast('Excel export library not loaded', 'error');
  const { sheets, meta } = psrExcelSheets();
  const wb = XLSX.utils.book_new();
  const scopeLine = [meta.className, meta.subjectName, meta.yearName, meta.termName].filter(Boolean).join(' - ') || 'All scope';
  sheets.forEach(s => {
    const aoa = [
      ['RMS-MIS'], ['Post-Assessment Report - ' + s.name], ['Scope: ' + scopeLine], ['Generated: ' + new Date().toLocaleString()], [],
      s.head
    ];
    s.rows.forEach(r => aoa.push(r));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), s.name.slice(0, 28));
  });
  const fname = 'rms-post-assessment-' + psrState.report + '-' + new Date().toISOString().slice(0, 10) + '.xlsx';
  XLSX.writeFile(wb, fname);
  Utils.toast('Excel export downloaded', 'success');
}