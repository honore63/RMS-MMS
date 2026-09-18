let teachersSearch = '';
async function renderTeachers() {
  setHeader('Teachers Management', 'Manage teacher accounts and credentials');
  setContent(Utils.loading());
  const data = await DB.query('teachers', '*', {}, { column: 'full_name' });
  const filtered = teachersSearch ? data.filter(t => t.full_name.toLowerCase().includes(teachersSearch.toLowerCase()) || t.teacher_code.toLowerCase().includes(teachersSearch.toLowerCase())) : data;
  const rows = filtered.map(t => `<tr>
    <td class="col-code">${Utils.escapeHtml(t.teacher_code)}</td>
    <td class="col-name">${Utils.escapeHtml(t.full_name)}</td>
    <td>${Utils.escapeHtml(t.email||'-')}</td>
    <td>${Utils.escapeHtml(t.phone||'-')}</td>
    <td><span class="badge ${Utils.statusColor(t.status)}"><i data-lucide="${Utils.statusIcon(t.status)}"></i> ${t.status}</span></td>
    <td class="col-actions">
      <button class="btn btn-sm btn-outline" onclick='teacherEdit(${JSON.stringify(t).replace(/'/g,"&#39;")})'><i data-lucide="pencil"></i> Edit</button>
      ${t.status==='active'?`<button class="btn btn-sm btn-danger" onclick="teacherDeactivate('${t.id}')" title="Deactivate"><i data-lucide="user-x"></i></button>`:`<button class="btn btn-sm btn-success" onclick="teacherActivate('${t.id}')" title="Activate"><i data-lucide="user-check"></i></button>`}
      <button class="btn btn-sm btn-danger" onclick='teacherDelete(${JSON.stringify(t).replace(/'/g,"&#39;")})' title="Delete permanently"><i data-lucide="trash-2"></i></button>
    </td></tr>`).join('');

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div class="search-input-wrapper" style="width:320px">
        <i data-lucide="search"></i>
        <input type="text" class="input-field" placeholder="Search teachers..." value="${teachersSearch}" oninput="teachersSearch=this.value;renderTeachers()">
      </div>
      <button class="btn btn-primary" onclick="teacherForm()"><i data-lucide="user-plus"></i> Add Teacher</button>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Code</th><th>Name</th><th>Email</th><th>Phone</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">${Utils.empty('No teachers found','users')}</td></tr>`}</tbody></table></div></div>`);
}

function teacherForm() {
  Modal.show('Add Teacher', `
    <div class="form-group"><label>Teacher Code (11 Digits) <span class="required">*</span></label><input id="tf-code" class="input-field" placeholder="e.g., 54102325012" maxlength="11"></div>
    <div class="form-group"><label>Full Name <span class="required">*</span></label><input id="tf-name" class="input-field" placeholder="e.g., John Doe"></div>
    <div class="form-group"><label>Email <span class="required">*</span></label><input id="tf-email" class="input-field" placeholder="e.g., john@rukara.edu"></div>
    <div class="form-group"><label>Password</label><input id="tf-pass" class="input-field" value="teacher123"></div>
    <div class="form-group"><label>Phone</label><input id="tf-phone" class="input-field" placeholder="e.g., +250788123456"></div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="teacherSave()"><i data-lucide="save"></i> Save</button>`);
}

