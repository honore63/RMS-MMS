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
  activeYear = years.find(y => y.status === 'active') || null;
  activeTerm = terms.find(t => activeYear && t.academic_year_id === activeYear.id) || null;
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
    if (listFilter !== 'all' && a.status !== listFilter) return false;
    if (!listSearch) return true;
    const q = listSearch.toLowerCase();
    const cls = classes.find(c => c.id === a.class_id);
    const sub = subjects.find(s => s.id === a.subject_id);
    return (a.name + ' ' + (a.unit || '') + ' ' + assessmentTypeName(types, a.assessment_type_id, '') + ' ' + (cls?.name || '') + ' ' + (sub?.name || '')).toLowerCase().includes(q);
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
        <td><span class="font-semibold">${Utils.escapeHtml(a.unit || a.name)}</span><div class="text-xs text-muted">${Utils.escapeHtml(a.name)}</div></td>
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
      <button class="btn btn-primary" onclick="openCreateAssessment()"><i data-lucide="plus"></i> Create Assessment</button>
      <button class="btn btn-secondary" onclick="MarksImport.open()"><i data-lucide="file-up"></i> Import Marks</button>
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
  if (!teacherAssignments.length) {
    Utils.toast('You have no class/subject assignments. Contact the DOS.', 'error');
    return;
  }
  if (!activeYear) {
    Utils.toast('No active academic year set. Contact the DOS.', 'error');
    return;
  }

