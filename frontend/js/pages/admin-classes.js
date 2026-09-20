// ============================================================================
// admin-classes.js — Class Management (DOS Full Control Panel)
// ============================================================================

let classesSearch = '';
let classesLevel  = 'all';
let classesStatus = 'all';
let classesYear   = 'all';

// ---- Main Render ------------------------------------------------------------

async function renderClasses() {
  setHeader('Class Management', 'Full control over school classes, streams and academic year linking');
  setContent(Utils.loading());

  const [classes, years, learners, assignments] = await Promise.all([
    DB.get('classes'),
    DB.get('academic_years'),
    DB.get('learners'),
    DB.get('teacher_assignments')
  ]);

  const levels = Array.from(new Set(classes.map(c => c.level).filter(Boolean))).sort();

  const filtered = classes.filter(c => {
    const matchS  = !classesSearch || (c.name + ' ' + (c.level || '') + ' ' + (c.stream || '')).toLowerCase().includes(classesSearch.toLowerCase());
    const matchL  = classesLevel  === 'all' || c.level === classesLevel;
    const matchSt = classesStatus === 'all' || (c.status || 'active') === classesStatus;
    const matchY  = classesYear   === 'all' || (c.academic_year_id ? c.academic_year_id === classesYear : false);
    return matchS && matchL && matchSt && matchY;
  });

  const totalActive   = classes.filter(c => (c.status || 'active') === 'active').length;
  const totalInactive = classes.filter(c => c.status === 'inactive').length;
  const totalLearners = learners.length;

  const rows = filtered.map(c => {
    const yr           = years.find(y => y.id === c.academic_year_id);
    const learnerCount = learners.filter(l => l.class_id === c.id).length;
    const teacherCount = new Set(assignments.filter(a => a.class_id === c.id).map(a => a.teacher_id)).size;
    const st           = c.status || 'active';
    const isActive     = st === 'active';

    // Level badge colour
    const levelBg = c.level && c.level.startsWith('S')
      ? 'background:var(--purple-100,#ede9fe);color:var(--purple-700,#6d28d9)'
      : 'background:var(--blue-50);color:var(--blue-600)';

    return `<tr>
      <td class="col-name">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;background:var(--blue-50);color:var(--blue-600);flex-shrink:0">
            <i data-lucide="school" style="width:16px;height:16px"></i>
          </span>
          <strong>${Utils.escapeHtml(c.name)}</strong>
        </div>
      </td>
      <td>
        <span class="badge" style="${levelBg};font-weight:700;letter-spacing:.5px">
          <i data-lucide="layers" style="width:11px;height:11px"></i> ${Utils.escapeHtml(c.level || '-')}
        </span>
      </td>
      <td>
        ${c.stream
          ? `<span style="display:inline-flex;align-items:center;gap:4px;font-size:13px"><i data-lucide="git-branch" style="width:13px;height:13px;color:var(--gray-400)"></i>${Utils.escapeHtml(c.stream)}</span>`
          : `<span style="color:var(--gray-400);font-style:italic;font-size:12px">— none —</span>`}
      </td>
      <td>
        <span style="display:inline-flex;align-items:center;gap:5px;font-size:13px">
          <i data-lucide="calendar" style="width:13px;height:13px;color:var(--gray-400)"></i>
          ${Utils.escapeHtml(yr?.name || 'All Years')}
        </span>
      </td>
      <td class="text-center">
        <span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:var(--blue-600)">
          <i data-lucide="users" style="width:13px;height:13px"></i> ${learnerCount}
        </span>
      </td>
      <td class="text-center">
        <span style="display:inline-flex;align-items:center;gap:4px;font-weight:600;color:var(--green-700,#15803d)">
          <i data-lucide="user-check" style="width:13px;height:13px"></i> ${teacherCount}
        </span>
      </td>
      <td>
        <span class="badge ${Utils.statusColor(st)}" style="display:inline-flex;align-items:center;gap:4px">
          <i data-lucide="${isActive ? 'check-circle-2' : 'pause-circle'}" style="width:12px;height:12px"></i>
          ${st.charAt(0).toUpperCase() + st.slice(1)}
        </span>
      </td>
      <td class="col-actions">
        <!-- Edit -->
        <button class="btn btn-sm btn-outline" title="Edit class details"
          onclick='classEdit(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
          <i data-lucide="pencil" style="width:13px;height:13px"></i> Edit
        </button>
        <!-- Activate / Deactivate -->
        ${isActive
          ? `<button class="btn btn-sm" title="Deactivate this class"
               style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca"
               onclick="classToggleStatus('${c.id}','inactive')">
               <i data-lucide="power" style="width:13px;height:13px"></i> Deactivate
             </button>`
          : `<button class="btn btn-sm btn-success" title="Activate this class"
               onclick="classToggleStatus('${c.id}','active')">
               <i data-lucide="zap" style="width:13px;height:13px"></i> Activate
             </button>`}
        <!-- Delete -->
        <button class="btn btn-sm btn-danger" title="Delete class"
          onclick="classDelete('${c.id}','${Utils.escapeHtml(c.name).replace(/'/g,"\\'")}')">
          <i data-lucide="trash-2" style="width:13px;height:13px"></i>
        </button>
      </td>
    </tr>`;
  }).join('');

  setContent(`

    <!-- ── DOS Control Banner ─────────────────────────────────────────── -->
    <div style="display:flex;align-items:center;gap:14px;padding:16px 20px;border-radius:14px;
                background:linear-gradient(135deg,#1e40af 0%,#3b82f6 60%,#60a5fa 100%);
                color:#fff;margin-bottom:24px;box-shadow:0 4px 18px rgba(59,130,246,.35)">
      <div style="background:rgba(255,255,255,.18);border-radius:12px;padding:12px;flex-shrink:0">
        <i data-lucide="shield-check" style="width:32px;height:32px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:18px;font-weight:800;letter-spacing:.2px">DOS Class Control Panel</div>
        <div style="font-size:13px;opacity:.85;margin-top:2px">
          Full CRUD access — add, edit, activate, deactivate and delete classes
        </div>
      </div>
      <button class="btn" onclick="classForm()"
        style="background:#fff;color:#1e40af;font-weight:700;border:none;padding:10px 20px;
               border-radius:10px;display:flex;align-items:center;gap:8px;white-space:nowrap;
               box-shadow:0 2px 8px rgba(0,0,0,.15)">
        <i data-lucide="plus-circle" style="width:18px;height:18px"></i> Add New Class
      </button>
    </div>

    <!-- ── Stat Cards ─────────────────────────────────────────────────── -->
    <div class="grid-3 mb-6" style="gap:16px">
      <div class="stat-card" style="border-left:4px solid var(--blue-500);padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="stat-value">${classes.length}</div>
            <div class="stat-label" style="display:flex;align-items:center;gap:5px">
              <i data-lucide="building-2" style="width:13px;height:13px"></i> Total Classes
            </div>
          </div>
          <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)">
            <i data-lucide="school"></i>
          </div>
        </div>
      </div>
      <div class="stat-card" style="border-left:4px solid #16a34a;padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="stat-value" style="color:#16a34a">${totalActive}</div>
            <div class="stat-label" style="display:flex;align-items:center;gap:5px">
              <i data-lucide="check-circle-2" style="width:13px;height:13px"></i> Active
            </div>
          </div>
          <div class="stat-icon" style="background:#dcfce7;color:#16a34a">
            <i data-lucide="check-circle-2"></i>
          </div>
        </div>
      </div>
      <div class="stat-card" style="border-left:4px solid #d97706;padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="stat-value" style="color:#d97706">${totalInactive}</div>
            <div class="stat-label" style="display:flex;align-items:center;gap:5px">
              <i data-lucide="pause-circle" style="width:13px;height:13px"></i> Inactive
            </div>
          </div>
          <div class="stat-icon" style="background:#fef3c7;color:#d97706">
            <i data-lucide="pause-circle"></i>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Filter Toolbar ─────────────────────────────────────────────── -->
    <div class="card mb-4" style="padding:14px 18px">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:12px">

        <!-- Status tabs -->
        <div class="tab-bar" style="flex-shrink:0">
          <button class="tab-btn ${classesStatus==='all'?'active':''}"
            onclick="classesStatus='all';renderClasses()">
            <i data-lucide="list" style="width:13px;height:13px;margin-right:4px"></i>All (${classes.length})
          </button>
          <button class="tab-btn ${classesStatus==='active'?'active':''}"
            onclick="classesStatus='active';renderClasses()">
            <i data-lucide="check-circle-2" style="width:13px;height:13px;margin-right:4px"></i>Active (${totalActive})
          </button>
          <button class="tab-btn ${classesStatus==='inactive'?'active':''}"
            onclick="classesStatus='inactive';renderClasses()">
            <i data-lucide="pause-circle" style="width:13px;height:13px;margin-right:4px"></i>Inactive (${totalInactive})
          </button>
        </div>

        <!-- Search -->
        <div class="search-input-wrapper" style="flex:1;min-width:200px">
          <i data-lucide="search"></i>
          <input type="text" class="input-field" placeholder="Search class name, level or stream..."
            value="${Utils.escapeHtml(classesSearch)}"
            oninput="classesSearch=this.value;renderClasses()">
        </div>

        <!-- Level filter -->
        <div class="form-group" style="margin:0;min-width:130px">
          <select class="select-field" onchange="classesLevel=this.value;renderClasses()">
            <option value="all">🎓 All Levels</option>
            ${levels.map(l => `<option value="${l}" ${classesLevel===l?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>

        <!-- Year filter -->
        <div class="form-group" style="margin:0;min-width:160px">
          <select class="select-field" onchange="classesYear=this.value;renderClasses()">
            <option value="all">📅 All Academic Years</option>
            ${years.map(y => `<option value="${y.id}" ${classesYear===y.id?'selected':''}>${Utils.escapeHtml(y.name)}</option>`).join('')}
          </select>
        </div>

      </div>
    </div>

    <!-- ── Classes Table ──────────────────────────────────────────────── -->
    <div class="card">
      <div class="card-header" style="border-bottom:1px solid var(--border-color,#e5e7eb);padding:14px 20px">
        <h3 style="display:flex;align-items:center;gap:8px;margin:0;font-size:15px;font-weight:700">
          <i data-lucide="table-2" style="width:18px;height:18px;color:var(--blue-600)"></i>
          School Classes
          <span style="background:var(--blue-50);color:var(--blue-700);font-size:12px;
                       padding:2px 10px;border-radius:20px;font-weight:600;margin-left:4px">
            ${filtered.length} shown
          </span>
        </h3>
        <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--gray-400)">
          <i data-lucide="shield-check" style="width:13px;height:13px;color:#16a34a"></i>
          DOS Full Access
        </div>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th><i data-lucide="school" style="width:12px;height:12px;margin-right:4px"></i>Class Name</th>
              <th><i data-lucide="layers" style="width:12px;height:12px;margin-right:4px"></i>Level</th>
              <th><i data-lucide="git-branch" style="width:12px;height:12px;margin-right:4px"></i>Stream</th>
              <th><i data-lucide="calendar" style="width:12px;height:12px;margin-right:4px"></i>Academic Year</th>
              <th class="text-center"><i data-lucide="users" style="width:12px;height:12px;margin-right:2px"></i>Learners</th>
              <th class="text-center"><i data-lucide="user-check" style="width:12px;height:12px;margin-right:2px"></i>Teachers</th>
              <th><i data-lucide="activity" style="width:12px;height:12px;margin-right:4px"></i>Status</th>
              <th><i data-lucide="settings-2" style="width:12px;height:12px;margin-right:4px"></i>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td colspan="8">${Utils.empty('No classes found — use the button above to add one', 'school')}</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---- Add Form ---------------------------------------------------------------

async function classForm() {
  const years       = await DB.get('academic_years');
  const activeYearId = (typeof getActiveYearId === 'function' ? getActiveYearId(years) : null) || '';
  const presetLevels = ['P1','P2','P3','P4','P5','P6','S1','S2','S3','S4','S5','S6'];

  Modal.show('📚 Add New Class', `
    <div style="background:linear-gradient(135deg,#eff6ff,#e0f2fe);border-radius:10px;
                padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <i data-lucide="info" style="width:16px;height:16px;color:#2563eb;flex-shrink:0"></i>
      <span style="font-size:13px;color:#1e40af">The stream/combination is auto-combined with
        the level to generate the class name below. You can override it.</span>
    </div>
    <div class="form-group">
      <label><i data-lucide="tag" style="width:13px;height:13px;margin-right:4px"></i>Class Name <span class="required">*</span></label>
      <input id="cf-name" class="input-field" placeholder="e.g., S4 – Stream 1 or P4A"
        oninput="this.dataset.userEdited='true'">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label><i data-lucide="layers" style="width:13px;height:13px;margin-right:4px"></i>Level / Grade <span class="required">*</span></label>
        <select id="cf-level" class="select-field" onchange="classAutoName()">
          <option value="">Select Level</option>
          ${presetLevels.map(l => `<option value="${l}">${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label><i data-lucide="git-branch" style="width:13px;height:13px;margin-right:4px"></i>Stream / Combination</label>
        <input id="cf-stream" class="input-field" placeholder="e.g., A, Stream 1, PCM, MEG"
          oninput="classAutoName()">
      </div>
    </div>
    <div class="form-group">
      <label><i data-lucide="calendar" style="width:13px;height:13px;margin-right:4px"></i>Academic Year</label>
      <select id="cf-year" class="select-field">
        <option value="">All Academic Years (Global Default)</option>
        ${years.map(y => `<option value="${y.id}" ${activeYearId===y.id?'selected':''}>${Utils.escapeHtml(y.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label><i data-lucide="activity" style="width:13px;height:13px;margin-right:4px"></i>Status</label>
      <select id="cf-status" class="select-field">
        <option value="active" selected>✅ Active</option>
        <option value="inactive">⏸ Inactive</option>
      </select>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">
       <i data-lucide="x" style="width:14px;height:14px"></i> Cancel
     </button>
     <button class="btn btn-primary" onclick="classSave()">
       <i data-lucide="save" style="width:14px;height:14px"></i> Save Class
     </button>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function classAutoName() {
  const level  = document.getElementById('cf-level')?.value || '';
  const stream = (document.getElementById('cf-stream')?.value || '').trim();
  const nameEl = document.getElementById('cf-name');
  if (!nameEl || nameEl.dataset.userEdited === 'true') return;
  nameEl.value = (level && stream) ? `${level} – ${stream}` : level;
}

async function classSave() {
  const name             = document.getElementById('cf-name')?.value?.trim();
  const level            = document.getElementById('cf-level')?.value?.trim();
  const stream           = document.getElementById('cf-stream')?.value?.trim() || null;
  const academic_year_id = document.getElementById('cf-year')?.value || null;
  const status           = document.getElementById('cf-status')?.value || 'active';

  if (!name)  return Utils.toast('⚠️ Class name is required', 'error');
  if (!level) return Utils.toast('⚠️ Level / Grade is required', 'error');

  try {
    const existing = await DB.get('classes');
    if (existing.some(c => c.name.toLowerCase() === name.toLowerCase() &&
        (c.academic_year_id||null) === (academic_year_id||null))) {
      return Utils.toast(`❌ "${name}" already exists for this academic year`, 'error');
    }
    await DB.insert('classes', { name, level, stream, academic_year_id, status });
    Modal.close();
    Utils.toast('✅ Class created successfully', 'success');
    renderClasses();
  } catch (e) {
    Utils.toast(/duplicate|unique/i.test(e.message||'')
      ? `❌ "${name}" already exists for this year`
      : '❌ Error: ' + e.message, 'error');
  }
}

// ---- Edit Form --------------------------------------------------------------

async function classEdit(c) {
  const years        = await DB.get('academic_years');
  const presetLevels = ['P1','P2','P3','P4','P5','P6','S1','S2','S3','S4','S5','S6'];

  Modal.show('✏️ Edit Class Details', `
    <div class="form-group">
      <label><i data-lucide="tag" style="width:13px;height:13px;margin-right:4px"></i>Class Name <span class="required">*</span></label>
      <input id="ce-name" class="input-field" value="${Utils.escapeHtml(c.name)}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label><i data-lucide="layers" style="width:13px;height:13px;margin-right:4px"></i>Level / Grade <span class="required">*</span></label>
        <select id="ce-level" class="select-field">
          ${presetLevels.map(l => `<option value="${l}" ${c.level===l?'selected':''}>${l}</option>`).join('')}
        </select>
      </div>
      <div class="form-group">
        <label><i data-lucide="git-branch" style="width:13px;height:13px;margin-right:4px"></i>Stream / Combination</label>
        <input id="ce-stream" class="input-field" value="${Utils.escapeHtml(c.stream||'')}">
      </div>
    </div>
    <div class="form-group">
      <label><i data-lucide="calendar" style="width:13px;height:13px;margin-right:4px"></i>Academic Year</label>
      <select id="ce-year" class="select-field">
        <option value="">All Academic Years (Global Default)</option>
        ${years.map(y => `<option value="${y.id}" ${c.academic_year_id===y.id?'selected':''}>${Utils.escapeHtml(y.name)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group">
      <label><i data-lucide="activity" style="width:13px;height:13px;margin-right:4px"></i>Status</label>
      <select id="ce-status" class="select-field">
        <option value="active"   ${(c.status||'active')==='active'  ?'selected':''}>✅ Active</option>
        <option value="inactive" ${c.status==='inactive'            ?'selected':''}>⏸ Inactive</option>
      </select>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">
       <i data-lucide="x" style="width:14px;height:14px"></i> Cancel
     </button>
     <button class="btn btn-primary" onclick="classUpdate('${c.id}')">
       <i data-lucide="save" style="width:14px;height:14px"></i> Update Class
     </button>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function classUpdate(id) {
  const name             = document.getElementById('ce-name')?.value?.trim();
  const level            = document.getElementById('ce-level')?.value?.trim();
  const stream           = document.getElementById('ce-stream')?.value?.trim() || null;
  const academic_year_id = document.getElementById('ce-year')?.value || null;
  const status           = document.getElementById('ce-status')?.value || 'active';

  if (!name || !level) return Utils.toast('⚠️ Name and level are required', 'error');

  try {
    const existing = await DB.get('classes');
    if (existing.some(c => c.id !== id &&
        c.name.toLowerCase() === name.toLowerCase() &&
        (c.academic_year_id||null) === (academic_year_id||null))) {
      return Utils.toast(`❌ "${name}" already exists for this academic year`, 'error');
    }
    await DB.update('classes', id, { name, level, stream, academic_year_id, status });
    Modal.close();
    Utils.toast('✅ Class updated successfully', 'success');
    renderClasses();
  } catch (e) {
    Utils.toast('❌ Update error: ' + e.message, 'error');
  }
}

// ---- Toggle Status ----------------------------------------------------------

async function classToggleStatus(id, newStatus) {
  try {
    await DB.update('classes', id, { status: newStatus });
    Utils.toast(newStatus === 'active' ? '✅ Class activated' : '⏸ Class deactivated', 'success');
    renderClasses();
  } catch (e) {
    Utils.toast('❌ Status update failed: ' + e.message, 'error');
  }
}

// ---- Delete -----------------------------------------------------------------

async function classDelete(id, name) {
  const [linkedLearners, linkedAssignments] = await Promise.all([
    DB.query('learners',           '*', { class_id: id }),
    DB.query('teacher_assignments','*', { class_id: id })
  ]);

  if (linkedLearners.length > 0 || linkedAssignments.length > 0) {
    return Modal.show('🚫 Cannot Delete Class', `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;
                  padding:14px 16px;display:flex;gap:12px;align-items:flex-start;margin-bottom:14px">
        <i data-lucide="alert-triangle" style="width:20px;height:20px;color:#dc2626;flex-shrink:0;margin-top:1px"></i>
        <div>
          <strong style="color:#991b1b">${Utils.escapeHtml(name)}</strong> cannot be deleted because it is
          currently linked to:<br><br>
          <span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;color:#1d4ed8">
            <i data-lucide="users" style="width:14px;height:14px"></i> ${linkedLearners.length} Learner(s)
          </span>
          &nbsp;&nbsp;
          <span style="display:inline-flex;align-items:center;gap:5px;font-weight:600;color:#15803d">
            <i data-lucide="user-check" style="width:14px;height:14px"></i> ${linkedAssignments.length} Teacher Assignment(s)
          </span>
        </div>
      </div>
      <p style="font-size:13px;color:var(--gray-500);margin:0">
        <i data-lucide="lightbulb" style="width:13px;height:13px;margin-right:4px;color:#d97706"></i>
        You can <strong>Deactivate</strong> the class instead to hide it without losing any data.
      </p>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">
         <i data-lucide="x" style="width:13px;height:13px"></i> Close
       </button>
       <button class="btn btn-danger" onclick="Modal.close();classToggleStatus('${id}','inactive')">
         <i data-lucide="power" style="width:13px;height:13px"></i> Deactivate Instead
       </button>`);
  }

  Modal.confirm('🗑️ Delete Class',
    `<span>Permanently delete class <strong>${Utils.escapeHtml(name)}</strong>?
     This action <strong>cannot be undone</strong>.</span>`,
    async () => {
      try {
        await DB.remove('classes', id);
        Utils.toast('🗑️ Class deleted', 'success');
        renderClasses();
      } catch (e) {
        Utils.toast('❌ Delete error: ' + e.message, 'error');
      }
    });
}
