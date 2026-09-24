let acadTab = 'years';
let acadSearch = '';

async function renderAcademic() {
  setHeader('Academic Setup', 'Manage academic years, terms, classes and subjects');
  setContent(Utils.loading());
  await loadAcadTab();
}

async function loadAcadTab() {
  const tabs = [
    { id: 'years', label: 'Academic Years', icon: 'calendar' },
    { id: 'terms', label: 'Terms', icon: 'bookmark' },
    { id: 'classes', label: 'Classes', icon: 'school' },
    { id: 'subjects', label: 'Subjects', icon: 'book-open' }
  ];
  let tabHtml = '<div class="tab-bar">' + tabs.map(t =>
    `<button class="tab-btn ${acadTab===t.id?'active':''}" onclick="acadTab='${t.id}';loadAcadTab()"><i data-lucide="${t.icon}" style="width:14px;height:14px;vertical-align:middle;margin-right:4px"></i>${t.label}</button>`
  ).join('') + '</div>';

  if (acadTab === 'years') {
    const data = await DB.query('academic_years', '*', {}, { column: 'name', asc: false });
    const [terms, learners] = await Promise.all([DB.get('terms'), DB.get('learners')]);
    const termCount = id => terms.filter(t => t.academic_year_id === id).length;
    const learnerCount = id => learners.filter(l => l.academic_year_id === id).length;
    const filtered = data.filter(y => !acadSearch || y.name.toLowerCase().includes(acadSearch.toLowerCase()));
    const cards = filtered.map(y => acadYearCard(y, termCount(y.id), learnerCount(y.id))).join('');

    setContent(tabHtml + `
      <div class="flex justify-between items-center mb-4" style="flex-wrap:wrap;gap:10px">
        <div class="search-input-wrapper" style="flex:1;min-width:220px;max-width:360px">
          <i data-lucide="search"></i>
          <input type="text" class="input-field" placeholder="Search by year name..." value="${Utils.escapeHtml(acadSearch)}" oninput="acadSearch=this.value;loadAcadTab()">
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-secondary" onclick="acadCreateNextYear()"><i data-lucide="calendar-plus"></i> Create Next Year</button>
          <button class="btn btn-primary" onclick="acadForm('year')"><i data-lucide="plus"></i> Add Year</button>
        </div>
      </div>
      ${filtered.length ? `<div class="grid-3">${cards}</div>` : `<div class="card">${Utils.empty(filtered.length === 0 && acadSearch ? 'No academic years match your search' : 'No academic years yet — create the first one', 'calendar-off')}</div>`}`);
  } else if (acadTab === 'terms') {
    const [data, years] = await Promise.all([DB.get('terms'), DB.get('academic_years')]);
    const rows = data.map(t => {
      const y = years.find(y => y.id === t.academic_year_id);
      return `<tr>
        <td class="col-name">${Utils.escapeHtml(t.name)}</td>
        <td class="text-center">${t.term_no ? Utils.escapeHtml('Term ' + t.term_no) : '-'}</td>
        <td>${Utils.escapeHtml(y?.name||'-')}</td>
        <td>${t.is_active ? '<span class="badge badge-success"><i data-lucide="check" style="width:12px;height:12px"></i> Active</span>' : '<span class="badge badge-gray">Inactive</span>'}</td>
        <td class="col-actions">
          ${t.is_active ? '' : `<button class="btn btn-sm btn-success" onclick="acadSetActiveTerm('${t.id}')"><i data-lucide="check"></i> Set Active</button>`}
          <button class="btn btn-sm btn-outline" onclick='acadEdit(${JSON.stringify(t).replace(/'/g,"\\'")})'><i data-lucide="pencil"></i> Edit</button>
          <button class="btn btn-sm btn-danger" onclick="acadDelete('terms','${t.id}')"><i data-lucide="trash-2"></i></button>
        </td></tr>`;
    }).join('');
    setContent(tabHtml + `<div class="card">
      <div class="card-header"><h3>Terms</h3><button class="btn btn-primary" onclick="acadForm('term')"><i data-lucide="plus"></i> Add Term</button></div>
      <div class="table-container"><table class="data-table"><thead><tr><th>Name</th><th>No.</th><th>Academic Year</th><th>Active</th><th>Actions</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="5">${Utils.empty('No terms','bookmark')}</td></tr>`}</tbody></table></div></div>`);
  } else if (acadTab === 'classes') {
    const data = await DB.query('classes', '*', {}, { column: 'name' });
    const rows = data.map(c => `<tr><td class="col-name">${Utils.escapeHtml(c.name)}</td><td>${Utils.escapeHtml(c.level)}</td><td>${Utils.escapeHtml(c.stream||'-')}</td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick='acadEdit(${JSON.stringify(c).replace(/'/g,"\\'")})'><i data-lucide="pencil"></i> Edit</button>
        <button class="btn btn-sm btn-danger" onclick="acadDelete('classes','${c.id}')"><i data-lucide="trash-2"></i></button>
      </td></tr>`).join('');
    setContent(tabHtml + `<div class="card">
      <div class="card-header"><h3>Classes</h3><button class="btn btn-primary" onclick="acadForm('class')"><i data-lucide="plus"></i> Add Class</button></div>
      <div class="table-container"><table class="data-table"><thead><tr><th>Name</th><th>Level</th><th>Stream</th><th>Actions</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="4">${Utils.empty('No classes','school')}</td></tr>`}</tbody></table></div></div>`);
  } else if (acadTab === 'subjects') {
    const data = await DB.get('subjects');
    const rows = data.map(s => `<tr><td class="col-name">${Utils.escapeHtml(s.name)}</td><td class="col-code">${Utils.escapeHtml(s.code)}</td>
      <td><span class="badge ${Utils.statusColor(s.status)}"><i data-lucide="${Utils.statusIcon(s.status)}"></i> ${s.status}</span></td>
      <td class="col-actions">
        <button class="btn btn-sm btn-outline" onclick='acadEdit(${JSON.stringify(s).replace(/'/g,"\\'")})'><i data-lucide="pencil"></i> Edit</button>
        <button class="btn btn-sm btn-danger" onclick="acadDelete('subjects','${s.id}')"><i data-lucide="trash-2"></i></button>
      </td></tr>`).join('');
    setContent(tabHtml + `<div class="card">
      <div class="card-header"><h3>Subjects</h3><button class="btn btn-primary" onclick="acadForm('subject')"><i data-lucide="plus"></i> Add Subject</button></div>
      <div class="table-container"><table class="data-table"><thead><tr><th>Name</th><th>Code</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="4">${Utils.empty('No subjects','book-open')}</td></tr>`}</tbody></table></div></div>`);
  }
}

function acadYearCard(y, termCount, learnerCount) {
  const current = !!y.is_current;
  const archivable = !current && y.status !== 'archived';
  return `<div class="card" style="display:flex;flex-direction:column;gap:10px;min-height:190px">
    <div class="flex justify-between items-center">
      <span class="badge ${Utils.statusColor(y.status)}"><i data-lucide="${Utils.statusIcon(y.status)}" style="width:12px;height:12px"></i> ${Utils.escapeHtml(y.status)}</span>
      ${current ? '<span class="badge badge-success"><i data-lucide="star" style="width:12px;height:12px"></i> CURRENT</span>' : ''}
    </div>
    <div>
      <div style="font-size:20px;font-weight:700;line-height:1.2">${Utils.escapeHtml(y.name)}</div>
      <div class="text-sm text-muted" style="margin-top:2px">${y.start_year && y.end_year ? Utils.escapeHtml(y.start_year + '–' + y.end_year) : 'Range not set'}</div>
    </div>
    <div class="flex gap-2 text-sm text-muted" style="flex-wrap:wrap">
      <span>${termCount} ${termCount === 1 ? 'term' : 'terms'}</span><span>&middot;</span><span>${learnerCount} ${learnerCount === 1 ? 'learner' : 'learners'}</span>
    </div>
    <div class="flex gap-2" style="margin-top:auto;flex-wrap:wrap">
      <button class="btn btn-sm btn-outline" onclick='acadEdit(${JSON.stringify(y).replace(/'/g,"\\'")})'><i data-lucide="pencil"></i> Edit</button>
      ${current ? '' : y.status === 'active' ? `<button class="btn btn-sm btn-outline" onclick="acadArchiveYear('${y.id}')"><i data-lucide="archive"></i> Archive</button>` : `<button class="btn btn-sm btn-success" onclick="acadSetCurrent('${y.id}')"><i data-lucide="check"></i> Set Current</button>${archivable ? `<button class="btn btn-sm btn-outline" onclick="acadArchiveYear('${y.id}')"><i data-lucide="archive"></i> Archive</button>` : ''}`}
      ${y.status === 'archived' ? `<button class="btn btn-sm btn-danger" onclick="acadDelete('academic_years','${y.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ''}
    </div>
  </div>`;
}

