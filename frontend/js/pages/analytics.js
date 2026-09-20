/* ============================================================
   PERFORMANCE & ANALYTICS
   DOS/Admin dashboard + restricted teacher analytics.
   Uses the existing RMS-MIS calculation engine (weighted grades,
   pass/fail from school settings, grading scales) and the in-house
   SVG chart module RMSCharts. All figures are computed from the
   database; no static or decorative charts.
   ============================================================ */

function renderAnalytics() { analyticsRefresh(false); }
function renderTeacherAnalytics() { analyticsRefresh(true); }

let analyticsState = {
  yearId: '', termId: '', classId: '', stream: 'all', subjectId: '',
  typeId: '', assessmentId: '', studentId: '', teacherId: '', status: 'official',
  limit: 10, metric: 'avg', compare: 'none'
};
let analyticsIsTeacher = false;
let analyticsData = null;
let analyticsBusy = false;

const AStrs = {
  esc(v) { return Utils.escapeHtml(v == null ? '' : String(v)); },
  num(x) { return (x == null || isNaN(x)) ? 0 : Number(x); },
  round(x, d) {
    const p = Math.pow(10, d == null ? 1 : d);
    return Math.round(AStrs.num(x) * p) / p;
  },
  fmt(x) { return x == null || isNaN(x) ? 'N/A' : AStrs.round(x) + '%'; },
  icon(name) { return `<i data-lucide="${name}" style="width:18px;height:18px;vertical-align:middle;margin-right:8px"></i>`; },
  badge(pct, passMark) {
    const p = AStrs.num(pct);
    const ok = p >= passMark;
    return `<span class="badge ${ok ? 'badge-green' : 'badge-red'}"><i data-lucide="${ok ? 'check-circle-2' : 'x-circle'}" style="width:12px;height:12px;vertical-align:middle;margin-right:3px"></i>${ok ? 'PASS' : 'FAIL'}</span>`;
  },
  targetChip(pct, target) {
    const p = AStrs.num(pct);
    const ok = p >= target;
    return `<span class="badge ${ok ? 'badge-gray' : 'badge-amber'}">Target ${ok ? 'met' : 'below'} (${AStrs.round(target)}%)</span>`;
  }
};

function analyticsStat(label, value, icon, tone, sub) {
  return `<div class="stat-card">
    <div class="stat-icon" style="background:var(--${tone}-50);color:var(--${tone}-600)"><i data-lucide="${icon}"></i></div>
    <div class="stat-value">${AStrs.esc(value)}</div>
    <div class="stat-label">${AStrs.esc(label)}</div>
    ${sub ? `<div class="stat-sub">${AStrs.esc(sub)}</div>` : ''}
  </div>`;
}

function analyticsSelect(prop, opts, current) {
  return `<select class="select-field" id="af-${prop}" onchange="analyticsSetFilter('${prop}', this.value)">
    ${opts.map(o => `<option value="${AStrs.esc(o.value)}" ${String(o.value) === String(current) ? 'selected' : ''}>${AStrs.esc(o.label)}</option>`).join('')}
  </select>`;
}

function analyticsField(label, html) {
  return `<label class="af-field"><span>${AStrs.esc(label)}</span>${html}</label>`;
}

function analyticsChips(filters, ctx) {
  const parts = [];
  const add = (k) => { if (filters[k] && filters[k] !== 'all') parts.push(k); };
  add('yearId'); add('termId'); add('classId'); add('stream'); add('subjectId'); add('typeId');
  if (analyticsIsTeacher) { if (ctx.assignments && ctx.assignments.length) parts.push('scoped'); }
  else add('teacherId');
  const list = [];
  if (ctx.yearById(filters.yearId)) list.push(ctx.yearById(filters.yearId).name);
  if (ctx.termById(filters.termId)) list.push(ctx.termById(filters.termId).name);
  if (ctx.classByName(filters.classId)) list.push(ctx.classByName(filters.classId).name);
  if (filters.stream && filters.stream !== 'all') list.push('Stream ' + filters.stream);
  if (ctx.subjectById(filters.subjectId)) list.push(ctx.subjectById(filters.subjectId).name);
  if (filters.typeId && filters.typeId !== 'all') { const t = ctx.types.find(x => x.id === filters.typeId); if (t) list.push(t.name); }
  if (filters.teacherId && filters.teacherId !== 'all') { const t = ctx.teacherById(filters.teacherId); if (t) list.push('Teacher: ' + t.full_name); }
  return list.length ? `Showing: <strong>${list.map(AStrs.esc).join(' &bull; ')}</strong>` : 'Showing: <strong>Whole school (all records)</strong>';
}

async function analyticsRefresh(isTeacher) {
  analyticsIsTeacher = isTeacher;
  if (analyticsBusy) return;
  analyticsBusy = true;
  setHeader(isTeacher ? 'My Analytics' : 'Performance & Analytics',
    isTeacher ? 'Performance insights for your assigned classes and subjects only' : 'Dynamic, database-driven school performance analytics');
  setContent(Utils.loading());
  try {
    AnalyticsEngine.resetContext();
    const ctx = await AnalyticsEngine.context(analyticsState, isTeacher);
    if (!analyticsState.yearId) {
      if (isTeacher) {
        const yrs = [...new Set((ctx.assignments || []).map(a => a.academic_year_id).filter(Boolean))];
        analyticsState.yearId = yrs.length ? yrs[0] : (ctx.years.find(y => y.status === 'active')?.id || 'all');
      } else {
        analyticsState.yearId = (typeof getActiveYearId === 'function' ? getActiveYearId(ctx.years) : null)
          || (ctx.years.find(y => y.status === 'active')?.id || 'all');
      }
    }

    const ddFilter = { ...analyticsState, assessmentId: 'all', studentId: 'all' };
    const dd = await AnalyticsEngine.load(ddFilter, ctx, isTeacher);
    const assessmentsList = dd.assessments;

    const fat = await AnalyticsEngine.load(analyticsState, ctx, isTeacher);
    const data = AnalyticsEngine.compute(analyticsState, ctx, fat, isTeacher);
    let contextData = null;
    if (analyticsState.studentId && analyticsState.studentId !== 'all') {
      const conFat = await AnalyticsEngine.load(ddFilter, ctx, isTeacher);
      contextData = AnalyticsEngine.compute(ddFilter, ctx, conFat, isTeacher);
    }
    data._context = contextData;
    data._assessmentsList = assessmentsList;
    analyticsData = data;

    analyticsRenderPage(data, ctx, assessmentsList);
  } catch (e) {
    console.error('[analytics]', e);
    setContent(`<div class="card"><div class="card-body" style="padding:40px;text-align:center">
      <i data-lucide="alert-triangle" style="width:36px;height:36px;color:var(--red-500);margin-bottom:12px"></i>
      <h3>Unable to load analytics</h3>
      <p style="color:var(--gray-500);margin:8px 0 16px">${AStrs.esc(e.message || 'An unexpected error occurred.')}</p>
      <button class="btn btn-primary" onclick="analyticsRefresh(analyticsIsTeacher)"><i data-lucide="refresh-cw"></i> Retry</button>
    </div></div>`);
    Utils.toast(e.message || 'Failed to load analytics', 'error');
  } finally {
    analyticsBusy = false;
  }
}

