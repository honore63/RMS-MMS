let markEntries = [];
let markAssessment = null;
let autoSaveTimer = null;
let marksView = 'list';
let teacherAssignments = [];
let activeYear = null;
let activeTerm = null;
let listSearch = '';
let listFilter = 'all';
let markSettings = { pass_mark: 50, decimal_marks_enabled: false };
let casTypes = [];
let casTerms = [];
let casClasses = [];
let convertState = null;

async function renderEnterMarks() {
  const urlParams = new URLSearchParams(window.location.hash.split('?')[1] || '');
  const assessId = urlParams.get('assessment');

  const ok = await loadTeacherContext();
  if (!ok) {
    setHeader('Marks Recording', 'Enter and manage marks for your assessments.');
    setContent(Utils.empty('No teacher profile found', 'user-x'));
    return;
  }

  if (!assessId) {
    marksView = 'list';
    await renderAssessmentList();
  } else {
    marksView = 'entry';
    await renderMarksEntry(assessId);
  }
}

async function loadTeacherContext() {
  const teacherId = Auth.getTeacherId();
  if (!teacherId) return false;
  const [assignments, years, terms] = await Promise.all([
    DB.query('teacher_assignments', '*', { teacher_id: teacherId }),
    DB.get('academic_years'),
    DB.get('terms')
  ]);
  teacherAssignments = assignments;
  const currentYearId = typeof getActiveYearId === 'function' ? getActiveYearId(years) : null;
  activeYear = years.find(year => year.is_current)
    || years.find(year => year.status === 'active')
    || years.find(year => String(year.id) === String(currentYearId))
    || years[0]
    || null;
  const yearTerms = terms.filter(term => activeYear
    && String(term.academic_year_id) === String(activeYear.id));
  activeTerm = yearTerms.find(term => term.is_active) || yearTerms[0] || null;
  return true;
}