async function teacherSave() {
  const code = document.getElementById('tf-code')?.value?.trim();
  const name = document.getElementById('tf-name')?.value?.trim();
  const email = document.getElementById('tf-email')?.value?.trim();
  const pass = document.getElementById('tf-pass')?.value;
  const phone = document.getElementById('tf-phone')?.value?.trim();
  
  if (!code || !name || !email) return Utils.toast('Fill all required fields', 'error');
  if (!/^\d{11}$/.test(code)) return Utils.toast('Teacher code must be exactly 11 digits', 'error');

  try {
    const { data: authData, error } = await sbClient.auth.signUp({ email, password: pass || 'teacher123' });
    if (error) throw error;
    await DB.insert('users', { id: authData.user.id, email, full_name: name, role: 'teacher', status: 'active', phone });
    await DB.insert('teachers', { user_id: authData.user.id, teacher_code: code, full_name: name, email, phone, status: 'active' });
    Modal.close();
    Utils.toast('Teacher created', 'success');
    renderTeachers();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function teacherEdit(t) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)Modal.close()">
      <div class="modal"><div class="modal-header">Edit Teacher</div><div class="modal-body">
        <div class="form-group"><label>Teacher Code</label><input id="te-code" class="input-field" value="${Utils.escapeHtml(t.teacher_code)}"></div>
        <div class="form-group"><label>Full Name</label><input id="te-name" class="input-field" value="${Utils.escapeHtml(t.full_name)}"></div>
        <div class="form-group"><label>Email</label><input id="te-email" class="input-field" value="${Utils.escapeHtml(t.email||'')}"></div>
        <div class="form-group"><label>Phone</label><input id="te-phone" class="input-field" value="${Utils.escapeHtml(t.phone||'')}"></div>
        <div class="form-group"><label>Status</label><select id="te-status" class="select-field"><option value="active" ${t.status==='active'?'selected':''}>Active</option><option value="inactive" ${t.status==='inactive'?'selected':''}>Inactive</option></select></div>
      </div><div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="teacherUpdate('${t.id}')"><i data-lucide="save"></i> Update</button>
      </div></div></div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function teacherUpdate(id) {
  try {
    await DB.update('teachers', id, {
      teacher_code: document.getElementById('te-code').value,
      full_name: document.getElementById('te-name').value,
      email: document.getElementById('te-email').value,
      phone: document.getElementById('te-phone').value,
      status: document.getElementById('te-status').value
    });
    Modal.close();
    Utils.toast('Updated', 'success');
    renderTeachers();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

async function teacherDeactivate(id) {
  Modal.show('Deactivate Teacher', `
    <p class="text-sm text-muted">Deactivate this teacher? They will no longer appear in assignment lists.</p>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="confirmTeacherDeactivate('${id}')"><i data-lucide="user-x"></i> Deactivate</button>`);
}

async function confirmTeacherDeactivate(id) {
  try {
    await DB.update('teachers', id, { status: 'inactive' });
    Modal.close();
    Utils.toast('Teacher deactivated', 'success');
    renderTeachers();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function teacherActivate(id) {
  DB.update('teachers', id, { status: 'active' }).then(() => {
    Utils.toast('Teacher activated', 'success');
    renderTeachers();
  }).catch(e => Utils.toast('Error: ' + e.message, 'error'));
}

function teacherDelete(t) {
  Modal.show('Delete Teacher', `
    <div class="text-center mb-4">
      <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:50%;background:var(--red-50);color:var(--red-500);display:flex;align-items:center;justify-content:center"><i data-lucide="trash-2" style="width:24px;height:24px"></i></div>
      <p style="font-size:15px;color:var(--gray-800)">Delete <strong>${Utils.escapeHtml(t.full_name)}</strong> permanently?</p>
    </div>
    <div class="alert alert-danger" style="margin:0 0 16px"><i data-lucide="alert-triangle"></i> This removes the teacher, their login account and all their assignments. This cannot be undone.</div>
    <div class="alert alert-warning" style="margin-bottom:0"><i data-lucide="info"></i> If the teacher already owns assessments, delete those assessments first — otherwise the delete is blocked.</div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-danger" onclick="confirmTeacherDelete('${t.id}','${t.user_id || ''}')"><i data-lucide="trash-2"></i> Delete Teacher</button>`, true);
}

async function confirmTeacherDelete(id, userId) {
  try {
    if (userId) {
      const { error } = await sbClient.from('users').delete().eq('id', userId);
      if (error) throw error;
    } else {
      await DB.remove('teachers', id);
    }
    await DB.insert('audit_logs', {
      user_id: Auth.currentUser?.id, user_name: Auth.currentUser?.full_name,
      role: Auth.currentUser?.role, action: 'delete_teacher',
      new_value: 'Deleted teacher ' + (id || ''),
      timestamp: new Date().toISOString()
    });
    Modal.close();
    Utils.toast('Teacher deleted', 'success');
    renderTeachers();
  } catch (e) {
    if (/violates foreign key constraint/i.test(e.message || '')) {
      Modal.close();
      Utils.toast('Cannot delete: teacher owns assessments. Delete or reassign those assessments first.', 'error');
    } else {
      Utils.toast('Delete error: ' + e.message, 'error');
    }
  }
}
