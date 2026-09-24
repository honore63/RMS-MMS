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

// ===== 5-Step Wizard for Teachers (Information → Class/Subject → Configuration → Review → Create) =====
let casWizardState = { step: 1, name: '', typeId: '', yearId: '', termId: '', classId: '', subjectId: '', unit: '', max: 30, date: '', weight: '', desc: '' };
let casWizardData = { classes: [], subjects: [], types: [], years: [], terms: [] };

const _origOpenCreateAssessment = openCreateAssessment;
async function openCreateAssessment() {
  // Intercept original single-modal and launch wizard instead (keeps old code as fallback)
  const ok = await loadTeacherContext();
  if (!ok) return Utils.toast('No teacher profile found', 'error');
  if (!teacherAssignments.length) return Utils.toast('You have no class/subject assignments. Contact the DOS.', 'error');
  const [classes, subjects, types, years, terms] = await Promise.all([DB.get('classes'), DB.get('subjects'), getAssessmentTypes(), DB.get('academic_years'), DB.get('terms')]);
  casWizardData = { classes, subjects, types: types.filter(t=>t.status==='active'), years, terms };
  const activeType = casWizardData.types[0];
  casWizardState = {
    step: 1,
    name: '',
    typeId: activeType ? activeType.id : '',
    yearId: activeYear ? activeYear.id : (years.find(y=>y.status==='active')?.id || years[0]?.id || ''),
    termId: activeTerm ? activeTerm.id : (terms.find(t=> String(t.academic_year_id)===String(activeYear?.id))?.id || ''),
    classId: '',
    subjectId: '',
    unit: '',
    max: activeType?.default_maximum_mark ?? 30,
    date: new Date().toISOString().split('T')[0],
    weight: '',
    desc: ''
  };
  casAutoName = '';
  casRenderWizard();
}
function casWizardProgress(){ const steps=['Information','Class & Subject','Configuration','Review','Create']; return '<div style="display:flex;gap:6px;margin-bottom:16px">'+steps.map((label,i)=>{const idx=i+1, active=casWizardState.step===idx, done=casWizardState.step>idx, bg=active?'var(--blue-600)':done?'var(--green-500)':'var(--gray-200)', color=active||done?'#fff':'var(--gray-600)'; return '<div style="flex:1;text-align:center;padding:8px 4px;border-radius:8px;background:'+bg+';color:'+color+';font-size:11px;font-weight:700">'+idx+'. '+label+'</div>';}).join('')+'</div>'; }
function casWizardValidateStep(step){
  if(step===1){
    if(!casWizardState.name.trim()) return 'Assessment name is required';
    if(!casWizardState.typeId) return 'Assessment type is required';
    if(!casWizardState.yearId) return 'Academic year is required';
    if(!casWizardState.termId) return 'Term is required';
  }
  if(step===2){
    if(!casWizardState.subjectId) return 'Select a subject';
    if(!casWizardState.classId) return 'Select a class';
    const allowed = teacherAssignments.some(a=> a.subject_id===casWizardState.subjectId && a.class_id===casWizardState.classId);
    if(!allowed) return 'You are not assigned to this class/subject combination';
  }
  if(step===3){
    if(!casWizardState.max || isNaN(Number(casWizardState.max)) || Number(casWizardState.max) <=0) return 'Maximum marks must be a number greater than 0';
    if(Number(casWizardState.max) > 1000) return 'Maximum marks seems too large';
    if(!casWizardState.date) return 'Assessment date is required';
  }
  return null;
}
async function casWizardNext(){
  const err = casWizardValidateStep(casWizardState.step);
  if(err) return Utils.toast(err,'error');
  if(casWizardState.step===3){
    const dup = await casCheckDuplicateWizard();
    casWizardState._dup = dup;
  }
  if(casWizardState.step < 5){ casWizardState.step++; casRenderWizard(); } else { await casWizardCreate(); }
}
function casWizardBack(){ if(casWizardState.step>1){ casWizardState.step--; casRenderWizard(); } }
async function casCheckDuplicateWizard(){
  try{
    const q = { teacher_id: Auth.getTeacherId(), class_id: casWizardState.classId, subject_id: casWizardState.subjectId, assessment_type_id: casWizardState.typeId || undefined, term_id: casWizardState.termId || undefined, academic_year_id: casWizardState.yearId || undefined };
    Object.keys(q).forEach(k=> q[k]===undefined && delete q[k]);
    const existing = await DB.query('assessments','*', q);
    const nameDup = existing.find(a=> a.name.trim().toLowerCase()===casWizardState.name.trim().toLowerCase() && String(a.unit||'').trim().toLowerCase()===String(casWizardState.unit||'').trim().toLowerCase());
    return nameDup || (existing.length ? existing[0] : null);
  }catch(e){ return null; }
}
function casSuggestNameWizard(){
  const s = casWizardState, d = casWizardData;
  const typ = d.types.find(t=> String(t.id)===String(s.typeId));
  const typeName = typ ? typ.name : 'Assessment';
  const auto = s.unit ? typeName + ' - ' + s.unit : '';
  if(!s.name || s.name===casAutoName){
    s.name = auto;
    const el = document.getElementById('cas-w-name');
    if(el) el.value = auto;
    casAutoName = auto;
  }
}
function casRenderWizard(){
  const s = casWizardState, d = casWizardData;
  const assignedSubjectIds = [...new Set(teacherAssignments.map(a=>a.subject_id))];
  const subjectOptions = d.subjects.filter(x=> assignedSubjectIds.includes(x.id));
  const classOptionsForSubject = s.subjectId ? d.classes.filter(c=> teacherAssignments.some(a=> a.subject_id===s.subjectId && a.class_id===c.id)) : [];
  const yearOptions = d.years;
  const termOptions = d.terms.filter(t=> !s.yearId || String(t.academic_year_id)===String(s.yearId));
  let body = casWizardProgress();
  if(s.step===1){
    body += '<div class="form-group"><label>Assessment Name *</label><input id="cas-w-name" class="input-field" placeholder="e.g., CAT 1 – Fractions" value="'+Utils.escapeHtml(s.name)+'" oninput="casWizardState.name=this.value; casSuggestNameWizard()"></div>'
      + '<div class="form-group"><label>Assessment Type *</label><select id="cas-w-type" class="select-field" onchange="casWizardState.typeId=this.value; const opt=this.selectedOptions[0]; if(opt && opt.dataset.defaultMax) casWizardState.max=opt.dataset.defaultMax; const me=document.getElementById(\'cas-w-max\'); if(me) me.value=casWizardState.max; casSuggestNameWizard()">'+d.types.map(t=> '<option value="'+t.id+'" data-default-max="'+(t.default_maximum_mark??'')+'" '+(String(t.id)===String(s.typeId)?'selected':'')+'>'+Utils.escapeHtml(t.name)+(t.weight!=null?' (w='+t.weight+')':'')+'</option>').join('')+'</select><p class="form-hint">Comes from configured assessment types</p></div>'
      + '<div class="form-row"><div class="form-group"><label>Academic Year *</label><select id="cas-w-year" class="select-field" onchange="casWizardState.yearId=this.value; casRenderWizard()">'+yearOptions.map(y=> '<option value="'+y.id+'" '+(String(y.id)===String(s.yearId)?'selected':'')+'>'+Utils.escapeHtml(y.name)+(y.status==='active'?' (Active)':'')+'</option>').join('')+'</select></div><div class="form-group"><label>Term *</label><select id="cas-w-term" class="select-field" onchange="casWizardState.termId=this.value">'+termOptions.map(t=> '<option value="'+t.id+'" '+(String(t.id)===String(s.termId)?'selected':'')+'>'+Utils.escapeHtml(t.name)+'</option>').join('')+'</select></div></div><p class="form-hint">Term list is dynamic – only terms configured for the selected year appear.</p>';
  } else if(s.step===2){
    body += '<div class="form-group"><label>Subject *</label><select id="cas-w-subject" class="select-field" onchange="casWizardState.subjectId=this.value; casWizardState.classId=\'\'; casRenderWizard(); casSuggestNameWizard()"><option value="">Select subject</option>'+subjectOptions.map(x=> '<option value="'+x.id+'" '+(String(x.id)===String(s.subjectId)?'selected':'')+'>'+Utils.escapeHtml(x.name)+'</option>').join('')+'</select><p class="form-hint">Only subjects assigned to you are shown.</p></div>'
      + '<div class="form-group"><label>Class *</label><select id="cas-w-class" class="select-field" onchange="casWizardState.classId=this.value; casSuggestNameWizard()"><option value="">Select class</option>'+classOptionsForSubject.map(c=> '<option value="'+c.id+'" '+(String(c.id)===String(s.classId)?'selected':'')+'>'+Utils.escapeHtml(c.name)+' ('+Utils.escapeHtml(EducationLevels.getCategory(c))+')</option>').join('')+'</select><p class="form-hint">Only classes assigned to you for the selected subject.</p></div>';
  } else if(s.step===3){
    body += '<div class="form-group"><label>Unit <span class="text-muted">(optional)</span></label><input id="cas-w-unit" class="input-field" placeholder="e.g., Unit 4 – Fractions" value="'+Utils.escapeHtml(s.unit)+'" oninput="casWizardState.unit=this.value; casSuggestNameWizard()"></div>'
      + '<div class="form-row"><div class="form-group"><label>Maximum Marks *</label><input id="cas-w-max" type="number" min="1" max="1000" class="input-field" value="'+Utils.escapeHtml(String(s.max))+'" oninput="casWizardState.max=this.value"></div><div class="form-group"><label>Assessment Date *</label><input id="cas-w-date" type="date" class="input-field" value="'+Utils.escapeHtml(s.date)+'" onchange="casWizardState.date=this.value"></div></div>'
      + '<div class="form-row"><div class="form-group"><label>Weight <span class="text-muted">(optional)</span></label><input id="cas-w-weight" type="number" step="any" min="0" class="input-field" placeholder="blank = type default" value="'+Utils.escapeHtml(s.weight)+'" oninput="casWizardState.weight=this.value"></div><div class="form-group"><label>Description</label><input id="cas-w-desc" class="input-field" placeholder="Optional notes" value="'+Utils.escapeHtml(s.desc)+'" oninput="casWizardState.desc=this.value"></div></div>';
  } else if(s.step===4){
    const dup = s._dup;
    const cls = d.classes.find(c=> String(c.id)===String(s.classId));
    const sub = d.subjects.find(x=> String(x.id)===String(s.subjectId));
    const yr = d.years.find(y=> String(y.id)===String(s.yearId));
    const tm = d.terms.find(t=> String(t.id)===String(s.termId));
    const typ = d.types.find(t=> String(t.id)===String(s.typeId));
    body += '<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:16px;margin-bottom:12px"><h4 style="font-weight:800;margin-bottom:8px">Review</h4>'
      + '<div class="flex justify-between mb-2"><span class="text-sm text-muted">Assessment</span><span class="text-sm font-semibold">'+Utils.escapeHtml(s.name)+(s.unit?' - '+Utils.escapeHtml(s.unit):'')+'</span></div>'
      + '<div class="flex justify-between mb-2"><span class="text-sm text-muted">Type</span><span class="text-sm font-semibold">'+Utils.escapeHtml(typ?.name||'')+'</span></div>'
      + '<div class="flex justify-between mb-2"><span class="text-sm text-muted">Class / Subject</span><span class="text-sm font-semibold">'+Utils.escapeHtml(cls?.name||'')+' / '+Utils.escapeHtml(sub?.name||'')+'</span></div>'
      + '<div class="flex justify-between mb-2"><span class="text-sm text-muted">Year / Term</span><span class="text-sm font-semibold">'+Utils.escapeHtml(yr?.name||'')+' / '+Utils.escapeHtml(tm?.name||'')+'</span></div>'
      + '<div class="flex justify-between mb-2"><span class="text-sm text-muted">Max / Date</span><span class="text-sm font-semibold">'+Utils.escapeHtml(String(s.max))+' / '+Utils.escapeHtml(s.date)+'</span></div>'
      + (s.weight ? '<div class="flex justify-between mb-2"><span class="text-sm text-muted">Weight</span><span class="text-sm font-semibold">'+Utils.escapeHtml(s.weight)+'</span></div>' : '')
      + (s.desc ? '<div class="flex justify-between"><span class="text-sm text-muted">Description</span><span class="text-sm font-semibold">'+Utils.escapeHtml(s.desc)+'</span></div>' : '')
      + '</div>'
      + (dup ? '<div class="alert alert-warning"><i data-lucide="alert-triangle"></i><div><strong>Possible duplicate</strong><br>An assessment with same class/subject/type/term/year already exists: <strong>'+Utils.escapeHtml(dup.name)+'</strong> ('+dup.status+')<br><button class="btn btn-sm btn-outline" style="margin-top:8px" onclick="Modal.close(); Router.go(\'teacher/enter-marks?assessment='+dup.id+'\')">View existing</button></div></div>' : '<div class="alert alert-success"><i data-lucide="check-circle-2"></i> No duplicate found – ready to create.</div>')
      + '<p class="text-xs text-muted" style="margin-top:8px">Learner roster will be auto-built from the class ('+(cls?.name||'')+') – you won’t need to recreate it.</p>';
  } else if(s.step===5){
    body += '<div style="text-align:center;padding:20px"><i data-lucide="check-circle-2" style="width:48px;height:48px;color:var(--green-500);margin-bottom:12px"></i><h3>Ready to create</h3><p class="text-sm text-muted">Click Create to save. You’ll be taken to Enter Marks with the class roster pre-loaded.</p></div>';
  }
  const footer = '<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>'
    + (s.step>1 ? '<button class="btn btn-secondary" onclick="casWizardBack()"><i data-lucide="arrow-left"></i> Back</button>' : '')
    + (s.step<5 ? '<button class="btn btn-primary" onclick="casWizardNext()">Next <i data-lucide="arrow-right"></i></button>' : '<button class="btn btn-primary" onclick="casWizardCreate(this)"><i data-lucide="plus-circle"></i> Create Assessment</button>');
  Modal.show(s.step===5 ? 'Create Assessment – Confirm' : 'Create Assessment – Step '+s.step+' of 5', body, footer, true);
  if(typeof lucide!=='undefined') lucide.createIcons();
}
async function casWizardCreate(btn){
  if(btn){ btn.disabled=true; const orig=btn.innerHTML; btn.innerHTML='Creating...'; btn.dataset.orig=orig; }
  const s = casWizardState;
  const err = casWizardValidateStep(3) || casWizardValidateStep(2) || casWizardValidateStep(1);
  if(err){ if(btn){btn.disabled=false; btn.innerHTML=btn.dataset.orig; } return Utils.toast(err,'error'); }
  const dup = await casCheckDuplicateWizard();
  if(dup){ if(btn){btn.disabled=false; btn.innerHTML=btn.dataset.orig; } Utils.toast('Duplicate assessment exists – view existing instead','error'); return; }
  const teacherId = Auth.getTeacherId();
  const payload = { name: s.name.trim(), assessment_type_id: s.typeId || null, unit: s.unit || null, class_id: s.classId, subject_id: s.subjectId, teacher_id: teacherId, academic_year_id: s.yearId || null, term_id: s.termId || null, maximum_mark: parseInt(s.max) || 30, weight: s.weight==='' ? null : parseFloat(s.weight), assessment_date: s.date, description: s.desc || null, status: 'draft' };
  try{
    const { data: inserted, error } = await sbClient.from('assessments').insert(payload).select().single();
    if(error) throw error;
    // === SYNC EVERYWHERE: new assessment → dashboards/reports/analytics ===
    DB.invalidate('assessments');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
    let learnerCount = 0;
    try{ const { count } = await sbClient.from('learners').select('*',{count:'exact',head:true}).eq('class_id', s.classId).eq('status','active'); learnerCount = count||0; }catch(e){}
    const clsName = (casWizardData.classes.find(c=> String(c.id)===String(s.classId))||{}).name || '';
    const subName = (casWizardData.subjects.find(x=> String(x.id)===String(s.subjectId))||{}).name || '';
    const termName = (casWizardData.terms.find(t=> String(t.id)===String(s.termId))||{}).name || '';
    Utils.toast('Assessment created','success');
    Modal.close();
    Modal.show('Assessment Created Successfully', '<div style="background:var(--green-50);border:1px solid var(--green-200);border-radius:var(--radius);padding:16px;margin-bottom:16px;text-align:center"><i data-lucide="check-circle-2" style="width:36px;height:36px;color:var(--green-600);margin-bottom:8px"></i><h3 style="color:var(--green-800)">'+Utils.escapeHtml(subName)+' — '+Utils.escapeHtml(s.name)+'</h3><p class="text-sm text-muted">Class: '+Utils.escapeHtml(clsName)+' | Term: '+Utils.escapeHtml(termName)+' | Max: '+Utils.escapeHtml(String(s.max))+'</p><p class="text-sm" style="margin-top:8px"><strong>Learners: '+learnerCount+'</strong> — roster auto-built from class</p></div><p class="text-sm text-muted">You can now enter marks. The learner list is ready – no manual recreation needed.</p>', '<button class="btn btn-secondary" onclick="Modal.close(); renderEnterMarks()">Stay</button><button class="btn btn-primary" onclick="Modal.close(); Router.go(\'teacher/enter-marks?assessment='+inserted.id+'\')"><i data-lucide="pencil-line"></i> Enter Marks</button>', true);
  }catch(e){
    if(btn){ btn.disabled=false; btn.innerHTML=btn.dataset.orig; }
    Utils.toast('Error: '+e.message,'error');
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
  if (!teacherId) {
    if (btn) { btn.disabled = false; btn.innerHTML = btn.dataset.original; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    return Utils.toast('Your account is not linked to a teacher profile. Contact the DOS.', 'error');
  }
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
    DB.invalidate('assessments');
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
    Utils.toast('Assessment created — synced', 'success');
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
  const totalMax = Number(markAssessment.maximum_mark) || 0;

  const teacherId = Auth.getTeacherId();
  const allowed = teacherAssignments.length === 0 || teacherAssignments.some(a => a.class_id === markAssessment.class_id && a.subject_id === markAssessment.subject_id);
  const isOwnAssessment = markAssessment.teacher_id === teacherId;
  if (!allowed && !isOwnAssessment && !Auth.isAdmin()) {
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
        <button class="btn btn-outline" onclick="downloadMarksTemplateForCurrentAssessment()" title="Download marks template"><i data-lucide="download"></i> Download</button>
        ${!isLocked && !isSubmitted ? `<button class="btn btn-primary" onclick="MarksImport.open({ assessmentId: '${markAssessment.id}' })"><i data-lucide="file-up"></i> Import</button>` : ''}
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

