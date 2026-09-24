/* Report Wizard – reusable multi-step engine.
   State: reportConfig { reportType, educationLevel, academicYearId, classIds, studentIds, subjectIds, assessmentIds, termIds, options }
   Dependent loading: each step loads only relevant data via narrow selects and Scope filtering.
   RLS remains the authoritative guard; wizard also validates Scope client-side.
*/
const ReportWizard = {
  DEFS: {
    'student-card': {
      id: 'student-card', label: 'Student Report Card', icon: 'file-badge',
      desc: 'Per-learner card · new A4 page per student when batch',
      steps: ['period','class','students','subjects','assessments','terms','preview']
    },
    'class-performance': {
      id: 'class-performance', label: 'Class Report', icon: 'school',
      desc: 'Class-level averages and pass rates',
      steps: ['period','class','students','subjects','assessments','terms','preview']
    },
    'student-performance': {
      id: 'student-performance', label: 'Student Performance', icon: 'user-round-check',
      desc: 'Detailed learner performance and ranking report',
      steps: ['period','class','students','subjects','assessments','terms','preview']
    },
    'subject-performance': {
      id: 'subject-performance', label: 'Subject Report', icon: 'book-open',
      desc: 'Subject performance across learners',
      steps: ['period','class','subjects','assessments','terms','students','preview']
    },
    'exam-class-summary': {
      id: 'exam-class-summary', label: 'Assessment Report', icon: 'clipboard-check',
      desc: 'Per-assessment class summary',
      steps: ['period','class','subjects','assessments','students','terms','preview']
    },
    'missing-marks': {
      id: 'missing-marks', label: 'Marks Report', icon: 'list-checks',
      desc: 'Missing / completion tracking',
      steps: ['period','classes','subjects','assessments','terms','preview']
    },
    'teacher-performance': {
      id: 'teacher-performance', label: 'Teacher Report', icon: 'users',
      desc: 'Teacher workload and learner outcomes',
      steps: ['period','teachers','classes','subjects','assessments','terms','preview']
    },
    'school-performance': {
      id: 'school-performance', label: 'School / Performance Report', icon: 'building-2',
      desc: 'School-wide analytics',
      steps: ['period','classes','subjects','assessments','terms','metrics','preview']
    },
    'grade-distribution': {
      id: 'grade-distribution', label: 'Grade Distribution', icon: 'bar-chart-3',
      desc: 'Grade buckets across selected scope',
      steps: ['period','classes','subjects','assessments','terms','preview']
    }
  },

  STEP_META: {
    period: { label:'Period', sub:'Year', icon:'calendar', required:true },
    class: { label:'Class', sub:'1 class', icon:'school', required:true },
    classes: { label:'Classes', sub:'Multi', icon:'school', required:true },
    students: { label:'Students', sub:'Batch', icon:'users', required:false },
    subjects: { label:'Subjects', sub:'Multi', icon:'book-open', required:false },
    assessments: { label:'Assessments', sub:'Multi', icon:'clipboard-list', required:false },
    terms: { label:'Terms', sub:'Dynamic', icon:'calendar-range', required:true },
    teachers: { label:'Teachers', sub:'Multi', icon:'user-check', required:false },
    metrics: { label:'Metrics', sub:'KPIs', icon:'trending-up', required:false },
    options: { label:'Options', sub:'Display', icon:'settings-2', required:false },
    summary: { label:'Summary', sub:'Review', icon:'eye', required:false },
    preview: { label:'Preview', sub:'Generate', icon:'printer', required:false }
  },

  state: {
    reportType: 'student-card',
    stepIndex: 0,
    academicYearId: '',
    classIds: [],
    studentIds: [],
    subjectIds: [],
    assessmentIds: [],
    termIds: [],
    teacherIds: [],
    metrics: [],
    options: { showHeader:true, showGrades:true, showPct:true, showComments:true, autoComments:true, showPosition:false, showAttendance:false, showCharts:false, orientation:'auto', teacherComment:'', dosComment:'', decisionOverride:'', cardMode:'individual', annualMode:true },
    cache: { years:[], terms:[], classes:[], subjects:[], students:[], assessments:[], teachers:[] },
    loading: false, previewHtml:'', previewOrientation:'portrait', previewFilename:''
  },

  _scopedClasses(classes){
    if (typeof Scope!=='undefined' && Scope.isScoped()) return Scope.filterClasses(classes||[]);
    return classes||[];
  },
  _scopedSubjects(subjects, clsForFilter){
    let list = subjects||[];
    if (typeof Scope!=='undefined' && Scope.isScoped()) list = Scope.filterSubjects(list);
    if (clsForFilter) list = list.filter(s=> subjectMatchesReportScope(s, clsForFilter));
    return list;
  },

  stepsFor(type){
    const d = this.DEFS[type]||this.DEFS['student-card'];
    return d.steps;
  },

  currentSteps(){
    return this.stepsFor(this.state.reportType);
  },

  currentStepId(){
    const s = this.currentSteps();
    return s[this.state.stepIndex]||s[0];
  },

  async open(reportType){
    const valid = Object.keys(this.DEFS);
    this.state.reportType = valid.includes(reportType)? reportType : 'student-card';
    this.state.stepIndex = 0;
    this.state.academicYearId = this.state.academicYearId || (typeof getActiveYearId==='function' ? getActiveYearId(null) : '');
    // preserve selections but ensure arrays
    ['classIds','studentIds','subjectIds','assessmentIds','termIds','teacherIds'].forEach(k=>{ if(!Array.isArray(this.state[k])) this.state[k]=this.state[k]?[this.state[k]]:[]; });
    await this.render();
  },

  async render(){
    const type = this.state.reportType;
    const def = this.DEFS[type];
    setHeader(def.label, def.desc);
    setContent(`<div class="rw-shell"><div id="rw-root">${Utils.loading()}</div><div id="rw-preview"></div></div>`);
    await this.ensureBaseData();
    this.renderShell();
    if (typeof lucide!=='undefined') lucide.createIcons();
  },

  async ensureBaseData(){
    const s = this.state;
    if (!s.cache.years.length){
      try { s.cache.years = await DB.get('academic_years')||[]; } catch(e){ s.cache.years=[]; }
      if (!s.academicYearId){
        const active = s.cache.years.find(y=> y.status==='active' || y.is_current) || s.cache.years[0];
        if (active) s.academicYearId = active.id;
      }
    }
    if (!s.cache.terms.length || s._lastYearId!==s.academicYearId){
      try {
        const all = await DB.get('terms')||[];
        s.cache.allTerms = all;
        s.cache.terms = s.academicYearId ? all.filter(t=> !t.academic_year_id || String(t.academic_year_id)===String(s.academicYearId)) : all;
        s.cache.terms.sort((a,b)=>(a.term_no||0)-(b.term_no||0));
        s._lastYearId = s.academicYearId;
        // default termIds if empty and single term available
        if (!s.termIds.length && s.cache.terms.length===1) s.termIds=[s.cache.terms[0].id];
      } catch(e){ s.cache.terms=[]; }
    }
    // classes – scoped, narrow; teacher: only assigned classes
    if (!s.cache._classesLoaded){
      try {
        const all = await DB.get('classes')||[];
        s.cache.allClasses = all;
        let scoped = this._scopedClasses(all);
        if (typeof Auth!=='undefined' && Auth.isTeacher && Auth.isTeacher()){
          try{
            const teacherId = Auth.getTeacherId();
            const assigns = await DB.query('teacher_assignments','*',{teacher_id: teacherId});
            const allowed = new Set((assigns||[]).map(a=> String(a.class_id)));
            scoped = scoped.filter(c=> allowed.has(String(c.id)));
          }catch(e){ scoped=[]; }
        }
        s.cache.classes = scoped;
        s.cache._classesLoaded=true;
        if (!s.classIds.length && scoped.length === 1) s.classIds = [scoped[0].id];
      } catch(e){ s.cache.classes=[]; }
    }
  },

  renderShell(){
    const s = this.state;
    const def = this.DEFS[s.reportType];
    const scopeLabel = (typeof Scope!=='undefined' ? Scope.label() : 'Global');
    const scopeSub = (typeof Scope!=='undefined' && Scope.subLabel ? Scope.subLabel() : '');
    // All reports: single page with all steps (Classes -> Individual/Whole for student-card)
    const shell = `
      <div class="rw-head">
        <div class="rw-head-icon"><i data-lucide="${def.icon}" style="width:28px;height:28px"></i></div>
        <div><div class="rw-head-title">${Utils.escapeHtml(def.label)}</div><div class="rw-head-sub">${Utils.escapeHtml(def.desc)} · Scope: ${Utils.escapeHtml(scopeLabel)} — all steps on one page</div></div>
        <span class="rw-scope-badge"><i data-lucide="shield-check" style="width:12px;height:12px"></i> ${Utils.escapeHtml(scopeLabel)}${scopeSub? ' · '+Utils.escapeHtml(scopeSub): ''}</span>
      </div>
      <div id="rw-single-page" class="rw-card"><div class="card-body" id="rw-single-body">${Utils.loading()}</div></div>
      <div id="rw-nav"></div>
    `;
    const root = document.getElementById('rw-root');
    if (root) root.innerHTML = shell;
    this.renderSinglePage();
    if (typeof lucide!=='undefined') lucide.createIcons();
  },

  async renderSinglePage(){
    const body = document.getElementById('rw-single-body');
    const nav = document.getElementById('rw-nav');
    if (!body) return;
    body.innerHTML = Utils.loading();
    try {
      const steps = this.currentSteps();
      let htmlParts = [];
      for (const sid of steps) {
        if (sid === 'period') htmlParts.push(`<div class="rw-card">${await this.renderPeriod()}</div>`);
        else if (sid === 'class') htmlParts.push(`<div class="rw-card">${await this.renderClasses(false)}</div>`);
        else if (sid === 'classes') htmlParts.push(`<div class="rw-card">${await this.renderClasses(true)}</div>`);
        else if (sid === 'students') {
          if (['student-card', 'student-performance'].includes(this.state.reportType) && this.state.options.cardMode === 'whole') {
            const cnt = (this.state.cache.students && this.state.cache.students.length) ? this.state.cache.students.length : (this.state.classIds.length ? '—' : '0');
            htmlParts.push(`<div class="rw-card"><div class="rw-card-hd"><h3><i data-lucide="users"></i> Students</h3></div><div class="rw-card-bd"><div class="rw-empty">Whole-class mode: all active learners in the selected class(es) will be included (${cnt} loaded). No individual selection needed.</div></div></div>`);
            if (this.state.classIds.length && !this.state.cache.students.length) {
              try { const l = await DB.query('learners','id,full_name,learner_code,class_id,gender',{ class_id: this.state.classIds, status:'active' },{ column:'full_name', asc:true }); this.state.cache.students = l||[]; } catch(e){}
            }
          } else {
            htmlParts.push(`<div class="rw-card">${await this.renderStudents()}</div>`);
          }
        }
        else if (sid === 'subjects') htmlParts.push(`<div class="rw-card">${await this.renderSubjects()}</div>`);
        else if (sid === 'assessments') htmlParts.push(`<div class="rw-card">${await this.renderAssessments()}</div>`);
        else if (sid === 'terms') htmlParts.push(`<div class="rw-card">${await this.renderTerms()}</div>`);
        else if (sid === 'teachers') htmlParts.push(`<div class="rw-card">${await this.renderTeachers()}</div>`);
        else if (sid === 'metrics') htmlParts.push(`<div class="rw-card">${this.renderMetrics()}</div>`);
        else if (sid === 'summary') htmlParts.push(`<div class="rw-card">${await this.renderSummary()}</div>`);
        else if (sid === 'preview') htmlParts.push(`<div class="rw-card">${await this.renderPreviewStep()}</div>`);
      }
      // Student Report: inject Report Mode (Individual / Whole Class) after Classes
      if (['student-card', 'student-performance'].includes(this.state.reportType)) {
        const mode = this.state.options.cardMode || 'individual';
        const modeHtml = `<div class="rw-card"><div class="rw-card-hd"><h3><i data-lucide="users"></i> Report Mode</h3></div><div class="rw-card-bd"><p class="rw-help" style="margin-bottom:10px">Choose whether to generate for a single learner or the whole class.</p><label class="rw-opt" style="border:1px solid ${mode==='individual'?'var(--blue-300)':'var(--gray-200)'};background:${mode==='individual'?'var(--blue-50)':'#fff'}"><input type="radio" name="rw-mode" value="individual" ${mode==='individual'?'checked':''} onchange="ReportWizard.setCardMode('individual')"><span><span class="rw-opt-title">Individual Student</span><span class="rw-opt-sub">Pick one or more students — each gets a separate A4 page</span></span></label><label class="rw-opt" style="margin-top:8px;border:1px solid ${mode==='whole'?'var(--blue-300)':'var(--gray-200)'};background:${mode==='whole'?'var(--blue-50)':'#fff'}"><input type="radio" name="rw-mode" value="whole" ${mode==='whole'?'checked':''} onchange="ReportWizard.setCardMode('whole')"><span><span class="rw-opt-title">Whole Class</span><span class="rw-opt-sub">All active learners in the selected class(es) — batch</span></span></label></div></div>`;
        const idx = htmlParts.findIndex((_, i) => { const s = steps[i]; return s==='class' || s==='classes'; });
        if (idx >= 0) htmlParts.splice(idx+1, 0, modeHtml);
        else htmlParts.unshift(modeHtml);
      }
      body.innerHTML = `<div style="display:grid;gap:14px">${htmlParts.join('')}<div id="rw-preview-area" style="margin-top:4px"></div></div>`;
      if (nav) {
        nav.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-top:14px;flex-wrap:wrap">
            <span class="rw-badge">${this.state.classIds.length} class${this.state.classIds.length===1?'':'es'} · ${this.state.studentIds.length} students · ${this.state.subjectIds.length} subjects · ${this.state.assessmentIds.length} assessments · ${this.state.termIds.length} terms</span>
            <div class="rw-actions" style="flex-wrap:wrap">
              <button class="btn btn-secondary" onclick="ReportWizard.preview()"><i data-lucide="eye"></i> Preview</button>
              <button class="btn btn-primary" onclick="ReportWizard.preview()"><i data-lucide="printer"></i> Generate Report</button>
              <button class="btn btn-outline" onclick="ReportWizard.print()"><i data-lucide="printer"></i> Print</button>
              <button class="btn btn-outline" onclick="ReportWizard.downloadPDF()"><i data-lucide="file-down"></i> PDF</button>
              <button class="btn btn-outline" onclick="ReportWizard.exportExcel()"><i data-lucide="file-spreadsheet"></i> Excel</button>
            </div>
          </div>`;
      }
      if (typeof lucide!=='undefined') lucide.createIcons();
    } catch(e){
      body.innerHTML = Utils.errorCard('Failed to load form', e.message||'Unable to load');
    }
  },

  setCardMode(mode){
    this.state.options.cardMode = mode==='whole' ? 'whole' : 'individual';
    if (mode==='whole') { this.state.studentIds = []; }
    this.renderSinglePage();
  },

  go(idx){
    const steps = this.currentSteps();
    if (idx<0 || idx>=steps.length) return;
    // allow going back freely; forward only if current step valid or going back
    if (idx > this.state.stepIndex){
      const err = this.validateStep(this.currentStepId());
      if (err){ this.showStepError(err); return; }
    }
    this.state.stepIndex = idx;
    this.renderShell();
  },

  next(){
    const err = this.validateStep(this.currentStepId());
    if (err){ this.showStepError(err); return; }
    if (this.state.stepIndex < this.currentSteps().length-1){
      this.state.stepIndex++;
      this.renderShell();
    } else {
      this.generate();
    }
  },

  back(){
    if (this.state.stepIndex>0){ this.state.stepIndex--; this.renderShell(); }
  },

  showStepError(msg){
    const body = document.getElementById('rw-step-body');
    if (!body) return;
    let err = document.getElementById('rw-step-err');
    if (!err){
      err = document.createElement('div');
      err.id='rw-step-err';
      err.className='rw-toast-err';
      body.prepend(err);
    }
    err.innerHTML = `<i data-lucide="alert-triangle" style="width:16px;height:16px;color:#dc2626"></i><span>${Utils.escapeHtml(msg)}</span>`;
    if (typeof lucide!=='undefined') lucide.createIcons();
    Utils.toast(msg,'error');
  },

  validateStep(stepId){
    const s=this.state;
    if (stepId==='period'){
      if (!s.academicYearId) return 'Select an academic year.';
    }
    if (stepId==='class' || stepId==='classes'){
      const need = this.STEP_META[stepId].required;
      if (need && !s.classIds.length) return 'Select at least one class.';
      if (s.classIds.length){
        const all = s.cache.classes||[];
        for (const cid of s.classIds){
          const cls = all.find(c=> String(c.id)===String(cid));
          if (typeof Scope!=='undefined' && Scope.isScoped() && cls && !Scope.matchesClass(cls)) return `Class ${cls.name} is outside your ${Scope.label()} scope.`;
        }
      }
    }
    if (stepId==='students'){
      // optional generally, but for individual card mode require at least one
      const isIndividual = s.options.cardMode==='individual' && ['student-card', 'student-performance'].includes(s.reportType);
      if (isIndividual && !s.studentIds.length) return 'Select at least one student.';
    }
    if (stepId==='teachers'){
      if (this.DEFS[s.reportType].steps.includes('teachers') && !s.teacherIds.length) {
        // allow empty for school scope? but for teacher report require
        if (s.reportType==='teacher-performance' && !s.teacherIds.length) return 'Select at least one teacher.';
      }
    }
    if (stepId==='terms'){
      if (!s.termIds.length) return 'Select at least one term.';
    }
    // subjects/assessments generally optional – allow empty means all within scope
    return null;
  },

  validateAll(){
    const s=this.state;
    if (!s.academicYearId) throw new Error('Select an academic year.');
    if (!s.termIds.length) throw new Error('Select at least one term.');
    // Student Report Card: enforce individual vs whole class
    if (['student-card', 'student-performance'].includes(s.reportType)){
      if (!s.classIds.length) throw new Error('Select at least one class.');
      const mode = s.options.cardMode || 'individual';
      if (mode==='individual' && !s.studentIds.length) throw new Error('Select at least one student for Individual mode, or switch to Whole Class.');
    }
    // class required for most reports
    const needClass = !['school-performance','teacher-performance'].includes(s.reportType) || (s.reportType==='school-performance' && !s.classIds.length);
    // For school-performance, classes can be empty meaning all scoped
    // For class/assessment/subject reports need class
    const typeNeedsClass = ['class-performance','subject-performance','exam-class-summary','missing-marks'].includes(s.reportType);
    if (typeNeedsClass && !s.classIds.length) throw new Error('Select at least one class.');
    if (s.reportType==='teacher-performance' && !s.teacherIds.length){
      // allow fallback to current teacher if signed as teacher, but for DOS require selection
      if (!(typeof Auth!=='undefined' && Auth.isTeacher && Auth.isTeacher())) throw new Error('Select at least one teacher.');
    }
    // scope check classes
    const all = s.cache.classes||[];
    for (const cid of s.classIds){
      const cls = all.find(c=> String(c.id)===String(cid));
      if (cls && typeof Scope!=='undefined' && Scope.isScoped() && !Scope.matchesClass(cls)) throw new Error(`Class ${cls.name} is outside your ${Scope.label()} scope.`);
    }
    // For subject-performance require at least one subject? keep optional but warn
    if (s.reportType==='subject-performance' && !s.subjectIds.length){
      // allow but will default to all – no error
    }
  },

  renderNav(){
    const nav = document.getElementById('rw-nav');
    if (!nav) return;
    const steps = this.currentSteps();
    const atFirst = this.state.stepIndex===0;
    const atLast = this.state.stepIndex===steps.length-1;
    const curId = this.currentStepId();
    const isPreview = curId==='preview';
    nav.innerHTML = `
      <button class="btn btn-outline" onclick="ReportWizard.back()" ${atFirst?'disabled':''}><i data-lucide="arrow-left"></i> Back</button>
      <div class="rw-actions">
        <span class="rw-badge">${this.state.classIds.length} class${this.state.classIds.length===1?'':'es'} · ${this.state.studentIds.length} students · ${this.state.subjectIds.length} subjects · ${this.state.assessmentIds.length} assessments · ${this.state.termIds.length} terms</span>
        ${isPreview? `
          <button class="btn btn-secondary" onclick="ReportWizard.preview()"><i data-lucide="eye"></i> Refresh Preview</button>
          <button class="btn btn-outline" onclick="ReportWizard.print()"><i data-lucide="printer"></i> Print</button>
          <button class="btn btn-primary" onclick="ReportWizard.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
          <button class="btn btn-outline" onclick="ReportWizard.exportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
        `: `<button class="btn btn-primary" onclick="ReportWizard.next()">${atLast?'<i data-lucide=\'eye\'></i> Preview':'Next <i data-lucide=\'arrow-right\'></i>'}</button>`}
      </div>`;
    if (typeof lucide!=='undefined') lucide.createIcons();
  },

  setYear(id){
    this.state.academicYearId=id;
    this.state.termIds=[];
    // reload terms for that year
    const all = this.state.cache.allTerms||[];
    this.state.cache.terms = id ? all.filter(t=> !t.academic_year_id || String(t.academic_year_id)===String(id)) : all;
    this.state.cache.terms.sort((a,b)=>(a.term_no||0)-(b.term_no||0));
    if (this.state.cache.terms.length===1) this.state.termIds=[this.state.cache.terms[0].id];
    this.renderStep();
    this.renderNav();
  },

  toggleArray(key, id){
    const arr = this.state[key]||[];
    const sid=String(id);
    const idx=arr.findIndex(x=> String(x)===sid);
    if (idx>-1) arr.splice(idx,1);
    else arr.push(id);
    this.state[key]=arr;
    // dependent invalidations
    if (key==='classIds'){
      this.state.studentIds=[]; // reset students when class changes
      this.state.cache.students=[];
      // subjects cache invalid
      this.state.cache._subjectsForClasses=null;
      // keep subjectIds but will re-validate
    }
    if (key==='subjectIds' || key==='classIds'){
      // assessments depend on class+subjects
      this.state.cache.assessments=[];
    }
    this.renderStep();
    this.renderNav();
  },

  async renderStep(){
    const sid = this.currentStepId();
    const body = document.getElementById('rw-step-body');
    if (!body) return;
    body.innerHTML = Utils.loading();
    try {
      let html='';
      if (sid==='period') html = await this.renderPeriod();
      else if (sid==='class') html = await this.renderClasses(false);
      else if (sid==='classes') html = await this.renderClasses(true);
      else if (sid==='students') html = await this.renderStudents();
      else if (sid==='subjects') html = await this.renderSubjects();
      else if (sid==='assessments') html = await this.renderAssessments();
      else if (sid==='terms') html = await this.renderTerms();
      else if (sid==='teachers') html = await this.renderTeachers();
      else if (sid==='metrics') html = this.renderMetrics();
      else if (sid==='summary') html = await this.renderSummary();
      else if (sid==='preview') html = await this.renderPreviewStep();
      else html = `<div class="rw-empty">Unknown step ${Utils.escapeHtml(sid)}</div>`;
      body.innerHTML = html;
      if (typeof lucide!=='undefined') lucide.createIcons();
    } catch(e){
      body.innerHTML = Utils.errorCard('Step failed', e.message||'Unable to load step');
    }
  },

  async renderPeriod(){
    const s=this.state;
    const years = s.cache.years||[];
    return `
      <div class="rw-card-hd"><h3><i data-lucide="calendar"></i> Academic Period</h3></div>
      <div class="rw-card-bd">
        <p class="rw-help" style="margin-bottom:10px">Select the academic year. Terms are dynamic and come from the academic setup.</p>
        <div class="form-group" style="max-width:360px">
          <label>Academic Year <span style="color:#dc2626">*</span></label>
          <select class="select-field" onchange="ReportWizard.setYear(this.value)">
            <option value="">Select Year</option>
            ${years.map(y=> `<option value="${y.id}" ${String(y.id)===String(s.academicYearId)?'selected':''}>${Utils.escapeHtml(y.name)}${y.status==='active'?' (Active)':''}</option>`).join('')}
          </select>
        </div>
        <div class="rw-divider"></div>
        <div class="rw-help">Next step: terms selector appears under <strong>Terms</strong> step and is filtered to this year.</div>
        <div style="margin-top:12px"><span class="rw-badge ok">${years.length} years configured</span> <span class="rw-badge">${s.cache.terms.length} terms available for selected year</span></div>
      </div>`;
  },

  async renderClasses(multi){
    const s=this.state;
    const classes = s.cache.classes||[];
    const q = (document.getElementById('rw-class-q')? document.getElementById('rw-class-q').value : '')||'';
    let list = classes;
    if (q) list = list.filter(c=> c.name.toLowerCase().includes(q.toLowerCase()));
    // grouping by education level
    const primary = list.filter(c=> EducationLevels.getCategory(c)==='Primary');
    const secondary = list.filter(c=> c!==primary.includes(c) ? false : false);
    const sec = list.filter(c=> !primary.includes(c));
    const renderGroup = (title, arr)=>{
      if (!arr.length) return '';
      return `<div style="margin:8px 0 6px;font-size:11px;font-weight:700;color:var(--gray-500);text-transform:uppercase;letter-spacing:.04em">${title} (${arr.length})</div>
      ${arr.map(c=> {
        const sel = s.classIds.some(x=> String(x)===String(c.id));
        const input = multi ? `<input type="checkbox" ${sel?'checked':''} onchange="ReportWizard.toggleArray('classIds','${c.id}')">`
                            : `<input type="radio" name="rw-class" ${sel?'checked':''} onchange="ReportWizard.setSingle('classIds','${c.id}')">`;
        return `<label class="rw-opt">${input}<span><span class="rw-opt-title">${Utils.escapeHtml(c.name)}</span> <span class="rw-opt-sub">${Utils.escapeHtml(c.education_level||EducationLevels.getCategory(c))}${c.stream?' · '+Utils.escapeHtml(c.stream):''}</span></span></label>`;
      }).join('')}`;
    };
    let classesInner = '';
    if (list.length) {
      classesInner = renderGroup('Primary', primary) + renderGroup('Secondary', sec);
      if (!primary.length && !sec.length) {
        classesInner += list.map(function(c){
          const sel=s.classIds.some(function(x){ return String(x)===String(c.id); });
          const input=multi ? '<input type="checkbox" '+(sel?'checked':'')+' onchange="ReportWizard.toggleArray(\'classIds\',\''+c.id+'\')">'
                            : '<input type="radio" name="rw-class" '+(sel?'checked':'')+' onchange="ReportWizard.setSingle(\'classIds\',\''+c.id+'\')">';
          return '<label class="rw-opt">'+input+'<span><span class="rw-opt-title">'+Utils.escapeHtml(c.name)+'</span></span></label>';
        }).join('');
      }
    } else {
      const scopeLabel = (typeof Scope!=='undefined' ? Scope.label() : '');
      classesInner = '<div class="rw-empty">No classes in your scope. '+Utils.escapeHtml(scopeLabel)+'</div>';
    }
    return ''
      + '<div class="rw-card-hd"><h3><i data-lucide="school"></i> '+(multi?'Select Classes':'Select Class')+'</h3>'
      + '  <div style="margin-left:auto" class="rw-actions">'
      + (multi ? '<button class="btn btn-outline btn-sm" onclick="ReportWizard.selectAll(\'classIds\', ReportWizard.state.cache.classes.map(function(c){return c.id}))">Select All</button><button class="btn btn-outline btn-sm" onclick="ReportWizard.clear(\'classIds\')">Clear</button>' : '')
      + '  </div>'
      + '</div>'
      + '<div class="rw-card-bd">'
      + '  <div class="rw-search"><i data-lucide="search"></i><input id="rw-class-q" placeholder="Search classes..." value="'+Utils.escapeHtml(q)+'" oninput="ReportWizard.renderStep()"></div>'
      + '  <div class="rw-list">'+classesInner+'</div>'
      + '  <div style="margin-top:10px" class="rw-badge">'+s.classIds.length+' selected</div>'
      + '</div>';
  },

  setSingle(key, id){
    this.state[key]=[id];
    if (key==='classIds'){ this.state.studentIds=[]; this.state.cache.students=[]; this.state.cache.assessments=[]; }
    this.renderStep(); this.renderNav();
  },
  selectAll(key, ids){ this.state[key]=[...ids]; this.renderStep(); this.renderNav(); },
  clear(key){ this.state[key]=[]; if(key==='classIds'){ this.state.studentIds=[]; this.state.cache.students=[]; } this.renderStep(); this.renderNav(); },

  async renderStudents(){
    const s=this.state;
    if (!s.classIds.length) return `<div class="rw-card-hd"><h3><i data-lucide="users"></i> Select Students</h3></div><div class="rw-card-bd"><div class="rw-empty">Select at least one class first.</div></div>`;
    // load students dependent on classIds (narrow)
    if (!s.cache.students.length){
      try {
        const learners = await DB.query('learners','id,full_name,learner_code,class_id,gender',{ class_id: s.classIds, status:'active' },{ column:'full_name', asc:true });
        s.cache.students = learners||[];
      } catch(e){ s.cache.students=[]; }
    }
    const qEl = document.getElementById('rw-stu-q'); const q = qEl? qEl.value.toLowerCase(): '';
    let list = s.cache.students;
    if (q) list = list.filter(l=> (l.full_name+l.learner_code).toLowerCase().includes(q));
    const isBatch = true; // always batch capable
    return `
      <div class="rw-card-hd"><h3><i data-lucide="users"></i> Select Students</h3>
        <div style="margin-left:auto" class="rw-actions">
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.selectAll('studentIds', ReportWizard.state.cache.students.map(x=>x.id))">Select All</button>
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.clear('studentIds')">Clear</button>
        </div>
      </div>
      <div class="rw-card-bd">
        <div class="rw-search"><i data-lucide="search"></i><input id="rw-stu-q" placeholder="Search students..." value="${q?Utils.escapeHtml(q):''}" oninput="ReportWizard.renderStep()"></div>
        <div class="rw-list">
          ${list.length? list.map(l=>{
            const sel=s.studentIds.some(x=>String(x)===String(l.id));
            return `<label class="rw-opt"><input type="checkbox" ${sel?'checked':''} onchange="ReportWizard.toggleArray('studentIds','${l.id}')"><span><span class="rw-opt-title">${Utils.escapeHtml(l.full_name)}</span> <span class="rw-opt-sub">${Utils.escapeHtml(l.learner_code||'-')} · ${Utils.escapeHtml((s.cache.allClasses||[]).find(c=>String(c.id)===String(l.class_id))?.name||'')}</span></span></label>`;
          }).join('') : `<div class="rw-empty">No students in selected class(es).</div>`}
        </div>
        <div style="margin-top:10px" class="rw-badge ${s.studentIds.length?'ok':''}">${s.studentIds.length} selected${s.studentIds.length? ` · batch will generate ${s.studentIds.length} A4 pages`: ''}</div>
        <p class="rw-help" style="margin-top:8px">Individual = one page per student. Select All for class batch. Each student page is isolated (page-break).</p>
      </div>`;
  },

  async renderSubjects(){
    const s=this.state;
    // need classes to filter; if no class, show all scoped but explain dependency
    let subjects=[];
    // Try class_subjects first if single class, else broad
    if (s.classIds.length===1){
      try { subjects = await ReportUtils.getClassSubjects(s.classIds[0]); } catch(e){ subjects=[]; }
      if (!subjects.length){
        try { subjects = await DB.get('subjects')||[]; } catch(e){ subjects=[]; }
      }
    } else {
      try { subjects = await DB.get('subjects')||[]; } catch(e){ subjects=[]; }
    }
    // scope + level filter
    const sampleCls = s.cache.classes.find(c=> String(c.id)===String(s.classIds[0]));
    subjects = this._scopedSubjects(subjects, sampleCls);
    subjects = subjects.filter(x=> !x.status || x.status==='active');
    // teacher: only subjects assigned to teacher for selected class(es)
    if (typeof Auth!=='undefined' && Auth.isTeacher && Auth.isTeacher() && s.classIds.length){
      try{
        const teacherId = Auth.getTeacherId();
        const assigns = await DB.query('teacher_assignments','*',{teacher_id: teacherId, class_id: s.classIds});
        const allowed = new Set((assigns||[]).map(a=> String(a.subject_id)));
        if (allowed.size) subjects = subjects.filter(s=> allowed.has(String(s.id)));
      }catch(e){ /* ignore */ }
    }
    subjects.sort((a,b)=> String(a.name).localeCompare(String(b.name)));
    s.cache.subjects = subjects;
    const q = (document.getElementById('rw-subj-q')?document.getElementById('rw-subj-q').value:'').toLowerCase();
    let list = subjects;
    if (q) list = list.filter(x=> x.name.toLowerCase().includes(q));
    return `
      <div class="rw-card-hd"><h3><i data-lucide="book-open"></i> Select Subjects</h3>
        <div style="margin-left:auto" class="rw-actions">
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.selectAll('subjectIds', ReportWizard.state.cache.subjects.map(x=>x.id))">Select All</button>
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.clear('subjectIds')">Clear</button>
        </div>
      </div>
      <div class="rw-card-bd">
        <p class="rw-help" style="margin-bottom:8px">Only subjects for your education level and selected class appear. Empty = all scoped subjects.</p>
        <div class="rw-search"><i data-lucide="search"></i><input id="rw-subj-q" placeholder="Search subjects..." oninput="ReportWizard.renderStep()"></div>
        <div class="rw-list">
          ${list.length? list.map(x=>{
            const sel=s.subjectIds.some(id=> String(id)===String(x.id));
            return `<label class="rw-opt"><input type="checkbox" ${sel?'checked':''} onchange="ReportWizard.toggleArray('subjectIds','${x.id}')"><span><span class="rw-opt-title">${Utils.escapeHtml(x.name)}</span> <span class="rw-opt-sub">${Utils.escapeHtml(x.level||'Both')}${x.code?' · '+Utils.escapeHtml(x.code):''}</span></span></label>`;
          }).join('') : `<div class="rw-empty">No subjects assigned to selected class(es).</div>`}
        </div>
        <div style="margin-top:10px" class="rw-badge">${s.subjectIds.length? s.subjectIds.length+' selected' : 'All subjects (default)'}</div>
      </div>`;
  },

  async renderAssessments(){
    const s=this.state;
    if (!s.classIds.length) return `<div class="rw-card-hd"><h3><i data-lucide="clipboard-list"></i> Select Assessments</h3></div><div class="rw-card-bd"><div class="rw-empty">Select class (and optionally subjects) first.</div></div>`;
    // build filter narrow; don't load whole table
    const filter={};
    if (s.classIds.length) filter.class_id = s.classIds;
    if (s.subjectIds.length) filter.subject_id = s.subjectIds;
    if (s.academicYearId) filter.academic_year_id = s.academicYearId;
    if (s.termIds.length===1) filter.term_id = s.termIds[0];
    // status approved/locked/submitted ?? show all?
    filter.status = ['approved','locked','submitted','draft','pending','rejected'];
    // Teacher: only own assessments (assigned classes already filtered, but also restrict by teacher_id)
    if (typeof Auth!=='undefined' && Auth.isTeacher && Auth.isTeacher()){
      try { filter.teacher_id = Auth.getTeacherId(); } catch(e){ /* ignore */ }
    }
    let assessments=[];
    try { assessments = await DB.query('assessments','id,name,unit,subject_id,class_id,term_id,assessment_type_id,status,maximum_mark,assessment_date', filter, {column:'assessment_date', asc:false}); } catch(e){ assessments=[]; }
    // scope filter subjects
    const allSubj = s.cache.subjects||[];
    assessments = assessments.filter(a=>{
      const subj = allSubj.find(x=> String(x.id)===String(a.subject_id));
      if (subj && typeof Scope!=='undefined' && Scope.isScoped() && !Scope.matchesSubject(subj)) return false;
      return true;
    });
    // also need to ensure term filter when multiple terms: allow multiple termIds
    if (s.termIds.length>1) assessments = assessments.filter(a=> !a.term_id || s.termIds.some(t=> String(t)===String(a.term_id)));
    s.cache.assessments = assessments;
    // group by assessment_type or subject
    const types = s.cache.assessmentTypes || await (async()=>{ try{ const t=await ReportUtils.getAssessmentTypes(); s.cache.assessmentTypes=t; return t;}catch(e){return [];} })();
    const typeMap=new Map(types.map(t=>[String(t.id), t.name]));
    const q=(document.getElementById('rw-assess-q')?document.getElementById('rw-assess-q').value:'').toLowerCase();
    let list=assessments;
    if (q) list=list.filter(a=> (a.name+a.unit+(typeMap.get(String(a.assessment_type_id))||'')).toLowerCase().includes(q));
    return `
      <div class="rw-card-hd"><h3><i data-lucide="clipboard-list"></i> Select Assessments</h3>
        <div style="margin-left:auto" class="rw-actions">
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.selectAll('assessmentIds', ReportWizard.state.cache.assessments.map(x=>x.id))">Select All</button>
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.clear('assessmentIds')">Clear</button>
        </div>
      </div>
      <div class="rw-card-bd">
        <p class="rw-help" style="margin-bottom:8px">Filtered by class ${s.classIds.length? s.classIds.join(','):''}${s.subjectIds.length?' + subjects':''}. Select one, multiple, or all.</p>
        <div class="rw-search"><i data-lucide="search"></i><input id="rw-assess-q" placeholder="Search assessments..." oninput="ReportWizard.renderStep()"></div>
        <div class="rw-list">
          ${list.length? list.map(a=>{
            const sel=s.assessmentIds.some(id=> String(id)===String(a.id));
            const tName = typeMap.get(String(a.assessment_type_id))||'Assessment';
            return `<label class="rw-opt"><input type="checkbox" ${sel?'checked':''} onchange="ReportWizard.toggleArray('assessmentIds','${a.id}')"><span><span class="rw-opt-title">${Utils.escapeHtml(a.name)}${a.unit?' — '+Utils.escapeHtml(a.unit):''}</span> <span class="rw-opt-sub">${Utils.escapeHtml(tName)} · ${Utils.escapeHtml(a.status)} · Max ${a.maximum_mark||'-'}</span></span></label>`;
          }).join('') : `<div class="rw-empty">No assessments for selected scope. Check class/subject/term filters.</div>`}
        </div>
        <div style="margin-top:10px" class="rw-badge">${s.assessmentIds.length? s.assessmentIds.length+' selected' : 'All assessments (default)'}</div>
      </div>`;
  },

  async renderTerms(){
    const s=this.state;
    const terms = s.cache.terms||[];
    return `
      <div class="rw-card-hd"><h3><i data-lucide="calendar-range"></i> Select Terms</h3>
        <div style="margin-left:auto" class="rw-actions">
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.selectAll('termIds', ReportWizard.state.cache.terms.map(x=>x.id))">Select All</button>
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.clear('termIds')">Clear</button>
        </div>
      </div>
      <div class="rw-card-bd">
        <p class="rw-help" style="margin-bottom:8px">Dynamic · only terms configured for ${Utils.escapeHtml((s.cache.years.find(y=>String(y.id)===String(s.academicYearId))||{}).name||'selected year')}.</p>
        <div class="rw-list">
          ${terms.length? terms.map(t=>{
            const sel=s.termIds.some(id=> String(id)===String(t.id));
            return `<label class="rw-opt"><input type="checkbox" ${sel?'checked':''} onchange="ReportWizard.toggleArray('termIds','${t.id}')"><span><span class="rw-opt-title">${Utils.escapeHtml(t.name)}</span> <span class="rw-opt-sub">Term ${t.term_no||'-'}${t.status?' · '+Utils.escapeHtml(t.status):''}${t.is_current?' · Current':''}</span></span></label>`;
          }).join('') : `<div class="rw-empty">No terms configured for this academic year. Create terms in Academic Setup.</div>`}
        </div>
        <div style="margin-top:10px" class="rw-badge ${s.termIds.length?'ok':''}">${s.termIds.length} selected</div>
      </div>`;
  },

  async renderTeachers(){
    const s=this.state;
    if (!s.cache.teachers.length){
      try { s.cache.teachers = await DB.get('teachers', {status:'active'})||[]; } catch(e){ s.cache.teachers=[]; }
      // Teacher role: restrict to self only (cannot pick other teachers)
      if (typeof Auth!=='undefined' && Auth.isTeacher && Auth.isTeacher()){
        try {
          const tid = Auth.getTeacherId();
          s.cache.teachers = s.cache.teachers.filter(t=> String(t.id)===String(tid));
          // auto-select self for wizard convenience
          if (!s.teacherIds.length && tid) s.teacherIds=[tid];
        } catch(e){ /* ignore */ }
      }
    }
    const q=(document.getElementById('rw-teach-q')?document.getElementById('rw-teach-q').value:'').toLowerCase();
    let list=s.cache.teachers;
    if (q) list=list.filter(t=> (t.full_name+t.email).toLowerCase().includes(q));
    return `
      <div class="rw-card-hd"><h3><i data-lucide="user-check"></i> Select Teachers</h3>
        <div style="margin-left:auto" class="rw-actions">
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.selectAll('teacherIds', ReportWizard.state.cache.teachers.map(x=>x.id))">Select All</button>
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.clear('teacherIds')">Clear</button>
        </div>
      </div>
      <div class="rw-card-bd">
        <div class="rw-search"><i data-lucide="search"></i><input id="rw-teach-q" placeholder="Search teachers..." oninput="ReportWizard.renderStep()"></div>
        <div class="rw-list">
          ${list.length? list.map(t=>{
            const sel=s.teacherIds.some(id=> String(id)===String(t.id));
            return `<label class="rw-opt"><input type="checkbox" ${sel?'checked':''} onchange="ReportWizard.toggleArray('teacherIds','${t.id}')"><span><span class="rw-opt-title">${Utils.escapeHtml(t.full_name)}</span> <span class="rw-opt-sub">${Utils.escapeHtml(t.email||'')} ${t.education_level?' · '+Utils.escapeHtml(t.education_level):''}</span></span></label>`;
          }).join('') : `<div class="rw-empty">No teachers found.</div>`}
        </div>
        <div style="margin-top:10px" class="rw-badge">${s.teacherIds.length} selected</div>
      </div>`;
  },

  renderMetrics(){
    const opts=['Average','Pass Rate','Highest','Lowest','Grade Distribution','Completion Rate'];
    const sel=this.state.metrics;
    return `
      <div class="rw-card-hd"><h3><i data-lucide="trending-up"></i> Performance Metrics</h3></div>
      <div class="rw-card-bd">
        <p class="rw-help" style="margin-bottom:8px">Choose metrics for analytics. Empty = all.</p>
        <div class="rw-list">
          ${opts.map(m=>{
            const chk=sel.includes(m)?'checked':'';
            return `<label class="rw-opt"><input type="checkbox" ${chk} onchange="ReportWizard.toggleArray('metrics','${Utils.escapeHtml(m)}')"><span class="rw-opt-title">${m}</span></label>`;
          }).join('')}
        </div>
      </div>`;
  },

  renderOptions(){
    return '';
  },

  async renderSummary(){
    const s=this.state;
    const years=s.cache.years; const year=years.find(y=> String(y.id)===String(s.academicYearId));
    const clsNames = s.classIds.map(id=> (s.cache.classes.find(c=>String(c.id)===String(id))||{}).name ).filter(Boolean).join(', ')||'—';
    const terms = s.cache.terms.filter(t=> s.termIds.includes(String(t.id)) || s.termIds.includes(t.id)).map(t=>t.name).join(' + ')||'—';
    // resolve counts async? synchronous view
    return `
      <div class="rw-card-hd"><h3><i data-lucide="eye"></i> Report Summary</h3></div>
      <div class="rw-card-bd">
        <div class="rw-summary">
          <div class="rw-summary-grid">
            <div><strong>Report Type:</strong> ${Utils.escapeHtml(this.DEFS[s.reportType].label)}</div>
            <div><strong>Education Level:</strong> ${Utils.escapeHtml(typeof Scope!=='undefined'? Scope.label() : 'Global')}</div>
            <div><strong>Academic Year:</strong> ${Utils.escapeHtml(year? year.name : '-')}</div>
            <div><strong>Terms:</strong> ${Utils.escapeHtml(terms)}</div>
            <div><strong>Class${s.classIds.length===1?'':'es'}:</strong> ${Utils.escapeHtml(clsNames)} (${s.classIds.length})</div>
            <div><strong>Students:</strong> ${s.studentIds.length? s.studentIds.length+' selected' : 'All in scope'}</div>
            <div><strong>Subjects:</strong> ${s.subjectIds.length? s.subjectIds.length+' selected' : 'All scoped'}</div>
            <div><strong>Assessments:</strong> ${s.assessmentIds.length? s.assessmentIds.length+' selected' : 'All scoped'}</div>
            <div><strong>Teachers:</strong> ${s.teacherIds.length? s.teacherIds.length+' selected' : (s.reportType==='teacher-performance'?'Required':'—')}</div>
            <div><strong>Orientation:</strong> ${Utils.escapeHtml(s.options.orientation||'auto')}</div>
          </div>
        </div>
        <div style="margin-top:14px" class="rw-actions">
          <button class="btn btn-primary" onclick="ReportWizard.preview()"><i data-lucide="eye"></i> Preview Report →</button>
          <button class="btn btn-outline" onclick="ReportWizard.state.stepIndex=0;ReportWizard.renderShell()"><i data-lucide="edit-3"></i> Edit Choices</button>
        </div>
        <p class="rw-help" style="margin-top:10px">Preview uses the real engine and exact selections. Batch student cards produce one A4 page per student.</p>
      </div>`;
  },

  async renderPreviewStep(){
    return `
      <div class="rw-card-hd"><h3><i data-lucide="printer"></i> Preview</h3>
        <div style="margin-left:auto" class="rw-actions">
          <button class="btn btn-outline btn-sm" onclick="ReportWizard.preview()"><i data-lucide="eye"></i> Generate Preview</button>
        </div>
      </div>
      <div class="rw-card-bd">
        <p class="rw-help">Click Generate Preview to render using selected data. This uses the live report engine — not a fake preview.</p>
        <div id="rw-preview-area" class="rw-preview-area" style="margin-top:12px"></div>
      </div>`;
  },

  buildEngineConfig(){
    const s=this.state;
    // Normalize to legacy singular where needed but also arrays
    const cfg = {
      reportType: s.reportType,
      academicYear: s.academicYearId || undefined,
      term: s.termIds[0] || undefined,
      classId: s.classIds[0] || undefined,
      classIds: s.classIds.length? s.classIds : undefined,
      subjectId: s.subjectIds[0] || undefined,
      subjectIds: s.subjectIds.length? s.subjectIds : undefined,
      teacherId: s.teacherIds[0] || undefined,
      teacherIds: s.teacherIds.length? s.teacherIds : undefined,
      assessmentId: s.assessmentIds[0] || undefined,
      assessmentIds: s.assessmentIds.length? s.assessmentIds : undefined,
      studentId: s.studentIds[0] || undefined,
      studentIds: s.studentIds.length? s.studentIds : undefined,
      termIds: s.termIds.length? s.termIds : undefined,
      assessmentTypeId: undefined,
      teacherComment: s.options.teacherComment||'',
      dosComment: s.options.dosComment||'',
      decisionOverride: s.options.decisionOverride||'',
      options: s.options
    };
    return cfg;
  },

  async preview(){
    const area = document.getElementById('rw-preview-area') || document.getElementById('rw-preview');
    const target = document.getElementById('rw-preview-area') || document.getElementById('rw-preview') || document.getElementById('rw-root');
    const previewContainer = document.getElementById('rw-preview');
    const stepPreview = document.getElementById('rw-preview-area');
    const container = stepPreview || previewContainer;
    if (container) container.innerHTML = Utils.loading();
    try {
      this.validateAll();
      const cfg = this.buildEngineConfig();
      // Student-card batch path: use rcState-compatible path for richer layout, but also support generic engine
      if (cfg.reportType==='student-card' && cfg.studentIds && cfg.studentIds.length===0) {
        // if no students selected, engine will load students of class(s) – we pass classIds
        // proceed generic
      }
      // Handle Student Report Card: individual vs whole class (single page)
      const isStudentCard = ['student-card', 'student-performance'].includes(cfg.reportType);
      const mode = this.state.options.cardMode || 'individual';
      let bodyHtml='';
      let orientation=this.state.options.orientation;
      const renderStudentCard = data => typeof ReportStudent !== 'undefined' && typeof ReportStudent.renderCardInner === 'function'
        ? ReportStudent.renderCardInner(data)
        : ReportTemplates.studentCard(data);
      if (isStudentCard && (mode==='whole' || !cfg.studentIds || cfg.studentIds.length===0 || cfg.studentIds.length>1)){
        // Determine target student ids: whole class -> all in classIds, individual -> selected list
        let targetIds = cfg.studentIds;
        if (mode==='whole' || !targetIds || !targetIds.length){
          if (!this.state.cache.students.length && this.state.classIds.length){
            try { const l = await DB.query('learners','id',{ class_id: this.state.classIds, status:'active' }); this.state.cache.students = l||[]; } catch(e){}
          }
          targetIds = (this.state.cache.students||[]).map(s=>s.id);
          if (!targetIds.length) throw new Error('No active learners found in the selected class(es).');
        }
        if (cfg.reportType === 'student-card' && (mode==='whole' || !cfg.studentIds || !cfg.studentIds.length)){
          // Batched whole-class: one heavy fetch pass per class via ReportStudent.fetchClassCards
          if (typeof ReportStudent==='undefined' || typeof ReportStudent.fetchClassCards!=='function') throw new Error('Student card engine not loaded.');
          const yearId=cfg.academicYear, termId=cfg.term, termIds=cfg.termIds;
          const subjectIds=cfg.subjectIds, assessmentIds=cfg.assessmentIds, assessmentTypeId=cfg.assessmentTypeId;
          const teacherComment=cfg.teacherComment||'', dosComment=cfg.dosComment||'', decisionOverride=cfg.decisionOverride||'';
          let cards=[];
          const classIds = (mode==='whole' ? (this.state.classIds||[]) : [].concat(this.state.classIds||[]).concat(cfg.classId).filter(Boolean));
          for (const cid of classIds){
            if (!cid) continue;
            const res = await ReportStudent.fetchClassCards({ classId: cid, yearId, termId, termIds, subjectIds, assessmentIds, assessmentTypeId, teacherComment, dosComment, decisionOverride });
            cards = cards.concat(res.cards||[]);
            if (!this.state.cache.students.length) this.state.cache.students = (res.cards||[]).map(c=>c.learner);
          }
          if (!cards.length) throw new Error('No active learners found in the selected class(es).');
          cards.sort((a,b)=> (a.position||9999)-(b.position||9999));
          bodyHtml = cards.map(renderStudentCard).join(ReportHeader.getPageBreak());
          orientation = (orientation==='auto' || !orientation) ? 'portrait' : orientation;
        } else if (cfg.reportType === 'student-card') {
          // Specific student selection (1+): per-student via engine + rich card layout
          const parts=[];
          for (const sid of targetIds){
            const one = await ReportEngine.generate({...cfg, studentId:sid, studentIds:[sid]});
            parts.push(renderStudentCard(one));
          }
          bodyHtml = parts.join(ReportHeader.getPageBreak());
          orientation = (orientation==='auto' || !orientation) ? 'portrait' : orientation;
        } else {
          // student-performance batch: one top-half-template section per student
          const fnMap={ 'student-performance':'studentPerformance', 'exam-class-summary':'examClassSummary', 'subject-performance':'subjectPerformance', 'class-performance':'classPerformance', 'missing-marks':'missingMarks', 'school-performance':'schoolPerformance', 'teacher-performance':'teacherPerformance', 'grade-distribution':'gradeDistribution'};
          const parts=[];
          for (const sid of targetIds){
            const one = await ReportEngine.generate({...cfg, studentId:sid, studentIds:[sid]});
            const tfn=ReportTemplates[fnMap[one.type] || 'studentPerformance'];
            if (tfn) parts.push(tfn(one));
          }
          bodyHtml = parts.join(ReportHeader.getPageBreak());
          orientation = (orientation==='auto' || !orientation) ? 'portrait' : orientation;
        }
      } else {
        const data = await ReportEngine.generate(cfg);
        let _bodyHtml='';
        let _orientation=orientation;
        {
          const fnMap={ 'student-card':'studentCard', 'student-performance':'studentPerformance', 'exam-class-summary':'examClassSummary', 'subject-performance':'subjectPerformance', 'class-performance':'classPerformance', 'missing-marks':'missingMarks', 'school-performance':'schoolPerformance', 'teacher-performance':'teacherPerformance', 'grade-distribution':'gradeDistribution'};
          const tfn=ReportTemplates[fnMap[data.type]];
          _bodyHtml = cfg.reportType === 'student-card' ? renderStudentCard(data) : (tfn ? tfn(data) : '<p>Template not found</p>');
          _orientation = orientation==='auto'? ReportHeader.getOrientation(data.type) : orientation;
          bodyHtml = _bodyHtml;
          orientation = _orientation;
        }
      }
      const a4 = ReportHeader.getA4Container(bodyHtml, orientation);
      this.state.previewHtml=a4;
      this.state.previewOrientation=orientation;
      this.state.previewFilename=(typeof ReportCenter!=='undefined' && ReportCenter.buildFilename ? ReportCenter.buildFilename({title: this.DEFS[cfg.reportType].label, year:{name:''}}, orientation) : `RMS-MIS_${cfg.reportType}_${orientation}.pdf`);
      const host = stepPreview || previewContainer || document.getElementById('rw-root');
      // show in preview area + keep shell
      if (stepPreview){
        stepPreview.innerHTML = `
          <div class="report-preview-toolbar-flex no-print" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
            <div><h3 style="font-size:16px;font-weight:700">A4 Preview — ${orientation==='landscape'?'Landscape':'Portrait'} (${orientation==='landscape'?'297×210':'210×297'} mm)</h3><p class="text-sm text-muted">Live preview · matches print/PDF.</p></div>
            <div class="flex gap-2" style="flex-wrap:wrap">
              <button class="btn btn-outline btn-sm" onclick="ReportWizard.print()"><i data-lucide="printer"></i> Print</button>
              <button class="btn btn-primary btn-sm" onclick="ReportWizard.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
            </div>
          </div>
          <div id="rw-report-container">${a4}</div>`;
      } else if (previewContainer){
        previewContainer.innerHTML = `<div id="rw-report-container">${a4}</div>`;
      }
      if (typeof lucide!=='undefined') lucide.createIcons();
      (stepPreview||previewContainer).scrollIntoView({behavior:'smooth', block:'start'});
    } catch(e){
      const msg = e.message||'Failed to generate preview';
      if (container) container.innerHTML = Utils.errorCard('Preview failed', Utils.escapeHtml(msg));
      Utils.toast(msg,'error');
    }
  },

  async generate(){ await this.preview(); this.state.stepIndex = this.currentSteps().indexOf('preview'); this.renderShell(); // jump to preview step
    // after preview, keep content
    setTimeout(()=> this.preview(), 80);
  },

  print(){
    const html=this.state.previewHtml || (document.getElementById('rw-report-container')? document.getElementById('rw-report-container').innerHTML : '');
    if (!html){ Utils.toast('Generate preview first','error'); return; }
    const orientation=this.state.previewOrientation||'portrait';
    if (typeof ReportCenter!=='undefined' && ReportCenter.printDocument) ReportCenter.printDocument(html,'RMS-MIS Report', this.state.previewFilename, orientation);
    else {
      const w=window.open('','_blank'); if(!w) return;
      const base = new URL('.', window.location.href).href;
      const css = `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="${new URL('css/report-wizard.css', base).href}"><link rel="stylesheet" href="${new URL('css/report-card.css', base).href}">`;
      const pr = orientation==='landscape' ? 'size: A4 landscape; margin:10mm 11mm;' : 'size: A4 portrait; margin:10mm 11mm;';
      w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>RMS-MIS Report</title>${css}<style>@page{${pr}}*{ -webkit-print-color-adjust:exact !important; print-color-adjust:exact !important;}html,body{margin:0 !important;padding:0 !important;background:#fff !important;font-family:'Poppins',Arial,sans-serif !important;color:#0f172a !important;} .rms-a4-container{box-shadow:none !important; border:1.2px solid #1e3a5f !important;}</style></head><body>${html}<script>window.onload=function(){setTimeout(function(){window.focus();window.print();},700);};<\/script></body></html>`);
      w.document.close();
    }
  },
  async downloadPDF(){
    const html=this.state.previewHtml;
    if (!html){ await this.preview(); }
    const orientation=this.state.previewOrientation||'portrait';
    const filename=this.state.previewFilename||'RMS-MIS_Report.pdf';
    try{
      const pdfHtml = typeof ReportCenter !== 'undefined' && ReportCenter.buildPdfDocument
        ? ReportCenter.buildPdfDocument(this.state.previewHtml)
        : this.state.previewHtml;
      const r=await fetch('/api/reports/pdf',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({html:pdfHtml, filename})});
      if (r.ok){ const b=await r.blob(); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u); Utils.toast('PDF downloaded','success'); return; }
    } catch(e){}
    Utils.toast('In print dialog choose Save as PDF ('+filename+')','info');
    this.print();
  },
  exportExcel(){
    if (typeof XLSX==='undefined'){ Utils.toast('Excel library not loaded','error'); return; }
    const c=document.getElementById('rw-report-container'); if(!c){ Utils.toast('Generate preview first','error'); return; }
    const t=c.querySelector('table'); if(!t){ Utils.toast('No table in preview','error'); return; }
    const ws=XLSX.utils.table_to_sheet(t); const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Report');
    const base=(this.state.previewFilename||'RMS-MIS_Report').replace(/\.pdf$/i,''); XLSX.writeFile(wb, base+'.xlsx'); Utils.toast('Excel exported','success');
  }
};
