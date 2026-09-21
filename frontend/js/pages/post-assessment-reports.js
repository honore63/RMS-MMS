/* ============================================================
   POST-ASSESSMENT TEACHER REPORTS
   0. Overview Report
   1. Subject Performance Report
   2. Performance Range Report
   3. Grade Distribution Report
   4. Students Requiring Additional Support
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
  yearId: '', termId: 'all', levelId: 'all', classId: 'all', stream: 'all',
  subjectId: 'all', teacherId: 'all', typeId: 'all', assessmentId: 'all',
  studentId: 'all', studentIds: [], report: '0', cmp: {},
  reportScope: 'subject', schoolMode: 'all', schoolClassIds: [], schoolLevel: 'all', schoolStream: 'all',
  rangeView: 'count', rangeFocus: ''
};
let psrPages = {};
let psrPrintAll = false;
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
  escAttr(v) { return String(v == null ? '' : v).replace(/"/g, '&quot;'); },
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

/* ============================================================
   Three report scopes: Subject / Class / School
   Tab ids: 0 Overview, 1 Performance Range, 2 Subject Performance,
   3 Class Performance, 4 School Performance, 5 Student Details
   ============================================================ */

const psrTabMeta = {
  '0': { icon: 'layout-dashboard', label: 'Overview' },
  '1': { icon: 'bar-chart-3', label: 'Performance Range' },
  '2': { icon: 'book-open', label: 'Subject Performance' },
  '3': { icon: 'school', label: 'Class Performance' },
  '4': { icon: 'building-2', label: 'School Performance' },
  '5': { icon: 'users-round', label: 'Student Details' }
};
const psrTabSets = {
  subject: ['0', '1', '2', '5'],
  class: ['0', '1', '2', '3', '5'],
  school: ['0', '1', '2', '3', '4', '5']
};

function psrTabsFor() {
  return psrTabSets[psrState.reportScope] || psrTabSets.school;
}