async function analyticsRenderPage(data, ctx, assessmentsList) {
  const isT = analyticsIsTeacher;
  const k = data.kpis;
  const hasData = data.learners.length > 0 && (k.assessments > 0 || k.assessed > 0);

  /* ----- Filter panel options ----- */
  let classRows = isT
    ? (ctx.assignments || [])
    : ctx.classes;
  if (analyticsState.yearId && analyticsState.yearId !== 'all') {
    classRows = classRows.filter(c => c.academic_year_id === analyticsState.yearId);
  }
  const classNames = new Map();
  classRows.forEach(c => classNames.set(c.id, c));
  const allAssignClassIds = new Set((ctx.assignments || []).map(a => a.class_id));
  if (isT) {
    allAssignClassIds.forEach(id => {
      const c = ctx.classByName(id);
      if (c) classNames.set(id, c);
    });
  }
  const classOpts = [...classNames.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  let subjectOpts = [];
  if (isT) {
    const subIds = new Set((ctx.assignments || []).map(a => a.subject_id));
    subjectOpts = ctx.subjects.filter(s => subIds.has(s.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } else {
    subjectOpts = ctx.subjects.filter(s => !s.status || s.status === 'active').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  const streams = [...new Set(classOpts.map(c => c.stream).filter(Boolean))].sort();

  let termsOpts = ctx.terms;
  if (analyticsState.yearId && analyticsState.yearId !== 'all') {
    termsOpts = termsOpts.filter(t => t.academic_year_id === analyticsState.yearId);
  }
  termsOpts = [...termsOpts].sort((a, b) => (AStrs.num(a.term_no) - AStrs.num(b.term_no)) || String(a.name).localeCompare(String(b.name)));

  const typeOpts = ctx.types;
  const teacherOpts = isT ? [] : [...ctx.teachers].filter(t => !t.status || t.status === 'active').sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));

  const assessOpts = assessmentsList.map(a => ({ value: a.id, label: (a._subject?.name || '') + ' - ' + a.name + (a._term ? ' (' + a._term.name + ')' : '') }));
  const learnerOpts = data.learners.map(l => ({ value: l.id, label: l.name + (l.className ? ' (' + l.className + ')' : '') }));

  const statusOpts = [
    { value: 'official', label: 'Official (Approved + Locked)' },
    { value: 'all', label: 'All Assessments' },
    { value: 'pending', label: 'Pending Approval' },
    { value: 'approved', label: 'Approved' },
    { value: 'locked', label: 'Locked' },
    { value: 'rejected', label: 'Rejected' }
  ];
  const metricOpts = [
    { value: 'avg', label: 'Average %' },
    { value: 'passRate', label: 'Pass Rate %' },
    { value: 'count', label: 'Records' }
  ];
  const compareOpts = [
    { value: 'none', label: 'No comparison' },
    { value: 'class', label: 'Compare by Class' },
    { value: 'type', label: 'Compare by Assessment Type' }
  ];
  const limitOpts = [
    { value: '5', label: 'Top / Bottom 5' },
    { value: '10', label: 'Top / Bottom 10' },
    { value: '15', label: 'Top / Bottom 15' },
    { value: '20', label: 'Top / Bottom 20' },
    { value: 'all', label: 'All students' }
  ];

  const s = analyticsState;
  const fields = [];
  fields.push(analyticsField('Academic Year', analyticsSelect('yearId', [{ value: 'all', label: 'All Years' }].concat(ctx.years.map(y => ({ value: y.id, label: y.name + (y.is_current ? ' (Current)' : '') }))), s.yearId)));
  fields.push(analyticsField('Term', analyticsSelect('termId', [{ value: 'all', label: 'All Terms' }].concat(termsOpts.map(t => ({ value: t.id, label: t.name }))), s.termId)));
  fields.push(analyticsField('Class', analyticsSelect('classId', [{ value: 'all', label: 'All Classes' }].concat(classOpts.map(c => ({ value: c.id, label: c.name }))), s.classId)));
  fields.push(analyticsField('Stream', analyticsSelect('stream', [{ value: 'all', label: 'All Streams' }].concat(streams.map(x => ({ value: x, label: 'Stream ' + x }))), s.stream)));
  fields.push(analyticsField('Subject', analyticsSelect('subjectId', [{ value: 'all', label: 'All Subjects' }].concat(subjectOpts.map(x => ({ value: x.id, label: x.name }))), s.subjectId)));
  fields.push(analyticsField('Assessment Type', analyticsSelect('typeId', [{ value: 'all', label: 'All Types' }].concat(typeOpts.map(x => ({ value: x.id, label: x.name }))), s.typeId)));
  fields.push(analyticsField('Assessment', analyticsSelect('assessmentId', [{ value: 'all', label: 'All Assessments' }].concat(assessOpts.length ? assessOpts : [{ value: 'none', label: 'No assessments in scope' }]), s.assessmentId)));
  fields.push(analyticsField('Student', analyticsSelect('studentId', [{ value: 'all', label: 'All Students' }].concat(learnerOpts.length ? learnerOpts : [{ value: 'none', label: 'No assessed students in scope' }]), s.studentId)));
  if (!isT) fields.push(analyticsField('Teacher', analyticsSelect('teacherId', [{ value: 'all', label: 'All Teachers' }].concat(teacherOpts.map(x => ({ value: x.id, label: x.full_name }))), s.teacherId)));
  fields.push(analyticsField('Status', analyticsSelect('status', statusOpts, s.status)));
  fields.push(analyticsField('Metric', analyticsSelect('metric', metricOpts, s.metric)));
  fields.push(analyticsField('Comparison', analyticsSelect('compare', compareOpts, s.compare)));
  fields.push(analyticsField('Performers List', analyticsSelect('limit', limitOpts, s.limit)));

  /* ----- Export / target bar ----- */
  const targetCtl = isT ? '' : `<div class="analysis-tool">
    <label for="ast-target">Target (%)</label>
    <input class="input-field" id="ast-target" type="number" min="1" max="100" value="${AnalyticsEngine.target()}" style="width:84px" onchange="analyticsSetTarget(this.value)" title="Performance target used by insights, status indicators and the support list">
  </div>`;
  const exportBar = `<div class="analysis-bar">
    <div class="analysis-tools">
      ${targetCtl}
      <button class="btn btn-secondary" onclick="analyticsExportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
      <button class="btn btn-secondary" onclick="analyticsPrint()"><i data-lucide="printer"></i> Print / PDF</button>
    </div>
  </div>`;

  const scopeNote = `<div class="analytics-scope">${analyticsChips(s, ctx)} &middot; Status: <strong>${(statusOpts.find(x => x.value === s.status) || {}).label || s.status}</strong></div>`;

  /* ----- Student-focused mode ----- */
  const student = s.studentId && s.studentId !== 'all' ? data.learners[0] : null;
  let sections = '';
  if (student) {
    sections = analyticsStudentSections(student, data, ctx);
  } else if (!hasData) {
    sections = analyticsEmptySections();
  } else {
    sections = analyticsAggregateSections(data);
  }

  setContent(`<div class="analytics-page">
    <div class="card mb-6">
      <div class="card-header analytics-card-header">
        <h3><i data-lucide="sliders-horizontal"></i> Filters</h3>
        <div class="analytics-header-actions">
          <button class="btn btn-sm btn-secondary" onclick="analyticsClearFilters()"><i data-lucide="rotate-ccw"></i> Reset Filters</button>
          ${s.assessmentId !== 'all' ? `<button class="btn btn-sm btn-secondary" onclick="analyticsSetFilter('assessmentId','all')"><i data-lucide="x"></i> Clear Assessment</button>` : ''}
        </div>
      </div>
      <div class="filters-grid">${fields.join('')}</div>
      ${scopeNote}
    </div>
    ${exportBar}
    ${sections}
  </div>`);
  analyticsDrawCharts(data);
}

function analyticsEmptySections() {
  return `<div class="card"><div class="card-body" style="padding:48px;text-align:center">
    <i data-lucide="bar-chart-3" style="width:40px;height:40px;color:var(--gray-300);margin-bottom:12px"></i>
    <h3>No data for the selected filters</h3>
    <p style="color:var(--gray-500);max-width:420px;margin:8px auto 0">Try widening the academic year, term, class, stream or subject, or change the assessment status. Missing or unassessed records are never counted as zero.</p>
  </div></div>`;
}

function analyticsAggregateSections(data) {
  const k = data.kpis;
  const isT = analyticsIsTeacher;
  const metric = analyticsState.metric;

  const kpiCards = [
    analyticsStat('Assessed Students', k.assessed, 'users-round', 'blue'),
    analyticsStat('Subjects', k.subjects, 'book-open', 'purple'),
    analyticsStat('Assessments', k.assessments, 'clipboard-check', 'amber'),
    analyticsStat('Overall Average', AStrs.fmt(k.overall), 'calculator', 'blue'),
    analyticsStat('Pass Rate', AStrs.fmt(k.passRate), 'badge-check', 'green', `Pass mark ${AStrs.round(k.passMark)}%`),
    analyticsStat('Highest Average', AStrs.fmt(k.highest), 'trending-up', 'green'),
    analyticsStat('Lowest Average', AStrs.fmt(k.lowest), 'trending-down', 'red'),
    analyticsStat('At / Above Target', k.aboveTarget, 'target', 'green', `Target ${AStrs.round(k.target)}%`),
    analyticsStat('Below Target', k.belowTarget, 'flag', 'amber', 'Needs attention'),
    analyticsStat('Pass : Fail', `${k.passed} : ${k.failed}`, 'scale', 'purple')
  ];
  const kpiGrid = `<section class="mb-6"><div class="grid-4">${kpiCards.join('')}</div></section>`;

  const studentDrill = `<p class="text-sm text-muted" style="margin:4px 0 12px">Click any chart or table row to drill into a student, subject, assessment or class.</p>`;

  const overviewCard = `<div class="card mb-6 mt-6">
    <div class="card-header"><h3>${AStrs.icon('pie-chart')}Overall Performance</h3>
      <span class="text-sm text-muted">${analyticsState.assessmentId !== 'all' ? 'Selected assessment - individual student scores' : (analyticsState.termId !== 'all' ? 'Selected term - assessment averages' : 'Term progression')}</span>
    </div>
    <div id="chart-overview" class="chart-box"></div></div>`;

  const passFailCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('circle-dot')}Pass / Fail</h3>
      <span class="text-sm text-muted">Pass mark ${AStrs.round(k.passMark)}%</span></div>
    <div id="chart-passfail" class="chart-box"></div></div>`;

  const trendCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('line-chart')}Performance Trend</h3>
      <span class="text-sm text-muted">${analyticsState.compare !== 'none' ? 'Comparison: ' + (analyticsState.compare === 'class' ? 'by class' : 'by assessment type') : 'Average percentage over time'}</span></div>
    <div id="chart-trend" class="chart-box"></div></div>`;

  const gradeCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('graduation-cap')}Grade Distribution</h3>
      <span class="text-sm text-muted">From the RMS-MIS grading scale</span></div>
    <div id="chart-grades" class="chart-box"></div></div>`;

  const typeCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('tags')}Assessment Type Performance</h3>
      <span class="text-sm text-muted">Configured in Assessment Types</span></div>
    <div id="chart-types" class="chart-box"></div></div>`;

  const subjectCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('book-marked')}Performance by ${analyticsState.compare === 'type' ? 'Subject and Type' : 'Subject'}</h3></div>
    <div id="chart-subjects" class="chart-box"></div></div>`;

  const assessCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('clipboard-list')}Performance by Assessment</h3>
      <span class="text-sm text-muted">Chronological order; click a bar to isolate one assessment</span></div>
    <div id="chart-assessments" class="chart-box"></div></div>`;

  const classCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('school')}Class Comparison</h3>
      <span class="text-sm text-muted">${metric === 'avg' ? 'Average percentage' : metric === 'passRate' ? 'Pass rate' : 'Number of assessed records'}</span></div>
    <div id="chart-classes" class="chart-box"></div></div>`;

  const heatCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('grid-3x3')}Class &times; Subject Heatmap</h3>
      <span class="text-sm text-muted">Colour scale: green 70%+, yellow 50-69%, red below 50%</span></div>
    <div id="chart-heatmap" class="chart-box"></div></div>`;

  const teacherCard = isT ? '' : `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('users')}Teacher / Subject Analytics</h3>
      <span class="text-sm text-muted">Descriptive summary - not a ranking</span></div>
    <div id="ana-teachers" class="chart-box"></div></div>`;

  const topCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('medal')}Top Performers</h3></div>
    <div id="ana-top" class="table-box"></div></div>`;

  const bottomCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('life-buoy')}Students Requiring Additional Academic Support</h3></div>
    <div id="ana-bottom" class="table-box"></div></div>`;

  const matrixCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('table')}Detailed Performance Matrix</h3>
      <span class="text-sm text-muted">Weighted learner percentage per subject - click a row for student analytics</span></div>
    <div id="ana-table" class="table-box"></div></div>`;

  const insightCard = `<div class="card mb-6">
    <div class="card-header"><h3>${AStrs.icon('lightbulb')}Automatic Insights</h3></div>
    <div id="ana-insights" class="insights-box"></div></div>`;

  const hint = `<div class="analytics-hint">${studentDrill}</div>`;

  const wrap = `<section class="grid-2">${overviewCard}${passFailCard}</section>
    ${hint}
    ${trendCard}
    <section class="grid-2">${gradeCard}${typeCard}</section>
    ${subjectCard}
    ${assessCard}
    ${classCard}
    ${heatCard}
    ${teacherCard}
    <section class="grid-2">${topCard}${bottomCard}</section>
    ${matrixCard}
    ${insightCard}`;
  return kpiGrid + wrap;
}

function analyticsStudentSections(student, data, ctx) {
  const k = data.kpis;
  const con = data._context;
  const s = analyticsState;

  const subUnion = new Set();
  Object.keys(student.subjectPct).forEach(sid => subUnion.add(sid));
  (con ? con.subjectPerf : []).forEach(x => subUnion.add(x.id));

  const profile = `
    <div class="grid-2 mb-6">
      <div class="card">
        <div class="card-header"><h3>${AStrs.icon('user')}${AStrs.esc(student.name)}</h3>
          <span class="text-sm text-muted">${AStrs.esc(student.code)} &middot; ${AStrs.esc(student.className)}</span></div>
        <div class="card-body" style="padding:16px 20px">
          <div class="grid-4">
            ${analyticsStat('Overall', AStrs.fmt(student.pct), 'calculator', student.pct != null && student.pct >= k.passMark ? 'green' : 'red')}
            ${analyticsStat('Grade', AStrs.esc(student.grade), 'graduation-cap', 'purple', AStrs.esc(Utils.remark(student.pct, ctx.scale)))}
            ${analyticsStat('Rank', student.position != null ? '#' + student.position + ' of ' + k.assessed : 'N/R', 'medal', 'blue')}
            ${analyticsStat('Status', student.pf, 'badge-check', student.passed ? 'green' : 'red', `Pass mark ${AStrs.round(k.passMark)}%`)}
          </div>
          <div class="mt-6">${AStrs.targetChip(student.pct, k.target)}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${AStrs.icon('circle-dot')}Pass / Fail &amp; Grade Mix</h3></div>
        <div class="card-body" style="padding:16px 20px">
          <div id="chart-student-grades" class="chart-box"></div>
        </div>
      </div>
    </div>
    <section class="grid-2 mb-6">
      <div class="card">
        <div class="card-header"><h3>${AStrs.icon('target')}Subject Performance vs ${con ? 'Scope Average' : 'Scope'}</h3></div>
        <div id="chart-student-subjects" class="chart-box"></div>
      </div>
      <div class="card">
        <div class="card-header"><h3>${AStrs.icon('line-chart')}Progression by Term</h3></div>
        <div id="chart-student-term" class="chart-box"></div>
      </div>
    </section>
    <div class="card mb-6">
      <div class="card-header"><h3>${AStrs.icon('clipboard-list')}Assessment Performance</h3>
        <span class="text-sm text-muted">Click a bar to view that assessment</span></div>
      <div id="chart-student-assess" class="chart-box"></div>
    </div>
    <div class="card mb-6">
      <div class="card-header"><h3>${AStrs.icon('table')}Individual Marks</h3></div>
      <div id="ana-student-marks" class="table-box"></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>${AStrs.icon('lightbulb')}Automatic Insights</h3></div>
      <div id="ana-insights" class="insights-box"></div>
    </div>`;

  return profile + `<button class="btn btn-sm btn-secondary mt-6" onclick="analyticsSetFilter('studentId','all')"><i data-lucide="arrow-left"></i> Back to aggregate view</button>`;
}

/* ---------- Chart + table drawing ---------- */

function analyticsClassAssessSeries(data) {
  const classNames = [...new Set(data.classPerf.map(c => c.name))];
  const color = RMSCharts.defaultColors();
  const series = classNames.map((name, i) => {
    const learnersIn = data.learners.filter(l => l.className === name);
    const values = data.assessmentPerf.map(a => {
      const ms = learnersIn.flatMap(l => l.marks.filter(m => m.assessment_id === a.id));
      const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, a)).filter(p => p != null);
      return valid.length ? AStrs.round(valid.reduce((x, y) => x + y, 0) / valid.length) : null;
    });
    return { name, values, color: color[i % color.length] };
  });
  return series.filter(s => s.values.some(v => v != null));
}

function analyticsTypeAssessSeries(data) {
  const typeNames = [...new Set(data.assessmentPerf.map(a => a.typeName))];
  const color = RMSCharts.defaultColors();
  const series = typeNames.map((name, i) => {
    const values = data.assessmentPerf.map(a => a.typeName === name ? a.avg : null);
    return { name, values, color: color[i % color.length] };
  });
  return series.filter(s => s.values.some(v => v != null));
}

function analyticsDrawCharts(data) {
  const k = data.kpis;
  const s = analyticsState;
  const passMark = k.passMark;
  const same = AStrs.round;

  const student = s.studentId && s.studentId !== 'all' ? data.learners[0] : null;
  if (student) {
    analyticsDrawStudent(student, data);
    analyticsDrawInsights(data.learners.length ? data.insights : [], data);
    return;
  }

  if (!data.learners.length && !data.assessments.length) return;

  /* Overview */
  const overviewEl = document.getElementById('chart-overview');
  if (overviewEl) {
    if (s.assessmentId && s.assessmentId !== 'all') {
      const aid = s.assessmentId;
      const pairs = data.learners
        .map(l => ({ l, v: l.assessmentPct ? l.assessmentPct[aid] : null }))
        .filter(p => p.v != null)
        .sort((a, b) => b.v - a.v);
      if (!pairs.length) RMSCharts.empty(overviewEl, 'No marks recorded for the selected assessment.');
      else RMSCharts.barChart(overviewEl, { items: pairs.map(p => ({ label: p.l.name, value: p.v, sub: p.l.className })), title: 'Individual student scores', onClick: (i) => analyticsOpenStudent(pairs[i].l.id) });
    } else if (s.termId && s.termId !== 'all') {
      const items = data.assessmentPerf.filter(a => a.termId === s.termId).map(a => ({ id: a.id, label: a.name, value: a.avg, sub: a.typeName }));
      if (!items.length) RMSCharts.empty(overviewEl, 'No assessments for the selected term.');
      else RMSCharts.barChart(overviewEl, { items, title: 'Assessment averages', onClick: (i, it) => { if (it && it.id) analyticsSetFilter('assessmentId', it.id); } });
    } else if (data.termPerf.length) {
      RMSCharts.lineChart(overviewEl, {
        labels: data.termPerf.map(t => t.name),
        series: [{ name: 'Average', values: data.termPerf.map(t => t.avg) }],
        title: 'Overall performance by term'
      });
    } else {
      const items = data.assessmentPerf.map(a => ({ id: a.id, label: a.name, value: a.avg, sub: a.typeName }));
      if (!items.length) RMSCharts.empty(overviewEl, 'No assessments found for this scope.');
      else RMSCharts.barChart(overviewEl, { items, title: 'Assessment averages', onClick: (i, it) => { if (it && it.id) analyticsSetFilter('assessmentId', it.id); } });
    }
  }

  /* Pass / Fail */
  const pfEl = document.getElementById('chart-passfail');
  if (pfEl) {
    const total = k.passed + k.failed;
    if (!total) RMSCharts.empty(pfEl, 'No assessed students.');
    else RMSCharts.donutChart(pfEl, {
      items: [
        { label: 'Pass', value: k.passed, color: '#16a34a' },
        { label: 'Fail', value: k.failed, color: '#dc2626' }
      ],
      centerLabel: AStrs.fmt(k.passRate), centerSub: 'pass rate',
      title: 'Pass / Fail distribution'
    });
  }

  /* Trend */
  const trendEl = document.getElementById('chart-trend');
  if (trendEl) {
    if (s.compare === 'class') {
      const series = analyticsClassAssessSeries(data);
      RMSCharts.groupBarChart(trendEl, { labels: data.assessmentPerf.map(a => a.name), series, title: 'Assessment trend by class' });
    } else if (s.compare === 'type') {
      const series = analyticsTypeAssessSeries(data);
      RMSCharts.groupBarChart(trendEl, { labels: data.assessmentPerf.map(a => a.name), series, title: 'Assessment trend by type' });
    } else if (data.termPerf.length > 1) {
      RMSCharts.lineChart(trendEl, {
        labels: data.termPerf.map(t => t.name),
        series: [{ name: 'Average %', values: data.termPerf.map(t => t.avg) }],
        title: 'Trend across terms'
      });
    } else {
      const items = data.assessmentPerf.map(a => ({ id: a.id, label: a.name, value: a.avg, sub: a.typeName }));
      if (!items.length) RMSCharts.empty(trendEl, 'No assessments for this scope.');
      else RMSCharts.barChart(trendEl, { items, title: 'Assessment progression', onClick: (i, it) => { if (it && it.id) analyticsSetFilter('assessmentId', it.id); } });
    }
  }

  /* Grades */
  const grEl = document.getElementById('chart-grades');
  if (grEl) {
    if (!data.gradeRows.length) RMSCharts.empty(grEl, 'No grades available.');
    else RMSCharts.barChart(grEl, {
      items: data.gradeRows.map(g => ({ label: 'Grade ' + g.label, value: g.value, sub: g.remark })),
      title: 'Grade distribution'
    });
  }

  /* Types */
  const tyEl = document.getElementById('chart-types');
  if (tyEl) {
    if (!data.typePerf.length) RMSCharts.empty(tyEl, 'No assessment types in scope.');
    else RMSCharts.barChart(tyEl, { items: data.typePerf.map(t => ({ label: t.name, value: t.avg, sub: t.count + ' mks' })), title: 'Average by assessment type' });
  }

  /* Subjects (optionally grouped by term or type) */
  const subEl = document.getElementById('chart-subjects');
  if (subEl) {
    if (s.compare === 'type') {
      const typeNames2 = [...new Set(data.assessmentPerf.map(a => a.typeName))];
      const color = RMSCharts.defaultColors();
      const series = typeNames2.map((name, i) => {
        const values = data.subjectPerf.map(sub => {
          const group = data.assessments.filter(a => a._subject?.name === sub.name && a._typeName === name);
          const ms = data.marks.filter(m => group.some(a => a.id === m.assessment_id));
          const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, group.find(a => a.id === m.assessment_id))).filter(p => p != null);
          return valid.length ? AStrs.round(valid.reduce((x, y) => x + y, 0) / valid.length) : null;
        });
        return { name, values, color: color[i % color.length] };
      });
      RMSCharts.groupBarChart(subEl, { labels: data.subjectPerf.map(su => su.name), series, title: 'Subject averages by type' });
    } else if (!data.subjectPerf.length) {
      RMSCharts.empty(subEl, 'No subject performance available.');
    } else {
      RMSCharts.barChart(subEl, {
        items: data.subjectPerf.map((x, i) => ({ label: x.name, value: analyticsMetricValue(x, s.metric), sub: x.count + ' marks' })),
        title: 'Subject performance',
        onClick: (i) => { const it = data.subjectPerf[i]; if (it) analyticsSetFilter('subjectId', it.id); }
      });
    }
  }

  /* Assessments */
  const asEl = document.getElementById('chart-assessments');
  if (asEl) {
    if (!data.assessmentPerf.length) RMSCharts.empty(asEl, 'No assessments in scope.');
    else RMSCharts.barChart(asEl, {
      items: data.assessmentPerf.map(a => ({ label: a.name, value: analyticsMetricValue(a, s.metric), sub: a.typeName + (a.weight ? ' (w ' + AStrs.round(a.weight) + ')' : '') })),
      title: 'Assessment performance',
      padBottom: 56,
      onClick: (i, it) => { if (it) analyticsSetFilter('assessmentId', data.assessmentPerf[i].id); }
    });
  }

  /* Classes */
  const clEl = document.getElementById('chart-classes');
  if (clEl) {
    if (!data.classPerf.length) RMSCharts.empty(clEl, 'No classes in scope.');
    else RMSCharts.barChart(clEl, {
      items: data.classPerf.map(x => ({ label: x.name, value: analyticsMetricValue(x, s.metric), sub: x.count + ' students' })),
      title: 'Class performance',
      onClick: (i) => { const it = data.classPerf[i]; if (it) analyticsSetFilter('classId', analyticsClassIdByName(data, it.name)); }
    });
  }

  /* Heatmap */
  const hmEl = document.getElementById('chart-heatmap');
  if (hmEl) {
    if (!data.heatCols.length) RMSCharts.empty(hmEl, 'Build the matrix by adding assessments with subject and class.');
    else RMSCharts.heatmap(hmEl, {
      rows: data.heatRows, cols: data.heatCols, title: 'Class by subject average',
      onClick: (row) => { if (row && row.label) analyticsSetFilter('classId', analyticsClassIdByName(data, row.label)); }
    });
  }

  /* Teacher table */
  const tcEl = document.getElementById('ana-teachers');
  if (tcEl && !analyticsIsTeacher) {
    if (!data.teacherPerf.length) {
      tcEl.innerHTML = '<p style="padding:24px;text-align:center;color:var(--gray-400)">No teacher analytics for this scope.</p>';
    } else {
      const rows = data.teacherPerf.map((t, i) => `<tr>
        <td><span class="badge badge-gray">${i + 1}</span></td>
        <td class="col-name">${AStrs.esc(t.name)}<div class="text-xs text-muted">${AStrs.esc(t.code)}</div></td>
        <td class="text-sm">${AStrs.esc(t.subjects)}</td>
        <td class="text-sm">${AStrs.esc(t.classes)}</td>
        <td>${t.assessments}</td>
        <td>${t.students}</td>
        <td class="font-semibold">${AStrs.fmt(t.avg)}</td>
        <td>${AStrs.badge(t.avg, passMark)}</td>
        <td style="width:160px"><div class="progress-bar"><div class="progress-bar-fill ${t.avg >= 70 ? 'green' : t.avg >= 50 ? 'amber' : 'red'}" style="width:${Math.min(100, t.avg)}%"></div></div></td>
      </tr>`).join('');
      tcEl.innerHTML = `<div class="table-container"><table class="data-table"><thead>
        <tr><th>#</th><th>Teacher</th><th>Subjects</th><th>Classes</th><th>Assessments</th><th>Students</th><th>Average</th><th>Status vs Pass Mark</th><th>Progress</th></tr>
        </thead><tbody>${rows}</tbody></table></div>`;
    }
  }

  analyticsDrawPerformers(data);
  analyticsDrawMatrix(data);
  analyticsDrawInsights(data.insights, data);
}

function analyticsMetricValue(x, metric) {
  if (metric === 'passRate') return x.passRate;
  if (metric === 'count') return x.count;
  return x.avg;
}

function analyticsClassIdByName(data, name) {
  const a = data.assessments.find(x => x._class && x._class.name === name);
  return a ? a.class_id : '';
}

function analyticsDrawPerformers(data) {
  const passMark = data.kpis.passMark;
  const target = data.kpis.target;
  const render = (items, elId, rankLabel) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (!items.length) { el.innerHTML = '<p style="padding:24px;text-align:center;color:var(--gray-400)">No students with computed averages.</p>'; return; }
    const rows = items.map(l => `<tr style="cursor:pointer" onclick="analyticsOpenStudent('${l.id}')">
      <td><span class="badge badge-gray">#${l.position || '-'}</span></td>
      <td class="col-name">${AStrs.esc(l.name)}<div class="text-xs text-muted">${AStrs.esc(l.code)}</div></td>
      <td class="text-sm">${AStrs.esc(l.className)}</td>
      <td class="font-semibold">${AStrs.fmt(l.pct)}</td>
      <td><span class="badge badge-purple">${AStrs.esc(l.grade)}</span></td>
      <td>${AStrs.badge(l.pct, passMark)}</td>
      <td>${l.pct != null ? AStrs.targetChip(l.pct, target) : '-'}</td>
    </tr>`).join('');
    el.innerHTML = `<div class="table-container"><table class="data-table"><thead><tr>
      <th>${rankLabel === 'top' ? 'Rank' : 'Position'}</th><th>Student</th><th>Class</th><th>Overall</th><th>Grade</th><th>Pass / Fail</th><th>Target</th>
      </tr></thead><tbody>${rows}</tbody></table></div>`;
  };
  render(data.top, 'ana-top', 'top');
  render(data.bottom, 'ana-bottom', 'bottom');
}

function analyticsDrawMatrix(data) {
  const el = document.getElementById('ana-table');
  if (!el) return;
  const passMark = data.kpis.passMark;
  const subCols = data.subjectPerf.map(s => s.name);
  const subIds = data.subjectPerf.map(s => s.id);
  if (!data.learners.length) { el.innerHTML = '<p style="padding:24px;text-align:center;color:var(--gray-400)">No learners in scope.</p>'; return; }
  const cell = (v) => {
    if (v == null) return '<td class="text-muted" style="text-align:center">-</td>';
    const cls = v >= 70 ? 'bg-green' : v >= 50 ? 'bg-amber' : 'bg-red';
    return `<td class="cell-chip"><span class="chip ${cls}">${AStrs.round(v)}%</span></td>`;
  };
  const rows = data.learners.map(l => `<tr style="cursor:pointer" onclick="analyticsOpenStudent('${l.id}')">
    <td>#${l.position || '-'}</td>
    <td class="col-name">${AStrs.esc(l.name)}<div class="text-xs text-muted">${AStrs.esc(l.code)}</div></td>
    <td class="text-sm">${AStrs.esc(l.className)}</td>
    ${subIds.map(sid => cell(l.subjectPct ? l.subjectPct[sid] : null)).join('')}
    <td class="font-semibold">${AStrs.fmt(l.pct)}</td>
    <td><span class="badge badge-purple">${AStrs.esc(l.grade)}</span></td>
    <td>${AStrs.badge(l.pct, passMark)}</td>
  </tr>`).join('');
  el.innerHTML = `<div class="table-container table-scroll"><table class="data-table"><thead><tr>
    <th>#</th><th>Student</th><th>Class</th>
    ${subCols.map(name => `<th>${AStrs.esc(name)}</th>`).join('')}
    <th>Overall</th><th>Grade</th><th>Pass / Fail</th>
  </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function analyticsDrawInsights(list, data) {
  const el = document.getElementById('ana-insights');
  if (!el) return;
  if (!list.length) { el.innerHTML = '<p style="padding:24px;text-align:center;color:var(--gray-400)">Add data to generate insights.</p>'; return; }
  const iconFor = { good: 'check-circle-2', warn: 'alert-triangle', info: 'info' };
  const clsFor = { good: 'insight-good', warn: 'insight-warn', info: 'insight-info' };
  el.innerHTML = `<ul class="insights-list">${list.map(i => `<li class="${clsFor[i.tone] || 'insight-info'}"><i data-lucide="${iconFor[i.tone] || 'info'}"></i><span>${AStrs.esc(i.text)}</span></li>`).join('')}</ul>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function analyticsDrawStudent(student, data) {
  const k = data.kpis;
  const con = data._context;
  const ctx = con ? con.ctx : null;
  const s = analyticsState;

  /* Subject radar: student vs scope */
  const subEl = document.getElementById('chart-student-subjects');
  if (subEl) {
    const subIds = Object.keys(student.subjectPct);
    const ctxAvgs = {};
    (con ? con.subjectPerf : []).forEach(x => { ctxAvgs[x.id] = x.avg; });
    if (!subIds.length) RMSCharts.empty(subEl, 'No subject marks for this student.');
    else {
      const labels = subIds.map(sid => (ctx ? ctx.subjectById(sid) : null)?.name || 'Subject');
      const colors = RMSCharts.defaultColors();
      const series = [{ name: 'Student', values: subIds.map(sid => student.subjectPct[sid]), color: colors[0] }];
      if (con) series.push({ name: 'Scope average', values: subIds.map(sid => ctxAvgs[sid]), color: colors[1] });
      RMSCharts.radarChart(subEl, { labels, series, title: 'Subject comparison' });
    }
  }

  /* Term progression */
  const termEl = document.getElementById('chart-student-term');
  if (termEl) {
    const tids = Object.keys(student.termPct).sort((a, b) => (AStrs.num(ctx?.termById?.(a)?.term_no) - AStrs.num(ctx?.termById?.(b)?.term_no)));
    if (!tids.length) RMSCharts.empty(termEl, 'No term-level marks for this student.');
    else {
      const labels = tids.map(tid => (ctx ? ctx.termById(tid) : null)?.name || 'Term');
      RMSCharts.lineChart(termEl, { labels, series: [{ name: 'Student average', values: tids.map(tid => student.termPct[tid]) }], title: 'Progression' });
    }
  }

  /* Assessment performance */
  const asEl = document.getElementById('chart-student-assess');
  if (asEl) {
    const items = Object.keys(student.assessmentPct).map(aid => {
      const a = data.assessments.find(x => x.id === aid);
      return { label: a ? a.name : aid, value: student.assessmentPct[aid], sub: a ? a._subject?.name || '' : '' };
    }).sort((a, b) => b.value - a.value);
    if (!items.length) RMSCharts.empty(asEl, 'No assessment marks for this student.');
    else {
      const idMap = Object.keys(student.assessmentPct);
      RMSCharts.barChart(asEl, { items, title: 'Assessment performance', onClick: (i) => { const it = items[i]; if (it) analyticsSetFilter('assessmentId', idMap[i]); } });
    }
  }

  /* Grade mix */
  const grEl = document.getElementById('chart-student-grades');
  if (grEl) {
    const entries = Object.keys(student.gradeDist).map(g => ({ label: 'Grade ' + g, value: student.gradeDist[g] }));
    if (!entries.length) RMSCharts.empty(grEl, 'No grades yet.');
    else RMSCharts.donutChart(grEl, { items: entries, centerLabel: (entries.reduce((a, x) => a + x.value, 0)) + '', centerSub: 'subjects', size: 210, title: 'Grade mix' });
  }

  /* Individual marks table */
  const mtEl = document.getElementById('ana-student-marks');
  if (mtEl) {
    const aById = {};
    data.assessments.forEach(a => { aById[a.id] = a; });
    const rows = [...student.marks].sort((x, y) => String(aById[y.assessment_id]?.assessment_date || '').localeCompare(String(aById[x.assessment_id]?.assessment_date || ''))).map(m => {
      const a = aById[m.assessment_id];
      if (!a) return '';
      const pct = AnalyticsEngine.pctFor(m.mark, a);
      return `<tr>
        <td class="text-sm">${a.assessment_date ? Utils.dateTimeStr(a.assessment_date) : '-'}</td>
        <td class="col-name">${AStrs.esc(a.name || a.unit)}</td>
        <td class="text-sm">${AStrs.esc(a._subject?.name || '-')}</td>
        <td class="text-sm">${AStrs.esc(a._term?.name || '-')}</td>
        <td class="text-sm">${AStrs.esc(a._typeName)}</td>
        <td>${m.mark != null ? m.mark : '-'} / ${a.maximum_mark != null ? a.maximum_mark : '-'}</td>
        <td class="font-semibold">${AStrs.fmt(pct)}</td>
        <td><span class="badge badge-purple">${AStrs.esc(m.grade || Utils.grade(pct, data.ctx.scale))}</span></td>
        <td>${AStrs.badge(pct, k.passMark)}</td>
      </tr>`;
    }).join('');
    mtEl.innerHTML = rows ? `<div class="table-container table-scroll"><table class="data-table"><thead><tr>
      <th>Date</th><th>Assessment</th><th>Subject</th><th>Term</th><th>Type</th><th>Mark</th><th>%</th><th>Grade</th><th>Pass / Fail</th>
      </tr></thead><tbody>${rows}</tbody></table></div>` : '<p style="padding:24px;text-align:center;color:var(--gray-400)">No marks recorded for this student.</p>';
  }
}

/* ---------- Interactions ---------- */

function analyticsSetFilter(prop, value) {
  analyticsState[prop] = value;
  if (prop === 'yearId') { analyticsState.termId = 'all'; analyticsState.classId = 'all'; analyticsState.stream = 'all'; analyticsState.assessmentId = 'all'; analyticsState.studentId = 'all'; }
  if (['termId', 'classId', 'subjectId', 'typeId', 'stream'].indexOf(prop) !== -1) { analyticsState.assessmentId = 'all'; analyticsState.studentId = 'all'; }
  if (prop === 'assessmentId') analyticsState.studentId = 'all';
  if (prop === 'teacherId') { analyticsState.assessmentId = 'all'; analyticsState.studentId = 'all'; }
  analyticsRefresh(analyticsIsTeacher);
}

function analyticsClearFilters() {
  analyticsState = { yearId: '', termId: 'all', classId: 'all', stream: 'all', subjectId: 'all', typeId: 'all', assessmentId: 'all', studentId: 'all', teacherId: 'all', status: 'official', limit: 10, metric: 'avg', compare: 'none' };
  analyticsRefresh(analyticsIsTeacher);
}

function analyticsOpenStudent(id) {
  analyticsState.studentId = id;
  analyticsRefresh(analyticsIsTeacher);
}

function analyticsSetTarget(v) {
  AnalyticsEngine.setTarget(v);
  analyticsRefresh(analyticsIsTeacher);
}

function analyticsPrint() {
  window.print();
}

function analyticsExportExcel() {
  const d = analyticsData;
  if (!d) return Utils.toast('Nothing to export yet', 'info');
  const s = analyticsState;
  const k = d.kpis;
  const dateStr = new Date().toISOString().slice(0, 10);
  const wb = XLSX.utils.book_new();
  const esc = (x) => String(x == null ? '' : x);

  const summary = [
    ['RMS-MIS Performance & Analytics'],
    ['Generated', new Date().toLocaleString()],
    ['Scope', analyticsChips(s, d.ctx).replace(/<[^>]+>/g, '')],
    ['Assessment status', s.status],
    [],
    ['Metric', 'Value'],
    ['Assessed Students', k.assessed],
    ['Subjects', k.subjects],
    ['Assessments', k.assessments],
    ['Overall Average (%)', k.overall],
    ['Pass Rate (%)', k.passRate],
    ['Highest Average (%)', k.highest],
    ['Lowest Average (%)', k.lowest],
    ['At/Above Target', k.aboveTarget + ' (target ' + k.target + '%)'],
    ['Below Target', k.belowTarget],
    ['Pass', k.passed],
    ['Fail', k.failed],
    ['Pass Mark (%)', k.passMark]
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');

  const sheet = (name, head, rows) => {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([head].concat(rows)), name);
  };
  sheet('Subject Performance', ['Subject', 'Average %', 'Pass Rate %', 'Marks'], d.subjectPerf.map(x => [x.name, x.avg, x.passRate, x.count]));
  sheet('Class Performance', ['Class', 'Average %', 'Pass Rate %', 'Students'], d.classPerf.map(x => [x.name, x.avg, x.passRate, x.count]));
  sheet('Assessment Performance', ['Assessment', 'Type', 'Term', 'Date', 'Max', 'Average %', 'Pass Rate %', 'Marks'], d.assessmentPerf.map(a => [a.name, a.typeName, a.termName, a.date, a.max, a.avg, a.passRate, a.count]));
  sheet('Term Performance', ['Term', 'Average %', 'Pass Rate %', 'Students'], d.termPerf.map(t => [t.name, t.avg, t.passRate, t.count]));
  if (!analyticsIsTeacher) {
    sheet('Teacher Analytics', ['Teacher', 'Code', 'Subjects', 'Classes', 'Assessments', 'Students', 'Average %', 'Pass Rate %'], d.teacherPerf.map(t => [t.name, t.code, t.subjects, t.classes, t.assessments, t.students, t.avg, t.passRate]));
  }
  const addList = (name, items) => {
    const col = items.length === d.top.length ? 'Student' : 'Student';
    sheet(name, ['Position', 'Student', 'Code', 'Class', 'Overall %', 'Grade', 'Pass/Fail'], items.map(l => [l.position || '-', l.name, l.code, l.className, l.pct, l.grade, l.pf]));
  };
  addList('Top Performers', d.top);
  addList('Academic Support List', d.bottom);
  sheet('Detailed Matrix', ['Position', 'Student', 'Code', 'Class'].concat(d.subjectPerf.map(x => x.name + ' %')).concat(['Overall %', 'Grade', 'Pass/Fail']),
    d.learners.map(l => [l.position || '-', l.name, l.code, l.className].concat(d.subjectPerf.map(x => l.subjectPct ? l.subjectPct[x.id] : null)).concat([l.pct, l.grade, l.pf])));
  sheet('Individual Marks', ['Student', 'Code', 'Class', 'Assessment', 'Subject', 'Type', 'Term', 'Date', 'Mark', 'Maximum', 'Percentage %', 'Grade', 'Pass/Fail'],
    d.learners.flatMap(l => l.marks.map(m => {
      const a = d.assessments.find(x => x.id === m.assessment_id);
      if (!a) return [];
      return [l.name, l.code, l.className, a.name || a.unit, a._subject?.name || '-', a._typeName, a._term?.name || '-', a.assessment_date, m.mark, a.maximum_mark, AnalyticsEngine.pctFor(m.mark, a), m.grade || '', (AnalyticsEngine.pctFor(m.mark, a) >= k.passMark) ? 'PASS' : 'FAIL'];
    })));

  XLSX.writeFile(wb, 'rms-analytics-' + dateStr + '.xlsx');
  Utils.toast('Excel export downloaded', 'success');
}