async function renderAssessmentList() {
  setHeader('Marks Recording', 'Enter and manage marks for your assessments.');
  setContent(Utils.loading());

  const teacherId = Auth.getTeacherId();
  const [assessments, classes, subjects, types] = await Promise.all([
    DB.query('assessments', '*', { teacher_id: teacherId }, { column: 'assessment_date', asc: false }),
    DB.get('classes'),
    DB.get('subjects'),
    getAssessmentTypes()
  ]);

  let progressMap = {};
  if (assessments.length) {
    try {
      const ids = assessments.map(a => a.id);
      const { data } = await sbClient.from('marks').select('assessment_id, learner_id, mark').in('assessment_id', ids);
      if (data) {
        progressMap = {};
        data.forEach(m => {
          if (m.mark != null) progressMap[m.assessment_id] = (progressMap[m.assessment_id] || 0) + 1;
        });
      }
    } catch (e) { console.error('Progress error:', e); }
  }

  const filtered = assessments.filter(a => {
    /* Conversion helpers live only on the Convert Marks page. */
    if (Utils.isConversionHelper && Utils.isConversionHelper(a)) return false;
    if (listFilter !== 'all' && a.status !== listFilter) return false;
    if (!listSearch) return true;
    const q = listSearch.toLowerCase();
    const cls = classes.find(c => c.id === a.class_id);
    const sub = subjects.find(s => s.id === a.subject_id);
    return (a.name + ' ' + (a.unit || '') + ' ' + Utils.buildAssessmentDisplayName(a, types) + ' ' + assessmentTypeName(types, a.assessment_type_id, '') + ' ' + (cls?.name || '') + ' ' + (sub?.name || '')).toLowerCase().includes(q);
  });

  const grouped = {};
  filtered.forEach(a => {
    const sub = subjects.find(s => s.id === a.subject_id);
    const key = sub?.name || 'Other';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(a);
  });

  const totalCount = await getLearnerCountForAssessments(filtered);

  function displayStatus(a) {
    let status = a.status;
    let color = Utils.statusColor(status);
    let icon = Utils.statusIcon(status);
    let label = status;
    if (status === 'draft') {
      const entered = progressMap[a.id] || 0;
      if (entered > 0) {
        status = 'In Progress';
        color = 'badge-info';
        icon = 'loader';
        label = 'In Progress';
      } else {
        status = 'Not Started';
        color = 'badge-warning';
        icon = 'file-edit';
        label = 'Not Started';
      }
    }
    return `<span class="badge ${color}"><i data-lucide="${icon}"></i> ${label}</span>`;
  }

  function actionBtn(a) {
    const entered = progressMap[a.id] || 0;
    let label = 'Enter Marks';
    let icon = 'pencil-line';
    if (['submitted', 'approved', 'locked'].includes(a.status)) { label = 'View'; icon = 'eye'; }
    if (a.status === 'rejected') { label = 'Edit & Correct'; icon = 'alert-circle'; }
    if (a.status === 'draft' && entered > 0) { label = 'Continue'; icon = 'arrow-right'; }
    return `<button class="btn btn-sm ${a.status === 'rejected' ? 'btn-warning' : a.status === 'submitted' ? 'btn-outline' : a.status === 'approved' || a.status === 'locked' ? 'btn-outline' : 'btn-primary'}" onclick="Router.go('teacher/enter-marks?assessment=${a.id}')"><i data-lucide="${icon}"></i> ${label}</button>`;
  }

  function progressCell(a) {
    const entered = progressMap[a.id] || 0;
    const total = totalCount[a.class_id] || 0;
    const pct = total ? Math.round(entered / total * 100) : 0;
    const barColor = pct === 100 ? 'green' : pct > 0 ? 'amber' : '';
    return `<div style="display:flex;align-items:center;gap:8px">
      <div class="progress-bar" style="width:80px"><div class="progress-bar-fill ${barColor}" style="width:${pct}%"></div></div>
      <span class="text-xs font-semibold" style="color:var(--gray-600)">${entered}/${total}</span>
    </div>`;
  }

  const tableRows = Object.entries(grouped).map(([subjName, items]) => {
    const rows = items.map(a => {
      const cls = classes.find(c => c.id === a.class_id);
      const sub = subjects.find(s => s.id === a.subject_id);
      return `<tr>
        <td class="col-name">${Utils.escapeHtml(sub?.name || '-')}</td>
        <td class="text-muted">${Utils.escapeHtml(cls?.name || '-')}</td>
        <td>${Utils.escapeHtml(assessmentTypeName(types, a.assessment_type_id, 'End-of-Unit Assessment'))}</td>
        <td><span class="font-semibold">${Utils.escapeHtml(Utils.buildAssessmentDisplayName(a, types))}</span><div class="text-xs text-muted">${Utils.escapeHtml(a.name)}</div></td>
        <td class="text-center font-semibold">${a.maximum_mark}</td>
        <td class="text-muted">${Utils.dateStr(a.assessment_date)}</td>
        <td>${progressCell(a)}</td>
        <td>${displayStatus(a)}</td>
        <td class="col-actions">${actionBtn(a)}</td>
      </tr>`;
    }).join('');
    return `<tr><td colspan="9" style="background:var(--gray-50);padding:8px 16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--gray-500)">${Utils.escapeHtml(subjName)}</td></tr>${rows}`;
  }).join('');

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div class="tab-bar">
        <button class="tab-btn ${listFilter === 'all' ? 'active' : ''}" onclick="listFilter='all';renderEnterMarks()">All</button>
        <button class="tab-btn ${listFilter === 'draft' ? 'active' : ''}" onclick="listFilter='draft';renderEnterMarks()">Not Started</button>
        <button class="tab-btn ${listFilter === 'submitted' ? 'active' : ''}" onclick="listFilter='submitted';renderEnterMarks()">Submitted</button>
        <button class="tab-btn ${listFilter === 'approved' ? 'active' : ''}" onclick="listFilter='approved';renderEnterMarks()">Approved</button>
        <button class="tab-btn ${listFilter === 'rejected' ? 'active' : ''}" onclick="listFilter='rejected';renderEnterMarks()">Rejected</button>
        <button class="tab-btn ${listFilter === 'locked' ? 'active' : ''}" onclick="listFilter='locked';renderEnterMarks()">Locked</button>
      </div>
      <div class="flex gap-2" style="align-items:center">
        <button class="btn btn-primary" onclick="openCreateAssessment()" style="padding:12px 22px;font-size:14px;font-weight:800;box-shadow:0 4px 12px rgba(37,99,235,.25)"><i data-lucide="plus-circle" style="width:18px;height:18px"></i> + Add Assessment</button>
        <button class="btn btn-secondary" onclick="MarksImport.open()"><i data-lucide="file-up"></i> Import Marks</button>
      </div>
    </div>
    <div style="margin-bottom:16px;background:linear-gradient(135deg,rgba(16,185,129,0.08),rgba(5,122,80,0.04));border:1px solid var(--green-200);border-radius:var(--radius);padding:12px 16px;display:flex;align-items:center;gap:10px">
      <i data-lucide="sparkles" style="width:16px;height:16px;color:var(--green-600)"></i>
      <span class="text-sm" style="color:var(--gray-700)">Assessments are scoped to your assigned classes & subjects. Use <strong>+ Add Assessment</strong> to create a new one — roster builds automatically.</span>
    </div>
    <div class="filter-bar">
      <div class="search-input-wrapper" style="flex:1;min-width:220px">
        <i data-lucide="search"></i>
        <input class="input-field" placeholder="Search by subject, class, unit..." value="${Utils.escapeHtml(listSearch)}" onkeyup="listSearch=this.value;setTimeout(()=>renderEnterMarks(),400)">
      </div>
    </div>
    <div class="card">
      <div class="table-container"><table class="data-table">
        <thead><tr><th>Subject</th><th>Class</th><th>Type</th><th>Unit / Assessment</th><th>Max</th><th>Date</th><th>Progress</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${tableRows || `<tr><td colspan="9">${Utils.empty('No assessments yet', 'clipboard-list')}</td></tr>`}</tbody>
      </table></div>
    </div>`);
}

async function getLearnerCountForAssessments(assessments) {
  const counts = {};
  const classIds = [...new Set(assessments.map(a => a.class_id))];
  for (const cid of classIds) {
    try {
      const { count } = await sbClient.from('learners').select('*', { count: 'exact', head: true }).eq('class_id', cid).eq('status', 'active');
      counts[cid] = count || 0;
    } catch (e) { counts[cid] = 0; }
  }
  return counts;
}

async function openCreateAssessment() {
  const ok = await loadTeacherContext();
  if (!ok) return Utils.toast('No teacher profile found', 'error');
  if (!teacherAssignments.length) return Utils.toast('You have no class/subject assignments. Contact the DOS.', 'error');
  if (!activeYear) return Utils.toast('No active academic year set. Contact the DOS.', 'error');
  let classes, subjects, types, years, terms;
  try {
    [classes, subjects, types, years, terms] = await Promise.all([
      DB.get('classes'),
      DB.get('subjects'),
      getAssessmentTypes(),
      DB.get('academic_years'),
      DB.get('terms')
    ]);
  } catch (error) {
    console.error('[TeacherAssessments] Failed to load assessment form data:', error);
    return Utils.toast('Could not load the assessment form. Please reload and try again.', 'error');
  }
  casTypes = types.filter(t => t.status === 'active');
  const yearAssignments = teacherAssignments.filter(assignment =>
    !assignment.academic_year_id
      || String(assignment.academic_year_id) === String(activeYear.id));
  casClasses = classes;
  casTerms = terms.filter(t => String(t.academic_year_id) === String(activeYear.id));
  const assignedSubjectIds = new Set(yearAssignments.map(assignment => String(assignment.subject_id)));
  const subjectOptions = subjects.filter(subject => assignedSubjectIds.has(String(subject.id)));
  if (!casTypes.length) {
    return Utils.toast('No active assessment types are available. Contact the DOS.', 'error');
  }
  if (!casTerms.length) {
    return Utils.toast('No terms are configured for the current academic year. Contact the DOS.', 'error');
  }
  const dateStr = new Date().toISOString().split('T')[0];
  const selectedTerm = activeTerm || casTerms.find(t => t.is_active) || casTerms[0];

  Modal.show('Create Assessment — All Steps on One Page', `
    <style>
      .cas-section { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px; margin-bottom:14px; }
      .cas-section-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:#475569; margin-bottom:10px; display:flex; align-items:center; gap:8px; }
      .cas-section-title::after { content:""; flex:1; height:1px; background:#e2e8f0; }
      .cas-section .form-group { margin-bottom:10px; }
      .cas-section .form-group:last-child { margin-bottom:0; }
      .cas-preview { margin-top:10px; padding:10px 12px; border:1px dashed var(--blue-200); border-radius:8px; background:var(--blue-50); color:var(--blue-800); font-size:12px; }
    </style>
    <div class="cas-section">
      <div class="cas-section-title"><i data-lucide="file-text" style="width:14px;height:14px"></i> 1 — What is the assessment?</div>
      <div class="form-group"><label>Assessment Type <span class="required">*</span></label><select id="cas-type" class="select-field" onchange="casTypeChanged()">${casTypes.map((t, i) => `<option value="${t.id || ''}" data-name="${encodeURIComponent(t.name)}" data-default-max="${t.default_maximum_mark ?? ''}" ${i === 0 ? 'selected' : ''}>${Utils.escapeHtml(t.name)}${t.weight != null ? ' (w=' + t.weight + ')' : ''}</option>`).join('')}</select></div>
      <div id="cas-period-fields"></div>
      <div class="cas-preview"><i data-lucide="eye" style="width:13px;height:13px;vertical-align:middle;margin-right:4px"></i>Will display as: <strong id="cas-display-preview"></strong></div>
    </div>
    <div class="cas-section">
      <div class="cas-section-title"><i data-lucide="users" style="width:14px;height:14px"></i> 2 — Where is it taught?</div>
      <div class="form-group"><label>Subject <span class="required">*</span></label><select id="cas-subject" class="select-field" onchange="casSubjectChanged()"><option value="">Select subject</option>${subjectOptions.map(s => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}</select><p class="form-hint">Only subjects assigned to you.</p></div>
      <div class="form-group"><label>Class <span class="required">*</span></label><select id="cas-class" class="select-field"><option value="">Select class first</option></select><p class="form-hint">Only classes for the chosen subject.</p></div>
    </div>
    <div class="cas-section">
      <div class="cas-section-title"><i data-lucide="calendar" style="width:14px;height:14px"></i> 3 — When & how much?</div>
      <div class="form-row"><div class="form-group"><label>Academic Year</label><input class="input-field" value="${Utils.escapeHtml(years.find(y => String(y.id) === String(activeYear.id))?.name || activeYear.name || '')}" disabled></div><div class="form-group"><label>Term <span class="required">*</span></label><select id="cas-term" class="select-field">${casTerms.map(t => `<option value="${t.id}" ${selectedTerm && String(t.id) === String(selectedTerm.id) ? 'selected' : ''}>${Utils.escapeHtml(t.name)}</option>`).join('')}</select></div></div>
      <div class="form-row"><div class="form-group"><label>Assessment Date <span class="required">*</span></label><input id="cas-date" type="date" class="input-field" value="${dateStr}"></div><div class="form-group"><label>Maximum Marks <span class="required">*</span></label><input id="cas-max" type="number" inputmode="decimal" step="any" min="1" class="input-field" value="${casTypes[0]?.default_maximum_mark ?? 30}"><p class="form-hint">Any value above 0; marks entered are capped at this. Percentages use it, never 100.</p></div></div>
      <div class="form-group"><label>Weight <span class="text-muted">(optional, blank = type default)</span></label><input id="cas-weight" type="number" min="0" step="any" class="input-field" placeholder="e.g., 0.3"></div>
    </div>
    <div class="cas-section" style="margin-bottom:0">
      <div class="cas-section-title"><i data-lucide="align-left" style="width:14px;height:14px"></i> 4 — Notes (optional)</div>
      <div class="form-group"><textarea id="cas-desc" class="textarea-field" rows="3" placeholder="Optional notes about this assessment"></textarea></div>
    </div>
  `, `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-secondary" onclick="casSave('draft', this)"><i data-lucide="save"></i> Save Draft</button><button class="btn btn-primary" onclick="casSave('enter', this)"><i data-lucide="arrow-right"></i> Create & Enter Marks</button>`, true);
  casTypeChanged();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function casSubjectChanged() {
  const subjectId = document.getElementById('cas-subject')?.value || '';
  const classSelect = document.getElementById('cas-class');
  if (!classSelect) return;
  const myClassIds = new Set(teacherAssignments
    .filter(assignment => String(assignment.subject_id) === String(subjectId)
      && assignment.class_id
      && (!assignment.academic_year_id
        || String(assignment.academic_year_id) === String(activeYear?.id)))
    .map(assignment => String(assignment.class_id)));
  const opts = casClasses.filter(cls => myClassIds.has(String(cls.id)));
  classSelect.innerHTML = '<option value="">Select class</option>' + opts.map(cls =>
    `<option value="${cls.id}">${Utils.escapeHtml(cls.name)}</option>`
  ).join('');
  if (subjectId && !opts.length) {
    classSelect.innerHTML = '<option value="">No assigned classes for this subject and academic year</option>';
  }
}

function casTypeChanged() {
  const sel = document.getElementById('cas-type');
  const opt = sel && sel.selectedOptions[0];
  const maxEl = document.getElementById('cas-max');
  if (maxEl && opt && opt.dataset.defaultMax) maxEl.value = opt.dataset.defaultMax;
  casRenderPeriodFields();
}

function casSelectedType() {
  const sel = document.getElementById('cas-type');
  if (!sel) return null;
  if (sel.value) {
    const byId = casTypes.find(t => String(t.id) === String(sel.value));
    if (byId) return byId;
  }
  // Fallback rows have no id (value = ""); resolve by the canonical name the
  // option carries so period fields and labels still work.
  const opt = sel.selectedOptions && sel.selectedOptions[0];
  const name = opt && opt.dataset && opt.dataset.name ? decodeURIComponent(opt.dataset.name) : '';
  return (name && casTypes.find(t => t.name === name)) || null;
}

function casUnitNumberValue() {
  const sel = document.getElementById('cas-unit-number');
  const v = sel && sel.value;
  if (v && v !== '' && v !== 'custom') return v;
  if (v === 'custom') return (document.getElementById('cas-unit-custom')?.value || '').trim();
  return '';
}

function casUnitNumberChanged() {
  const sel = document.getElementById('cas-unit-number');
  const wrap = document.getElementById('cas-unit-custom-wrap');
  if (wrap) wrap.style.display = (sel && sel.value === 'custom') ? '' : 'none';
  casUpdatePreview();
}

function casRenderPeriodFields() {
  const container = document.getElementById('cas-period-fields');
  if (!container) return;
  const type = casSelectedType();
  const hint = Utils.getTypePeriodHint(type);
  const terms = casTerms;
  const selTerm = document.getElementById('cas-term')?.value || activeTerm?.id || (terms[0] && terms[0].id) || '';
  let html = '';
  if (hint === 'week') {
    html = `<div class="form-group"><label>Week Number <span class="required">*</span></label><select id="cas-week" class="select-field" onchange="casUpdatePreview()"><option value="">Select week</option>${Array.from({ length: 16 }, (_, i) => i + 1).map(w => `<option value="${w}">Week ${w}</option>`).join('')}</select></div>`;
  } else if (hint === 'month') {
    html = `<div class="form-group"><label>Month <span class="required">*</span></label><select id="cas-month" class="select-field" onchange="casUpdatePreview()"><option value="">Select month</option>${Utils.MONTH_LONG.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div>`;
  } else if (hint === 'term') {
    const t = terms.find(x => String(x.id) === String(selTerm));
    html = `<div class="form-group"><label>Term <span class="required">*</span></label><div class="text-sm font-semibold" id="cas-term-readout" style="padding:8px 12px;background:var(--gray-50);border:1px solid var(--gray-200);border-radius:8px">${t ? Utils.escapeHtml(t.name) : 'Select a term in section 3 below.'}</div><p class="form-hint">The term chosen in section 3 is applied automatically.</p></div>`;
  } else if (hint === 'unit') {
    html = `<div class="form-row">
      <div class="form-group"><label>Unit Number <span class="required">*</span></label>
        <select id="cas-unit-number" class="select-field" onchange="casUnitNumberChanged()"><option value="">Select unit number</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(n => `<option value="${n}">Unit ${n}</option>`).join('')}<option value="custom">Unit 16 and above...</option></select>
        <div id="cas-unit-custom-wrap" style="display:none;margin-top:8px"><input id="cas-unit-custom" type="number" min="16" class="input-field" placeholder="Unit number, e.g. 18" oninput="casUpdatePreview()"></div>
      </div>
      <div class="form-group"><label>Unit Name <span class="required">*</span></label><input id="cas-unit-name" class="input-field" placeholder="e.g., Fractions and Decimals" oninput="casUpdatePreview()"></div>
    </div>`;
  } else if (hint === 'other') {
    html = `<div class="form-group"><label>Assessment Name <span class="required">*</span></label><input id="cas-other-name" class="input-field" placeholder="Free-text name (only the Other type allows this)" oninput="casUpdatePreview()"></div>`;
  } else {
    html = `<div class="form-group"><label>Label <span class="text-muted">(optional — e.g. 1, 2, Session A)</span></label><input id="cas-label" class="input-field" placeholder="e.g., 1, 2, Session A" oninput="casUpdatePreview()"></div>`;
  }
  container.innerHTML = html;
  casUpdatePreview();
}

function casUpdatePreview() {
  const el = document.getElementById('cas-display-preview');
  if (!el) return;
  const type = casSelectedType();
  const hint = Utils.getTypePeriodHint(type);
  const typeName = type ? type.name : 'End-of-Unit Assessment';
  let label = typeName;
  if (hint === 'week') {
    const w = document.getElementById('cas-week')?.value;
    label = w ? typeName + ' — Week ' + w : typeName + ' — (week not set)';
  } else if (hint === 'month') {
    const m = document.getElementById('cas-month')?.value;
    label = m ? typeName + ' — ' + Utils.monthLabel(m) : typeName + ' — (month not set)';
  } else if (hint === 'term') {
    const t = casTerms.find(x => String(x.id) === String(document.getElementById('cas-term')?.value));
    label = t ? typeName + ' — ' + t.name : typeName + ' — (term not set)';
  } else if (hint === 'unit') {
    const un = casUnitNumberValue();
    const uName = (document.getElementById('cas-unit-name')?.value || '').trim();
    if (un && uName) label = typeName + ' — Unit ' + un + ': ' + uName;
    else if (un) label = typeName + ' — Unit ' + un;
    else if (uName) label = typeName + ' — ' + uName;
    else label = typeName + ' — (unit not set)';
  } else if (hint === 'other') {
    label = (document.getElementById('cas-other-name')?.value || '').trim() || '(name required for Other)';
  } else {
    const lb = (document.getElementById('cas-label')?.value || '').trim();
    label = lb ? typeName + ' — ' + lb : typeName;
  }
  el.textContent = label;
}

async function casSave(mode, btn) {
  const originalText = btn ? btn.innerHTML : '';
  const fail = (msg) => {
    if (btn) { btn.disabled = false; btn.innerHTML = originalText; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    Utils.toast(msg, 'error');
  };
  if (btn) { btn.disabled = true; btn.innerHTML = 'Saving...'; }

  const subjectId = document.getElementById('cas-subject').value;
  const classId = document.getElementById('cas-class').value;
  const typeSelect = document.getElementById('cas-type');
  const typeId = typeSelect ? typeSelect.value : null;
  const type = (typeId ? casTypes.find(t => String(t.id) === String(typeId)) : null)
    || casSelectedType()
    || null;
  const hint = Utils.getTypePeriodHint(type);
  const typeName = type ? type.name : 'End-of-Unit Assessment';

  let periodType = null, periodValue = null, periodLabel = null, unitNumber = null, unitName = null;
  let label = '';
  const termId = document.getElementById('cas-term').value;
  const date = document.getElementById('cas-date').value;
  const maximumMark = parseFloat(document.getElementById('cas-max').value);
  const weightRaw = document.getElementById('cas-weight').value.trim();
  const desc = document.getElementById('cas-desc').value.trim();

  if (hint === 'week') {
    periodType = 'week';
    periodValue = parseInt(document.getElementById('cas-week')?.value) || null;
    if (!periodValue) return fail('Select the week number');
    periodLabel = 'Week ' + periodValue;
    label = typeName + ' — Week ' + periodValue;
  } else if (hint === 'month') {
    periodType = 'month';
    periodValue = parseInt(document.getElementById('cas-month')?.value) || null;
    if (!periodValue) return fail('Select the month');
    periodLabel = Utils.monthLabel(periodValue);
    label = typeName + ' — ' + periodLabel;
  } else if (hint === 'term') {
    periodType = 'term';
    if (!termId) return fail('Select a term');
    const t = casTerms.find(x => String(x.id) === String(termId));
    periodLabel = t ? t.name : '';
    label = typeName + ' — ' + periodLabel;
  } else if (hint === 'unit') {
    periodType = 'unit';
    unitNumber = casUnitNumberValue();
    unitName = (document.getElementById('cas-unit-name')?.value || '').trim();
    if (!unitNumber) return fail('Enter the unit number');
    if (!unitName) return fail('Enter the unit name');
    periodValue = parseInt(unitNumber) || null;
    periodLabel = 'Unit ' + unitNumber;
    label = typeName + ' — Unit ' + unitNumber + ': ' + unitName;
  } else if (hint === 'other') {
    periodType = 'other';
    label = (document.getElementById('cas-other-name')?.value || '').trim();
    if (!label) return fail('Enter the assessment name');
  } else {
    label = typeName;
    const lb = (document.getElementById('cas-label')?.value || '').trim();
    if (lb) label = typeName + ' — ' + lb;
  }

  if (!subjectId) return fail('Select a subject');
  if (!classId) return fail('Select a class');
  if (!termId) return fail('Select a term');
  if (!date) return fail('Select the assessment date');
  if (!maximumMark || maximumMark <= 0) return fail('Enter a valid maximum mark (greater than 0)');

  const allowed = teacherAssignments.some(assignment =>
    String(assignment.subject_id) === String(subjectId)
      && String(assignment.class_id) === String(classId)
      && (!assignment.academic_year_id
        || String(assignment.academic_year_id) === String(activeYear?.id)));
  if (!allowed) return fail('You are not authorized for this class/subject combination');

  try {
    const [dbClasses, dbSubjects] = await Promise.all([DB.get('classes'), DB.get('subjects')]);
    const subj = dbSubjects.find(s => String(s.id) === String(subjectId));
    const cls = dbClasses.find(c => String(c.id) === String(classId));
    if (subj && cls && Scope.isScoped() && (!Scope.matchesSubject(subj) || !Scope.matchesClass(cls))) {
      return fail('This class/subject combination is outside your education-level scope. Primary subjects cannot be assigned to Secondary classes, and vice versa.');
    }
  } catch (e) { /* ignore */ }

  const teacherId = Auth.getTeacherId();
  if (!teacherId) return fail('Your account is not linked to a teacher profile. Contact the DOS.');

  try {
    const { count: _learnerCount } = await sbClient.from('learners').select('id', { count: 'exact', head: true }).eq('class_id', classId).eq('status', 'active');
    if (!_learnerCount) return fail('There is no student in this class — register learners in this class first before creating an assessment.');
  } catch (e) { /* ignore count error */ }

  const data = {
    name: label,
    display_name: label,
    assessment_type_id: Utils.isValidUuid(typeId) ? typeId : null,
    period_type: periodType,
    period_value: periodValue,
    period_label: periodLabel,
    unit_number: (hint === 'unit') ? periodValue : null,
    unit_name: (hint === 'unit') ? unitName : null,
    unit: (hint === 'unit') ? ('Unit ' + unitNumber + (unitName ? ' - ' + unitName : '')) : null,
    class_id: classId,
    subject_id: subjectId,
    teacher_id: teacherId,
    academic_year_id: activeYear.id,
    term_id: termId || null,
    maximum_mark: maximumMark,
    weight: weightRaw === '' ? null : parseFloat(weightRaw),
    assessment_date: date,
    description: desc || null,
    status: 'draft'
  };

  try {
    const assessmentId = window.crypto?.randomUUID?.();
    if (!assessmentId) return fail('Secure assessment ID generation is unavailable. Please use a supported browser over HTTPS.');
    const { error } = await sbClient.from('assessments').insert({ ...data, id: assessmentId });
    if (error) throw error;
    DB.invalidate('assessments');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
    Utils.toast('Assessment created — synced', 'success');
    Modal.close();
    if (mode === 'enter') {
      Router.go('teacher/enter-marks?assessment=' + assessmentId);
    } else {
      renderEnterMarks();
    }
  } catch (e) {
    fail('Error: ' + e.message);
  }
}

function convertCompute(mark, curMax, target) {
  const raw = (Number(mark) / Number(curMax)) * Number(target);
  const decimals = markSettings?.decimal_marks_enabled ? 1 : 0;
  const factor = Math.pow(10, decimals);
  return Math.round(raw * factor) / factor;
}

async function openConvertMarks() {
  if (!markAssessment) return;
  const curMax = Number(markAssessment.maximum_mark) || 0;
  if (!curMax) return Utils.toast('This assessment has no maximum mark set', 'error');
  const rows = markEntries.filter(e => e.mark !== '' && e.mark != null && e.markId);
  if (!rows.length) return Utils.toast('No marks saved yet. Save a draft first, then convert.', 'error');
  const [grading, settingsData] = await Promise.all([Utils.getGradingScale(), DB.query('school_settings', '*')]);
  convertState = {
    rows,
    scope: 'all',
    selected: new Set(rows.map(r => r.learnerId)),
    target: curMax,
    grading,
    pass: (settingsData[0]?.pass_mark ?? markSettings.pass_mark ?? 50)
  };
  Modal.show('Convert Marks', `
    <style>
      .cv-chip { padding:6px 12px; border:1px solid var(--gray-200); border-radius:8px; background:#fff; cursor:pointer; font-size:12px; font-weight:600; color:var(--gray-600); }
      .cv-chip.active { border-color:var(--blue-500); background:var(--blue-50); color:var(--blue-700); }
    </style>
    <div class="notice mb-2" style="margin-bottom:12px"><i data-lucide="arrow-left-right" style="width:15px;height:15px;vertical-align:middle;margin-right:6px"></i>Convert every learner's saved mark to a new maximum, keeping each learner's percentage the same. Original marks are stored so nothing is lost. This cannot affect locked/approved assessments and only applies to <strong>draft</strong> marks.</div>
    <div class="form-row">
      <div class="form-group"><label>Current Maximum</label><input class="input-field" value="${curMax}" disabled></div>
      <div class="form-group"><label>Saved Marks</label><input class="input-field" value="${rows.length}" disabled></div>
      <div class="form-group"><label>New Maximum Marks <span class="required">*</span></label><input id="cv-target-input" type="number" min="1" step="any" class="input-field" value="${curMax}" oninput="convertTargetChanged()"></div>
    </div>
    <div class="flex gap-2" style="margin:-4px 0 14px;flex-wrap:wrap">
      ${[20, 30, 40, 50, 60, 70, 100].map(m => `<button type="button" class="cv-chip ${m === curMax ? 'active' : ''}" onclick="convertSetTarget(${m})">${m}</button>`).join('')}
    </div>
    <div class="flex gap-2" style="margin-bottom:14px">
      <label class="flex items-center gap-2" style="font-size:13px"><input type="radio" name="cv-scope" value="all" checked onchange="convertScope('all')"> All learners with marks</label>
      <label class="flex items-center gap-2" style="font-size:13px"><input type="radio" name="cv-scope" value="selected" onchange="convertScope('selected')"> Selected learners only</label>
    </div>
    <div style="max-height:260px;overflow:auto;border:1px solid var(--gray-200);border-radius:10px">
      <table class="table" style="margin:0">
        <thead><tr><th>Learner</th><th>Current</th><th>Now</th><th>New</th><th>New %</th><th>Grade</th><th>Result</th></tr></thead>
        <tbody id="cv-preview-body"></tbody>
      </table>
    </div>
  `, `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="applyConvertMarks()"><i data-lucide="arrow-left-right"></i> Preview & Convert</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  convertPreviewRender();
}

function convertPreviewRender() {
  const tbody = document.getElementById('cv-preview-body');
  if (!tbody || !convertState) return;
  const curMax = Number(markAssessment.maximum_mark) || 0;
  const target = convertState.target || 0;
  const rows = convertState.rows.filter(r => convertState.scope === 'all' ? true : convertState.selected.has(r.learnerId));
  tbody.innerHTML = rows.map(r => {
    const nm = target ? convertCompute(Number(r.mark), curMax, target) : 0;
    const pct = target ? Utils.pct(nm, target) : 0;
    const grade = target ? Utils.grade(pct, convertState.grading) : '';
    const pf = target ? Utils.passFail(pct, convertState.pass) : '';
    const checked = convertState.selected.has(r.learnerId);
    return `<tr>
      <td>${Utils.escapeHtml(r.name)}</td>
      <td class="text-muted">${r.mark}<span class="text-muted"> / ${curMax}</span></td>
      <td class="text-muted">${Utils.pct(Number(r.mark), curMax).toFixed(1)}%</td>
      <td><strong>${nm}</strong><span class="text-muted"> / ${target}</span></td>
      <td>${pct.toFixed(1)}%</td>
      <td>${grade}</td>
      <td>${pf}</td>
      ${convertState.scope === 'selected' ? `<td><input type="checkbox" ${checked ? 'checked' : ''} onchange="convertToggleLearner('${r.learnerId}', this.checked)"></td>` : ''}
    </tr>`;
  }).join('');
  const info = document.getElementById('cv-selection-info');
  if (info) info.textContent = `Converting ${rows.length} of ${convertState.rows.length} saved marks.`;
}

function convertSetTarget(val) {
  const el = document.getElementById('cv-target-input');
  if (el) el.value = val;
  document.querySelectorAll('.cv-chip').forEach(c => c.classList.toggle('active', Number(c.textContent) === Number(el?.value)));
  convertTargetChanged();
}

function convertTargetChanged() {
  const el = document.getElementById('cv-target-input');
  convertState.target = el ? Number(el.value) || 0 : 0;
  if (el) document.querySelectorAll('.cv-chip').forEach(c => c.classList.toggle('active', Number(c.textContent) === Number(el.value)));
  convertPreviewRender();
}

function convertScope(scope) {
  if (!convertState) return;
  convertState.scope = scope;
  if (scope === 'selected' && convertState.selected.size === 0) {
    convertState.selected = new Set(convertState.rows.map(r => r.learnerId));
  }
  convertPreviewRender();
}

function convertToggleLearner(learnerId, checked) {
  if (!convertState) return;
  if (checked) convertState.selected.add(learnerId);
  else convertState.selected.delete(learnerId);
}

function applyConvertMarks() {
  if (!convertState) return;
  const target = convertState.target || 0;
  const curMax = Number(markAssessment.maximum_mark) || 0;
  if (!target || target <= 0) return Utils.toast('Enter a valid new maximum mark', 'error');
  if (target === curMax) return Utils.toast('New maximum is the same as the current one. Change it first.', 'error');
  const rows = convertState.rows.filter(r => convertState.selected.has(r.learnerId));
  if (!rows.length) return Utils.toast('Select at least one learner with a saved mark', 'error');

  const statusBlocked = ['locked', 'approved', 'submitted'].includes(markAssessment.status);
  if (statusBlocked) { Modal.close(); Utils.toast('This assessment no longer allows edits — it has been locked/approved/submitted.', 'error'); return; }

  Modal.confirm('Convert ' + rows.length + ' marks?',
    `This proportionally re-scales ${rows.length} saved mark(s) from a maximum of <strong>${curMax}</strong> to <strong>${target}</strong>.<br><br>Each learner's percentage, grade, remark and PASS/FAIL are recalculated against the new maximum. Original marks are preserved for audit and can be reviewed in reports.`,
    () => doConvertMarks(curMax, target, rows),
    'Convert & Save'
  );
}

async function doConvertMarks(curMax, target, rows) {
  Modal.close();
  try {
    const now = new Date().toISOString();
    const teacherId = Auth.getTeacherId();
    for (const r of rows) {
      const oldMark = Number(r.mark);
      const newMark = convertCompute(oldMark, curMax, target);
      const result = Utils.assessmentResult(newMark, target, convertState.grading);
      const pct = result.percentage;
      if (pct == null) throw new Error('Target maximum mark must be greater than zero.');
      const patch = {
        mark: newMark,
        normalized_mark: result.normalized_mark,
        percentage: pct,
        grade: result.grade,
        remark: result.remark,
        updated_at: now
      };
      if (r.markId) {
        const { data: existing } = await sbClient.from('marks').select('original_mark, original_maximum').eq('id', r.markId).single();
        if (existing && existing.original_mark == null) { patch.original_mark = oldMark; patch.original_maximum = curMax; }
        else if (existing && existing.original_maximum == null) { patch.original_maximum = curMax; }
        const { error } = await sbClient.from('marks').update(patch).eq('id', r.markId);
        if (error) throw error;
      }
    }
    const { error: asErr } = await sbClient.from('assessments').update({
      maximum_mark: target,
      converted_from_maximum: curMax,
      converted_at: now,
      converted_by: teacherId
    }).eq('id', markAssessment.id);
    if (asErr) throw asErr;

    await sbClient.from('audit_logs').insert({
      user_id: Auth.currentUser?.id,
      user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role,
      action: 'MARKS_CONVERTED',
      assessment_id: markAssessment.id,
      old_value: 'Maximum ' + curMax + ' -> ' + target,
      new_value: 'Converted ' + rows.length + ' marks to a maximum of ' + target,
      timestamp: now
    });

    DB.invalidateMany(['marks', 'assessments', 'audit_logs']);
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
    convertState = null;
    Utils.toast('Converted ' + rows.length + ' marks to a maximum of ' + target, 'success');
    renderMarksEntry(markAssessment.id);
  } catch (e) {
    convertState = null;
    Utils.toast('Conversion error: ' + e.message, 'error');
  }
}

async function renderMarksEntry(assessId) {
  setHeader('Enter Marks', 'Enter and manage marks for your assessment');
  setContent(Utils.loading());

  const targetAssessment = await DB.getRelated('assessments', '*', { id: assessId });
  if (!targetAssessment.length) { setContent(Utils.empty('Assessment not found', 'file-x')); return; }
  markAssessment = targetAssessment[0];
  /* Conversion helpers live only on the Convert Marks page — never opened here. */
  if (Utils.isConversionHelper && Utils.isConversionHelper(markAssessment)) {
    setContent(Utils.empty('Conversion helpers live only on the Convert Marks page', 'calculator'));
    return;
  }
  const totalMax = Number(markAssessment.maximum_mark) || 0;

  const teacherId = Auth.getTeacherId();
  const allowed = teacherAssignments.some(a => a.class_id === markAssessment.class_id && a.subject_id === markAssessment.subject_id);
  const isOwnAssessment = markAssessment.teacher_id === teacherId;
  if (!Auth.isAdmin() && (!allowed || !isOwnAssessment)) {
    setContent(Utils.empty('You are not authorized to access this assessment', 'shield-x'));
    return;
  }

  const [existingMarks, gradingData, settingsData, clsData, subData, types] = await Promise.all([
    DB.query('marks', '*', { assessment_id: assessId }),
    Utils.getGradingScale(),
    DB.query('school_settings', '*'),
    DB.getRelated('classes', '*', { id: markAssessment.class_id }),
    DB.getRelated('subjects', '*', { id: markAssessment.subject_id }),
    getAssessmentTypes()
  ]);

  const settings = settingsData[0] || { pass_mark: 50, assessment_roster_policy: 'auto_add' };
  markSettings = settings;

  /* Roster policy (school setting): 'auto_add' (default) loads the live class
     roster so newly registered learners appear immediately; 'freeze_on_submit'
     loads the roster snapshot recorded when the assessment was submitted. */
  const rosterPolicy = settings.assessment_roster_policy || 'auto_add';
  const frozenRoster = Array.isArray(markAssessment.roster_learner_ids) && markAssessment.roster_learner_ids.length
    ? markAssessment.roster_learner_ids
    : null;

  let learners;
  if (rosterPolicy === 'freeze_on_submit' && frozenRoster) {
    const { data } = await sbClient.from('learners').select('*').in('id', frozenRoster).order('full_name', { ascending: true });
    learners = data || [];
  } else {
    learners = await DB.query('learners', '*', { class_id: markAssessment.class_id, status: 'active' }, { column: 'full_name', asc: true });
  }

  let rosterNote;
  if (rosterPolicy === 'freeze_on_submit' && frozenRoster) {
    rosterNote = 'Assessment roster was frozen when the marks were submitted. New learners must be registered before submission to be included.';
  } else if (rosterPolicy === 'freeze_on_submit') {
    rosterNote = 'Roster mode: frozen on submission. Until then, newly registered learners in this class appear automatically.';
  } else {
    rosterNote = 'Roster mode: live class roster. Newly registered learners appear automatically.';
  }
  const marksMap = {};
  existingMarks.forEach(m => { marksMap[m.learner_id] = m; });

  markEntries = learners.map(l => {
    const em = marksMap[l.id];
    const markVal = em?.mark != null ? em.mark.toString() : '';
    const normalized = markVal
      ? Utils.normalizedMark(parseFloat(markVal), markAssessment.maximum_mark)
      : 0;
    const pct = normalized == null ? 0 : normalized;
    return {
      learnerId: l.id,
      name: l.full_name,
      code: l.learner_code,
      gender: l.gender,
      mark: markVal,
      pct,
      grade: markVal ? Utils.grade(pct, gradingData) : '',
      remark: markVal ? Utils.remark(pct, gradingData) : '',
      pf: Utils.passFail(pct, settings.pass_mark),
      markId: em?.id || null,
      existingStatus: em?.status || 'draft'
    };
  });

  const isLocked = ['locked', 'approved'].includes(markAssessment.status);
  const isSubmitted = markAssessment.status === 'submitted';
  const isRejected = markAssessment.status === 'rejected';
  const entered = markEntries.filter(e => e.mark !== '' && e.mark != null).length;
  const total = markEntries.length;
  const pctDone = total ? Math.round(entered / total * 100) : 0;
  const validMarks = markEntries.filter(e => e.mark !== '' && e.mark != null).map(e => parseFloat(e.mark));
  const maxM = markAssessment.maximum_mark;
  const stats = Utils.classStats(validMarks, maxM);
  const cls = clsData[0];
  const sub = subData[0];

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <button class="btn btn-secondary" onclick="Router.go('teacher/enter-marks')"><i data-lucide="arrow-left"></i> Back to Assessments</button>
      <div class="flex gap-2" style="flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="renderEnterMarks()"><i data-lucide="refresh-cw"></i> Refresh</button>
        <button class="btn btn-outline" onclick="downloadMarksTemplateForCurrentAssessment()" title="Download marks template"><i data-lucide="download"></i> Download</button>
        ${!isLocked && !isSubmitted ? `<button class="btn btn-outline" onclick="openConvertMarks()" title="Proportionally convert marks to a new maximum"><i data-lucide="arrow-left-right"></i> Convert Marks</button>` : ''}
        ${!isLocked && !isSubmitted ? `<button class="btn btn-primary" onclick="MarksImport.open({ assessmentId: '${markAssessment.id}' })"><i data-lucide="file-up"></i> Import</button>` : ''}
        ${!isLocked && !isSubmitted ? `<button class="btn btn-secondary" onclick="saveMarks()"><i data-lucide="save"></i> Save Draft</button>` : ''}
      </div>
    </div>

    <div class="card mb-6">
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:16px">
        <div>
          <h2 class="font-bold" style="font-size:20px;color:var(--gray-900)">${Utils.escapeHtml(sub?.name || '')} â€” ${Utils.escapeHtml(cls?.name || '')}</h2>
          <p class="text-sm text-muted" style="margin-top:2px"><strong style="color:var(--gray-700)">${Utils.escapeHtml(assessmentTypeName(types, markAssessment.assessment_type_id, 'Assessment'))}:</strong> ${Utils.escapeHtml(Utils.buildAssessmentDisplayName(markAssessment, types))}</p>
          <p class="text-sm text-muted" style="margin-top:2px">${Utils.dateStr(markAssessment.assessment_date)} | Maximum Mark: <strong style="color:var(--blue-600)">${maxM}</strong></p>
          ${markAssessment.converted_from_maximum ? `<p class="text-sm" style="margin-top:2px"><span class="status-pill" style="background:var(--blue-50);color:var(--blue-700)">Converted from a maximum of ${Utils.escapeHtml(markAssessment.converted_from_maximum)} to ${maxM}</span></p>` : ''}
        </div>
        <div class="flex items-center gap-2">
          <span id="save-status" style="font-size:12px;color:var(--gray-500)"></span>
          <span class="badge ${entryStatusBadge(entered, total)}"><i data-lucide="${entryStatusIcon(markAssessment.status)}"></i> ${entryStatusLabel(markAssessment.status, entered)}</span>
        </div>
      </div>
      ${isRejected && markAssessment.rejection_reason ? `
      <div class="alert alert-error mt-4" style="margin-bottom:0">
        <i data-lucide="alert-circle"></i>
        <div><strong>Assessment Rejected</strong><br>Reason: ${Utils.escapeHtml(markAssessment.rejection_reason)}</div>
      </div>` : ''}
    </div>

    <p class="text-xs text-muted" style="margin-bottom:16px"><i data-lucide="users" style="width:12px;height:12px;vertical-align:middle;margin-right:4px"></i>${rosterNote}</p>
    ${!total ? `<div class="alert alert-warning" style="margin-bottom:16px"><i data-lucide="alert-triangle"></i><div><strong>There is no student in this class.</strong> Register learners in <strong>${Utils.escapeHtml(cls?.name || 'this class')}</strong> first — the roster is empty so no marks can be entered.</div></div>` : ''}

    <div class="grid-4 mb-6">
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)"><i data-lucide="target"></i></div>
        <div class="stat-value">/${maxM}</div>
        <div class="stat-label">Max Mark</div>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--amber-50);color:var(--amber-600)"><i data-lucide="loader"></i></div>
        <div class="stat-value" style="color:var(--blue-600)">${entered}/${total}</div>
        <div class="stat-label">Marks Entered</div>
        <div class="progress-bar" style="margin-top:8px"><div class="progress-bar-fill ${pctDone === 100 ? 'green' : pctDone > 0 ? 'amber' : ''}" style="width:${pctDone}%"></div></div>
        <p class="text-xs text-muted" style="margin-top:4px">${pctDone}% complete</p>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--green-50);color:var(--green-600)"><i data-lucide="bar-chart-3"></i></div>
        <div class="stat-value">${stats.avg}%</div>
        <div class="stat-label">Class Average</div>
        <p class="text-xs text-muted">H: ${stats.high}% L: ${stats.low}%</p>
      </div>
      <div class="stat-card">
        <div class="stat-icon" style="background:var(--red-50);color:var(--red-500)"><i data-lucide="check-circle-2"></i></div>
        <div class="flex gap-4" style="margin-top:4px">
          <span class="font-bold" style="color:var(--green-600)">${stats.pass} PASS</span>
          <span class="font-bold" style="color:var(--red-500)">${stats.fail} FAIL</span>
        </div>
        <div class="stat-label">Pass / Fail</div>
      </div>
    </div>

    <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap;gap:12px">
      <div class="search-input-wrapper" style="flex:1;min-width:200px;max-width:360px">
        <i data-lucide="search"></i>
        <input class="input-field" placeholder="Search learner name or code" onkeyup="filterMarksTable()">
      </div>
      <div class="flex gap-2 items-center" style="flex-wrap:wrap">
        <select class="select-field" id="marks-filter" style="width:auto;min-width:140px" onchange="filterMarksTable()">
          <option value="all">All</option>
          <option value="entered">Marks entered</option>
          <option value="missing">Marks missing</option>
          <option value="passed">Passed</option>
          <option value="failed">Failed</option>
        </select>
      </div>
    </div>

    <div class="card">
      <div class="table-container"><table class="data-table" id="marks-table">
        <thead><tr><th>No.</th><th>Learner</th><th>Gender</th><th>Mark /${maxM}</th><th>%</th><th>Grade</th><th>Pass/Fail</th><th>Remark</th></tr></thead>
        <tbody id="marks-table-body">${markRowsHTMLCurrent()}</tbody>
      </table></div>
      <div id="marks-footer" style="padding-top:16px;border-top:1px solid var(--gray-200)">${marksFooterHTMLCurrent()}</div>
    </div>`);
}

function entryStatusLabel(status, entered) {
  if (status === 'draft') return entered > 0 ? 'In Progress' : 'Not Started';
  return status;
}

function entryStatusIcon(status) {
  const m = { approved: 'check-circle-2', locked: 'lock', submitted: 'send', rejected: 'x-circle', draft: 'file-edit' };
  return m[status] || 'circle';
}

function entryStatusBadge(entered, total) {
  const status = markAssessment.status;
  if (status === 'draft') return entered > 0 ? 'badge-info' : 'badge-warning';
  return Utils.statusColor(status);
}

function markRowsHTMLCurrent() {
  const isLocked = ['locked', 'approved'].includes(markAssessment.status);
  const isSubmitted = markAssessment.status === 'submitted';
  const inputDisabled = isLocked || isSubmitted;
  const maxM = markAssessment.maximum_mark;
  const settingStr = '0.5';

  return markEntries.map((e, i) => {
    const hasMark = e.mark !== '' && e.mark != null;
    return `<tr class="${!hasMark && !inputDisabled ? 'table-highlight' : ''}" data-mark-index="${i}" data-hasmark="${hasMark ? '1' : '0'}">
      <td class="text-muted">${i + 1}</td>
      <td><div class="col-name">${Utils.escapeHtml(e.name)}</div><div class="text-xs text-muted">${Utils.escapeHtml(e.code)}</div></td>
      <td class="text-center"><span class="badge ${e.gender === 'M' ? 'badge-info' : 'badge-danger'}">${e.gender === 'M' ? 'M' : 'F'}</span></td>
      <td><input type="number" class="input-field" style="width:84px;text-align:center" value="${e.mark}" min="0" max="${maxM}" step="${settingStr}" ${inputDisabled ? 'disabled' : ''} onchange="updateMark(${i},this.value)" onkeyup="if(event.key==='Tab'||event.key==='Enter')updateMark(${i},this.value)" placeholder="0"></td>
      <td class="font-semibold">${hasMark ? e.pct + '%' : '-'}</td>
      <td>${e.grade ? `<span class="badge badge-info">${e.grade}</span>` : '-'}</td>
      <td>${hasMark ? `<span class="badge ${e.pf === 'PASS' ? 'badge-success' : 'badge-danger'}">${e.pf}</span>` : '-'}</td>
      <td class="text-sm">${Utils.escapeHtml(e.remark || '-')}</td>
    </tr>`;
  }).join('');
}

function marksFooterHTMLCurrent() {
  const isLocked = ['locked', 'approved'].includes(markAssessment.status);
  const isSubmitted = markAssessment.status === 'submitted';
  if (isLocked) {
    return '<div class="text-center text-sm text-muted"><i data-lucide="lock" style="width:14px;height:14px;vertical-align:middle;margin-right:4px"></i>Assessment is locked. Contact DOS to unlock.</div>';
  }
  if (isSubmitted) {
    return '<div class="text-center"><p class="text-sm font-semibold" style="color:var(--blue-600)"><i data-lucide="send" style="width:14px;height:14px;vertical-align:middle;margin-right:4px"></i>Marks submitted. Waiting for DOS approval.</p></div>';
  }
  return `<div class="flex justify-between items-center" style="flex-wrap:wrap;gap:12px">
    <p class="text-sm text-muted"><i data-lucide="info" style="width:14px;height:14px;vertical-align:middle;margin-right:4px"></i>Changes are saved automatically. You can also save manually.</p>
    <div class="flex gap-2">
      <button class="btn btn-secondary" onclick="saveMarks()"><i data-lucide="save"></i> Save Draft</button>
      <button class="btn btn-primary" onclick="openSubmitConfirm()"><i data-lucide="send"></i> Submit Marks for Approval</button>
    </div>
  </div>`;
}

function filterMarksTable() {
  const q = document.querySelector('.search-input-wrapper input')?.value.toLowerCase() || '';
  const filter = document.getElementById('marks-filter')?.value || 'all';
  const rows = document.querySelectorAll('#marks-table-body tr');
  rows.forEach(row => {
    const idx = parseInt(row.dataset.markIndex);
    const e = markEntries[idx];
    if (!e) { row.style.display = ''; return; }
    const matchesQ = !q || (e.name + ' ' + e.code).toLowerCase().includes(q);
    const hasMark = e.mark !== '' && e.mark != null;
    let matchesF = true;
    if (filter === 'entered') matchesF = hasMark;
    else if (filter === 'missing') matchesF = !hasMark;
    else if (filter === 'passed') matchesF = hasMark && e.pf === 'PASS';
    else if (filter === 'failed') matchesF = hasMark && e.pf === 'FAIL';
    row.style.display = matchesQ && matchesF ? '' : 'none';
  });
}

function updateMark(index, value) {
  if (!markAssessment) return;
  const maxMark = markAssessment.maximum_mark;

  if (value !== '' && value != null) {
    const n = parseFloat(value);
    if (!Number.isFinite(n) || n < 0 || n > maxMark
      || Utils.normalizedMark(n, maxMark) == null) {
      showMarkError(`Invalid mark. Enter a value between 0 and ${maxMark}.`);
      const input = document.querySelector(`#marks-table-body tr[data-mark-index="${index}"] input`);
      if (input) input.value = markEntries[index].mark || '';
      return;
    }
  }

  const e = markEntries[index];
  e.mark = value;
  const normalized = (value !== '' && value != null)
    ? Utils.normalizedMark(parseFloat(value), maxMark)
    : 0;
  const pct = normalized == null ? 0 : normalized;
  e.pct = pct;

  Utils.getGradingScale().then(scale => {
    e.grade = (value !== '' && value != null) ? Utils.grade(pct, scale) : '';
    e.remark = (value !== '' && value != null) ? Utils.remark(pct, scale) : '';
    e.pf = (value !== '' && value != null) ? Utils.passFail(pct, markSettings.pass_mark) : '';

    const row = document.querySelector(`#marks-table-body tr[data-mark-index="${index}"]`);
    if (row) {
      const tds = row.querySelectorAll('td');
      if (value !== '' && value != null) {
        tds[4].innerHTML = '<span class="font-semibold">' + e.pct + '%</span>';
        tds[5].innerHTML = `<span class="badge badge-info">${e.grade}</span>`;
        tds[6].innerHTML = `<span class="badge ${e.pf === 'PASS' ? 'badge-success' : 'badge-danger'}">${e.pf}</span>`;
        tds[7].textContent = e.remark;
        row.dataset.hasmark = '1';
      } else {
        tds[4].textContent = '-';
        tds[5].textContent = '-';
        tds[6].textContent = '-';
        tds[7].textContent = '-';
        row.dataset.hasmark = '0';
      }
    }
    updateStatsBar();
  });

  showSaveStatus('saving');
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => saveMarks(true), 2000);
}