function parseYearRange(name) {
  const m = String(name || '').match(/(\d{4})\s*[-–—]\s*(\d{4})/);
  return m ? { start_year: Number(m[1]), end_year: Number(m[2]) } : null;
}

async function acadForm(type) {
  let body = '', title = 'Add';
  if (type === 'term') {
    title += ' Term';
    const years = await ensureHeaderYears();
    body = `<div class="form-group"><label>Term Name <span class="required">*</span></label><input id="mf-name" class="input-field" placeholder="e.g., Term 1"></div>
      <div class="form-group"><label>Academic Year <span class="required">*</span></label><select id="mf-year" class="select-field"><option value="">Select Year</option>${years.map(y=>`<option value="${y.id}">${Utils.escapeHtml(y.name)}</option>`).join('')}</select></div>`;
  } else if (type === 'class') {
    title += ' Class';
    body = `<div class="form-group"><label>Class Name <span class="required">*</span></label><input id="mf-name" class="input-field" placeholder="e.g., P4A"></div>
      <div class="form-row"><div class="form-group"><label>Level <span class="required">*</span></label><select id="mf-level" class="select-field">${['P1','P2','P3','P4','P5','P6'].map(l=>`<option value="${l}">${l}</option>`).join('')}</select></div>
      <div class="form-group"><label>Stream</label><input id="mf-stream" class="input-field" placeholder="e.g., A"></div></div>`;
  } else if (type === 'subject') {
    title += ' Subject';
    body = `<div class="form-group"><label>Subject Name <span class="required">*</span></label><input id="mf-name" class="input-field" placeholder="e.g., Mathematics"></div>
      <div class="form-group"><label>Code <span class="required">*</span></label><input id="mf-code" class="input-field" placeholder="e.g., MATH"></div>`;
  } else {
    title += ' Academic Year';
    body = `<div class="form-row">
        <div class="form-group"><label>Start Year <span class="required">*</span></label><input id="mf-start" class="input-field" type="number" min="2000" max="2100" placeholder="e.g., 2026"></div>
        <div class="form-group"><label>End Year <span class="required">*</span></label><input id="mf-end" class="input-field" type="number" min="2001" max="2101" placeholder="e.g., 2027"></div>
      </div>
      <div class="form-group"><label>Status <span class="required">*</span></label><select id="mf-status" class="select-field">
        <option value="upcoming">Upcoming</option><option value="active">Active</option><option value="archived">Archived</option><option value="inactive">Inactive</option>
      </select></div>`;
  }
  Modal.show(title, body,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="acadSave('${type||'year'}')"><i data-lucide="save"></i> Save</button>`);
}

async function acadSave(type) {
  const name = document.getElementById('mf-name')?.value?.trim();
  try {
    if (type === 'year' || !type) {
      const start = Number(document.getElementById('mf-start')?.value);
      const end = Number(document.getElementById('mf-end')?.value);
      if (!start || !end) return Utils.toast('Start and End year are required', 'error');
      if (end !== start + 1) return Utils.toast('End year must be exactly one year after the start year', 'error');
      const stu = document.getElementById('mf-status')?.value || 'upcoming';
      await DB.insert('academic_years', { name: `${start}–${end}`, start_year: start, end_year: end, status: stu });
      invalidateHeaderYears();
    } else if (type === 'term') {
      if (!name) return Utils.toast('Name is required', 'error');
      await DB.insert('terms', { name, academic_year_id: document.getElementById('mf-year').value });
    } else if (type === 'class') {
      if (!name) return Utils.toast('Name is required', 'error');
      await DB.insert('classes', { name, level: document.getElementById('mf-level').value, stream: document.getElementById('mf-stream')?.value || '' });
    } else if (type === 'subject') {
      if (!name) return Utils.toast('Name is required', 'error');
      await DB.insert('subjects', { name, code: document.getElementById('mf-code').value.toUpperCase(), status: 'active' });
    }
    Modal.close();
    Utils.toast('Saved successfully', 'success');
    await loadAcadTab();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

function acadEdit(item) {
  const table = acadTab === 'years' ? 'academic_years' : acadTab;
  const isYear = table === 'academic_years';
  const body = isYear ? `
    <div class="form-group"><label>Year Name <span class="required">*</span></label><input id="mf-name" class="input-field" value="${Utils.escapeHtml(item.name||'')}" placeholder="e.g., 2026–2027"></div>
    <div class="text-sm text-muted">Status: <span class="badge ${Utils.statusColor(item.status)}">${Utils.escapeHtml(item.status)}</span> ${item.is_current ? '<span class="badge badge-success">CURRENT</span>' : ''}</div>
    <div class="text-sm text-muted">Use the buttons on the card to change the current year or archive this year.</div>` : `
    <div class="form-group"><label>Name</label><input id="mf-name" class="input-field" value="${Utils.escapeHtml(item.name||'')}"></div>
    ${item.code!==undefined?`<div class="form-group"><label>Code</label><input id="mf-code" class="input-field" value="${Utils.escapeHtml(item.code||'')}"></div>`:''}
    ${item.stream!==undefined?`<div class="form-group"><label>Stream</label><input id="mf-stream" class="input-field" value="${Utils.escapeHtml(item.stream||'')}"></div>`:''}
    ${item.status!==undefined?`<div class="form-group"><label>Status</label><select id="mf-status" class="select-field"><option value="active" ${item.status==='active'?'selected':''}>Active</option><option value="inactive" ${item.status==='inactive'?'selected':''}>Inactive</option></select></div>`:''}`;
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="if(event.target===this)Modal.close()">
      <div class="modal"><div class="modal-header">Edit ${isYear ? 'Academic Year' : (table === 'terms' ? 'Term' : table === 'classes' ? 'Class' : 'Subject')}</div><div class="modal-body">
        ${body}
      </div><div class="modal-footer">
        <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-primary" onclick="acadUpdate('${item.id}','${table}')"><i data-lucide="save"></i> Update</button>
      </div></div></div>`;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function acadUpdate(id, table) {
  const name = document.getElementById('mf-name')?.value?.trim();
  if (!name) return Utils.toast('Name is required', 'error');
  try {
    if (table === 'academic_years') {
      const range = parseYearRange(name);
      if (!range) return Utils.toast('Year name must look like "2026–2027"', 'error');
      if (range.end_year !== range.start_year + 1) return Utils.toast('End year must be exactly one year after the start year', 'error');
      await DB.update(table, id, { name, start_year: range.start_year, end_year: range.end_year });
      invalidateHeaderYears();
    } else {
      const updates = { name };
      const code = document.getElementById('mf-code')?.value;
      if (code) updates.code = code.toUpperCase();
      const stream = document.getElementById('mf-stream')?.value;
      if (stream !== undefined) updates.stream = stream;
      const status = document.getElementById('mf-status')?.value;
      if (status) updates.status = status;
      await DB.update(table, id, updates);
    }
    Modal.close();
    Utils.toast('Updated', 'success');
    await loadAcadTab();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

async function acadSetCurrent(id) {
  const data = await ensureHeaderYears(true);
  const year = data.find(y => y.id === id);
  Modal.confirm('Set Current Year',
    `Make <strong>${Utils.escapeHtml(year ? year.name : 'this year')}</strong> the current academic year? All other years will be marked inactive.`,
    async () => {
      try {
        await sbClient.from('academic_years').update({ status: 'inactive', is_current: false }).neq('id', id);
        await DB.update('academic_years', id, { status: 'active', is_current: true });
        DB.invalidate('academic_years');
        invalidateHeaderYears();
        refreshHeaderYearSelect();
        Utils.toast('Set as current year', 'success');
        await loadAcadTab();
      } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
    });
}

async function acadArchiveYear(id) {
  const data = await DB.query('academic_years', '*', {}, { column: 'name', asc: false });
  const year = data.find(y => y.id === id) || {};
  if (year.is_current) return Utils.toast('Set another year as Current before archiving this one', 'error');
  Modal.confirm('Archive Academic Year',
    `Archive <strong>${Utils.escapeHtml(year.name || 'this year')}</strong>? Its learners, terms and records are kept but it can no longer serve as the active year.`,
    async () => {
      try {
        await DB.update('academic_years', id, { status: 'archived' });
        invalidateHeaderYears();
        refreshHeaderYearSelect();
        Utils.toast(`${year.name} archived`, 'success');
        await loadAcadTab();
      } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
    });
}

async function acadCreateNextYear() {
  const data = await DB.query('academic_years', '*', {}, { column: 'name', asc: false });
  let maxEnd = Math.max(0, ...data.map(y => y.end_year).filter(Boolean));
  if (!maxEnd) {
    const starts = data.map(y => parseYearRange(y.name)?.start_year).filter(Boolean);
    maxEnd = starts.length ? Math.max(...starts) : new Date().getFullYear();
    if (starts.length) maxEnd += 1;
  }
  if (maxEnd === 0) maxEnd = new Date().getFullYear();
  const nextStart = maxEnd;
  const nextName = `${nextStart}–${nextStart + 1}`;
  const exists = data.some(y => y.name === nextName);
  if (exists) return Utils.toast(nextName + ' already exists', 'error');
  Modal.confirm('Create Next Year',
    `Create the next academic year <strong>${nextName}</strong> (Upcoming)? Terms, classes and learners are copied later through learner promotion.`,
    async () => {
      try {
        await DB.insert('academic_years', { name: nextName, start_year: nextStart, end_year: nextStart + 1, status: 'upcoming' });
        invalidateHeaderYears();
        refreshHeaderYearSelect();
        Utils.toast(`${nextName} created`, 'success');
        await loadAcadTab();
      } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
    });
}

async function acadSetActiveTerm(id) {
  const data = await DB.get('terms');
  const term = data.find(t => t.id === id);
  if (!term) return Utils.toast('Term not found', 'error');
  try {
    await sbClient.from('terms').update({ is_active: false }).eq('academic_year_id', term.academic_year_id).neq('id', id);
    await DB.update('terms', id, { is_active: true });
    DB.invalidate('terms');
    Utils.toast('Term set as active', 'success');
    await loadAcadTab();
  } catch (e) { Utils.toast('Error: ' + e.message, 'error'); }
}

async function acadDelete(table, id) {
  if (table === 'academic_years') {
    const data = await DB.query('academic_years', '*', {}, { column: 'name', asc: false });
    const year = data.find(y => y.id === id) || {};
    if (year.is_current) return Utils.toast('You cannot delete the current academic year — set another year as Current first', 'error');
    Modal.confirm('Delete Academic Year',
      `Delete <strong>${Utils.escapeHtml(year.name || 'this year')}</strong>? This permanently removes the year and all its linked terms, assignments, assessments and learner registrations.`,
      async () => {
        try {
          await DB.remove('academic_years', id);
          invalidateHeaderYears();
          refreshHeaderYearSelect();
          Utils.toast('Year deleted', 'success');
          await loadAcadTab();
        } catch (e) { Utils.toast('Delete failed: ' + e.message, 'error'); }
      });
    return;
  }
  Modal.confirm('Delete record', 'Delete this record permanently?',
    async () => {
      try {
        await DB.remove(table, id);
        Utils.toast('Deleted', 'success');
        await loadAcadTab();
      } catch (e) { Utils.toast('Delete failed: ' + e.message, 'error'); }
    });
}