/* Classes allowed by the current report scope + filters */
function psrFilteredClasses() {
  const ctx = psrCtx;
  if (!ctx) return [];
  const s = psrState;
  const isT = psrIsTeacher();
  let rows = isT ? (ctx.assignments || []) : ctx.classes;
  if (s.yearId && s.yearId !== 'all') rows = rows.filter(c => c.academic_year_id === s.yearId);
  if (s.levelId && s.levelId !== 'all') rows = rows.filter(c => String(psrLevelGroupOf(c.level)) === String(s.levelId));
  if (s.classId && s.classId !== 'all') rows = rows.filter(c => c.id === s.classId);
  if (s.stream && s.stream !== 'all') rows = rows.filter(c => String(c.stream || '') === String(s.stream));
  if (s.reportScope === 'school') {
    const cm = s.schoolMode || 'all';
    if (cm === 'classes') {
      const sel = new Set((s.schoolClassIds || []).filter(Boolean));
      if (sel.size) rows = rows.filter(c => sel.has(c.id));
    } else if (cm === 'level') {
      if (s.schoolLevel && s.schoolLevel !== 'all') rows = rows.filter(c => String(psrLevelGroupOf(c.level)) === String(s.schoolLevel));
    } else if (cm === 'streams') {
      if (s.schoolStream && s.schoolStream !== 'all') rows = rows.filter(c => String(c.stream || '') === String(s.schoolStream));
    }
  }
  const out = [];
  const seen = new Set();
  [...rows, ...(isT ? (ctx.assignments || []).map(a => ctx.classByName(a.class_id)).filter(Boolean) : [])]
    .forEach(c => { if (c && c.id && !seen.has(c.id)) { seen.add(c.id); out.push(c); } });
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

function psrScopeClassIds() {
  return psrFilteredClasses().map(c => c.id);
}

/* Roster-based participation: the students actually registered in the scope class(es) */
function psrExpectedRoster() {
  const ctx = psrCtx;
  if (!ctx) return [];
  const ids = new Set(psrScopeClassIds());
  return (ctx.learners || []).filter(l => ids.has(l.class_id) && (!l.status || l.status === 'active'));
}

function psrAssessedLearners() {
  return (psrData && psrData.learners) ? psrData.learners.filter(l => l.pct != null) : [];
}

function psrParticipation() {
  const assessed = psrAssessedLearners();
  const roster = psrExpectedRoster();
  const sat = assessed.length;
  const expected = roster.length;
  const absent = Math.max(expected - sat, 0);
  const rate = expected > 0 ? Math.round((sat / expected) * 1000) / 10 : (sat > 0 ? 100 : 0);
  const warnings = [];
  if (expected > 0 && sat > expected) {
    warnings.push('More learners assessed (' + sat + ') than the expected roster (' + expected + '). The roster reflects currently active learners registered in the classes in scope.');
  }
  if (expected === 0) warnings.push('No active learners are registered in the classes currently in scope.');
  return { expected, sat, absent, rate, warnings };
}

function psrGenderOf(l) {
  const g = String((l && (l.gender || l.sex)) || '').trim().toUpperCase();
  return g ? g.charAt(0) : '-';
}

function psrGradeOf(pct) {
  if (pct == null || isNaN(pct)) return null;
  const ctx = psrCtx;
  const scale = (ctx && ctx.scale) || [];
  if (typeof GradingEngine !== 'undefined' && scale.length) {
    const r = GradingEngine.calculateGradeSync(Number(pct), scale);
    if (r && r.grade) return r.grade;
  }
  return Utils.grade(pct, scale);
}

/* Independent 10-percentage-point performance ranges (90-100 down to 0-9) */
const psrRangeColors = ['#166534', '#15803d', '#65a30d', '#84cc16', '#fbbf24', '#f59e0b', '#f97316', '#ea580c', '#dc2626', '#991b1b'];

function psrBucketOf(pct) {
  const p = PStr.num(pct);
  const g = Math.max(0, Math.min(9, Math.floor(p / 10)));
  const lo = g * 10;
  const hi = g === 9 ? 100 : lo + 9;
  return { g, label: lo + '-' + hi + '%', lo, hi, color: psrRangeColors[9 - g] };
}

function psrBuckets() {
  const out = [];
  for (let g = 9; g >= 0; g--) {
    const lo = g * 10;
    const hi = g === 9 ? 100 : lo + 9;
    out.push({ g, label: lo + '-' + hi + '%', lo, hi, color: psrRangeColors[9 - g] });
  }
  return out;
}

/* Scope switcher + school include-mode helpers */
function psrSetScope(scope) {
  if (!psrTabSets[scope] || scope === psrState.reportScope) return;
  psrState.reportScope = scope;
  if (scope === 'subject') {
    if (!psrState.subjectId) psrState.subjectId = 'all';
  } else if (scope === 'class') {
    psrState.subjectId = 'all';
  } else {
    psrState.subjectId = 'all'; psrState.classId = 'all'; psrState.stream = 'all'; psrState.levelId = 'all';
  }
  psrState.schoolMode = 'all'; psrState.schoolClassIds = []; psrState.schoolLevel = 'all'; psrState.schoolStream = 'all';
  psrState.report = '0'; psrState.cmp = {}; psrState.rangeFocus = '';
  psrRefresh();
}

function psrSchoolClassChips() {
  const classes = psrFilteredClasses();
  const sel = new Set((psrState.schoolClassIds || []).filter(Boolean));
  if (!classes.length) return '<span class="text-muted af-empty">No classes in scope</span>';
  const all = !sel.size || sel.size === classes.length;
  return `<div class="psr-chip-row">
    <label class="cmp-chip ${all ? 'on' : ''}"><input type="checkbox" ${all ? 'checked' : ''} onchange="psrToggleSchoolClass('')">All Classes</label>
    ${classes.map(c => `<label class="cmp-chip ${sel.has(c.id) ? 'on' : ''}"><input type="checkbox" ${sel.has(c.id) ? 'checked' : ''} onchange="psrToggleSchoolClass(${PStr.escAttr(c.id)}, this.checked)">${PStr.esc(c.name)}</label>`).join('')}
  </div>`;
}

function psrToggleSchoolClass(id, checked) {
  if (!id) { psrState.schoolClassIds = []; }
  else {
    let arr = [...(psrState.schoolClassIds || [])];
    if (checked) { if (arr.indexOf(id) === -1) arr.push(id); }
    else arr = arr.filter(x => x !== id);
    psrState.schoolClassIds = arr;
  }
  psrRefresh();
}

function psrRangeToggle(view) {
  psrState.rangeView = view === 'pct' ? 'pct' : 'count';
  psrState.rangeFocus = '';
  psrDrawSection();
}

function psrRangeFocusOf(label) {
  psrState.rangeFocus = psrState.rangeFocus === label ? '' : label;
  psrDrawSection();
}

/* PSR-specific select: dispatches to psrSetFilter (not the Analytics page state) */
function psrSelect(prop, opts, current) {
  return `<select class="select-field" id="pf-${prop}" onchange="psrSetFilter('${prop}', this.value)">
    ${opts.map(o => `<option value="${PStr.esc(o.value)}" ${String(o.value) === String(current) ? 'selected' : ''}>${PStr.esc(o.label)}</option>`).join('')}
  </select>`;
}

function psrField(label, html) {
  return `<label class="af-field"><span>${PStr.esc(label)}</span>${html}</label>`;
}

/* Education level grouping - derived from class level values (never hard-coded lists) */
function psrLevelGroupOf(level) {
  const l = String(level || '').trim().toUpperCase();
  if (/^P[1-6]([\s]\S+)?$/.test(l)) return 'Primary';
  if (/^S[1-3]([\s]\S+)?$/.test(l)) return 'Lower Secondary';
  if (/^S[4-6]([\s]\S+)?$/.test(l)) return 'Upper Secondary';
  return l ? 'Other' : '';
}

/* Learners in the current assessment scope, for the Student filter */
function psrStudentOpts() {
  const ctx = psrCtx;
  if (!ctx || !psrRaw) return [];
  const idSet = new Set();
  psrRaw.marks.forEach(m => { if (m.learner_id) idSet.add(m.learner_id); });
  (psrData?.learners || []).forEach(l => { if (l.id) idSet.add(l.id); });
  const out = [];
  idSet.forEach(id => {
    const l = ctx.learnerById(id);
    if (l) out.push({ id, name: (l.full_name || 'Student') + (l.learner_code ? ' (' + l.learner_code + ')' : '') });
  });
  return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/* Student multi-select chip UI: toggles psrState.studentIds (engine supports an array) */
function psrStudentChips() {
  const opts = psrStudentOpts();
  const sel = new Set(psrState.studentIds || []);
  if (!opts.length) return '<span class="text-muted af-empty">No students in scope</span>';
  const all = !sel.size || sel.size === opts.length;
  return `<div class="psr-chip-row">
    <label class="cmp-chip ${all ? 'on' : ''}"><input type="checkbox" ${all ? 'checked' : ''} onchange="psrToggleStudentAll()">All Students</label>
    ${opts.map(o => `<label class="cmp-chip ${sel.has(o.id) ? 'on' : ''}"><input type="checkbox" ${sel.has(o.id) ? 'checked' : ''} onchange="psrToggleStudent('${o.id}', this.checked)">${PStr.esc(o.name)}</label>`).join('')}
  </div>`;
}

function psrToggleStudent(id, checked) {
  let arr = [...(psrState.studentIds || [])];
  if (checked) { if (arr.indexOf(id) === -1) arr.push(id); }
  else arr = arr.filter(x => x !== id);
  psrState.studentIds = arr;
  psrState.studentId = arr.length === 1 ? arr[0] : 'all';
  psrRefresh();
}

function psrToggleStudentAll() {
  const opts = psrStudentOpts();
  psrState.studentIds = opts.map(o => o.id);
  psrState.studentId = 'all';
  psrRefresh();
}

/* Per-student comment override: stored client-side per learner + grade, never
   changes the global grading scale defaults. Used in student tables. */
function psrCommentKey(learnerId, grade) {
  return 'rms_psr_comment_' + (learnerId || 'x') + '_' + (grade || 'x');
}

function psrCommentDefault(grade) {
  const ctx = psrCtx;
  const r = (ctx && ctx.scale || []).find(x => x.grade === grade);
  return (r && (r.comment || r.descriptor)) || '';
}

function psrCommentGet(learnerId, grade) {
  try { return localStorage.getItem(psrCommentKey(learnerId, grade)); } catch (e) { return null; }
}

function psrCommentSet(learnerId, grade, val) {
  const input = document.getElementById('psr-cmt-' + learnerId);
  const value = (val != null ? String(val) : (input ? input.value : '')).trim();
  try {
    if (!value) localStorage.removeItem(psrCommentKey(learnerId, grade));
    else localStorage.setItem(psrCommentKey(learnerId, grade), value);
  } catch (e) {}
  Utils.toast(value ? 'Comment override saved for this student' : 'Comment override cleared', 'success');
}

function psrCommentCell(learnerId, grade) {
  const def = psrCommentDefault(grade);
  const ov = psrCommentGet(learnerId, grade);
  const val = ov != null ? ov : def;
  return `<input class="input-field psr-comment-input" id="psr-cmt-${learnerId}" value="${PStr.escAttr(val)}" placeholder="${PStr.escAttr(def || 'No automated comment for this grade')}" onchange="psrCommentSet('${learnerId}', '${PStr.escAttr(grade || '')}', this.value)">`;
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

    const scopeIds = psrScopeClassIds();
    const ddFilter = { ...psrState, assessmentId: 'all', classIds: scopeIds };
    const dd = await AnalyticsEngine.load(ddFilter, ctx, isT);
    psrList = dd.assessments;

    psrRaw = await AnalyticsEngine.load({ ...psrState, classIds: scopeIds }, ctx, isT);
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
  const scope = s.reportScope;

  let classRows = isT ? (ctx.assignments || []) : ctx.classes;
  if (s.yearId && s.yearId !== 'all') classRows = classRows.filter(c => c.academic_year_id === s.yearId);
  const classNames = new Map();
  classRows.forEach(c => classNames.set(c.id, c));
  (ctx.assignments || []).forEach(a => { const c = ctx.classByName(a.class_id); if (c) classNames.set(c.id, c); });
  const classOpts = [...classNames.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));

  let levelRows = [];
  if (s.levelId && s.levelId !== 'all') {
    levelRows = classOpts.filter(c => String(psrLevelGroupOf(c.level)) === String(s.levelId));
  } else {
    levelRows = classOpts;
  }
  const levelOpts = [...new Set(classOpts.map(c => psrLevelGroupOf(c.level)).filter(Boolean))].sort();
  const levelNames = { 'Primary': 'Primary', 'Lower Secondary': 'Lower Secondary', 'Upper Secondary': 'Upper Secondary', 'Other': 'Other' };

  const streamList = [...new Set(levelRows.map(c => c.stream).filter(Boolean))].sort();

  let classFiltered = levelRows;
  if (s.stream && s.stream !== 'all') classFiltered = classFiltered.filter(c => String(c.stream || '') === String(s.stream));

  let subjectOpts = [];
  if (isT) {
    const subIds = new Set((ctx.assignments || []).map(a => a.subject_id));
    subjectOpts = ctx.subjects.filter(su => subIds.has(su.id)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } else {
    subjectOpts = ctx.subjects.filter(su => !su.status || su.status === 'active').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }

  const teacherOpts = (ctx.teachers || []).filter(t => !t.status || t.status === 'active').sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)));

  let termsOpts = ctx.terms;
  if (s.yearId && s.yearId !== 'all') termsOpts = termsOpts.filter(t => t.academic_year_id === s.yearId);
  termsOpts = [...termsOpts].sort((a, b) => (PStr.num(a.term_no) - PStr.num(b.term_no)) || String(a.name).localeCompare(String(b.name)));

  const assessOpts = psrList.map(a => ({
    value: a.id,
    label: (a._subject ? a._subject.name : '') + ' - ' + (a.name || a.unit) + (a._term ? ' (' + a._term.name + ')' : '')
  }));

  const tabs = psrTabsFor().map(id => {
    const t = psrTabMeta[id] || { icon: 'file-text', label: id };
    return `<button class="psr-tab ${s.report === id ? 'active' : ''}" onclick="psrSetTab('${id}')" role="tab" aria-selected="${s.report === id}">
      <i data-lucide="${t.icon}"></i>${t.label}</button>`;
  }).join('');

  const fields = [];
  fields.push(psrField('Academic Year', psrSelect('yearId', [{ value: 'all', label: 'All Years' }].concat(ctx.years.map(y => ({ value: y.id, label: y.name + (y.is_current ? ' (Current)' : '') }))), s.yearId)));
  fields.push(psrField('Term', psrSelect('termId', [{ value: 'all', label: 'All Terms' }].concat(termsOpts.map(t => ({ value: t.id, label: t.name }))), s.termId)));
  if (scope === 'subject' || scope === 'class') {
    fields.push(psrField('Education Level', psrSelect('levelId', [{ value: 'all', label: 'All Levels' }].concat(levelOpts.map(l => ({ value: l, label: levelNames[l] || l }))), s.levelId)));
    fields.push(psrField('Class', psrSelect('classId', [{ value: 'all', label: 'All Classes' }].concat(classFiltered.map(c => ({ value: c.id, label: c.name }))), s.classId)));
    fields.push(psrField('Stream', streamList.length ? psrSelect('stream', [{ value: 'all', label: 'All Streams' }].concat(streamList.map(st => ({ value: st, label: st }))), s.stream) : `<span class="text-muted af-empty">Only for streamed classes</span>`));
  }
  if (scope === 'subject') {
    fields.push(psrField('Subject', psrSelect('subjectId', [{ value: 'all', label: 'All Subjects' }].concat(subjectOpts.map(x => ({ value: x.id, label: x.name }))), s.subjectId)));
  }
  if (!isT) fields.push(psrField('Teacher', psrSelect('teacherId', [{ value: 'all', label: 'All Teachers' }].concat(teacherOpts.map(x => ({ value: x.id, label: x.full_name }))), s.teacherId)));
  fields.push(psrField('Assessment Type', psrSelect('typeId', [{ value: 'all', label: 'All Types' }].concat(ctx.types.map(x => ({ value: x.id, label: x.name }))), s.typeId)));
  fields.push(psrField('Assessment', psrSelect('assessmentId', [{ value: 'all', label: 'All Assessments' }].concat(assessOpts.length ? assessOpts : [{ value: 'none', label: 'No assessments in scope' }]), s.assessmentId)));
  fields.push(psrField('Student', `<div class="psr-student-chips">${psrStudentChips()}</div>`));

  const schoolStreamOpts = [...new Set(classOpts.map(c => c.stream).filter(Boolean))].sort();
  let includeBlock = '';
  if (scope === 'school') {
    const cm = s.schoolMode || 'all';
    const modeBtn = (val, label) => `<button class="psr-toggle-btn ${cm === val ? 'active' : ''}" onclick="psrSetFilter('schoolMode', '${val}')">${label}</button>`;
    includeBlock = `<div class="psr-include-block">
      <div class="psr-include-head"><span class="af-label">Classes to Include</span>
        <div class="psr-toggle-group">${modeBtn('all', 'All Classes')}${modeBtn('classes', 'Selected Classes')}${modeBtn('level', 'Selected Level')}${modeBtn('streams', 'Selected Streams')}</div>
      </div>
      ${cm === 'classes' ? `<div class="psr-include-body">${psrSchoolClassChips()}</div>` : ''}
      ${cm === 'level' ? `<div class="psr-include-body">${psrSelect('schoolLevel', [{ value: 'all', label: 'All Levels' }].concat(levelOpts.map(l => ({ value: l, label: levelNames[l] || l }))), s.schoolLevel)}</div>` : ''}
      ${cm === 'streams' ? `<div class="psr-include-body">${psrSelect('schoolStream', [{ value: 'all', label: 'All Streams' }].concat(schoolStreamOpts.map(st => ({ value: st, label: st }))), s.schoolStream)}</div>` : ''}
    </div>`;
  }

  const scopeSwitch = `<div class="psr-scope-switch" role="group" aria-label="Report scope">
    ${[['subject', 'book-open', 'Subject Scope'], ['class', 'school', 'Class Scope'], ['school', 'building-2', 'School Scope']].map(x => {
      const sc = x[0], icon = x[1], label = x[2];
      return `<button class="psr-scope-btn ${scope === sc ? 'active' : ''}" onclick="psrSetScope('${sc}')"><i data-lucide="${icon}"></i>${label}</button>`;
    }).join('')}
  </div>`;

  const scopeParts = [];
  scopeParts.push(scope === 'subject' ? 'Subject scope' : scope === 'class' ? 'Class scope' : 'School scope');
  if (ctx.yearById(s.yearId)) scopeParts.push(ctx.yearById(s.yearId).name);
  if (ctx.termById(s.termId)) scopeParts.push(ctx.termById(s.termId).name);
  if (s.levelId !== 'all') scopeParts.push(s.levelId);
  if (ctx.classByName(s.classId)) scopeParts.push(ctx.classByName(s.classId).name);
  if (s.stream && s.stream !== 'all') scopeParts.push('Stream ' + s.stream);
  if (ctx.subjectById(s.subjectId)) scopeParts.push(ctx.subjectById(s.subjectId).name);
  if (s.teacherId !== 'all') { const t = ctx.teachers.find(x => x.id === s.teacherId); if (t) scopeParts.push(t.full_name); }
  if (s.typeId !== 'all') { const t = ctx.types.find(x => x.id === s.typeId); if (t) scopeParts.push(t.name); }
  if (s.assessmentId !== 'all') { const a = psrList.find(x => x.id === s.assessmentId); if (a) scopeParts.push(a.name || a.unit); }
  if (s.studentId !== 'all') { const l = ctx.learnerById(s.studentId); if (l) scopeParts.push(l.full_name); }
  if (scope === 'school') {
    const cm = s.schoolMode || 'all';
    if (cm === 'classes') {
      const nn = (s.schoolClassIds || []).filter(Boolean).length;
      if (nn) scopeParts.push(nn + ' selected class(es)');
      else scopeParts.push('All classes');
    }
    if (cm === 'level' && s.schoolLevel && s.schoolLevel !== 'all') scopeParts.push('Level: ' + s.schoolLevel);
    if (cm === 'streams' && s.schoolStream && s.schoolStream !== 'all') scopeParts.push('Stream: ' + s.schoolStream);
  }

  const participation = psrParticipation();
  const scopeNote = isT
    ? `Scoped to your assigned classes and subjects${ctx.assignments && ctx.assignments.length ? ' (' + ctx.assignments.length + ' assignment records)' : ''}. RLS restricts all data at the database level.`
    : 'Full DOS/Admin access.';

  const exportBar = `<div class="analysis-bar psr-export-bar">
    <span class="text-sm text-muted" style="margin-right:auto">${scopeNote}</span>
    <button class="btn btn-secondary" onclick="psrRefresh()"><i data-lucide="refresh-cw"></i> Refresh Report</button>
    <button class="btn btn-secondary" onclick="psrExportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
    <button class="btn btn-secondary" onclick="psrPrint()"><i data-lucide="printer"></i> Print / PDF</button>
  </div>`;

  const schoolName = (ctx.settings && ctx.settings.school_name) || 'Rukara Model School';

  setContent(`<div class="psr-page">
    <div class="psr-screen-header school-report-header" style="border-bottom:3px solid var(--blue-700);padding-bottom:10px;margin-bottom:6px">
      <img src="${PStr.esc((ctx.settings && ctx.settings.logo_url) || 'public/logo.webp')}" alt="School Logo" class="school-logo-img">
      <h2 style="margin:0">${PStr.esc(schoolName)}</h2>
      <p class="contact-line">RMS-MIS &middot; Rukara Model School Marks Information System</p>
      <div class="report-main-title" style="font-size:20px">POST-ASSESSMENT REPORT</div>
    </div>
    ${scopeSwitch}
    <div class="card mb-6 psr-filters-card">
      <div class="card-header psr-card-header">
        <h3><i data-lucide="sliders-horizontal"></i> Report Filters</h3>
        <div class="analytics-header-actions">
          <button class="btn btn-sm btn-secondary" onclick="psrRefresh()"><i data-lucide="refresh-cw"></i> Refresh Report</button>
          <button class="btn btn-sm btn-secondary" onclick="psrResetFilters()"><i data-lucide="rotate-ccw"></i> Reset Filters</button>
        </div>
      </div>
      <div class="psr-tabs report-tabs">${tabs}</div>
      <div class="filters-grid">${fields.join('')}</div>
      ${includeBlock}
      <div class="analytics-scope">Scope: <strong>${scopeParts.length ? PStr.esc(scopeParts.join(' &bull; ')) : 'Whole school'}</strong> &middot; Classes in scope: <strong>${psrFilteredClasses().length}</strong> &middot; Expected roster: <strong>${participation.expected}</strong> &middot; Assessments in scope: <strong>${psrRaw.assessments.length}</strong> &middot; Default status: Approved + Locked</div>
    </div>
    ${exportBar}
    <div id="psr-sections" class="psr-sections"></div>
  </div>`);
  psrDrawSection();
}

