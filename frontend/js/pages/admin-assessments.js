let assessFilter = 'all';
async function renderAssessments() {
  setHeader('Assessment Approval', 'Review, approve, or reject teacher-submitted assessments');
  setContent(Utils.loading());
  const [assessments, teachers, classes, subjects, years, terms] = await Promise.all([
    DB.query('assessments', '*', {}, { column: 'created_at', asc: false }),
    DB.get('teachers'), DB.get('classes'), DB.get('subjects'), DB.get('academic_years'), DB.get('terms')
  ]);
  const filtered = assessFilter === 'all' ? assessments : assessments.filter(a => a.status === assessFilter);

  const rows = await Promise.all(filtered.map(async a => {
    const t = teachers.find(t => t.id === a.teacher_id);
    const c = classes.find(c => c.id === a.class_id);
    const s = subjects.find(s => s.id === a.subject_id);
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
      <td>${Utils.escapeHtml(c?.name || '-')}</td><td>${Utils.escapeHtml(s?.name || '-')}</td>
      <td>${Utils.escapeHtml(a.unit)}</td><td>${Utils.escapeHtml(t?.full_name || '-')}</td>
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
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div class="tab-bar">
        <button class="tab-btn ${assessFilter === 'all' ? 'active' : ''}" onclick="assessFilter='all';renderAssessments()">All</button>
        <button class="tab-btn ${assessFilter === 'draft' ? 'active' : ''}" onclick="assessFilter='draft';renderAssessments()">Draft</button>
        <button class="tab-btn ${assessFilter === 'submitted' ? 'active' : ''}" onclick="assessFilter='submitted';renderAssessments()">Submitted</button>
        <button class="tab-btn ${assessFilter === 'approved' ? 'active' : ''}" onclick="assessFilter='approved';renderAssessments()">Approved</button>
        <button class="tab-btn ${assessFilter === 'rejected' ? 'active' : ''}" onclick="assessFilter='rejected';renderAssessments()">Rejected</button>
        <button class="tab-btn ${assessFilter === 'locked' ? 'active' : ''}" onclick="assessFilter='locked';renderAssessments()">Locked</button>
      </div>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Name</th><th>Class</th><th>Subject</th><th>Unit</th><th>Teacher</th><th>Marks</th><th>Max</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rowsHtml || `<tr><td colspan="9">${Utils.empty('No assessments', 'file-text')}</td></tr>`}</tbody></table></div></div>`);
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
    <p class="text-sm text-muted mb-3"><strong style="color:var(--gray-800)">End-of-Unit Assessment:</strong> ${Utils.escapeHtml(assessment.unit)}</p>
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
  const [teachers, classes, subjects, years, terms] = await Promise.all([
    DB.query('teachers', '*', { status: 'active' }), DB.get('classes'),
    DB.query('subjects', '*', { status: 'active' }), DB.get('academic_years'), DB.get('terms')
  ]);
  const selYear = (typeof getActiveYearId === 'function' ? getActiveYearId(years) : null) || '';
  const selTerm = selYear ? (terms.find(t => t.academic_year_id === selYear && t.is_active)?.id || '') : '';
  Modal.show('Create Assessment (DOS)', `
    <div class="form-group"><label>Name <span class="required">*</span></label><input id="asf-name" class="input-field" placeholder="e.g., End-of-Unit Assessment"></div>
    <div class="form-row"><div class="form-group"><label>Academic Year</label><select id="asf-year" class="select-field"><option value="">Select</option>${years.map(y => `<option value="${y.id}" ${y.id === selYear ? 'selected' : ''}>${y.name}</option>`).join('')}</select></div>
    <div class="form-group"><label>Term</label><select id="asf-term" class="select-field"><option value="">Select</option>${terms.map(t => `<option value="${t.id}" ${t.id === selTerm ? 'selected' : ''}>${t.name}</option>`).join('')}</select></div></div>
    <div class="form-row"><div class="form-group"><label>Class <span class="required">*</span></label><select id="asf-class" class="select-field"><option value="">Select</option>${classes.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}</select></div>
    <div class="form-group"><label>Subject <span class="required">*</span></label><select id="asf-subject" class="select-field"><option value="">Select</option>${subjects.map(s => `<option value="${s.id}">${s.name}</option>`).join('')}</select></div></div>
    <div class="form-group"><label>Teacher <span class="required">*</span></label><select id="asf-teacher" class="select-field"><option value="">Select</option>${teachers.map(t => `<option value="${t.id}">${t.full_name}</option>`).join('')}</select></div>
    <div class="form-row"><div class="form-group"><label>Unit <span class="required">*</span></label><input id="asf-unit" class="input-field" placeholder="e.g., Unit 3 - Whole Numbers"></div>
    <div class="form-group"><label>Maximum Mark</label><input id="asf-max" type="number" class="input-field" value="30"></div></div>
    <div class="form-group"><label>Date</label><input id="asf-date" type="date" class="input-field" value="${new Date().toISOString().split('T')[0]}"></div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="assessSave(this)"><i data-lucide="save"></i> Create</button>`);
}

async function assessSave(btn) {
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Creating...';
  }
  const d = {
    name: document.getElementById('asf-name').value.trim(),
    unit: document.getElementById('asf-unit').value.trim(),
    class_id: document.getElementById('asf-class').value,
    subject_id: document.getElementById('asf-subject').value,
    teacher_id: document.getElementById('asf-teacher').value,
    academic_year_id: document.getElementById('asf-year').value,
    term_id: document.getElementById('asf-term').value,
    maximum_mark: parseInt(document.getElementById('asf-max').value) || 30,
    assessment_date: document.getElementById('asf-date').value,
    status: 'draft'
  };
  if (!d.name || !d.class_id || !d.subject_id || !d.teacher_id) return Utils.toast('Fill all required fields', 'error');
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
  assessUpdateStatus(id, 'approved').then(() => {
    notifyTeacher(id, 'Assessment Approved', 'Your assessment was approved by the DOS.', 'success');
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
  notifyTeacher(id, 'Assessment Rejected', `Your assessment was rejected. Reason: ${reason}`, 'error');
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
    if (t.user_id) {
      await DB.insert('notifications', {
        user_id: t.user_id, title, message, type, read: false
      });
    }
  } catch (e) { console.error('Notify error:', e); }
}