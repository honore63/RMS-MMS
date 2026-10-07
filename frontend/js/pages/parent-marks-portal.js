const ParentMarksPortal = {
  options: null,
  result: null,
  reportCard: null,
  reportError: '',
  tab: 'overview',
  isOpen: false,
  lookupGeneration: 0,

  init() {
    window.addEventListener('hashchange', () => this.handleHashChange());
  },

  async handleHashChange() {
    const hash = window.location.hash;
    if (hash === '#parent-marks' || hash.startsWith('#parent-marks/')) {
      if (!this.isOpen) {
        await this.open({ fromHash: true });
      } else if (hash === '#parent-marks') {
        this.clearLookup(false);
      } else if (hash === '#parent-marks/results' && !this.result) {
        this.renderSearch();
      }
    } else if (hash === '#login' && this.isOpen) {
      this.close({ fromHash: true });
    } else if (this.isOpen) {
      this.close({ fromHash: true });
    }
  },

  async open(options = {}) {
    this.clearLookup(false);
    this.isOpen = true;
    const loginPage = document.getElementById('login-page');
    const appLayout = document.getElementById('app-layout');
    if (loginPage) loginPage.style.display = 'flex';
    if (appLayout) appLayout.style.display = 'none';
    const signIn = document.getElementById('login-signin-view');
    const schoolInfo = document.querySelector('.login-school-info');
    const view = document.getElementById('parent-marks-view');
    if (signIn) signIn.style.display = 'none';
    if (schoolInfo) schoolInfo.style.display = 'none';
    if (view) view.style.display = 'block';
    if (!options.fromHash && window.location.hash !== '#parent-marks') {
      window.location.hash = 'parent-marks';
    }
    this.renderSearch();
    await this.loadOptions();
  },

  close(options = {}) {
    this.clearLookup(false);
    this.isOpen = false;
    if (document.body.dataset.page === 'parent-marks') {
      window.location.href = 'index.html';
      return;
    }
    const view = document.getElementById('parent-marks-view');
    const signIn = document.getElementById('login-signin-view');
    const schoolInfo = document.querySelector('.login-school-info');
    if (view) view.style.display = 'none';
    if (typeof Auth !== 'undefined' && Auth.currentUser) {
      const loginPage = document.getElementById('login-page');
      const appLayout = document.getElementById('app-layout');
      if (loginPage) loginPage.style.display = 'none';
      if (appLayout) appLayout.style.display = 'flex';
      if (typeof Router !== 'undefined') Router.render();
    } else {
      if (signIn) signIn.style.display = '';
      if (schoolInfo) schoolInfo.style.display = '';
    }
    if (!options.fromHash && window.location.hash.startsWith('#parent-marks')) {
      window.location.hash = 'login';
    }
  },

  async loadOptions() {
    const root = document.getElementById('parent-marks-view');
    if (!root || !this.isOpen) return;
    if (this.options) {
      this.renderSearch();
      return;
    }
    this.renderMessage('Loading available classes and reporting periods...', 'loading');
    try {
      const { data, error } = await sbClient.rpc('student_marks_portal_options');
      if (error) throw error;
      if (!data || !Array.isArray(data.classes) || !Array.isArray(data.years) || !Array.isArray(data.terms)) {
        throw new Error('The portal options response was incomplete.');
      }
      this.options = data;
      if (this.isOpen) this.renderSearch();
    } catch (error) {
      console.error('[ParentMarksPortal] Failed to load portal options:', error);
      this.renderMessage('The marks portal is temporarily unavailable. Please try again later or contact the school.', 'error', true);
    }
  },

  renderMessage(message, kind, includeRetry = false) {
    const root = document.getElementById('parent-marks-view');
    if (!root) return;
    root.innerHTML = `
      <button type="button" class="pmp-back-link" onclick="ParentMarksPortal.close()"><i data-lucide="arrow-left"></i> Staff sign in</button>
      <div class="pmp-message ${kind === 'error' ? 'is-error' : ''}" role="${kind === 'error' ? 'alert' : 'status'}">
        ${kind === 'loading' ? '<span class="spinner" aria-hidden="true"></span>' : '<i data-lucide="' + (kind === 'error' ? 'circle-alert' : 'info') + '" aria-hidden="true"></i>'}
        <span>${Utils.escapeHtml(message)}</span>
      </div>
      ${includeRetry ? '<button type="button" class="btn btn-outline pmp-retry" onclick="ParentMarksPortal.loadOptions()">Try Again</button>' : ''}`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  defaultYear() {
    const years = this.options?.years || [];
    return years.find(year => year.is_current) ||
      years.find(year => year.status === 'active') ||
      years.find(year => year.status === 'upcoming') ||
      years[0] || null;
  },

  termsForYear(yearId) {
    return (this.options?.terms || [])
      .filter(term => String(term.academic_year_id) === String(yearId))
      .sort((a, b) => Number(a.term_no || 0) - Number(b.term_no || 0) || String(a.name).localeCompare(String(b.name)));
  },

  renderSearch(selectedYearId = null, preserve = {}) {
    const root = document.getElementById('parent-marks-view');
    if (!root || !this.isOpen) return;
    const year = (this.options?.years || []).find(item => String(item.id) === String(selectedYearId)) || this.defaultYear();
    const terms = year ? this.termsForYear(year.id) : [];
    const activeTerm = terms.find(term => term.is_active);
    const classes = this.options?.classes || [];
    const years = this.options?.years || [];

    root.innerHTML = `
      <div class="pmp-heading">
        <button type="button" class="pmp-back-link" onclick="ParentMarksPortal.close()"><i data-lucide="arrow-left"></i> Staff sign in</button>
        <div class="pmp-brand-mark"><i data-lucide="users-round"></i></div>
        <h2>Parent / Student Marks</h2>
        <p>Check one student's results using the class and student code provided by the school.</p>
      </div>
      <div class="pmp-search-card">
        <form id="pmp-search-form" novalidate>
          <div class="pmp-form-grid">
            <div class="form-group">
              <label for="pmp-class">Class</label>
              <select id="pmp-class" class="input-field" required>
                <option value="">Select class</option>
                ${classes.map(item => `<option value="${Utils.escapeHtml(item.id)}" ${String(item.id) === String(preserve.classId || '') ? 'selected' : ''}>${this.safe(this.classLabel(item.name, item.stream))}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="pmp-learner-code">Student Code</label>
              <input id="pmp-learner-code" class="input-field" type="text" autocomplete="off" autocapitalize="characters"
                spellcheck="false" maxlength="80" required value="${Utils.escapeHtml(preserve.learnerCode || '')}" placeholder="Enter the student's code">
            </div>
            <div class="form-group">
              <label for="pmp-year">Academic Year</label>
              <select id="pmp-year" class="input-field" required ${years.length ? '' : 'disabled'}>
                ${years.map(item => `<option value="${Utils.escapeHtml(item.id)}" ${year && String(item.id) === String(year.id) ? 'selected' : ''}>${Utils.escapeHtml(item.name)}${item.is_current ? ' (Current)' : ''}</option>`).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="pmp-term">Term</label>
              <select id="pmp-term" class="input-field" ${terms.length ? '' : 'disabled'}>
                <option value="">All terms</option>
                ${terms.map(item => `<option value="${Utils.escapeHtml(item.id)}" ${preserve.termId ? String(item.id) === String(preserve.termId) ? 'selected' : '' : activeTerm && String(item.id) === String(activeTerm.id) ? 'selected' : ''}>${Utils.escapeHtml(item.name)}${item.is_active ? ' (Current)' : ''}</option>`).join('')}
              </select>
            </div>
          </div>
          <div id="pmp-search-error" class="pmp-inline-error" role="alert" style="display:none"></div>
          <button id="pmp-search-button" class="btn btn-primary btn-full pmp-search-button" type="submit">
            <i data-lucide="search"></i> Check Marks
          </button>
        </form>
        <p class="pmp-privacy-note"><i data-lucide="shield-check"></i> Results are retrieved for one verified student only.</p>
      </div>`;

    document.getElementById('pmp-year')?.addEventListener('change', event => {
      const preserve = {
        classId: document.getElementById('pmp-class')?.value,
        learnerCode: document.getElementById('pmp-learner-code')?.value,
        termId: null
      };
      this.renderSearch(event.target.value, preserve);
    });
    document.getElementById('pmp-search-form')?.addEventListener('submit', event => this.checkMarks(event));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async checkMarks(event) {
    event.preventDefault();
    const classId = document.getElementById('pmp-class')?.value;
    const learnerCode = document.getElementById('pmp-learner-code')?.value?.trim();
    const yearId = document.getElementById('pmp-year')?.value;
    const termId = document.getElementById('pmp-term')?.value || null;
    const errorEl = document.getElementById('pmp-search-error');
    const button = document.getElementById('pmp-search-button');
    if (!classId || !learnerCode || !yearId) {
      if (errorEl) {
        errorEl.textContent = 'Select a class and academic year, then enter the student code.';
        errorEl.style.display = 'block';
      }
      return;
    }

    if (errorEl) errorEl.style.display = 'none';
    const requestId = ++this.lookupGeneration;
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner" aria-hidden="true"></span> Checking student records...';
    }
    try {
      const { data, error } = await sbClient.rpc('get_student_marks_portal', {
        p_class_id: classId,
        p_learner_code: learnerCode,
        p_academic_year_id: yearId,
        p_term_id: termId
      });
      if (error) throw error;
      if (requestId !== this.lookupGeneration || !this.isOpen) return;
      if (!data || !data.student || !Array.isArray(data.subjects) || !Array.isArray(data.assessments)) {
        this.showNotFound();
        return;
      }
      this.result = data;
      this.reportCard = null;
      this.reportError = '';
      this.tab = 'overview';
      if (window.location.hash !== '#parent-marks/results') {
        window.location.hash = 'parent-marks/results';
      }
      this.renderDashboard();
    } catch (error) {
      console.error('[ParentMarksPortal] Student lookup failed:', {
        message: error?.message || String(error),
        details: error?.details || '',
        hint: error?.hint || '',
        code: error?.code || '',
        status: error?.status || ''
      });
      if (requestId === this.lookupGeneration && errorEl) {
        errorEl.textContent = 'We could not check the records right now. Please try again later.';
        errorEl.style.display = 'block';
      }
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.innerHTML = '<i data-lucide="search"></i> Check Marks';
        if (typeof lucide !== 'undefined') lucide.createIcons();
      }
    }
  },

  showNotFound() {
    const errorEl = document.getElementById('pmp-search-error');
    if (errorEl) {
      errorEl.textContent = 'Student not found. Please check the class and student code and try again.';
      errorEl.style.display = 'block';
    }
  },

  clearLookup(updateHash = true) {
    this.lookupGeneration += 1;
    this.result = null;
    this.reportCard = null;
    this.reportError = '';
    this.tab = 'overview';
    if (typeof ReportWizard !== 'undefined' && ReportWizard.state) {
      ReportWizard.state.previewHtml = '';
      ReportWizard.state.previewFilename = '';
    }
    if (updateHash && window.location.hash !== '#parent-marks') {
      window.location.hash = 'parent-marks';
      return;
    }
    if (this.isOpen) this.renderSearch();
  },

  async setTab(tab) {
    if (!this.result) return;
    this.tab = tab;
    this.reportCard = null;
    this.reportError = '';
    this.renderDashboard();
    if (tab !== 'report') return;

    const result = this.result;
    try {
      const card = await ReportStudent.buildPortalCard(result);
      if (this.result !== result || this.tab !== 'report') return;
      this.reportCard = card;
    } catch (error) {
      if (this.result !== result || this.tab !== 'report') return;
      this.reportError = error.message || 'Unable to build the student report.';
    }
    this.renderDashboard();
  },

  money(value) {
    return value == null || value === '' ? '—' : Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 });
  },

  percentage(value) {
    return value == null || !Number.isFinite(Number(value)) ? '—' : `${Number(value).toFixed(1)}%`;
  },

  safe(value) {
    return Utils.escapeHtml(value == null ? '' : String(value));
  },

  classLabel(name, stream) {
    const className = String(name || '').trim();
    const streamName = String(stream || '').trim();
    if (!className || !streamName) return className;
    const normalizedClass = className.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const normalizedStream = streamName.replace(/[^a-z0-9]/gi, '').toLowerCase();
    return normalizedStream && normalizedClass.endsWith(normalizedStream)
      ? className
      : `${className} - ${streamName}`;
  },

  renderDashboard() {
    const root = document.getElementById('parent-marks-view');
    const data = this.result;
    if (!root || !data) {
      this.renderSearch();
      return;
    }
    const student = data.student;
    const summary = data.summary || {};
    const position = data.position;
    const tabs = [
      ['overview', 'Overview', 'layout-dashboard'],
      ['marks', 'All Marks', 'list-checks'],
      ['subjects', 'Subjects', 'book-open'],
      ['assessments', 'Assessments', 'clipboard-list'],
      ['report', 'Student Report', 'file-badge']
    ];
    root.innerHTML = `
      <div class="pmp-results-head">
        <div>
          <p class="pmp-eyebrow">${this.safe(data.settings?.school_name || 'Rukara Model School')}</p>
          <h2>Student Performance</h2>
          <p class="pmp-period">${this.safe(data.academic_year?.name || '')} · ${this.safe(data.term?.name || '')}</p>
        </div>
        <button type="button" class="btn btn-outline pmp-another" onclick="ParentMarksPortal.clearLookup()"><i data-lucide="user-round-plus"></i> Check Another Student</button>
      </div>
      <section class="pmp-student-card" aria-label="Verified student summary">
        <div class="pmp-student-icon"><i data-lucide="graduation-cap"></i></div>
        <div class="pmp-student-details">
          <h3>${this.safe(student.name)}</h3>
          <p>${this.safe(this.classLabel(student.class_name, student.stream))} · Code ${this.safe(student.code)}</p>
        </div>
        <div class="pmp-position">
          <span>Class Position</span>
          <strong>${position?.position != null ? `${position.position} / ${position.out_of}` : 'Not available'}</strong>
        </div>
      </section>
      <nav class="pmp-tabs" aria-label="Student results">
        ${tabs.map(([id, label, icon]) => `<button type="button" class="pmp-tab ${this.tab === id ? 'is-active' : ''}" aria-current="${this.tab === id ? 'page' : 'false'}" onclick="ParentMarksPortal.setTab('${id}')"><i data-lucide="${icon}"></i><span>${label}</span></button>`).join('')}
      </nav>
      <div class="pmp-tab-content">${this.renderTabContent()}</div>`;
    this.bindFilters('pmp-marks', 'pmp-marks-list');
    this.bindFilters('pmp-assess', 'pmp-assess-list');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  bindFilters(prefix, targetId) {
    const update = () => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.innerHTML = this.assessmentTable(this.filteredAssessments(prefix));
      if (typeof lucide !== 'undefined') lucide.createIcons();
    };
    ['subject', 'type', 'term'].forEach(name => {
      document.getElementById(`${prefix}-${name}`)?.addEventListener('change', update);
    });
  },

  renderTabContent() {
    if (!this.result) return '';
    switch (this.tab) {
      case 'marks': return this.renderMarks();
      case 'subjects': return this.renderSubjects();
      case 'assessments': return this.renderAssessments();
      case 'report': return this.renderReport();
      default: return this.renderOverview();
    }
  },

  renderOverview() {
    const data = this.result;
    const s = data.summary || {};
    const subjectRows = (data.subjects || []).map(subject => `
      <tr>
        <td>${this.safe(subject.name)}</td>
        <td>${this.money(subject.maximum_marks)}</td>
        <td>${this.money(subject.marks_obtained)}</td>
        <td>${this.percentage(subject.percentage)}</td>
        <td>${this.safe(subject.grade || '—')}</td>
        <td><span class="pmp-status ${String(subject.status).toLowerCase()}">${this.safe(subject.status)}</span></td>
      </tr>`).join('');
    return `
      <div class="pmp-stat-grid">
        ${this.stat('Average', this.percentage(s.average_percentage), 'chart-no-axes-combined')}
        ${this.stat('Subjects', `${s.total_subjects || 0}`, 'book-open')}
        ${this.stat('Assessments', `${s.assessment_count || 0}`, 'clipboard-list')}
        ${this.stat('Pass Rate', this.percentage(s.pass_rate), 'badge-check')}
        ${this.stat('Overall Status', s.pass_status || 'INCOMPLETE', 'circle-check')}
      </div>
      <section class="pmp-section">
        <div class="pmp-section-heading"><div><h3>Subject Summary</h3><p>Marks are shown against the configured maximum.</p></div></div>
        ${subjectRows ? `<div class="pmp-table-wrap"><table class="pmp-table"><thead><tr><th>Subject</th><th>Maximum</th><th>Obtained</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${subjectRows}</tbody></table></div>` : this.empty('No subjects are available for this reporting period.')}
      </section>
      ${!data.assessments.length ? this.empty('No published marks are available for this reporting period.') : ''}
    `;
  },

  stat(label, value, icon) {
    return `<div class="pmp-stat"><span class="pmp-stat-icon"><i data-lucide="${icon}"></i></span><span class="pmp-stat-label">${this.safe(label)}</span><strong>${this.safe(value)}</strong></div>`;
  },

  empty(message) {
    return `<div class="pmp-empty"><i data-lucide="clipboard-x"></i><p>${this.safe(message)}</p></div>`;
  },

  filterControls(prefix) {
    const data = this.result;
    const subjects = [...new Set(data.assessments.map(item => item.subject).filter(Boolean))].sort();
    const types = [...new Set(data.assessments.map(item => item.type).filter(Boolean))].sort();
    const terms = [...new Set(data.assessments.map(item => item.term).filter(Boolean))].sort();
    return `
      <div class="pmp-filters">
        <label>Subject <select id="${prefix}-subject"><option value="">All subjects</option>${subjects.map(x => `<option value="${this.safe(x)}">${this.safe(x)}</option>`).join('')}</select></label>
        <label>Assessment type <select id="${prefix}-type"><option value="">All types</option>${types.map(x => `<option value="${this.safe(x)}">${this.safe(x)}</option>`).join('')}</select></label>
        <label>Term <select id="${prefix}-term"><option value="">All terms</option>${terms.map(x => `<option value="${this.safe(x)}">${this.safe(x)}</option>`).join('')}</select></label>
      </div>`;
  },

  filteredAssessments(prefix) {
    const subject = document.getElementById(`${prefix}-subject`)?.value || '';
    const type = document.getElementById(`${prefix}-type`)?.value || '';
    const term = document.getElementById(`${prefix}-term`)?.value || '';
    return (this.result?.assessments || []).filter(item =>
      (!subject || item.subject === subject) &&
      (!type || item.type === type) &&
      (!term || item.term === term));
  },

  assessmentTable(items) {
    if (!items.length) return this.empty('No assessments match the selected filters.');
    const rows = items.map(item => `<tr>
      <td>${this.safe(item.subject)}</td>
      <td>${this.safe(item.assessment)}</td>
      <td>${this.safe(item.type)}</td>
      <td>${this.safe(item.term || '')}</td>
      <td>${this.money(item.maximum_mark)}</td>
      <td>${this.money(item.mark)}</td>
      <td>${this.percentage(item.percentage)}</td>
      <td>${this.safe(item.grade || '—')}</td>
      <td><span class="pmp-status ${String(item.status).toLowerCase()}">${this.safe(item.status)}</span></td>
    </tr>`).join('');
    return `<div class="pmp-table-wrap pmp-assessment-table-wrap"><table class="pmp-table pmp-assessment-table"><thead><tr><th>Subject</th><th>Assessment</th><th>Type</th><th>Term</th><th>Max</th><th>Mark</th><th>%</th><th>Grade</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="pmp-mobile-assessments">${items.map(item => `<article class="pmp-assessment-card">
        <h4>${this.safe(item.subject)} · ${this.safe(item.assessment)}</h4>
        <p>${this.safe(item.type)}${item.term ? ' · ' + this.safe(item.term) : ''}</p>
        <div><span>Mark</span><b>${this.money(item.mark)} / ${this.money(item.maximum_mark)}</b></div>
        <div><span>Percentage</span><b>${this.percentage(item.percentage)}</b></div>
        <div><span>Grade / Status</span><b>${this.safe(item.grade || '—')} · ${this.safe(item.status)}</b></div>
      </article>`).join('')}</div>`;
  },

  renderMarks() {
    return `<section class="pmp-section"><div class="pmp-section-heading"><div><h3>All Marks</h3><p>Every assessment shown belongs to this verified student.</p></div></div>
      ${this.filterControls('pmp-marks')}
      <div id="pmp-marks-list">${this.assessmentTable(this.result.assessments || [])}</div>
    </section>`;
  },

  renderAssessments() {
    return `<section class="pmp-section"><div class="pmp-section-heading"><div><h3>Assessments</h3><p>Assessment details for the selected academic period.</p></div></div>
      ${this.filterControls('pmp-assess')}
      <div id="pmp-assess-list">${this.assessmentTable(this.result.assessments || [])}</div>
    </section>`;
  },

  renderSubjects() {
    const subjects = this.result.subjects || [];
    if (!subjects.length) return this.empty('No subjects are available for this reporting period.');
    return `<section class="pmp-subject-grid">${subjects.map(subject => {
      const assessments = (this.result.assessments || []).filter(item =>
        subject.code ? item.subject_code === subject.code : item.subject === subject.name);
      return `<details class="pmp-subject-card">
        <summary>
          <span><strong>${this.safe(subject.name)}</strong><small>${subject.assessment_count || 0} assessment(s) · ${this.safe(subject.status)}</small></span>
          <span class="pmp-subject-score">${this.percentage(subject.percentage)}<small>${this.safe(subject.grade || '—')}</small></span>
        </summary>
        <div class="pmp-subject-body"><p>Marks obtained: <strong>${this.money(subject.marks_obtained)} / ${this.money(subject.maximum_marks)}</strong></p>
          ${assessments.length ? this.assessmentTable(assessments) : '<p class="text-muted">No assessments for this subject.</p>'}
          ${subject.remark ? `<p class="pmp-remark">${this.safe(subject.remark)}</p>` : ''}
        </div>
      </details>`;
    }).join('')}</section>`;
  },

  renderReport() {
    if (typeof ReportStudent === 'undefined' || typeof ReportWizard === 'undefined') {
      return this.empty('The student report is unavailable. Please contact the school.');
    }
    if (this.reportError) return this.empty(`The student report could not be generated: ${this.reportError}`);
    if (!this.reportCard) return '<div class="pmp-message" role="status"><span class="spinner" aria-hidden="true"></span><span>Preparing the official report card...</span></div>';
    const html = ReportStudent.renderCard(this.reportCard);
    const orientation = 'portrait';
    ReportWizard.state.previewHtml = html;
    ReportWizard.state.previewOrientation = orientation;
    ReportWizard.state.previewConfig = '';
    const safePart = value => String(value || '').replace(/[^a-z0-9_-]/gi, '_');
    ReportWizard.state.previewFilename = `RMS-MIS_Student_Report_${safePart(this.result.student.code || 'RMS')}_${safePart(this.result.academic_year?.name || '')}_${safePart(this.result.term?.name || 'All_Terms')}.pdf`;
    return `<section class="pmp-section pmp-report-section">
      <div class="pmp-section-heading"><div><h3>Official Student Report</h3><p>Single-student report card for ${this.safe(this.result.student.name)}.</p></div>
      <div class="pmp-report-actions">
        ${typeof ReportCenter !== 'undefined' ? '<button type="button" class="btn btn-outline" onclick="ParentMarksPortal.previewReport()"><i data-lucide="external-link"></i> Full Preview</button>' : ''}
        <button type="button" class="btn btn-outline" onclick="ReportWizard.print()"><i data-lucide="printer"></i> Print</button>
        <button type="button" class="btn btn-primary" onclick="ReportWizard.downloadPDF()"><i data-lucide="file-down"></i> Download PDF</button>
      </div></div>
      <div class="pmp-report-preview rms-full-report-preview">${html}</div>
    </section>`;
  },

  previewReport() {
    if (typeof ReportCenter === 'undefined') {
      Utils.toast('The report preview service is unavailable. Please reload the portal and try again.', 'error');
      return;
    }
    if (!this.result || !ReportWizard.state.previewHtml) {
      Utils.toast('Generate the student report before opening its full preview.', 'error');
      return;
    }
    const data = this.result;
    const className = this.classLabel(data.student.class_name, data.student.stream);
    const title = `RMS-MIS Student Report — ${data.student.name} — ${className}`;
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
      Utils.toast('Allow pop-ups to open the complete report preview in a new tab.', 'error');
      return;
    }
    ReportCenter.openPreviewDocument(
      ReportWizard.state.previewHtml,
      title,
      ReportWizard.state.previewOrientation || 'portrait',
      ReportWizard.state.previewFilename,
      previewWindow
    );
  }
};

ParentMarksPortal.init();
if (document.body.dataset.page === 'parent-marks') {
  ParentMarksPortal.open({ fromHash: true });
}
