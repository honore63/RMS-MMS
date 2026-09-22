const ReportCenter = {
  state: {
    reportType: 'student-card',
    academicYear: '',
    term: '',
    classId: '',
    subjectId: '',
    teacherId: '',
    assessmentId: '',
    studentId: '',
    assessmentTypeId: '',
    cardMode: 'individual',
    cardLevel: 'all',
    cardStream: '',
    teacherComment: '',
    dosComment: '',
    decisionOverride: '',
    orientation: 'auto',
    loading: false,
    previewHtml: ''
  },

  async render() {
    setHeader('Report Center', 'Professional Academic Reporting System');
    setContent(Utils.loading());

    const [years, terms, classes, subjects, teachers, assessments, assessmentTypes] = await Promise.all([
      DB.get('academic_years'), DB.get('terms'), DB.get('classes'),
      DB.get('subjects'), DB.get('teachers'), DB.get('assessments'),
      ReportUtils.getAssessmentTypes()
    ]);

    const activeYear = years.find(y => y.status === 'active') || years[0] || {};
    const activeTerm = terms.find(t => t.status === 'active') || terms[0] || {};

    this.state.academicYear = activeYear.id || '';
    this.state.term = activeTerm.id || '';
    if (!this.state.cardMode) this.state.cardMode = 'individual';
    if (!this.state.cardLevel) this.state.cardLevel = 'all';
    if (!this.state.cardStream) this.state.cardStream = '';

    // Teacher scope: only classes from own assignments (RLS remains primary guard)
    let visibleClasses = classes;
    if (typeof Auth !== 'undefined' && Auth.isTeacher && Auth.isTeacher()) {
      try {
        const teacherId = Auth.getTeacherId();
        const assigns = await DB.query('teacher_assignments', '*', { teacher_id: teacherId });
        const allowed = new Set((assigns || []).map(a => String(a.class_id)));
        visibleClasses = (classes || []).filter(c => allowed.has(String(c.id)));
      } catch (e) { visibleClasses = []; }
    }
    const streams = [...new Set((visibleClasses || []).map(c => c.stream).filter(Boolean))];
    this._allClasses = visibleClasses || [];
    this._allSubjects = subjects || [];

    const reportCategories = this.getReportCategories();

    setContent(`
      <div class="report-center-container">
        <div class="card mb-6">
          <div class="card-header">
            <h3><i data-lucide="filter" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Report Filters</h3>
          </div>
          <div class="card-body">
            <div class="form-grid">
              <div class="form-group">
                <label>Report Category</label>
                <select id="rc-category" class="select-field" onchange="ReportCenter.onCategoryChange(this.value)">
                  ${reportCategories.map(c => `<option value="${c.id}" ${c.id === this.state.reportType ? 'selected' : ''}>${c.label}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Report Type</label>
                <select id="rc-report-type" class="select-field" onchange="ReportCenter.onTypeChange(this.value)">
                  <option value="student-card" ${this.state.reportType === 'student-card' ? 'selected' : ''}>Student Report Card</option>
                  <option value="student-performance" ${this.state.reportType === 'student-performance' ? 'selected' : ''}>Student Performance Summary</option>
                  <option value="exam-class-summary" ${this.state.reportType === 'exam-class-summary' ? 'selected' : ''}>Exam Class Performance Summary</option>
                  <option value="subject-performance" ${this.state.reportType === 'subject-performance' ? 'selected' : ''}>Subject Performance Summary</option>
                  <option value="class-performance" ${this.state.reportType === 'class-performance' ? 'selected' : ''}>Class Performance Report</option>
                  <option value="missing-marks" ${this.state.reportType === 'missing-marks' ? 'selected' : ''}>Missing Marks Report</option>
                  <option value="school-performance" ${this.state.reportType === 'school-performance' ? 'selected' : ''}>School Performance Summary</option>
                  <option value="teacher-performance" ${this.state.reportType === 'teacher-performance' ? 'selected' : ''}>Teacher Performance Report</option>
                  <option value="grade-distribution" ${this.state.reportType === 'grade-distribution' ? 'selected' : ''}>Grade Distribution</option>
                </select>
              </div>
              <div class="form-group">
                <label>Academic Year</label>
                <select id="rc-year" class="select-field" onchange="ReportCenter.state.academicYear=this.value">
                  ${years.map(y => `<option value="${y.id}" ${y.id === this.state.academicYear ? 'selected' : ''}>${Utils.escapeHtml(y.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group">
                <label>Term</label>
                <select id="rc-term" class="select-field" onchange="ReportCenter.state.term=this.value">
                  ${terms.map(t => `<option value="${t.id}" ${t.id === this.state.term ? 'selected' : ''}>${Utils.escapeHtml(t.name)} (Term ${t.term_no || ''})</option>`).join('')}
                </select>
              </div>
              <div class="form-group" id="rc-level-group" style="display:none">
                <label>Education Level</label>
                <select id="rc-level" class="select-field" onchange="ReportCenter.onLevelChange(this.value)">
                  <option value="all" ${this.state.cardLevel === 'all' ? 'selected' : ''}>All Levels</option>
                  <option value="Primary" ${this.state.cardLevel === 'Primary' ? 'selected' : ''}>Primary</option>
                  <option value="Secondary" ${this.state.cardLevel === 'Secondary' ? 'selected' : ''}>Secondary</option>
                </select>
              </div>
              <div class="form-group" id="rc-stream-group" style="display:none">
                <label>Stream</label>
                <select id="rc-stream" class="select-field" onchange="ReportCenter.onStreamChange(this.value)">
                  <option value="">All Streams</option>
                  ${streams.map(s => `<option value="${Utils.escapeHtml(s)}" ${this.state.cardStream === s ? 'selected' : ''}>${Utils.escapeHtml(s)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" id="rc-class-group">
                <label>Class</label>
                <select id="rc-class" class="select-field" onchange="ReportCenter.onClassChange(this.value)">
                  <option value="">All Classes</option>
                  ${visibleClasses.map(c => `<option value="${c.id}" ${c.id === this.state.classId ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" id="rc-mode-group" style="display:none">
                <label>Generation Mode</label>
                <select id="rc-mode" class="select-field" onchange="ReportCenter.state.cardMode=this.value;ReportCenter.updateFilterVisibility()">
                  <option value="individual" ${this.state.cardMode === 'individual' ? 'selected' : ''}>Individual Student Report Card</option>
                  <option value="class" ${this.state.cardMode === 'class' ? 'selected' : ''}>All Students in Class (Batch)</option>
                </select>
              </div>
              <div class="form-group" id="rc-atype-group" style="display:none">
                <label>Assessment Type (optional)</label>
                <select id="rc-atype" class="select-field" onchange="ReportCenter.state.assessmentTypeId=this.value">
                  <option value="">All Assessment Types</option>
                  ${assessmentTypes.map(t => `<option value="${t.id}" ${this.state.assessmentTypeId === t.id ? 'selected' : ''}>${Utils.escapeHtml(t.name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" id="rc-subject-group" style="display:none">
                <label>Subject</label>
                <select id="rc-subject" class="select-field" onchange="ReportCenter.state.subjectId=this.value">
                  <option value="">All Subjects</option>
                  ${subjects.map(s => `<option value="${s.id}" ${s.id === this.state.subjectId ? 'selected' : ''}>${Utils.escapeHtml(s.name)} (${Utils.escapeHtml(s.level || '')})</option>`).join('')}
                </select>
              </div>
              <div class="form-group" id="rc-teacher-group" style="display:none">
                <label>Teacher</label>
                <select id="rc-teacher" class="select-field" onchange="ReportCenter.state.teacherId=this.value">
                  <option value="">All Teachers</option>
                  ${teachers.map(t => `<option value="${t.id}" ${t.id === this.state.teacherId ? 'selected' : ''}>${Utils.escapeHtml(t.full_name)}</option>`).join('')}
                </select>
              </div>
              <div class="form-group" id="rc-assessment-group" style="display:none">
                <label>Assessment</label>
                <select id="rc-assessment" class="select-field" onchange="ReportCenter.state.assessmentId=this.value">
                  <option value="">All Assessments</option>
                  ${assessments.map(a => `<option value="${a.id}" ${a.id === this.state.assessmentId ? 'selected' : ''}>${Utils.escapeHtml(a.name)} - ${Utils.escapeHtml(a.unit || '')}</option>`).join('')}
                </select>
              </div>
<div class="form-group" id="rc-student-group" style="display:none">
                <label>Student</label>
                <select id="rc-student" class="select-field" onchange="ReportCenter.state.studentId=this.value">
                  <option value="">Select Student</option>
                </select>
              </div>
              <div class="form-group" id="rc-orientation-group">
                <label>Paper Orientation</label>
                <select id="rc-orientation" class="select-field" onchange="ReportCenter.state.orientation=this.value;ReportCenter.updateOrientationHint()">
                  <option value="auto" ${this.state.orientation === 'auto' ? 'selected' : ''}>Auto (Recommended)</option>
                  <option value="portrait" ${this.state.orientation === 'portrait' ? 'selected' : ''}>A4 Portrait (210 × 297 mm)</option>
                  <option value="landscape" ${this.state.orientation === 'landscape' ? 'selected' : ''}>A4 Landscape (297 × 210 mm)</option>
                </select>
                <p class="text-sm text-muted mt-1" id="rc-orientation-hint"></p>
              </div>
            </div>
            <div class="flex gap-3 mt-4" style="flex-wrap:wrap" id="rc-generic-actions">
              <button class="btn btn-primary" onclick="ReportCenter.generate()"><i data-lucide="bar-chart-3"></i> Generate Report</button>
              <button class="btn btn-secondary" onclick="ReportCenter.preview()"><i data-lucide="eye"></i> Preview</button>
              <button class="btn btn-secondary" onclick="ReportCenter.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
              <button class="btn btn-outline" onclick="ReportCenter.print()"><i data-lucide="printer"></i> Print</button>
              <button class="btn btn-outline" onclick="ReportCenter.exportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
              <button class="btn btn-outline" onclick="ReportCenter.refresh()"><i data-lucide="refresh-cw"></i> Refresh</button>
              <button class="btn btn-outline" onclick="ReportCenter.fullscreenPreview()"><i data-lucide="maximize"></i> Full Screen Preview</button>
              <button class="btn btn-outline" onclick="ReportCenter.resetFilters()"><i data-lucide="rotate-ccw"></i> Reset Filters</button>
            </div>
            <div class="flex gap-3 mt-4" style="flex-wrap:wrap;display:none" id="rc-card-actions">
              <button class="btn btn-primary" onclick="ReportCenter.generateReportCard()"><i data-lucide="file-badge"></i> Generate Report Card</button>
              <button class="btn btn-secondary" onclick="ReportCenter.generateClassReportCards()"><i data-lucide="layers"></i> Generate All Student Report Cards</button>
              <button class="btn btn-secondary" onclick="ReportCenter.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
              <button class="btn btn-outline" onclick="ReportCenter.print()"><i data-lucide="printer"></i> Print</button>
              <button class="btn btn-outline" onclick="ReportCenter.exportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
              <button class="btn btn-outline" onclick="ReportCenter.fullscreenPreview()"><i data-lucide="maximize"></i> Full Screen Preview</button>
              <button class="btn btn-outline" onclick="ReportCenter.resetFilters()"><i data-lucide="rotate-ccw"></i> Reset Filters</button>
            </div>
          </div>
        </div>
        <div class="card mb-6" id="rc-card-options" style="display:none">
          <div class="card-header"><h3><i data-lucide="message-square-text" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Report Card Comments &amp; Decision</h3></div>
          <div class="card-body">
            <p class="text-sm text-muted" style="margin-bottom:12px">Manual comments take priority and are never overwritten. Leave blank to use the automatic performance comment.</p>
            <div class="form-grid">
              <div class="form-group"><label>Teacher Comment (manual override)</label><textarea id="rc-teacher-comment" class="select-field" rows="3" placeholder="Leave blank for automatic comment">${Utils.escapeHtml(this.state.teacherComment || '')}</textarea></div>
              <div class="form-group"><label>DOS Comment (manual override)</label><textarea id="rc-dos-comment" class="select-field" rows="3" placeholder="Leave blank for automatic comment">${Utils.escapeHtml(this.state.dosComment || '')}</textarea></div>
              <div class="form-group"><label>Final Decision (optional override)</label><input id="rc-decision" class="select-field" placeholder="Auto: PASS / FAIL" value="${Utils.escapeHtml(this.state.decisionOverride || '')}"></div>
            </div>
          </div>
        </div>
        <div id="rc-preview-area"></div>
      </div>
    `);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    this.updateFilterVisibility();
  },

  getReportCategories() {
    return [
      { id: 'student-card', label: 'A. Student Reports', sub: ['Student Report Card', 'Student Academic Report'] },
      { id: 'student-performance', label: 'H. Student Performance', sub: ['Student Performance Summary'] },
      { id: 'exam-class-summary', label: 'B. Class Reports', sub: ['Exam Class Performance Summary', 'Class Performance Report'] },
      { id: 'subject-performance', label: 'C. Subject Reports', sub: ['Subject Performance Summary', 'Subject Marks Sheet'] },
      { id: 'missing-marks', label: 'D. Assessment Reports', sub: ['Missing Marks Report', 'Assessment Completion Report'] },
      { id: 'school-performance', label: 'E. School Reports', sub: ['School Performance Summary', 'Term Performance Summary'] },
      { id: 'teacher-performance', label: 'F. Teacher Reports', sub: ['Teacher Performance Report'] },
      { id: 'grade-distribution', label: 'G. Grade Distribution', sub: ['Grade Distribution Report'] }
    ];
  },

  async onCategoryChange(value) {
    this.state.reportType = value;
    this.updateFilterVisibility();
  },

  async onTypeChange(value) {
    this.state.reportType = value;
    this.updateFilterVisibility();
  },

  resolveOrientation(reportType) {
    if (this.state.orientation && this.state.orientation !== 'auto') return this.state.orientation;
    if (typeof ReportHeader !== 'undefined' && typeof ReportHeader.getOrientation === 'function') {
      return ReportHeader.getOrientation(reportType);
    }
    return 'portrait';
  },

  updateOrientationHint() {
    const hint = document.getElementById('rc-orientation-hint');
    if (!hint) return;
    const resolved = this.resolveOrientation(this.state.reportType);
    const dims = resolved === 'landscape' ? '297 × 210 mm' : '210 × 297 mm';
    const mode = (this.state.orientation && this.state.orientation !== 'auto')
      ? `Manual: A4 ${resolved} (${dims})`
      : `Auto: A4 ${resolved} (${dims}) recommended for this report`;
    hint.textContent = mode;
  },

  levelMatchesClass(cls, level) {
    if (!level || level === 'all') return true;
    const cat = EducationLevels.getCategory(cls);
    if (level === 'Primary') return cat === 'Primary';
    if (level === 'Secondary') return String(cat).toUpperCase().includes('SECONDARY');
    return true;
  },

  applyClassFilter() {
    const sel = document.getElementById('rc-class');
    if (!sel) return;
    const list = (this._allClasses || []).filter(c =>
      this.levelMatchesClass(c, this.state.cardLevel) &&
      (!this.state.cardStream || String(c.stream || '') === String(this.state.cardStream)));
    const cur = this.state.classId || '';
    sel.innerHTML = '<option value="">All Classes</option>' + list.map(c =>
      `<option value="${c.id}" ${String(c.id) === String(cur) ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('');
    if (cur && !list.some(c => String(c.id) === String(cur))) {
      this.state.classId = '';
      sel.value = '';
    }
    const streamSel = document.getElementById('rc-stream');
    if (streamSel) {
      const pool = (this._allClasses || []).filter(c => this.levelMatchesClass(c, this.state.cardLevel));
      const opts = [...new Set(pool.map(c => c.stream).filter(Boolean))];
      const cur = this.state.cardStream || '';
      streamSel.innerHTML = '<option value="">All Streams</option>' + opts.map(s =>
        `<option value="${Utils.escapeHtml(s)}" ${s === cur ? 'selected' : ''}>${Utils.escapeHtml(s)}</option>`).join('');
    }
  },

  onLevelChange(value) {
    this.state.cardLevel = value || 'all';
    this.state.cardStream = '';
    this.state.classId = '';
    this.state.studentId = '';
    this.applyClassFilter();
    this.loadStudents();
  },

  onStreamChange(value) {
    this.state.cardStream = value || '';
    this.state.classId = '';
    this.state.studentId = '';
    this.applyClassFilter();
    this.loadStudents();
  },

  async onClassChange(value) {
    this.state.classId = value;
    await this.loadStudents();
  },

  async loadStudents() {
    const sel = document.getElementById('rc-student');
    if (!sel) return;
    const classId = this.state.classId;
    if (!classId) {
      sel.innerHTML = '<option value="">Select Student</option>';
      return;
    }
    sel.innerHTML = '<option value="">Loading students...</option>';
    try {
      const learners = await ReportUtils.getLearners(classId);
      sel.innerHTML = '<option value="">Select Student</option>' + (learners || []).map(l =>
        `<option value="${l.id}" ${String(l.id) === String(this.state.studentId) ? 'selected' : ''}>${Utils.escapeHtml(l.full_name)} (${Utils.escapeHtml(l.learner_code || '-')})</option>`
      ).join('');
    } catch (e) {
      sel.innerHTML = '<option value="">Unable to load students</option>';
    }
  },

  updateFilterVisibility() {
    const type = this.state.reportType;
    const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
    const typeMap = {
      'student-card': ['rc-level-group', 'rc-stream-group', 'rc-class-group', 'rc-mode-group', 'rc-student-group', 'rc-subject-group', 'rc-atype-group'],
      'student-performance': ['rc-level-group', 'rc-stream-group', 'rc-class-group', 'rc-student-group', 'rc-subject-group', 'rc-atype-group'],
      'exam-class-summary': ['rc-class-group', 'rc-assessment-group'],
      'subject-performance': ['rc-class-group', 'rc-subject-group', 'rc-teacher-group', 'rc-assessment-group'],
      'class-performance': ['rc-class-group'],
      'missing-marks': ['rc-class-group'],
      'school-performance': [],
      'teacher-performance': [],
      'grade-distribution': ['rc-class-group']
    };
    const allGroups = ['rc-level-group', 'rc-stream-group', 'rc-class-group', 'rc-mode-group', 'rc-student-group', 'rc-subject-group', 'rc-atype-group', 'rc-teacher-group', 'rc-assessment-group'];
    const visible = typeMap[type] || [];
    allGroups.forEach(g => show(g, visible.includes(g)));
    const isCard = type === 'student-card';
    const isStudentView = isCard || type === 'student-performance';
    show('rc-generic-actions', !isCard);
    show('rc-card-actions', isCard);
    show('rc-card-options', isStudentView);
    // Orientation selector always visible so user can override Auto
    show('rc-orientation-group', true);
    if (isStudentView) {
      this.applyClassFilter();
      const mode = this.state.cardMode || 'individual';
      show('rc-student-group', !isCard || mode === 'individual');
      const subjLbl = document.querySelector('#rc-subject-group label');
      if (subjLbl) subjLbl.textContent = 'Subject Filter (optional — default: all assigned subjects)';
    }
    this.updateOrientationHint();
  },

  buildFilename(data, orientation) {
    const safe = (v) => String(v || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Report';
    const title = safe(data.title);
    const parts = ['RMS-MIS', title];
    if (data.cls?.name) parts.push(safe(data.cls.name));
    if (data.subject?.name) parts.push(safe(data.subject.name));
    if (data.learner?.full_name) parts.push(safe(data.learner.full_name));
    if (data.year?.name) parts.push(safe(data.year.name));
    if (data.term?.name) parts.push(safe(data.term.name));
    parts.push(orientation === 'landscape' ? 'A4-Landscape' : 'A4-Portrait');
    return parts.join('_') + '.pdf';
  },

  open(reportType) {
    const valid = ['student-card', 'student-performance', 'class-performance', 'subject-performance', 'exam-class-summary', 'missing-marks', 'school-performance', 'teacher-performance', 'grade-distribution'];
    this.state.reportType = valid.includes(reportType) ? reportType : 'student-card';
    if (this.state.reportType === 'student-card' && !this.state.cardMode) this.state.cardMode = 'individual';
    return this.render();
  },

  readCardInputs() {
    const t = document.getElementById('rc-teacher-comment');
    const d = document.getElementById('rc-dos-comment');
    const dec = document.getElementById('rc-decision');
    if (t) this.state.teacherComment = t.value;
    if (d) this.state.dosComment = d.value;
    if (dec) this.state.decisionOverride = dec.value;
  },

  cardBaseConfig() {
    return {
      yearId: this.state.academicYear || undefined,
      termId: this.state.term || undefined,
      classId: this.state.classId || undefined,
      subjectIds: this.state.subjectId ? [this.state.subjectId] : null,
      assessmentTypeId: this.state.assessmentTypeId || undefined,
      teacherComment: this.state.teacherComment || '',
      dosComment: this.state.dosComment || '',
      decisionOverride: this.state.decisionOverride || ''
    };
  },

  cardFilenameFor(learner, cls, year, term) {
    const safe = (v) => String(v || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Report';
    return ['RMS-MIS', 'Student_Report_Card', safe(learner?.full_name), safe(cls?.name), safe(year?.name), safe(term?.name)].join('_') + '.pdf';
  },

  showCardsPreview({ html, orientation, filename, title, subtitle }) {
    const previewArea = document.getElementById('rc-preview-area');
    this.state.previewHtml = html;
    this.state.previewOrientation = orientation;
    this.state.previewFilename = filename;
    const dims = orientation === 'landscape' ? '297 × 210 mm' : '210 × 297 mm';
    previewArea.innerHTML = `
      <div class="report-preview-toolbar-flex no-print" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div><h3 style="font-size:16px;font-weight:700">A4 Preview — ${orientation === 'landscape' ? 'Landscape' : 'Portrait'} (${dims})</h3>
        <p class="text-sm text-muted">${Utils.escapeHtml(title || '')}${subtitle ? ' — ' + Utils.escapeHtml(subtitle) : ''} — preview matches the printed / PDF document.</p></div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-outline btn-sm" onclick="ReportCenter.closePreview()"><i data-lucide="x"></i> Close Preview</button>
          <button class="btn btn-outline btn-sm" onclick="ReportCenter.print()"><i data-lucide="printer"></i> Print</button>
          <button class="btn btn-primary btn-sm" onclick="ReportCenter.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
          <button class="btn btn-outline btn-sm" onclick="ReportCenter.exportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
          <button class="btn btn-outline btn-sm" onclick="ReportCenter.fullscreenPreview()"><i data-lucide="maximize"></i> Full Screen</button>
        </div>
      </div>
      <div id="rc-report-container">${html}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  async generateReportCard() {
    this.readCardInputs();
    const previewArea = document.getElementById('rc-preview-area');
    previewArea.innerHTML = Utils.loading();
    try {
      const cfg = this.cardBaseConfig();
      if (!cfg.classId) throw new Error('Select a class.');
      if (!this.state.studentId) throw new Error('Select a student.');
      const card = await ReportStudent.fetchCardData({ ...cfg, learnerId: this.state.studentId });
      const html = ReportStudent.renderCard(card);
      this.showCardsPreview({ html, orientation: 'portrait', filename: this.cardFilenameFor(card.learner, card.cls, card.year, card.term), title: card.title, subtitle: card.learner?.full_name });
    } catch (e) {
      previewArea.innerHTML = Utils.errorCard('Report Card Error', e.message || 'Failed to generate report card.');
    }
  },

  async generateClassReportCards() {
    this.readCardInputs();
    const previewArea = document.getElementById('rc-preview-area');
    previewArea.innerHTML = Utils.loading();
    try {
      const cfg = this.cardBaseConfig();
      if (!cfg.classId) throw new Error('Select a class.');
      const { cards, meta } = await ReportStudent.fetchClassCards(cfg);
      const html = ReportStudent.renderBatch(cards);
      const safe = (v) => String(v || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
      const filename = ['RMS-MIS', 'Report_Cards', safe(meta.cls?.name), safe(meta.year?.name), safe(meta.term?.name)].join('_') + '.pdf';
      this.showCardsPreview({ html, orientation: 'portrait', filename, title: 'STUDENT REPORT CARDS', subtitle: `${meta.cls?.name || ''} — ${cards.length} learner${cards.length === 1 ? '' : 's'}` });
      Utils.toast(`Generated ${cards.length} report card${cards.length === 1 ? '' : 's'}`, 'success');
    } catch (e) {
      previewArea.innerHTML = Utils.errorCard('Report Card Error', e.message || 'Failed to generate report cards.');
    }
  },

  async generate() {
    if (this.state.reportType === 'student-card') {
      if ((this.state.cardMode || 'individual') === 'class') return this.generateClassReportCards();
      return this.generateReportCard();
    }
    this.state.loading = true;
    const previewArea = document.getElementById('rc-preview-area');
    if (!previewArea) return;
    previewArea.innerHTML = Utils.loading();

    try {
      this.readCardInputs();
      const config = {
        reportType: this.state.reportType,
        academicYear: this.state.academicYear || undefined,
        term: this.state.term || undefined,
        classId: this.state.classId || undefined,
        subjectId: this.state.subjectId || undefined,
        teacherId: this.state.teacherId || undefined,
        assessmentId: this.state.assessmentId || undefined,
        studentId: this.state.studentId || undefined,
        assessmentTypeId: this.state.assessmentTypeId || undefined,
        teacherComment: this.state.teacherComment || '',
        dosComment: this.state.dosComment || '',
        decisionOverride: this.state.decisionOverride || ''
      };

      const data = await ReportEngine.generate(config);
      const typeMap = {
        'student-card': 'studentCard', 'student-performance': 'studentPerformance',
        'exam-class-summary': 'examClassSummary',
        'subject-performance': 'subjectPerformance', 'class-performance': 'classPerformance',
        'missing-marks': 'missingMarks', 'school-performance': 'schoolPerformance',
        'teacher-performance': 'teacherPerformance', 'grade-distribution': 'gradeDistribution'
      };
      const templateFn = ReportTemplates[typeMap[data.type]];
      const bodyHtml = templateFn ? templateFn(data) : '<p>Report template not found</p>';
      const orientation = this.resolveOrientation(data.type);
      const a4Html = (typeof ReportHeader !== 'undefined' && typeof ReportHeader.getA4Container === 'function')
        ? ReportHeader.getA4Container(bodyHtml, orientation)
        : `<div class="rms-a4-container${orientation === 'landscape' ? ' rms-a4-landscape' : ''}" data-report-orientation="${orientation}">${bodyHtml}</div>`;
      this.state.previewHtml = a4Html;
      this.state.previewOrientation = orientation;
      this.state.previewFilename = this.buildFilename(data, orientation);
      const dims = orientation === 'landscape' ? '297 × 210 mm' : '210 × 297 mm';
      previewArea.innerHTML = `
        <div class="report-preview-toolbar-flex no-print" style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
          <div><h3 style="font-size:16px;font-weight:700">A4 Preview — ${orientation === 'landscape' ? 'Landscape' : 'Portrait'} (${dims})</h3>
          <p class="text-sm text-muted">${Utils.escapeHtml(data.title || '')} — preview matches the printed / PDF document.</p></div>
          <div class="flex gap-2" style="flex-wrap:wrap">
            <button class="btn btn-outline btn-sm" onclick="ReportCenter.closePreview()"><i data-lucide="x"></i> Close Preview</button>
            <button class="btn btn-outline btn-sm" onclick="ReportCenter.print()"><i data-lucide="printer"></i> Print</button>
            <button class="btn btn-primary btn-sm" onclick="ReportCenter.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
            <button class="btn btn-outline btn-sm" onclick="ReportCenter.exportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
            <button class="btn btn-outline btn-sm" onclick="ReportCenter.fullscreenPreview()"><i data-lucide="maximize"></i> Full Screen</button>
          </div>
        </div>
        <div id="rc-report-container">${a4Html}</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      previewArea.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      previewArea.innerHTML = Utils.errorCard('Report Generation Error', e.message || 'Failed to generate report.');
    }
    this.state.loading = false;
  },

  async preview() {
    await this.generate();
  },

  async refresh() {
    await this.generate();
    Utils.toast('Report refreshed', 'success');
  },

  closePreview() {
    const previewArea = document.getElementById('rc-preview-area');
    if (previewArea) previewArea.innerHTML = '';
    this.state.previewHtml = '';
  },

  fullscreenPreview() {
    const container = document.getElementById('rc-report-container');
    if (!container) { Utils.toast('Generate a report first', 'error'); return; }
    if (container.requestFullscreen) container.requestFullscreen();
    else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
    else Utils.toast('Full screen not supported in this browser', 'error');
  },

  printDocument(html, title, filename, orientation) {
    const w = window.open('', '_blank');
    if (!w) { Utils.toast('Allow pop-ups to print', 'error'); return; }
    const pageRule = orientation === 'landscape' ? 'size: A4 landscape; margin: 12mm;' : 'size: A4 portrait; margin: 12mm;';
    const cssLinks = `<link rel="stylesheet" href="${new URL('css/styles.css', window.location.href).href}"><link rel="stylesheet" href="${new URL('css/report-card.css', window.location.href).href}">`;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${Utils.escapeHtml(title || filename || 'Report')}</title>${cssLinks}<style>@page{${pageRule}}html,body{margin:0;padding:0;background:#fff}table{page-break-inside:auto}tr{page-break-inside:avoid;break-inside:avoid}thead{display:table-header-group}tfoot{display:table-footer-group}.rms-a4-container{box-shadow:none!important;margin:0 auto!important}.no-print,.report-preview-toolbar-flex{display:none!important}</style></head><body>${html}</body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 600);
  },

  print() {
    const html = this.state.previewHtml || (document.getElementById('rc-report-container') ? document.getElementById('rc-report-container').innerHTML : '');
    if (!html) { Utils.toast('Generate a report first', 'error'); return; }
    const orientation = this.state.previewOrientation || this.resolveOrientation(this.state.reportType);
    this.printDocument(html, 'RMS-MIS Report — Print (A4 ' + orientation + ')', this.state.previewFilename, orientation);
  },

  async downloadPDF() {
    let html = this.state.previewHtml;
    if (!html) {
      await this.generate();
      html = this.state.previewHtml;
    }
    if (!html) { Utils.toast('Generate a report first', 'error'); return; }
    const orientation = this.state.previewOrientation || this.resolveOrientation(this.state.reportType);
    const filename = this.state.previewFilename || ('RMS-MIS_Report_A4-' + orientation + '.pdf');
    // Browser print-to-PDF preserves the @page A4 size/orientation: user chooses "Save as PDF".
    Utils.toast('In the print dialog choose Destination: Save as PDF (' + filename + ')', 'info');
    this.printDocument(html, filename, filename, orientation);
  },

  async exportExcel() {
    if (typeof XLSX === 'undefined') { Utils.toast('Excel library not loaded', 'error'); return; }
    const container = document.getElementById('rc-report-container');
    if (!container) { Utils.toast('Generate a report first', 'error'); return; }
    const table = container.querySelector('table');
    if (!table) { Utils.toast('No table found in this report', 'error'); return; }
    const ws = XLSX.utils.table_to_sheet(table);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    const base = (this.state.previewFilename || 'RMS-MIS_Report').replace(/\.pdf$/i, '');
    XLSX.writeFile(wb, `${base}.xlsx`);
    Utils.toast('Report exported to Excel', 'success');
  },

  resetFilters() {
    this.state = { reportType: 'student-card', academicYear: this.state.academicYear, term: this.state.term, classId: '', subjectId: '', teacherId: '', assessmentId: '', assessmentTypeId: '', studentId: '', cardMode: 'individual', cardLevel: 'all', cardStream: '', teacherComment: '', dosComment: '', decisionOverride: '', orientation: 'auto', loading: false, previewHtml: '', previewOrientation: '', previewFilename: '' };
    this.render();
  }
};

function renderReportCenter() {
  ReportCenter.render();
}

