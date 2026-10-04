/* ============================================================
   CANONICAL ASSESSMENT TYPES
   The single source of truth for which assessment types RMS-MIS
   offers. Every dropdown, filter and validator reads this list,
   so the options are always available with no database seed and
   no manual initialisation step.

   Storage note: assessments.assessment_type_id is a UUID that
   references assessment_types(id), and that column is preserved.
   The constant below defines the CANONICAL SET; ensureAssessmentTypes()
   quietly makes sure a matching row exists for each entry (insert only,
   never delete/rename), and the UI maps constant name -> row id on save.
   Legacy types already used by existing assessments keep working and are
   still displayed in lists/reports, because those resolve the name from
   the stored row.
   ============================================================ */
const ASSESSMENT_TYPES = [
  'CAT',
  'Monthly Test',
  'Weekly Test',
  'Beginning Exam',
  'Mid-Term Exam',
  'End of Term Exam',
  'End of Unit',
  'Assignment',
  'Quiz',
  'Project',
  'Homework',
  'Classwork',
  'Practical',
  'Portfolio',
  'Oral Test',
  'Participation',
  'Diagnostic Test',
  'Other'
];

/* Default maximum mark + period hint per canonical type. */
const ASSESSMENT_TYPE_DEFAULTS = {
  'CAT': { max: 20, hint: null },
  'Monthly Test': { max: 20, hint: 'month' },
  'Weekly Test': { max: 10, hint: 'week' },
  'Beginning Exam': { max: 50, hint: 'term' },
  'Mid-Term Exam': { max: 50, hint: 'term' },
  'End of Term Exam': { max: 70, hint: 'term' },
  'End of Unit': { max: 100, hint: 'unit' },
  'Assignment': { max: 20, hint: 'other' },
  'Quiz': { max: 10, hint: 'week' },
  'Project': { max: 25, hint: 'unit' },
  'Homework': { max: 10, hint: 'week' },
  'Classwork': { max: 15, hint: 'week' },
  'Practical': { max: 25, hint: 'other' },
  'Portfolio': { max: 30, hint: 'other' },
  'Oral Test': { max: 20, hint: 'other' },
  'Participation': { max: 10, hint: 'other' },
  'Diagnostic Test': { max: 30, hint: 'term' },
  'Other': { max: 20, hint: 'other' }
};