function psrSetTab(id) {
  psrState.report = id;
  psrState.rangeFocus = '';
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
  if (prop === 'yearId') {
    psrState.termId = 'all'; psrState.levelId = 'all'; psrState.classId = 'all'; psrState.stream = 'all';
    psrState.subjectId = 'all'; psrState.teacherId = 'all'; psrState.schoolLevel = 'all'; psrState.schoolStream = 'all';
  }
  if (prop === 'termId') { psrState.levelId = 'all'; psrState.classId = 'all'; psrState.stream = 'all'; psrState.subjectId = 'all'; psrState.teacherId = 'all'; }
  if (prop === 'levelId') { psrState.classId = 'all'; psrState.stream = 'all'; psrState.subjectId = 'all'; psrState.teacherId = 'all'; }
  if (['classId', 'stream', 'teacherId', 'subjectId', 'typeId'].indexOf(prop) !== -1) { psrState.assessmentId = 'all'; psrState.studentId = 'all'; }
  if (['schoolMode', 'schoolLevel', 'schoolStream'].indexOf(prop) !== -1) { psrState.assessmentId = 'all'; psrState.studentId = 'all'; }
  if (prop === 'assessmentId') { psrState.studentId = 'all'; }
  if (['yearId', 'termId', 'levelId', 'classId', 'stream', 'subjectId', 'teacherId', 'typeId', 'assessmentId', 'schoolMode', 'schoolLevel', 'schoolStream'].indexOf(prop) !== -1) psrState.studentIds = [];
  psrState.cmp = {};
  psrRefresh();
}

function psrResetFilters() {
  psrState = { yearId: '', termId: 'all', levelId: 'all', classId: 'all', stream: 'all', subjectId: 'all', teacherId: 'all', typeId: 'all', assessmentId: 'all', studentId: 'all', studentIds: [], report: psrState.report, cmp: {}, reportScope: psrState.reportScope, schoolMode: 'all', schoolClassIds: [], schoolLevel: 'all', schoolStream: 'all', rangeView: 'count', rangeFocus: '' };
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
  t.pageSize = Number(t.pageSize) || 0;
  const ths = t.cols.map((h, i) => `<th class="text-center ${t.sortable ? 'psr-sortable' : ''}" ${t.sortable ? `onclick="psrSortTable('${t.id}', ${i})"` : ''}>${PStr.esc(h)}${t.sortable ? '<i data-lucide="arrow-up-down" style="width:12px;height:12px;vertical-align:middle;margin-left:4px"></i>' : ''}</th>`).join('');
  const cellOf = r => r.map((cell, i) => {
    let cls = '';
    if (t.centerCols && t.centerCols.indexOf(i) !== -1) cls = 'text-center';
    return `<td class="${cls}">${cell}</td>`;
  }).join('');
  const trs = t.rows.map((r, idx) => `<tr${t.pageSize ? ` data-page="${Math.floor(idx / t.pageSize) + 1}"` : ''}>${cellOf(r)}</tr>`).join('') ||
    `<tr><td colspan="${t.cols.length}" style="text-align:center;color:var(--gray-400)">No records.</td></tr>`;
  const tools = t.searchable
    ? `<div class="psr-table-tools"><input class="input-field" type="search" placeholder="Type to filter rows..." oninput="psrFilterTable('${t.id}', this.value)">
       <span class="text-xs text-muted psr-count" id="${t.id}-count">${t.rows.length} rows</span></div>`
    : '';
  const pager = t.pageSize
    ? `<div class="psr-table-pager">
        <span class="text-xs text-muted psr-pageinfo" id="${t.id}-pageinfo"></span>
        <div class="psr-pager-btns">
          <button type="button" class="btn btn-sm btn-secondary" onclick="psrTablePage('${t.id}', -1)"><i data-lucide="chevron-left"></i> Prev</button>
          <button type="button" class="btn btn-sm btn-secondary" onclick="psrTablePage('${t.id}', 1)">Next <i data-lucide="chevron-right"></i></button>
        </div>
      </div>`
    : '';
  return `<div class="card mb-6"><div class="card-header"><h3>${AStrs.icon(t.icon || 'table')}${PStr.esc(t.title)}</h3>${t.note ? `<span class="text-sm text-muted">${PStr.esc(t.note)}</span>` : ''}</div>
    ${tools}
    <div class="table-box"><div class="table-container table-scroll"><table class="data-table" id="${t.id || ''}"${t.pageSize ? ` data-page-size="${t.pageSize}"` : ''}><thead><tr>${ths}</tr></thead>
    <tbody>${trs}</tbody></table></div>${pager}</div></div>`;
}

