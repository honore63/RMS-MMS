/* ============================================================
   BULK MARKS CONVERSION — SINGLE PAGE (teacher)
   Combine MULTIPLE assessments into ONE converted assessment.
   Everything lives on ONE scrolling page in 3 steps:
     Step 1 · Setup  — class, subject, year, term + select assessments
     Step 2 · Convert — target maximum, target assessment + auto review
     Step 3 · Report & Save — preview, export + confirm & save

   Formula (per student, missing marks never treated as zero):
     Total Obtained = sum of present marks
     Total Possible  = sum of maximums of present assessments
     Converted       = round((Total Obtained / Total Possible) * target)
   ============================================================ */

let bulkConvert = null;   // page state
let bulkApplying = false; // realtime guard: never rebuild mid-conversion
let bulkSearch = '';
let bulkFilter = 'convertible';
let bulkOnlyMissing = false;
let bulkMissingZero = true; // missing marks count as zero (user-toggleable)
let bulkReviewView = 'sheet'; // 'sheet' = converted-marks page, 'full' = full review
let bulkLibView = null; // currently opened saved conversion { helper, max, rows }

async function renderConvertMarks() {
  setHeader('Convert Marks', 'Combine multiple assessments and convert all students' + "'" + ' marks into one assessment');
  setContent(Utils.loading());

  const ok = await loadTeacherContext();
  if (!ok) { setContent(Utils.empty('No teacher profile found', 'user-x')); return; }
  const teacherId = Auth.getTeacherId();
  if (!teacherId) { setContent(Utils.empty('Your account is not linked to a teacher profile.', 'user-x')); return; }

  /* Full-row reads: academic_years/terms schemas vary (status/is_active/
     is_current, term_no/sequence), and a wrong explicit column list makes
     the whole query fail silently — so select * and sort client-side. */
  const [yearsRaw, termsRaw, classes, subjects, types, grading, settingsData, assessments, learners] = await Promise.all([
    DB.get('academic_years').catch(() => []),
    DB.get('terms').catch(() => []),
    DB.get('classes'),
    DB.get('subjects'),
    getAssessmentTypes(),
    Utils.getGradingScale(),
    DB.query('school_settings', '*'),
    DB.query('assessments', '*', { teacher_id: teacherId }, { column: 'assessment_date', asc: true }, 500),
    DB.get('learners').catch(() => [])
  ]);
  const isYearActive = y => y && (y.is_active || y.is_current || y.status === 'active');
  const years = [...(yearsRaw || [])].sort((a, b) => Number(isYearActive(b)) - Number(isYearActive(a)) || String(b.name || '').localeCompare(String(a.name || '')));
  const termOrd = t => t.term_no ?? t.sequence ?? t.term_number ?? 0;
  const terms = [...(termsRaw || [])].sort((a, b) => (Number(termOrd(a)) - Number(termOrd(b))) || String(a.name || '').localeCompare(String(b.name || '')));

  const counts = {};
  const marksByAssess = new Map();
  if (assessments.length) {
    try {
      const ids = assessments.map(a => a.id);
      const { data } = await sbClient.from('marks').select('assessment_id, learner_id, mark').in('assessment_id', ids);
      (data || []).forEach(m => {
        const kid = String(m.assessment_id);
        if (!marksByAssess.has(kid)) marksByAssess.set(kid, new Map());
        if (m.mark != null) { marksByAssess.get(kid).set(String(m.learner_id), Number(m.mark)); counts[kid] = (counts[kid] || 0) + 1; }
      });
    } catch (e) { console.error('Convert: progress count error', e); }
  }

  const settings = settingsData[0] || {};
  const classMap = new Map(classes.map(c => [c.id, c]));
  const subjMap = new Map(subjects.map(s => [s.id, s]));
  const allowed = new Set(teacherAssignments.map(a => a.class_id + '|' + a.subject_id));

  /* Real defaults: prefer the genuinely active year/term (supports both
     `is_active` and legacy `status` flags), then shared context, then first. */
  const defaultYear = years.find(y => y.is_active || y.is_current || y.status === 'active')
    || (activeYear && years.find(y => String(y.id) === String(activeYear.id)))
    || years[0] || null;
  const defaultYearTerms = defaultYear ? terms.filter(t => String(t.academic_year_id) === String(defaultYear.id)) : [];
  const defaultTerm = defaultYearTerms.find(t => t.is_active || t.is_current || t.status === 'active')
    || (activeTerm && defaultYearTerms.find(t => String(t.id) === String(activeTerm.id)))
    || defaultYearTerms[0] || null;

  bulkConvert = {
    teacherId, teacherName: Auth.currentUser?.full_name || 'Teacher',
    years, terms, classMap, subjMap, types, counts, marksByAssess, settings,
    grading,
    pass: settings.pass_mark != null ? Number(settings.pass_mark) : 50,
    decimals: settings.decimal_marks_enabled ? 1 : 0,
    assessments: assessments.map(a => ({
      a,
      saved: counts[a.id] || 0,
      /* Any status can be a SOURCE (draft → locked): conversion only READS
         source marks into a separate helper — originals are never modified,
         so approved assessments stay exactly as the DOS approved them. */
      editable: (counts[a.id] || 0) > 0 && allowed.has(a.class_id + '|' + a.subject_id)
    })),
    allowed,
    selClassId: null, selSubjectId: null, selYearId: (defaultYear && defaultYear.id) || '',
    selTermId: (defaultTerm && defaultTerm.id) || '',
    selAssess: new Set(),
    target: 30,
    conversion: null,
    learners,
    targetMode: 'new', targetAssessId: '', targetTypeId: types[0]?.id || '',
    targetName: '', targetDate: new Date().toISOString().slice(0, 10), targetStatus: 'draft', targetExisting: [],
    saved: false, savedInfo: null
  };

  const classIds = [...new Set(teacherAssignments.map(a => a.class_id))];
  if (classIds.length) bulkConvert.selClassId = classIds[0];
  const firstSubject = teacherAssignments.find(a => String(a.class_id) === String(bulkConvert.selClassId));
  if (firstSubject) bulkConvert.selSubjectId = firstSubject.subject_id;

  bulkRenderPage();
}

function bulkStepSubjectList() {
  const bc = bulkConvert;
  return [...new Set(teacherAssignments.filter(a => String(a.class_id) === String(bc.selClassId)).map(a => a.subject_id))];
}

function bulkRefreshExisting() {
  const bc = bulkConvert;
  bc.targetExisting = bc.assessments.filter(r =>
    r.a.id !== undefined &&
    !(Utils.isConversionHelper && Utils.isConversionHelper(r.a)) &&
    String(r.a.class_id) === String(bc.selClassId) &&
    String(r.a.subject_id) === String(bc.selSubjectId) &&
    String(r.a.academic_year_id) === String(bc.selYearId) &&
    (r.saved === 0) && (['draft', 'rejected'].includes(r.a.status))
  );
  if (bc.targetAssessId && !bc.targetExisting.some(r => String(r.a.id) === String(bc.targetAssessId))) {
    bc.targetAssessId = '';
  }
}

/* ---------------- Full page render (one scrolling page) ---------------- */