const [classes, subjects, types] = await Promise.all([DB.get('classes'), DB.get('subjects'), getAssessmentTypes()]);
  const assignedSubjectIds = [...new Set(teacherAssignments.map(a => a.subject_id))];
  const subjectOptions = subjects.filter(s => assignedSubjectIds.includes(s.id));
  const activeTypes = types.filter(t => t.status === 'active');
  casAutoName = '';

  const dateStr = new Date().toISOString().split('T')[0];

  Modal.show('Create Assessment', `
    <div class="form-group">
      <label>Subject <span class="required">*</span></label>
      <select id="cas-subject" class="select-field" onchange="casSubjectChanged()">
        <option value="">Select subject</option>
        ${subjectOptions.map(s => `<option value="${s.id}">${Utils.escapeHtml(s.name)}</option>`).join('')}
      </select>
      <p class="form-hint">Only subjects assigned to you are shown.</p>
    </div>
    <div class="form-group">
      <label>Class <span class="required">*</span></label>
      <select id="cas-class" class="select-field" onchange="casSuggestName()">
        <option value="">Select class</option>
      </select>
      <p class="form-hint">Only classes assigned to you for the selected subject are shown.</p>
    </div>
    <div class="form-group">
      <label>Assessment Type <span class="required">*</span></label>
      <select id="cas-type" class="select-field" onchange="casTypeChanged()">
        ${activeTypes.map((t, i) => `<option value="${t.id}" data-default-max="${t.default_maximum_mark ?? ''}" ${i === 0 ? 'selected' : ''}>${Utils.escapeHtml(t.name)}${t.weight != null ? ' (w=' + t.weight + ')' : ''}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label>Unit <span class="text-muted">(only for unit-based types)</span></label>
      <input id="cas-unit" class="input-field" placeholder="e.g., Unit 4 - Fractions" oninput="casSuggestName()">
    </div>
    <div class="form-group">
      <label>Assessment Name <span class="required">*</span></label>
      <input id="cas-name" class="input-field" placeholder="e.g., Unit 4 Quiz">
      <p class="form-hint">Auto-suggested from type and unit. You can edit it.</p>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Assessment Date <span class="required">*</span></label><input id="cas-date" type="date" class="input-field" value="${dateStr}"></div>
      <div class="form-group"><label>Maximum Marks <span class="required">*</span></label>
        <select id="cas-max" class="select-field">${[10, 20, 30, 40, 50, 100].map(m => `<option value="${m}" ${m === (activeTypes[0]?.default_maximum_mark ?? 30) ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Weight <span class="text-muted">(optional)</span></label><input id="cas-weight" type="number" min="0" step="any" class="input-field" placeholder="blank = use type default"></div>
      <div class="form-group"><label>Academic Year</label><input class="input-field" value="${Utils.escapeHtml(activeYear?.name || '')}" disabled></div>
    </div>
    <div class="form-group"><label>Description</label><textarea id="cas-desc" class="textarea-field" placeholder="Optional notes about this assessment"></textarea></div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-secondary" onclick="casSave('draft', this)"><i data-lucide="save"></i> Save Draft</button>
     <button class="btn btn-primary" onclick="casSave('enter', this)"><i data-lucide="arrow-right"></i> Create & Enter Marks</button>`);
}

function casSubjectChanged() {
  const subjectId = document.getElementById('cas-subject').value;
  const classSelect = document.getElementById('cas-class');
  const myClassIds = teacherAssignments.filter(a => a.subject_id === subjectId).map(a => a.class_id);
  classSelect.innerHTML = '<option value="">Select class</option>';
  DB.get('classes').then(classes => {
    const opts = classes.filter(c => myClassIds.includes(c.id));
    classSelect.innerHTML = '<option value="">Select class</option>' + opts.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  });
  casSuggestName();
}

function casTypeChanged() {
  const sel = document.getElementById('cas-type');
  const opt = sel && sel.selectedOptions[0];
  const maxEl = document.getElementById('cas-max');
  if (maxEl && opt && opt.dataset.defaultMax) maxEl.value = opt.dataset.defaultMax;
  casSuggestName();
}

let casAutoName = '';

function casSuggestName() {
  const sel = document.getElementById('cas-type');
  const typeName = (sel && sel.selectedOptions[0]) ? sel.selectedOptions[0].textContent.trim() : 'End-of-Unit Assessment';
  const unit = document.getElementById('cas-unit')?.value.trim() || '';
  const nameField = document.getElementById('cas-name');
  if (!nameField) return;
  const current = nameField.value.trim();
  const auto = unit ? typeName + ' - ' + unit : '';
  if (!current || current === casAutoName) {
    nameField.value = auto;
    casAutoName = auto;
  }
}

async function casSave(mode, btn) {
  if (btn) {
    btn.disabled = true;
    const originalText = btn.innerHTML;
    btn.innerHTML = 'Saving...';
    btn.dataset.original = originalText;
  }
  const subjectId = document.getElementById('cas-subject').value;
  const classId = document.getElementById('cas-class').value;
  const typeSelect = document.getElementById('cas-type');
  const typeId = typeSelect ? typeSelect.value : null;
  const typeName = (typeSelect && typeSelect.selectedOptions[0]) ? typeSelect.selectedOptions[0].textContent.trim() : 'End-of-Unit Assessment';
  const unit = document.getElementById('cas-unit').value.trim();
  const name = document.getElementById('cas-name').value.trim();
  const date = document.getElementById('cas-date').value;
  const maximumMark = parseInt(document.getElementById('cas-max').value) || 30;
  const weightRaw = document.getElementById('cas-weight') ? document.getElementById('cas-weight').value.trim() : '';
  const desc = document.getElementById('cas-desc') ? document.getElementById('cas-desc').value.trim() : '';

  if (!subjectId) return Utils.toast('Select a subject', 'error');
  if (!classId) return Utils.toast('Select a class', 'error');
  if (!unit && !name) { if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.original; if (typeof lucide !== 'undefined') lucide.createIcons(); } return Utils.toast('Enter a unit or an assessment name', 'error'); }
  if (!date) return Utils.toast('Select the assessment date', 'error');

  const allowed = teacherAssignments.some(a => a.subject_id === subjectId && a.class_id === classId);
  if (!allowed) {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.original; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    Utils.toast('You are not authorized for this class/subject combination', 'error');
    return;
  }

  const teacherId = Auth.getTeacherId();
  const data = {
    name: name || (unit ? typeName + ' - ' + unit : typeName),
    assessment_type_id: typeId || null,
    unit: unit || null,
    class_id: classId,
    subject_id: subjectId,
    teacher_id: teacherId,
    academic_year_id: activeYear?.id,
    term_id: activeTerm?.id,
    maximum_mark: maximumMark,
    weight: weightRaw === '' ? null : parseFloat(weightRaw),
    assessment_date: date,
    description: desc || null,
    status: 'draft'
  };

  try {
    const { data: inserted, error } = await sbClient.from('assessments').insert(data).select().single();
    if (error) throw error;
    Utils.toast('Assessment created', 'success');
    Modal.close();
    if (mode === 'enter') {
      Router.go('teacher/enter-marks?assessment=' + inserted.id);
    } else {
      renderEnterMarks();
    }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.original; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    Utils.toast('Error: ' + e.message, 'error');
  }
}

