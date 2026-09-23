// ============================================================================
// admin-classes.js — Class Management (DOS Control Panel with Education Level Grouping)
// ============================================================================

let classesSearch    = '';
let classesCategory  = 'all'; // Primary, Lower Secondary, Upper Secondary
let classesStatus    = 'all';
let classesYear      = 'all';

// ---- Main Render ------------------------------------------------------------

async function renderClasses() {
  setHeader('Class Management', 'Organize & control school classes by Education Level categories (Primary, Lower & Upper Secondary)');
  setContent(Utils.loading());

  const [classes, years, learners, assignments, eduLevels] = await Promise.all([
    DB.get('classes'),
    DB.get('academic_years'),
    DB.get('learners'),
    DB.get('teacher_assignments'),
    DB.get('education_levels').catch(() => [])
  ]);

  // Ensure education level property on all classes
  classes.forEach(c => {
    c.education_level = EducationLevels.getCategory(c);
  });

  const categories = ['Primary', 'Lower Secondary', 'Upper Secondary'];
  const scopedCats  = (typeof Scope !== 'undefined' && Scope.isScoped()) ? Scope.categories() : null;

  const filtered = classes.filter(c => {
    const matchS  = !classesSearch || (c.name + ' ' + (c.level || '') + ' ' + (c.stream || '') + ' ' + (c.education_level || '')).toLowerCase().includes(classesSearch.toLowerCase());
    const matchC  = classesCategory === 'all' || c.education_level === classesCategory;
    const matchSt = classesStatus   === 'all' || (c.status || 'active') === classesStatus;
    const matchY  = classesYear     === 'all' || (c.academic_year_id ? c.academic_year_id === classesYear : false);
    return matchS && matchC && matchSt && matchY;
  });

  const totalActive   = classes.filter(c => (c.status || 'active') === 'active').length;
  const totalInactive = classes.filter(c => c.status === 'inactive').length;
  const totalLearners = learners.length;

  // Group filtered classes by Education Level
  const grouped = {
    'Primary': filtered.filter(c => c.education_level === 'Primary'),
    'Lower Secondary': filtered.filter(c => c.education_level === 'Lower Secondary'),
    'Upper Secondary': filtered.filter(c => c.education_level === 'Upper Secondary'),
  };

  // Add any leftover custom levels
  filtered.forEach(c => {
    if (!grouped[c.education_level]) {
      grouped[c.education_level] = [];
    }
    if (!['Primary', 'Lower Secondary', 'Upper Secondary'].includes(c.education_level) && !grouped[c.education_level].includes(c)) {
      grouped[c.education_level].push(c);
    }
  });

  const categoryIcons = {
    'Primary': 'book-open',
    'Lower Secondary': 'layers',
    'Upper Secondary': 'graduation-cap',
    'Nursery': 'baby',
    'TVET': 'wrench'
  };

  const categoryColors = {
    'Primary': 'linear-gradient(135deg,#059669,#10b981)',
    'Lower Secondary': 'linear-gradient(135deg,#2563eb,#3b82f6)',
    'Upper Secondary': 'linear-gradient(135deg,#7c3aed,#8b5cf6)',
  };

  const renderCategoryCards = (catName, catClasses) => {
    if (!catClasses.length) return '';

    const catLearners = catClasses.reduce((sum, c) => sum + learners.filter(l => l.class_id === c.id).length, 0);
    const catTeachers = new Set(assignments.filter(a => catClasses.some(c => c.id === a.class_id)).map(a => a.teacher_id)).size;

    const cardsHtml = catClasses.map(c => {
      const yr           = years.find(y => y.id === c.academic_year_id);
      const learnerCount = learners.filter(l => l.class_id === c.id).length;
      const teacherCount = new Set(assignments.filter(a => a.class_id === c.id).map(a => a.teacher_id)).size;
      const st           = c.status || 'active';
      const isActive     = st === 'active';

      return `
        <div class="card" style="border-radius:14px;border:1px solid var(--border-color,#e5e7eb);box-shadow:0 2px 8px rgba(0,0,0,.04);padding:18px;display:flex;flex-direction:column;justify-content:space-between;transition:transform .15s,box-shadow .15s">
          <div>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
              <span class="badge" style="background:var(--blue-50);color:var(--blue-700);font-weight:700;font-size:11px;letter-spacing:.4px">
                <i data-lucide="layers" style="width:11px;height:11px"></i> ${Utils.escapeHtml(catName.toUpperCase())}
              </span>
              <span class="badge ${Utils.statusColor(st)}" style="font-size:11px">
                <i data-lucide="${isActive ? 'check-circle-2' : 'pause-circle'}" style="width:11px;height:11px"></i> ${st}
              </span>
            </div>

            <h4 style="font-size:18px;font-weight:800;color:var(--gray-900);margin:0 0 6px 0;display:flex;align-items:center;gap:8px">
              <i data-lucide="school" style="width:18px;height:18px;color:var(--blue-600)"></i>
              ${Utils.escapeHtml(c.name)}
            </h4>

            <div style="font-size:13px;color:var(--gray-500);margin-bottom:14px;display:flex;gap:12px;flex-wrap:wrap">
              ${c.stream ? `<span style="display:inline-flex;align-items:center;gap:4px;background:#f3f4f6;padding:2px 8px;border-radius:6px;font-weight:600"><i data-lucide="git-branch" style="width:12px;height:12px"></i> ${Utils.escapeHtml(c.stream)}</span>` : ''}
              <span style="display:inline-flex;align-items:center;gap:4px"><i data-lucide="calendar" style="width:12px;height:12px"></i> ${Utils.escapeHtml(yr?.name || 'All Years')}</span>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:10px 12px;background:var(--gray-50,#f9fafb);border-radius:10px;margin-bottom:14px">
              <div style="text-align:center">
                <div style="font-size:16px;font-weight:800;color:var(--blue-600)">${learnerCount}</div>
                <div style="font-size:11px;color:var(--gray-500);font-weight:600">Students</div>
              </div>
              <div style="text-align:center;border-left:1px solid #e5e7eb">
                <div style="font-size:16px;font-weight:800;color:#16a34a">${teacherCount}</div>
                <div style="font-size:11px;color:var(--gray-500);font-weight:600">Teachers</div>
              </div>
            </div>
          </div>

          <div style="display:flex;gap:8px;padding-top:10px;border-top:1px solid #f3f4f6">
            <button class="btn btn-sm btn-outline" style="flex:1" onclick='classEdit(${JSON.stringify(c).replace(/'/g, "&#39;")})'>
              <i data-lucide="pencil" style="width:13px;height:13px"></i> Edit
            </button>
            ${isActive
              ? `<button class="btn btn-sm" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca" onclick="classToggleStatus('${c.id}','inactive')">
                   <i data-lucide="power" style="width:13px;height:13px"></i> Deactivate
                 </button>`
              : `<button class="btn btn-sm btn-success" onclick="classToggleStatus('${c.id}','active')">
                   <i data-lucide="zap" style="width:13px;height:13px"></i> Activate
                 </button>`}
            <button class="btn btn-sm btn-danger" onclick="classDelete('${c.id}','${Utils.escapeHtml(c.name).replace(/'/g,"\\'")}')">
              <i data-lucide="trash-2" style="width:13px;height:13px"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="margin-bottom:28px">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 18px;border-radius:12px;background:${categoryColors[catName] || 'linear-gradient(135deg,#3b82f6,#60a5fa)'};color:#fff;margin-bottom:14px;box-shadow:0 3px 12px rgba(0,0,0,.08)">
          <div style="display:flex;align-items:center;gap:10px">
            <i data-lucide="${categoryIcons[catName] || 'school'}" style="width:22px;height:22px"></i>
            <h3 style="margin:0;font-size:16px;font-weight:800;letter-spacing:.3px">${catName.toUpperCase()}</h3>
            <span style="background:rgba(255,255,255,.25);padding:2px 10px;border-radius:20px;font-size:12px;font-weight:700">
              ${catClasses.length} Class${catClasses.length === 1 ? '' : 'es'}
            </span>
          </div>
          <div style="font-size:12px;opacity:.9;display:flex;gap:16px">
            <span>👥 <strong>${catLearners}</strong> Learners</span>
            <span>👩‍🏫 <strong>${catTeachers}</strong> Teachers</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:16px">
          ${cardsHtml}
        </div>
      </div>
    `;
  };

  const sectionsHtml = Object.keys(grouped).map(catName => renderCategoryCards(catName, grouped[catName])).join('');

  setContent(`
    <!-- ── DOS Control Banner ─────────────────────────────────────────── -->
    <div style="display:flex;align-items:center;gap:14px;padding:18px 22px;border-radius:16px;
                background:linear-gradient(135deg,#1e3a8a 0%,#2563eb 60%,#3b82f6 100%);
                color:#fff;margin-bottom:24px;box-shadow:0 6px 20px rgba(37,99,235,.3)">
      <div style="background:rgba(255,255,255,.18);border-radius:12px;padding:12px;flex-shrink:0">
        <i data-lucide="layers" style="width:34px;height:34px"></i>
      </div>
      <div style="flex:1">
        <div style="font-size:19px;font-weight:800;letter-spacing:.2px">DOS Education Level & Class Management</div>
        <div style="font-size:13px;opacity:.88;margin-top:2px">
          Structured by Primary, Lower Secondary, and Upper Secondary Streams
        </div>
      </div>
      <button class="btn" onclick="classForm()"
        style="background:#fff;color:#1e3a8a;font-weight:800;border:none;padding:11px 22px;
               border-radius:12px;display:flex;align-items:center;gap:8px;white-space:nowrap;
               box-shadow:0 3px 10px rgba(0,0,0,.2);cursor:pointer">
        <i data-lucide="plus-circle" style="width:18px;height:18px"></i> Add Class
      </button>
    </div>

    <!-- ── Stat Cards ─────────────────────────────────────────────────── -->
    <div class="grid-3 mb-6" style="gap:16px">
      <div class="stat-card" style="border-left:4px solid var(--blue-500);padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="stat-value">${classes.length}</div>
            <div class="stat-label" style="display:flex;align-items:center;gap:5px">
              <i data-lucide="school" style="width:13px;height:13px"></i> Total Classes
            </div>
          </div>
          <div class="stat-icon" style="background:var(--blue-50);color:var(--blue-600)">
            <i data-lucide="layers"></i>
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
      <div class="stat-card" style="border-left:4px solid #7c3aed;padding:16px 20px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="stat-value" style="color:#7c3aed">${totalLearners}</div>
            <div class="stat-label" style="display:flex;align-items:center;gap:5px">
              <i data-lucide="users" style="width:13px;height:13px"></i> Enrolled Learners
            </div>
          </div>
          <div class="stat-icon" style="background:#f3e8ff;color:#7c3aed">
            <i data-lucide="users"></i>
          </div>
        </div>
      </div>
    </div>

    <!-- ── Filter Toolbar ─────────────────────────────────────────────── -->
    <div class="card mb-6" style="padding:16px 20px">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:14px">

        <!-- Search -->
        <div class="search-input-wrapper" style="flex:1;min-width:220px">
          <i data-lucide="search"></i>
          <input type="text" class="input-field" placeholder="Search class, grade, level or stream..."
            value="${Utils.escapeHtml(classesSearch)}"
            oninput="classesSearch=this.value;renderClasses()">
        </div>

        <!-- Education Level filter -->
        <div class="form-group" style="margin:0;min-width:170px">
          <select class="select-field" onchange="classesCategory=this.value;renderClasses()">
            ${scopedCats
              ? `<option value="all">${Scope.isPrimary() ? '📗' : '📘📙'} ${Scope.label() === 'DOS PRIMARY' ? 'Primary Scope' : 'Secondary Scope'}</option>` +
                scopedCats.map(cat => `<option value="${cat}" ${classesCategory===cat?'selected':''}>${cat==='Primary'?'📗':'📘'} ${cat}</option>`).join('')
              : `<option value="all">🎓 All Education Levels</option>
                 <option value="Primary" ${classesCategory==='Primary'?'selected':''}>📗 Primary (P1-P6)</option>
                 <option value="Lower Secondary" ${classesCategory==='Lower Secondary'?'selected':''}>📘 Lower Secondary (S1-S3)</option>
                 <option value="Upper Secondary" ${classesCategory==='Upper Secondary'?'selected':''}>📙 Upper Secondary (S4-S6)</option>`}
          </select>
        </div>

        <!-- Year filter -->
        <div class="form-group" style="margin:0;min-width:170px">
          <select class="select-field" onchange="classesYear=this.value;renderClasses()">
            <option value="all">📅 All Academic Years</option>
            ${years.map(y => `<option value="${y.id}" ${classesYear===y.id?'selected':''}>${Utils.escapeHtml(y.name)}</option>`).join('')}
          </select>
        </div>

        <!-- Status filter -->
        <div class="form-group" style="margin:0;min-width:130px">
          <select class="select-field" onchange="classesStatus=this.value;renderClasses()">
            <option value="all">⚡ All Statuses</option>
            <option value="active" ${classesStatus==='active'?'selected':''}>✅ Active</option>
            <option value="inactive" ${classesStatus==='inactive'?'selected':''}>⏸ Inactive</option>
          </select>
        </div>

      </div>
    </div>

    <!-- ── Grouped Education Level Class Cards ────────────────────────── -->
    ${sectionsHtml || Utils.empty('No classes matching the selected filters', 'school')}
  `);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ---- Add Cascading Class Form -----------------------------------------------

async function classForm() {
  const years        = await DB.get('academic_years');
  const activeYearId = (typeof getActiveYearId === 'function' ? getActiveYearId(years) : null) || '';

  Modal.show('📚 Add New Class (Cascading Education Level)', `
    <div style="background:linear-gradient(135deg,#eff6ff,#e0f2fe);border-radius:10px;
                padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
      <i data-lucide="info" style="width:18px;height:18px;color:#2563eb;flex-shrink:0"></i>
      <span style="font-size:13px;color:#1e40af">Select Education Level first. Grades and Streams will automatically update to prevent invalid combinations.</span>
    </div>

    <div class="form-group">
      <label><i data-lucide="layers" style="width:13px;height:13px;margin-right:4px"></i>1. Education Level <span class="required">*</span></label>
      <select id="cf-category" class="select-field" onchange="classOnCategoryChange()">
        <option value="">Select Education Level</option>
        ${scopedCats
          ? scopedCats.map(cat => `<option value="${cat}">${cat==='Primary'?'📗':'📘'} ${cat}</option>`).join('')
          : `<option value="Primary">Primary (P1 - P6)</option>
             <option value="Lower Secondary">Lower Secondary (S1 - S3)</option>
             <option value="Upper Secondary">Upper Secondary (S4 - S6)</option>`}
      </select>
    </div>

    <div class="form-row">
      <div class="form-group">
        <label><i data-lucide="graduation-cap" style="width:13px;height:13px;margin-right:4px"></i>2. Class Grade <span class="required">*</span></label>
        <select id="cf-level" class="select-field" onchange="classOnGradeChange()">
          <option value="">Select Grade</option>
        </select>
      </div>
      <div class="form-group">
        <label><i data-lucide="git-branch" style="width:13px;height:13px;margin-right:4px"></i>3. Stream / Combination</label>
        <select id="cf-stream-select" class="select-field" onchange="classOnStreamChange()">
          <option value="">Select Stream / Combination</option>
        </select>
      </div>
    </div>

    <div class="form-group">
      <label><i data-lucide="tag" style="width:13px;height:13px;margin-right:4px"></i>Full Class Name <span class="required">*</span></label>
      <input id="cf-name" class="input-field" placeholder="Auto-generated e.g. S6 – PCM or P4A" data-user-edited="false" oninput="this.dataset.userEdited='true'">
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
    </div>
  `,
  `<button class="btn btn-secondary" onclick="Modal.close()">
     <i data-lucide="x" style="width:14px;height:14px"></i> Cancel
   </button>
   <button class="btn btn-primary" onclick="classSave()">
     <i data-lucide="save" style="width:14px;height:14px"></i> Save Class
   </button>`);

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function classOnCategoryChange() {
  const cat = document.getElementById('cf-category')?.value || '';
  const gradeSelect = document.getElementById('cf-level');
  const streamSelect = document.getElementById('cf-stream-select');

  if (!gradeSelect) return;

  const allowedGrades = EducationLevels.getAllowedGrades(cat);
  gradeSelect.innerHTML = `<option value="">Select Grade</option>` + 
    allowedGrades.map(g => `<option value="${g}">${g}</option>`).join('');

  if (streamSelect) {
    streamSelect.innerHTML = `<option value="">Select Stream / Combination</option>`;
  }

  classAutoNameCascading();
}

function classOnGradeChange() {
  const grade = document.getElementById('cf-level')?.value || '';
  const streamSelect = document.getElementById('cf-stream-select');

  if (streamSelect) {
    const allowedStreams = EducationLevels.getAllowedStreams(grade);
    streamSelect.innerHTML = `<option value="">Select Stream / Combination</option>` +
      allowedStreams.map(s => `<option value="${s}">${s}</option>`).join('');
  }

  classAutoNameCascading();
}

function classOnStreamChange() {
  classAutoNameCascading();
}

function classAutoNameCascading() {
  const cat    = document.getElementById('cf-category')?.value || '';
  const grade  = document.getElementById('cf-level')?.value || '';
  const stream = document.getElementById('cf-stream-select')?.value || '';
  const nameEl = document.getElementById('cf-name');

  if (!nameEl || nameEl.dataset.userEdited === 'true') return;

  if (grade && stream) {
    nameEl.value = `${grade} – ${stream}`;
  } else if (grade) {
    nameEl.value = grade;
  } else {
    nameEl.value = '';
  }
}

async function classSave() {
  const education_level = document.getElementById('cf-category')?.value || '';
  const level           = document.getElementById('cf-level')?.value?.trim() || '';
  const stream          = document.getElementById('cf-stream-select')?.value?.trim() || null;
  const name            = document.getElementById('cf-name')?.value?.trim();
  const academic_year_id= document.getElementById('cf-year')?.value || null;
  const status          = document.getElementById('cf-status')?.value || 'active';

  if (!education_level) return Utils.toast('⚠️ Education level is required', 'error');
  if (!level)           return Utils.toast('⚠️ Class grade is required', 'error');
  if (!name)            return Utils.toast('⚠️ Class name is required', 'error');

  // Validate Combination
  const check = EducationLevels.isValidCombination(education_level, level, stream);
  if (!check.valid) {
    return Utils.toast(`❌ Invalid Combination: ${check.message}`, 'error');
  }
  if (typeof Scope !== 'undefined' && Scope.isScoped() && !Scope.categories().includes(education_level)) {
    return Utils.toast(`❌ ${education_level} classes are outside your ${Scope.label()} scope`, 'error');
  }

  try {
    const existing = await DB.get('classes');
    if (existing.some(c => c.name.toLowerCase() === name.toLowerCase() &&
        (c.academic_year_id||null) === (academic_year_id||null))) {
      return Utils.toast(`❌ "${name}" already exists for this academic year`, 'error');
    }
    await DB.insert('classes', { name, level, stream, education_level, academic_year_id, status });
    Modal.close();
    Utils.toast('✅ Class created successfully', 'success');
    renderClasses();
  } catch (e) {
    Utils.toast('❌ Error saving class: ' + e.message, 'error');
  }
}

// ---- Edit Form --------------------------------------------------------------

async function classEdit(c) {
  const years = await DB.get('academic_years');
  const cat   = c.education_level || EducationLevels.getCategory(c);
  const scopedCats = (typeof Scope !== 'undefined' && Scope.isScoped()) ? Scope.categories() : null;

  Modal.show('✏️ Edit Class Details', `
    <div class="form-group">
      <label><i data-lucide="layers" style="width:13px;height:13px;margin-right:4px"></i>Education Level <span class="required">*</span></label>
      <select id="ce-category" class="select-field">
        ${scopedCats
          ? scopedCats.map(category => `<option value="${category}" ${category===cat?'selected':''}>${category==='Primary'?'📗':'📘'} ${category}</option>`).join('')
          : `<option value="Primary" ${cat==='Primary'?'selected':''}>Primary (P1 - P6)</option>
             <option value="Lower Secondary" ${cat==='Lower Secondary'?'selected':''}>Lower Secondary (S1 - S3)</option>
             <option value="Upper Secondary" ${cat==='Upper Secondary'?'selected':''}>Upper Secondary (S4 - S6)</option>`}
      </select>
    </div>
    <div class="form-group">
      <label><i data-lucide="tag" style="width:13px;height:13px;margin-right:4px"></i>Class Name <span class="required">*</span></label>
      <input id="ce-name" class="input-field" value="${Utils.escapeHtml(c.name)}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label><i data-lucide="graduation-cap" style="width:13px;height:13px;margin-right:4px"></i>Grade / Level <span class="required">*</span></label>
        <input id="ce-level" class="input-field" value="${Utils.escapeHtml(c.level||'')}">
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
  const education_level = document.getElementById('ce-category')?.value;
  const name             = document.getElementById('ce-name')?.value?.trim();
  const level            = document.getElementById('ce-level')?.value?.trim();
  const stream           = document.getElementById('ce-stream')?.value?.trim() || null;
  const academic_year_id = document.getElementById('ce-year')?.value || null;
  const status           = document.getElementById('ce-status')?.value || 'active';

  if (!name || !level) return Utils.toast('⚠️ Name and level are required', 'error');

  const check = EducationLevels.isValidCombination(education_level, level, stream);
  if (!check.valid) {
    return Utils.toast(`❌ Invalid Combination: ${check.message}`, 'error');
  }
  if (typeof Scope !== 'undefined' && Scope.isScoped() && !Scope.categories().includes(education_level)) {
    return Utils.toast(`❌ ${education_level} classes are outside your ${Scope.label()} scope`, 'error');
  }

  try {
    const existing = await DB.get('classes');
    if (existing.some(c => c.id !== id &&
        c.name.toLowerCase() === name.toLowerCase() &&
        (c.academic_year_id||null) === (academic_year_id||null))) {
      return Utils.toast(`❌ "${name}" already exists for this academic year`, 'error');
    }
    await DB.update('classes', id, { name, level, stream, education_level, academic_year_id, status });
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
