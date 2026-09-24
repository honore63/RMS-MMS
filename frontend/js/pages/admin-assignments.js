let assignFilter = 'all';
let assignmentQueue = [];
let assignmentSubjects = [];
let assignmentClassLookup = {};

function renderAssignmentClassSubjects() {
  const classId = document.getElementById('af-class-picker')?.value || '';
  const panel = document.getElementById('af-subject-panel');
  if (!panel) return;

  if (!classId) {
    panel.innerHTML = '<div class="text-sm text-muted">Select a class first to choose the subjects taught in that class.</div>';
    return;
  }

  const existing = assignmentQueue.find(item => item.class_id === classId);
  const checked = new Set(existing ? existing.subject_ids : []);
  const list = (assignmentSubjects || []).map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 0">
      <input type="checkbox" name="af-subject" value="${s.id}" ${checked.has(s.id) ? 'checked' : ''} onchange="renderAssignmentSubjectCount()"> 
      ${Utils.escapeHtml(s.name)}
    </label>
  `).join('') || '<div class="text-sm text-muted">No active subjects available for this class.</div>';

  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;padding-bottom:4px;border-bottom:1px solid var(--gray-200)">
      <span class="text-xs text-muted" id="af-subject-count" style="font-weight:600">${checked.size ? checked.size + ' subject(s) selected' : 'Select one or more subjects'}</span>
      <span style="display:inline-flex;gap:6px">
        <button type="button" class="btn btn-xs btn-outline" onclick="assignSelectAllSubjects()">Select all</button>
        <button type="button" class="btn btn-xs btn-outline" onclick="assignClearSubjects()">Clear</button>
      </span>
    </div>
    ${list}`;
}

function renderAssignmentSubjectCount() {
  const count = document.querySelectorAll('input[name="af-subject"]:checked').length;
  const el = document.getElementById('af-subject-count');
  if (el) el.textContent = count ? count + ' subject(s) selected' : 'Select one or more subjects';
}

function assignSelectAllSubjects() {
  document.querySelectorAll('input[name="af-subject"]').forEach(cb => cb.checked = true);
  renderAssignmentSubjectCount();
}

function assignClearSubjects() {
  document.querySelectorAll('input[name="af-subject"]').forEach(cb => cb.checked = false);
  renderAssignmentSubjectCount();
}

function renderAssignmentQueue() {
  const queue = document.getElementById('af-class-subject-queue');
  if (!queue) return;

  if (!assignmentQueue.length) {
    queue.innerHTML = '<div class="text-sm text-muted">No class assigned yet. Select one class and its subjects, then add it below.</div>';
    return;
  }

  const totalClasses = assignmentQueue.length;
  const totalSubjects = assignmentQueue.reduce((sum, item) => sum + (item.subject_ids || []).length, 0);

  const summary = `
    <div style="padding:10px 12px;border:1px solid rgba(37,99,235,.18);border-radius:8px;background:rgba(37,99,235,.05);margin-bottom:10px;">
      <div style="font-size:12px;color:var(--gray-600);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:4px">Summary</div>
      <div style="font-weight:700;color:var(--gray-900)">${totalClasses} class(es) • ${totalSubjects} subject(s)</div>
    </div>
  `;

  queue.innerHTML = summary + assignmentQueue.map(item => {
    const className = assignmentClassLookup[item.class_id] || 'Unknown class';
    const subjectNames = (item.subject_ids || [])
      .map(sid => (assignmentSubjects.find(s => s.id === sid)?.name) || 'Unknown subject')
      .join(', ');
    return `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;padding:10px 12px;border:1px solid var(--gray-200);border-radius:8px;margin-bottom:8px;background:var(--gray-50)">
        <div style="flex:1">
          <div style="font-weight:700;color:var(--gray-900)">${Utils.escapeHtml(className)}</div>
          <div style="font-size:12px;color:var(--gray-600);margin-top:2px;font-weight:600">${(item.subject_ids || []).length} subject(s)</div>
          <div class="text-sm text-muted" style="margin-top:4px">${Utils.escapeHtml(subjectNames || 'No subjects')}</div>
        </div>
        <button type="button" class="btn btn-sm btn-danger" onclick="assignRemoveClassFromQueue('${item.class_id}')">Remove</button>
      </div>
    `;
  }).join('');
}

