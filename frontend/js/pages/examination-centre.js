const ExaminationCentre = {
  activeAttempt: null,
  timer: null,
  busy: false,
  guestIdentity: null,
  guestExams: [],
  guestClassSearched: false,
  pendingReview: null,
  pendingReviewTitle: '',
  mathLoaderPromise: null,
  pendingGuestResult: null,

  ensureMathJax() {
    if (window.MathJax?.typesetPromise) return Promise.resolve();
    if (this.mathLoaderPromise) return this.mathLoaderPromise;
    window.MathJax = {
      tex: {
        inlineMath: [['\\(', '\\)']],
        displayMath: [['\\[', '\\]'], ['$$', '$$']],
        processEscapes: true
      },
      svg: { fontCache: 'local' },
      options: { skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'] },
      startup: { typeset: false }
    };
    this.mathLoaderPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js';
      script.async = true;
      script.onload = resolve;
      script.onerror = () => {
        this.mathLoaderPromise = null;
        reject(new Error('The math rendering library could not be loaded.'));
      };
      document.head.appendChild(script);
    });
    return this.mathLoaderPromise;
  },

  async typesetMath(root) {
    if (!root || !/(\\\(|\\\[|\$\$)/.test(root.textContent || '')) return;
    try {
      await this.ensureMathJax();
      window.MathJax.typesetClear?.([root]);
      await window.MathJax.typesetPromise([root]);
    } catch (error) {
      console.warn('[ExaminationCentre] Math formula rendering unavailable:', error);
    }
  },

  insertMathSnippet(targetId, snippet) {
    const input = document.getElementById(targetId);
    if (!input) return;
    const start = input.selectionStart ?? input.value.length;
    const end = input.selectionEnd ?? start;
    input.setRangeText(snippet, start, end, 'select');
    const placeholder = snippet.indexOf('{}');
    if (placeholder >= 0) {
      input.setSelectionRange(start + placeholder + 1, start + placeholder + 1);
    }
    input.focus();
    input.dispatchEvent(new Event('input', { bubbles: true }));
  },

  mathToolbar(targetId) {
    const snippets = [
      ['√', String.raw`\(\sqrt{}\)`],
      ['a/b', String.raw`\(\frac{}{}\)`],
      ['xⁿ', String.raw`\(x^{}\)`],
      ['xₙ', String.raw`\(x_{}\)`],
      ['π', String.raw`\(\pi\)`],
      ['±', String.raw`\(\pm\)`],
      ['×', String.raw`\(\times\)`],
      ['÷', String.raw`\(\div\)`],
      ['≠', String.raw`\(\neq\)`],
      ['≈', String.raw`\(\approx\)`],
      ['≤', String.raw`\(\leq\)`],
      ['∞', String.raw`\(\infty\)`],
      ['∑', String.raw`\(\sum\)`],
      ['∫', String.raw`\(\int\)`],
      ['∠', String.raw`\(\angle\)`],
      ['θ', String.raw`\(\theta\)`]
    ];
    return `<div class="ec-math-tools"><span>Insert formula:</span>${snippets.map(([label, snippet]) =>
      `<button type="button" class="btn btn-sm btn-outline" data-math-target="${targetId}" data-math-snippet="${Utils.escapeHtml(snippet)}" title="Insert ${Utils.escapeHtml(label)}">${label}</button>`
    ).join('')}<small>Wrap formulas in \\( ... \\), or use $$ ... $$ for a centered formula.</small></div>`;
  },

  bindMathTools(root = document) {
    root.querySelectorAll('[data-math-snippet]').forEach(button => {
      if (button.dataset.mathBound) return;
      button.dataset.mathBound = 'true';
      button.addEventListener('click', () =>
        this.insertMathSnippet(button.dataset.mathTarget, button.dataset.mathSnippet));
    });
  },

  updateMathPreview(inputId, previewId) {
    const input = document.getElementById(inputId);
    const preview = document.getElementById(previewId);
    if (!input || !preview) return;
    preview.textContent = input.value || 'Formula preview will appear here.';
    this.typesetMath(preview);
  },

  async renderTeacher() {
    if (!Auth.isTeacher()) return Utils.toast('Teacher access is required.', 'error');
    setHeader('Examination Centre', 'Create secure online examinations and review learner results.');
    setContent(Utils.loading());
    try {
      const [exams, classes, subjects, types, years, terms, questions, attempts, examClasses] = await Promise.all([
        DB.getFresh('examinations'),
        DB.get('classes'),
        DB.get('subjects'),
        getAssessmentTypes(),
        DB.get('academic_years'),
        DB.get('terms'),
        DB.getFresh('exam_questions'),
        DB.getFresh('exam_attempts'),
        DB.getFresh('examination_classes')
      ]);
      this.renderDashboard({ exams, classes, subjects, types, years, terms, questions, attempts, examClasses, readOnly: false });
    } catch (error) {
      console.error('[ExaminationCentre] Teacher dashboard failed:', error);
      setContent(this.errorHtml(error));
    }
  },

  async onOnline() {
    await this.syncPending();
    const attempt = this.activeAttempt;
    if (attempt?.autoSubmitTried) {
      attempt.autoSubmitTried = false;
      this.updateTimer();
    }
  },

  async renderDos() {
    if (!Auth.isAdmin()) return Utils.toast('DOS access is required.', 'error');
    setHeader('Examination Centre', 'View examinations and results within your education-level scope.');
    setContent(Utils.loading());
    try {
      const [exams, classes, subjects, teachers, types, years, terms, questions, attempts, learners, examClasses] = await Promise.all([
        DB.getFresh('examinations'),
        DB.get('classes'),
        DB.get('subjects'),
        DB.get('teachers'),
        getAssessmentTypes(),
        DB.get('academic_years'),
        DB.get('terms'),
        DB.getFresh('exam_questions'),
        DB.getFresh('exam_attempts'),
        DB.get('learners'),
        DB.getFresh('examination_classes')
      ]);
      this.renderDashboard({ exams, classes, subjects, teachers, types, years, terms, questions, attempts, learners, examClasses, readOnly: true });
    } catch (error) {
      console.error('[ExaminationCentre] DOS dashboard failed:', error);
      setContent(this.errorHtml(error));
    }
  },

  renderDashboard(data) {
    const classes = new Map(data.classes.map(row => [String(row.id), row.name]));
    const subjects = new Map(data.subjects.map(row => [String(row.id), row.name]));
    const teachers = new Map((data.teachers || []).map(row => [String(row.id), row.full_name]));
    const rows = [...data.exams].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
    const cards = rows.map(exam => {
      const own = !data.readOnly && String(exam.teacher_id) === String(Auth.getTeacherId());
      const examClassIds = (data.examClasses || [])
        .filter(row => String(row.exam_id) === String(exam.id))
        .map(row => String(row.class_id));
      if (!examClassIds.length) examClassIds.push(String(exam.class_id));
      const examClassNames = examClassIds.map(id => classes.get(id)).filter(Boolean);
      const qCount = data.questions.filter(q => String(q.exam_id) === String(exam.id)).length;
      const attempts = data.attempts.filter(a => String(a.exam_id) === String(exam.id));
      const actions = [
        `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.manage('${exam.id}')"><i data-lucide="${data.readOnly ? 'eye' : 'list-plus'}"></i> ${data.readOnly ? 'View' : 'Questions & Results'}</button>`,
        own && exam.status !== 'archived' ? `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.edit('${exam.id}')"><i data-lucide="edit-3"></i> Edit</button>` : '',
        own ? `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.duplicateExam('${exam.id}')"><i data-lucide="copy"></i> Copy assessment</button>` : '',
        own && exam.status === 'draft' ? `<button class="btn btn-sm btn-primary" onclick="ExaminationCentre.changeStatus('${exam.id}','published')"><i data-lucide="send"></i> Publish</button>` : '',
        own && exam.status === 'published' ? `<button class="btn btn-sm btn-primary" onclick="ExaminationCentre.changeStatus('${exam.id}','open')"><i data-lucide="play"></i> Open</button>` : '',
        own && exam.status === 'open' ? `<button class="btn btn-sm btn-warning" onclick="ExaminationCentre.changeStatus('${exam.id}','closed')"><i data-lucide="square"></i> Close</button>` : '',
        own && exam.status === 'closed' ? `<button class="btn btn-sm btn-primary" onclick="ExaminationCentre.changeStatus('${exam.id}','open')" ${exam.results_released_at ? 'disabled title="Released assessments cannot be reopened."' : ''}><i data-lucide="rotate-ccw"></i> Reopen</button>${exam.results_released_at ? '<span class="badge badge-success">Results released</span>' : `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.releaseResults('${exam.id}')"><i data-lucide="unlock"></i> Release results</button>`}<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.changeStatus('${exam.id}','archived')"><i data-lucide="archive"></i> Archive</button>` : '',
        own ? `<button class="btn btn-sm btn-danger" onclick="ExaminationCentre.deleteExam('${exam.id}')"><i data-lucide="trash-2"></i> Delete</button>` : ''
      ].filter(Boolean).join('');
      const yearName = (data.years.find(y => String(y.id) === String(exam.academic_year_id)) || {}).name || '';
      const termName = exam.term_id
        ? (data.terms.find(t => String(t.id) === String(exam.term_id)) || {}).name || ''
        : '';
      const period = [yearName, termName].filter(Boolean).join(' · ');
      const teacherName = data.readOnly ? teachers.get(String(exam.teacher_id)) : '';
      return `<article class="ec-exam-card ec-exam-card-manage">
        <div class="ec-exam-top">
          <span class="badge ${this.statusClass(exam.status)} ec-exam-status-${Utils.escapeHtml(exam.status)}"><span class="ec-exam-status-dot" aria-hidden="true"></span>${Utils.escapeHtml(exam.status)}</span>
          <span class="ec-exam-count"><i data-lucide="list-checks" aria-hidden="true"></i>${qCount} question${qCount === 1 ? '' : 's'}<span aria-hidden="true">·</span>${attempts.length} attempt${attempts.length === 1 ? '' : 's'}</span>
        </div>
        <h3>${Utils.escapeHtml(exam.title)}</h3>
        <p class="ec-exam-subject">${Utils.escapeHtml(subjects.get(String(exam.subject_id)) || 'Subject')}</p>
        <div class="ec-exam-details">
          <span><i data-lucide="users-round" aria-hidden="true"></i>${Utils.escapeHtml(examClassNames.join(', ') || 'Class')}</span>
          ${period ? `<span><i data-lucide="calendar-days" aria-hidden="true"></i>${Utils.escapeHtml(period)}</span>` : ''}
          ${teacherName ? `<span><i data-lucide="user-round" aria-hidden="true"></i>${Utils.escapeHtml(teacherName)}</span>` : ''}
        </div>
        <div class="ec-exam-actions">${actions}</div>
      </article>`;
    }).join('');
    const createButton = data.readOnly ? '' : `<button class="btn btn-primary" onclick="ExaminationCentre.edit()"><i data-lucide="plus"></i> Create Examination</button>`;
    const linkAccounts = data.readOnly ? `<button class="btn btn-outline" onclick="ExaminationCentre.linkLearnerDialog()"><i data-lucide="user-plus"></i> Learner logins</button>` : '';
    setContent(`<section class="ec-page">
      <div class="ec-page-head"><div><h2>Examination Centre</h2><p>Build secure examinations with automatically marked multiple-choice and teacher-marked written questions.</p></div><div class="ec-head-actions">${createButton}${linkAccounts}</div></div>
      <div class="ec-state-legend"><span>Draft: only you can see it</span><span>Published: scheduled/available</span><span>Open: learners can start or continue</span><span>Closed: no new attempts</span></div>
      ${rows.length ? `<div class="ec-exam-grid">${cards}</div>` : `<div class="ec-empty"><i data-lucide="clipboard-x"></i><h3>No examinations yet</h3><p>${data.readOnly ? 'No examinations are available in your scope.' : 'Create an examination to begin.'}</p>${createButton}</div>`}
    </section>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async edit(examId = null) {
    if (!Auth.isTeacher()) return Utils.toast('Teacher access is required.', 'error');
    try {
      const [assignments, classes, subjects, years, terms, types] = await Promise.all([
        DB.query('teacher_assignments', '*', { teacher_id: Auth.getTeacherId() }),
        DB.get('classes'), DB.get('subjects'), DB.get('academic_years'), DB.get('terms'), getAssessmentTypes()
      ]);
      const [exam] = examId ? await DB.getFresh('examinations', { id: examId }) : [null];
      if (exam && String(exam.teacher_id) !== String(Auth.getTeacherId())) throw new Error('You can only edit your own examinations.');
      if (exam && exam.status === 'archived') throw new Error('Archived examinations cannot be edited.');
      const [attempts, examClasses] = exam ? await Promise.all([
        DB.getFresh('exam_attempts', { exam_id: examId }),
        DB.getFresh('examination_classes', { exam_id: examId })
      ]) : [[], []];
      const settingsLocked = attempts.length > 0;
      const locked = settingsLocked ? 'disabled' : '';
      const activeYear = years.find(y => y.is_current || y.status === 'active') || years[0];
      const selectedYear = exam?.academic_year_id || activeYear?.id;
      const assigned = assignments.filter(a => !a.academic_year_id || String(a.academic_year_id) === String(selectedYear));
      const selectedClassIds = examClasses.length ? examClasses.map(row => String(row.class_id)) : exam ? [String(exam.class_id)] : [];
      const selectedSet = new Set(selectedClassIds);
      const classIds = new Set(assigned.map(a => String(a.class_id)));
      const classOptions = classes.filter(c => classIds.has(String(c.id))).map(c =>
        `<label class="ec-check"><input class="ec-class-choice" type="checkbox" value="${c.id}" ${selectedSet.has(String(c.id)) ? 'checked' : ''} onchange="ExaminationCentre.updateSubjects()" ${locked}> ${Utils.escapeHtml(c.name)}</label>`
      ).join('');
      const initiallySelected = selectedClassIds.length ? selectedClassIds : [];
      const subjectIds = new Set(assigned
        .filter(a => initiallySelected.includes(String(a.class_id)))
        .map(a => String(a.subject_id)));
      const commonSubjectIds = new Set([...subjectIds].filter(subjectId =>
        initiallySelected.every(classId => assigned.some(a =>
          String(a.class_id) === classId && String(a.subject_id) === subjectId))));
      const subjectOptions = '<option value="">Choose subject</option>' + subjects.filter(s => commonSubjectIds.has(String(s.id))).map(s => `<option value="${s.id}" ${exam && String(exam.subject_id) === String(s.id) ? 'selected' : ''}>${Utils.escapeHtml(s.name)}</option>`).join('');
      const yearOptions = years.map(y => `<option value="${y.id}" ${String(exam?.academic_year_id || activeYear?.id) === String(y.id) ? 'selected' : ''}>${Utils.escapeHtml(y.name)}</option>`).join('');
      const termOptions = terms.filter(t => String(t.academic_year_id) === String(selectedYear)).map(t => `<option value="${t.id}" ${exam && String(exam.term_id) === String(t.id) ? 'selected' : ''}>${Utils.escapeHtml(t.name)}</option>`).join('');
      const typeOptions = types.map(t => `<option value="${t.id}" ${exam && String(exam.assessment_type_id) === String(t.id) ? 'selected' : ''}>${Utils.escapeHtml(t.name)}</option>`).join('');
      Modal.show(exam ? 'Edit Examination' : 'Create Examination', `
        <div class="ec-form">
          <label class="form-label" for="ec-title">Examination title *</label><input class="input-field" id="ec-title" maxlength="180" value="${Utils.escapeHtml(exam?.title || '')}" required>
          <label class="form-label" for="ec-description">Instructions</label><textarea class="textarea-field" id="ec-description" rows="3">${Utils.escapeHtml(exam?.description || '')}</textarea>
          <div class="grid-2">
            <div class="ec-class-picker"><span class="form-label">Classes *</span><p class="text-xs text-muted">Select every class that should share this assessment and its attempt limit/results.</p><div id="ec-class-list">${classOptions || '<p class="text-muted">No assigned classes are available.</p>'}</div></div>
            <div><label class="form-label" for="ec-subject">Subject *</label><select class="input-field" id="ec-subject" ${locked}>${subjectOptions}</select></div>
            <div><label class="form-label" for="ec-year">Academic year *</label><select class="input-field" id="ec-year" onchange="ExaminationCentre.updateTerms()" ${locked}>${yearOptions}</select></div>
            <div><label class="form-label" for="ec-term">Term</label><select class="input-field" id="ec-term" ${locked}>${termOptions}</select></div>
            <div><label class="form-label" for="ec-type">Assessment type</label><select class="input-field" id="ec-type" ${locked}><option value="">Choose type</option>${typeOptions}</select></div>
            <div><label class="form-label" for="ec-duration">Duration (minutes; blank = untimed)</label><input class="input-field" id="ec-duration" type="number" min="1" max="600" value="${exam?.duration_minutes ?? ''}" ${locked}></div>
            <div><label class="form-label" for="ec-pass">Pass mark (%)</label><input class="input-field" id="ec-pass" type="number" min="0" max="100" step="any" value="${exam?.pass_mark ?? 50}" ${locked}></div>
            <div><label class="form-label" for="ec-attempt-limit">Attempt limit</label><input class="input-field" id="ec-attempt-limit" type="number" min="1" max="10" value="${exam?.attempt_limit ?? 1}" ${locked}></div>
            <div><label class="form-label" for="ec-start">Available from</label><input class="input-field" id="ec-start" type="datetime-local" value="${this.datetimeInput(exam?.start_at)}" ${locked}></div>
            <div><label class="form-label" for="ec-end">Available until</label><input class="input-field" id="ec-end" type="datetime-local" value="${this.datetimeInput(exam?.end_at)}" ${locked}></div>
          </div>
          <label class="ec-check"><input id="ec-random-questions" type="checkbox" ${exam?.randomize_questions ? 'checked' : ''} ${locked}> Randomize question order for each learner</label>
          <label class="ec-check"><input id="ec-random-options" type="checkbox" ${exam?.randomize_options ? 'checked' : ''} ${locked}> Randomize answer-option order for each learner</label>
          <label class="ec-check"><input id="ec-allow-previous" type="checkbox" ${exam?.allow_previous !== false ? 'checked' : ''} ${locked}> Allow previous question navigation</label>
          <p class="text-xs text-muted">Results and correct answers stay hidden until the examination is closed, all attempts are submitted, written answers are marked, and you release results.</p>
          ${settingsLocked ? '<p class="text-xs text-muted">Scoring and delivery settings are locked because learners have started this assessment. You can still update its title and instructions.</p>' : ''}
        </div>`,
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.saveExam('${exam?.id || ''}')"><i data-lucide="save"></i> Save ${exam ? 'Changes' : 'Draft'}</button>`, true);
      this._terms = terms;
      this._assignments = assignments;
      this._classes = classes;
      this._subjects = subjects;
      this._examClassIds = selectedClassIds;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
      console.error('[ExaminationCentre] Exam form failed:', error);
      Utils.toast(error.message || 'Could not open examination form.', 'error');
    }
  },

  updateTerms() {
    const yearId = document.getElementById('ec-year')?.value;
    const term = document.getElementById('ec-term');
    if (!term) return;
    term.innerHTML = '<option value="">No term</option>' + (this._terms || [])
      .filter(t => String(t.academic_year_id) === String(yearId))
      .map(t => `<option value="${t.id}">${Utils.escapeHtml(t.name)}</option>`).join('');
    this.updateClasses();
  },

  updateClasses() {
    const yearId = document.getElementById('ec-year')?.value;
    const classList = document.getElementById('ec-class-list');
    if (!classList) return;
    const assigned = (this._assignments || []).filter(a =>
      !a.academic_year_id || String(a.academic_year_id) === String(yearId));
    const classIds = new Set(assigned.map(a => String(a.class_id)));
    const selected = new Set([...classList.querySelectorAll('.ec-class-choice:checked')]
      .map(input => String(input.value)).filter(classId => classIds.has(classId)));
    classList.innerHTML = (this._classes || [])
      .filter(row => classIds.has(String(row.id)))
      .map(row => `<label class="ec-check"><input class="ec-class-choice" type="checkbox" value="${row.id}" ${selected.has(String(row.id)) ? 'checked' : ''} onchange="ExaminationCentre.updateSubjects()"> ${Utils.escapeHtml(row.name)}</label>`).join('')
      || '<p class="text-muted">No assigned classes are available.</p>';
    this.updateSubjects();
  },

  updateSubjects() {
    const classIds = [...document.querySelectorAll('.ec-class-choice:checked')].map(input => String(input.value));
    const yearId = document.getElementById('ec-year')?.value;
    const subject = document.getElementById('ec-subject');
    if (!subject) return;
    const assignments = (this._assignments || []).filter(a =>
      !a.academic_year_id || String(a.academic_year_id) === String(yearId));
    const subjectIds = new Set(assignments.map(a => String(a.subject_id)).filter(subjectId =>
      classIds.length > 0 && classIds.every(classId => assignments.some(a =>
        String(a.class_id) === classId && String(a.subject_id) === subjectId))));
    const selected = subject.value;
    subject.innerHTML = '<option value="">Choose subject</option>' + (this._subjects || [])
      .filter(row => subjectIds.has(String(row.id)))
      .map(row => `<option value="${row.id}">${Utils.escapeHtml(row.name)}</option>`).join('');
    if (subjectIds.has(String(selected))) subject.value = selected;
  },

  async saveExam(examId) {
    const title = document.getElementById('ec-title')?.value.trim();
    const classIds = [...document.querySelectorAll('.ec-class-choice:checked')].map(input => String(input.value));
    const classId = classIds[0];
    const subjectId = document.getElementById('ec-subject')?.value;
    const yearId = document.getElementById('ec-year')?.value;
    const start = document.getElementById('ec-start')?.value;
    const end = document.getElementById('ec-end')?.value;
    if (!title || !classIds.length || !subjectId || !yearId) return Utils.toast('Enter a title and choose at least one class, a subject, and an academic year.', 'error');
    if (start && end && new Date(end) <= new Date(start)) return Utils.toast('The end time must be after the start time.', 'error');
    const payload = {
      title,
      description: document.getElementById('ec-description').value.trim(),
      teacher_id: Auth.getTeacherId(),
      class_id: classId,
      subject_id: subjectId,
      academic_year_id: yearId,
      term_id: document.getElementById('ec-term').value || null,
      assessment_type_id: document.getElementById('ec-type').value || null,
      duration_minutes: Number(document.getElementById('ec-duration').value) || null,
      pass_mark: Number(document.getElementById('ec-pass').value),
      attempt_limit: Number(document.getElementById('ec-attempt-limit').value) || 1,
      start_at: start ? new Date(start).toISOString() : null,
      end_at: end ? new Date(end).toISOString() : null,
      randomize_questions: document.getElementById('ec-random-questions').checked,
      randomize_options: document.getElementById('ec-random-options').checked,
      allow_previous: document.getElementById('ec-allow-previous').checked,
      show_results: false
    };
    let createdExamId = null;
    try {
      if (examId) {
        delete payload.teacher_id;
        const [existing, attempts] = await Promise.all([
          DB.getFresh('examinations', { id: examId }),
          DB.getFresh('exam_attempts', { exam_id: examId })
        ]);
        if (!existing || String(existing.teacher_id) !== String(Auth.getTeacherId())) {
          throw new Error('You can only edit your own examinations.');
        }
        if (attempts.length) payload.class_id = existing.class_id;
        await DB.update('examinations', examId, payload);
        const { error } = await sbClient.rpc('rms_exam_set_classes', {
          p_exam_id: examId,
          p_class_ids: classIds
        });
        if (error) throw error;
        DB.invalidate('examination_classes');
      } else {
        payload.status = 'draft';
        const created = await DB.insert('examinations', payload);
        createdExamId = created?.id;
        if (!createdExamId) throw new Error('The draft was created without an examination ID.');
        const { error } = await sbClient.rpc('rms_exam_set_classes', {
          p_exam_id: createdExamId,
          p_class_ids: classIds
        });
        if (error) throw error;
        DB.invalidate('examination_classes');
      }
      Modal.close();
      Utils.toast(examId ? 'Examination updated' : 'Draft examination created', 'success');
      if (createdExamId) await this.manage(createdExamId);
      else await this.renderTeacher();
    } catch (error) {
      if (createdExamId) {
        try {
          await DB.remove('examinations', createdExamId);
        } catch (cleanupError) {
          console.error('[ExaminationCentre] Failed to remove incomplete multi-class assessment:', cleanupError);
          Utils.toast('The assessment was created, but class assignment setup failed. Delete the incomplete draft and try again.', 'warning');
        }
      }
      console.error('[ExaminationCentre] Exam save failed:', error);
      Utils.toast('Could not save examination: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async changeStatus(examId, status, returnToManage = false) {
    try {
      const [exam] = await DB.getFresh('examinations', { id: examId });
      if (!exam || String(exam.teacher_id) !== String(Auth.getTeacherId())) throw new Error('You can only change your own examinations.');
      if (status === 'open' && exam.status === 'closed') {
        if (exam.end_at && new Date(exam.end_at) <= new Date()) {
          throw new Error('This assessment schedule has ended. Copy the assessment to create a new draft with a fresh schedule.');
        }
        if (!confirm('Reopen this assessment? Existing attempt limits and its configured start/end schedule still apply.')) return;
      }
      if (status === 'published') {
        const questions = await DB.getFresh('exam_questions', { exam_id: examId });
        if (!questions.length) throw new Error('Add at least one question before publishing.');
      }
      await DB.update('examinations', examId, { status });
      DB.invalidate('exam_attempts');
      Utils.toast('Examination ' + status, 'success');
      if (returnToManage) await this.manage(examId);
      else await this.renderTeacher();
    } catch (error) {
      console.error('[ExaminationCentre] Status change failed:', error);
      Utils.toast(error.message || 'Could not update examination status.', 'error');
    }
  },

  async deleteExam(examId) {
    if (!Auth.isTeacher()) return Utils.toast('Teacher access is required.', 'error');
    try {
      const [exam] = await DB.getFresh('examinations', { id: examId });
      if (!exam || String(exam.teacher_id) !== String(Auth.getTeacherId())) {
        throw new Error('You can only delete your own examinations.');
      }
      const [attempts, questionRows] = await Promise.all([
        DB.getFresh('exam_attempts', { exam_id: examId }),
        DB.getFresh('exam_questions', { exam_id: examId })
      ]);
      const attemptCount = attempts.length;
      const warning = attemptCount
        ? ` This will permanently delete ${attemptCount} learner attempt${attemptCount === 1 ? '' : 's'}, all answers, and results.`
        : '';
      if (!confirm(`Permanently delete "${exam.title}" and all its questions?${warning} This cannot be undone.`)) return;

      await this.removeExamMedia(examId, questionRows);
      await DB.remove('examinations', examId);
      DB.invalidate('exam_questions');
      DB.invalidate('exam_attempts');
      DB.invalidate('student_answers');
      DB.invalidate('examination_classes');
      Utils.toast('Assessment, questions, and any attempts were permanently deleted.', 'success');
      await this.renderTeacher();
    } catch (error) {
      console.error('[ExaminationCentre] Assessment delete failed:', error);
      Utils.toast('Could not delete assessment: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async duplicateExam(examId) {
    if (!Auth.isTeacher()) return Utils.toast('Teacher access is required.', 'error');
    try {
      const [exam] = await DB.getFresh('examinations', { id: examId });
      if (!exam || String(exam.teacher_id) !== String(Auth.getTeacherId())) {
        throw new Error('You can only copy your own assessments.');
      }
      const defaultTitle = `${exam.title} (Copy)`.slice(0, 180);
      Modal.show('Copy Assessment', `
        <p class="text-sm text-muted">Create a new draft with the same settings and questions. Student attempts and results will not be copied.</p>
        <label class="form-label" for="ec-copy-title">New assessment title</label>
        <input class="input-field" id="ec-copy-title" maxlength="180" required value="${Utils.escapeHtml(defaultTitle)}">`,
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.confirmDuplicateExam('${examId}')"><i data-lucide="copy"></i> Create copy</button>`, true);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
      console.error('[ExaminationCentre] Assessment copy form failed:', error);
      Utils.toast(error.message || 'Could not prepare assessment copy.', 'error');
    }
  },

  async confirmDuplicateExam(examId) {
    const title = document.getElementById('ec-copy-title')?.value.trim();
    if (!title || title.length > 180) return Utils.toast('Enter a title of up to 180 characters.', 'error');
    let createdExam;
    try {
      const [source] = await DB.getFresh('examinations', { id: examId });
      if (!source || String(source.teacher_id) !== String(Auth.getTeacherId())) {
        throw new Error('You can only copy your own assessments.');
      }
      const [questions, examClasses] = await Promise.all([
        DB.getFreshQuery('exam_questions', '*', { exam_id: examId }, { column: 'question_order', asc: true }),
        DB.getFresh('examination_classes', { exam_id: examId })
      ]);
      createdExam = await DB.insert('examinations', {
        title,
        description: source.description,
        teacher_id: source.teacher_id,
        class_id: source.class_id,
        subject_id: source.subject_id,
        academic_year_id: source.academic_year_id,
        term_id: source.term_id,
        assessment_type_id: source.assessment_type_id,
        duration_minutes: source.duration_minutes,
        pass_mark: source.pass_mark,
        attempt_limit: source.attempt_limit,
        randomize_questions: source.randomize_questions,
        randomize_options: source.randomize_options,
        allow_previous: source.allow_previous,
        show_results: false,
        status: 'draft',
        start_at: null,
        end_at: null
      });
      if (!createdExam?.id) throw new Error('The draft was created without an examination ID.');
      const { error: classError } = await sbClient.rpc('rms_exam_set_classes', {
        p_exam_id: createdExam.id,
        p_class_ids: examClasses.length ? examClasses.map(row => row.class_id) : [source.class_id]
      });
      if (classError) throw classError;
      DB.invalidate('examination_classes');
      if (questions.length) {
        const copies = questions.map(question => ({
          question_text: question.question_text,
          question_type: question.question_type,
          options: question.options,
          correct_option: question.correct_option,
          marks: question.marks,
          question_order: question.question_order,
          image_url: question.image_url,
          video_url: question.video_url,
          explanation: question.explanation,
          topic: question.topic,
          unit: question.unit,
          difficulty: question.difficulty,
          exam_id: createdExam.id
        }));
        const { error } = await sbClient.from('exam_questions').insert(copies);
        if (error) throw error;
        DB.invalidate('exam_questions');
      }
      Modal.close();
      Utils.toast(`Draft copy created with ${questions.length} question${questions.length === 1 ? '' : 's'}.`, 'success');
      await this.renderTeacher();
    } catch (error) {
      if (createdExam?.id) {
        try {
          await DB.remove('examinations', createdExam.id);
        } catch (cleanupError) {
          console.error('[ExaminationCentre] Failed to remove incomplete assessment copy:', cleanupError);
          Utils.toast('Copy failed and its incomplete draft could not be removed. Delete that draft from the Examination Centre.', 'warning');
        }
      }
      console.error('[ExaminationCentre] Assessment copy failed:', error);
      Utils.toast('Could not copy assessment: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async releaseResults(examId) {
    try {
      const [exam] = await DB.getFresh('examinations', { id: examId });
      if (!exam || String(exam.teacher_id) !== String(Auth.getTeacherId())) throw new Error('You can only release results for your own examinations.');
      if (exam.results_released_at) throw new Error('Results have already been released.');
      await DB.update('examinations', examId, { results_released_at: new Date().toISOString() });
      Utils.toast('Results released to learners', 'success');
      await this.renderTeacher();
    } catch (error) {
      console.error('[ExaminationCentre] Result release failed:', error);
      Utils.toast(error.message || 'Could not release results.', 'error');
    }
  },

  async manage(examId) {
    try {
      const [exam, questions, attempts, classes, subjects, learners, examClasses] = await Promise.all([
        DB.getFresh('examinations', { id: examId }),
        DB.getFreshQuery('exam_questions', '*', { exam_id: examId }, { column: 'question_order', asc: true }),
        DB.getFresh('exam_attempts', { exam_id: examId }),
        DB.get('classes'), DB.get('subjects'), DB.get('learners'),
        DB.getFresh('examination_classes', { exam_id: examId })
      ]);
      const current = exam[0];
      if (!current) throw new Error('Examination not found or access denied.');
      const answers = attempts.length
        ? await DB.getFresh('student_answers', { attempt_id: attempts.map(attempt => attempt.id) })
        : [];
      const own = Auth.isTeacher() && String(current.teacher_id) === String(Auth.getTeacherId());
      const classIds = examClasses.length ? examClasses.map(row => String(row.class_id)) : [String(current.class_id)];
      const classNames = classes.filter(row => classIds.includes(String(row.id))).map(row => row.name);
      const subject = subjects.find(row => String(row.id) === String(current.subject_id));
      setHeader(own ? current.title : 'Examination Overview', `${subject?.name || ''} · ${classNames.join(', ')}`);
      const canEditQuestions = own && attempts.length === 0;
      const writtenQuestions = questions.filter(question => question.question_type === 'written_response');
      const fullyMarked = attempt => writtenQuestions.every(question =>
        answers.some(answer => String(answer.attempt_id) === String(attempt.id)
          && String(answer.question_id) === String(question.id) && answer.marked_at));
      const questionCards = questions.map((q, index) => `
        <article class="ec-question-card"><div><span class="ec-q-number">Q${index + 1}</span><span class="badge badge-info">${Utils.escapeHtml(q.marks)} mark${Number(q.marks) === 1 ? '' : 's'}</span><span class="badge badge-gray">${q.question_type === 'written_response' ? 'Written · teacher marked' : 'Multiple choice · auto-marked'}</span><p>${Utils.escapeHtml(q.question_text)}</p>${this.renderQuestionMedia(q)}<small>${q.question_type === 'written_response' ? 'Teacher marks this response' : `Correct option: ${Utils.escapeHtml(q.correct_option)}`} · ${Utils.escapeHtml(q.difficulty || 'medium')}${q.topic ? ' · ' + Utils.escapeHtml(q.topic) : ''}</small></div>
        ${own ? `<div class="ec-question-actions">${canEditQuestions ? `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.questionForm('${examId}','${q.id}')">Edit</button><button class="btn btn-sm btn-outline" onclick="ExaminationCentre.moveQuestion('${q.id}',-1)" aria-label="Move question up">↑</button><button class="btn btn-sm btn-outline" onclick="ExaminationCentre.moveQuestion('${q.id}',1)" aria-label="Move question down">↓</button><button class="btn btn-sm btn-outline" onclick="ExaminationCentre.duplicateQuestion('${q.id}')">Duplicate</button><button class="btn btn-sm btn-danger" onclick="ExaminationCentre.deleteQuestion('${q.id}')">Delete</button>` : '<span class="text-xs text-muted">Locked after first attempt</span>'}${q.question_type !== 'written_response' ? `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.saveToBank('${examId}','${q.id}')">Save to bank</button>` : ''}</div>` : ''}</article>`).join('');
      const resultRows = attempts.map(attempt => {
        const learner = learners.find(row => String(row.id) === String(attempt.learner_id));
        const learnerAnswers = answers.filter(answer => String(answer.attempt_id) === String(attempt.id));
        const right = learnerAnswers.filter(answer => answer.is_correct).length;
        const completed = attempt.status !== 'in_progress';
        const needsMarking = completed && !fullyMarked(attempt);
        const resultVisible = completed && !needsMarking;
        return `<tr><td>${Utils.escapeHtml(attempt.guest_name || learner?.full_name || 'Learner')}</td><td>${resultVisible ? `${Utils.escapeHtml(attempt.score ?? 0)}/${Utils.escapeHtml(attempt.total_marks ?? 0)}` : needsMarking ? 'Awaiting marking' : completed ? 'Held' : 'In progress'}</td><td>${resultVisible ? `${Utils.escapeHtml(attempt.percentage ?? 0)}%` : '—'}</td><td>${needsMarking ? 'Teacher marking required' : Utils.escapeHtml(attempt.status)}</td><td>${resultVisible ? right : '—'}</td><td>${own && needsMarking ? `<button class="btn btn-sm btn-primary" onclick="ExaminationCentre.markAttempt('${attempt.id}')">Mark written answers</button>` : own && completed && writtenQuestions.length ? `<button class="btn btn-sm btn-outline" onclick="ExaminationCentre.markAttempt('${attempt.id}')">Review marks</button>` : ''}</td></tr>`;
      }).join('');
      const completedAttempts = attempts.filter(row => row.status !== 'in_progress' && fullyMarked(row));
      const average = completedAttempts.length ? Math.round(completedAttempts.reduce((sum, row) => sum + (Number(row.percentage) || 0), 0) / completedAttempts.length) : 0;
      const passRate = completedAttempts.length ? Math.round(completedAttempts.filter(row => Number(row.percentage) >= Number(current.pass_mark)).length / completedAttempts.length * 100) : 0;
      const analysis = questions.map((question, index) => {
        if (question.question_type === 'written_response') {
          return `<div class="ec-analysis-row"><span>Q${index + 1}</span><div class="ec-analysis-bar"><i style="width:0%"></i></div><strong>Teacher marked</strong></div>`;
        }
        const correct = answers.filter(answer => String(answer.question_id) === String(question.id) && answer.is_correct === true).length;
        const percent = completedAttempts.length ? Math.round(correct / completedAttempts.length * 100) : 0;
        return `<div class="ec-analysis-row"><span>Q${index + 1}</span><div class="ec-analysis-bar"><i style="width:${percent}%"></i></div><strong>${percent}%</strong></div>`;
      }).join('');
      setContent(`<section class="ec-page">
        <div class="ec-page-head"><div><h2>${Utils.escapeHtml(current.title)}</h2><p>${Utils.escapeHtml(current.description || 'Examination questions, progress and results.')}</p><span class="badge ${this.statusClass(current.status)}">${Utils.escapeHtml(current.status)}</span></div><button class="btn btn-outline" onclick="Router.go('${Auth.isAdmin() ? 'admin' : 'teacher'}/examinations')"><i data-lucide="arrow-left"></i> Back</button></div>
        ${own ? `<div class="ec-actions">${canEditQuestions ? `<button class="btn btn-primary" onclick="ExaminationCentre.questionForm('${examId}')"><i data-lucide="plus"></i> Add Question</button><button class="btn btn-outline" onclick="ExaminationCentre.bankDialog('${examId}','${current.subject_id}')"><i data-lucide="library"></i> Add from Question Bank</button>` : ''}${current.status === 'draft' ? questions.length ? `<button class="btn btn-primary" onclick="ExaminationCentre.changeStatus('${examId}','published',true)"><i data-lucide="send"></i> Publish Examination</button>` : '<span class="text-xs text-muted">Add at least one question to publish this examination.</span>' : ''}<button class="btn btn-outline" onclick="ExaminationCentre.preview('${examId}')"><i data-lucide="eye"></i> Preview</button><button class="btn btn-outline" onclick="ExaminationCentre.exportResults('${examId}')"><i data-lucide="file-spreadsheet"></i> Export CSV</button><button class="btn btn-primary" onclick="ExaminationCentre.exportResultsPdf('${examId}')"><i data-lucide="file-down"></i> Export PDF</button></div>` : ''}
        <div class="ec-summary-grid"><div><b>${questions.length}</b><span>Questions</span></div><div><b>${Utils.escapeHtml(questions.reduce((sum,q)=>sum+Number(q.marks||0),0))}</b><span>Total marks</span></div><div><b>${attempts.length}</b><span>Attempts</span></div><div><b>${average}%</b><span>Average</span></div><div><b>${passRate}%</b><span>Pass rate</span></div></div>
        <h3 class="ec-section-title">Question list ${own ? '<small>Use arrows to reorder; correct answers are visible only to you.</small>' : ''}</h3>
        ${questions.length ? `<div class="ec-question-list">${questionCards}</div>` : '<div class="ec-empty">No questions have been added.</div>'}
        <h3 class="ec-section-title">Question analysis</h3><div class="ec-analysis">${analysis || '<p class="text-muted">No question responses yet.</p>'}</div>
        <h3 class="ec-section-title">Learner results ${current.results_released_at ? '' : '<span class="badge badge-warning">Held from learners</span>'}</h3>
        <div class="table-container"><table class="data-table"><thead><tr><th>Learner</th><th>Score</th><th>Percent</th><th>Status</th><th>Correct</th><th>Marking</th></tr></thead><tbody>${resultRows || `<tr><td colspan="6">No attempts yet.</td></tr>`}</tbody></table></div>
      </section>`);
      this.typesetMath(document.getElementById('main-content'));
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
      console.error('[ExaminationCentre] Exam detail failed:', error);
      setContent(this.errorHtml(error));
    }
  },

  async questionForm(examId, questionId = null, initial = null) {
    let q = initial;
    if (questionId && !q) q = (await DB.getFresh('exam_questions', { id: questionId }))[0];
    const options = q?.options || [{ key: 'A', text: '' }, { key: 'B', text: '' }, { key: 'C', text: '' }, { key: 'D', text: '' }];
    const entryMode = !questionId ? `
      <div class="ec-question-mode" role="group" aria-label="Question entry mode">
        <button type="button" class="active" data-ec-mode="bulk" aria-pressed="true" onclick="ExaminationCentre.setQuestionEntryMode('bulk')"><i data-lucide="clipboard-paste"></i> Paste questions</button>
        <button type="button" data-ec-mode="single" aria-pressed="false" onclick="ExaminationCentre.setQuestionEntryMode('single')"><i data-lucide="file-plus-2"></i> Add one question</button>
      </div>` : '';
    const bulkImport = !questionId ? `
      <section class="ec-bulk-import" id="ec-bulk-panel" aria-labelledby="ec-bulk-title">
        <div class="ec-bulk-heading"><span class="ec-bulk-icon"><i data-lucide="clipboard-paste"></i></span><div><h3 id="ec-bulk-title">Paste your questions</h3><p>Paste multiple-choice questions, then choose each correct answer and set marks. An answer key can prefill choices. Use <b>Add one question</b> for written responses that the teacher will mark.</p></div></div>
          <ol class="ec-bulk-steps"><li><b>1</b> Paste text</li><li><b>2</b> Choose answers and marks</li><li><b>3</b> Add to examination</li></ol>
        <details class="ec-bulk-format">
          <summary>See a supported format</summary>
          <pre>**Air (Questions 1-2)**
**1. What is 2 + 2?**
A. 3
B. 4
C. 5
D. 6

**2. Which gas do we breathe?**
A. Oxygen
B. Smoke
C. Dust
D. Steam

**Answer Key**
1. B: Four is the sum of 2 and 2.
2. A: We breathe oxygen.</pre>
        </details>
        <label class="form-label" for="ec-bulk-text">Paste from your document</label>${this.mathToolbar('ec-bulk-text')}
        <textarea class="textarea-field ec-bulk-textarea" id="ec-bulk-text" rows="13" spellcheck="false" placeholder="**Air (Questions 1-2)**&#10;&#10;**1. What is 2 + 2?**&#10;A. 3&#10;B. 4&#10;C. 5&#10;D. 6&#10;&#10;**Answer Key**&#10;1. B: Four is the sum of 2 and 2."></textarea>
        <div class="ec-math-preview-label">Formula preview</div><div id="ec-bulk-math-preview" class="ec-math-preview" aria-live="polite"></div>
        <div class="ec-bulk-actions"><span>Bold headings and answer explanations are supported.</span><button class="btn btn-primary" type="button" onclick="ExaminationCentre.previewBulkQuestions('${examId}')"><i data-lucide="list-checks"></i> Preview questions</button></div>
        <div id="ec-bulk-preview" aria-live="polite"></div>
      </section>` : '';
    const fields = ['A','B','C','D','E'].map(key => {
      const existing = options.find(option => option.key === key);
      return `<label class="ec-option-input"><input type="radio" name="ec-correct" value="${key}" ${q?.correct_option === key ? 'checked' : ''} ${!existing && key === 'E' ? 'aria-label="Set option E correct"' : ''}><span>${key}</span><input class="input-field" id="ec-option-${key}" placeholder="Option ${key}${key === 'E' ? ' (optional)' : ''}" value="${Utils.escapeHtml(existing?.text || '')}" ${key !== 'E' ? 'required' : ''}></label>`;
    }).join('');
    Modal.show(questionId ? 'Edit Question' : 'Add Question', `
      <div class="ec-question-editor">${entryMode}<div class="ec-form ec-single-panel" id="ec-single-panel" ${!questionId ? 'hidden' : ''}>
      <label class="form-label" for="ec-question-type">Question type</label><select class="input-field" id="ec-question-type" onchange="ExaminationCentre.questionTypeChanged(this.value)"><option value="mcq_single" ${q?.question_type !== 'written_response' ? 'selected' : ''}>Multiple choice — automatically marked</option><option value="written_response" ${q?.question_type === 'written_response' ? 'selected' : ''}>Written response — teacher marks</option></select>
      <label class="form-label" for="ec-question-text">Question *</label>${this.mathToolbar('ec-question-text')}<textarea class="textarea-field" id="ec-question-text" rows="3" maxlength="10000" required>${Utils.escapeHtml(q?.question_text || '')}</textarea><div class="ec-math-preview-label">Formula preview</div><div id="ec-question-math-preview" class="ec-math-preview" aria-live="polite"></div>
      <div id="ec-mcq-fields" ${q?.question_type === 'written_response' ? 'hidden' : ''}><p class="text-xs text-muted">Answer options also support LaTeX math, for example <code>\\(\\sqrt{2}\\)</code>.</p><div class="ec-options">${fields}</div></div>
      <p id="ec-written-help" class="text-sm text-muted" ${q?.question_type !== 'written_response' ? 'hidden' : ''}>Learners will enter a written response. You will assign marks after they submit.</p>
      <div class="grid-2"><div><label class="form-label" for="ec-question-marks">Marks</label><input class="input-field" id="ec-question-marks" type="number" min="0.1" step="any" value="${q?.marks ?? 1}"></div><div><label class="form-label" for="ec-question-difficulty">Difficulty</label><select class="input-field" id="ec-question-difficulty">${['easy','medium','hard'].map(v=>`<option ${q?.difficulty===v?'selected':''}>${v}</option>`).join('')}</select></div><div><label class="form-label" for="ec-question-topic">Topic</label><input class="input-field" id="ec-question-topic" value="${Utils.escapeHtml(q?.topic || '')}"></div><div><label class="form-label" for="ec-question-unit">Unit</label><input class="input-field" id="ec-question-unit" value="${Utils.escapeHtml(q?.unit || '')}"></div></div>
      <fieldset class="ec-question-media"><legend>Question image or video (optional)</legend>
        <label class="form-label" for="ec-question-image">Image URL</label><input class="input-field" id="ec-question-image" type="url" value="${Utils.escapeHtml(q?.image_url || '')}" placeholder="https://…">
        <label class="form-label" for="ec-question-image-file">Or upload an image from this device</label><input class="input-field" id="ec-question-image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
        <label class="form-label" for="ec-question-video">Video URL</label><input class="input-field" id="ec-question-video" type="url" value="${Utils.escapeHtml(q?.video_url || '')}" placeholder="Direct HTTPS link to an MP4, WebM or Ogg video">
        <label class="form-label" for="ec-question-video-file">Or upload a video from this device</label><input class="input-field" id="ec-question-video-file" type="file" accept="video/mp4,video/webm,video/ogg">
        <small class="text-muted">Uploaded media can be up to 100 MB. Video links must point directly to a playable video file.</small>
      </fieldset>
      <label class="form-label" for="ec-question-explanation">Optional teacher explanation</label><textarea class="textarea-field" id="ec-question-explanation" rows="2">${Utils.escapeHtml(q?.explanation || '')}</textarea></div>${bulkImport}</div>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" id="ec-save-single" onclick="ExaminationCentre.saveQuestion('${examId}','${questionId || ''}')">${questionId ? 'Save Question' : 'Save One Question'}</button>`, true);
    if (!questionId) this.setQuestionEntryMode('bulk');
    if (q?.question_type === 'written_response') this.questionTypeChanged('written_response');
    const modalRoot = document.getElementById('modal-root');
    this.bindMathTools(modalRoot);
    this.typesetMath(modalRoot.querySelector('.modal-body'));
    this.updateMathPreview('ec-question-text', 'ec-question-math-preview');
    document.getElementById('ec-question-text')?.addEventListener('input', () =>
      this.updateMathPreview('ec-question-text', 'ec-question-math-preview'));
    document.getElementById('ec-bulk-text')?.addEventListener('input', () =>
      this.updateMathPreview('ec-bulk-text', 'ec-bulk-math-preview'));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  questionTypeChanged(type) {
    const written = type === 'written_response';
    const mcqFields = document.getElementById('ec-mcq-fields');
    const writtenHelp = document.getElementById('ec-written-help');
    if (mcqFields) mcqFields.hidden = written;
    if (writtenHelp) writtenHelp.hidden = !written;
  },

  setQuestionEntryMode(mode) {
    const bulk = mode === 'bulk';
    const bulkPanel = document.getElementById('ec-bulk-panel');
    const singlePanel = document.getElementById('ec-single-panel');
    const saveButton = document.getElementById('ec-save-single');
    const editor = document.querySelector('.ec-question-editor');
    if (!bulkPanel || !singlePanel || !saveButton || !editor) return;
    bulkPanel.hidden = !bulk;
    singlePanel.hidden = bulk;
    saveButton.hidden = bulk;
    editor.querySelectorAll('[data-ec-mode]').forEach(button => {
      const active = button.dataset.ecMode === mode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  },

  parseBulkQuestions(source) {
    const parsed = [];
    const errors = [];
    const answerKey = new Map();
    const orderedAnswerKey = [];
    let current = null;
    let inAnswerKey = false;
    const finish = () => {
      if (!current) return;
      const label = `Question ${current.number || parsed.length + 1}`;
      const text = current.text.trim();
      if (!text) errors.push(`${label}: missing question text.`);
      if (text.length > 10000) errors.push(`${label}: question text cannot exceed 10000 characters.`);
      if (current.options.length < 2 || current.options.length > 5) {
        errors.push(`${label}: add between 2 and 5 answer options.`);
      }
      if (current.options.some(option => !option.text.trim())) errors.push(`${label}: an answer option is empty.`);
      const marks = current.marks == null ? 1 : Number(current.marks);
      if (!Number.isFinite(marks) || marks <= 0 || marks > 1000) errors.push(`${label}: marks must be greater than 0 and no more than 1000.`);
      if (text && text.length <= 10000 && current.options.length >= 2 && current.options.length <= 5
        && current.options.every(option => option.text.trim())
        && Number.isFinite(marks) && marks > 0 && marks <= 1000) {
        parsed.push({
          source_number: current.number || String(parsed.length + 1),
          question_text: text,
          question_type: 'mcq_single',
          options: current.options,
          correct_option: current.correct || '',
          marks,
          difficulty: 'medium',
          topic: '',
          unit: '',
          image_url: null,
          video_url: null,
          explanation: ''
        });
      }
      current = null;
    };
    const lines = String(source || '').replace(/\r\n?/g, '\n').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^(?:[-•]\s+|\*\s+)/, '').replace(/^(?:\*\*|__)(.*)(?:\*\*|__)$/, '$1').trim();
      if (!line) continue;
      if (/^answer\s+key\s*:?\s*$/i.test(line)) {
        finish();
        inAnswerKey = true;
        continue;
      }
      if (/^.+\(\s*questions?\s+\d+\s*[-–]\s*\d+\s*\)$/i.test(line)) continue;
      if (inAnswerKey) {
        const numberedKeyEntry = line.match(/^(\d+)\s*[.)-]\s*([A-E])(?:\s*[:.)-]\s*(.*))?$/i);
        if (numberedKeyEntry) {
          const questionNumber = numberedKeyEntry[1];
          if (answerKey.has(questionNumber)) {
            errors.push(`The answer key repeats question ${questionNumber}.`);
            continue;
          }
          answerKey.set(questionNumber, {
            option: numberedKeyEntry[2].toUpperCase(),
            explanation: (numberedKeyEntry[3] || '').trim()
          });
          continue;
        }
        const orderedKeyEntry = line.match(/^([A-E])\s*[:.)-]\s*(.*)$/i);
        if (orderedKeyEntry) {
          orderedAnswerKey.push({
            option: orderedKeyEntry[1].toUpperCase(),
            explanation: orderedKeyEntry[2].trim()
          });
          continue;
        }
        errors.push(`Answer key entry "${line}" must use "1. B: explanation" or "B: explanation".`);
        continue;
      }
      const numbered = line.match(/^(?:Q(?:uestion)?\s*)?(\d+)\s*[.):\-]\s*(.*)$/i);
      const option = line.match(/^([A-E])\s*[).:-]\s*(.*)$/i);
      const answer = line.match(/^(?:(?:correct\s+)?answer|correct|ans)\s*[:=-]\s*([A-E])(?:\s*[).:-].*)?$/i);
      const marks = line.match(/^marks?\s*[:=-]\s*(\S+)$/i);
      if (numbered) {
        finish();
        current = { number: numbered[1], text: numbered[2], options: [], correct: '', marks: null };
      } else if (answer) {
        if (!current) errors.push('An Answer line appears before a question.');
        else current.correct = answer[1].toUpperCase();
      } else if (marks) {
        if (!current) errors.push('A Marks line appears before a question.');
        else current.marks = marks[1];
      } else if (option) {
        if (!current) {
          errors.push(`Option ${option[1].toUpperCase()} appears before a question.`);
          continue;
        }
        const key = option[1].toUpperCase();
        const existing = current.options.find(item => item.key === key);
        if (existing) {
          errors.push(`Question ${current.number || parsed.length + 1}: option ${key} is repeated.`);
          continue;
        }
        current.options.push({ key, text: option[2].trim() });
      } else if (!current) {
        current = { number: '', text: line, options: [], correct: '', marks: null };
      } else if (current.options.length && current.correct) {
        finish();
        current = { number: '', text: line, options: [], correct: '', marks: null };
      } else if (current.options.length) {
        errors.push(`Question ${current.number || parsed.length + 1}: unexpected text after answer options; start the next question with a number (for example, 2.).`);
      } else {
        current.text += `\n${line}`;
      }
    }
    finish();
    const questionsByNumber = new Map(parsed.map(question => [question.source_number, question]));
    const applyAnswerKeyEntry = (question, entry, label) => {
      if (!question.options.some(option => option.key === entry.option)) {
        errors.push(`Question ${label}: answer key option ${entry.option} is not one of its options.`);
        return;
      }
      if (question.correct_option && question.correct_option !== entry.option) {
        errors.push(`Question ${label}: the answer line and answer key do not match.`);
        return;
      }
      question.correct_option = entry.option;
      if (entry.explanation) question.explanation = entry.explanation;
    };
    for (const [questionNumber, entry] of answerKey) {
      const question = questionsByNumber.get(questionNumber);
      if (!question) {
        errors.push(`Answer key refers to question ${questionNumber}, but no matching question was found.`);
        continue;
      }
      applyAnswerKeyEntry(question, entry, questionNumber);
    }
    const unanswered = parsed.filter(question => !question.correct_option);
    orderedAnswerKey.forEach((entry, index) => {
      const question = unanswered[index];
      if (!question) {
        errors.push(`Answer key has more unnumbered entries than unanswered questions (${orderedAnswerKey.length} entries for ${unanswered.length} questions).`);
        return;
      }
      applyAnswerKeyEntry(question, entry, question.source_number);
    });
    for (const question of parsed) {
      delete question.source_number;
    }
    return { questions: parsed, errors };
  },

  validateQuestionMediaUrl(value, label) {
    const url = String(value || '').trim();
    if (!url) return null;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password) {
        throw new Error('invalid');
      }
      return parsed.href;
    } catch {
      throw new Error(`${label} must be a valid HTTPS link.`);
    }
  },

  async uploadQuestionMedia(examId, file) {
    const types = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/ogg': 'ogv'
    };
    const extension = types[file?.type];
    if (!extension) throw new Error('Choose a JPEG, PNG, WebP or GIF image, or an MP4, WebM or Ogg video.');
    if (!file.size || file.size > 100 * 1024 * 1024) {
      throw new Error('Media files must be smaller than 100 MB.');
    }
    const path = `${examId}/${crypto.randomUUID()}.${extension}`;
    const { data, error } = await sbClient.storage.from('examination-media').upload(path, file, {
      cacheControl: '3600',
      contentType: file.type,
      upsert: false
    });
    if (error) throw error;
    const { data: publicData } = sbClient.storage.from('examination-media').getPublicUrl(data.path);
    if (!publicData?.publicUrl) throw new Error('Could not create a public link for the uploaded media.');
    return { url: publicData.publicUrl, path: data.path };
  },

  async removeUploadedQuestionMedia(paths) {
    if (!paths.length) return;
    const { error } = await sbClient.storage.from('examination-media').remove(paths);
    if (error) console.warn('[ExaminationCentre] Uploaded media cleanup failed:', error);
  },

  async removeExamMedia(examId, questions) {
    const bucket = sbClient.storage.from('examination-media');
    const paths = new Set();
    for (const question of questions) {
      for (const mediaUrl of [question.image_url, question.video_url]) {
        if (!mediaUrl) continue;
        try {
          const pathname = decodeURIComponent(new URL(mediaUrl).pathname);
          const marker = '/storage/v1/object/public/examination-media/';
          const markerIndex = pathname.indexOf(marker);
          if (markerIndex < 0) continue;
          const path = pathname.slice(markerIndex + marker.length);
          if (path.startsWith(`${examId}/`)) paths.add(path);
        } catch (error) {
          console.warn('[ExaminationCentre] Skipping an invalid question media URL during cleanup:', error);
        }
      }
    }
    if (!paths.size) return;
    const { error } = await bucket.remove([...paths]);
    if (error) throw error;
  },

  renderQuestionMedia(question) {
    if (!question?.image_url && !question?.video_url) return '';
    return `<div class="ec-question-media-preview">
      ${question.image_url ? `<img class="ec-question-image" src="${Utils.escapeHtml(question.image_url)}" alt="Question illustration" loading="lazy">` : ''}
      ${question.video_url ? `<video class="ec-question-video" controls playsinline preload="metadata"><source src="${Utils.escapeHtml(question.video_url)}">Your browser does not support embedded video.</video>` : ''}
    </div>`;
  },

  previewBulkQuestions(examId) {
    const preview = document.getElementById('ec-bulk-preview');
    const textarea = document.getElementById('ec-bulk-text');
    if (!preview || !textarea) return;
    const result = this.parseBulkQuestions(textarea.value);
    if (!result.questions.length && !result.errors.length) {
      preview.innerHTML = '<p class="text-muted">Paste one or more questions to preview them.</p>';
      return;
    }
    const questionList = result.questions.map((question, index) => `
      <article class="ec-bulk-review-card">
        <div class="ec-bulk-review-question"><strong>Question ${index + 1}</strong><p>${Utils.escapeHtml(question.question_text)}</p></div>
        <label class="form-label" for="ec-bulk-correct-${index}">Correct answer</label>
        <select class="input-field" id="ec-bulk-correct-${index}" data-ec-bulk-correct="${index}">
          <option value="">Choose the correct answer</option>
          ${question.options.map(option => `<option value="${Utils.escapeHtml(option.key)}" ${question.correct_option === option.key ? 'selected' : ''}>${Utils.escapeHtml(option.key)}. ${Utils.escapeHtml(option.text)}</option>`).join('')}
        </select>
        <label class="form-label" for="ec-bulk-marks-${index}">Marks</label>
        <input class="input-field" id="ec-bulk-marks-${index}" data-ec-bulk-marks="${index}" type="number" min="0.1" max="1000" step="any" value="${Utils.escapeHtml(question.marks)}">
        <details class="ec-bulk-media"><summary>Add image or video (optional)</summary>
          <label class="form-label" for="ec-bulk-image-url-${index}">Image URL</label>
          <input class="input-field" id="ec-bulk-image-url-${index}" data-ec-bulk-image-url="${index}" type="url" placeholder="https://…">
          <label class="form-label" for="ec-bulk-image-file-${index}">Or upload an image</label>
          <input class="input-field" id="ec-bulk-image-file-${index}" data-ec-bulk-image-file="${index}" type="file" accept="image/jpeg,image/png,image/webp,image/gif">
          <label class="form-label" for="ec-bulk-video-url-${index}">Video URL</label>
          <input class="input-field" id="ec-bulk-video-url-${index}" data-ec-bulk-video-url="${index}" type="url" placeholder="Direct HTTPS video file link">
          <label class="form-label" for="ec-bulk-video-file-${index}">Or upload a video</label>
          <input class="input-field" id="ec-bulk-video-file-${index}" data-ec-bulk-video-file="${index}" type="file" accept="video/mp4,video/webm,video/ogg">
        </details>
        ${question.explanation ? `<small class="ec-bulk-explanation">${Utils.escapeHtml(question.explanation)}</small>` : ''}
      </article>`
    ).join('');
    const errors = result.errors.length
      ? `<div class="alert alert-error"><strong>Fix these issues before importing:</strong><ul>${result.errors.map(error => `<li>${Utils.escapeHtml(error)}</li>`).join('')}</ul></div>`
      : '';
    const importButton = result.questions.length && !result.errors.length
      ? `<button class="btn btn-primary" type="button" onclick="ExaminationCentre.importBulkQuestions('${examId}')"><i data-lucide="upload"></i> Add ${result.questions.length} question${result.questions.length === 1 ? '' : 's'}</button>`
      : '';
    preview.innerHTML = `<p><strong>${result.questions.length} valid question${result.questions.length === 1 ? '' : 's'} found.</strong></p>${errors}${questionList ? `<div class="ec-bulk-review-list">${questionList}</div>` : ''}${importButton}`;
    this.typesetMath(preview);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async importBulkQuestions(examId) {
    const textarea = document.getElementById('ec-bulk-text');
    if (!textarea) return;
    const { questions: parsedQuestions, errors } = this.parseBulkQuestions(textarea.value);
    if (errors.length || !parsedQuestions.length) {
      this.previewBulkQuestions(examId);
      return Utils.toast(errors[0] || 'Paste at least one valid question.', 'error');
    }
    const questions = parsedQuestions.map((question, index) => ({
      ...question,
      correct_option: document.querySelector(`[data-ec-bulk-correct="${index}"]`)?.value || '',
      marks: Number(document.querySelector(`[data-ec-bulk-marks="${index}"]`)?.value)
    }));
    for (const [index, question] of questions.entries()) {
      if (!question.correct_option || !question.options.some(option => option.key === question.correct_option)) {
        return Utils.toast(`Choose a correct answer for question ${index + 1}.`, 'error');
      }
      if (!Number.isFinite(question.marks) || question.marks <= 0 || question.marks > 1000) {
        return Utils.toast(`Enter marks greater than 0 and no more than 1000 for question ${index + 1}.`, 'error');
      }
    }
    const uploadedPaths = [];
    let questionsSaved = false;
    try {
      for (const [index, question] of questions.entries()) {
        question.image_url = this.validateQuestionMediaUrl(
          document.querySelector(`[data-ec-bulk-image-url="${index}"]`)?.value,
          `Image URL for question ${index + 1}`
        );
        question.video_url = this.validateQuestionMediaUrl(
          document.querySelector(`[data-ec-bulk-video-url="${index}"]`)?.value,
          `Video URL for question ${index + 1}`
        );
        const imageFile = document.querySelector(`[data-ec-bulk-image-file="${index}"]`)?.files?.[0];
        const videoFile = document.querySelector(`[data-ec-bulk-video-file="${index}"]`)?.files?.[0];
        if (imageFile) {
          const upload = await this.uploadQuestionMedia(examId, imageFile);
          uploadedPaths.push(upload.path);
          question.image_url = upload.url;
        }
        if (videoFile) {
          const upload = await this.uploadQuestionMedia(examId, videoFile);
          uploadedPaths.push(upload.path);
          question.video_url = upload.url;
        }
      }
      const existing = await DB.getFresh('exam_questions', { exam_id: examId });
      const firstOrder = existing.length ? Math.max(...existing.map(row => Number(row.question_order) || 0)) + 1 : 0;
      const rows = questions.map((question, index) => ({
        ...question,
        exam_id: examId,
        question_order: firstOrder + index
      }));
      const { error } = await sbClient.from('exam_questions').insert(rows);
      if (error) throw error;
      questionsSaved = true;
      DB.invalidate('exam_questions');
      Modal.close();
      Utils.toast(`${questions.length} question${questions.length === 1 ? '' : 's'} added`, 'success');
      await this.manage(examId);
    } catch (error) {
      if (!questionsSaved) await this.removeUploadedQuestionMedia(uploadedPaths);
      console.error('[ExaminationCentre] Bulk question import failed:', error);
      Utils.toast('Could not add pasted questions: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async saveQuestion(examId, questionId) {
    const text = document.getElementById('ec-question-text')?.value.trim();
    const questionType = document.getElementById('ec-question-type')?.value || 'mcq_single';
    const correct = questionType === 'mcq_single' ? document.querySelector('input[name="ec-correct"]:checked')?.value : null;
    const options = questionType === 'mcq_single'
      ? ['A','B','C','D','E'].map(key => ({ key, text: document.getElementById('ec-option-'+key)?.value.trim() || '' })).filter(option => option.text)
      : [];
    const marks = Number(document.getElementById('ec-question-marks')?.value);
    let imageUrl;
    let videoUrl;
    try {
      imageUrl = this.validateQuestionMediaUrl(document.getElementById('ec-question-image')?.value, 'Image URL');
      videoUrl = this.validateQuestionMediaUrl(document.getElementById('ec-question-video')?.value, 'Video URL');
    } catch (error) {
      return Utils.toast(error.message, 'error');
    }
    if (!text || !(marks > 0) || (questionType === 'mcq_single'
      && (options.length < 2 || !correct || !options.some(option => option.key === correct)))) {
      return Utils.toast(questionType === 'mcq_single'
        ? 'Enter a question, at least two options, a valid correct answer, and positive marks.'
        : 'Enter a written-response question and positive marks.', 'error');
    }
    const uploadedPaths = [];
    let questionSaved = false;
    try {
      let order = 0;
      if (!questionId) {
        const current = await DB.getFresh('exam_questions', { exam_id: examId });
        order = current.length ? Math.max(...current.map(row => Number(row.question_order) || 0)) + 1 : 0;
      }
      const imageFile = document.getElementById('ec-question-image-file')?.files?.[0];
      const videoFile = document.getElementById('ec-question-video-file')?.files?.[0];
      if (imageFile) {
        const upload = await this.uploadQuestionMedia(examId, imageFile);
        uploadedPaths.push(upload.path);
        imageUrl = upload.url;
      }
      if (videoFile) {
        const upload = await this.uploadQuestionMedia(examId, videoFile);
        uploadedPaths.push(upload.path);
        videoUrl = upload.url;
      }
      const payload = {
        question_text: text, question_type: questionType, options, correct_option: correct, marks,
        difficulty: document.getElementById('ec-question-difficulty').value,
        topic: document.getElementById('ec-question-topic').value.trim(),
        unit: document.getElementById('ec-question-unit').value.trim(),
        image_url: imageUrl,
        video_url: videoUrl,
        explanation: document.getElementById('ec-question-explanation').value.trim()
      };
      if (questionId) await DB.update('exam_questions', questionId, payload);
      else await DB.insert('exam_questions', { ...payload, exam_id: examId, question_order: order });
      questionSaved = true;
      Modal.close();
      Utils.toast('Question saved', 'success');
      await this.manage(examId);
    } catch (error) {
      if (!questionSaved) await this.removeUploadedQuestionMedia(uploadedPaths);
      console.error('[ExaminationCentre] Question save failed:', error);
      Utils.toast('Could not save question: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async deleteQuestion(questionId) {
    if (!confirm('Delete this question permanently? Questions are locked once any learner has started the examination.')) return;
    try {
      const [question] = await DB.getFresh('exam_questions', { id: questionId });
      await DB.remove('exam_questions', questionId);
      await this.manage(question?.exam_id);
    } catch (error) {
      console.error('[ExaminationCentre] Question delete failed:', error);
      Utils.toast('Could not delete question: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async moveQuestion(questionId, direction) {
    try {
      const [question] = await DB.getFresh('exam_questions', { id: questionId });
      if (!question) throw new Error('Question not found.');
      const rows = await DB.getFreshQuery('exam_questions', '*', { exam_id: question.exam_id }, { column: 'question_order', asc: true });
      const index = rows.findIndex(row => String(row.id) === String(questionId));
      const neighbor = rows[index + direction];
      if (!neighbor) return;
      await DB.update('exam_questions', question.id, { question_order: -1 });
      await DB.update('exam_questions', neighbor.id, { question_order: question.question_order });
      await DB.update('exam_questions', question.id, { question_order: neighbor.question_order });
      await this.manage(question.exam_id);
    } catch (error) {
      console.error('[ExaminationCentre] Question reorder failed:', error);
      Utils.toast('Could not reorder question: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async duplicateQuestion(questionId) {
    try {
      const [question] = await DB.getFresh('exam_questions', { id: questionId });
      if (!question) throw new Error('Question not found.');
      const rows = await DB.getFresh('exam_questions', { exam_id: question.exam_id });
      const { id, created_at, ...copy } = question;
      await DB.insert('exam_questions', { ...copy, question_order: rows.length ? Math.max(...rows.map(row=>Number(row.question_order)||0))+1 : 0 });
      await this.manage(question.exam_id);
    } catch (error) {
      console.error('[ExaminationCentre] Question duplicate failed:', error);
      Utils.toast('Could not duplicate question: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async saveToBank(examId, questionId) {
    try {
      const [exam] = await DB.getFresh('examinations', { id: examId });
      const [question] = await DB.getFresh('exam_questions', { id: questionId });
      if (!exam || !question || String(exam.teacher_id) !== String(Auth.getTeacherId())) throw new Error('Question not found or not owned by your teacher account.');
      await DB.insert('question_bank', {
        teacher_id: exam.teacher_id, subject_id: exam.subject_id, class_id: exam.class_id,
        academic_year_id: exam.academic_year_id, assessment_type_id: exam.assessment_type_id,
        question_text: question.question_text, options: question.options,
        correct_option: question.correct_option, image_url: question.image_url,
        video_url: question.video_url, marks: question.marks,
        explanation: question.explanation, topic: question.topic, unit: question.unit, difficulty: question.difficulty
      });
      Utils.toast('Question saved to your private question bank', 'success');
    } catch (error) {
      console.error('[ExaminationCentre] Question bank save failed:', error);
      Utils.toast('Could not save to question bank: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async bankDialog(examId, subjectId) {
    try {
      const bank = await DB.getFresh('question_bank', { subject_id: subjectId });
      Modal.show('Add from My Question Bank', bank.length ? `<div class="ec-bank-list">${bank.map(q=>`<label class="ec-bank-item"><input type="checkbox" value="${q.id}"><span><strong>${Utils.escapeHtml(q.topic || q.question_text.slice(0,90))}</strong><br>${Utils.escapeHtml(q.question_text)}</span></label>`).join('')}</div>` : '<p>Your private question bank is empty. Save a question from the question editor to reuse it later.</p>',
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.addBankQuestions('${examId}')">Add Selected</button>`, true);
    } catch (error) {
      console.error('[ExaminationCentre] Question bank load failed:', error);
      Utils.toast('Could not load your question bank: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async addBankQuestions(examId) {
    const ids = [...document.querySelectorAll('.ec-bank-list input:checked')].map(input => input.value);
    if (!ids.length) return Utils.toast('Select at least one question.', 'error');
    try {
      const [bank, existing] = await Promise.all([DB.getFresh('question_bank'), DB.getFresh('exam_questions', { exam_id: examId })]);
      let order = existing.length ? Math.max(...existing.map(row=>Number(row.question_order)||0))+1 : 0;
      for (const item of bank.filter(row => ids.includes(String(row.id)))) {
        await DB.insert('exam_questions', {
          exam_id: examId, question_text: item.question_text, question_type: 'mcq_single',
          options: item.options, correct_option: item.correct_option, marks: item.marks,
          image_url: item.image_url, video_url: item.video_url,
          question_order: order++, explanation: item.explanation, topic: item.topic,
          unit: item.unit, difficulty: item.difficulty
        });
      }
      Modal.close();
      await this.manage(examId);
    } catch (error) {
      console.error('[ExaminationCentre] Add from question bank failed:', error);
      Utils.toast('Could not add question bank items: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async preview(examId) {
    try {
      const [exam] = await DB.getFresh('examinations', { id: examId });
      const questions = await DB.getFreshQuery('exam_questions', '*', { exam_id: examId }, { column: 'question_order', asc: true });
      Modal.show('Learner Preview — ' + Utils.escapeHtml(exam?.title || ''), `
        <div class="ec-preview"><p>${Utils.escapeHtml(exam?.description || '')}</p>${questions.map((q,i)=>`<article><strong>Question ${i+1} of ${questions.length} · ${q.question_type === 'written_response' ? 'Written response' : 'Multiple choice'}</strong><p>${Utils.escapeHtml(q.question_text)}</p>${this.renderQuestionMedia(q)}${q.question_type === 'written_response' ? '<textarea class="textarea-field" rows="4" placeholder="Learner written response"></textarea>' : q.options.map(o=>`<label><input type="radio" name="ec-preview-${i}"> ${Utils.escapeHtml(o.text)}</label>`).join('')}</article>`).join('')}</div>`,
        `<button class="btn btn-primary" onclick="Modal.close()">Close preview</button>`, true);
      this.typesetMath(document.querySelector('#modal-root .ec-preview'));
    } catch (error) {
      console.error('[ExaminationCentre] Preview failed:', error);
      Utils.toast('Could not preview examination.', 'error');
    }
  },

  async markAttempt(attemptId) {
    try {
      const [attempt] = await DB.getFresh('exam_attempts', { id: attemptId });
      if (!attempt || attempt.status === 'in_progress') throw new Error('Only submitted attempts can be marked.');
      const [exam] = await DB.getFresh('examinations', { id: attempt.exam_id });
      if (!exam || String(exam.teacher_id) !== String(Auth.getTeacherId())) throw new Error('You can only mark responses for your own examinations.');
      const [questions, answers] = await Promise.all([
        DB.getFreshQuery('exam_questions', '*', { exam_id: attempt.exam_id }, { column: 'question_order', asc: true }),
        DB.getFresh('student_answers', { attempt_id: attemptId })
      ]);
      const written = questions.filter(question => question.question_type === 'written_response');
      if (!written.length) throw new Error('This examination has no written-response questions.');
      const answerByQuestion = new Map(answers.map(answer => [String(answer.question_id), answer]));
      Modal.show('Mark Written Responses', `
        <p class="text-sm text-muted">Enter a score from 0 up to each question's maximum. Assign 0 to unanswered or incorrect work. Results stay hidden from learners until all written answers are marked.</p>
        <div class="ec-marking-list">${written.map(question => {
          const answer = answerByQuestion.get(String(question.id));
          return `<article class="ec-marking-item"><h4>Question ${questions.indexOf(question) + 1} · ${Utils.escapeHtml(question.marks)} marks</h4><p>${Utils.escapeHtml(question.question_text)}</p><div class="ec-marking-response">${answer?.response_text ? Utils.escapeHtml(answer.response_text) : '<em>No response provided</em>'}</div>
            <label class="form-label" for="ec-mark-score-${question.id}">Marks awarded (0–${Utils.escapeHtml(question.marks)})</label><input class="input-field" id="ec-mark-score-${question.id}" data-ec-mark-question="${question.id}" type="number" min="0" max="${Utils.escapeHtml(question.marks)}" step="any" value="${answer?.marks_awarded == null ? '' : Utils.escapeHtml(answer.marks_awarded)}" required>
            <label class="form-label" for="ec-mark-feedback-${question.id}">Feedback (optional)</label><textarea class="textarea-field" id="ec-mark-feedback-${question.id}" data-ec-mark-feedback="${question.id}" rows="2">${Utils.escapeHtml(answer?.teacher_feedback || '')}</textarea></article>`;
        }).join('')}</div>`,
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.saveWrittenMarks('${attemptId}')">Save marks</button>`, true);
      this.typesetMath(document.querySelector('#modal-root .modal-body'));
    } catch (error) {
      console.error('[ExaminationCentre] Written marking form failed:', error);
      Utils.toast(error.message || 'Could not open written responses for marking.', 'error');
    }
  },

  async saveWrittenMarks(attemptId) {
    const fields = [...document.querySelectorAll('[data-ec-mark-question]')];
    if (!fields.length) return Utils.toast('No written responses are available to mark.', 'error');
    const marks = fields.map(field => ({
      questionId: field.dataset.ecMarkQuestion,
      value: field.value.trim(),
      feedback: document.querySelector(`[data-ec-mark-feedback="${field.dataset.ecMarkQuestion}"]`)?.value.trim() || ''
    }));
    for (const [index, item] of marks.entries()) {
      const value = Number(item.value);
      const maximum = Number(fields[index].max);
      if (!item.value || !Number.isFinite(value) || value < 0 || value > maximum) {
        return Utils.toast(`Enter a mark from 0 to ${maximum} for written question ${index + 1}.`, 'error');
      }
    }
    try {
      for (const item of marks) {
        const { error } = await sbClient.rpc('rms_exam_mark_written_answer', {
          p_attempt_id: attemptId,
          p_question_id: item.questionId,
          p_marks_awarded: Number(item.value),
          p_teacher_feedback: item.feedback
        });
        if (error) throw error;
      }
      const [attempt] = await DB.getFresh('exam_attempts', { id: attemptId });
      Modal.close();
      Utils.toast('Written marks saved. Results are available when all written questions are marked and released.', 'success');
      await this.manage(attempt.exam_id);
    } catch (error) {
      console.error('[ExaminationCentre] Written marking save failed:', error);
      Utils.toast('Could not save written marks: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  exportResults(examId) {
    const rows = [...document.querySelectorAll('.data-table tbody tr')].map(row => [...row.cells].map(cell => cell.textContent.trim()));
    const csv = rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `RMS-exam-results-${examId}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  },

  async exportResultsPdf(examId) {
    const title = document.querySelector('.ec-page-head h2')?.textContent?.trim();
    const table = document.querySelector('.ec-page .table-container table');
    if (!title || !table) return Utils.toast('Open the examination results before exporting them.', 'error');
    if (typeof ReportCenter === 'undefined' || typeof ReportCenter.downloadPdfDocument !== 'function') {
      return Utils.toast('The PDF export service is unavailable. Please refresh and try again.', 'error');
    }
    const summary = [...document.querySelectorAll('.ec-summary-grid > div')].map(item =>
      `<div class="summary-item"><strong>${Utils.escapeHtml(item.querySelector('b')?.textContent || '')}</strong><span>${Utils.escapeHtml(item.querySelector('span')?.textContent || '')}</span></div>`
    ).join('');
    const report = `
      <main class="exam-results-report">
        <h1>${Utils.escapeHtml(title)}</h1>
        <p class="report-subtitle">Examination results · Generated ${Utils.escapeHtml(new Date().toLocaleString())}</p>
        <section class="summary-grid">${summary}</section>
        <h2>Learner results</h2>
        ${table.outerHTML}
      </main>
      <style>
        .exam-results-report{font-family:Arial,sans-serif;color:#172033;padding:24px}
        .exam-results-report h1{font-size:24px;margin:0 0 6px}
        .exam-results-report h2{font-size:17px;margin:24px 0 10px}
        .report-subtitle{margin:0 0 18px;color:#526174;font-size:11px}
        .summary-grid{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 20px}
        .summary-item{min-width:90px;padding:10px;border:1px solid #dbe2ea;border-radius:6px}
        .summary-item strong,.summary-item span{display:block}
        .summary-item strong{font-size:17px}
        .summary-item span{margin-top:4px;color:#526174;font-size:10px}
        table{width:100%;border-collapse:collapse;font-size:10px}
        th,td{padding:7px 6px;border:1px solid #cbd5e1;text-align:left;vertical-align:top}
        th{background:#eef3f8;font-weight:700}
        tr{break-inside:avoid;page-break-inside:avoid}
      </style>`;
    const safeTitle = title.replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '') || 'Examination';
    await ReportCenter.downloadPdfDocument(
      report,
      `RMS-MIS_Exam_Results_${safeTitle}.pdf`,
      'landscape'
    );
  },

  async linkLearnerDialog() {
    if (!Auth.isAdmin()) return Utils.toast('DOS access is required.', 'error');
    try {
      const learners = await DB.getFresh('learners');
      const available = learners.filter(row => row.status === 'active');
      Modal.show('Create Learner Login', `
        <p class="text-sm text-muted">Create an individual RMS sign-in for an active learner in your education-level scope. Share the temporary password securely and ask the learner to change it after signing in.</p>
        <label class="form-label" for="ec-link-learner">Learner</label><select class="input-field" id="ec-link-learner">${available.map(l=>`<option value="${l.id}">${Utils.escapeHtml(l.full_name)} — ${Utils.escapeHtml(l.learner_code)}</option>`).join('')}</select>
        <label class="form-label" for="ec-link-email">Learner sign-in email</label><input class="input-field" id="ec-link-email" type="email" autocomplete="email" required>`,
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.createLearnerAccount()">Create account</button>`, true);
      if (!available.length) Utils.toast('There are no active learners in your visible education-level scope.', 'info');
    } catch (error) {
      console.error('[ExaminationCentre] Learner account dialog failed:', error);
      Utils.toast('Could not load eligible learners: ' + (error.message || 'Please try again.'), 'error');
    }
  },

  async createLearnerAccount() {
    const learnerId = document.getElementById('ec-link-learner')?.value;
    const email = document.getElementById('ec-link-email')?.value.trim();
    if (!learnerId || !email) return Utils.toast('Choose a learner and enter an email address.', 'error');
    try {
      const { data, error } = await sbClient.functions.invoke('rms-create-learner-account', { body: { learner_id: learnerId, email } });
      if (error) throw error;
      Modal.show('Learner Account Created', `<p>Sign-in: <strong>${Utils.escapeHtml(data.email)}</strong></p><p>Temporary password: <code>${Utils.escapeHtml(data.temporary_password)}</code></p><div class="alert alert-warning">Share these credentials privately. The learner should change the password after the first sign-in.</div>`,
        `<button class="btn btn-primary" onclick="Modal.close();ExaminationCentre.renderDos()">Done</button>`, true);
    } catch (error) {
      console.error('[ExaminationCentre] Learner account creation failed:', error);
      Utils.toast('Could not create learner account: ' + (error.message || 'Deploy the learner-account Edge Function and verify SQL setup.'), 'error');
    }
  },

  async renderLearner() {
    if (Auth.getRole() !== 'learner' || !Auth.getLearnerId()) {
      setHeader('Examinations', 'Your learner login is not linked to an active learner record.');
      setContent('<div class="alert alert-danger">Your learner account is not linked to a learner record. Contact the DOS.</div>');
      return;
    }
    setHeader('My Examinations', 'View and take examinations assigned to your class.');
    setContent(Utils.loading());
    try {
      const [{ data: results, error: resultsError }, exams] = await Promise.all([
        sbClient.rpc('rms_exam_my_results'),
        DB.getFresh('examinations')
      ]);
      if (resultsError) throw resultsError;
      const now = Date.now();
      const activeExamIds = new Set((results || []).filter(row => row.status === 'in_progress').map(row => String(row.exam_id)));
      const cards = exams.filter(exam => activeExamIds.has(String(exam.id))
        || (['published','open'].includes(exam.status)
        && (!exam.start_at || new Date(exam.start_at).getTime() <= now)
        && (!exam.end_at || new Date(exam.end_at).getTime() >= now))
        || (exam.status === 'closed' && activeExamIds.has(String(exam.id))))
        .map(exam => {
          const canStart = exam.status === 'open' || activeExamIds.has(String(exam.id));
          return `<article class="ec-exam-card"><span class="badge ${this.statusClass(exam.status)}">${Utils.escapeHtml(exam.status)}</span><h3>${Utils.escapeHtml(exam.title)}</h3><p>${Utils.escapeHtml(exam.description || '')}</p><p class="text-sm text-muted">${exam.duration_minutes ? Utils.escapeHtml(exam.duration_minutes) + ' minutes' : 'No timer'} · ${Utils.escapeHtml(exam.attempt_limit)} attempt${Number(exam.attempt_limit) === 1 ? '' : 's'}</p>${canStart ? `<button class="btn btn-primary" onclick="ExaminationCentre.start('${exam.id}')"><i data-lucide="play"></i> ${activeExamIds.has(String(exam.id)) ? 'Continue attempt' : 'Start Examination'}</button>` : '<p class="text-sm text-muted">Published; waiting for the teacher to open it.</p>'}</article>`;
        }).join('');
      const resultCards = (results || []).filter(result => result.status !== 'in_progress').map(result => {
        const released = result.score != null;
        return `<article class="ec-exam-card"><span class="badge ${released ? 'badge-success' : 'badge-warning'}">${released ? 'Result released' : result.manual_marking_pending ? 'Awaiting marking' : 'Awaiting teacher release'}</span><h3>${Utils.escapeHtml(result.title)}</h3>${released ? `<p><strong>${Utils.escapeHtml(result.score)}/${Utils.escapeHtml(result.total_marks)} · ${Utils.escapeHtml(result.percentage)}%</strong></p><p>${Utils.escapeHtml(result.correct_count)} correct · ${Utils.escapeHtml(result.wrong_count)} wrong</p>` : '<p>Your submitted answers are saved. Your teacher will release the result when it is ready.</p>'}<p class="text-xs text-muted">Submitted ${Utils.escapeHtml(Utils.dateTimeStr(result.submitted_at))}</p>${released ? `<button class="btn btn-outline" onclick="ExaminationCentre.reviewLearnerAnswers('${result.attempt_id}')"><i data-lucide="list-checks"></i> Review answers</button>` : ''}</article>`;
      }).join('');
      setContent(`<section class="ec-page"><div class="ec-page-head"><div><h2>Available Examinations</h2><p>Only examinations assigned to your class and available now are shown.</p></div></div>${cards ? `<div class="ec-exam-grid">${cards}</div>` : '<div class="ec-empty"><i data-lucide="calendar-check"></i><h3>No examination is available right now</h3><p>Check again when your teacher publishes or opens an examination.</p></div>'}${resultCards ? '<h3 class="ec-section-title">Released Results</h3><div class="ec-exam-grid">'+resultCards+'</div>' : ''}</section>`);
      if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch (error) {
      console.error('[ExaminationCentre] Learner list failed:', error);
      setContent(this.errorHtml(error));
    }
  },

  async reviewLearnerAnswers(attemptId) {
    try {
      const { data, error } = await sbClient.rpc('rms_exam_learner_review', {
        p_attempt_id: attemptId
      });
      if (error) throw error;
      this.renderAnswerReview(data.title, data);
    } catch (error) {
      console.error('[ExaminationCentre] Learner answer review failed:', error);
      Utils.toast(error.message || 'Could not load the answer review.', 'error');
    }
  },

  openGuestPortal() {
    const loginPage = document.getElementById('login-page');
    loginPage.classList.remove('rph-showing-home');
    document.documentElement.classList.remove('rph-page-scroll');
    loginPage.style.display = 'none';
    const layout = document.getElementById('app-layout');
    layout.style.display = 'flex';
    layout.classList.add('sidebar-hidden');
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('sidebar-backdrop').style.display = 'none';
    document.getElementById('sidebar-toggle').style.display = 'none';
    const wrapper = document.querySelector('.main-wrapper');
    wrapper.style.width = '100%';
    wrapper.style.marginLeft = '0';
    document.getElementById('header-title').textContent = 'Student Examinations';
    document.getElementById('header-title').style.display = '';
    document.querySelector('.header-right').style.display = 'none';
    this.renderGuestEntry();
  },

  renderGuestEntry(message = '') {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.activeAttempt = null;
    const name = this.guestIdentity?.fullName || '';
    const className = this.guestIdentity?.className || '';
    const exams = this.guestExams.map(exam => {
      const status = exam.status;
      const isOpen = status === 'open' && exam.available;
      const button = isOpen
        ? `<button class="btn btn-primary" onclick="ExaminationCentre.startGuest('${exam.id}')"><i data-lucide="play"></i> Start test</button>`
        : status === 'closed'
          ? `<button class="btn btn-outline" onclick="ExaminationCentre.startGuest('${exam.id}')"><i data-lucide="rotate-ccw"></i> Continue an existing attempt</button>`
          : `<p class="text-sm text-muted">${status === 'published' ? 'Waiting for the teacher to open this test.' : status === 'open' ? 'This test is not within its scheduled time.' : 'This test is not available for new attempts.'}</p>`;
      return `
      <article class="ec-exam-card">
        <span class="badge ${this.statusClass(status)}">${Utils.escapeHtml(status)}</span>
        <h3>${Utils.escapeHtml(exam.title)}</h3>
        <p>${Utils.escapeHtml(exam.description || '')}</p>
        <p class="text-sm text-muted">${exam.duration_minutes ? `${Utils.escapeHtml(exam.duration_minutes)} minutes` : 'No timer'} · ${Utils.escapeHtml(exam.attempt_limit)} attempt${Number(exam.attempt_limit) === 1 ? '' : 's'}</p>
        ${button}
        <button class="btn btn-sm btn-outline" onclick="ExaminationCentre.checkGuestResult('${exam.id}')">Check a saved result</button>
      </article>`;
    }).join('');
    setContent(`<section class="ec-page ec-guest-page">
      <div class="ec-page-head"><div><h2>Take an examination</h2><p>Enter your class to see its tests. You will be asked for your name when you choose a test.</p></div><div class="ec-head-actions"><a class="btn btn-outline" href="index.html#public-home"><i data-lucide="home"></i> School portal</a><a class="btn btn-outline" href="index.html#staff-login"><i data-lucide="log-in"></i> Staff sign in</a></div></div>
      <form class="ec-guest-form" onsubmit="ExaminationCentre.findGuestExams(event)">
        <p class="text-sm text-muted">No account or name is needed to view the tests for your class.</p>
        <label class="form-label" for="ec-guest-class">Class</label><input class="input-field" id="ec-guest-class" maxlength="120" required value="${Utils.escapeHtml(className)}" placeholder="Write your class exactly as used by the school">
        <button class="btn btn-primary" type="submit"><i data-lucide="search"></i> Show class tests</button>
      </form>
      ${message ? `<div class="alert alert-info">${Utils.escapeHtml(message)}</div>` : ''}
      ${this.guestClassSearched ? (exams
        ? `<h3 class="ec-section-title">Tests for ${Utils.escapeHtml(className)}</h3><div class="ec-exam-grid">${exams}</div>`
        : `<div class="ec-empty"><h3>No tests found</h3><p>There are no examinations for this class.</p><p>Check the class name spelling with your teacher.</p></div>`) : ''}
    </section>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async findGuestExams(event) {
    event?.preventDefault();
    const className = document.getElementById('ec-guest-class')?.value.trim();
    if (!className) return Utils.toast('Enter your class.', 'error');
    this.guestIdentity = { fullName: '', className };
    this.guestClassSearched = true;
    try {
      const { data, error } = await sbClient.rpc('rms_exam_guest_list', { p_class_name: className });
      if (error) throw error;
      this.guestExams = Array.isArray(data) ? data : [];
      this.renderGuestEntry(this.guestExams.length ? '' : 'There are no examinations for that class.');
    } catch (error) {
      console.error('[ExaminationCentre] Guest examination lookup failed:', error);
      this.renderGuestEntry('Could not load tests. Please check your class spelling and try again.');
      Utils.toast(error.message || 'Could not find an available test.', 'error');
    }
  },

  startGuestFromPreview(exam, className) {
    if (!exam?.id || !className) {
      return Utils.toast('Search for your class before choosing a test.', 'error');
    }
    this.guestIdentity = { fullName: '', className };
    this.guestExams = [exam];
    this.guestClassSearched = true;
    window.history.pushState(null, '', '#guest-examinations');
    this.openGuestPortal();
    this.startGuest(exam.id);
  },

  async startGuest(examId) {
    const identity = this.guestIdentity;
    if (!identity?.className) return this.renderGuestEntry('Enter your class before choosing a test.');
    if (!identity.fullName) {
      const exam = this.guestExams.find(item => String(item.id) === String(examId));
      const assignedClasses = Array.isArray(exam?.class_names) ? exam.class_names : [];
      const normalizedClass = value => String(value || '').trim().toLowerCase().replace(/\s+/g, '');
      const exactClass = assignedClasses.find(name => normalizedClass(name) === normalizedClass(identity.className));
      if (exactClass) identity.className = exactClass;
      else if (assignedClasses.length === 1) identity.className = assignedClasses[0];
      const classField = assignedClasses.length > 1 && !exactClass
        ? `<label class="form-label" for="ec-guest-attempt-class">Choose your section</label>
          <select class="input-field" id="ec-guest-attempt-class" required>${assignedClasses.map(name => `<option value="${Utils.escapeHtml(name)}">${Utils.escapeHtml(name)}</option>`).join('')}</select>`
        : '';
      Modal.show('Enter your name to continue', `
        <p class="text-sm text-muted">Use the same name if you are continuing an existing attempt. Guest names are not verified.</p>
        ${classField}
        <label class="form-label" for="ec-guest-attempt-name">Student full name</label>
        <input class="input-field" id="ec-guest-attempt-name" autocomplete="name" maxlength="120" required placeholder="Write your full name">`,
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.confirmGuestName('${examId}')">Continue to test</button>`, true);
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }
    try {
      const { data, error } = await sbClient.rpc('rms_exam_guest_start', {
        p_exam_id: examId, p_full_name: identity.fullName, p_class_name: identity.className
      });
      if (error) throw error;
      data.guest = true;
      this.activeAttempt = data;
      this.activeAttempt.answers = { ...(data.answers || {}) };
      Object.assign(this.activeAttempt.answers, data.responses || {});
      this.activeAttempt.pending = new Set();
      this.activeAttempt.currentIndex = 0;
      const local = JSON.parse(localStorage.getItem(this.localKey(data.attempt_id) + ':answers') || '{}');
      Object.assign(this.activeAttempt.answers, local);
      this.activeAttempt.pending = new Set(Object.keys(local));
      const savedIndex = Number(localStorage.getItem(this.localKey(data.attempt_id) + ':index'));
      if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < data.questions.length) this.activeAttempt.currentIndex = savedIndex;
      if (this.activeAttempt.pending.size && navigator.onLine) this.syncPending();
      this.renderQuestion();
    } catch (error) {
      console.error('[ExaminationCentre] Guest exam start failed:', error);
      if (error?.code === 'PGRST202') {
        return Utils.toast(
          'The guest examination service is not available in Supabase yet. Run the latest examination_centre.sql migration, then refresh the page.',
          'error'
        );
      }
      Utils.toast(error.message || 'Could not start the examination.', 'error');
    }
  },

  guestResultStorageKey(examId) {
    const identity = this.guestIdentity;
    if (!identity?.fullName) return null;
    return `rms_exam_guest_result_${examId}_${encodeURIComponent(identity.fullName.trim().toLowerCase())}`;
  },

  async checkGuestResult(examId) {
    if (!this.guestIdentity?.fullName) {
      Modal.show('Check a saved result', `
        <p class="text-sm text-muted">Enter the same name and class used for the submitted guest test. Results can only be checked in the browser that saved the attempt.</p>
        <label class="form-label" for="ec-guest-result-name">Student full name</label><input class="input-field" id="ec-guest-result-name" maxlength="120" required value="${Utils.escapeHtml(this.guestIdentity?.fullName || '')}">`,
        `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button><button class="btn btn-primary" onclick="ExaminationCentre.confirmGuestResult('${examId}')">Check result</button>`, true);
      return;
    }
    await this.loadGuestResult(examId);
  },

  confirmGuestResult(examId) {
    const fullName = document.getElementById('ec-guest-result-name')?.value.trim();
    if (!fullName || fullName.length > 120) return Utils.toast('Enter your full name (up to 120 characters).', 'error');
    if (this.guestIdentity) this.guestIdentity.fullName = fullName;
    Modal.close();
    this.loadGuestResult(examId);
  },

  async loadGuestResult(examId, pendingResult = null) {
    const immediateResult = pendingResult || this.pendingGuestResult;
    const key = this.guestResultStorageKey(examId);
    if (!key && (!immediateResult || String(immediateResult.exam_id) !== String(examId))) {
      return Utils.toast('Enter your class and the same name used for the test.', 'error');
    }
    try {
      const identity = this.guestIdentity;
      const legacyKey = key && identity?.className
        ? `rms_exam_guest_result_${examId}_${encodeURIComponent(identity.className.trim().toLowerCase())}_${encodeURIComponent(identity.fullName.trim().toLowerCase())}`
        : null;
      let saved = immediateResult;
      if (!saved || String(saved.exam_id) !== String(examId)) {
        saved = JSON.parse((key ? localStorage.getItem(key) : null)
          || (legacyKey ? localStorage.getItem(legacyKey) : null) || 'null');
      }
      if (!saved?.attempt_id || !saved?.guest_token) {
        return Utils.toast('No submitted result was saved on this browser for that name. Return to the same device and enter the name used for the test.', 'info');
      }
      this.pendingGuestResult = { ...saved, exam_id: String(examId) };
      if (key && !localStorage.getItem(key)) {
        try {
          localStorage.setItem(key, JSON.stringify(saved));
        } catch (storageError) {
          console.warn('[ExaminationCentre] Guest result access could not be saved for later:', storageError);
        }
      }
      const { data, error } = await sbClient.rpc('rms_exam_guest_submit', {
        p_attempt_id: saved.attempt_id, p_guest_token: saved.guest_token
      });
      if (error) throw error;
      data.guest = true;
      await this.renderResult(data, {
        guest: true, title: data.title, exam_id: examId,
        attempt_id: saved.attempt_id, guest_token: saved.guest_token
      });
    } catch (error) {
      console.error('[ExaminationCentre] Guest result lookup failed:', error);
      Utils.toast(error.message || 'Could not check the saved result.', 'error');
    }
  },

  confirmGuestName(examId) {
    const fullName = document.getElementById('ec-guest-attempt-name')?.value.trim();
    if (!fullName || fullName.length > 120) return Utils.toast('Enter your full name (up to 120 characters).', 'error');
    if (this.guestIdentity) {
      this.guestIdentity.fullName = fullName;
      const selectedClass = document.getElementById('ec-guest-attempt-class')?.value;
      const exam = this.guestExams.find(item => String(item.id) === String(examId));
      if (selectedClass && exam?.class_names?.includes(selectedClass)) {
        this.guestIdentity.className = selectedClass;
      }
    }
    Modal.close();
    this.startGuest(examId);
  },

  async start(examId) {
    try {
      const { data, error } = await sbClient.rpc('rms_exam_start', { p_exam_id: examId });
      if (error) throw error;
      if (data.submitted) {
        for (const suffix of [':answers', ':index']) localStorage.removeItem(this.localKey(data.attempt_id) + suffix);
        await this.renderResult(data, { title: data.title });
        return;
      }
      this.activeAttempt = data;
      this.activeAttempt.answers = { ...(data.answers || {}) };
      Object.assign(this.activeAttempt.answers, data.responses || {});
      this.activeAttempt.pending = new Set();
      this.activeAttempt.currentIndex = 0;
      const savedIndex = Number(localStorage.getItem(this.localKey(data.attempt_id) + ':index'));
      if (Number.isInteger(savedIndex) && savedIndex >= 0 && savedIndex < data.questions.length) this.activeAttempt.currentIndex = savedIndex;
      const local = JSON.parse(localStorage.getItem(this.localKey(data.attempt_id) + ':answers') || '{}');
      Object.assign(this.activeAttempt.answers, local);
      this.activeAttempt.pending = new Set(Object.keys(local));
      if (this.activeAttempt.pending.size && navigator.onLine) this.syncPending();
      this.renderQuestion();
    } catch (error) {
      console.error('[ExaminationCentre] Exam start failed:', error);
      Utils.toast(error.message || 'Could not start examination. Check your connection and try again.', 'error');
    }
  },

  renderQuestion() {
    const attempt = this.activeAttempt;
    if (!attempt) return;
    const question = attempt.questions[attempt.currentIndex];
    const index = attempt.currentIndex;
    const answer = attempt.answers[question.id] || '';
    setHeader(attempt.title, 'Question ' + (index + 1) + ' of ' + attempt.question_count);
    const progress = Math.round((index + 1) / attempt.question_count * 100);
    const prior = attempt.allow_previous && index > 0 ? `<button class="btn btn-outline ec-touch" onclick="ExaminationCentre.previous()">← Previous</button>` : '<span></span>';
    const next = index === attempt.question_count - 1
      ? `<button class="btn btn-primary ec-touch" onclick="ExaminationCentre.submit()">Submit Examination</button>`
      : `<button class="btn btn-primary ec-touch" onclick="ExaminationCentre.next()">Continue →</button>`;
    setContent(`<main class="ec-taking" aria-labelledby="ec-live-question">
      <div class="ec-taking-head"><div><span class="ec-timer-label">TIME REMAINING</span><strong id="ec-timer">${attempt.duration_minutes || attempt.end_at ? '—' : 'Untimed'}</strong></div><button class="btn btn-sm btn-outline" onclick="ExaminationCentre.exitAttempt()">Save & Exit</button></div>
      <div class="ec-progress"><span style="width:${progress}%"></span></div><p class="ec-progress-label">Question ${index+1} of ${attempt.question_count}</p>
      <article class="ec-question-live"><h1 id="ec-live-question">${Utils.escapeHtml(question.question_text)}</h1>${this.renderQuestionMedia(question)}${question.question_type === 'written_response'
        ? `<label class="form-label" for="ec-written-answer">Your written response</label><textarea class="textarea-field ec-written-answer" id="ec-written-answer" rows="8" maxlength="10000" oninput="ExaminationCentre.answer('${question.id}',this.value,true)" placeholder="Write your answer here">${Utils.escapeHtml(answer)}</textarea>`
        : `<fieldset><legend>Select one answer</legend>${question.options.map(option=>`<label class="ec-answer ${answer===option.key?'selected':''}"><input type="radio" name="ec-answer" value="${option.key}" ${answer===option.key?'checked':''} onchange="ExaminationCentre.answer('${question.id}',this.value)"><span class="ec-radio-mark"></span><span><b>${option.key}.</b> ${Utils.escapeHtml(option.text)}</span></label>`).join('')}</fieldset>`}<div id="ec-save-state" role="status" aria-live="polite">${attempt.pending.has(question.id) ? 'Saving answer…' : answer ? '✓ Answer saved' : question.question_type === 'written_response' ? 'Your teacher will mark this response' : 'Choose one answer'}</div></article>
      <div class="ec-question-nav">${prior}${next}</div><p class="ec-warning">Your answers are saved as you go. Multiple-choice questions are marked automatically; written responses are marked by your teacher. The timer is checked securely by RMS.</p>
    </main>`);
    this.typesetMath(document.querySelector('.ec-question-live'));
    this.updateTimer();
    if (this.timer) clearInterval(this.timer);
    if (attempt.duration_minutes || attempt.end_at) this.timer = setInterval(() => this.updateTimer(), 1000);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  answer(questionId, option, debounce = false) {
    const attempt = this.activeAttempt;
    if (!attempt || this.busy) return;
    attempt.answers[questionId] = option;
    attempt.pending.add(questionId);
    try {
      localStorage.setItem(this.localKey(attempt.attempt_id) + ':answers', JSON.stringify(attempt.answers));
    } catch (error) {
      console.error('[ExaminationCentre] Could not save local answer backup:', error);
      Utils.toast('Could not save a local answer backup. Keep this page open until the answer syncs.', 'error');
    }
    document.querySelectorAll('.ec-answer').forEach(label => label.classList.toggle('selected', label.querySelector('input')?.checked));
    const state = document.getElementById('ec-save-state');
    if (state) state.textContent = 'Saving answer…';
    if (debounce) {
      attempt.writeTimers = attempt.writeTimers || {};
      clearTimeout(attempt.writeTimers[questionId]);
      attempt.writeTimers[questionId] = setTimeout(() => this.syncAnswer(questionId, attempt.answers[questionId]), 500);
    } else {
      this.syncAnswer(questionId, option);
    }
  },

  async syncAnswer(questionId, option) {
    const attempt = this.activeAttempt;
    if (attempt?.writeTimers?.[questionId]) {
      clearTimeout(attempt.writeTimers[questionId]);
      delete attempt.writeTimers[questionId];
    }
    try {
      if (!navigator.onLine) throw new Error('You are offline. This answer is saved on this device and will sync when connection returns.');
      const question = attempt.questions.find(item => String(item.id) === String(questionId));
      if (!question) throw new Error('Question is not part of this attempt.');
      const written = question.question_type === 'written_response';
      const { error } = attempt.guest
        ? await sbClient.rpc(written ? 'rms_exam_guest_save_written_answer' : 'rms_exam_guest_save_answer', written
          ? { p_attempt_id: attempt.attempt_id, p_guest_token: attempt.guest_token, p_question_id: questionId, p_response: option }
          : { p_attempt_id: attempt.attempt_id, p_guest_token: attempt.guest_token, p_question_id: questionId, p_option: option })
        : await sbClient.rpc(written ? 'rms_exam_save_written_answer' : 'rms_exam_save_answer', written
          ? { p_attempt_id: attempt.attempt_id, p_question_id: questionId, p_response: option }
          : { p_attempt_id: attempt.attempt_id, p_question_id: questionId, p_option: option });
      if (error) throw error;
      if (attempt.answers[questionId] !== option) {
        await this.syncAnswer(questionId, attempt.answers[questionId]);
        return;
      }
      attempt.pending.delete(questionId);
      const localAnswers = JSON.parse(localStorage.getItem(this.localKey(attempt.attempt_id) + ':answers') || '{}');
      delete localAnswers[questionId];
      if (Object.keys(localAnswers).length) localStorage.setItem(this.localKey(attempt.attempt_id) + ':answers', JSON.stringify(localAnswers));
      else localStorage.removeItem(this.localKey(attempt.attempt_id) + ':answers');
      if (this.activeAttempt === attempt && attempt.questions[attempt.currentIndex]?.id === questionId) {
        const state = document.getElementById('ec-save-state');
        if (state) state.textContent = '✓ Answer saved';
      }
    } catch (error) {
      console.warn('[ExaminationCentre] Answer sync pending:', error);
      attempt.pending.add(questionId);
      if (this.activeAttempt === attempt && attempt.questions[attempt.currentIndex]?.id === questionId) {
        const state = document.getElementById('ec-save-state');
        if (state) state.textContent = 'Saved on this device · sync pending';
      }
    }
  },

  async syncPending() {
    const attempt = this.activeAttempt;
    if (!attempt || !navigator.onLine) return;
    for (const questionId of [...attempt.pending]) {
      await this.syncAnswer(questionId, attempt.answers[questionId]);
    }
  },

  async next() {
    const attempt = this.activeAttempt;
    if (!attempt || attempt.currentIndex >= attempt.questions.length - 1) return;
    await this.syncPending();
    const question = attempt.questions[attempt.currentIndex];
    if (attempt.pending.has(question.id)) {
      Utils.toast('Answer is saved on this device but has not synced. Reconnect before continuing.', 'warning');
      return;
    }
    attempt.currentIndex++;
    localStorage.setItem(this.localKey(attempt.attempt_id) + ':index', String(attempt.currentIndex));
    this.renderQuestion();
  },

  previous() {
    const attempt = this.activeAttempt;
    if (!attempt?.allow_previous || attempt.currentIndex <= 0) return;
    attempt.currentIndex--;
    localStorage.setItem(this.localKey(attempt.attempt_id) + ':index', String(attempt.currentIndex));
    this.renderQuestion();
  },

  async submit(timeout = false) {
    const attempt = this.activeAttempt;
    if (!attempt || this.busy) return;
    if (!timeout && !confirm('Submit this examination? You cannot change your answers after submission.')) return;
    this.busy = true;
    try {
      if (!timeout) {
        await this.syncPending();
        if (attempt.pending.size) throw new Error('Some answers have not synced. Reconnect and try submitting again.');
      } else {
        Object.values(attempt.writeTimers || {}).forEach(timer => clearTimeout(timer));
        attempt.writeTimers = {};
      }
      const { data, error } = attempt.guest
        ? await sbClient.rpc('rms_exam_guest_submit', { p_attempt_id: attempt.attempt_id, p_guest_token: attempt.guest_token })
        : await sbClient.rpc('rms_exam_submit', { p_attempt_id: attempt.attempt_id });
      if (error) throw error;
      if (this.timer) clearInterval(this.timer);
      this.timer = null;
      if (attempt.guest) {
        this.pendingGuestResult = {
          exam_id: attempt.exam_id,
          attempt_id: attempt.attempt_id,
          guest_token: attempt.guest_token
        };
        const resultKey = this.guestResultStorageKey(attempt.exam_id);
        if (resultKey) {
          try {
            localStorage.setItem(resultKey, JSON.stringify({
              attempt_id: attempt.attempt_id,
              guest_token: attempt.guest_token
            }));
          } catch (storageError) {
            console.error('[ExaminationCentre] Could not save guest result access on this device:', storageError);
            Utils.toast('Your result was submitted, but this browser could not save the access needed to check it later.', 'warning');
          }
        }
      }
      for (const suffix of [':answers', ':index']) localStorage.removeItem(this.localKey(attempt.attempt_id) + suffix);
      this.activeAttempt = null;
      if (timeout && attempt.pending.size) data.unsynced_answers = attempt.pending.size;
      await this.renderResult(data, attempt);
    } catch (error) {
      console.error('[ExaminationCentre] Submission failed:', error);
      Utils.toast(error.message || 'Could not submit the examination. Your saved answers remain available.', 'error');
    } finally {
      this.busy = false;
    }
  },

  async renderResult(result, attempt) {
    setHeader('Examination Submitted', attempt.title);
    const scoreReady = !result.manual_marking_pending && result.score != null;
    this.pendingReview = Array.isArray(result.review) ? result.review : null;
    this.pendingReviewTitle = attempt.title || result.title || 'Examination';
    let grade = 'Unavailable';
    if (scoreReady && !attempt.guest) {
      try {
        const gradeScale = await DB.get('grading_scales');
        grade = Utils.grade(Number(result.percentage), gradeScale);
      } catch (error) {
        console.error('[ExaminationCentre] Grade lookup failed:', error);
        grade = Utils.grade(Number(result.percentage), []);
      }
    }
    const resultMessage = scoreReady
      ? 'Your marks and answer review are ready.'
      : result.manual_marking_pending
        ? 'Your answers and the correct answers are shown below. Your teacher will mark the written responses before your final score is ready.'
        : 'Your answers are saved. Your teacher will release your marks and answers when they are ready.';
    const answerReview = this.pendingReview
      ? `<section class="ec-answer-review"><h2>All questions and answers</h2><p>Your submitted answers are shown with the correct answers.</p>${this.renderReviewCards(this.pendingReview)}<button class="btn btn-outline" onclick="ExaminationCentre.${attempt.guest ? 'renderGuestEntry()' : 'renderLearner()'}">Back to examinations</button></section>`
      : `<button class="btn btn-primary" onclick="ExaminationCentre.checkSubmittedResult('${attempt.exam_id || result.exam_id || ''}',${attempt.guest ? 'true' : 'false'})"><i data-lucide="refresh-cw"></i> Check marks and answers</button>`;
    setContent(`<section class="ec-result${this.pendingReview ? ' ec-result-with-review' : ''}"><div class="ec-result-icon"><i data-lucide="${scoreReady ? 'check-circle-2' : 'send'}"></i></div><h1>Congratulations, dear student!</h1><p>${result.status === 'timed_out' ? 'Your time ended, and your examination has been submitted.' : 'You have submitted your examination successfully.'}</p><p>${resultMessage}</p>${result.unsynced_answers ? `<div class="alert alert-warning">${Utils.escapeHtml(result.unsynced_answers)} answer${result.unsynced_answers === 1 ? ' was' : 's were'} still waiting to sync when time expired and may not be included in the submitted result.</div>` : ''}${scoreReady ? `<div class="ec-result-score"><strong>${Utils.escapeHtml(result.score)}/${Utils.escapeHtml(result.total_marks)}</strong><span>${Utils.escapeHtml(result.percentage)}%</span></div><div class="ec-result-detail"><span>Correct answers</span><b>${Utils.escapeHtml(result.correct_count)}</b><span>Wrong answers</span><b>${Utils.escapeHtml(result.wrong_count)}</b>${attempt.guest ? '' : `<span>Grade</span><b>${Utils.escapeHtml(grade)}</b>`}</div>` : ''}${answerReview}</section>`);
    if (this.pendingReview) this.typesetMath(document.querySelector('.ec-answer-review'));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async checkSubmittedResult(examId, guest) {
    if (this.pendingReview) return this.showSubmittedReview();
    if (guest) return this.loadGuestResult(examId, this.pendingGuestResult);
    await this.renderLearner();
    Utils.toast('Your teacher will make the marks and answers available here after releasing the results.', 'info');
  },

  showSubmittedReview() {
    if (!this.pendingReview) return Utils.toast('The answer review is not available yet.', 'info');
    this.renderAnswerReview(this.pendingReviewTitle, { questions: this.pendingReview });
  },

  renderAnswerReview(title, review) {
    const questions = Array.isArray(review?.questions) ? review.questions : [];
    this.pendingReview = questions;
    this.pendingReviewTitle = title;
    setHeader('Answer Review', title);
    setContent(`<section class="ec-page ec-answer-review"><div class="ec-page-head"><div><h2>${Utils.escapeHtml(title)} · Answer review</h2><p>Your submitted answers are shown with the correct answers and feedback.</p>${review.score != null ? `<p><strong>Score: ${Utils.escapeHtml(review.score)}/${Utils.escapeHtml(review.total_marks)} · ${Utils.escapeHtml(review.percentage)}%</strong></p>` : ''}</div></div>${this.renderReviewCards(questions) || '<div class="ec-empty">No question review is available.</div>'}<button class="btn btn-primary" onclick="ExaminationCentre.${Auth.getRole() === 'learner' ? 'renderLearner()' : 'renderGuestEntry()'}">Back to examinations</button></section>`);
    this.typesetMath(document.querySelector('.ec-answer-review'));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  renderReviewCards(questions) {
    const cards = questions.map((question, index) => {
      const written = question.question_type === 'written_response';
      const options = (question.options || []).map(option => {
        const selected = option.selected || option.key === question.selected_option;
        const correct = option.correct || option.key === question.correct_option;
        return `<li class="ec-review-option${selected ? ' is-selected' : ''}${correct ? ' is-correct' : ''}"><strong>${Utils.escapeHtml(option.key)}.</strong> ${Utils.escapeHtml(option.text)}${selected ? '<span>You chose this</span>' : ''}${correct ? '<span>Correct answer</span>' : ''}</li>`;
      }).join('');
      const marksDisplay = written && !question.marked_at
        ? 'Awaiting teacher marking'
        : `${Utils.escapeHtml(question.marks_awarded ?? 0)} / ${Utils.escapeHtml(question.marks)} marks`;
      return `<article class="ec-review-question"><div class="ec-review-heading"><strong>Question ${index + 1}</strong><span>${marksDisplay}</span></div><p class="ec-review-prompt">${Utils.escapeHtml(question.question_text)}</p>${this.renderQuestionMedia(question)}${written
        ? `<p class="ec-review-response"><strong>Your response</strong><br>${Utils.escapeHtml(question.response_text || 'No response recorded')}</p>${question.explanation ? `<p class="ec-review-feedback"><strong>Explanation</strong><br>${Utils.escapeHtml(question.explanation)}</p>` : ''}${question.teacher_feedback ? `<p class="ec-review-feedback"><strong>Teacher feedback</strong><br>${Utils.escapeHtml(question.teacher_feedback)}</p>` : ''}`
        : `<ul class="ec-review-options">${options}</ul><p class="ec-review-outcome">${question.is_correct ? 'Your answer was correct.' : `Your answer: ${Utils.escapeHtml(question.selected_option || 'No answer')}. Correct answer: ${Utils.escapeHtml(question.correct_option || 'Unavailable')}.`}</p>${question.explanation ? `<p class="ec-review-feedback"><strong>Explanation</strong><br>${Utils.escapeHtml(question.explanation)}</p>` : ''}`}</article>`;
    }).join('');
    return cards;
  },

  updateTimer() {
    const attempt = this.activeAttempt;
    const node = document.getElementById('ec-timer');
    if (!attempt || !node) return;
    const deadlines = [];
    if (attempt.duration_minutes) deadlines.push(new Date(attempt.started_at).getTime() + Number(attempt.duration_minutes) * 60000);
    if (attempt.end_at) deadlines.push(new Date(attempt.end_at).getTime());
    if (!deadlines.length) return;
    const deadline = Math.min(...deadlines);
    const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const mins = String(Math.floor(remaining / 60)).padStart(2, '0');
    const secs = String(remaining % 60).padStart(2, '0');
    node.textContent = `${mins}:${secs}`;
    node.classList.toggle('expired', remaining === 0);
    if (remaining === 0 && !this.busy && !attempt.autoSubmitTried) {
      attempt.autoSubmitTried = true;
      this.submit(true);
    }
  },

  exitAttempt() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    Object.values(this.activeAttempt?.writeTimers || {}).forEach(timer => clearTimeout(timer));
    const guest = this.activeAttempt?.guest;
    this.activeAttempt = null;
    if (guest) this.renderGuestEntry();
    else this.renderLearner();
  },

  localKey(attemptId) {
    const attempt = this.activeAttempt;
    return attempt?.guest
      ? `rms_exam_guest_${attempt.guest_token}_${attemptId}`
      : 'rms_exam_' + Auth.currentUser.id + '_' + attemptId;
  },

  statusClass(status) {
    return ({ draft: 'badge-warning', published: 'badge-info', open: 'badge-success', closed: 'badge-gray', archived: 'badge-gray' })[status] || 'badge-gray';
  },

  datetimeInput(value) {
    if (!value) return '';
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  },

  errorHtml(error) {
    return `<div class="alert alert-error"><i data-lucide="alert-circle"></i><div><strong>Examination Centre could not load.</strong><br>${Utils.escapeHtml(error?.message || 'Please check your connection and database setup.')}</div></div>`;
  }
};

window.addEventListener('online', () => ExaminationCentre.onOnline());