function bulkRenderPage() {
  const bc = bulkConvert;
  if (!bc) return;
  if (bc.saved) { bulkRenderSaved(); return; }
  bulkRefreshExisting();

  const yearsOpts = bc.years.map(y => {
    const yearsIn = bc.terms.filter(t => String(t.academic_year_id) === String(y.id));
    const label = (y.name || 'Year') + ((y.is_active || y.is_current || y.status === 'active') ? ' (Active)' : '');
    return `<option value="${y.id}" ${String(bc.selYearId) === String(y.id) ? 'selected' : ''}>${Utils.escapeHtml(label)} — ${yearsIn.length} term${yearsIn.length === 1 ? '' : 's'}</option>`;
  }).join('') || '<option value="">No academic years found</option>';
  const termsOpts = (bc.terms.filter(t => String(t.academic_year_id) === String(bc.selYearId))).map(t => {
    return `<option value="${t.id}" ${String(bc.selTermId) === String(t.id) ? 'selected' : ''}>${Utils.escapeHtml(t.name)}${(t.is_active || t.is_current || t.status === 'active') ? ' (Active)' : ''}</option>`;
  }).join('') || '<option value="">No terms for this year</option>';
  const classOpts = [...new Set(teacherAssignments.map(a => a.class_id))].map(cid => {
    const c = bc.classMap.get(cid);
    return `<option value="${cid}" ${String(bc.selClassId) === String(cid) ? 'selected' : ''}>${Utils.escapeHtml(c?.name || 'Class')}</option>`;
  }).join('') || '<option value="">No assigned class</option>';
  const subjOpts = bulkStepSubjectList().map(sid => {
    const s = bc.subjMap.get(sid);
    return `<option value="${sid}" ${String(bc.selSubjectId) === String(sid) ? 'selected' : ''}>${Utils.escapeHtml(s?.name || 'Subject')}</option>`;
  }).join('') || '<option value="">No assigned subject</option>';

  const chips = [20, 30, 40, 50, 60, 70, 80, 100];

  /* Real current context (names straight from the database). */
  const ctxClass = bc.classMap.get(bc.selClassId)?.name || '—';
  const ctxSubj = bc.subjMap.get(bc.selSubjectId)?.name || '—';
  const ctxYear = (bc.years.find(y => String(y.id) === String(bc.selYearId)) || {}).name || '—';
  const ctxTerm = (bc.terms.find(t => String(t.id) === String(bc.selTermId)) || {}).name || 'All terms';
  const ctxFound = bc.assessments.filter(r =>
    String(r.a.class_id) === String(bc.selClassId) &&
    String(r.a.subject_id) === String(bc.selSubjectId) &&
    String(r.a.academic_year_id) === String(bc.selYearId) &&
    (!bc.selTermId || String(r.a.term_id) === String(bc.selTermId))).length;

  setContent(`
    <div class="bulk-steps" role="tablist" aria-label="Conversion steps">
      <a class="btn btn-sm btn-outline" href="#bulk-sec-setup" role="tab">Step 1 · Setup</a>
      <a class="btn btn-sm btn-outline" href="#bulk-sec-convert" role="tab">Step 2 · Convert <span class="bulk-step-count" id="bulk-nav-count">${bc.selAssess.size}</span></a>
      <a class="btn btn-sm btn-outline" href="#bulk-sec-finish" role="tab">Step 3 · Report &amp; Save</a>
      <span class="bulk-steps-spacer"></span>
      <button class="btn btn-sm btn-primary" onclick="bulkAllConverted()"><i data-lucide="eye"></i> All converted marks</button>
    </div>

    <div class="alert alert-info" style="margin-bottom:16px"><i data-lucide="info"></i><div><strong>${Utils.escapeHtml(ctxClass)}</strong> · ${Utils.escapeHtml(ctxSubj)} · ${Utils.escapeHtml(ctxYear)} · ${Utils.escapeHtml(ctxTerm)} — <strong>${ctxFound}</strong> assessment(s) found in the database for this selection.</div></div>

    <div class="card" id="bulk-sec-setup" style="margin-bottom:16px;scroll-margin-top:12px"><div class="card-body">
      <h2 class="page-title" style="font-size:16px">Step 1 · Setup — Class, Subject & Assessments</h2>
      <p class="text-sm text-muted" style="margin-bottom:12px">Choose your class, subject, academic year and term, then tick the assessments to combine. Only your assigned classes and subjects are shown.</p>
      <div class="grid-2">
        <div><label class="form-label">Class <span class="required">*</span></label>
          <select class="input-field" onchange="bulkPageClass(this.value)">${classOpts}</select></div>
        <div><label class="form-label">Subject <span class="required">*</span></label>
          <select class="input-field" onchange="bulkPageSet('selSubjectId', this.value)">${subjOpts}</select></div>
        <div><label class="form-label">Academic Year <span class="required">*</span></label>
          <select class="input-field" onchange="bulkPageSet('selYearId', this.value)">${yearsOpts}</select></div>
        <div><label class="form-label">Term <span class="required">*</span></label>
          <select class="input-field" onchange="bulkPageSet('selTermId', this.value)">${termsOpts}</select></div>
      </div>
    </div>
      <div class="flex items-center gap-12" style="margin-top:14px;flex-wrap:wrap">
        <label class="checkbox-label" style="margin:0"><input type="checkbox" ${bc.missingZero ? 'checked' : ''} onchange="bulkToggleMissingZero(this.checked)"><span>Count missing marks as zero</span></label>
        <div class="text-xs text-muted">On: a student missing a mark scores 0 for that assessment and is included in the calculation. Off: missing marks are excluded.</div>
      </div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--gray-200)">
      <h3 class="page-title" style="font-size:14px">Assessments to combine</h3>
      <p class="text-sm text-muted" style="margin-bottom:12px">Tick two or more assessments with saved marks — including submitted or approved ones. Sources are only read, never changed, so official records and reports stay untouched.</p>
      <div class="bulk-toolbar">
        <input class="input-field bulk-search" id="bulk-search" style="max-width:280px" placeholder="Search assessments..." value="${Utils.escapeHtml(bulkSearch)}" oninput="bulkSearch=this.value;bulkRefreshAssessRows()">
        <div class="tab-bar bulk-tabs" role="tablist" aria-label="Assessment status filter">
          <button class="tab-btn ${bulkFilter === 'convertible' ? 'active' : ''}" onclick="bulkSetFilter('convertible')">Convertible</button>
          <button class="tab-btn ${bulkFilter === 'draft' ? 'active' : ''}" onclick="bulkSetFilter('draft')">Draft</button>
          <button class="tab-btn ${bulkFilter === 'rejected' ? 'active' : ''}" onclick="bulkSetFilter('rejected')">Rejected</button>
          <button class="tab-btn ${bulkFilter === 'official' ? 'active' : ''}" onclick="bulkSetFilter('official')">Official</button>
          <button class="tab-btn ${bulkFilter === 'all' ? 'active' : ''}" onclick="bulkSetFilter('all')">All</button>
        </div>
        <span class="bulk-spacer"></span>
        <span class="text-sm text-muted bulk-sel"><span id="bulk-sel-count">${bc.selAssess.size}</span> selected</span>
        <button class="btn btn-sm btn-outline" onclick="bulkSelectAll(true)"><i data-lucide="check-square"></i> Select all</button>
        <button class="btn btn-sm btn-outline" onclick="bulkSelectAll(false)"><i data-lucide="square"></i> Clear all</button>
      </div>
      <div class="bulk-swipe-hint"><i data-lucide="move-horizontal"></i> Swipe the table sideways on small screens</div>
      <div class="table-container" style="max-height:420px;overflow-y:auto"><table class="data-table">
        <thead><tr><th style="width:36px"></th><th>Assessment</th><th>Type</th><th>Max</th><th>Date</th><th>Saved marks</th><th>Status</th></tr></thead>
        <tbody id="bulk-assess-rows">${bulkAssessRowsHtml()}</tbody>
      </table></div>
    </div></div>

    <div class="card" id="bulk-sec-convert" style="margin-bottom:16px;scroll-margin-top:12px"><div class="card-body">
      <h2 class="page-title" style="font-size:16px">Step 2 · Convert — Target & Review</h2>
      <p class="text-sm text-muted" style="margin-bottom:12px">Set the target maximum and where to record the marks. Each student's percentage is preserved by proportional re-scaling — the review below recalculates instantly. ${bc.missingZero ? 'Missing marks are counted as zero.' : 'Missing marks are excluded — never treated as zero.'}</p>
      <label class="form-label">Target Maximum Mark <span class="required">*</span></label>
      <div class="bulk-target-row">
        <input id="bulk-target" type="number" min="1" step="any" class="input-field" style="max-width:160px;font-size:18px;font-weight:700" value="${bc.target}" oninput="bulkTargetLiveInput()">
        <div class="bulk-chips">${chips.map(m => `<button type="button" class="btn btn-sm ${m === bc.target ? 'btn-primary' : 'btn-outline'}" onclick="bulkSetTargetChip(${m})">${m}</button>`).join('')}</div>
      </div>
      <p class="form-hint" style="margin-bottom:12px">Rounding rule: ${bc.decimals ? 'marks rounded to 1 decimal place' : 'marks rounded to whole numbers'} · Pass mark: ${bc.pass}%</p>
      <div class="alert alert-info" style="margin:0"><i data-lucide="info"></i><div>On save, a helper assessment named <strong id="bulk-autoname">—</strong> is created automatically. It is visible only on this page and never affects official reports.</div></div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--gray-200)">
      <h3 class="page-title" style="font-size:14px">Review converted marks</h3>
      <p class="text-sm text-muted" style="margin-bottom:12px">Updates automatically whenever the selection or target changes. Missing marks are excluded — never treated as zero.</p>
      <div id="bulk-review-wrap"></div>
    </div></div>

    <div class="card" id="bulk-sec-finish" style="margin-bottom:16px;scroll-margin-top:12px;border:1px solid var(--blue-200)"><div class="card-body">
      <h2 class="page-title" style="font-size:16px">Step 3 · Report & Save</h2>
      <p class="text-sm text-muted" style="margin-bottom:12px">Preview the print-identical report, export it, then confirm and save. Original assessments are never modified.</p>
      <div class="bulk-export-actions">
        <button class="btn btn-sm btn-outline" onclick="bulkPreviewTab()"><i data-lucide="external-link"></i> Preview</button>
        <button class="btn btn-sm btn-outline" onclick="bulkPrintReport()"><i data-lucide="printer"></i> Print</button>
        <button class="btn btn-sm btn-outline" onclick="bulkDownloadPdf()"><i data-lucide="file-down"></i> PDF</button>
        <button class="btn btn-sm btn-outline" onclick="bulkDownloadExcel()"><i data-lucide="file-spreadsheet"></i> Excel</button>
        <button class="btn btn-sm btn-outline" onclick="bulkDownloadWord()"><i data-lucide="file-text"></i> Word</button>
      </div>
      <div class="bulk-preview-wrap"><div id="bulk-report-preview" style="min-width:1180px;background:var(--gray-100);border-radius:var(--radius-lg)">${Utils.loading()}</div></div>
      <hr style="margin:16px 0;border:none;border-top:1px solid var(--gray-200)">
      <h3 class="page-title" style="font-size:14px">Confirm & save</h3>
      <p class="text-sm text-muted" style="margin-bottom:12px">Duplicate submissions are prevented. The converted assessment is a helper — it never affects official reports or report cards.</p>
      <div id="bulk-confirm-wrap"></div>
    </div></div>`);

  bulkRecomputeAndRefresh();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* Context changes re-render the page (selects keep no text focus). */

function bulkPageClass(clsId) {
  bulkConvert.selClassId = clsId;
  const list = bulkStepSubjectList();
  bulkConvert.selSubjectId = list[0] || '';
  bulkConvert.selAssess = new Set();
  bulkConvert.targetAssessId = '';
  bulkConvert.conversion = null;
  bulkRenderPage();
}

function bulkPageSet(key, value) {
  if (!bulkConvert) return;
  const bc = bulkConvert;
  bc[key] = value;
  if (key === 'selYearId') {
    /* Keep the term real: pick the active/first term of the newly chosen year. */
    const yl = bc.terms.filter(t => String(t.academic_year_id) === String(value));
    bc.selTermId = ((yl.find(t => t.is_active || t.is_current || t.status === 'active') || yl[0]) || {}).id || '';
  }
  if (['selSubjectId', 'selYearId', 'selTermId'].includes(key)) {
    bc.selAssess = new Set();
    bc.targetAssessId = '';
    bc.conversion = null;
  }
  bulkRenderPage();
}

function bulkToggleMissingZero(v) {
  bulkConvert.missingZero = v;
  bulkConvert.saved = false;
  bulkRefreshAfterToggle();
}

function bulkSetFilter(f) {
  bulkFilter = f;
  bulkRenderPage();
}

/* ---------------- Section 2 : assessment list ---------------- */

function bulkFilteredRows() {
  const bc = bulkConvert;
  const q = bulkSearch.trim().toLowerCase();
  return bc.assessments.filter(r => {
    /* Helpers are never sources (no helper-chaining) — they only live here as results. */
    if (Utils.isConversionHelper && Utils.isConversionHelper(r.a)) return false;
    if (String(r.a.class_id) !== String(bc.selClassId)) return false;
    if (String(r.a.subject_id) !== String(bc.selSubjectId)) return false;
    if (bc.selTermId && String(r.a.term_id) !== String(bc.selTermId)) return false;
    if (String(r.a.academic_year_id) !== String(bc.selYearId)) return false;
    if (bulkFilter === 'convertible' && !r.editable) return false;
    if (bulkFilter === 'draft' && r.a.status !== 'draft') return false;
    if (bulkFilter === 'rejected' && r.a.status !== 'rejected') return false;
    if (bulkFilter === 'official' && !['submitted', 'approved', 'locked'].includes(r.a.status)) return false;
    if (q) {
      const label = Utils.buildAssessmentDisplayName(r.a, bc.types).toLowerCase();
      const t = assessmentTypeName(bc.types, r.a.assessment_type_id, 'Assessment').toLowerCase();
      if (!(label + ' ' + t).includes(q)) return false;
    }
    return true;
  });
}

function bulkAssessRowsHtml() {
  const bc = bulkConvert;
  const rows = bulkFilteredRows();
  if (!rows.length) return `<tr><td colspan="7">${Utils.empty('No assessments match the current filter', 'file-text')}</td></tr>`;
  return rows.map(r => {
    const a = r.a;
    const checked = bc.selAssess.has(a.id);
    let reason = '';
    if (r.saved === 0) reason = 'No saved marks yet';
    else if (['approved', 'locked', 'submitted'].includes(a.status)) reason = 'Official (' + a.status + ') — read-only source, never modified';
    return `<tr ${r.editable ? '' : 'style="opacity:.55"'}>
      <td class="text-center"><input type="checkbox" value="${a.id}" ${checked ? 'checked' : ''} ${r.editable ? '' : 'disabled'} onchange="bulkToggle(this)"></td>
      <td class="col-name">${Utils.escapeHtml(Utils.buildAssessmentDisplayName(a, bc.types))}${reason ? `<div class="text-xs text-muted">${Utils.escapeHtml(reason)}</div>` : ''}${a.converted_from_maximum ? `<div class="text-xs text-muted">Converted from ${Utils.escapeHtml(a.converted_from_maximum)} to ${Utils.escapeHtml(a.maximum_mark)}</div>` : ''}</td>
      <td class="text-xs">${Utils.escapeHtml(assessmentTypeName(bc.types, a.assessment_type_id, 'Assessment'))}</td>
      <td class="text-center font-semibold">${Utils.escapeHtml(a.maximum_mark)}</td>
      <td class="text-xs text-muted">${Utils.escapeHtml(a.assessment_date || '-')}</td>
      <td class="text-center">${r.saved}</td>
      <td><span class="badge ${Utils.statusColor(a.status)}"><i data-lucide="${Utils.statusIcon(a.status)}"></i> ${a.status}</span></td>
    </tr>`;
  }).join('');
}

/* Targeted refresh: search typing never loses focus. */
function bulkRefreshAssessRows() {
  const bc = bulkConvert;
  if (!bc) return;
  const tb = document.getElementById('bulk-assess-rows');
  if (tb) tb.innerHTML = bulkAssessRowsHtml();
  const c = document.getElementById('bulk-sel-count');
  if (c) c.textContent = bc.selAssess.size;
  const n = document.getElementById('bulk-nav-count');
  if (n) n.textContent = bc.selAssess.size;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function bulkToggle(el) {
  const id = el.value;
  if (el.checked) bulkConvert.selAssess.add(id); else bulkConvert.selAssess.delete(id);
  bulkConvert.saved = false;
  const c = document.getElementById('bulk-sel-count');
  if (c) c.textContent = bulkConvert.selAssess.size;
  const n = document.getElementById('bulk-nav-count');
  if (n) n.textContent = bulkConvert.selAssess.size;
  bulkRecomputeAndRefresh();
}

function bulkSelectAll(all) {
  const rows = bulkFilteredRows();
  rows.forEach(r => {
    if (!r.editable) return;
    if (all) bulkConvert.selAssess.add(r.a.id); else bulkConvert.selAssess.delete(r.a.id);
  });
  bulkConvert.saved = false;
  bulkRenderPage();
}

/* The helper assessment is auto-created on save — no target form. */

function bulkSetTargetChip(val) {
  bulkConvert.target = val;
  bulkConvert.saved = false;
  bulkRenderPage();
}

function bulkTargetLiveInput() {
  const el = document.getElementById('bulk-target');
  bulkConvert.target = Number(el?.value) || 0;
  bulkConvert.saved = false;
  if (bulkConvert._tmaxTimer) clearTimeout(bulkConvert._tmaxTimer);
  bulkConvert._tmaxTimer = setTimeout(() => bulkRecomputeAndRefresh(), 400);
}

/* ---------------- Compute (auto, synchronous) ---------------- */

function bulkComputeRows(target) {
  const bc = bulkConvert;
  const selected = bc.assessments.filter(r => bc.selAssess.has(r.a.id) && r.editable);
  const roster = (bc.learners || []).filter(l => String(l.class_id) === String(bc.selClassId) && l.status !== 'inactive');

  const rows = roster.map(l => {
    const vals = {};
    let obtained = 0, possible = 0, present = 0, missing = 0;
    selected.forEach(r => {
      const m = bc.marksByAssess.get(String(r.a.id))?.get(String(l.id));
      if (m == null) {
        vals[r.a.id] = null; missing++;
        if (bc.missingZero) { possible += Number(r.a.maximum_mark) || 0; }
      }
      else { vals[r.a.id] = m; obtained += m; possible += Number(r.a.maximum_mark) || 0; present++; }
    });
    const raw = possible > 0 ? (obtained / possible) * target : null;
    const pct = possible > 0 ? Utils.pct(obtained, possible) : null;
    const conv = raw == null ? null : Math.round(raw * Math.pow(10, bc.decimals)) / Math.pow(10, bc.decimals);
    return {
      l,
      vals, present, missing, obtained, possible, raw, pct, conv,
      convertible: possible > 0,
      grade: pct == null ? '-' : Utils.grade(pct, bc.grading),
      remark: pct == null ? 'Incomplete' : Utils.remark(pct, bc.grading)
    };
  }).sort((a, b) => a.l.full_name.localeCompare(b.l.full_name));

  /* Positions on converted marks (standard competition — ties share). */
  rows.forEach(r => { r.convAuto = r.conv; r.edited = false; });
  bulkRecomputePositions(rows);

  const convertedCount = rows.filter(r => r.convertible).length;
  const missingCount = rows.filter(r => !r.convertible || r.missing > 0).length;
  const totalPossible = selected.reduce((s, r) => s + (Number(r.a.maximum_mark) || 0), 0);

  return {
    selected,
    rows,
    totalPossible,
    target: Number(target) || 0,
    convertedCount,
    missingCount,
    totalStudents: roster.length,
    className: bc.classMap.get(bc.selClassId)?.name || '-',
    subjectName: bc.subjMap.get(bc.selSubjectId)?.name || '-'
  };
}

/* Shared position ranking over effective converted marks. */
function bulkRecomputePositions(rows) {
  const posMap = {};
  try {
    Utils.positions((rows || []).filter(r => r.convertible).map(r => ({ id: String(r.l.id), pct: r.conv }))).forEach(p => { posMap[p.id] = p.position; });
  } catch (e) { /* positions stay empty */ }
  (rows || []).forEach(r => { r.pos = posMap[String(r.l.id)] || null; });
}

/* The missing-rule toggle flips rows between zero and exclude — recompute fresh
   so both the summary counts and the toggle stay truthful. */
function bulkRefreshAfterToggle() {
  const bc = bulkConvert;
  if (!bc || bc.saved) return;
  const target = Number(bc.target) || 0;
  const selected = bc.assessments.filter(r => bc.selAssess.has(r.a.id) && r.editable);
  if (selected.length && target > 0) {
    const keep = {};
    bc.conversion.rows.forEach(r => { if (r.edited) keep[String(r.l.id)] = r.conv; });
    bc.conversion = bulkComputeRows(target);
    bc.conversion.rows.forEach(r => {
      const k = keep[String(r.l.id)];
      if (k != null && r.convertible && k <= target) { r.conv = k; r.edited = (r.conv !== r.convAuto); }
    });
    bulkRecomputePositions(bc.conversion.rows);
  } else bc.conversion = null;
  const rw = document.getElementById('bulk-review-wrap');
  if (rw) rw.innerHTML = bulkReviewHtml();
  bulkRenderPreview();
  const cw = document.getElementById('bulk-confirm-wrap');
  if (cw) cw.innerHTML = bulkConfirmHtml();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* Recompute + refresh sections 4, 5, 6 (never touches focused text inputs). */
function bulkRecomputeAndRefresh() {
  const bc = bulkConvert;
  if (!bc || bc.saved) return;
  /* Preserve manual mark overrides across recomputes (same target only). */
  const keep = {};
  if (bc.conversion) bc.conversion.rows.forEach(r => { if (r.edited) keep[String(r.l.id)] = r.conv; });
  const target = Number(bc.target) || 0;
  const selected = bc.assessments.filter(r => bc.selAssess.has(r.a.id) && r.editable);
  bc.conversion = (selected.length && target > 0) ? bulkComputeRows(target) : null;
  if (bc.conversion && target > 0) {
    bc.conversion.rows.forEach(r => {
      const k = keep[String(r.l.id)];
      if (k != null && r.convertible && k <= target) { r.conv = k; r.edited = (r.conv !== r.convAuto); }
    });
    bulkRecomputePositions(bc.conversion.rows);
  }

  const an = document.getElementById('bulk-autoname');
  if (an) an.textContent = bc.conversion ? ('Combined ' + bc.conversion.subjectName + ' — Converted out of ' + bc.conversion.target + ' marks') : '—';

  const rw = document.getElementById('bulk-review-wrap');
  if (rw) rw.innerHTML = bulkReviewHtml();
  bulkRenderPreview();
  const cw = document.getElementById('bulk-confirm-wrap');
  if (cw) cw.innerHTML = bulkConfirmHtml();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ---------------- Section 4 : review ---------------- */

function bulkSummaryCards() {
  const bc = bulkConvert;
  const c = bc.conversion;
  const yearName = (bc.years.find(y => String(y.id) === String(bc.selYearId)) || {}).name || '—';
  const termName = (bc.terms.find(t => String(t.id) === String(bc.selTermId)) || {}).name || 'All terms';
  const cards = [
    ['Selected Assessments', String(c.selected.length), 'git-merge'],
    ['Class', Utils.escapeHtml(c.className), 'users'],
    ['Subject', Utils.escapeHtml(c.subjectName), 'book-open'],
    ['Academic Year', Utils.escapeHtml(yearName), 'calendar'],
    ['Term', Utils.escapeHtml(termName), 'bookmark'],
    ['Students', String(c.totalStudents), 'graduation-cap'],
    ['Total Possible Marks', String(c.totalPossible), 'sigma'],
    ['Target Maximum', String(c.target), 'target'],
    ['Students Converted', String(c.convertedCount), 'check-circle'],
    ['With Missing Marks', String(c.missingCount), 'alert-triangle']
  ];
  return `<div class="bulk-stats">
    ${cards.map(cc => `<div class="stat-card" title="${cc[1]}"><div class="stat-icon"><i data-lucide="${cc[2]}"></i></div><div class="stat-text"><div class="stat-value">${cc[1]}</div><div class="stat-label">${cc[0]}</div></div></div>`).join('')}
  </div>`;
}

function bulkReviewHtml() {
  const bc = bulkConvert;
  const c = bc.conversion;
  if (!c) return Utils.empty('Select at least one assessment above and set a target maximum — the review appears here automatically.', 'calculator');
  const target = c.target;
  const viewRows = bulkOnlyMissing ? c.rows.filter(r => !r.convertible || r.missing > 0) : c.rows;

  const thead = `<th style="width:34px">#</th><th>Student ID</th><th>Student Name</th>
    ${c.selected.map(r => `<th>${Utils.escapeHtml(Utils.buildAssessmentDisplayName(r.a, bc.types))}<div class="text-xs" style="font-weight:600">/${Utils.escapeHtml(r.a.maximum_mark)}</div></th>`).join('')}
    <th>Total Obtained</th><th>Total Possible</th><th>%</th><th>Target</th><th>Converted (out of ${target})</th><th>Pos</th><th>Grade</th><th>Remark</th><th></th>`;

  const tbody = viewRows.map((r, i) => {
    const cells = c.selected.map(s => {
      const m = r.vals[s.a.id];
      return m == null
        ? `<td class="text-center"><span class="badge" style="background:#fff1f2;color:#e11d48">Missing</span></td>`
        : `<td class="text-center rms-num">${Utils.escapeHtml(m)}<div class="text-xs text-muted">/${Utils.escapeHtml(s.a.maximum_mark)}</div></td>`;
    }).join('');
    return `<tr ${r.convertible ? '' : 'style="opacity:.55"'}>
      <td class="text-center text-muted">${i + 1}</td>
      <td>${Utils.escapeHtml(r.l.learner_code)}</td>
      <td class="col-name">${Utils.escapeHtml(r.l.full_name)}</td>
      ${cells}
      <td class="text-center font-semibold">${Utils.escapeHtml(r.obtained)}</td>
      <td class="text-center">${Utils.escapeHtml(r.possible)}</td>
      <td class="text-center">${r.pct == null ? '-' : Utils.escapeHtml(r.pct)}%</td>
      <td class="text-center text-muted">${target}</td>
      <td class="text-center font-bold" style="color:var(--blue-700)">${r.conv == null ? 'Missing' : Utils.escapeHtml(r.conv)}${r.conv != null && bc.decimals > 0 ? `<div class="text-xs text-muted" title="Raw value">(${Utils.escapeHtml(Number(r.raw).toFixed(4))})</div>` : ''}${r.edited ? '<div class="text-xs" style="color:#b45309">edited</div>' : ''}</td>
      <td class="text-center font-bold" style="color:#b45309">${r.pos == null ? '—' : r.pos}</td>
      <td class="text-center">${Utils.escapeHtml(r.grade)}</td>
      <td class="text-xs">${Utils.escapeHtml(r.remark)}</td>
      <td class="text-center"><button class="btn btn-sm btn-outline" title="View this student's converted marks" onclick="bulkViewStudent('${r.l.id}')"><i data-lucide="eye"></i></button></td>
    </tr>`;
  }).join('');

  return `
    ${bulkSummaryCards()}
    ${c.missingCount > 0 ? (bc.missingZero
      ? `<div class="alert alert-warning" style="margin-bottom:16px"><i data-lucide="alert-triangle"></i><div><strong>${c.missingCount} student(s) have missing marks</strong> in at least one selected assessment. They are <strong>counted as zero</strong> and included in the calculation.</div></div>`
      : `<div class="alert alert-warning" style="margin-bottom:16px"><i data-lucide="alert-triangle"></i><div><strong>Warning — ${c.missingCount} student(s) have missing marks</strong> in at least one selected assessment. Missing marks are <strong>excluded</strong> from the calculation and are <strong>never treated as zero</strong>.</div></div>`) : ''}
    ${c.convertedCount === 0 ? `<div class="alert alert-warning" style="margin-bottom:16px"><i data-lucide="alert-triangle"></i><div>No students could be converted (all marks missing).</div></div>` : ''}
    <div class="bulk-toolbar bulk-review-toolbar">
      <div class="tab-bar bulk-tabs" role="tablist" aria-label="Review view">
        <button class="tab-btn ${bulkReviewView === 'sheet' ? 'active' : ''}" onclick="bulkSetReviewView('sheet')">Converted marks</button>
        <button class="tab-btn ${bulkReviewView === 'full' ? 'active' : ''}" onclick="bulkSetReviewView('full')">Full review</button>
      </div>
      <button class="btn btn-sm btn-primary" onclick="bulkAllConverted()"><i data-lucide="eye"></i> All converted marks</button>
      <label class="checkbox-label" style="margin:0"><input type="checkbox" ${bulkOnlyMissing ? 'checked' : ''} onchange="bulkOnlyMissingToggle(this.checked)"><span>Show only students with missing marks (${c.missingCount})</span></label>
      <div class="text-sm text-muted">Showing ${viewRows.length} of ${c.rows.length} students</div>
    </div>
    ${bulkReviewView === 'sheet' ? bulkConvertedSheetHtml(viewRows) : `<div class="table-container" style="overflow-x:auto;max-height:560px;overflow-y:auto"><table class="data-table" style="width:100%;min-width:${640 + c.selected.length * 90}px">
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody || `<tr><td colspan="${12 + c.selected.length}">${Utils.empty('No students in this class', 'users')}</td></tr>`}</tbody>
    </table></div>`}`;
}

function bulkSetReviewView(v) {
  bulkReviewView = v;
  const rw = document.getElementById('bulk-review-wrap');
  if (rw) rw.innerHTML = bulkReviewHtml();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* Dedicated converted-marks sheet (the "another page" inside this page). */
function bulkConvertedSheetHtml(viewRows) {
  const bc = bulkConvert, c = bc.conversion;
  const target = c.target;
  const tbody = viewRows.map((r, i) => `<tr ${r.convertible ? '' : 'style="opacity:.55"'}>
      <td class="text-center text-muted">${i + 1}</td>
      <td>${Utils.escapeHtml(r.l.learner_code)}</td>
      <td class="col-name">${Utils.escapeHtml(r.l.full_name)}</td>
      <td class="text-center font-bold" style="color:var(--blue-700);font-size:15px">${r.conv == null ? 'Missing' : Utils.escapeHtml(r.conv)}<span class="text-muted" style="font-weight:400;font-size:12px"> / ${target}</span>${r.edited ? '<div class="text-xs" style="color:#b45309">edited</div>' : ''}</td>
      <td class="text-center font-bold" style="color:#b45309">${r.pos == null ? '—' : r.pos}</td>
      <td class="text-center">${Utils.escapeHtml(r.grade)}</td>
      <td class="text-xs">${Utils.escapeHtml(r.remark)}</td>
      <td class="text-center"><button class="btn btn-sm btn-outline" title="View this student's converted marks" onclick="bulkViewStudent('${r.l.id}')"><i data-lucide="eye"></i></button></td>
    </tr>`).join('');
  return `<div class="table-container" style="overflow-x:auto;max-height:560px;overflow-y:auto"><table class="data-table" style="width:100%;min-width:720px">
      <thead><tr><th style="width:34px">#</th><th>Student ID</th><th>Student Name</th><th>Converted (out of ${target})</th><th>Pos</th><th>Grade</th><th>Remark</th><th></th></tr></thead>
      <tbody>${tbody || `<tr><td colspan="8">${Utils.empty('No students in this class', 'users')}</td></tr>`}</tbody>
    </table></div>`;
}

/* Current-conversion editor (unsaved): view every student, edit any mark, download or preview. */
function bulkCurrentConverted() {
  const bc = bulkConvert, c = bc?.conversion;
  if (!c || !c.convertedCount) return Utils.toast('Nothing converted yet — select assessments first', 'error');
  const rows = c.rows.map((r, i) => `<tr ${r.convertible ? '' : 'style="opacity:.55"'}>
      <td class="text-center text-muted">${i + 1}</td>
      <td>${Utils.escapeHtml(r.l.learner_code)}</td>
      <td class="col-name">${Utils.escapeHtml(r.l.full_name)}</td>
      <td class="text-center">${r.conv == null ? 'Missing' : `<input type="number" min="0" max="${c.target}" step="any" class="input-field" style="max-width:92px;margin:0 auto;text-align:center;font-weight:700" value="${r.conv}" onchange="bulkEditConv('${r.l.id}', this.value)">`}${r.edited ? '<div class="text-xs" style="color:#b45309">edited (auto: ' + Utils.escapeHtml(r.convAuto) + ')</div>' : ''}</td>
      <td class="text-center font-bold" style="color:#b45309">${r.pos == null ? '—' : r.pos}</td>
      <td class="text-center">${Utils.escapeHtml(r.grade)}</td>
      <td class="text-center">${r.edited ? `<button class="btn btn-sm btn-outline" title="Reset to auto value" onclick="bulkResetConv('${r.l.id}')"><i data-lucide="rotate-ccw"></i></button>` : ''}</td>
    </tr>`).join('');
  Modal.show('All Converted Marks — ' + Utils.escapeHtml(c.subjectName) + ' (out of ' + c.target + ')', `
    <p class="text-sm text-muted" style="margin-bottom:12px">${c.convertedCount} converted · ${c.missingCount} missing · Adjust any mark if needed — positions, preview, export and save all follow your edits.</p>
    <div class="table-container" style="max-height:480px;overflow-y:auto"><table class="data-table">
      <thead><tr><th>#</th><th>ID</th><th>Name</th><th>Converted / ${c.target}</th><th>Pos</th><th>Grade</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`,
    `<button class="btn btn-outline" onclick="bulkDownloadExcel()"><i data-lucide="file-spreadsheet"></i> Download</button>
     <button class="btn btn-outline" onclick="bulkPreviewTab()"><i data-lucide="external-link"></i> Preview</button>
     <button class="btn btn-secondary" onclick="Modal.close()">Close</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function bulkEditConv(learnerId, val) {
  const bc = bulkConvert, c = bc?.conversion;
  const r = c?.rows.find(x => String(x.l.id) === String(learnerId));
  if (!r || !r.convertible) return;
  const v = Number(val);
  if (!isFinite(v) || v < 0 || v > c.target) { Utils.toast('Enter a mark between 0 and ' + c.target, 'error'); bulkCurrentConverted(); return; }
  const factor = Math.pow(10, bc.decimals);
  r.conv = Math.round(v * factor) / factor;
  r.edited = (r.conv !== r.convAuto);
  bulkRecomputePositions(c.rows);
  bulkRecomputeAndRefresh();
  bulkCurrentConverted();
}

function bulkResetConv(learnerId) {
  const c = bulkConvert?.conversion;
  const r = c?.rows.find(x => String(x.l.id) === String(learnerId));
  if (!r) return;
  r.conv = r.convAuto; r.edited = false;
  bulkRecomputePositions(c.rows);
  bulkRecomputeAndRefresh();
  bulkCurrentConverted();
}

/* All converted marks library (top button): every conversion by name. */
async function bulkAllConverted() {
  const bc = bulkConvert;
  if (!bc) return;
  Modal.show('All Converted Marks', Utils.loading(), `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>`);
  let helpers = [];
  try {
    const { data } = await sbClient.from('assessments').select('*').eq('teacher_id', bc.teacherId).order('created_at', { ascending: false });
    helpers = (data || []).filter(a => Utils.isConversionHelper && Utils.isConversionHelper(a));
  } catch (e) { /* list stays empty */ }
  let counts = {};
  if (helpers.length) {
    try {
      const { data: mk } = await sbClient.from('marks').select('assessment_id').in('assessment_id', helpers.map(h => h.id));
      (mk || []).forEach(m => { counts[m.assessment_id] = (counts[m.assessment_id] || 0) + 1; });
    } catch (e) { /* counts stay zero */ }
  }
  const c = bc.conversion;
  const curRow = (c && c.convertedCount && !bc.saved) ? `<tr style="background:var(--blue-50,#eff6ff)">
      <td class="col-name">Current conversion — Combined ${Utils.escapeHtml(c.subjectName)} — Converted out of ${c.target} marks<div class="text-xs text-muted">Not saved yet · ${c.convertedCount} converted · ${c.missingCount} missing</div></td>
      <td class="text-center"><button class="btn btn-sm btn-primary" onclick="Modal.close();bulkCurrentConverted()"><i data-lucide="eye"></i> View & edit</button></td>
    </tr>` : '';
  const libRows = helpers.map(h => {
    const cls = bc.classMap.get(h.class_id)?.name || '-';
    const subj = bc.subjMap.get(h.subject_id)?.name || '-';
    const when = h.created_at ? new Date(h.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '';
    return `<tr>
      <td class="col-name">${Utils.escapeHtml(h.display_name || h.name)}<div class="text-xs text-muted">${Utils.escapeHtml(cls)} · ${Utils.escapeHtml(subj)} · out of ${Utils.escapeHtml(h.maximum_mark)} · ${Utils.escapeHtml(when)} · ${counts[h.id] || 0} marks</div></td>
      <td class="text-center"><button class="btn btn-sm btn-outline" onclick="bulkViewHelper('${h.id}')"><i data-lucide="eye"></i> View</button></td>
    </tr>`;
  }).join('');
  Modal.show('All Converted Marks', `
    <p class="text-sm text-muted" style="margin-bottom:12px">Every conversion listed by name. Open one to view, edit, or download its marks.</p>
    <div class="table-container" style="max-height:480px;overflow-y:auto"><table class="data-table">
      <thead><tr><th>Converted assessment</th><th style="width:130px"></th></tr></thead>
      <tbody>${curRow}${libRows || (curRow ? '' : `<tr><td colspan="2">${Utils.empty('No converted marks yet', 'eye')}</td></tr>`)}</tbody>
    </table></div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* Open one saved conversion: view, edit and download its marks. */
async function bulkViewHelper(assessId) {
  const bc = bulkConvert;
  if (!bc) return;
  Modal.show('Converted Marks', Utils.loading(), `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>`);
  try {
    const [{ data: h }, { data: mk }] = await Promise.all([
      sbClient.from('assessments').select('*').eq('id', assessId).single(),
      sbClient.from('marks').select('*').eq('assessment_id', assessId)
    ]);
    if (!h) { Utils.toast('Conversion not found', 'error'); return; }
    const max = Number(h.maximum_mark) || 0;
    const roster = (bc.learners || []).filter(l => String(l.class_id) === String(h.class_id));
    const byLearner = new Map((mk || []).map(m => [String(m.learner_id), m]));
    const rows = roster
      .map(l => { const m = byLearner.get(String(l.id)); return { l, convertible: m != null && m.mark != null, conv: m ? Number(m.mark) : null }; })
      .filter(r => r.convertible)
      .sort((a, b) => a.l.full_name.localeCompare(b.l.full_name));
    bulkRecomputePositions(rows);
    bulkLibView = { helper: h, max, rows };
    bulkRenderHelperModal();
  } catch (e) { Utils.toast('Could not load converted marks', 'error'); }
}

function bulkRenderHelperModal() {
  const v = bulkLibView;
  if (!v) return;
  const h = v.helper, max = v.max;
  const rows = v.rows.map((r, i) => `<tr>
      <td class="text-center text-muted">${i + 1}</td>
      <td>${Utils.escapeHtml(r.l.learner_code)}</td>
      <td class="col-name">${Utils.escapeHtml(r.l.full_name)}</td>
      <td class="text-center"><input type="number" min="0" max="${max}" step="any" class="input-field" style="max-width:92px;margin:0 auto;text-align:center;font-weight:700" value="${r.conv}" onchange="bulkEditSavedMark('${h.id}', '${r.l.id}', this.value)"></td>
      <td class="text-center font-bold" style="color:#b45309">${r.pos == null ? '—' : r.pos}</td>
      <td class="text-center">${Utils.escapeHtml(Utils.grade(Utils.pct(r.conv, max), bulkConvert.grading))}</td>
    </tr>`).join('');
  Modal.show('Converted Marks — ' + Utils.escapeHtml(h.display_name || h.name), `
    <p class="text-sm text-muted" style="margin-bottom:12px">Out of ${max} · ${v.rows.length} marks · Adjust any mark and it is saved immediately.</p>
    <div class="table-container" style="max-height:440px;overflow-y:auto"><table class="data-table">
      <thead><tr><th>#</th><th>ID</th><th>Name</th><th>Converted / ${max}</th><th>Pos</th><th>Grade</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">${Utils.empty('No marks recorded', 'users')}</td></tr>`}</tbody>
    </table></div>`,
    `<button class="btn btn-outline" onclick="bulkDownloadHelperExcel()"><i data-lucide="file-spreadsheet"></i> Download</button>
     <button class="btn btn-secondary" onclick="Modal.close()">Close</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function bulkEditSavedMark(assessId, learnerId, val) {
  const v = bulkLibView;
  if (!v) return;
  const num = Number(val);
  if (!isFinite(num) || num < 0 || num > v.max) { Utils.toast('Enter a mark between 0 and ' + v.max, 'error'); bulkRenderHelperModal(); return; }
  const factor = Math.pow(10, bulkConvert.decimals);
  const mark = Math.round(num * factor) / factor;
  const pct = Utils.pct(mark, v.max);
  const { error } = await sbClient.from('marks').upsert({
    assessment_id: assessId,
    learner_id: learnerId,
    mark,
    percentage: pct,
    grade: Utils.grade(pct, bulkConvert.grading),
    remark: Utils.remark(pct, bulkConvert.grading),
    status: 'draft',
    updated_at: new Date().toISOString()
  }, { onConflict: 'assessment_id,learner_id' });
  if (error) { Utils.toast('Save error: ' + error.message, 'error'); return; }
  const r = v.rows.find(x => String(x.l.id) === String(learnerId));
  if (r) r.conv = mark;
  bulkRecomputePositions(v.rows);
  DB.invalidateMany(['marks']);
  Utils.toast('Mark updated', 'success');
  bulkRenderHelperModal();
}

function bulkDownloadHelperExcel() {
  const v = bulkLibView;
  if (!v) return;
  if (typeof XLSX === 'undefined') return Utils.toast('Excel library not loaded', 'error');
  const h = v.helper, max = v.max;
  const header = ['Student ID', 'Student Name', 'Converted (out of ' + max + ')', 'Position', 'Grade', 'Remark'];
  const aoa = [header, ...v.rows.map(r => {
    const pct = Utils.pct(r.conv, max);
    return [r.l.learner_code, r.l.full_name, r.conv, r.pos == null ? '—' : r.pos, Utils.grade(pct, bulkConvert.grading), Utils.remark(pct, bulkConvert.grading)];
  })];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(x => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Converted Marks');
  const safe = String(h.display_name || h.name || 'converted').replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 50);
  XLSX.writeFile(wb, 'RMS-MIS_Converted_' + safe + '.xlsx');
  Utils.toast('Excel downloaded', 'success');
}

/* Saved-screen viewer: the final converted marks after saving. */
function bulkSavedSheet() {
  const bc = bulkConvert, c = bc?.conversion;
  if (!c) return Utils.toast('No converted marks to show', 'error');
  Modal.show('Converted Marks — ' + c.subjectName + ' (out of ' + c.target + ')', bulkConvertedSheetHtml(c.rows),
    `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>`, true);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function bulkOnlyMissingToggle(v) {
  bulkOnlyMissing = v;
  const rw = document.getElementById('bulk-review-wrap');
  if (rw) rw.innerHTML = bulkReviewHtml();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* Eye-icon detail: one student's full converted-marks breakdown. */
function bulkViewStudent(learnerId) {
  const bc = bulkConvert, c = bc?.conversion;
  if (!c) return;
  const r = c.rows.find(x => String(x.l.id) === String(learnerId));
  if (!r) return;
  const srcRows = c.selected.map(s => {
    const m = r.vals[s.a.id];
    return `<tr><td>${Utils.escapeHtml(Utils.buildAssessmentDisplayName(s.a, bc.types))}</td><td class="text-center font-semibold">${m == null ? '<span class="badge" style="background:#fff1f2;color:#e11d48">Missing</span>' : Utils.escapeHtml(m) + ' / ' + Utils.escapeHtml(s.a.maximum_mark)}</td></tr>`;
  }).join('');
  Modal.show(Utils.escapeHtml(r.l.full_name) + ' — Converted Marks', `
    <p class="text-sm text-muted" style="margin-bottom:12px">${Utils.escapeHtml(r.l.learner_code || '')} · ${Utils.escapeHtml(c.className)} · ${Utils.escapeHtml(c.subjectName)}</p>
    <div class="table-container"><table class="data-table">
      <thead><tr><th>Assessment</th><th>Mark</th></tr></thead>
      <tbody>${srcRows}</tbody>
    </table></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-top:14px">
      <div class="stat-card"><div class="stat-value">${Utils.escapeHtml(r.obtained)} / ${Utils.escapeHtml(r.possible)}</div><div class="stat-label">Total</div></div>
      <div class="stat-card"><div class="stat-value">${r.pct == null ? '—' : Utils.escapeHtml(r.pct) + '%'}</div><div class="stat-label">Percentage</div></div>
      <div class="stat-card"><div class="stat-value">${r.conv == null ? 'Missing' : Utils.escapeHtml(r.conv) + ' / ' + c.target}</div><div class="stat-label">Converted</div></div>
      <div class="stat-card"><div class="stat-value">${r.pos == null ? '—' : r.pos}</div><div class="stat-label">Position</div></div>
      <div class="stat-card"><div class="stat-value">${Utils.escapeHtml(r.grade)}</div><div class="stat-label">Grade</div></div>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Close</button>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ---------------- Section 5 : print-identical report ---------------- */

function bulkBuildReportHtml() {
  const bc = bulkConvert;
  const c = bc.conversion;
  if (!c) return { html: '', targetName: '' };
  const target = Number(c.target);
  const targetName = 'Combined ' + c.subjectName + ' — Converted out of ' + target + ' marks';
  const typeName = assessmentTypeName(bc.types, bc.targetTypeId, 'Assessment');
  const year = bc.years.find(y => String(y.id) === String(bc.selYearId));
  const term = bc.terms.find(t => String(t.id) === String(bc.selTermId));
  const now = new Date();
  const dateStr = now.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

  const thead = `<th>#</th><th>Student ID</th><th>Student Name</th>
    ${c.selected.map(r => `<th>${Utils.escapeHtml(Utils.buildAssessmentDisplayName(r.a, bc.types))}<div class="rms-abbr" style="font-size:7pt">/${Utils.escapeHtml(r.a.maximum_mark)}</div></th>`).join('')}
    <th>Total/Obtained</th><th>Total/Possible</th><th>%</th><th>Converted Mark</th><th>Pos</th><th>Grade</th><th>Remark</th>`;

  const tbody = c.rows.filter(r => r.convertible).map((r, i) => {
    const cells = c.selected.map(s => {
      const m = r.vals[s.a.id];
      return m == null ? '<td class="rms-num" style="color:#e11d48">M</td>' : `<td class="rms-num">${Utils.escapeHtml(m)}</td>`;
    }).join('');
    return `<tr><td>${i + 1}</td><td>${Utils.escapeHtml(r.l.learner_code)}</td><td style="font-weight:600">${Utils.escapeHtml(r.l.full_name)}</td>${cells}<td class="rms-num">${Utils.escapeHtml(r.obtained)}</td><td class="rms-num">${Utils.escapeHtml(r.possible)}</td><td class="rms-num">${Utils.escapeHtml(r.pct)}%</td><td class="rms-num" style="font-weight:800">${Utils.escapeHtml(r.conv)}</td><td class="rms-num" style="font-weight:700">${r.pos == null ? '—' : r.pos}</td><td>${Utils.escapeHtml(r.grade)}</td><td style="font-size:8pt">${Utils.escapeHtml(r.remark)}</td></tr>`;
  }).join('');

  const sourceNames = c.selected.map(r => Utils.buildAssessmentDisplayName(r.a, bc.types)).join('; ');

  const body = `
    <div class="rms-title-block" style="text-align:center;margin-bottom:8px">
      <div style="font-size:13pt;font-weight:800;color:#1e3a5f;text-transform:uppercase;letter-spacing:.5px">Marks Conversion Report</div>
      <div style="font-size:10pt;font-weight:700;color:#334155">Combined Assessment — Converted out of ${target} Marks</div>
    </div>
    <table class="rms-meta" style="width:100%;border:1px solid #cbd5e1;border-collapse:collapse;margin-bottom:8px;font-size:8.5pt">
      <tr>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Academic Year:</strong> ${Utils.escapeHtml(year?.name || '-')}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Term:</strong> ${Utils.escapeHtml(term?.name || '-')}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Target Assessment:</strong> ${Utils.escapeHtml(targetName)}</td>
      </tr>
      <tr>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Class:</strong> ${Utils.escapeHtml(c.className)}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Subject:</strong> ${Utils.escapeHtml(c.subjectName)}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Type:</strong> ${Utils.escapeHtml(typeName)}</td>
      </tr>
      <tr>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Teacher:</strong> ${Utils.escapeHtml(bc.teacherName)}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Date:</strong> ${Utils.escapeHtml(bc.targetDate || dateStr)}</td>
        <td style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Target Maximum:</strong> ${target}</td>
      </tr>
      <tr>
        <td colspan="3" style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Selected Assessments:</strong> ${Utils.escapeHtml(sourceNames)}</td>
      </tr>
      <tr>
        <td colspan="3" style="border:1px solid #cbd5e1;padding:3px 6px"><strong>Conversion Method:</strong> Converted = (Total obtained ÷ Total possible) × ${target} &nbsp;·&nbsp; Total possible across sources: ${c.totalPossible} &nbsp;·&nbsp; Students converted: ${c.convertedCount}${c.missingCount ? ' &nbsp;·&nbsp; With missing marks: ' + c.missingCount : ''} &nbsp;·&nbsp; Rounding: ${bc.decimals ? '1 decimal place' : 'whole numbers'}</td>
      </tr>
    </table>
    <table class="rms-table" style="width:100%;border-collapse:collapse;font-size:8.5pt">
      <thead><tr>${thead}</tr></thead>
      <tbody>${tbody}</tbody>
    </table>
    <div style="margin-top:12px;font-size:8.5pt;color:#334155">
      <em>${c.missingCount ? 'Note: ' + c.missingCount + ' student(s) had missing marks in one or more selected assessments. ' + (bc.missingZero ? 'Missing marks were counted as zero in the calculation.' : 'Missing marks were excluded from the calculation (never treated as zero). ') : ''}This report was generated on ${Utils.escapeHtml(dateStr)}.</em>
    </div>`;

  const header = (typeof ReportHeader !== 'undefined') ? ReportHeader.getOfficialHeader({}) : '';
  const html = (typeof ReportHeader !== 'undefined') ? ReportHeader.getA4Container(header + body, 'landscape', true) : `<div class="rms-a4-container rms-a4-landscape rms-report-document">${body}</div>`;
  return { html, targetName };
}

function debouncedPreview() {
  if (!bulkConvert) return;
  clearTimeout(bulkConvert._previewTimer);
  bulkConvert._previewTimer = setTimeout(() => {
    bulkRenderPreview();
    const cw = document.getElementById('bulk-confirm-wrap');
    if (cw && bulkConvert && !bulkConvert.saved) cw.innerHTML = bulkConfirmHtml();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }, 350);
}

function bulkRenderPreview() {
  const el = document.getElementById('bulk-report-preview');
  if (!el || !bulkConvert || bulkConvert.saved) return;
  if (!bulkConvert.conversion) { el.innerHTML = Utils.empty('The report preview appears here once assessments are selected.', 'file-text'); return; }
  const { html } = bulkBuildReportHtml();
  el.innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ---------------- Reports: print / pdf / excel / word ---------------- */

function bulkFilename(ext) {
  const c = bulkConvert.conversion;
  const safe = v => String(v || '').replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  const parts = ['RMS-MIS', 'Marks_Conversion', safe(c.className), safe(c.subjectName), safe((bulkConvert.years.find(y => String(y.id) === String(bulkConvert.selYearId)) || {}).name), safe((bulkConvert.terms.find(t => String(t.id) === String(bulkConvert.selTermId)) || {}).name)];
  return parts.join('_') + '.' + ext;
}

function bulkPreviewTab() {
  if (!bulkConvert?.conversion) return Utils.toast('Select assessments first', 'error');
  const { html } = bulkBuildReportHtml();
  if (typeof ReportCenter === 'undefined') return Utils.toast('The report preview service is unavailable. Please reload and try again.', 'error');
  ReportCenter.openPreviewDocument(html, 'Marks Conversion Report — Preview', 'landscape');
}

function bulkPrintReport() {
  if (!bulkConvert?.conversion) return Utils.toast('Select assessments first', 'error');
  const { html } = bulkBuildReportHtml();
  if (typeof ReportCenter === 'undefined') return Utils.toast('The report print service is unavailable. Please reload and try again.', 'error');
  ReportCenter.printDocument(html, 'Marks Conversion Report', bulkFilename('pdf'), 'landscape');
}

async function bulkDownloadPdf() {
  if (!bulkConvert?.conversion) return Utils.toast('Select assessments first', 'error');
  const { html } = bulkBuildReportHtml();
  if (typeof ReportCenter === 'undefined') return Utils.toast('The report download service is unavailable. Please reload and try again.', 'error');
  await ReportCenter.downloadPdfDocument(html, bulkFilename('pdf'), 'landscape');
}

function bulkDownloadExcel() {
  if (!bulkConvert?.conversion) return Utils.toast('Select assessments first', 'error');
  if (typeof XLSX === 'undefined') return Utils.toast('Excel library not loaded', 'error');
  const bc = bulkConvert, c = bc.conversion;
  const header = ['Student ID', 'Student Name'];
  c.selected.forEach(r => header.push(Utils.buildAssessmentDisplayName(r.a, bc.types) + ' (' + r.a.maximum_mark + ')'));
  header.push('Total Obtained', 'Total Possible', 'Percentage', 'Target Maximum Mark', 'Converted Mark', 'Position', 'Grade', 'Remark');
  const rows = c.rows.map(r => {
    const row = [r.l.learner_code, r.l.full_name];
    c.selected.forEach(s => row.push(r.vals[s.a.id] == null ? 'Missing' : r.vals[s.a.id]));
    row.push(r.possible > 0 ? r.obtained : '—', r.possible > 0 ? r.possible : '—', r.pct == null ? '—' : r.pct + '%', c.target, r.conv == null ? 'Missing' : r.conv, r.pos == null ? '—' : r.pos, r.grade === '-' ? '—' : r.grade, r.remark === 'Incomplete' ? 'Missing marks' : r.remark);
    return row;
  });
  const aoa = [header, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = header.map(h => ({ wch: Math.min(Math.max(h.length + 4, 12), 34) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Marks Conversion');
  XLSX.writeFile(wb, bulkFilename('xlsx'));
  Utils.toast('Excel downloaded', 'success');
}

function bulkDownloadWord() {
  if (!bulkConvert?.conversion) return Utils.toast('Select assessments first', 'error');
  const { html } = bulkBuildReportHtml();
  const filename = bulkFilename('doc');
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Marks Conversion Report</title></head><body>${html}</body></html>`;
  const blob = new Blob(['\ufeff' + doc], { type: 'application/msword' });
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = u; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(u);
  Utils.toast('Word document downloaded', 'success');
}

/* ---------------- Section 6 : confirm + save ---------------- */

function bulkConfirmHtml() {
  const bc = bulkConvert, c = bc.conversion;
  if (!c || !c.convertedCount) {
    return `<div class="alert alert-info" style="margin:0"><i data-lucide="info"></i><div>Select assessments and set a target maximum above — the confirmation summary and save button appear here.</div></div>
      <div style="margin-top:14px"><button class="btn btn-success btn-lg" disabled><i data-lucide="save"></i> Convert and Save Marks</button></div>`;
  }
  const { targetName } = bulkBuildReportHtml();
  const targetMax = Number(c.target);
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px">
      <div><label class="form-label text-muted">Selected assessments</label><div class="font-semibold">${c.selected.length}</div><ul style="margin:8px 0 0;padding-left:18px;font-size:12px;color:var(--gray-600)">${c.selected.map(r => `<li>${Utils.escapeHtml(Utils.buildAssessmentDisplayName(r.a, bc.types))} (max ${Utils.escapeHtml(r.a.maximum_mark)})</li>`).join('')}</ul></div>
      <div><label class="form-label text-muted">Target assessment</label>
        <div class="font-semibold">${Utils.escapeHtml(targetName)}</div><div class="text-xs text-muted">Created automatically as a new draft helper — visible only on this page</div>
        <div class="text-xs" style="margin-top:6px;">Type: ${Utils.escapeHtml(assessmentTypeName(bc.types, bc.targetTypeId, 'Assessment'))} · Class: ${Utils.escapeHtml(c.className)} · Subject: ${Utils.escapeHtml(c.subjectName)}</div></div>
      <div><label class="form-label text-muted">Students</label><div><span class="font-semibold">${c.convertedCount}</span> converted <span class="text-muted">·</span> <span style="${c.missingCount ? 'color:var(--red-600)' : 'color:var(--gray-500)'}">${c.missingCount} missing</span></div></div>
      <div><label class="form-label text-muted">Conversion</label><div class="font-semibold" style="font-size:13px">Converted = (Total ÷ ${c.totalPossible}) × ${targetMax}</div><div class="text-xs text-muted">Target maximum: ${targetMax} · Rounding: ${bc.decimals ? '1 decimal place' : 'whole numbers'}</div></div>
    </div>
    <div class="alert alert-warning" style="margin-top:12px"><i data-lucide="info"></i><div>This creates the helper assessment and records converted marks. Your original assessments are <strong>not modified</strong>. Duplicate submissions are prevented by the unique (assessment, learner) constraint.</div></div>
    <div style="margin-top:14px"><button id="bulk-save-btn" class="btn btn-success btn-lg" onclick="doBulkSave()"><i data-lucide="save"></i> Convert and Save Marks</button></div>`;
}

async function doBulkSave() {
  if (bulkApplying) return;
  const bc = bulkConvert, c = bc.conversion;
  if (!c || bc.saved) return;
  if (!c.convertedCount) return Utils.toast('No students could be converted', 'error');

  bulkApplying = true;
  const saveBtn = document.querySelector('#bulk-save-btn');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.innerHTML = '<i data-lucide="loader" style="display:inline-block;animation:spin 1s linear infinite"></i> Saving...'; }
  const now = new Date().toISOString();
  const targetMax = Number(bc.target) || c.target;
  const targetName = 'Combined ' + c.subjectName + ' — Converted out of ' + targetMax + ' marks';

  const resetBtn = () => {
    bulkApplying = false;
    const b = document.querySelector('#bulk-save-btn');
    if (b) { b.disabled = false; b.innerHTML = '<i data-lucide="save"></i> Convert and Save Marks'; }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  try {
    let targetId = null;
    {
      const data = {
        name: targetName,
        display_name: targetName,
        assessment_type_id: bc.targetTypeId || null,
        period_type: 'other',
        period_value: null,
        period_label: 'Combined Conversion of ' + c.selected.length + ' assessments',
        unit_number: null,
        unit_name: null,
        unit: null,
        class_id: bc.selClassId,
        subject_id: bc.selSubjectId,
        teacher_id: bc.teacherId,
        academic_year_id: bc.selYearId,
        term_id: bc.selTermId || null,
        maximum_mark: targetMax,
        weight: null,
        assessment_date: bc.targetDate || now.slice(0, 10),
        description: 'Combined marks conversion: ' + c.selected.map(r => Utils.buildAssessmentDisplayName(r.a, bc.types)).join('; ') + '. Original total possible: ' + c.totalPossible + '.',
        status: bc.targetStatus || 'draft',
        converted_from_maximum: c.totalPossible,
        converted_at: now,
        converted_by: bc.teacherId
      };
      const { data: ins, error } = await sbClient.from('assessments').insert(data).select().single();
      if (error) throw error;
      targetId = ins.id;
    }

    const convertibles = c.rows.filter(r => r.convertible);
    const markRows = convertibles.map(r => ({
      assessment_id: targetId,
      learner_id: r.l.id,
      mark: r.conv,
      percentage: r.pct,
      grade: r.grade === '-' ? null : r.grade,
      remark: r.remark === 'Incomplete' ? null : r.remark,
      original_mark: r.obtained,
      original_maximum: r.possible,
      status: 'draft',
      updated_at: now
    }));
    if (markRows.length) {
      const { error } = await sbClient.from('marks').upsert(markRows, { onConflict: 'assessment_id,learner_id' });
      if (error) throw error;
    }

    for (const s of c.selected) {
      await sbClient.from('audit_logs').insert({
        user_id: Auth.currentUser?.id,
        user_name: Auth.currentUser?.full_name,
        role: Auth.currentUser?.role,
        action: 'MARKS_CONVERTED',
        assessment_id: s.a.id,
        old_value: 'Combine conversion | Class: ' + c.className + ' | Subject: ' + c.subjectName + ' | Sources: ' + c.selected.map(r => Utils.buildAssessmentDisplayName(r.a, bc.types)).join('; ') + ' | Students: ' + c.convertedCount + ' (' + c.missingCount + ' missing) | Total possible: ' + c.totalPossible + ' | Method: (Total obtained / Total possible) x ' + targetMax,
        new_value: 'Target: ' + targetName + ' (' + targetId + ') | Target max: ' + targetMax + ' | Converted marks: ' + markRows.length + ' | Missing: ' + c.missingCount,
        timestamp: now
      });
    }

    try {
      const sourceAssessmentId = c.selected[0]?.a.id;
      const { data: dosUsers, error } = await sbClient.rpc('rms_dos_notification_recipients', {
        p_assessment_id: sourceAssessmentId
      });
      if (error) throw error;
      if (dosUsers && dosUsers.length) {
        const rows = dosUsers.map(d => ({
          recipient_user_id: d.user_id,
          sender_user_id: Auth.currentUser?.id,
          title: 'Combined Marks Conversion',
          message: bc.teacherName + ' combined ' + c.selected.length + ' assessments (' + c.subjectName + ', ' + c.className + ') into ' + targetName + ' (' + targetMax + ' marks) — ' + markRows.length + ' marks recorded.',
          notification_type: 'SYSTEM',
          category: 'assessment',
          priority: 'normal',
          entity_type: 'assessments',
          entity_id: sourceAssessmentId,
          is_read: false
        }));
        if (rows.length) await sbClient.from('notifications').insert(rows);
      }
    } catch (e) { console.error('Notification error:', e); }

    DB.invalidateMany(['marks', 'assessments', 'audit_logs', 'notifications']);
    if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();

    bc.saved = true;
    bc.savedInfo = { targetName, targetId, targetMax, converted: markRows.length, missing: c.missingCount, sources: c.selected.length };
    Utils.toast('Converted ' + markRows.length + ' student marks into ' + targetName + ' — synced', 'success');
    bulkRenderSaved();
  } catch (e) {
    Utils.toast('Save error: ' + e.message, 'error');
    resetBtn(); return;
  } finally {
    bulkApplying = false;
  }
}

function bulkRenderSaved() {
  const bc = bulkConvert, i = bc.savedInfo;
  setContent(`
    <div class="card" style="max-width:640px;margin:40px auto;text-align:center"><div class="card-body">
      <div style="font-size:42px;color:var(--green-600);margin-bottom:12px"><i data-lucide="circle-check" style="width:42px;height:42px"></i></div>
      <h2 class="page-title" style="font-size:20px;margin-bottom:6px">Conversion Saved Successfully</h2>
      <p class="text-sm text-muted" style="margin-bottom:16px">${i.converted} converted marks were recorded against the target assessment.</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-value">${i.sources}</div><div class="stat-label">Assessments combined</div></div>
        <div class="stat-card"><div class="stat-value">${i.converted}</div><div class="stat-label">Marks saved</div></div>
        <div class="stat-card"><div class="stat-value">${i.missing}</div><div class="stat-label">Missing marks</div></div>
        <div class="stat-card"><div class="stat-value">${i.targetMax}</div><div class="stat-label">Target maximum</div></div>
      </div>
      <div class="alert alert-info" style="justify-content:center"><i data-lucide="info"></i><div>Target assessment: <strong>${Utils.escapeHtml(i.targetName)}</strong></div></div>
      <div class="flex justify-center" style="gap:10px;margin-top:16px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="Router.go('teacher/enter-marks')"><i data-lucide="file-pen"></i> Enter Marks</button>
        <button class="btn btn-outline" onclick="bulkSavedSheet()"><i data-lucide="eye"></i> View converted marks</button>
        <button class="btn btn-secondary" onclick="renderConvertMarks()"><i data-lucide="plus"></i> Start New Conversion</button>
      </div>
    </div></div>`);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

/* ---------------- Shared state setters ---------------- */

function bulkSet(key, value) {
  if (!bulkConvert) return;
  bulkConvert[key] = value;
}