function assignRemoveClassFromQueue(classId) {
  assignmentQueue = assignmentQueue.filter(item => item.class_id !== classId);
  renderAssignmentQueue();
  const picker = document.getElementById('af-class-picker');
  if (picker && picker.value === classId) {
    picker.value = '';
    renderAssignmentClassSubjects();
  }
}

function assignAddClassToQueue() {
  const classId = document.getElementById('af-class-picker')?.value || '';
  const selectedSubjects = [...document.querySelectorAll('input[name="af-subject"]:checked')].map(el => el.value);

  if (!classId) return Utils.toast('Select a class first', 'error');
  if (!selectedSubjects.length) return Utils.toast('Select at least one subject for this class', 'error');

  const existing = assignmentQueue.find(item => item.class_id === classId);
  if (existing) {
    // MERGE, never replace — a teacher can hold several subjects in one class.
    existing.subject_ids = [...new Set([...(existing.subject_ids || []), ...selectedSubjects])];
  } else {
    assignmentQueue.push({ class_id: classId, subject_ids: [...new Set(selectedSubjects)] });
  }

  renderAssignmentQueue();
  const picker = document.getElementById('af-class-picker');
  if (picker) picker.value = '';
  renderAssignmentClassSubjects();
}

async function renderAssignments() {
  setHeader('Teacher Assignments', 'Manage teaching schedules and matrix');
  setContent(Utils.loading());
  const [assignments, teachers, classes, subjects, years] = await Promise.all([
    DB.query('teacher_assignments', '*'),
    DB.query('teachers', '*', { status: 'active' }),
    DB.get('classes'),
    DB.query('subjects', '*', { status: 'active' }),
    DB.get('academic_years')
  ]);
  
  const filtered = assignFilter === 'all' ? assignments : assignments.filter(a => a.teacher_id === assignFilter);
  
  // teacher_id -> year_id -> class_id -> Set(subject_ids)
  const byTeacher = {};
  filtered.forEach(a => {
    const yearKey = a.academic_year_id || 'unassigned';
    if (!byTeacher[a.teacher_id]) byTeacher[a.teacher_id] = {};
    if (!byTeacher[a.teacher_id][yearKey]) byTeacher[a.teacher_id][yearKey] = {};
    const yearMap = byTeacher[a.teacher_id][yearKey];
    if (!yearMap[a.class_id]) yearMap[a.class_id] = new Set();
    yearMap[a.class_id].add(a.subject_id);
  });

  const className = id => classes.find(c => String(c.id) === String(id))?.name || 'Unknown class';
  const subjectName = id => subjects.find(s => String(s.id) === String(id))?.name || 'Unknown subject';
  const initialsOf = name => (name || 'T').split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase();

  const cards = (teachers || []).map(t => {
    const yearGroups = byTeacher[t.id] || {};
    const hasAssignments = Object.keys(yearGroups).length > 0;
    const firstYearKey = Object.keys(yearGroups).find(k => k !== 'unassigned') || 'null';

    let classCount = 0;
    let subjectCount = 0;
    const lines = Object.entries(yearGroups).map(([yearKey, classMap]) => {
      const y = yearKey !== 'unassigned' ? years.find(yr => String(yr.id) === String(yearKey)) : null;
      const yearLabel = y ? y.name : null;
      const yearLines = Object.entries(classMap).map(([cid, subjSet]) => {
        classCount++;
        subjectCount += subjSet.size;
        const subs = Array.from(subjSet).map(subjectName).join(', ');
        return `<div class="assign-line"><span class="assign-class">${Utils.escapeHtml(className(cid))}</span><span class="assign-subjects">${Utils.escapeHtml(subs)}</span></div>`;
      }).join('');
      return (yearLabel ? `<div class="assign-year">${Utils.escapeHtml(yearLabel)}</div>` : '') + yearLines;
    }).join('');

    const status = (t.status || 'active') === 'active'
      ? '<span class="badge badge-success"><i data-lucide="check-circle" style="width:12px;height:12px"></i> Active</span>'
      : '<span class="badge badge-danger">Inactive</span>';

    return `
      <div class="assign-card${hasAssignments ? '' : ' assign-card-empty'}">
        <div class="assign-card-header">
          <div class="assign-avatar">${Utils.escapeHtml(initialsOf(t.full_name))}</div>
          <div class="assign-card-meta">
            <h3>${Utils.escapeHtml(t.full_name || 'Unknown Teacher')}</h3>
            <div class="assign-code">${Utils.escapeHtml(t.teacher_code || '—')}</div>
            <div class="assign-status">${status}</div>
          </div>
        </div>
        <div class="assign-card-body">
          ${hasAssignments
            ? `<div class="assign-summary"><span>${classCount} class(es)</span><i data-lucide="dot"></i><span>${subjectCount} subject(s)</span></div>${lines}`
            : '<p class="text-sm text-muted">No classes or subjects assigned yet.</p>'}
        </div>
        <div class="assign-card-actions">
          ${hasAssignments
            ? `<button class="btn btn-sm btn-outline" onclick="assignEditGroup('${t.id}', '${firstYearKey}')"><i data-lucide="pencil"></i> Edit</button>
               <button class="btn btn-sm btn-danger" onclick="assignDeleteGroup('${t.id}', '${firstYearKey}')"><i data-lucide="trash-2"></i> Remove</button>`
            : `<button class="btn btn-sm btn-primary" onclick="assignForm()"><i data-lucide="plus"></i> Assign Now</button>`}
        </div>
      </div>`;
  }).join('');

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <select class="select-field" style="width:250px" onchange="assignFilter=this.value;renderAssignments()">
        <option value="all">All Teachers</option>
        ${(teachers || []).map(t => `<option value="${t.id}" ${assignFilter === t.id ? 'selected' : ''}>${Utils.escapeHtml(t.full_name)}</option>`).join('')}
      </select>
      <button class="btn btn-primary" onclick="assignForm()"><i data-lucide="plus"></i> New Assignment Array</button>
    </div>
    ${cards ? `<div class="assign-grid">${cards}</div>` : `<div class="card"><div class="table-container">${Utils.empty('No teachers found', 'user-x')}</div></div>`}`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function buildAssignmentModal(title, preSelectedTeacher = null, preSelectedYear = null, selectedClassSubjects = {}) {
  const [teachers, classes, subjects, years] = await Promise.all([
    DB.query('teachers', '*', { status: 'active' }),
    DB.get('classes'),
    DB.query('subjects', '*', { status: 'active' }),
    DB.get('academic_years')
  ]);
  const scopedClasses = typeof Scope !== 'undefined' && Scope.isScoped() ? Scope.filterClasses(classes) : classes;
  const scopedSubjects = typeof Scope !== 'undefined' && Scope.isScoped() ? Scope.filterSubjects(subjects) : subjects;
  assignmentSubjects = scopedSubjects || [];
  assignmentClassLookup = Object.fromEntries((scopedClasses || []).map(c => [c.id, c.name]));
  assignmentQueue = Object.entries(selectedClassSubjects || {}).map(([class_id, subject_ids]) => ({
    class_id,
    subject_ids: Array.isArray(subject_ids) ? subject_ids : [...new Set((subject_ids || []).map(s => s))]
  }));

  const teacherOpts = teachers.map(t => `<option value="${t.id}" ${preSelectedTeacher === t.id ? 'selected' : ''}>${t.full_name} (${t.teacher_code})</option>`).join('');
  const defYear = preSelectedYear || (typeof getActiveYearId === 'function' ? getActiveYearId(years) : null) || '';
  const yearOpts = years.map(y => `<option value="${y.id}" ${defYear === y.id ? 'selected' : ''}>${y.name}</option>`).join('');
  const classOpts = (scopedClasses || []).map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)}</option>`).join('');

  return `
    ${typeof Scope !== 'undefined' && Scope.isScoped() ? `<div class="alert alert-info" style="margin-bottom:14px"><i data-lucide="shield-check"></i> Showing only ${Utils.escapeHtml(Scope.label())} classes and subjects authorized for this DOS.</div>` : ''}
    <div class="form-row">
      <div class="form-group"><label>Teacher <span class="required">*</span></label>
        <select id="af-teacher" class="select-field" ${preSelectedTeacher ? 'disabled' : ''}><option value="">Select</option>${teacherOpts}</select>
      </div>
      <div class="form-group"><label>Academic Year <span class="required">*</span></label>
        <select id="af-year" class="select-field" ${preSelectedYear ? 'disabled' : ''}><option value="">Select</option>${yearOpts}</select>
      </div>
    </div>
    <div class="form-group">
      <label>1. Select a class <span class="required">*</span></label>
      <select id="af-class-picker" class="select-field" onchange="renderAssignmentClassSubjects()">
        <option value="">Select class</option>
        ${classOpts}
      </select>
    </div>
    <div class="form-group">
      <label>2. Subjects taught in this class <span class="required">*</span></label>
      <div id="af-subject-panel" style="max-height:200px;overflow-y:auto;border:1px solid var(--gray-200);border-radius:var(--radius);padding:8px">
        <div class="text-sm text-muted">Select a class first to choose the subjects taught in that class.</div>
      </div>
    </div>
    <div class="form-group" style="margin-bottom:10px">
      <button type="button" class="btn btn-sm btn-outline" onclick="assignAddClassToQueue()">
        <i data-lucide="plus"></i> Add class + selected subjects
      </button>
    </div>
    <div class="form-group">
      <label>3. Class-by-class assignment queue</label>
      <div id="af-class-subject-queue" style="max-height:220px;overflow-y:auto">
        <div class="text-sm text-muted">No class assigned yet. Select one class and its subjects, then add it below.</div>
      </div>
    </div>`;
}