function psrApplyPage(tid) {
  const t = document.getElementById(tid);
  if (!t) return;
  const size = Number(t.getAttribute('data-page-size')) || 0;
  const state = psrPages[tid] || (psrPages[tid] = { page: 1 });
  const rows = Array.prototype.slice.call(t.querySelectorAll('tbody tr'));
  if (!size) {
    rows.forEach(r => { if (r.getAttribute('data-psr-q') !== '1') r.style.display = ''; });
    return;
  }
  const visible = rows.filter(r => r.getAttribute('data-psr-q') !== '1');
  const total = Math.max(1, Math.ceil(visible.length / size));
  state.page = Math.max(1, Math.min(state.page, total));
  const all = !!psrPrintAll;
  rows.forEach(r => {
    const qHidden = r.getAttribute('data-psr-q') === '1';
    const onPage = all || Number(r.getAttribute('data-page')) === state.page;
    r.style.display = (!qHidden && onPage) ? '' : 'none';
  });
  const info = document.getElementById(tid + '-pageinfo');
  if (info) info.textContent = (all ? 'All ' + visible.length + ' rows' : 'Page ' + state.page + ' of ' + total + ' - ' + visible.length + ' rows');
  const count = document.getElementById(tid + '-count');
  if (count) count.textContent = visible.length + ' rows';
}

function psrTablePage(tid, delta) {
  const state = psrPages[tid] || (psrPages[tid] = { page: 1 });
  state.page += Number(delta) || 0;
  psrApplyPage(tid);
}

function psrFilterTable(tid, q) {
  const t = document.getElementById(tid);
  if (!t) return;
  const count = document.getElementById(tid + '-count');
  const ql = String(q || '').trim().toLowerCase();
  let shown = 0;
  t.querySelectorAll('tbody tr').forEach(tr => {
    const on = !ql || (tr.textContent || '').toLowerCase().indexOf(ql) !== -1;
    tr.setAttribute('data-psr-q', on ? '0' : '1');
    if (on) shown++;
  });
  if (count) count.textContent = shown + ' rows';
  if (t.getAttribute('data-page-size')) { psrPages[tid] = psrPages[tid] || { page: 1 }; psrPages[tid].page = 1; }
  psrApplyPage(tid);
}