async function renderMarksEntry(assessId) {
  setHeader('Enter Marks', 'Enter and manage marks for your assessment');
  setContent(Utils.loading());

  const targetAssessment = await DB.getRelated('assessments', '*', { id: assessId });
  if (!targetAssessment.length) { setContent(Utils.empty('Assessment not found', 'file-x')); return; }
  markAssessment = targetAssessment[0];

  const teacherId = Auth.getTeacherId();
  const allowed = teacherAssignments.length === 0 || teacherAssignments.some(a => a.class_id === markAssessment.class_id && a.subject_id === markAssessment.subject_id);
  const isOwnAssessment = markAssessment.teacher_id === teacherId;
  if (!allowed && !isOwnAssessment && !Auth.isAdmin()) {
    setContent(Utils.empty('You are not authorized to access this assessment', 'shield-x'));
    return;
  }

  const [existingMarks, gradingData, settingsData, clsData, subData, types] = await Promise.all([
    DB.query('marks', '*', { assessment_id: assessId }),
    getGrading(),
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
    const pct = markVal ? Utils.pct(parseFloat(markVal), markAssessment.maximum_mark) : 0;
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
        ${!isLocked && !isSubmitted ? `<button class="btn btn-primary" onclick="MarksImport.open({ assessmentId: '${markAssessment.id}' })"><i data-lucide="file-up"></i> Import Marks</button>` : ''}
        ${!isLocked && !isSubmitted ? `<button class="btn btn-secondary" onclick="saveMarks()"><i data-lucide="save"></i> Save Draft</button>` : ''}
      </div>
    </div>

    <div class="card mb-6">
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:16px">
        <div>
          <h2 class="font-bold" style="font-size:20px;color:var(--gray-900)">${Utils.escapeHtml(sub?.name || '')} â€” ${Utils.escapeHtml(cls?.name || '')}</h2>
          <p class="text-sm text-muted" style="margin-top:2px"><strong style="color:var(--gray-700)">${Utils.escapeHtml(assessmentTypeName(types, markAssessment.assessment_type_id, 'Assessment'))}:</strong> ${Utils.escapeHtml(markAssessment.name)}${markAssessment.unit ? ' - ' + Utils.escapeHtml(markAssessment.unit) : ''}</p>
          <p class="text-sm text-muted" style="margin-top:2px">${Utils.dateStr(markAssessment.assessment_date)} | Maximum Mark: <strong style="color:var(--blue-600)">${maxM}</strong></p>
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
    if (isNaN(n) || n < 0 || n > maxMark) {
      showMarkError(`Invalid mark. Enter a value between 0 and ${maxMark}.`);
      const input = document.querySelector(`#marks-table-body tr[data-mark-index="${index}"] input`);
      if (input) input.value = markEntries[index].mark || '';
      return;
    }
  }

  const e = markEntries[index];
  e.mark = value;
  const pct = (value !== '' && value != null) ? Utils.pct(parseFloat(value), maxMark) : 0;
  e.pct = pct;

  getGrading().then(scale => {
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

  try {
    for (const e of toSave) {
      const data = {
        assessment_id: markAssessment.id,
        learner_id: e.learnerId,
        mark: parseFloat(e.mark),
        percentage: e.pct,
        grade: e.grade,
        remark: e.remark,
        status: markAssessment.status === 'draft' ? 'draft' : e.existingStatus === 'submitted' ? 'submitted' : 'draft'
      };
      if (e.markId) {
        const { error } = await sbClient.from('marks').update(data).eq('id', e.markId);
        if (error) throw error;
      } else {
        const { data: newMark, error } = await sbClient.from('marks').insert(data).select().single();
        if (error) throw error;
        e.markId = newMark.id;
      }
    }
    if (isAuto) {
      showSaveStatus('saved');
      setTimeout(() => { const el = document.getElementById('save-status'); if (el) el.innerHTML = ''; }, 3000);
    } else {
      Utils.toast('Marks saved', 'success');
      showSaveStatus('saved');
      setTimeout(() => { const el = document.getElementById('save-status'); if (el) el.innerHTML = ''; }, 2000);
    }
  } catch (e) {
    showSaveStatus('error');
    if (!isAuto) Utils.toast('Error saving: ' + e.message, 'error');
  }
}

async function openSubmitConfirm() {
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
    for (const e of markEntries) {
      if (!e.markId) {
        if (e.mark !== '' && e.mark != null) {
          const { data: newMark, error } = await sbClient.from('marks').insert({
            assessment_id: markAssessment.id,
            learner_id: e.learnerId,
            mark: parseFloat(e.mark),
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

    const { data: dosUsers } = await sbClient.from('users').select('id').eq('role', 'dos');
    const notifications = (dosUsers || []).map(dos => ({
      user_id: dos.id,
      title: 'Marks Submitted',
      message: `${Auth.currentUser?.full_name} submitted marks for ${markAssessment.name || markAssessment.unit} (${Utils.escapeHtml(sub?.name || '')})`,
      type: 'success',
      read: false
    }));
    if (notifications.length) await sbClient.from('notifications').insert(notifications);

    Utils.toast('Marks submitted for approval', 'success');
    Router.go('teacher/enter-marks');
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  }
}

let teacherReportMode = 'single';

async function renderTeacherReports() {
  setHeader('Reports', 'View and print your reports');
  setContent(Utils.loading());
  const teacherId = Auth.getTeacherId();
  if (!teacherId) { setContent(Utils.empty('No teacher profile found', 'user-x')); return; }

  const assessments = await DB.query('assessments', '*', { teacher_id: teacherId });
  const [classes, subjects] = await Promise.all([DB.get('classes'), DB.get('subjects')]);

  const sorted = [...assessments].sort((a, b) => {
    const ca = classes.find(x => x.id === a.class_id)?.name || '';
    const cb = classes.find(x => x.id === b.class_id)?.name || '';
    const sa = subjects.find(x => x.id === a.subject_id)?.name || '';
    const sb = subjects.find(x => x.id === b.subject_id)?.name || '';
    return ca.localeCompare(cb) || sa.localeCompare(sb) || String(a.assessment_date).localeCompare(String(b.assessment_date)) || String(a.name).localeCompare(String(b.name));
  });

  const tabs = `
    <div class="report-tabs mb-6">
      <button class="report-tab ${teacherReportMode === 'single' ? 'active' : ''}" onclick="setTeacherReportMode('single')"><i data-lucide="file-text"></i> Single Assessment</button>
      <button class="report-tab ${teacherReportMode === 'combined' ? 'active' : ''}" onclick="setTeacherReportMode('combined')"><i data-lucide="layers"></i> Combined Assessments</button>
    </div>`;

  const singleCard = `
    <div class="card mb-6">
      <div class="card-header">
        <div>
          <h3><i data-lucide="file-bar-chart" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Single Assessment Report</h3>
          <p class="text-sm text-muted mt-1">Generate an official report for one of your assessments.</p>
        </div>
      </div>
      <div class="flex gap-4 items-end" style="flex-wrap:wrap">
        <div style="flex:1;min-width:300px">
          <div class="form-group"><label>Select Assessment <span class="required">*</span></label>
          <select id="trpt-assess" class="select-field">
            <option value="">Select Assessment</option>
            ${sorted.map(a => {
              const c = classes.find(x => x.id === a.class_id);
              const s = subjects.find(x => x.id === a.subject_id);
              return `<option value="${a.id}">${c?.name || ''} - ${s?.name || ''} - ${a.unit || a.name} (${Number(a.maximum_mark) || 0} marks)</option>`;
            }).join('')}
          </select></div>
        </div>
        <button class="btn btn-primary" onclick="teacherGenerateSingle()"><i data-lucide="bar-chart-3"></i> Generate Report</button>
      </div>
    </div>`;

  const combinedCard = `
    <div class="card mb-6">
      <div class="card-header" style="flex-wrap:wrap;gap:12px">
        <div>
          <h3><i data-lucide="layers" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Combined Assessment Report</h3>
          <p class="text-sm text-muted mt-1">Select 2 or more of your assessments of the SAME Class and Subject to produce one combined report with totals, averages, grade distribution and assessment performance.</p>
        </div>
        <div class="flex gap-2">
          <button class="btn btn-sm btn-outline" onclick="setTeacherCombinedAll(true)"><i data-lucide="check-square"></i> Select All</button>
          <button class="btn btn-sm btn-outline" onclick="setTeacherCombinedAll(false)"><i data-lucide="square"></i> Clear</button>
        </div>
      </div>
      <div class="form-group mt-3">
        <label>Select Assessments <span class="required">*</span></label>
        <div class="report-cb-grid">
          ${sorted.map(a => {
            const c = classes.find(x => x.id === a.class_id);
            const s = subjects.find(x => x.id === a.subject_id);
            return `
            <label class="report-cb-item">
              <input type="checkbox" class="cb-rpt-t" value="${a.id}" data-class="${a.class_id}" data-subject="${a.subject_id}">
              <span class="report-cb-body">
                <span class="report-cb-title">${Utils.escapeHtml(a.unit || a.name)} &bull; ${Utils.escapeHtml(a.name)}</span>
                <span class="report-cb-meta">${Utils.escapeHtml(c?.name || '-')} &bull; ${Utils.escapeHtml(s?.name || '-')} &bull; ${Number(a.maximum_mark) || 0} marks ${a.assessment_date ? '&bull; ' + Utils.dateStr(a.assessment_date) : ''}</span>
              </span>
              <span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${Utils.escapeHtml(a.status)}</span>
            </label>`;
          }).join('')}
        </div>
      </div>
      <button class="btn btn-primary" onclick="teacherGenerateCombined()"><i data-lucide="layers"></i> Generate Combined Report</button>
    </div>`;

  setContent(tabs + '<div id="trpt-content"></div>' + (teacherReportMode === 'single' ? singleCard : combinedCard));
}

function setTeacherReportMode(m) {
  teacherReportMode = m;
  renderTeacherReports();
}

function setTeacherCombinedAll(checked) {
  document.querySelectorAll('.cb-rpt-t').forEach(cb => cb.checked = checked);
}

async function teacherGenerateSingle() {
  const assessId = document.getElementById('trpt-assess')?.value;
  if (!assessId) return Utils.toast('Select an assessment', 'error');
  const rptDiv = document.getElementById('trpt-content');
  rptDiv.innerHTML = Utils.loading();
  try {
    const data = await ReportEngine.buildSingle(assessId);
    ReportEngine.render(data, 'trpt-content');
  } catch (e) {
    rptDiv.innerHTML = '';
    Utils.toast(e.message || 'Error generating report', 'error');
  }
}

async function teacherGenerateCombined() {
  const selected = Array.from(document.querySelectorAll('.cb-rpt-t:checked')).map(n => n.value);
  if (selected.length < 2) return Utils.toast('Select at least 2 assessments', 'error');
  const rptDiv = document.getElementById('trpt-content');
  rptDiv.innerHTML = Utils.loading();
  try {
    const data = await ReportEngine.buildCombined(selected);
    ReportEngine.render(data, 'trpt-content');
  } catch (e) {
    rptDiv.innerHTML = '';
    Utils.toast(e.message || 'Error generating report', 'error');
  }
}

function showTeacherReportSelection() {
  renderTeacherReports();
}