const Utils = {
  _gradingCache: null,
  _gradingPromise: null,
  assessmentTypesCache: null,
  _ensureTypesPromise: null,

  pct(mark, max) {
    if (!max || (!mark && mark !== 0)) return 0;
    return Math.round((mark / max) * 10000) / 100;
  },

  _matchingGradeRange(pct, scale) {
    if (!scale || !scale.length) return null;
    const ranges = [...scale].sort((a, b) => Number(b.minimum_percentage) - Number(a.minimum_percentage));
    for (const s of ranges) {
      if (Number(pct) >= Number(s.minimum_percentage)) return s;
    }
    return ranges[ranges.length - 1] || null;
  },

  grade(pct, scale) {
    if (!scale || !scale.length) {
      if (pct >= 80) return 'A';
      if (pct >= 75) return 'B';
      if (pct >= 70) return 'C';
      if (pct >= 65) return 'D';
      if (pct >= 60) return 'E';
      if (pct >= 50) return 'S';
      return 'F';
    }
    const match = this._matchingGradeRange(pct, scale);
    return match ? match.grade : 'F';
  },

  remark(pct, scale) {
    if (!scale || !scale.length) {
      if (pct >= 80) return 'Excellent';
      if (pct >= 75) return 'Very Good';
      if (pct >= 70) return 'Good';
      if (pct >= 65) return 'Satisfactory';
      if (pct >= 60) return 'Adequate';
      if (pct >= 50) return 'Minimum Pass';
      return 'Fail';
    }
    const match = this._matchingGradeRange(pct, scale);
    return match ? (match.descriptor || match.remark || 'Fail') : 'Fail';
  },

  passFail(pct, passMark = 50) {
    return pct >= passMark ? 'PASS' : 'FAIL';
  },

  /** @deprecated Use GradingEngine.calculateGradeSync instead */
  gradeInfo(pct, scale) {
    if (typeof GradingEngine !== 'undefined') {
      return GradingEngine.calculateGradeSync(pct, scale);
    }
    const numericPct = Number(pct) || 0;
    return { grade: this.grade(numericPct, scale), descriptor: this.remark(numericPct, scale), isPass: numericPct >= 50 };
  },

  classStats(marks, maxMark) {
    const v = marks.filter(m => m !== null && m !== undefined);
    const n = v.length;
    if (!n) return { count: 0, avg: 0, high: 0, low: 0, pass: 0, fail: 0, passRate: 0, failRate: 0 };
    const pcts = v.map(m => this.pct(m, maxMark));
    const avg = pcts.reduce((a, b) => a + b, 0) / n;
    const pass = pcts.filter(p => p >= 50).length;
    return {
      count: n,
      avg: Math.round(avg * 100) / 100,
      high: Math.max(...pcts),
      low: Math.min(...pcts),
      pass,
      fail: n - pass,
      passRate: Math.round((pass / n) * 10000) / 100,
      failRate: Math.round(((n - pass) / n) * 10000) / 100
    };
  },

  gradeDist(grades) {
    const d = {};
    for (const g of grades) { if (g) d[g] = (d[g] || 0) + 1; }
    return d;
  },

  positions(items) {
    const sorted = [...items].sort((a, b) => b.pct - a.pct);
    const result = [];
    let pos = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].pct < sorted[i - 1].pct) pos = i + 1;
      result.push({ id: sorted[i].id, position: pos });
    }
    return result;
  },

  statusColor(s) {
    const m = { approved: 'success', locked: 'success', submitted: 'info', rejected: 'danger', draft: 'warning', active: 'success', inactive: 'gray', pending: 'warning', upcoming: 'info', archived: 'gray' };
    return 'badge-' + (m[s] || 'gray');
  },

  statusIcon(s) {
    const m = { approved: 'check-circle-2', locked: 'lock', submitted: 'send', rejected: 'x-circle', draft: 'file-edit', active: 'check-circle-2', inactive: 'x-circle', pending: 'clock', upcoming: 'calendar-clock', archived: 'archive' };
    return m[s] || 'circle';
  },

  dateStr(d) {
    if (!d) return '-';
    return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  dateTimeStr(d) {
    if (!d) return '-';
    return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },

  MONTH_LONG: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

  ASSESSMENT_TYPE_HINTS: {
    'CAT': null,
    'Monthly Test': 'month',
    'Weekly Test': 'week',
    'Beginning Exam': 'term',
    'Beginning of Term Exam': 'term',
    'Mid-Term Exam': 'term',
    'End of Term Exam': 'term',
    'End of Unit': 'unit',
    'Assignment': 'other',
    'Quiz': 'week',
    'Project': 'unit',
    'Homework': 'week',
    'Classwork': 'week',
    'Practical': 'other',
    'Portfolio': 'other',
    'Oral Test': 'other',
    'Participation': 'other',
    'Diagnostic Test': 'term',
    'Other': 'other'
  },

  /* -------- Canonical assessment types -------- */

  ASSESSMENT_TYPES,
  ASSESSMENT_TYPE_DEFAULTS,

  /* Used only when the assessment_types table cannot be read (fresh install or
     missing GRANT). id is deliberately null - never a fake value - so no
     invalid UUID can ever be written to assessments.assessment_type_id; the
     save path turns an empty id into NULL and the sync repairs the real row
     once permissions allow it. */
  canonicalAssessmentTypeRows() {
    return ASSESSMENT_TYPES.map((name, index) => {
      const d = ASSESSMENT_TYPE_DEFAULTS[name] || { max: 30, hint: null };
      return {
        id: null,
        name,
        code: this.assessmentTypeCode(name),
        description: name === 'CAT' ? 'Continuous assessment test' : name,
        default_maximum_mark: d.max,
        weight: null,
        contributes_to_combined: true,
        display_order: index + 1,
        status: 'active',
        period_hint: d.hint,
        is_standard: true
      };
    });
  },

  isCanonicalType(name) {
    const n = (name || '').trim().toLowerCase();
    return ASSESSMENT_TYPES.some(t => t.toLowerCase() === n);
  },

  /* Guards assessments.assessment_type_id against placeholder values coming
     from fallback rows (id = null), which would otherwise be sent as the
     literal string "null" or an empty value and fail the UUID column. */
  isValidUuid(v) {
    return typeof v === 'string'
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  },

  /* Resolve a canonical name to the assessment_types row that stores it.
     Matches on name first, then on the derived code, so a row created
     before the canonical list existed is reused instead of duplicated. */
  findTypeRowByName(types, name) {
    if (!Array.isArray(types)) return null;
    const target = (name || '').trim().toLowerCase();
    if (!target) return null;
    return types.find(t => (t.name || '').trim().toLowerCase() === target)
        || types.find(t => Utils.assessmentTypeCode(t.name) === Utils.assessmentTypeCode(name))
        || null;
  },

  /* Short stable code for a canonical type name (CAT, MLT, WKT, BOT). */
  assessmentTypeCode(name) {
    const n = (name || '').trim().toLowerCase();
    if (n === 'cat') return 'CAT';
    if (n === 'monthly test') return 'MLT';
    if (n === 'weekly test') return 'WKT';
    if (n === 'beginning exam' || n === 'beginning of term exam') return 'BOT';
    if (n === 'mid-term exam') return 'MTE';
    if (n === 'end of term exam') return 'ETE';
    if (n === 'end of unit') return 'EOU';
    if (n === 'assignment') return 'ASS';
    if (n === 'quiz') return 'QUIZ';
    if (n === 'project') return 'PROJ';
    if (n === 'homework') return 'HW';
    if (n === 'classwork') return 'CW';
    if (n === 'practical') return 'PRA';
    if (n === 'portfolio') return 'PORT';
    if (n === 'oral test') return 'ORAL';
    if (n === 'participation') return 'PART';
    if (n === 'diagnostic test') return 'DIAG';
    if (n === 'other') return 'OTH';
    return (name || '').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  },

  invalidateAssessmentTypeCaches() {
    this.assessmentTypesCache = null;
    if (typeof DB !== 'undefined' && DB.invalidate) DB.invalidate('assessment_types');
    if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('assessmentTypes');
    if (typeof invalidateAssessmentTypesPageCache === 'function') invalidateAssessmentTypesPageCache();
  },

  /* Makes sure a row exists for every canonical type. Purely additive:
     inserts only what is missing, never renames or deletes anything.

     Behaviour:
       - Runs on login and whenever a page first fetches the type list.
       - Skips the network when the cache already resolves every canonical
         name to a real row, so it costs nothing after the first success.
       - Insert uses ON CONFLICT (name) DO NOTHING, so two tabs or a retry
         can never produce duplicate-row errors.
       - Only a DOS account attempts the write (matching the RLS policy);
         other roles just read.
       - Every failure is logged with a [sync] prefix so problems are
         visible in the browser console instead of silently swallowed.
       - If nothing can be read, returns canonical rows with id = null
         (never a fake UUID) so the UI still lists every type and the save
         path writes NULL rather than an invalid foreign key. */
  async ensureAssessmentTypes(options = {}) {
    if (typeof sbClient === 'undefined') return this.canonicalAssessmentTypeRows();

    const forceRefresh = options === true || options.forceRefresh === true;

    // Deduplicate concurrent calls (login + first page render racing), and
    // never reject: sync is best-effort and must not break any page.
    if (Utils._ensureTypesPromise) {
      if (!forceRefresh) return Utils._ensureTypesPromise;
      await Utils._ensureTypesPromise;
    }
    Utils._ensureTypesPromise = this._ensureAssessmentTypesRun(forceRefresh)
      .catch(() => {
        const fallback = this.canonicalAssessmentTypeRows();
        Utils.assessmentTypesCache = fallback;
        return fallback;
      })
      .finally(() => { Utils._ensureTypesPromise = null; });
    return Utils._ensureTypesPromise;
  },

  async _ensureAssessmentTypesRun(forceRefresh = false) {
    if (forceRefresh) this.invalidateAssessmentTypeCaches();

    // Skip the network only when every canonical name already resolves to a
    // REAL row (id present). Rows with id = null are placeholders, not synced.
    const cached = Utils.assessmentTypesCache;
    if (!forceRefresh && Array.isArray(cached) && ASSESSMENT_TYPES.every(n => {
      const r = Utils.findTypeRowByName(cached, n);
      return r && r.id;
    })) return cached;

    const role = (typeof Auth !== 'undefined' && Auth.getRole) ? Auth.getRole() : null;
    const canWrite = role === 'dos';

    let existing = [];
    let readError = null;
    try {
      if (typeof DB !== 'undefined' && DB.getFresh) {
        existing = await DB.getFresh('assessment_types');
      } else {
        const res = await sbClient.from('assessment_types').select('*');
        if (res.error) readError = res.error; else existing = res.data || [];
      }
    } catch (e) { readError = e; }
    if (readError) {
      console.warn('[sync] Cannot read assessment_types: ' + (readError.message || readError)
        + ' — run the GRANT SELECT block (deployment_pending.sql block 7).');
    }

    const missing = ASSESSMENT_TYPES
      .filter(n => !Utils.findTypeRowByName(existing, n))
      .map(n => {
        const d = ASSESSMENT_TYPE_DEFAULTS[n] || { max: 30, hint: null };
        return {
          name: n, code: Utils.assessmentTypeCode(n),
          description: n === 'CAT' ? 'Continuous assessment test' : n,
          default_maximum_mark: d.max, weight: null,
          contributes_to_combined: true, display_order: ASSESSMENT_TYPES.indexOf(n) + 1,
          status: 'active', period_hint: d.hint, is_standard: true
        };
      });

    if (missing.length && canWrite) {
      let writeError = null;
      try {
        const res = await sbClient.from('assessment_types')
          .upsert(missing, { onConflict: 'name', ignoreDuplicates: true });
        if (res.error) writeError = res.error;
      } catch (e) { writeError = e; }
      if (writeError && writeError.code !== '23505') {
        console.warn('[sync] Could not add ' + missing.length + ' assessment type(s) ('
          + missing.map(m => m.name).join(', ') + '): ' + (writeError.message || writeError)
          + (writeError.code === '42501' || /permission|row-level/i.test(writeError.message || '')
            ? ' — the logged-in user needs role=dos in public.users (block 8).' : ''));
      } else if (!writeError) {
        console.info('[sync] Added assessment type(s): ' + missing.map(m => m.name).join(', '));
      }

      // Re-read so the dropdown gets the generated UUIDs.
      try {
        if (typeof DB !== 'undefined' && DB.getFresh) {
          DB.invalidate('assessment_types');
          existing = await DB.getFresh('assessment_types');
        } else {
          const res = await sbClient.from('assessment_types').select('*');
          if (!res.error && Array.isArray(res.data) && res.data.length) existing = res.data;
        }
      } catch (e) { /* keep the previous view */ }
    } else if (missing.length && !canWrite) {
      console.warn('[sync] ' + missing.length + ' assessment type(s) missing ('
        + missing.map(m => m.name).join(', ') + ') and this account cannot add them — '
        + 'sign in as a DOS account once to complete the sync.');
    }

    const real = (existing || []).filter(r => r && r.id);
    if (real.length) {
      Utils.assessmentTypesCache = real;
      if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate('assessmentTypes');
      return real;
    }

    const fallback = this.canonicalAssessmentTypeRows();
    Utils.assessmentTypesCache = fallback;
    return fallback;
  },

  /* Default hint map so the conditional creation form works even before the
   DB migration has added assessment_types.period_hint. */
  getTypePeriodHint(typeOrName) {
    if (!typeOrName) return null;
    if (typeof typeOrName === 'object') {
      if (typeOrName.period_hint) return typeOrName.period_hint;
      typeOrName = typeOrName.name;
    }
    return this.ASSESSMENT_TYPE_HINTS[(typeOrName || '').trim()] || null;
  },

  _findType(types, id) {
    if (!types) return null;
    if (Array.isArray(types)) return types.find(t => String(t.id) === String(id)) || null;
    if (types instanceof Map) return types.get(String(id)) || null;
    return null;
  },

  monthLabel(n) {
    const i = parseInt(n, 10);
    if (!isNaN(i) && i >= 1 && i <= 12) return this.MONTH_LONG[i - 1];
    return (n != null && n !== '') ? String(n) : '';
  },

  /* Canonical, standardized label used consistently in marks lists, DOS
     review, marks sheets and report cards. Falls back to legacy `name`/`unit`
     for older assessments when no display_name was stored yet. */
  buildAssessmentDisplayName(a, types) {
    if (!a) return '';
    const typeName = this._findType(types, a.assessment_type_id)?.name || '';

    if (a.display_name && String(a.display_name).trim()) return a.display_name;

    const hint = this.getTypePeriodHint({ period_hint: a.period_type, name: typeName });

    /* End-of-Unit style: Unit N [: Unit name] */
    if (hint === 'unit' || a.unit_number != null || a.unit_name || a.unit) {
      const base = typeName || 'End of Unit';
      let part = '';
      if (a.unit_number != null) part = 'Unit ' + a.unit_number;
      else if (a.period_label) part = a.period_label;
      else if (a.unit) part = a.unit;
      if (part && a.unit_name) part += ': ' + a.unit_name;
      else if (!part && a.unit_name) part = a.unit_name;
      return part ? base + ' — ' + part : base;
    }

    /* Week / Month / Term exam types carry a period label already */
    if (a.period_label) return (typeName ? typeName + ' — ' : '') + a.period_label;

    /* Legacy fallbacks */
    if (a.unit) return (typeName ? typeName + ' — ' : '') + a.unit;
    if (a.name) {
      if (!typeName) return a.name;
      if (a.name.indexOf(typeName) === 0) return a.name;
      return typeName + ' — ' + a.name;
    }
    return typeName || 'Assessment';
  },

  /* Bulk-combine conversion helpers (Convert Marks page) are teacher working
     copies for external use (e.g. CAMIS export) and must NEVER feed official
     reports, report cards or analytics — even if approved. NOTE: this deliberately
     does NOT match in-place converted official assessments (teacher-enter-marks
     Convert action), which keep their own period_type/description. */
  isConversionHelper(a) {
    if (!a) return false;
    if (String(a.description || '').indexOf('Combined marks conversion:') === 0) return true;
    return String(a.period_type || '') === 'other'
      && String(a.period_label || '').indexOf('Combined Conversion') === 0;
  },

  async getGradingScale() {
    if (this._gradingCache) return this._gradingCache;
    if (this._gradingPromise) return this._gradingPromise;
    this._gradingPromise = DB.get('grading_scales').then(data => {
      this._gradingCache = data;
      return data;
    });
    return this._gradingPromise;
  },

  toast(msg, type = 'info') {
    let c = document.getElementById('toast-container');
    if (!c) {
      c = document.createElement('div');
      c.id = 'toast-container';
      c.className = 'toast-container';
      c.setAttribute('aria-live', 'polite');
      document.body.appendChild(c);
    }
    const icons = { success: 'check-circle-2', error: 'x-circle', info: 'info' };
    const t = document.createElement('div');
    t.className = 'toast toast-' + type;
    t.innerHTML = `<i data-lucide="${icons[type] || 'info'}"></i> ${msg}`;
    c.appendChild(t);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => t.remove(), 3500);
  },

  escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  },

  initials(name) {
    return (name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  },

  loading() {
    return `<div class="empty-state"><div class="spinner" style="margin:0 auto;width:32px;height:32px"></div><p style="margin-top:12px;color:var(--gray-500)">Loading...</p></div>`;
  },

  skeleton(count = 4) {
    return Array.from({length: count}, () => 
      `<div class="card skeleton" style="background:linear-gradient(90deg,var(--gray-100) 25%,var(--gray-200) 50%,var(--gray-100) 75%);background-size:200% 100%;animation:shimmer 1.5s infinite"></div>`
    ).join('');
  },

  empty(msg = 'No data found', icon = 'inbox') {
    return `<div class="empty-state"><div class="empty-icon"><i data-lucide="${icon}"></i></div><h3>${msg}</h3><p>Get started by adding some data.</p></div>`;
  },

  errorCard(msg = 'Unable to Load Data', detail = 'We couldn\u2019t retrieve this information. Please try again.') {
    return `<div class="error-card"><div class="error-icon"><i data-lucide="alert-triangle"></i></div><h3>${msg}</h3><p>${detail}</p></div>`;
  },

  compressImage(file, maxWidth = 300, maxHeight = 300, quality = 0.8) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = (e) => {
        const img = new Image();
        img.onerror = reject;
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round((height * maxWidth) / width);
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round((width * maxHeight) / height);
              height = maxHeight;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/png', quality));
        };
        img.src = e.target.result;
      };
      reader.readAsDataURL(file);
    });
  }
};