function showMarkError(msg) {
  const existing = document.getElementById('mark-error');
  if (existing) existing.remove();
  const div = document.createElement('div');
  div.id = 'mark-error';
  div.className = 'alert alert-error';
  div.innerHTML = '<i data-lucide="alert-circle"></i> ' + msg;
  const content = document.getElementById('main-content') || document.querySelector('.main-content');
  if (content) content.insertAdjacentElement('afterbegin', div);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  setTimeout(() => { const el = document.getElementById('mark-error'); if (el) el.remove(); }, 3000);
}

function showSaveStatus(state) {
  const el = document.getElementById('save-status');
  if (!el) return;
  if (state === 'saving') {
    el.innerHTML = '<span style="color:var(--amber-600)"><i data-lucide="loader" style="width:12px;height:12px;vertical-align:middle;margin-right:4px"></i>Saving...</span>';
  } else if (state === 'saved') {
    el.innerHTML = '<span style="color:var(--green-600)"><i data-lucide="check-circle-2" style="width:12px;height:12px;vertical-align:middle;margin-right:4px"></i>All changes saved</span>';
  } else if (state === 'error') {
    el.innerHTML = '<span style="color:var(--red-500);cursor:pointer" onclick="saveMarks()"><i data-lucide="alert-circle" style="width:12px;height:12px;vertical-align:middle;margin-right:4px"></i>Save failed â€” Retry</span>';
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function updateStatsBar() {
  const entered = markEntries.filter(e => e.mark !== '' && e.mark != null).length;
  const cards = document.querySelectorAll('.grid-4 .stat-card');
  if (cards.length >= 4) {
    cards[1].querySelector('.stat-value').textContent = `${entered}/${markEntries.length}`;
    const pct = markEntries.length ? Math.round(entered / markEntries.length * 100) : 0;
    cards[1].querySelector('.progress-bar-fill').style.width = pct + '%';
    cards[1].querySelector('.text-xs').textContent = pct + '% complete';
  }
}

async function saveMarks(isAuto = false) {
  if (!markAssessment) return;
  if (isAuto) showSaveStatus('saving');

  const toSave = markEntries.filter(e => e.mark !== '' && e.mark != null);
  if (toSave.length && Utils.normalizedMark(toSave[0].mark, markAssessment.maximum_mark) == null) {
    showSaveStatus('error');
    Utils.toast('Assessment maximum mark must be greater than zero before marks can be saved.', 'error');
    return;
  }

  try {
    for (const e of toSave) {
      const data = {
        assessment_id: markAssessment.id,
        learner_id: e.learnerId,
        mark: parseFloat(e.mark),
        normalized_mark: e.pct,
        percentage: e.pct,
        grade: e.grade,
        remark: e.remark,
        status: markAssessment.status === 'draft' ? 'draft' : e.existingStatus === 'submitted' ? 'submitted' : 'draft'
      };
      if (e.markId) {
        const { error } = await sbClient.from('marks').update(data).eq('id', e.markId);
        if (error) throw error;
      } else {
        data.original_mark = parseFloat(e.mark);
        data.original_maximum = Number(markAssessment.maximum_mark);
        const { data: newMark, error } = await sbClient.from('marks').insert(data).select().single();
        if (error) throw error;
        e.markId = newMark.id;
      }
    }
    // === SYNC EVERYWHERE: marks changed → invalidate caches so Analytics/Reports/DOS see fresh data ===
    DB.invalidate('marks');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
    if (isAuto) {
      showSaveStatus('saved');
      setTimeout(() => { const el = document.getElementById('save-status'); if (el) el.innerHTML = ''; }, 3000);
    } else {
      Utils.toast('Marks saved — synced to Analytics, Reports & DOS', 'success');
      showSaveStatus('saved');
      setTimeout(() => { const el = document.getElementById('save-status'); if (el) el.innerHTML = ''; }, 2000);
    }
  } catch (e) {
    showSaveStatus('error');
    if (!isAuto) Utils.toast('Error saving: ' + e.message, 'error');
  }
}

async function openSubmitConfirm() {
  /* Conversion helpers are working copies for external use (e.g. CAMIS
     export) — they must never enter the official approval/report chain. */
  if (Utils.isConversionHelper && Utils.isConversionHelper(markAssessment)) {
    Utils.toast('Conversion helpers cannot be submitted — they are excluded from official reports. Export them instead.', 'error');
    return;
  }
  const entered = markEntries.filter(e => e.mark !== '' && e.mark != null).length;
  const total = markEntries.length;
  const missing = total - entered;
  const cls = (await DB.getRelated('classes', 'name', { id: markAssessment.class_id }))[0];
  const sub = (await DB.getRelated('subjects', 'name', { id: markAssessment.subject_id }))[0];

  const missingWarn = missing > 0
    ? `<div class="alert alert-warning" style="margin-bottom:0"><i data-lucide="alert-triangle"></i><div><strong>${missing} learner${missing > 1 ? 's' : ''} do not have marks entered.</strong><br>You can still submit, but the DOS will see missing marks.</div></div>`
    : `<div class="alert alert-success" style="margin-bottom:0"><i data-lucide="check-circle-2"></i> All ${total} learners have marks entered.</div>`;

  Modal.show('Submit Marks for Approval?', `
    <p class="text-sm text-muted mb-4">You are about to submit the marks for this assessment to the DOS for review. After submission, you will not be able to edit the marks unless the DOS reopens the assessment.</p>
    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:16px;margin-bottom:16px">
      <div class="flex justify-between mb-2"><span class="text-sm text-muted">Class</span><span class="text-sm font-semibold">${Utils.escapeHtml(cls?.name || '-')}</span></div>
      <div class="flex justify-between mb-2"><span class="text-sm text-muted">Subject</span><span class="text-sm font-semibold">${Utils.escapeHtml(sub?.name || '-')}</span></div>
      <div class="flex justify-between mb-2"><span class="text-sm text-muted">Assessment</span><span class="text-sm font-semibold">${Utils.escapeHtml(markAssessment.name || markAssessment.unit || '-')}</span></div>
      <div class="flex justify-between mb-2"><span class="text-sm text-muted">Learners</span><span class="text-sm font-semibold">${total}</span></div>
      <div class="flex justify-between mb-2"><span class="text-sm text-muted">Marks entered</span><span class="text-sm font-semibold">${entered}</span></div>
      <div class="flex justify-between"><span class="text-sm text-muted">Marks missing</span><span class="text-sm font-semibold" style="color:${missing > 0 ? 'var(--red-500)' : 'var(--green-600)'}">${missing}</span></div>
    </div>
    ${missingWarn}`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="submitMarks()"><i data-lucide="send"></i> Submit for Approval</button>`);
}

async function submitMarks() {
  try {
    Modal.close();

    /* Stale-data guard: confirm the assessment is still editable before
       flipping it to submitted (another user/device may have changed it). */
    const { data: fresh, error: freshErr } = await sbClient.from('assessments')
      .select('status').eq('id', markAssessment.id).single();
    if (freshErr) throw freshErr;
    if (fresh && fresh.status !== 'draft' && fresh.status !== 'rejected') {
      Utils.toast('Assessment was already ' + fresh.status + ' by the DOS. Refreshing...', 'error');
      renderEnterMarks();
      return;
    }

    /* Snapshot the roster so a 'freeze_on_submit' policy can keep the
       assessment roster fixed after submission. Gracefully skips the
       snapshot if the column has not been added by the migration yet. */
    try {
      await sbClient.from('assessments')
        .update({ roster_learner_ids: markEntries.map(e => e.learnerId) })
        .eq('id', markAssessment.id);
    } catch (e) {
      console.warn('[roster] snapshot unavailable:', e.message);
    }

    const [clsData, subData] = await Promise.all([
      DB.getRelated('classes', 'name', { id: markAssessment.class_id }),
      DB.getRelated('subjects', 'name', { id: markAssessment.subject_id })
    ]);
    const sub = subData[0];
    const className = clsData[0]?.name || 'Class';
    const assessmentName = markAssessment.name || markAssessment.unit || 'Assessment';
    const teacherName = Auth.currentUser?.full_name || 'Teacher';
    for (const e of markEntries) {
      if (!e.markId) {
        if (e.mark !== '' && e.mark != null) {
          const { data: newMark, error } = await sbClient.from('marks').insert({
            assessment_id: markAssessment.id,
            learner_id: e.learnerId,
            mark: parseFloat(e.mark),
            original_mark: parseFloat(e.mark),
            original_maximum: Number(markAssessment.maximum_mark),
            normalized_mark: e.pct,
            percentage: e.pct,
            grade: e.grade,
            remark: e.remark,
            status: 'submitted'
          }).select().single();
          if (error) throw error;
          e.markId = newMark.id;
        }
      } else {
        const { error } = await sbClient.from('marks').update({ status: 'submitted' }).eq('id', e.markId);
        if (error) throw error;
      }
    }
    await sbClient.from('assessments').update({ status: 'submitted', rejection_reason: null }).eq('id', markAssessment.id).select().single();

    await sbClient.from('audit_logs').insert({
      user_id: Auth.currentUser?.id,
      user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role,
      action: 'submitted_marks',
      assessment_id: markAssessment.id,
      new_value: `Submitted ${markEntries.filter(e => e.mark !== '' && e.mark != null).length} marks`,
      timestamp: new Date().toISOString()
    });

    await notifyDosOnTeacherSubmission(
      markAssessment.id,
      teacherName,
      assessmentName,
      className,
      sub?.name || 'Subject'
    );

    // === SYNC EVERYWHERE: assessment submitted → all dashboards/reports/analytics see it ===
    DB.invalidate('marks');
    DB.invalidate('assessments');
    DB.invalidate('notifications');
    DB.invalidate('audit_logs');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();

    Utils.toast('Marks submitted — synced to DOS, Analytics & Reports', 'success');
    Router.go('teacher/enter-marks');
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  }
}

async function downloadMarksTemplateForCurrentAssessment(){
  if (!markAssessment) return Utils.toast('No assessment selected','error');
  try{
    if (typeof MarksImport !== 'undefined' && MarksImport.downloadTemplate){
      await MarksImport.downloadTemplate('excel');
    } else {
      Utils.toast('Import module not loaded','error');
    }
  }catch(e){
    Utils.toast('Failed to generate template: '+e.message,'error');
  }
}