async function assignForm() {
  const content = await buildAssignmentModal('New Assignment Array');
  Modal.show('Assign Multiple Classes & Subjects', content,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="assignSaveMultiple(this)"><i data-lucide="check"></i> Create Assignments</button>`);
}

async function assignEditGroup(teacherId, yearId) {
  const filters = { teacher_id: teacherId };
  if (yearId && yearId !== 'null' && yearId !== 'unassigned') filters.academic_year_id = yearId;
  const assignments = await DB.query('teacher_assignments', '*', filters, null, null, { cache: false });
  const selectedClassSubjects = {};
  assignments.forEach(a => {
    if (!selectedClassSubjects[a.class_id]) selectedClassSubjects[a.class_id] = [];
    if (!selectedClassSubjects[a.class_id].includes(a.subject_id)) selectedClassSubjects[a.class_id].push(a.subject_id);
  });

  const content = await buildAssignmentModal('Edit Assignment Array', teacherId, yearId, selectedClassSubjects);
  Modal.show('Edit Teacher Assignments', content,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="assignUpdateMultiple('${teacherId}', '${yearId}', this)"><i data-lucide="save"></i> Update Assignments</button>`);
}

async function assignSaveMultiple(btn) {
  const teacher_id = document.getElementById('af-teacher').value;
  const year_id = document.getElementById('af-year').value;

  if (!teacher_id) return Utils.toast('Select a teacher', 'error');
  if (!year_id) return Utils.toast('Select an academic year', 'error');
  if (!assignmentQueue.length) return Utils.toast('Add at least one class with subjects before saving', 'error');

  if (btn) { btn.disabled = true; btn.innerHTML = 'Assigning...'; }

  const payLoad = [];
  assignmentQueue.forEach(item => {
    (item.subject_ids || []).forEach(subject_id => {
      payLoad.push({ teacher_id, class_id: item.class_id, subject_id, academic_year_id: year_id });
    });
  });

  if (!payLoad.length) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check"></i> Create Assignments'; }
    return Utils.toast('Each added class must include at least one subject', 'error');
  }

  try {
    const existing = await DB.query('teacher_assignments', 'teacher_id,class_id,subject_id,academic_year_id', {
      teacher_id,
      academic_year_id: year_id
    }, null, null, { cache: false });
    const existingKeys = new Set((existing || []).map(a => `${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));
    const newPayload = payLoad.filter(a => !existingKeys.has(`${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));
    if (!newPayload.length) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check"></i> Create Assignments'; }
      return Utils.toast('All selected assignments already exist', 'info');
    }
    const { error } = await sbClient.from('teacher_assignments').insert(newPayload);
    if (error) throw error;
    DB.invalidate('teacher_assignments');
    Modal.close();
    Utils.toast(`Created ${newPayload.length} assignment(s)`, 'success');
    renderAssignments();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check"></i> Create Assignments'; }
    Utils.toast('Error: ' + e.message, 'error');
  }
}

