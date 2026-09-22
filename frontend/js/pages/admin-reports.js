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
              <div class="form-group" id="rc-class-group">
                <label>Class</label>
                <select id="rc-class" class="select-field" onchange="ReportCenter.state.classId=this.value">
                  <option value="">All Classes</option>
                  ${classes.map(c => `<option value="${c.id}" ${c.id === this.state.classId ? 'selected' : ''}>${Utils.escapeHtml(c.name)}</option>`).join('')}
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
            </div>
            <div class="flex gap-3 mt-4">
              <button class="btn btn-primary" onclick="ReportCenter.generate()"><i data-lucide="bar-chart-3"></i> Generate Report</button>
              <button class="btn btn-secondary" onclick="ReportCenter.preview()"><i data-lucide="eye"></i> Preview</button>
              <button class="btn btn-outline" onclick="ReportCenter.print()"><i data-lucide="printer"></i> Print</button>
              <button class="btn btn-outline" onclick="ReportCenter.exportExcel()"><i data-lucide="file-spreadsheet"></i> Export Excel</button>
              <button class="btn btn-outline" onclick="ReportCenter.resetFilters()"><i data-lucide="rotate-ccw"></i> Reset</button>
            </div>
          </div>
        </div>
        <div id="rc-preview-area"></div>
      </div>
    `);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  getReportCategories() {
    return [
      { id: 'student-card', label: 'A. Student Reports', sub: ['Student Report Card', 'Student Academic Report'] },
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

  updateFilterVisibility() {
    const type = this.state.reportType;
    const show = (id, v) => { const el = document.getElementById(id); if (el) el.style.display = v ? '' : 'none'; };
    const typeMap = {
      'student-card': ['rc-student-group', 'rc-class-group', 'rc-subject-group'],
      'exam-class-summary': ['rc-class-group', 'rc-assessment-group'],
      'subject-performance': ['rc-class-group', 'rc-subject-group', 'rc-teacher-group', 'rc-assessment-group'],
      'class-performance': ['rc-class-group'],
      'missing-marks': ['rc-class-group'],
      'school-performance': [],
      'teacher-performance': [],
      'grade-distribution': ['rc-class-group']
    };
    const allGroups = ['rc-class-group', 'rc-subject-group', 'rc-teacher-group', 'rc-assessment-group', 'rc-student-group'];
    const visible = typeMap[type] || [];
    allGroups.forEach(g => show(g, visible.includes(g)));
  },

  async generate() {
    this.state.loading = true;
    const previewArea = document.getElementById('rc-preview-area');
    if (!previewArea) return;
    previewArea.innerHTML = Utils.loading();

    try {
      const config = {
        reportType: this.state.reportType,
        academicYear: this.state.academicYear || undefined,
        term: this.state.term || undefined,
        classId: this.state.classId || undefined,
        subjectId: this.state.subjectId || undefined,
        teacherId: this.state.teacherId || undefined,
        assessmentId: this.state.assessmentId || undefined,
        studentId: this.state.studentId || undefined
      };

const data = await ReportEngine.generate(config);
      const typeMap = {
        'student-card': 'studentCard', 'exam-class-summary': 'examClassSummary',
        'subject-performance': 'subjectPerformance', 'class-performance': 'classPerformance',
        'missing-marks': 'missingMarks', 'school-performance': 'schoolPerformance',
        'teacher-performance': 'teacherPerformance', 'grade-distribution': 'gradeDistribution'
      };
      const templateFn = ReportTemplates[typeMap[data.type]];
      const html = templateFn ? templateFn(data) : '<p>Report template not found</p>';
      previewArea.innerHTML = `<div id="rc-report-container">${html}</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (e) {
      previewArea.innerHTML = Utils.errorCard('Report Generation Error', e.message || 'Failed to generate report.');
    }
    this.state.loading = false;
  },

  async preview() {
    await this.generate();
  },

  print() {
    const container = document.getElementById('rc-report-container');
    if (!container) { Utils.toast('Generate a report first', 'error'); return; }
    const w = window.open('', '_blank');
    if (!w) { Utils.toast('Allow pop-ups to print', 'error'); return; }
    const css = `<link rel="stylesheet" href="${new URL('css/styles.css', window.location.href).href}"><link rel="stylesheet" href="${new URL('css/report-card.css', window.location.href).href}"><style>@media print{body *{visibility:hidden}#rc-report-container,.rms-report-header,.rms-report-footer,.rms-report-title{visibility:visible}#rc-report-container{position:absolute;left:0;top:0;width:100%}table{page-break-inside:avoid}tr{page-break-inside:avoid}thead{display:table-header-group}.rms-page-break{page-break-after:always}}</style>`;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Report Print</title>${css}</head><body class="printable-report">${container.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 500);
  },

  async exportExcel() {
    if (typeof XLSX === 'undefined') { Utils.toast('Excel library not loaded', 'error'); return; }
    const container = document.getElementById('rc-report-container');
    if (!container) { Utils.toast('Generate a report first', 'error'); return; }
    const ws = XLSX.utils.table_to_sheet(container.querySelector('table'));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    XLSX.writeFile(wb, `RMS-MIS_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
    Utils.toast('Report exported to Excel', 'success');
  },

  resetFilters() {
    this.state = { reportType: 'student-card', academicYear: '', term: '', classId: '', subjectId: '', teacherId: '', assessmentId: '', studentId: '', loading: false, previewHtml: '' };
    this.render();
  }
};

function renderReportCenter() {
  ReportCenter.render();
}

