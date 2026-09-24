let assessFilter = 'all';
let assessEduLevel = 'all';

async function renderAssessments() {
  setHeader('Assessment Approval', 'Review, approve, or reject teacher-submitted assessments');
  setContent(Utils.loading());
  const [assessments, teachers, classes, subjects, years, terms, types] = await Promise.all([
    DB.query('assessments', '*', {}, { column: 'created_at', asc: false }),
    DB.get('teachers'), DB.get('classes'), DB.get('subjects'), DB.get('academic_years'), DB.get('terms'),
    getAssessmentTypes()
  ]);
  
  const scoped = (typeof Scope !== 'undefined' && Scope.isScoped());
  const filtered = assessments.filter(a => {
    if (assessFilter !== 'all' && a.status !== assessFilter) return false;
    const cls = classes.find(c => c.id === a.class_id);
    if (scoped) {
      const subj = subjects.find(s => s.id === a.subject_id);
      return Scope.matchesClass(cls) && Scope.matchesSubject(subj);
    }
    if (assessEduLevel !== 'all') {
      if (EducationLevels.getCategory(cls) !== assessEduLevel) return false;
    }
    return true;
  });

  const rows = await Promise.all(filtered.map(async a => {
    const t = teachers.find(t => t.id === a.teacher_id);
    const c = classes.find(c => c.id === a.class_id);
    const s = subjects.find(s => s.id === a.subject_id);
    const cat = EducationLevels.getCategory(c);
    let marksInfo = '—';
    let canApprove = false;
    if (a.status === 'submitted') {
      const { count } = await sbClient.from('marks').select('*', { count: 'exact', head: true }).eq('assessment_id', a.id).neq('mark', null);
      const { count: total } = await sbClient.from('learners').select('*', { count: 'exact', head: true }).eq('class_id', a.class_id).eq('status', 'active');
      marksInfo = `${count || 0}/${total || 0}`;
      canApprove = true;
    }
    return `<tr>
      <td class="col-name">${Utils.escapeHtml(a.name)}</td>
      <td>${Utils.escapeHtml(assessmentTypeName(types, a.assessment_type_id, 'End-of-Unit Assessment'))}</td>
      <td><span style="font-size:10px;font-weight:700;color:var(--gray-500);text-transform:uppercase;display:block;margin-bottom:2px">${cat}</span>${Utils.escapeHtml(c?.name || '-')}</td>
      <td>${Utils.escapeHtml(s?.name || '-')}</td>
      <td>${Utils.escapeHtml(a.unit || '-')}</td><td>${Utils.escapeHtml(t?.full_name || '-')}</td>
      <td class="text-center font-semibold">${marksInfo}</td>
      <td>${a.maximum_mark}</td>
      <td><span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${a.status}</span></td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick="assessView('${a.id}')"><i data-lucide="eye"></i> View</button>
        ${canApprove ? `<button class="btn btn-sm btn-success" onclick="assessApprove('${a.id}')"><i data-lucide="check"></i> Approve</button><button class="btn btn-sm btn-danger" onclick="assessReject('${a.id}')"><i data-lucide="x"></i> Reject</button>` : ''}
        ${a.status === 'approved' ? `<button class="btn btn-sm btn-warning" onclick="assessLock('${a.id}')"><i data-lucide="lock"></i> Lock</button>` : ''}
        ${(a.status === 'locked' || a.status === 'rejected') ? `<button class="btn btn-sm btn-outline" onclick="assessReopen('${a.id}')"><i data-lucide="unlock"></i> Reopen</button>` : ''}
        <button class="btn btn-sm btn-danger" onclick="assessDelete('${a.id}')" title="Delete assessment"><i data-lucide="trash-2"></i></button>
      </td></tr>`;
  }));
  const rowsHtml = rows.join('');

  setContent(`
    <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap;gap:12px">
      <div class="tab-bar">
        <button class="tab-btn ${assessFilter === 'all' ? 'active' : ''}" onclick="assessFilter='all';renderAssessments()">All</button>
        <button class="tab-btn ${assessFilter === 'draft' ? 'active' : ''}" onclick="assessFilter='draft';renderAssessments()">Draft</button>
        <button class="tab-btn ${assessFilter === 'submitted' ? 'active' : ''}" onclick="assessFilter='submitted';renderAssessments()">Submitted</button>
        <button class="tab-btn ${assessFilter === 'approved' ? 'active' : ''}" onclick="assessFilter='approved';renderAssessments()">Approved</button>
        <button class="tab-btn ${assessFilter === 'rejected' ? 'active' : ''}" onclick="assessFilter='rejected';renderAssessments()">Rejected</button>
        <button class="tab-btn ${assessFilter === 'locked' ? 'active' : ''}" onclick="assessFilter='locked';renderAssessments()">Locked</button>
      </div>
      <button class="btn btn-primary" onclick="assessForm()"><i data-lucide="plus"></i> New Assessment</button>
    </div>
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div class="text-sm text-muted">All steps of creation are on one page — fill every section and click Create.</div>
      <div>
        ${scoped
          ? `<span class="badge badge-info" style="font-size:12px;font-weight:700;margin-right:6px">${Utils.escapeHtml(Scope.label())}</span><span class="text-sm text-muted">${Scope.isPrimary() ? '📗 Primary only' : '📘📙 Secondary (S1-S6)'}</span>`
          : `<select class="select-field" style="margin:0;min-width:200px" onchange="assessEduLevel=this.value;renderAssessments()">
              <option value="all">🎓 All Education Levels</option>
              <option value="Primary" ${assessEduLevel==='Primary'?'selected':''}>📗 Primary Only</option>
              <option value="Lower Secondary" ${assessEduLevel==='Lower Secondary'?'selected':''}>📘 Lower Secondary</option>
              <option value="Upper Secondary" ${assessEduLevel==='Upper Secondary'?'selected':''}>📙 Upper Secondary</option>
            </select>`}
      </div>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Name</th><th>Type</th><th>Class</th><th>Subject</th><th>Unit</th><th>Teacher</th><th>Marks</th><th>Max</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="10">${Utils.empty('No assessments matching filters', 'file-text')}</td></tr>`}</tbody></table></div></div>`);
}

async function assessView(id) {
  const [assessment] = await DB.getRelated('assessments', '*', { id });
  if (!assessment) return;
  const [cls, sub, teacher] = await Promise.all([
    DB.getRelated('classes', '*', { id: assessment.class_id }),
    DB.getRelated('subjects', '*', { id: assessment.subject_id }),
    DB.getRelated('teachers', '*', { id: assessment.teacher_id })
  ]);
  const [marks, learners] = await Promise.all([
    DB.query('marks', '*', { assessment_id: id }),
    DB.query('learners', '*', { class_id: assessment.class_id, status: 'active' }, { column: 'full_name', asc: true })
  ]);
  const types = await getAssessmentTypes();
  const scale = await getGrading();
  const settingsData = await DB.query('school_settings', '*');
  const passMark = settingsData[0]?.pass_mark || 50;
  const marksMap = {};
  marks.forEach(m => { marksMap[m.learner_id] = m; });

  const rows = learners.map((l, i) => {
    const m = marksMap[l.id];
    const hasMark = m && m.mark != null;
    const pct = hasMark ? Utils.pct(m.mark, assessment.maximum_mark) : 0;
    const grade = hasMark ? Utils.grade(pct, scale) : '';
    const pf = hasMark ? Utils.passFail(pct, passMark) : '';
    return `<tr>
      <td class="text-muted">${i + 1}</td>
      <td><div class="col-name">${Utils.escapeHtml(l.full_name)}</div><div class="text-xs text-muted">${Utils.escapeHtml(l.learner_code)}</div></td>
      <td class="text-center">${hasMark ? m.mark : '—'}<span class="text-xs text-muted">/${assessment.maximum_mark}</span></td>
      <td class="font-semibold">${hasMark ? pct + '%' : '—'}</td>
      <td>${grade ? `<span class="badge badge-info">${grade}</span>` : '—'}</td>
      <td>${pf ? `<span class="badge ${pf === 'PASS' ? 'badge-success' : 'badge-danger'}">${pf}</span>` : '—'}</td>
      <td class="text-sm">${hasMark ? Utils.escapeHtml(m.remark || '') : '—'}</td>
    </tr>`;
  }).join('');

  const entered = marks.filter(m => m.mark != null).length;
  const total = learners.length;

  Modal.show(`${Utils.escapeHtml(sub?.[0]?.name || '')} — ${Utils.escapeHtml(cls?.[0]?.name || '')}`, `
    <p class="text-sm text-muted mb-3"><strong style="color:var(--gray-800)">${Utils.escapeHtml(assessmentTypeName(types, assessment.assessment_type_id, 'Assessment'))}:</strong> ${Utils.escapeHtml(assessment.name)}${assessment.unit ? ' — ' + Utils.escapeHtml(assessment.unit) : ''}</p>
    <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:14px 16px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:8px 16px">
      <div><span class="text-xs text-muted">Created by</span><div class="text-sm font-semibold">${Utils.escapeHtml(teacher?.[0]?.full_name || '-')}</div></div>
      <div><span class="text-xs text-muted">Maximum Mark</span><div class="text-sm font-semibold">${assessment.maximum_mark}</div></div>
      <div><span class="text-xs text-muted">Date</span><div class="text-sm font-semibold">${Utils.dateStr(assessment.assessment_date)}</div></div>
      <div><span class="text-xs text-muted">Status</span><div><span class="badge ${Utils.statusColor(assessment.status)}"><i data-lucide="${Utils.statusIcon(assessment.status)}"></i> ${assessment.status}</span></div></div>
      <div><span class="text-xs text-muted">Learners</span><div class="text-sm font-semibold">${total}</div></div>
      <div><span class="text-xs text-muted">Marks entered</span><div class="text-sm font-semibold">${entered}/${total}</div></div>
    </div>
    ${assessment.rejection_reason ? `<div class="alert alert-error"><i data-lucide="alert-circle"></i><div><strong>Rejection reason:</strong> ${Utils.escapeHtml(assessment.rejection_reason)}</div></div>` : ''}
    <div class="table-container" style="max-height:380px;overflow-y:auto"><table class="data-table">
      <thead><tr><th>No.</th><th>Learner</th><th>Mark</th><th>%</th><th>Grade</th><th>Status</th><th>Remark</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="7">${Utils.empty('No learners in this class', 'users')}</td></tr>`}</tbody></table></div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>
     ${assessment.status === 'submitted' ? `<button class="btn btn-success" onclick="assessApprove('${assessment.id}')"><i data-lucide="check"></i> Approve</button><button class="btn btn-danger" onclick="assessReject('${assessment.id}')"><i data-lucide="x"></i> Reject</button>` : ''}
     ${assessment.status === 'approved' ? `<button class="btn btn-warning" onclick="assessLock('${assessment.id}')"><i data-lucide="lock"></i> Lock</button>` : ''}
     ${(assessment.status === 'locked' || assessment.status === 'rejected') ? `<button class="btn btn-outline" onclick="assessReopen('${assessment.id}')"><i data-lucide="unlock"></i> Reopen</button>` : ''}`,
    true);
}

