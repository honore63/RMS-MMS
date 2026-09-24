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
  const html = (assignmentSubjects || []).map(s => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 0">
      <input type="checkbox" name="af-subject" value="${s.id}" ${checked.has(s.id) ? 'checked' : ''}> 
      ${Utils.escapeHtml(s.name)}
    </label>
  `).join('') || '<div class="text-sm text-muted">No active subjects available for this class.</div>';

  panel.innerHTML = html;
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
    existing.subject_ids = [...new Set(selectedSubjects)];
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
  
  // Group assignments by teacher_id and academic_year_id to form a matrix
  const matrix = {};
  filtered.forEach(a => {
    const key = `${a.teacher_id}_${a.academic_year_id || 'unassigned'}`;
    if (!matrix[key]) {
      matrix[key] = {
        teacher_id: a.teacher_id,
        year_id: a.academic_year_id,
        classes: new Set(),
        subjects: new Set(),
        groupCount: 0
      };
    }
    matrix[key].classes.add(a.class_id);
    matrix[key].subjects.add(a.subject_id);
    matrix[key].groupCount++;
  });

  const rows = Object.values(matrix).map(group => {
    const t = teachers.find(t => t.id === group.teacher_id);
    const y = years.find(y => y.id === group.year_id);
    
    const classNames = Array.from(group.classes).map(cid => classes.find(c => c.id === cid)?.name || 'Unknown').join(', ');
    const subjectNames = Array.from(group.subjects).map(sid => subjects.find(s => s.id === sid)?.name || 'Unknown').join(', ');
    
    return `<tr>
      <td class="col-name">${Utils.escapeHtml(t?.full_name || 'Unknown')}<br><span class="text-xs text-muted">${Utils.escapeHtml(t?.teacher_code || '')}</span></td>
      <td style="max-width:200px;word-wrap:break-word">${Utils.escapeHtml(classNames)}</td>
      <td style="max-width:200px;word-wrap:break-word">${Utils.escapeHtml(subjectNames)}</td>
      <td>${Utils.escapeHtml(y?.name || '-')}</td>
      <td><span class="badge ${t?.status === 'active' ? 'badge-info' : 'badge-danger'}">${t?.status || 'Unknown'}</span></td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick="assignEditGroup('${group.teacher_id}', '${group.year_id}')"><i data-lucide="pencil"></i> Edit</button>
        <button class="btn btn-sm btn-danger" onclick="assignDeleteGroup('${group.teacher_id}', '${group.year_id}')"><i data-lucide="trash-2"></i> Remove (${group.groupCount})</button>
      </td>
    </tr>`;
  }).join('');

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <select class="select-field" style="width:250px" onchange="assignFilter=this.value;renderAssignments()">
        <option value="all">All Teachers</option>
        ${teachers.map(t => `<option value="${t.id}" ${assignFilter === t.id ? 'selected' : ''}>${t.full_name}</option>`).join('')}
      </select>
      <button class="btn btn-primary" onclick="assignForm()"><i data-lucide="plus"></i> New Assignment Array</button>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Teacher</th><th>Classes</th><th>Subjects</th><th>Academic Year</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">${Utils.empty('No assignments found', 'link')}</td></tr>`}</tbody>
    </table></div></div>`);
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
  const assignments = await DB.query('teacher_assignments', '*', { teacher_id: teacherId, academic_year_id: yearId });
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
    });
    const existingKeys = new Set((existing || []).map(a => `${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));
    const newPayload = payLoad.filter(a => !existingKeys.has(`${a.teacher_id}|${a.class_id}|${a.subject_id}|${a.academic_year_id}`));
    if (!newPayload.length) {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="check"></i> Create Assignments'; }
      return Utils.toast('All selected assignments already exist', 'info');
    }
    const { error } = await sbClient.from('teacher_assignments').insert(newPayload);
    if (error) throw error;
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
    
    Modal.close();
    Utils.toast('Assignment group completely removed', 'success');
    renderAssignments();
  } catch (e) {
    Utils.toast('Error: ' + e.message, 'error');
  }
}