if (typeof window !== 'undefined') {
  window.ASSESSMENT_TYPES = ASSESSMENT_TYPES;
  window.ASSESSMENT_TYPE_DEFAULTS = ASSESSMENT_TYPE_DEFAULTS;
  window.Utils = Utils;
}

function assessmentTypeName(types, id, fallback) {
  const type = Utils._findType(types, id);
  if (id && !type) {
    console.warn('[assessment-type] Missing or invalid assessment type record for assessment_type_id:', id);
  }
  return (type && type.name) || fallback || 'Assessment';
}

window.getGrading = function getGrading() {
  return Utils.getGradingScale();
};

async function getSchoolSettings() {
  try {
    const res = await DB.query('school_settings', '*');
    return res[0] || {};
  } catch (e) {
    return {};
  }
}

const Scope = {
  eduLevel() {
    try {
      return (typeof Auth !== 'undefined' && Auth.currentUser) ? (Auth.currentUser.education_level || null) : null;
    } catch (e) { return null; }
  },

  isDos() {
    return typeof Auth !== 'undefined' && Auth.isAdmin();
  },

  isScoped() {
    return this.isDos() && !!this.eduLevel();
  },

  isPrimary() {
    return this.isScoped() && this.eduLevel() === 'PRIMARY';
  },

  isSecondary() {
    return this.isScoped() && this.eduLevel() === 'SECONDARY';
  },

  label() {
    if (this.isPrimary()) return 'DOS PRIMARY';
    if (this.isSecondary()) return 'DOS SECONDARY';
    if (this.isDos()) return 'DOS GLOBAL';
    return 'DOS';
  },

  subLabel() {
    if (this.isPrimary()) return 'Primary Administration';
    if (this.isSecondary()) return 'Secondary Administration';
    if (this.isDos()) return 'Whole School Administration';
    return '';
  },

  categories() {
    if (this.isPrimary()) return ['Primary'];
    if (this.isSecondary()) return ['Lower Secondary', 'Upper Secondary'];
    return null;
  },

  matchesClass(cls) {
    if (!this.isScoped()) return true;
    const cat = EducationLevels.getCategory(cls);
    return (this.categories() || []).includes(cat);
  },

  matchesSubject(subj) {
    if (!this.isScoped()) return true;
    const s = String((subj && subj.level) || 'Both').trim().toUpperCase();
    if (s === 'BOTH' || s === '' || s === 'NULL') return true;
    if (this.isPrimary()) return s === 'PRIMARY';
    if (this.isSecondary()) return ['SECONDARY', 'LOWER SECONDARY', 'UPPER SECONDARY'].includes(s);
    return true;
  },

  filterClasses(classes) {
    return (classes || []).filter(c => this.matchesClass(c));
  },

  filterSubjects(subjects) {
    return (subjects || []).filter(s => this.matchesSubject(s));
  },

  filterLearners(learners, classes) {
    if (!this.isScoped()) return learners || [];
    const ids = new Set((classes || []).map(c => String(c.id)));
    return (learners || []).filter(l => ids.has(String(l.class_id)));
  },

  filterAssessments(assessments, classes) {
    if (!this.isScoped()) return assessments || [];
    const byId = new Map((classes || []).map(c => [String(c.id), c]));
    return (assessments || []).filter(a => byId.has(String(a.class_id)) && this.matchesClass(byId.get(String(a.class_id))));
  },

  assertClassAccess(cls) {
    if (!cls || !cls.id) return;
    if (!this.matchesClass(cls)) {
      throw new Error(`Access restricted: ${EducationLevels.getCategory(cls)} classes are outside your ${this.label()} scope.`);
    }
  }
};