async function assessForm() {
  const [teachers, classes, subjects, years, terms, types] = await Promise.all([
    DB.query('teachers', '*', { status: 'active' }), DB.get('classes'),
    DB.query('subjects', '*', { status: 'active' }), DB.get('academic_years'), DB.get('terms'),
    getAssessmentTypes()
  ]);
  const activeTypes = types.filter(t => t.status === 'active');
  const scoped = typeof Scope !== 'undefined' && Scope.isScoped();
  const scopedClasses = scoped ? Scope.filterClasses(classes) : classes;
  const scopedSubjects = scoped ? Scope.filterSubjects(subjects) : subjects;
  const scopedTeachers = scoped ? teachers.filter(t => {
    /* Only show teachers whose assigned class education level matches the DOS scope */
    const assigned = (typeof teacherAssignmentsCache !== 'undefined' && teacherAssignmentsCache) || [];
    const hasMatching = assigned.some(a => {
      const cls = classes.find(c => String(c.id) === String(a.class_id));
      return cls && Scope.matchesClass(cls);
    });
    return hasMatching || !assigned.length;
  }) : teachers;
  const selYear = (typeof getActiveYearId === 'function' ? getActiveYearId(years) : null) || '';
  const selTerm = selYear ? (terms.find(t => t.academic_year_id === selYear && t.is_active)?.id || '') : '';
  const yearTerms = selYear ? terms.filter(t => t.academic_year_id === selYear) : terms;
  Modal.show('Create Assessment — All Steps on One Page', `
    <style>
      .asf-section { background:#f8fafc; border:1px solid #e2e8f0; border-radius:12px; padding:14px; margin-bottom:14px; }
      .asf-section-title { font-size:11px; font-weight:800; text-transform:uppercase; letter-spacing:.08em; color:#475569; margin-bottom:10px; display:flex; align-items:center; gap:8px; }
      .asf-section-title::after { content:""; flex:1; height:1px; background:#e2e8f0; }
      .asf-section .form-group { margin-bottom:10px; }
      .asf-section .form-group:last-child { margin-bottom:0; }
    </style>
    ${scoped ? `<div class="alert alert-info" style="margin-bottom:12px"><i data-lucide="shield-check"></i> Creating for <strong>${Utils.escapeHtml(Scope.label())}</strong> — only ${scoped ? Scope.label() : ''} classes/subjects are listed.</div>` : ''}
    <div class="asf-section">
      <div class="asf-section-title"><i data-lucide="file-text" style="width:14px;height:14px"></i> 1 — Basic Info</div>
      <div class="form-group"><label>Assessment Name <span class="required">*</span></label><input id="asf-name" class="input-field" placeholder="e.g., Unit 3 Quiz, Terminal Exam S2, PRACTICAL 1"></div>
      <div class="form-group"><label>Assessment Type <span class="required">*</span></label><select id="asf-type" class="select-field" onchange="assessTypeChanged()">${activeTypes.map((t, i) => `<option value="${t.id}" data-default-max="${t.default_maximum_mark ?? ''}" ${i === 0 ? 'selected' : ''}>${Utils.escapeHtml(t.name)}${t.weight != null ? ' (w=' + t.weight + ')' : ''}</option>`).join('')}</select></div>
      <div class="form-group"><label>Unit <span class="text-muted">— only for End-of-Unit types</span></label><input id="asf-unit" class="input-field" placeholder="e.g., Unit 3 - Whole Numbers"></div>
    </div>
    <div class="asf-section">
      <div class="asf-section-title"><i data-lucide="users" style="width:14px;height:14px"></i> 2 — Class • Subject • Teacher</div>
      <div class="form-row"><div class="form-group"><label>Class <span class="required">*</span></label><select id="asf-class" class="select-field"><option value="">Select class</option>${scopedClasses.map(c => `<option value="${c.id}">${Utils.escapeHtml(c.name)} — ${Utils.escapeHtml(EducationLevels.getCategory(c))}</option>`).join('')}</select></div>
      <div class="form-group"><label>Subject <span class="required">*</span></label><select id="asf-subject" class="select-field"><option value="">Select subject</option>${scopedSubjects.map(s => `<option value="${s.id}">${Utils.escapeHtml(s.name)} (${Utils.escapeHtml(s.code || '')})</option>`).join('')}</select></div></div>
      <div class="form-group"><label>Teacher <span class="required">*</span></label><select id="asf-teacher" class="select-field"><option value="">Select teacher</option>${scopedTeachers.map(t => `<option value="${t.id}">${Utils.escapeHtml(t.full_name)} — ${Utils.escapeHtml(t.teacher_code || '')}</option>`).join('')}</select></div>
    </div>
    <div class="asf-section">
      <div class="asf-section-title"><i data-lucide="calendar" style="width:14px;height:14px"></i> 3 — Period & Scoring</div>
      <div class="form-row"><div class="form-group"><label>Academic Year <span class="required">*</span></label><select id="asf-year" class="select-field"><option value="">Select year</option>${years.map(y => `<option value="${y.id}" ${y.id === selYear ? 'selected' : ''}>${Utils.escapeHtml(y.name)}</option>`).join('')}</select></div>
      <div class="form-group"><label>Term <span class="required">*</span></label><select id="asf-term" class="select-field"><option value="">Select term</option>${yearTerms.map(t => `<option value="${t.id}" ${t.id === selTerm ? 'selected' : ''}>${Utils.escapeHtml(t.name)}</option>`).join('')}</select></div></div>
      <div class="form-row">
        <div class="form-group"><label>Maximum Mark <span class="required">*</span></label><input id="asf-max" type="number" class="input-field" value="${activeTypes[0]?.default_maximum_mark ?? 30}" min="1" max="100"></div>
        <div class="form-group"><label>Weight <span class="text-muted">(optional, blank = type default)</span></label><input id="asf-weight" type="number" min="0" step="any" class="input-field" placeholder="e.g., 0.3"></div>
      </div>
      <div class="form-group"><label>Date <span class="required">*</span></label><input id="asf-date" type="date" class="input-field" value="${new Date().toISOString().split('T')[0]}"></div>
    </div>
    <div class="asf-section" style="margin-bottom:0">
      <div class="asf-section-title"><i data-lucide="align-left" style="width:14px;height:14px"></i> 4 — Description (optional)</div>
      <div class="form-group"><textarea id="asf-desc" class="textarea-field" rows="3" placeholder="Optional notes about this assessment"></textarea></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="assessSave(this)"><i data-lucide="save"></i> Create Assessment</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
  // keep Term list in sync when Year changes
  document.getElementById('asf-year')?.addEventListener('change', (e) => {
    const yId = e.target.value;
    const termSel = document.getElementById('asf-term');
    if (!termSel) return;
    const filtered = yId ? terms.filter(t => t.academic_year_id === yId) : terms;
    termSel.innerHTML = '<option value="">Select term</option>' + filtered.map(t => `<option value="${t.id}">${Utils.escapeHtml(t.name)}</option>`).join('');
  });
}

function assessTypeChanged() {
  const sel = document.getElementById('asf-type');
  const max = document.getElementById('asf-max');
  const opt = sel && sel.selectedOptions[0];
  if (sel && max && opt && opt.dataset.defaultMax) {
    max.value = opt.dataset.defaultMax;
  }
}

async function assessSave(btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Creating...';
  }
  const d = {
    name: document.getElementById('asf-name').value.trim(),
    assessment_type_id: document.getElementById('asf-type').value || null,
    unit: document.getElementById('asf-unit').value.trim() || null,
    class_id: document.getElementById('asf-class').value || null,
    subject_id: document.getElementById('asf-subject').value || null,
    teacher_id: document.getElementById('asf-teacher').value || null,
    academic_year_id: document.getElementById('asf-year').value || null,
    term_id: document.getElementById('asf-term').value || null,
    maximum_mark: parseInt(document.getElementById('asf-max').value) || 30,
    weight: document.getElementById('asf-weight').value.trim() === '' ? null : parseFloat(document.getElementById('asf-weight').value),
    assessment_date: document.getElementById('asf-date').value || null,
    description: document.getElementById('asf-desc').value.trim() || null,
    status: 'draft'
  };
  if (!d.name) { if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; } return Utils.toast('Enter assessment name', 'error'); }
  if (!d.class_id || !d.subject_id || !d.teacher_id) { if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; } return Utils.toast('Select class, subject and teacher', 'error'); }
  if (!d.academic_year_id || !d.term_id) { if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; } return Utils.toast('Select academic year and term', 'error'); }
  if (!d.assessment_date) { if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; } return Utils.toast('Select assessment date', 'error'); }
  if (!d.maximum_mark || d.maximum_mark < 1) { if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; } return Utils.toast('Enter a valid maximum mark', 'error'); }
  // scope validation — prevent cross-level (Primary subject → Secondary class)
  try {
    const cls = classes.find(c => String(c.id) === String(d.class_id));
    const subj = subjects.find(s => String(s.id) === String(d.subject_id));
    if (scoped && cls && subj) {
      if (!Scope.matchesClass(cls) || !Scope.matchesSubject(subj)) {
        if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; if(typeof lucide!=='undefined') lucide.createIcons(); }
        return Utils.toast('This class/subject combination is outside your education-level scope. Primary subjects cannot be assigned to Secondary classes, and vice versa.', 'error');
      }
    }
  } catch (e) { /* ignore */ }
  // student check — tell DOS if class has no active learners
  try {
    const { count: _classLearnerCount } = await sbClient.from('learners').select('id', { count: 'exact', head: true }).eq('class_id', d.class_id).eq('status', 'active');
    if (!_classLearnerCount) { if (btn) { btn.disabled=false; btn.innerHTML='<i data-lucide="save"></i> Create Assessment'; if (typeof lucide!=='undefined') lucide.createIcons(); } return Utils.toast('There is no student in this class — register learners first before creating an assessment.', 'error'); }
  } catch (e) { /* ignore count error, allow creation */ }
  try {
    await DB.insert('assessments', d);
    Modal.close(); Utils.toast('Assessment created', 'success'); renderAssessments();
  } catch (e) { 
    if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="save"></i> Create'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    Utils.toast('Error: ' + e.message, 'error'); 
  }
}

async function assessUpdateStatus(id, status, reason) {
  const updateData = { status };
  if (reason !== undefined) updateData.rejection_reason = reason;
  await DB.update('assessments', id, updateData);
  await DB.insert('audit_logs', {
    user_id: Auth.currentUser?.id, user_name: Auth.currentUser?.full_name,
    role: Auth.currentUser?.role, action: status + '_assessment', assessment_id: id,
    new_value: reason || status, timestamp: new Date().toISOString()
  });
  Utils.toast('Status updated', 'success');
  Modal.close();
  renderAssessments();
}

function assessApprove(id) {
  assessUpdateStatus(id, 'approved').then(async () => {
    const [a] = await DB.getRelated('assessments', '*', { id });
    const [cls] = await DB.getRelated('classes', '*', { id: a?.class_id });
    const [sub] = await DB.getRelated('subjects', '*', { id: a?.subject_id });
    notifyTeacher(id, 'Assessment Approved', `${a?.name || 'Assessment'} for ${cls?.name || 'your class'} in ${sub?.name || 'the subject'} was approved by the DOS.`, 'success');
  });
}

function assessReject(id) {
  DB.getRelated('assessments', '*', { id }).then(([a]) => {
    Modal.show('Reject Assessment', `
      <p class="text-sm text-muted mb-3">Provide a reason for rejection. The teacher will see this reason.</p>
      <div class="form-group"><label>Reason for rejection <span class="required">*</span></label>
        <textarea id="reject-reason" class="textarea-field" placeholder="e.g., Please check the marks for learners RMS014 and RMS027."></textarea></div>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-danger" onclick="confirmReject('${id}')"><i data-lucide="x"></i> Reject Assessment</button>`);
  });
}