function psrSortTable(tid, col) {
  const t = document.getElementById(tid);
  if (!t) return;
  const body = t.querySelector('tbody');
  if (!body) return;
  const rows = Array.prototype.slice.call(body.querySelectorAll('tr')).filter(r => r.style.display !== 'none');
  const prev = (t._psrSort && t._psrSort.col === col) ? { col, dir: -t._psrSort.dir } : { col, dir: 1 };
  t._psrSort = prev;
  const numeric = v => (v == null || String(v).trim() === '' || isNaN(Number(v))) ? null : Number(v);
  rows.sort((a, b) => {
    const av = a.cells[col] ? (a.cells[col].textContent || '').trim() : '';
    const bv = b.cells[col] ? (b.cells[col].textContent || '').trim() : '';
    const an = numeric(av), bn = numeric(bv);
    let cmp;
    if (an != null && bn != null) cmp = an - bn;
    else if (an == null && bn == null) cmp = av.localeCompare(bv);
    else cmp = an != null ? -1 : 1;
    return cmp * prev.dir;
  });
  rows.forEach(r => body.appendChild(r));
  const size = Number(t.getAttribute('data-page-size')) || 0;
  if (size) {
    let vi = 0;
    body.querySelectorAll('tr').forEach(r => {
      if (r.getAttribute('data-psr-q') !== '1') {
        r.setAttribute('data-page', Math.floor(vi / size) + 1);
        vi++;
      }
    });
    psrApplyPage(t.id);
  }
  t.querySelectorAll('thead th').forEach(th => {
    th.classList.toggle('psr-sort-active', Number(th.dataset.col) === col);
    const ic = th.querySelector('i[data-lucide]');
    if (ic) ic.dataset.lucide = Number(th.dataset.col) === col ? (prev.dir > 0 ? 'arrow-up' : 'arrow-down') : 'arrow-up-down';
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
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
  if (m.chips) html += `<div class="card mb-6"><div class="card-header"><h3>${AStrs.icon(m.chipsIcon || 'checkbox')}${PStr.esc(m.chipsTitle || 'Select Assessments to Compare')}</h3></div><div class="cmp-chips">${m.chips}</div></div>`;
  m.tables.forEach(t => { html += psrTableCard(t); });
  if (m.printSignature) html += m.printSignature;

  el.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();

  m.tables.forEach(t => { if (t.id && Number(t.pageSize) > 0) psrApplyPage(t.id); });

  m.charts.forEach(c => {
    const cEl = document.getElementById(c.id);
    if (cEl && RMSCharts[c.type]) RMSCharts[c.type](cEl, c.opts);
  });
}

/* ============================================================
   Report model builders
   ============================================================ */

function psrSectionModel() {
  const empty = psrEmptyPrompt();
  if (empty) return { prompt: empty };
  switch (psrState.report) {
    case '1': return psrRangeModel();
    case '2': return psrSubjectModel();
    case '3': return psrClassModel();
    case '4': return psrSchoolModel();
    case '5': return psrStudentsModel();
    default: return psrOverviewModel();
  }
}

function psrEmptyPrompt() {
  if (!psrRaw || !psrRaw.assessments.length) {
    return { title: 'No assessments in scope', msg: 'No approved or locked assessments match the current scope. Adjust the filters above - missing marks are never treated as zero.' };
  }
  if (!psrExpectedRoster().length) {
    return { title: 'No learners in scope', msg: 'No active learners are registered in the classes currently in scope, so there is nothing to report on.' };
  }
  if (!psrData || !psrData.learners.length) {
    return { title: 'No learners assessed', msg: 'No marks were found for this scope. Missing marks are never treated as zero.' };
  }
  return null;
}

function psrScopeMeta() {
  const ctx = psrCtx;
  const isT = psrIsTeacher();
  const assessments = psrRaw.assessments;
  const classes = psrFilteredClasses();
  const official = assessments.length > 0 && assessments.every(a => a.status === 'approved' || a.status === 'locked');
  let className = 'All classes';
  if (psrState.classId && psrState.classId !== 'all') {
    className = (ctx.classByName(psrState.classId) || {}).name || className;
  } else if (classes.length === 1) {
    className = classes[0].name;
  } else if (classes.length > 1) {
    className = classes.length + ' classes';
  } else {
    className = isT ? 'Assigned classes' : 'Selected classes';
  }
  let subjectName = 'Every subject';
  if (psrState.subjectId && psrState.subjectId !== 'all') {
    subjectName = (ctx.subjectById(psrState.subjectId) || {}).name || subjectName;
  }
  return {
    className,
    subjectName,
    yearName: ctx.yearById(psrState.yearId) ? ctx.yearById(psrState.yearId).name : '',
    termName: ctx.termById(psrState.termId) ? ctx.termById(psrState.termId).name : '',
    teacherName: psrTeacherName(ctx),
    settings: ctx.settings,
    isOfficial: official,
    totalMax: assessments.reduce((a, x) => a + (Number(x.maximum_mark) || 0), 0),
    classCount: classes.length,
    rosterCount: psrExpectedRoster().length,
    assessedCount: psrAssessedLearners().length,
    scopeLabel: psrState.reportScope === 'subject' ? 'Subject scope' : psrState.reportScope === 'class' ? 'Class scope' : 'School scope'
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

/* ---------- Report 0: Overview ---------- */

function psrGradesTable(learners) {
  const ctx = psrCtx;
  let gradeDist = [];
  if (typeof GradingEngine !== 'undefined' && ctx && ctx.scale) {
    gradeDist = GradingEngine.getGradeDistribution(learners.map(l => l.grade).filter(Boolean), ctx.scale);
  }
  const rows = gradeDist.map(g => [psrGradeBadge(g.grade), PStr.esc(g.descriptor), PStr.esc(g.range), g.count, PStr.fmt(g.percentage), g.isPass ? '<span class="badge badge-success">Pass</span>' : '<span class="badge badge-danger">Fail</span>']);
  rows.push(['<span class="font-semibold">Total</span>', '', '', learners.length, PStr.fmt(100), '']);
  return { cols: ['Grade', 'Descriptor', 'Percentage Range', 'Students', '% of Assessed', 'Pass/Fail'], rows, dist: gradeDist };
}

function psrOverviewModel() {
  const d = psrData;
  const ctx = psrCtx;
  const k = d.kpis;
  const passMark = k.passMark;
  const participation = psrParticipation();
  const roster = psrExpectedRoster();
  const assessed = psrAssessedLearners();
  const meta = psrScopeMeta();
  const assessments = psrRaw.assessments;
  const selected = psrState.assessmentId !== 'all'
    ? assessments.filter(a => a.id === psrState.assessmentId)
    : assessments;

  const infoRows = [
    ['Report Scope', meta.scopeLabel],
    ['Academic Year', meta.yearName || '-'],
    ['Term', meta.termName || '-'],
    ['Education Level', psrState.levelId !== 'all' ? psrState.levelId : (psrState.schoolLevel && psrState.schoolLevel !== 'all' ? psrState.schoolLevel : '-')],
    ['Classes', meta.className + (meta.classCount > 1 ? ' (' + meta.classCount + ')' : '')],
    ['Stream', (psrState.stream && psrState.stream !== 'all') ? psrState.stream : (psrState.schoolStream && psrState.schoolStream !== 'all' ? psrState.schoolStream : '-')],
    ['Subject', meta.subjectName],
    ['Teacher', psrState.teacherId !== 'all' ? (ctx.teachers.find(t => t.id === psrState.teacherId)?.full_name || '-') : '-'],
    ['Assessment Type', psrState.typeId !== 'all' ? (ctx.types.find(x => x.id === psrState.typeId)?.name || '-') : (selected.length ? selected[0]._typeName || '-' : '-')],
    ['Assessment(s)', selected.map(a => a.name || a.unit).filter(Boolean).join(', ') || '-'],
    ['Assessments Combined', assessments.length],
    ['Expected Roster', participation.expected],
    ['Students Assessed', participation.sat + (participation.absent ? ' (' + participation.absent + ' absent)' : '')],
    ['Participation Rate', PStr.fmt(participation.rate)],
    ['Status', assessments.length && assessments.every(a => a.status === 'approved' || a.status === 'locked') ? 'OFFICIAL / APPROVED' : 'MIXED / DRAFT']
  ];

  const infoTable = { title: 'Assessment Information', icon: 'info',
    cols: ['Field', 'Value'], centerCols: [],
    rows: infoRows.map(r => [`<span class="col-name">${PStr.esc(r[0])}</span>`, PStr.esc(r[1])]) };

  const kpis = [
    { label: 'Expected Roster', value: participation.expected, icon: 'users-round', tone: 'blue' },
    { label: 'Students Assessed', value: participation.sat, icon: 'clipboard-check', tone: 'blue' },
    { label: 'Participation Rate', value: PStr.fmt(participation.rate), icon: 'percent', tone: participation.rate >= 90 ? 'green' : (participation.rate >= 50 ? 'amber' : 'red'), sub: participation.absent ? participation.absent + ' absent' : 'Full participation' },
    { label: 'Overall Average', value: PStr.fmt(k.overall), icon: 'calculator', tone: 'blue' },
    { label: 'Highest', value: PStr.fmt(k.highest), icon: 'trending-up', tone: 'green' },
    { label: 'Lowest', value: PStr.fmt(k.lowest), icon: 'trending-down', tone: 'red' },
    { label: 'Pass Rate', value: PStr.fmt(k.passRate), icon: 'badge-check', tone: 'green', sub: 'Pass mark ' + PStr.round(passMark) + '%' },
    { label: 'Fail Rate', value: PStr.fmt(k.failRate), icon: 'alert-triangle', tone: 'red' }
  ];

  const gradeTable = psrGradesTable(assessed);

  const bucketSummary = psrBuckets().map(b => {
    const inRange = assessed.filter(l => psrBucketOf(l.pct).g === b.g);
    return [PStr.esc(b.label), inRange.length, assessed.length ? PStr.fmt(inRange.length / assessed.length * 100) : '0%'];
  });
  bucketSummary.push(['<span class="font-semibold">Total</span>', assessed.length, PStr.fmt(100)]);

  const byL = {};
  d.learners.forEach(l => byL[l.id] = l);
  const partLearners = roster.slice().sort((a, b) => {
    const ap = byL[a.id] && byL[a.id].pct, bp = byL[b.id] && byL[b.id].pct;
    return (bp == null ? -1 : bp) - (ap == null ? -1 : ap) || String(a.full_name || '').localeCompare(String(b.full_name || ''));
  });
  const partRows = partLearners.map(l => {
    const ll = byL[l.id];
    const pct = ll && ll.pct != null ? ll.pct : null;
    return [
      PStr.esc(l.learner_code || '-'),
      `<span class="col-name">${PStr.esc(l.full_name || 'Student')}</span>`,
      PStr.esc(psrGenderOf(l)),
      pct != null ? `<span class="font-semibold">${PStr.fmt(pct)}</span>` : '<span class="text-muted">-</span>',
      pct != null ? psrGradeBadge(ll.grade || psrGradeOf(pct)) : '-',
      pct != null ? psrBadgePct(pct, passMark) : '<span class="badge badge-neutral">Not assessed</span>'
    ];
  });

  const byGender = {};
  roster.forEach(l => {
    const g = psrGenderOf(l);
    if (!byGender[g]) byGender[g] = { expected: 0, assessed: 0, pcts: [] };
    byGender[g].expected++;
  });
  assessed.forEach(l => {
    const g = psrGenderOf(l);
    if (!byGender[g]) byGender[g] = { expected: 0, assessed: 0, pcts: [] };
    byGender[g].assessed++;
    byGender[g].pcts.push(l.pct);
  });
  const genderRows = Object.keys(byGender).sort().map(g => {
    const b = byGender[g];
    const avg = b.pcts.length ? PStr.round(b.pcts.reduce((x, y) => x + y, 0) / b.pcts.length) : null;
    const pr = b.pcts.length ? Math.round(b.pcts.filter(p => p >= passMark).length / b.pcts.length * 1000) / 10 : null;
    return [`<span class="font-semibold">${PStr.esc(g)}</span>`, b.expected, b.assessed, avg != null ? PStr.fmt(avg) : '-', pr != null ? PStr.fmt(pr) : '-'];
  });
  genderRows.push(['<span class="font-semibold">Total</span>', participation.expected, participation.sat, PStr.fmt(k.overall), PStr.fmt(k.passRate)]);

  return {
    printHeader: psrReportHeader('POST-ASSESSMENT REPORT - ' + meta.scopeLabel.toUpperCase(), 'Overview of the selected assessment scope: roster participation, performance summary, grade distribution and 10-percentage-point performance ranges.'),
    printSignature: psrReportSignature(),
    kpis,
    tables: [infoTable,
      { title: 'Class Participation', icon: 'users-round', note: participation.warnings.length ? participation.warnings.join(' ') : 'Students registered in the classes in scope and whether they were assessed. Missing marks are never treated as zero.',
        cols: ['Student ID', 'Student Name', 'Gender', 'Overall %', 'Grade', 'Result'], centerCols: [2, 3, 4, 5], id: 'psr-overview-participants', searchable: true, sortable: true, pageSize: 50, rows: partRows },
      { title: 'Grade Summary', icon: 'graduation-cap', note: 'Counts and percentages from the school grading scale (database-driven)',
        cols: ['Grade', 'Descriptor', 'Percentage Range', 'Students', '% of Assessed', 'Pass/Fail'], centerCols: [2, 3, 4], rows: gradeTable.rows },
      { title: 'Performance Range Summary', icon: 'bar-chart-3', note: 'Students per independent 10-percentage-point range of overall percentage',
        cols: ['Range', 'Students', '% of Assessed'], centerCols: [1, 2], rows: bucketSummary },
      { title: 'Participation by Gender', icon: 'users', note: 'Expected vs assessed learners with average and pass rate per gender',
        cols: ['Gender', 'Expected', 'Assessed', 'Average %', 'Pass Rate %'], centerCols: [1, 2, 3, 4], rows: genderRows }
    ],
    charts: [
      { id: 'psr-overview-pf', title: 'Pass / Fail', sub: 'Pass mark ' + PStr.round(passMark) + '%', icon: 'circle-dot', type: 'donut', half: true,
        opts: { items: [{ label: 'Pass', value: k.passed, color: '#16a34a' }, { label: 'Fail', value: k.failed, color: '#dc2626' }], centerLabel: PStr.fmt(k.passRate), centerSub: 'pass rate', title: 'Pass/Fail' } },
      { id: 'psr-overview-grade', title: 'Grade Distribution', sub: 'Students per grade of the grading scale', icon: 'bar-chart-3', type: 'bar', half: true,
        opts: { items: gradeTable.dist.map(g => ({ label: 'Grade ' + g.grade, value: g.count, sub: g.descriptor || g.range })), title: 'Grades' } }
    ]
  };
}

/* ---------- Report 2: Subject Performance (detail or per-subject summary) ---------- */

function psrSubjectModel() {
  const d = psrData;
  const k = d.kpis;
  const passMark = k.passMark;
  const participation = psrParticipation();

  if (psrState.reportScope === 'subject' && (psrState.subjectId === 'all' || psrState.classId === 'all')) {
    return { prompt: { title: 'Select a class and subject', msg: 'In Subject scope this report shows one class and subject at a time. Choose a class and a subject from the filters above (teachers only see their assigned ones).' } };
  }

  if (psrState.subjectId === 'all') {
    return psrSubjectSummaryModel();
  }

  const assessments = psrRaw.assessments;

  const kpis = [
    { label: 'Expected Roster', value: participation.expected, icon: 'users-round', tone: 'blue' },
    { label: 'Students Assessed', value: participation.sat, icon: 'clipboard-check', tone: 'blue' },
    { label: 'Participation Rate', value: PStr.fmt(participation.rate), icon: 'percent', tone: participation.rate >= 90 ? 'green' : (participation.rate >= 50 ? 'amber' : 'red'), sub: participation.absent ? participation.absent + ' absent' : 'Full participation' },
    { label: 'Subject Average', value: PStr.fmt(k.overall), icon: 'calculator', tone: 'blue' },
    { label: 'Highest', value: PStr.fmt(k.highest), icon: 'trending-up', tone: 'green' },
    { label: 'Lowest', value: PStr.fmt(k.lowest), icon: 'trending-down', tone: 'red' },
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

  const rankTotal = psrAssessedLearners().length;
  const sortedLearners = d.learners.slice().sort((a, b) => (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct));
  const studentCols = ['#', 'Student ID', 'Student Name', 'Class', 'Gender'].concat(assessments.map(a => (a.name || a.unit).length > 14 ? (a.name || a.unit).slice(0, 12) + '...' : (a.name || a.unit))).concat(['Overall %', 'Grade', 'Result', 'Rank', 'Comment']);
  const centerCols = [0, 3, 4];
  for (let i = 5; i < studentCols.length - 1; i++) centerCols.push(i);
  const studentRows = sortedLearners.map((l, idx) => {
    const row = [idx + 1, PStr.esc(l.code), `<span class="col-name">${PStr.esc(l.name)}</span>`, PStr.esc(l.className || '-'), PStr.esc(psrGenderOf(l))];
    assessments.forEach(a => {
      const v = l.assessmentPct ? l.assessmentPct[a.id] : null;
      row.push(v != null ? `<span class="font-semibold">${PStr.round(v)}%</span>` : '<span class="text-muted">-</span>');
    });
    row.push(`<span class="font-semibold">${PStr.fmt(l.pct)}</span>`, psrGradeBadge(l.grade), psrBadgePct(l.pct, passMark), l.position != null ? '#' + l.position + ' / ' + rankTotal : '-', psrCommentCell(l.id, l.grade));
    return row;
  });

  return {
    printHeader: psrReportHeader('SUBJECT PERFORMANCE REPORT', 'Students assessed, participation, subject average, highest / lowest average, pass / fail rate, per-assessment results and grade distribution.'),
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
        cols: studentCols, centerCols, rows: studentRows, id: 'psr-sub-students', searchable: true, sortable: true, pageSize: 50 }
    ]
  };
}

/* Per-subject summary (class / school scope when no single subject is selected) */
function psrSubjectSummaryModel() {
  const passMark = psrData.kpis.passMark;
  const ctx = psrCtx;
  const byS = {};
  psrRaw.marks.forEach(m => {
    const a = psrRaw.assessments.find(x => x.id === m.assessment_id);
    if (!a || a.subject_id == null) return;
    const p = AnalyticsEngine.pctFor(m.mark, a);
    if (p == null) return;
    const key = a.subject_id;
    if (!byS[key]) byS[key] = { pcts: [], learners: new Set(), assessments: new Set() };
    byS[key].pcts.push(p);
    byS[key].learners.add(m.learner_id);
    byS[key].assessments.add(a.id);
  });
  const stats = Object.keys(byS).map(sid => {
    const g = byS[sid];
    const total = g.pcts.reduce((x, y) => x + y, 0);
    const justPass = g.pcts.filter(p => p >= passMark).length;
    return {
      name: (ctx.subjectById(sid) || {}).name || 'Unknown subject',
      assessments: g.assessments.size,
      assessed: g.learners.size,
      avg: PStr.round(total / g.pcts.length),
      high: PStr.round(Math.max(...g.pcts)),
      low: PStr.round(Math.min(...g.pcts)),
      passRate: PStr.round(justPass / g.pcts.length * 100)
    };
  }).sort((a, b) => b.avg - a.avg);

  const totalAssessed = new Set();
  psrRaw.marks.forEach(m => { if (m.learner_id) totalAssessed.add(m.learner_id); });

  const kpis = [
    { label: 'Subjects in Scope', value: stats.length, icon: 'book-open', tone: 'blue' },
    { label: 'Learners Assessed', value: totalAssessed.size, icon: 'users-round', tone: 'blue' },
    { label: 'Best Average', value: stats.length ? PStr.esc(stats[0].name) : '-', icon: 'medal', tone: 'green', sub: stats.length ? PStr.fmt(stats[0].avg) + ' average' : '' },
    { label: 'Lowest Average', value: stats.length ? PStr.esc(stats[stats.length - 1].name) : '-', icon: 'alert-triangle', tone: 'red', sub: stats.length ? PStr.fmt(stats[stats.length - 1].avg) + ' average' : '' }
  ];

  return {
    printHeader: psrReportHeader('SUBJECT PERFORMANCE REPORT', 'Subject-by-subject summary for the classes in scope: assessments, assessed learners, average, highest / lowest and pass rate.'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-subsum-bar', title: 'Subject Averages', sub: 'Across all assessments in scope per subject', icon: 'bar-chart-3', type: 'bar', half: false,
        opts: { items: stats.map(s => ({ label: s.name, value: s.avg, sub: s.assessed + ' learners' })), title: 'Subject averages' } }
    ],
    tables: [
      { title: 'Subject Performance Summary', icon: 'book-open', note: 'Per subject across the classes in scope',
        cols: ['Subject', 'Assessments', 'Assessed Learners', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %'],
        centerCols: [1, 2, 3, 4, 5, 6],
        rows: stats.map(s => [PStr.esc(s.name), s.assessments, s.assessed, PStr.fmt(s.avg), PStr.fmt(s.high), PStr.fmt(s.low), PStr.fmt(s.passRate)]) }
    ]
  };
}

/* ---------- Report 1: Performance Range (10-point buckets) ---------- */

function psrRangeModel() {
  const d = psrData;
  const k = d.kpis;
  const passMark = k.passMark;
  const assessed = psrAssessedLearners();

  const buckets = psrBuckets().map(b => {
    const students = assessed.filter(l => psrBucketOf(l.pct).g === b.g).sort((x, y) => y.pct - x.pct);
    let boys = 0, girls = 0;
    students.forEach(s => { if (psrGenderOf(s) === 'M') boys++; else if (psrGenderOf(s) === 'F') girls++; });
    return { label: b.label, color: b.color, count: students.length, pct: assessed.length ? Math.round(students.length / assessed.length * 1000) / 10 : 0, students, boys, girls };
  });
  const populated = buckets.filter(b => b.count > 0);
  const largest = populated.length ? populated.reduce((a, b2) => b2.count > a.count ? b2 : a) : null;
  const bottom = buckets[buckets.length - 1];
  const view = psrState.rangeView === 'pct' ? 'pct' : 'count';

  const kpis = [
    { label: 'Students Assessed', value: assessed.length, icon: 'users-round', tone: 'blue' },
    { label: 'Overall Average', value: PStr.fmt(k.overall), icon: 'calculator', tone: 'blue' },
    { label: 'Most Populated Range', value: largest ? PStr.esc(largest.label) : '-', icon: 'trending-up', tone: 'green', sub: largest ? largest.count + ' students' : '' },
    { label: 'Students in 0-9%', value: bottom.count, icon: 'alert-triangle', tone: 'red', sub: PStr.fmt(bottom.pct) + ' of assessed' }
  ];

  const rangeRows = buckets.map(b => [PStr.esc(b.label), b.boys, b.girls, b.count, PStr.fmt(b.pct)]);
  const boysT = rangeRows.reduce((a, r) => a + r[1], 0);
  const girlsT = rangeRows.reduce((a, r) => a + r[2], 0);
  rangeRows.push(['<span class="font-semibold">Total</span>', boysT, girlsT, assessed.length, PStr.fmt(100)]);

  const toggleHtml = `<div class="psr-toggle-group psr-range-toggle">
    <button class="psr-toggle-btn ${view === 'count' ? 'active' : ''}" onclick="psrRangeToggle('count')">Students</button>
    <button class="psr-toggle-btn ${view === 'pct' ? 'active' : ''}" onclick="psrRangeToggle('pct')">% of Assessed</button>
  </div>`;

  const focusLabel = psrState.rangeFocus && buckets.find(b => b.label === psrState.rangeFocus);
  const drillTables = [];
  if (focusLabel && focusLabel.students.length) {
    drillTables.push({ title: 'Students in ' + focusLabel.label + ' Range', icon: 'users', note: 'Drill-down from the 10-point performance range distribution (independent of the grading scale).',
      cols: ['#', 'Student ID', 'Student Name', 'Class', 'Gender', 'Overall %', 'Grade', 'Result'], centerCols: [0, 4, 5, 7], id: 'psr-range-students', searchable: true, sortable: true, pageSize: 50,
      rows: focusLabel.students.map((s, i) => [i + 1, PStr.esc(s.code), `<span class="col-name">${PStr.esc(s.name)}</span>`, PStr.esc(s.className || '-'), PStr.esc(psrGenderOf(s)), `<span class="font-semibold">${PStr.fmt(s.pct)}</span>`, psrGradeBadge(s.grade || psrGradeOf(s.pct)), psrBadgePct(s.pct, passMark)]) });
  }

  return {
    printHeader: psrReportHeader('PERFORMANCE RANGE REPORT', 'Distribution of assessed students across ten independent 10-percentage-point ranges (90-100% down to 0-9%), with a clickable chart to drill into each range.'),
    printSignature: psrReportSignature(),
    kpis,
    chips: toggleHtml,
    charts: [
      { id: 'psr-range-bar', title: 'Students per 10-Point Performance Range', icon: 'bar-chart-3', type: 'bar', half: false,
        opts: { items: buckets.map(b => ({ label: b.label, value: view === 'pct' ? b.pct : b.count, color: b.color, sub: (view === 'pct' ? b.count + ' students' : PStr.fmt(b.pct) + ' of assessed'), _bucket: b.label })), title: 'Performance ranges', onClick: (i, it) => psrRangeFocusOf(it._bucket) } }
    ],
    tables: [
      { title: 'Range Summary', icon: 'list-checks', note: 'Boys and Girls split by the gender recorded for each assessed learner', cols: ['Performance Range', 'Boys', 'Girls', 'Total Students', '% of Assessed'], centerCols: [1, 2, 3, 4], rows: rangeRows }
    ].concat(drillTables)
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

/* ---------- Report 3: Class Performance ---------- */

function psrClassModel() {
  const d = psrData;
  const passMark = d.kpis.passMark;
  const classes = psrFilteredClasses();
  const roster = psrExpectedRoster();
  const assessed = psrAssessedLearners();

  const byClass = {};
  roster.forEach(l => { if (!byClass[l.class_id]) byClass[l.class_id] = []; byClass[l.class_id].push(l); });
  assessed.forEach(l => { if (!byClass[l.class_id]) byClass[l.class_id] = []; byClass[l.class_id].push(l); });

  const rows = classes.map(c => {
    const ls = byClass[c.id] || [];
    const withPct = ls.filter(x => x.pct != null);
    const expected = roster.filter(x => x.class_id === c.id).length || ls.length;
    const total = withPct.reduce((a, x) => a + x.pct, 0);
    const passed = withPct.filter(x => x.pct >= passMark).length;
    return {
      name: c.name,
      expected: expected,
      assessed: withPct.length,
      rate: expected > 0 ? PStr.round(withPct.length / expected * 100) : (withPct.length > 0 ? 100 : 0),
      avg: withPct.length > 0 ? PStr.round(total / withPct.length) : null,
      high: withPct.length > 0 ? PStr.round(Math.max(...withPct.map(x => x.pct))) : null,
      low: withPct.length > 0 ? PStr.round(Math.min(...withPct.map(x => x.pct))) : null,
      passRate: withPct.length > 0 ? PStr.round(passed / withPct.length * 100) : null,
      failRate: withPct.length > 0 ? PStr.round((withPct.length - passed) / withPct.length * 100) : null
    };
  }).sort((a, b) => (b.avg == null ? -1 : b.avg) - (a.avg == null ? -1 : a.avg));
      const ranked = rows.filter(r => r.avg != null);
  const best = ranked[0];
  const weakest = ranked[ranked.length - 1];

  const kpis = [
    { label: 'Classes in Scope', value: classes.length, icon: 'school', tone: 'blue' },
    { label: 'Learners Assessed', value: assessed.length, icon: 'users-round', tone: 'blue' },
    { label: 'Best Class Average', value: best ? PStr.esc(best.name) : '-', icon: 'medal', tone: 'green', sub: best ? PStr.fmt(best.avg) + ' average' : '' },
    { label: 'Lowest Class Average', value: weakest ? PStr.esc(weakest.name) : '-', icon: 'alert-triangle', tone: 'red', sub: weakest ? PStr.fmt(weakest.avg) + ' average' : '' }
  ];

  return {
    printHeader: psrReportHeader('CLASS PERFORMANCE REPORT', 'Per-class comparison for the classes in scope: expected roster, assessed learners, participation, average, highest / lowest and pass rate.'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-class-avg', title: 'Class Averages', sub: 'Weighted overall average per class via the existing RMS-MIS engine', icon: 'bar-chart-3', type: 'bar', half: false,
        opts: { items: rows.map(r => ({ label: r.name.length > 18 ? r.name.slice(0, 16) + '...' : r.name, value: r.avg == null ? 0 : r.avg, sub: r.assessed + ' assessed', color: undefined })), title: 'Class averages' } }
    ],
    tables: [
      { title: 'Class Performance Summary', icon: 'school', note: 'Participation compares assessed learners against the active roster of each class',
        cols: ['Class', 'Expected Roster', 'Assessed', 'Participation %', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Fail Rate %'],
        centerCols: [1, 2, 3, 4, 5, 6, 7, 8], id: 'psr-class-table', searchable: true, sortable: true,
        rows: rows.map(r => [PStr.esc(r.name), r.expected, r.assessed, PStr.fmt(r.rate), PStr.fmt(r.avg), PStr.fmt(r.high), PStr.fmt(r.low), PStr.fmt(r.passRate), PStr.fmt(r.failRate)]) }
    ]
  };
}

/* ---------- Report 4: School Performance ---------- */

function psrSchoolModel() {
  if (psrState.reportScope !== 'school') {
    return { prompt: { title: 'Switch scope to School', msg: 'The School Performance Report compares whole levels, subjects and teaching teams. Use the scope switcher at the top to choose School.' } };
  }
  const d = psrData;
  const ctx = psrCtx;
  const passMark = d.kpis.passMark;
  const classes = psrFilteredClasses();
  const roster = psrExpectedRoster();
  const assessed = psrAssessedLearners();

  const byLevel = {};
  const levelOfClassId = {};
  classes.forEach(c => { const lv = psrLevelGroupOf(c.level) || 'Other'; levelOfClassId[c.id] = lv; if (!byLevel[lv]) byLevel[lv] = { key: lv, classes: [], students: [] }; byLevel[lv].classes.push(c); });
  assessed.forEach(l => { const lv = levelOfClassId[l.class_id]; if (byLevel[lv]) byLevel[lv].students.push(l); });

  const levelRows = Object.keys(byLevel).map(k => {
    const g = byLevel[k];
    const total = g.students.reduce((a, x) => a + x.pct, 0);
    const passed = g.students.filter(x => x.pct >= passMark).length;
    return { name: k, classes: g.classes.length, assessed: g.students.length, avg: g.students.length ? PStr.round(total / g.students.length) : null, passRate: g.students.length ? PStr.round(passed / g.students.length * 100) : null };
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)));

  const bySubject = {};
  psrRaw.marks.forEach(m => {
    const a = psrRaw.assessments.find(x => x.id === m.assessment_id);
    if (!a || a.subject_id == null) return;
    const p = AnalyticsEngine.pctFor(m.mark, a);
    if (p == null) return;
    if (!bySubject[a.subject_id]) bySubject[a.subject_id] = { pcts: [], learners: new Set() };
    bySubject[a.subject_id].pcts.push(p);
    bySubject[a.subject_id].learners.add(m.learner_id);
  });
  const subjectRows = Object.keys(bySubject).map(sid => {
    const g = bySubject[sid];
    const total = g.pcts.reduce((a, x) => a + x, 0);
    const passed = g.pcts.filter(x => x >= passMark).length;
    return { name: (ctx.subjectById(sid) || {}).name || 'Unknown subject', assessed: g.learners.size, avg: PStr.round(total / g.pcts.length), passRate: PStr.round(passed / g.pcts.length * 100) };
  }).sort((a, b) => b.avg - a.avg);

  const byTeacher = {};
  psrRaw.assessments.forEach(a => {
    if (a.teacher_id == null) return;
    if (!byTeacher[a.teacher_id]) byTeacher[a.teacher_id] = { name: ((ctx.teachers || []).find(t => t.id === a.teacher_id) || {}).full_name || 'Teacher', pcts: [] };
    psrRaw.marks.forEach(m => {
      if (m.assessment_id !== a.id) return;
      const p = AnalyticsEngine.pctFor(m.mark, a);
      if (p != null) byTeacher[a.teacher_id].pcts.push(p);
    });
  });
  const teacherRows = Object.keys(byTeacher).map(tid => {
    const g = byTeacher[tid];
    const passed = g.pcts.filter(x => x >= passMark).length;
    return { name: g.name, assessed: g.pcts.length, avg: g.pcts.length ? PStr.round(g.pcts.reduce((a, x) => a + x, 0) / g.pcts.length) : null, passRate: g.pcts.length ? PStr.round(passed / g.pcts.length * 100) : null };
  }).sort((a, b) => b.avg - a.avg);

  const kpis = [
    { label: 'Classes in Scope', value: classes.length, icon: 'school', tone: 'blue' },
    { label: 'Learners Assessed', value: assessed.length, icon: 'users-round', tone: 'blue' },
    { label: 'Overall Average', value: PStr.fmt(d.kpis.overall), icon: 'calculator', tone: 'blue' },
    { label: 'Pass Rate', value: PStr.fmt(d.kpis.passRate), icon: 'badge-check', tone: 'green', sub: 'Pass mark ' + PStr.round(passMark) + '%' }
  ];

  return {
    printHeader: psrReportHeader('SCHOOL PERFORMANCE REPORT', 'Whole-school comparison across levels, subjects and teaching teams for the classes in scope: averages, pass rates, participation and subject performance.'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-sch-level', title: 'Average per Level', sub: 'Education level grouping derived from class level values', icon: 'building-2', type: 'bar', half: true,
        opts: { items: levelRows.map(r => ({ label: r.name, value: r.avg == null ? 0 : r.avg, sub: r.assessed + ' learners', color: undefined })), title: 'Level averages' } },
      { id: 'psr-sch-subject', title: 'Subject Averages', sub: 'Across all assessments in scope per subject', icon: 'book-open', type: 'bar', half: true,
        opts: { items: subjectRows.map(s => ({ label: s.name.length > 18 ? s.name.slice(0, 16) + '...' : s.name, value: s.avg == null ? 0 : s.avg, sub: s.assessed + ' learners', color: undefined })), title: 'Subject averages' } }
    ],
    tables: [
      { title: 'Level Summary', icon: 'building-2', note: 'Average and pass rate across the classes of each level',
        cols: ['Level', 'Classes', 'Assessed Learners', 'Average %', 'Pass Rate %'], centerCols: [1, 2, 3, 4],
        rows: levelRows.map(r => [PStr.esc(r.name), r.classes, r.assessed, PStr.fmt(r.avg), PStr.fmt(r.passRate)]) },
      { title: 'Subject Performance', icon: 'book-open', note: 'Per subject across the classes in scope',
        cols: ['Subject', 'Assessed Learners', 'Average %', 'Pass Rate %'], centerCols: [1, 2, 3],
        rows: subjectRows.map(r => [PStr.esc(r.name), r.assessed, PStr.fmt(r.avg), PStr.fmt(r.passRate)]) },
      { title: 'Teacher Performance', icon: 'users', note: 'Average of the marks on assessments owned by each teacher',
        cols: ['Teacher', 'Assessed Marks', 'Average %', 'Pass Rate %'], centerCols: [1, 2, 3],
        rows: teacherRows.map(r => [PStr.esc(r.name), r.assessed, PStr.fmt(r.avg), PStr.fmt(r.passRate)]) }
    ]
  };
}

/* ---------- Report 5: Student Details ---------- */

function psrStudentsModel() {
  const d = psrData;
  const passMark = d.kpis.passMark;
  const assessed = psrAssessedLearners().slice().sort((a, b) => b.pct - a.pct);
  const rankTotal = assessed.length;
  const top = assessed.slice(0, 5);
  const support = assessed.filter(l => l.pct < passMark).length;

  const kpis = [
    { label: 'Students Assessed', value: rankTotal, icon: 'users-round', tone: 'blue' },
    { label: 'Passed', value: d.kpis.passed, icon: 'badge-check', tone: 'green', sub: PStr.fmt(d.kpis.passRate) + ' pass rate' },
    { label: 'Requiring Support', value: support, icon: 'life-buoy', tone: 'amber', sub: 'Below pass mark ' + PStr.round(passMark) + '%' },
    { label: 'Average Mark', value: PStr.fmt(d.kpis.overall), icon: 'calculator', tone: 'blue' }
  ];

  const studentCols = ['Rank', 'Student ID', 'Student Name', 'Class', 'Gender', 'Overall %', 'Grade', 'Result'];
  const studentRows = assessed.map((l, idx) => [
    idx === 0 ? '<span class="badge" style="background:#166534;color:#fff">1</span>' : '<span class="font-semibold">' + (idx + 1) + '</span>',
    PStr.esc(l.code), `<span class="col-name">${PStr.esc(l.name)}</span>`,
    PStr.esc(l.className || '-'), PStr.esc(psrGenderOf(l)),
    `<span class="font-semibold">${PStr.fmt(l.pct)}</span>`, psrGradeBadge(l.grade), psrBadgePct(l.pct, passMark)
  ]);

  const topRows = top.map((l, idx) => [idx + 1, PStr.esc(l.code), `<span class="col-name">${PStr.esc(l.name)}</span>`, PStr.esc(l.className || '-'), PStr.esc(psrGenderOf(l)), PStr.fmt(l.pct), psrGradeBadge(l.grade)]);

  return {
    printHeader: psrReportHeader('STUDENT DETAILS REPORT', 'Ranked results of every assessed student in scope with grade and pass / fail result, top performers and students requiring support.'),
    printSignature: psrReportSignature(),
    kpis,
    charts: [
      { id: 'psr-stud-pf', title: 'Pass / Fail', sub: 'Pass mark ' + PStr.round(passMark) + '%', icon: 'circle-dot', type: 'donut', half: true,
        opts: { items: [{ label: 'Pass', value: d.kpis.passed, color: '#16a34a' }, { label: 'Fail', value: d.kpis.failed, color: '#dc2626' }], centerLabel: PStr.fmt(d.kpis.passRate), centerSub: 'pass rate', title: 'Pass/Fail' } }
    ],
    tables: [
      { title: 'Top Performers', icon: 'medal', note: 'Highest overall averages in the current scope',
        cols: ['#', 'Student ID', 'Student Name', 'Class', 'Gender', 'Overall %', 'Grade'], centerCols: [0, 4, 5, 6], rows: topRows },
      { title: 'All Assessed Students', icon: 'users', note: 'Ranked by overall average (existing RMS-MIS engine). Rows can be searched, sorted and exported.',
        cols: studentCols, centerCols: [0, 4, 5, 7], rows: studentRows, id: 'psr-students-table', searchable: true, sortable: true, pageSize: 50 }
    ]
  };
}

/* ============================================================
   Export: Excel and Print / PDF
   ============================================================ */

function psrPrint() {
  psrPrintAll = true;
  try { psrDrawSection(); } catch (e) { /* ignore */ }
  document.body.classList.add('printing-report', 'psr-printing');
  setTimeout(() => { window.print(); }, 80);
}
document.addEventListener('afterprint', function onAfterPrint() {
  psrPrintAll = false;
  try { psrDrawSection(); } catch (e) { /* ignore */ }
  document.body.classList.remove('printing-report', 'psr-printing');
});

function psrExcelSheets() {
  const d = psrData;
  const ctx = psrCtx;
  const passMark = d.kpis.passMark;
  const sheets = [];
  const meta = psrScopeMeta();
  const assessed = psrAssessedLearners();
  const roster = psrExpectedRoster();
  const participation = psrParticipation();

  const subjectStats = psrRaw.assessments.map(a => {
    const ms = psrRaw.marks.filter(m => m.assessment_id === a.id);
    const valid = ms.map(m => AnalyticsEngine.pctFor(m.mark, a)).filter(p => p != null);
    return { name: a.name || a.unit, type: a._typeName, max: a.maximum_mark, weight: a._effWeight,
      avg: valid.length ? PStr.round(valid.reduce((x, y) => x + y, 0) / valid.length) : null,
      high: valid.length ? PStr.round(Math.max(...valid)) : null, low: valid.length ? PStr.round(Math.min(...valid)) : null,
      passRate: valid.length ? PStr.round(valid.filter(p => p >= passMark).length / valid.length * 100) : null,
      count: valid.length };
  });

  sheets.push({ name: 'Summary', head: ['Metric', 'Value'], rows: [
    ['Report Scope', meta.scopeLabel],
    ['Classes', meta.classCount],
    ['Expected Roster', participation.expected],
    ['Students Assessed', participation.sat],
    ['Participation Rate %', participation.rate],
    ['Overall Average %', d.kpis.overall],
    ['Highest Average %', d.kpis.highest],
    ['Lowest Average %', d.kpis.lowest],
    ['Pass Rate %', d.kpis.passRate],
    ['Fail Rate %', d.kpis.failRate],
    ['Pass Mark %', d.kpis.passMark]
  ] });

  if (psrState.report === '0') {
    const bc = {};
    assessed.forEach(l => { const k = psrBucketOf(l.pct).label; if (!bc[k]) bc[k] = { boys: 0, girls: 0, count: 0 }; bc[k].count += 1; if (psrGenderOf(l) === 'B') bc[k].boys += 1; else if (psrGenderOf(l) === 'G') bc[k].girls += 1; });
    sheets.push({ name: 'Performance Ranges', head: ['Range', 'Boys', 'Girls', 'Students', '% of Assessed'],
      rows: psrBuckets().map(x => { const g = bc[x.label] || { boys: 0, girls: 0, count: 0 }; return [x.label, g.boys, g.girls, g.count, assessed.length ? PStr.round(g.count / assessed.length * 100) : 0]; }) });
    sheets.push({ name: 'Grade Summary', head: ['Grade', 'Descriptor', 'Percentage Range', 'Students', '% of Assessed', 'Pass/Fail'],
      rows: typeof GradingEngine !== 'undefined' && ctx.scale ? GradingEngine.getGradeDistribution(d.learners.map(l => l.grade).filter(Boolean), ctx.scale).map(g => [g.grade, g.descriptor, g.range, g.count, g.percentage, g.isPass ? 'Pass' : 'Fail']) : [] });
    sheets.push({ name: 'Class Participation', head: ['Class', 'Expected Roster', 'Assessed', 'Participation %', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Fail Rate %'],
      rows: psrFilteredClasses().map(c => {
        const clsAssessed = assessed.filter(l => l.class_id === c.id);
        const expected = roster.filter(l => l.class_id === c.id).length || clsAssessed.length;
        const total = clsAssessed.reduce((a, x) => a + x.pct, 0);
        const passed = clsAssessed.filter(x => x.pct >= passMark).length;
        return [c.name, expected, clsAssessed.length, expected ? PStr.round(clsAssessed.length / expected * 100) : (clsAssessed.length ? 100 : 0), clsAssessed.length ? PStr.round(total / clsAssessed.length) : '-', clsAssessed.length ? PStr.round(Math.max(...clsAssessed.map(x => x.pct))) : '-', clsAssessed.length ? PStr.round(Math.min(...clsAssessed.map(x => x.pct))) : '-', clsAssessed.length ? PStr.round(passed / clsAssessed.length * 100) : '-', clsAssessed.length ? PStr.round((clsAssessed.length - passed) / clsAssessed.length * 100) : '-'];
      }) });
    sheets.push({ name: 'Gender Breakdown', head: ['Gender', 'Assessed', 'Average %', 'Pass Rate %'],
      rows: ['B', 'G'].map(gen => {
        const ls = assessed.filter(l => psrGenderOf(l) === gen);
        const total = ls.reduce((a, x) => a + x.pct, 0);
        const passed = ls.filter(x => x.pct >= passMark).length;
        return [gen === 'B' ? 'Boys' : 'Girls', ls.length, ls.length ? PStr.round(total / ls.length) : '-', ls.length ? PStr.round(passed / ls.length * 100) : '-'];
      }) });
  }

  if (psrState.report === '1') {
    const bc = {};
    assessed.forEach(l => { const k = psrBucketOf(l.pct).label; if (!bc[k]) bc[k] = { boys: 0, girls: 0, list: [] }; if (psrGenderOf(l) === 'B') bc[k].boys += 1; else if (psrGenderOf(l) === 'G') bc[k].girls += 1; bc[k].list.push(l); });
    sheets.push({ name: 'Range Summary', head: ['Range', 'Boys', 'Girls', 'Students', '% of Assessed'],
      rows: psrBuckets().map(x => { const g = bc[x.label] || { boys: 0, girls: 0, list: [] }; return [x.label, g.boys, g.girls, g.list.length, assessed.length ? PStr.round(g.list.length / assessed.length * 100) : 0]; }) });
    if (psrState.rangeFocus && bc[psrState.rangeFocus]) {
      sheets.push({ name: 'Range Students', head: ['#', 'Student ID', 'Student Name', 'Class', 'Gender', 'Overall %', 'Grade', 'Result'],
        rows: bc[psrState.rangeFocus].list.map((l, i) => [i + 1, l.code, l.name, l.className || '-', psrGenderOf(l), PStr.round(l.pct), l.grade, l.pct >= passMark ? 'PASS' : 'FAIL']) });
    }
  }

  if (psrState.report === '2') {
    if (psrState.subjectId === 'all') {
      const m = psrSubjectSummaryModel();
      const t = m.tables[0];
      sheets.push({ name: 'Subject Performance', head: t.cols, rows: t.rows.map(r => r.map(c => String(c).replace(/<[^>]*>/g, ''))) });
    } else {
      sheets.push({
        name: 'Students', head: ['#', 'Student ID', 'Student Name', 'Class', 'Gender'].concat(psrRaw.assessments.map(a => (a.name || a.unit) + ' (%)')).concat(['Overall %', 'Grade', 'Result', 'Rank']),
        rows: d.learners.slice().sort((a, b) => b.pct - a.pct).map((l, i) => {
          const row = [i + 1, l.code, l.name, l.className || '-', psrGenderOf(l)];
          psrRaw.assessments.forEach(a => { const v = l.assessmentPct ? l.assessmentPct[a.id] : null; row.push(v != null ? PStr.round(v) : 'N/R'); });
          row.push(l.pct != null ? PStr.round(l.pct) : 'N/R', l.grade, l.pct >= passMark ? 'PASS' : 'FAIL', l.position != null ? l.position : '-');
          return row;
        })
      });
      sheets.push({ name: 'Assessment Stats', head: ['Assessment', 'Type', 'Max', 'Weight', 'Average %', 'Highest %', 'Lowest %', 'Pass Rate %', 'Assessed'],
        rows: subjectStats.map(s => [s.name, s.type, s.max, s.weight != null ? s.weight : '-', s.avg, s.high, s.low, s.passRate, s.count]) });
    }
  }

  if (psrState.report === '3') {
    const m = psrClassModel();
    const t = m.tables[0];
    sheets.push({ name: 'Class Performance', head: t.cols, rows: t.rows.map(r => r.map(c => String(c).replace(/<[^>]*>/g, ''))) });
  }

  if (psrState.report === '4') {
    const m = psrSchoolModel();
    const names = ['Level Summary', 'Subject Performance', 'Teacher Performance'];
    m.tables.forEach((t, i) => {
      sheets.push({ name: names[i] || 'Table ' + i, head: t.cols, rows: t.rows.map(r => r.map(c => String(c).replace(/<[^>]*>/g, ''))) });
    });
  }

  if (psrState.report === '5') {
    sheets.push({ name: 'Ranked Students', head: ['Rank', 'Student ID', 'Student Name', 'Class', 'Gender', 'Overall %', 'Grade', 'Result'],
      rows: assessed.slice().sort((a, b) => b.pct - a.pct).map((l, i) => [i + 1, l.code, l.name, l.className || '-', psrGenderOf(l), PStr.round(l.pct), l.grade, l.pct >= passMark ? 'PASS' : 'FAIL']) });
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