function getCurrentUserScope() {
  return {
    level: Scope.eduLevel(),
    isScoped: Scope.isScoped(),
    isPrimary: Scope.isPrimary(),
    isSecondary: Scope.isSecondary(),
    label: Scope.label()
  };
}

const EducationLevels = {
  CATEGORIES: {
    PRIMARY: 'Primary',
    LOWER_SECONDARY: 'Lower Secondary',
    UPPER_SECONDARY: 'Upper Secondary'
  },

  getCategory(cls) {
    if (!cls) return 'Lower Secondary';
    const levelStr = typeof cls === 'string' ? cls : (cls.education_level || cls.level || cls.name || '');
    const clean = levelStr.trim().toUpperCase();

    if (clean.includes('PRIMARY') || /^P[1-6]/.test(clean)) return 'Primary';
    if (clean.includes('UPPER SECONDARY') || clean.includes('UPPER') || /^(S[4-6])/.test(clean)) return 'Upper Secondary';
    if (clean.includes('LOWER SECONDARY') || clean.includes('LOWER') || /^(S[1-3])/.test(clean)) return 'Lower Secondary';
    if (clean.includes('NURSERY')) return 'Nursery';
    if (clean.includes('TVET')) return 'TVET';
    return 'Lower Secondary';
  },

  getAllowedGrades(category) {
    const cat = (category || '').trim().toUpperCase();
    if (cat.includes('PRIMARY')) return ['P1', 'P2', 'P3', 'P4', 'P5', 'P6'];
    if (cat.includes('UPPER')) return ['S4', 'S5', 'S6'];
    if (cat.includes('LOWER')) return ['S1', 'S2', 'S3'];
    return ['P1','P2','P3','P4','P5','P6','S1','S2','S3','S4','S5','S6'];
  },

  getAllowedStreams(grade) {
    const g = (grade || '').trim().toUpperCase();
    if (g === 'S4' || g === 'S5') return ['Stream 1', 'Stream 2'];
    if (g === 'S6') return ['MEG', 'PCM', 'MCE'];
    if (g.startsWith('P') || g.startsWith('S')) return ['Stream 1', 'Stream 2', 'A', 'B'];
    return [];
  },

  isValidCombination(category, grade, stream) {
    const cat = this.getCategory(category || grade);
    const validGrades = this.getAllowedGrades(cat);
    const g = (grade || '').trim().toUpperCase();
    const st = (stream || '').trim().toUpperCase();

    if (g && !validGrades.includes(g)) {
      return { valid: false, message: `Class grade ${grade} is not valid for ${cat}` };
    }
    if (g === 'S6' && st && !['MEG', 'PCM', 'MCE', 'STREAM 1', 'STREAM 2'].includes(st)) {
      return { valid: false, message: `S6 stream must be MEG, PCM, or MCE (got ${stream})` };
    }
    if ((g === 'S1' || g === 'S2' || g === 'S3') && ['MEG', 'PCM', 'MCE'].includes(st)) {
      return { valid: false, message: `Lower Secondary (${g}) cannot have Upper Secondary stream ${stream}` };
    }
    if (cat === 'Primary' && (st === 'PCM' || st === 'MEG' || st === 'MCE' || g.startsWith('S'))) {
      return { valid: false, message: `Primary classes cannot be assigned Secondary grades/streams` };
    }
    return { valid: true };
  }
};