async function confirmReject(id) {
  const reason = document.getElementById('reject-reason').value.trim();
  if (!reason) return Utils.toast('Please enter a rejection reason', 'error');
  await assessUpdateStatus(id, 'rejected', reason);
  const [a] = await DB.getRelated('assessments', '*', { id });
  const [cls] = await DB.getRelated('classes', '*', { id: a?.class_id });
  const [sub] = await DB.getRelated('subjects', '*', { id: a?.subject_id });
  notifyTeacher(id, 'Assessment Rejected', `${a?.name || 'Assessment'} for ${cls?.name || 'your class'} in ${sub?.name || 'the subject'} was rejected by the DOS. Reason: ${reason}`, 'error');
}

function assessLock(id) { assessUpdateStatus(id, 'locked'); }
function assessReopen(id) { assessUpdateStatus(id, 'draft'); }

function assessDelete(id) {
  DB.getRelated('assessments', '*', { id }).then(([a]) => {
    if (!a) return Utils.toast('Assessment not found', 'error');
    Modal.show('Delete Assessment', `
      <p class="text-sm text-muted mb-4">Delete <strong>${Utils.escapeHtml(a.name || '')}</strong> (${Utils.escapeHtml(a.unit || '')}) permanently?</p>
      <div class="alert alert-danger" style="margin-bottom:0"><i data-lucide="alert-triangle"></i> All marks and results recorded for this assessment will also be permanently deleted. This action cannot be undone.</div>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-danger" onclick="confirmAssessDelete('${id}')"><i data-lucide="trash-2"></i> Permanently Delete</button>`, true);
  });
}