async function assignUpdateMultiple(teacherId, yearId, btn) {
  if (!assignmentQueue.length) return Utils.toast('Add at least one class with subjects before saving', 'error');

  if (btn) { btn.disabled = true; btn.innerHTML = 'Updating...'; }

  const payLoad = [];
  assignmentQueue.forEach(item => {
    (item.subject_ids || []).forEach(subject_id => {
      payLoad.push({ teacher_id: teacherId, class_id: item.class_id, subject_id, academic_year_id: yearId === 'null' ? null : yearId });
    });
  });

  if (!payLoad.length) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Update Assignments'; }
    return Utils.toast('Each added class must include at least one subject', 'error');
  }

  try {
    let existingQuery = sbClient.from('teacher_assignments').select('id,teacher_id,class_id,subject_id,academic_year_id').eq('teacher_id', teacherId);
    if (yearId !== 'null') existingQuery = existingQuery.eq('academic_year_id', yearId);
    else existingQuery = existingQuery.is('academic_year_id', null);
    const { data: existing, error: existingErr } = await existingQuery;
    if (existingErr) throw existingErr;

    const desiredKeys = new Set(payLoad.map(a => `${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));
    const currentKeys = new Set((existing || []).map(a => `${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));
    const removeIds = (existing || []).filter(a => !desiredKeys.has(`${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`)).map(a => a.id);
    const newPayload = payLoad.filter(a => !currentKeys.has(`${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));

    if (removeIds.length) {
      const { error: dropErr } = await sbClient.from('teacher_assignments').delete().in('id', removeIds);
      if (dropErr) throw dropErr;
    }
    if (newPayload.length) {
      const { error: insErr } = await sbClient.from('teacher_assignments').insert(newPayload);
      if (insErr) throw insErr;
    }

    DB.invalidate('teacher_assignments');
    Modal.close();
    Utils.toast(`Synced to ${payLoad.length} assignment(s)`, 'success');
    renderAssignments();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Update Assignments'; }
    Utils.toast('Update Error: ' + e.message, 'error');
  }
}

async function assignDeleteGroup(teacherId, yearId) {
  Modal.show('Remove Entire Assignment Matrix',
    `<p style="font-size:15px;color:var(--gray-800)">Clear all classes and subjects for this teacher in this academic year?</p>
     <p class="text-sm text-muted" style="margin-top:6px;margin-bottom:16px">The teacher will lose access to records connected to these subjects/classes.</p>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="confirmAssignDeleteGroup('${teacherId}', '${yearId}')"><i data-lucide="trash-2"></i> Remove Matrix</button>`, true);
}

async function confirmAssignDeleteGroup(teacherId, yearId) {
  try {
    let q = sbClient.from('teacher_assignments').delete().eq('teacher_id', teacherId);
    if (yearId !== 'null') q = q.eq('academic_year_id', yearId);
    else q = q.is('academic_year_id', null);
    
    const { error } = await q;
    if (error) throw error;
    
    DB.invalidate('teacher_assignments');
    Modal.close();
    Utils.toast('Assignment group completely removed', 'success');
    renderAssignments();
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  }
}