async function confirmAssessDelete(id) {
  try {
    await deleteAssessmentWithMarks(id);
    await DB.insert('audit_logs', {
      user_id: Auth.currentUser?.id, user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role, action: 'delete_assessment',
      assessment_id: id, new_value: 'Deleted assessment ' + id,
      timestamp: new Date().toISOString()
    });
    Modal.close();
    Utils.toast('Assessment deleted', 'success');
    renderAssessments();
  } catch (e) {
    const msg = [e.message, e.details, e.hint].filter(Boolean).join(' | ');
    Utils.toast('Delete failed: ' + (msg || 'unknown error (see console)'), 'error');
    if (e) console.error('confirmAssessDelete error:', e);
  }
}

async function deleteAssessmentWithMarks(id) {
  try {
    await DB.remove('assessments', id);
  } catch (e) {
    if (!/foreign key constraint/i.test(e.message || '')) throw e;
    let { error } = await sbClient.from('marks').delete().eq('assessment_id', id);
    if (error) throw error;
    await DB.remove('assessments', id);
  }
}

async function notifyTeacher(assessId, title, message, type) {
  try {
    const [a] = await DB.getRelated('assessments', '*', { id: assessId });
    if (!a) return;
    const [t] = await DB.getRelated('teachers', '*', { id: a.teacher_id });
    if (!t) return;
    const [cls] = await DB.getRelated('classes', '*', { id: a.class_id });
    const [sub] = await DB.getRelated('subjects', '*', { id: a.subject_id });
    const finalMessage = message || `Assessment ${a.name || 'mark entry'} for ${cls?.name || 'your class'} in ${sub?.name || 'the subject'} has an update.`;
    if (t.user_id) {
      await DB.insert('notifications', {
        user_id: t.user_id,
        title,
        message: finalMessage,
        type: type || 'info',
        read: false
      });
    }
  } catch (e) { console.error('Notify error:', e); }
}

async function notifyDosOnTeacherSubmission(assessmentId, teacherName, assessmentName, className, subjectName) {
  try {
    const { data: dosUsers } = await sbClient.from('users').select('id').eq('role', 'dos');
    if (!dosUsers || !dosUsers.length) return;
    const rows = dosUsers.map(dos => ({
      user_id: dos.id,
      title: 'Marks Submitted for Approval',
      message: `${teacherName || 'A teacher'} submitted ${assessmentName || 'marks'} for ${className || 'a class'} / ${subjectName || 'subject'} and it is awaiting your approval.`,
      type: 'info',
      read: false
    }));
    if (rows.length) await sbClient.from('notifications').insert(rows);
  } catch (e) {
    console.error('DOS notify error:', e);
  }
}