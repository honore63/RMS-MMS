const ImportSystem = (() => {
  'use strict';

  const STATE = {
    type: null,
    fileName: '',
    fileSize: 0,
    headers: [],
    dataRows: [],
    column: {},
    records: [],
    counts: { total: 0, valid: 0, errors: 0, duplicates: 0, exists: 0, warnings: 0 },
    ctx: {},
    filter: 'all',
    selection: {}
  };

  const es = v => (typeof Utils !== 'undefined' && Utils.escapeHtml) ? Utils.escapeHtml(v) : String(v == null ? '' : v);
  const normHdr = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normKey = v => String(v == null ? '' : v).toUpperCase().replace(/[\s\-–—./]/g, '');
  const yearKey = v => String(v == null ? '' : v).replace(/\D/g, '');
  const lower = v => String(v == null ? '' : v).toLowerCase();
  const isCode11 = v => /^\d{11}$/.test(String(v == null ? '' : v).trim());
  const isStudentCode = v => /^\d{11,12}$/.test(String(v == null ? '' : v).trim());

  function parseDateStr(v) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})[-/.](1[0-2]|0?[1-9])[-/.](3[01]|[12][0-9]|0?[1-9])$/);
    if (m) return m[1] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).padStart(2, '0');
    m = s.match(/^(3[01]|[12][0-9]|0?[1-9])[-/.](1[0-2]|0?[1-9])[-/.](\d{4})$/);
    if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    const d = new Date(s);
    if (!isNaN(d.getTime()) && s.length === 10) return String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return null;
  }

  function normalizeGender(v) {
    const g = String(v == null ? '' : v).trim().toUpperCase();
    if (g === 'M' || g === 'MALE' || g === 'BOY') return 'M';
    if (g === 'F' || g === 'FEMALE' || g === 'GIRL') return 'F';
    return '';
  }

  function resolveYear(value, ctx, defaultToActive) {
    if (value && String(value).trim()) {
      const k = yearKey(value);
      const hit = (ctx.years || []).find(y => (y.name && yearKey(y.name) === k) || (y.start_year && String(y.start_year) === k));
      if (hit) return hit;
      return null;
    }
    if (!defaultToActive) return null;
    const years = ctx.years || [];
    if (!years.length) return null;
    if (typeof getActiveYearId === 'function') {
      const id = getActiveYearId(years);
      return years.find(y => y.id === id) || null;
    }
    return years.find(y => y.status === 'active') || years[0] || null;
  }

  function resolveClass(clsRaw, streamRaw, ctx) {
    const base = String(clsRaw || '').trim();
    if (!base) return { id: null, name: '' };
    const baseKey = normKey(base);
    const stream = String(streamRaw || '').trim();
    const list = ctx.classes || [];
    const byKey = ctx.classesByNorm || {};
    let name = baseKey;
    let id = byKey[name] || null;
    if (stream && !id) {
      const withStream = name + normKey(stream);
      if (byKey[withStream]) { name = withStream; id = byKey[withStream]; }
    }
    if (!id && stream) {
      const withStream = baseKey + normKey(stream);
      if (byKey[withStream]) { name = withStream; id = byKey[withStream]; }
    }
    if (!id && baseKey) id = byKey[baseKey] || null;
    if (!id) {
      const hit = list.find(c => lower(c.name) === lower(base) || (stream && lower(c.name) === lower(base + stream)));
      if (hit) { id = hit.id; name = normKey(hit.name); }
    }
    return { id, name };
  }

  function assignmentKey(row, ctx) {
    return [row.teacher_id || '', row.class_id || '', row.subject_id || '', row.academic_year_id || ''].join('|');
  }

  function assessmentKey(row, ctx) {
    return normKey(row.name || '') + '|' + (row.class_id || '') + '|' + (row.subject_id || '') + '|' + dateKey(row.assessment_date);
  }

  function parseDecimal(v) {
    const s = String(v == null ? '' : v).trim().replace(/\s+/g, '').replace(',', '.');
    if (!s) return null;
    if (s.indexOf('.') >= 0) {
      if (!/^\d+\.?\d*$/.test(s)) return null;
    } else if (!/^\d+$/.test(s)) {
      return null;
    }
    const n = parseFloat(s);
    if (!isFinite(n) || n < 0) return null;
    return n;
  }

  function dateKey(value) {
    if (!value) return '';
    const s = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    const d = parseDateStr(s);
    return d || '';
  }

  function fetchRelated(ctx, tables) {
    const jobs = tables.map(t => {
      if (t === 'grades') return DB.get('grading_scales');
      return DB.get(t);
    });
    return Promise.all(jobs).then(results => {
      tables.forEach((t, i) => { ctx[t] = results[i]; });
    });
  }

  function resolveGrade(percentage, ctx) {
    const scales = (ctx.grades || []).slice().sort((a, b) => (a.minimum_percentage || 0) - (b.minimum_percentage || 0));
    for (let i = 0; i < scales.length; i++) {
      const s = scales[i];
      const max = i + 1 < scales.length ? scales[i + 1].minimum_percentage - 0.01 : (s.maximum_percentage != null ? s.maximum_percentage : Infinity);
      if (percentage >= (s.minimum_percentage || 0) && percentage <= max) {
        return { grade: s.grade, remark: s.remark || '' };
      }
    }
    return { grade: null, remark: null };
  }

  function formatFileSize(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function mapColumns(headers, def) {
    const col = {};
    const used = headers.map(() => false);
    def.columns.forEach(c => {
      let found = null;
      for (let i = 0; i < headers.length; i++) {
        if (used[i]) continue;
        const nh = normHdr(headers[i]);
        if (nh && c.aliases.indexOf(nh) !== -1) { found = i; break; }
      }
      col[c.key] = found;
      if (found != null) used[found] = true;
    });
    return col;
  }

  function cellText(raw, text) {
    const t = String(text == null ? '' : text).trim();
    if (typeof raw === 'number' && /[eE]/.test(t)) t.replace(/[eE].*$/, '');
    return t;
  }

  function buildSheetRows(textRows, rawRows) {
    if (!textRows.length) return { headers: [], rows: [] };
    const headers = textRows[0].map(h => String(h == null ? '' : h).trim());
    const width = headers.length;
    const rows = [];
    for (let r = 1; r < textRows.length; r++) {
      const tr = textRows[r] || [];
      const rr = rawRows[r] || [];
      const row = [];
      for (let c = 0; c < width; c++) row.push(cellText(rr[c], tr[c]));
      if (row.every(v => v === '')) continue;
      rows.push(row);
    }
    return { headers, rows };
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    if (!lines.length) return { headers: [], rows: [] };
    const parseRow = line => {
      const result = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
          if (ch === '"') {
            if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
            else inQuotes = false;
          } else current += ch;
        } else {
          if (ch === '"') inQuotes = true;
          else if (ch === ',') { result.push(current.trim()); current = ''; }
          else current += ch;
        }
      }
      result.push(current.trim());
      return result;
    };
    return { headers: parseRow(lines[0]), rows: lines.slice(1).map(parseRow) };
  }

  function readFile(file) {
    return new Promise((resolve, reject) => {
      const isExcel = /\.(xlsx|xls)$/i.test(file.name);
      if (isExcel) {
        if (typeof XLSX === 'undefined') { reject(new Error('Excel import library is not loaded. Check your internet connection and reload the page.')); return; }
        const reader = new FileReader();
        reader.onload = e => {
          try {
            const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
            const sheet = wb.Sheets[wb.SheetNames[0]];
            const textRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
            const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
            resolve(buildSheetRows(textRows, rawRows));
          } catch (err) { reject(err); }
        };
        reader.onerror = () => reject(new Error('Could not read the Excel file.'));
        reader.readAsArrayBuffer(file);
      } else {
        file.text().then(t => resolve(parseCSV(t))).catch(() => reject(new Error('Could not read the CSV file.')));
      }
    });
  }

  function stepHtml(current) {
    const steps = ['Upload', 'Validate', 'Preview', 'Import'];
    return `<div class="import-steps">${steps.map((s, i) => {
      const n = i + 1;
      const cls = n < current ? 'done' : n === current ? 'active' : '';
      return `<span class="import-step ${cls}"><span class="step-num">${n < current ? '<i data-lucide="check"></i>' : n}</span>${s}</span>${n < steps.length ? '<span class="import-step-sep"></span>' : ''}`;
    }).join('')}</div>`;
  }

  function columnsCsvRow(def, row) {
    return def.columns.map(c => {
      const v = row == null ? '' : row[c.key];
      return v == null ? '' : String(v);
    });
  }

  function downloadTextFile(name, text) {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 50);
  }

  function toCsv(rows) {
    return rows.map(r => r.map(c => {
      const s = String(c == null ? '' : c);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(',')).join('\n');
  }

  function csvOrBook(filename, sheetName, head, rows) {
    if (typeof XLSX !== 'undefined') {
      try {
        const aoa = [head].concat(rows);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = head.map(h => ({ wch: String(h).length > 18 ? 34 : 16 }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, sheetName);
        XLSX.writeFile(wb, filename + '.xlsx');
        return true;
      } catch (e) { /* fall through */ }
    }
    downloadTextFile(filename + '.csv', toCsv([head].concat(rows)));
    return true;
  }

  function downloadTemplate(type) {
    const def = DEFS[type];
    if (!def) return;
    if (typeof XLSX !== 'undefined') {
      try {
        const head = def.columns.map(c => c.label);
        const aoa = [head].concat(def.exampleRows);
        const ws = XLSX.utils.aoa_to_sheet(aoa);
        ws['!cols'] = def.columns.map(c => ({ wch: c.type === 'code11' ? 15 : c.label.length > 18 ? 34 : 16 }));
        def.columns.forEach((c, ci) => {
          if (c.type === 'code11') {
            for (let r = 1; r < aoa.length; r++) {
              const cell = ws[XLSX.utils.encode_cell({ r: r, c: ci })];
              if (cell) ws[XLSX.utils.encode_cell({ r: r, c: ci })] = { t: 's', v: String(cell.v) };
            }
          }
        });
        const instr = XLSX.utils.aoa_to_sheet(def.instructions.map(x => [x]));
        instr['!cols'] = [{ wch: 90 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, def.title.replace(/[^A-Za-z ]/g, '').trim().slice(0, 28) || 'Import');
        XLSX.utils.book_append_sheet(wb, instr, 'Instructions');
        XLSX.writeFile(wb, def.filename + '.xlsx');
        Utils.toast('Template downloaded', 'success');
        return;
      } catch (e) { /* fall through */ }
    }
    const nameLine = def.columns.map(c => c.label).join(',');
    const exLines = def.exampleRows.map(r => r.map((c, i) => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : c).join(','));
    downloadTextFile(def.filename + '.csv', toCsv([[nameLine]].concat(exLines.map(l => l.split(',')))));
    Utils.toast('Template downloaded (CSV)', 'success');
  }

  function badged(rec) {
    if (rec.status === 'ready') return '<span class="import-badge import-badge-ready"><i data-lucide="check"></i> Ready</span>';
    if (rec.status === 'duplicate') return '<span class="import-badge import-badge-dup"><i data-lucide="copy"></i> Duplicate</span>';
    if (rec.status === 'exists') return '<span class="import-badge import-badge-exists"><i data-lucide="user-check"></i> Already exists</span>';
    if (rec.status === 'warning') return '<span class="import-badge import-badge-warn"><i data-lucide="triangle-alert"></i> Warning</span>';
    return '<span class="import-badge import-badge-error"><i data-lucide="alert-triangle"></i> Error</span>';
  }

  function computeCounts() {
    const c = { total: STATE.records.length, valid: 0, errors: 0, duplicates: 0, exists: 0, warnings: 0 };
    STATE.records.forEach(r => {
      if (r.status === 'ready') c.valid++;
      else if (r.status === 'error') c.errors++;
      else if (r.status === 'duplicate') c.duplicates++;
      else if (r.status === 'exists') c.exists++;
      else if (r.status === 'warning') c.warnings++;
      if (r.warnings && r.warnings.length) c.warnings++;
    });
    STATE.counts = c;
  }

  function validCols(def) {
    return def.columns.slice();
  }

  function notifyMissingColumns(def, previewDiv) {
    if (!previewDiv) return;
    const req = validCols(def).filter(c => c.req && STATE.column[c.key] == null);
    if (!req.length) return false;
    previewDiv.innerHTML = `
      <div class="alert alert-error"><i data-lucide="alert-circle"></i> This file is missing required columns.</div>
      ${req.map(c => `<div class="form-error" style="margin-top:6px">Required column missing: <strong>${es(c.label)}</strong></div>`).join('')}
      <p class="text-sm text-muted mb-4" style="margin-top:10px">Column names are matched ignoring capitalization and spaces. Examples: <strong>${req[0] ? es(req[0].label) : ''}</strong> or ${req[0] && req[0].aliases ? es(req[0].aliases[0]) : ''}.</p>
      <div class="import-progress"><button class="btn btn-secondary" onclick="ImportSystem.downloadTemplate()"><i data-lucide="download"></i> Download Template</button></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    return true;
  }

  function validateAll(def) {
    const seen = new Map();
    const recs = [];
    for (let i = 0; i < STATE.dataRows.length; i++) {
      const row = STATE.dataRows[i];
      const rec = { rowNumber: i + 2, values: {}, errors: [], warnings: [], status: 'ready', dbRow: null, existingId: null, dupKey: null };
      def.columns.forEach(c => {
        const idx = STATE.column[c.key];
        rec.values[c.key] = idx != null ? String(row[idx] == null ? '' : row[idx]).trim() : '';
      });
      def.validate(rec, STATE.ctx, seen);
      if (rec.dupKey) {
        if (seen.has(rec.dupKey) && rec.status === 'ready') {
          rec.status = 'duplicate';
          rec.errors = [{ field: '', message: 'Duplicate record in the uploaded file.', fix: 'Keep one row per record and remove the duplicate.' }];
        } else {
          seen.set(rec.dupKey, true);
        }
      }
      recs.push(rec);
    }
    STATE.records = recs;
    computeCounts();
  }

  const DEFS = { students: {
    title: 'Import Students',
    noun: 'students',
    table: 'learners',
    allowUpdate: true,
    roles: ['dos'],
    view: 'admin/learners',
    filename: 'Student_Import_Template',
    columns: [
      { key: 'student_code', label: 'Student Code', req: true, type: 'code11', aliases: ['studentcode', 'studentnumber', 'studentno', 'learnercode', 'admissionnumber', 'admissionno', 'regnumber', 'indexno', 'nationalid', 'sn', 'code'] },
      { key: 'first_name', label: 'First Name', req: false, type: 'text', aliases: ['firstname', 'first', 'givenname'] },
      { key: 'last_name', label: 'Last Name', req: false, type: 'text', aliases: ['lastname', 'last', 'surname', 'familyname'] },
      { key: 'student_name', label: 'Student Name', req: false, type: 'text', aliases: ['studentname', 'fullname', 'fullnames', 'name', 'names', 'learnername'] },
      { key: 'gender', label: 'Gender', req: true, type: 'gender', aliases: ['gender', 'sex'] },
      { key: 'date_of_birth', label: 'Date of Birth', req: false, type: 'date', aliases: ['dateofbirth', 'dob', 'birthdate', 'birthday', 'birth'] },
      { key: 'class', label: 'Class', req: true, type: 'class', aliases: ['class', 'classname', 'classroom', 'grade', 'section'] },
      { key: 'stream', label: 'Stream', req: false, type: 'stream', aliases: ['stream', 'div', 'division'] },
      { key: 'academic_year', label: 'Academic Year', req: false, type: 'year', aliases: ['academicyear', 'year', 'acyear', 'schoolyear'] }
    ],
    exampleRows: [
      ['541023250123', 'GIFT WILSON', 'AGIRANEZA', '', 'MALE', '2015-04-12', 'P4', 'A', '2026-2027'],
      ['541023250124', 'ANITHA', 'AMIZERO', '', 'FEMALE', '2015-09-03', 'P4', 'A', '2026-2027']
    ],
    instructions: [
      'Fill one row per student. Keep the exact column names.',
      'Student Code may be 11 or 12 digits and must be formatted as TEXT.',
      'Formatting the code as text is critical: it stops Excel from turning long numeric codes into scientific notation.',
      'Codes such as 12345, 5410232501 or ABC54102325012 are rejected.',
      'Use either "Student Name" alone OR "First Name" + "Last Name".',
      'Gender: MALE or FEMALE (M / F also accepted).',
      'Class: an existing RMS class such as P4A, or a grade like P4 plus a Stream like A.',
      'Academic Year: e.g. 2026-2027. Leave blank to use the active year.',
      'Rows with errors are NEVER imported. Use Download Error Report to fix and re-upload.'
    ],
    load: async function (ctx) {
      const [years, classes, learners] = await Promise.all([
        DB.get('academic_years'),
        DB.get('classes'),
        DB.query('learners', 'learner_code', {}, null, null)
      ]);
      ctx.years = years;
      ctx.classes = classes;
      ctx.classesByNorm = {};
      classes.forEach(c => { ctx.classesByNorm[normKey(c.name)] = c.id; });
      ctx.learnersByCode = {};
      (learners || []).forEach(l => { ctx.learnersByCode[lower(l.learner_code)] = true; });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const code = v.student_code.trim();
      if (!code) {
        rec.errors.push({ field: 'student_code', message: 'Missing Student Code.', fix: 'Add the student code.' });
      } else if (!isStudentCode(code)) {
        rec.errors.push({ field: 'student_code', message: 'Student Code must contain 11 or 12 digits.', fix: 'Check the code. 12345, 5410232501 or ABC54102325012 are invalid.' });
      }
      const combined = (v.first_name + ' ' + v.last_name).trim();
      const fullName = combined || v.student_name.trim();
      if (!fullName) rec.errors.push({ field: 'student_name', message: 'Missing student name.', fix: 'Provide "Student Name" or "First Name" + "Last Name".' });
      const gender = normalizeGender(v.gender);
      if (!v.gender.trim()) rec.errors.push({ field: 'gender', message: 'Missing gender.', fix: 'Use MALE or FEMALE.' });
      else if (!gender) rec.errors.push({ field: 'gender', message: 'Invalid gender.', fix: 'Use MALE, FEMALE, M or F.' });
      let dob = null;
      if (v.date_of_birth.trim()) {
        dob = parseDateStr(v.date_of_birth);
        if (!dob) rec.errors.push({ field: 'date_of_birth', message: 'Invalid Date of Birth.', fix: 'Use YYYY-MM-DD or DD/MM/YYYY.' });
      }
      const cls = resolveClass(v.class, v.stream, ctx);
      if (!v.class.trim()) rec.errors.push({ field: 'class', message: 'Missing class.', fix: 'Add the student\u2019s class, e.g. P4A.' });
      else if (!cls.id) rec.errors.push({ field: 'class', message: 'Class ' + v.class + ' does not exist in RMS.', fix: 'Create the class in Academic Setup or correct the class name.' });
      const year = resolveYear(v.academic_year, ctx, true);
      if (!v.academic_year.trim() && !year && (ctx.years || []).length) {
        rec.errors.push({ field: 'academic_year', message: 'No active academic year to default to.', fix: 'Set a current year first, then re-import.' });
      }
      rec.dupKey = code.toLowerCase();
      let status = rec.errors.length ? 'error' : 'ready';
      if (ctx.learnersByCode[rec.dupKey]) {
        status = 'exists';
        rec.errors = [{ field: 'student_code', message: 'Student Code already registered.', fix: 'No action needed, or choose "Update existing records" at import time.' }];
      }
      rec.status = status;
      if (status === 'ready') {
        rec.dbRow = { learner_code: code, full_name: fullName.toUpperCase(), gender: gender, class_id: cls.id, academic_year_id: year ? year.id : null, date_of_birth: dob, status: 'active' };
      }
    }
  },

  teachers: {
    title: 'Import Teachers',
    noun: 'teachers',
    table: 'teachers',
    allowUpdate: true,
    roles: ['dos'],
    view: 'admin/teachers',
    filename: 'Teacher_Import_Template',
    columns: [
      { key: 'teacher_code', label: 'Teacher Code', req: true, type: 'code11', aliases: ['teachercode', 'code', 'staffcode', 'staffnumber'] },
      { key: 'first_name', label: 'First Name', req: false, type: 'text', aliases: ['firstname', 'first', 'givenname'] },
      { key: 'last_name', label: 'Last Name', req: false, type: 'text', aliases: ['lastname', 'last', 'surname'] },
      { key: 'full_name', label: 'Full Name', req: false, type: 'text', aliases: ['fullname', 'name', 'names', 'teachername'] },
      { key: 'gender', label: 'Gender', req: false, type: 'gender', aliases: ['gender', 'sex'] },
      { key: 'email', label: 'Email', req: true, type: 'email', aliases: ['email', 'e mail', 'mail', 'emailaddress'] },
      { key: 'phone', label: 'Phone Number', req: false, type: 'phone', aliases: ['phone', 'phonenumber', 'mobile', 'tel', 'telephone'] },
      { key: 'status', label: 'Status', req: false, type: 'status', aliases: ['status'] }
    ],
    exampleRows: [
      ['54102325012', 'JOHN', 'KALISA', '', 'MALE', 'john.kalisa@rukara.edu', '+250788123456', 'active'],
      ['54102325013', 'ALINE', 'UMUTONI', '', 'FEMALE', 'aline.umutoni@rukara.edu', '+250788222333', 'active']
    ],
    instructions: [
      'Teacher Code MUST contain exactly 11 digits and must be formatted as TEXT.',
      'Codes such as 12345, 5410232501 or ABC54102325012 are rejected.',
      'Use either "Full Name" alone OR "First Name" + "Last Name".',
      'Email is required. The email must already have an RMS login account (created via the Teachers page or Supabase Auth).',
      'Teachers imported without an existing login are saved but cannot sign in until that login account exists.',
      'Phone: optional, e.g. +250788123456. Gender: MALE / FEMALE (M / F accepted). Status: active or inactive.',
      'Duplicate codes, duplicate emails and duplicate phone numbers are all flagged.'
    ],
    load: async function (ctx) {
      const [teachers, users] = await Promise.all([DB.get('teachers'), DB.get('users')]);
      ctx.teachers = teachers;
      ctx.teachersByCode = {};
      ctx.teacherEmails = new Set();
      ctx.teacherPhones = new Set();
      teachers.forEach(t => {
        ctx.teachersByCode[t.teacher_code] = t;
        if (t.email) ctx.teacherEmails.add(lower(t.email));
        if (t.phone) ctx.teacherPhones.add(lower(t.phone.replace(/[\s\-()]/g, '')));
      });
      ctx.usersByEmail = {};
      users.forEach(u => { ctx.usersByEmail[lower(u.email)] = u; });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const code = v.teacher_code.trim();
      if (!code) rec.errors.push({ field: 'teacher_code', message: 'Missing Teacher Code.', fix: 'Add the 11-digit teacher code.' });
      else if (!isCode11(code)) rec.errors.push({ field: 'teacher_code', message: 'Teacher Code must contain exactly 11 digits.', fix: 'Check the code. 12345, 5410232501 and ABC54102325012 are invalid.' });
      const fullName = (v.first_name + ' ' + v.last_name).trim() || v.full_name.trim();
      if (!fullName) rec.errors.push({ field: 'full_name', message: 'Missing teacher name.', fix: 'Provide "Full Name" or "First Name" + "Last Name".' });
      let gender = null;
      if (v.gender.trim()) {
        gender = normalizeGender(v.gender);
        if (!gender) rec.errors.push({ field: 'gender', message: 'Invalid gender.', fix: 'Use MALE, FEMALE, M or F.' });
      } else if (!v.gender.trim()) {
        rec.errors.push({ field: 'gender', message: 'Missing gender.', fix: 'Use MALE or FEMALE, or leave the column for all rows.' });
      }
      const email = lower(v.email.trim());
      if (!email) rec.errors.push({ field: 'email', message: 'Missing email.', fix: 'Add the teacher\u2019s email.' });
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) rec.errors.push({ field: 'email', message: 'Invalid email address.', fix: 'Check the format, e.g. teacher@school.edu.' });
      else if (ctx.teacherEmails.has(email) && !(ctx.teachersByCode[code] && lower(ctx.teachersByCode[code].email) === email)) {
        rec.errors.push({ field: 'email', message: 'Email already used by another teacher.', fix: 'Use a different email address.' });
      }
      const phone = v.phone.trim();
      const phoneKey = lower(phone.replace(/[\s\-()]/g, ''));
      if (phone && !/^\+?[0-9][0-9 ]{6,16}$/.test(phone.replace(/[\s\-()]/g, ''))) {
        rec.errors.push({ field: 'phone', message: 'Invalid phone number.', fix: 'Use digits with an optional + prefix, e.g. +250788123456.' });
      } else if (phone && ctx.teacherPhones.has(phoneKey) && !(ctx.teachersByCode[code] && lower((ctx.teachersByCode[code].phone || '').replace(/[\s\-()]/g, '')) === phoneKey)) {
        rec.errors.push({ field: 'phone', message: 'Phone number already used by another teacher.', fix: 'Use a different phone number.' });
      }
      let status = lower(v.status.trim()) || 'active';
      if (status !== 'active' && status !== 'inactive') {
        status = 'active';
        if (v.status.trim()) rec.errors.push({ field: 'status', message: 'Invalid status.', fix: 'Use active or inactive.' });
      }
      const existingByCode = ctx.teachersByCode[code];
      let statusLabel = rec.errors.length ? 'error' : 'ready';
      const linkedUser = email ? ctx.usersByEmail[email] : null;
      if (!rec.errors.length && email && !linkedUser) {
        rec.warnings.push('No RMS login account linked to this email. The teacher is saved but cannot sign in until that account exists.');
      }
      if (existingByCode) {
        statusLabel = 'exists';
        rec.existingId = existingByCode.id;
        rec.errors = [{ field: 'teacher_code', message: 'Teacher Code already exists.', fix: 'No action needed, or choose "Update existing records" at import time.' }];
      }
      rec.status = statusLabel;
      rec.dupKey = code.toLowerCase();
      const base = { full_name: fullName, email: email || null, phone: phone || null, status: status, gender: gender };
      if (linkedUser) base.user_id = linkedUser.id;
      if (statusLabel === 'exists') rec.dbRow = base;
      else rec.dbRow = Object.assign({ teacher_code: code }, base);
    }
  },

  classes: {
    title: 'Import Classes',
    noun: 'classes',
    table: 'classes',
    allowUpdate: true,
    roles: ['dos'],
    view: 'admin/academic',
    filename: 'Class_Import_Template',
    columns: [
      { key: 'class_name', label: 'Class Name', req: false, type: 'text', aliases: ['classname', 'name', 'class', 'classroom', 'grade'] },
      { key: 'level', label: 'Level / Grade', req: false, type: 'text', aliases: ['level', 'grade', 'classlevel'] },
      { key: 'stream', label: 'Stream', req: false, type: 'stream', aliases: ['stream', 'div', 'division'] },
      { key: 'academic_year', label: 'Academic Year', req: false, type: 'year', aliases: ['academicyear', 'year', 'acyear', 'schoolyear'] }
    ],
    exampleRows: [
      ['P5A', 'P5', 'A', '2026-2027'],
      ['P5B', 'P5', 'B', '2026-2027'],
      ['S3A', 'S3', '', '2026-2027']
    ],
    instructions: [
      'Provide either "Class Name" (e.g. P5A) or a "Level / Grade" plus a "Stream" (e.g. P5 + A).',
      'Class Name is built from Level + Stream when no Class Name is given.',
      'Class names must be unique. Duplicate names both within the file and in RMS are flagged.',
      'Academic Year: e.g. 2026-2027. Leave blank to use the active year.',
      'Rows with errors are NEVER imported. Use Download Error Report to fix and re-upload.'
    ],
    load: async function (ctx) {
      const [years, classes] = await Promise.all([DB.get('academic_years'), DB.get('classes', ['id, name, level, stream'])]);
      ctx.years = years;
      ctx.classNames = {};
      (classes || []).forEach(c => { ctx.classNames[normKey(c.name)] = c.id; });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const named = v.class_name.trim();
      const level = v.level.trim();
      const stream = v.stream.trim();
      const name = named || ((level + '' + stream).trim());
      if (!name) rec.errors.push({ field: 'class_name', message: 'Missing class.', fix: 'Provide a Class Name or a Level + Stream.' });
      let streamVal = null;
      if (stream) streamVal = stream.toUpperCase();
      const year = resolveYear(v.academic_year, ctx, true);
      if (!v.academic_year.trim() && !year && (ctx.years || []).length) {
        rec.errors.push({ field: 'academic_year', message: 'No active academic year to default to.', fix: 'Set a current year first, then re-import.' });
      }
      let status = rec.errors.length ? 'error' : 'ready';
      const dupKey = normKey(name);
      if (ctx.classNames[dupKey]) {
        status = 'exists';
        rec.existingId = ctx.classNames[dupKey];
        rec.cssKey = dupKey;
        rec.errors = [{ field: 'class_name', message: 'Class "' + name + '" already exists.', fix: 'No action needed, or choose "Update existing records" at import time.' }];
      }
      rec.status = status;
      rec.dupKey = dupKey;
      if (status === 'ready') {
        rec.dbRow = { name: name, level: level || null, stream: streamVal, academic_year_id: year ? year.id : null };
      } else if (status === 'exists') {
        rec.dbRow = { name: name, level: level || null, stream: streamVal, academic_year_id: year ? year.id : null };
      }
    }
  },

  subjects: {
    title: 'Import Subjects',
    noun: 'subjects',
    table: 'subjects',
    allowUpdate: true,
    roles: ['dos'],
    view: 'admin/academic',
    filename: 'Subject_Import_Template',
    columns: [
      { key: 'name', label: 'Subject Name', req: true, type: 'text', aliases: ['name', 'subject', 'subjectname', 'subjectname'] },
      { key: 'code', label: 'Subject Code', req: true, type: 'text', aliases: ['code', 'subjectcode', 'subject code'] },
      { key: 'status', label: 'Status', req: false, type: 'status', aliases: ['status'] }
    ],
    exampleRows: [
      ['Mathematics', 'MATH', 'active'],
      ['English', 'ENG', 'active'],
      ['Entrepreneurship', 'ENT', 'active']
    ],
    instructions: [
      'Subject Name and Subject Code are required.',
      'The Subject Code must contain only letters, numbers, /, - and _ (no spaces, no 11-digit lookalikes).',
      'Codes are unique. A duplicate code is flagged whether it comes from the file or already exists in RMS.',
      'Status: active or inactive (default active).',
      'Rows with errors are NEVER imported. Use Download Error Report to fix and re-upload.'
    ],
    load: async function (ctx) {
      const subjects = await DB.query('subjects', 'id, code, name, status');
      ctx.subjects = subjects || [];
      ctx.subjectsByName = {};
      ctx.subjectsByCode = {};
      (subjects || []).forEach(s => {
        ctx.subjectsByName[normKey(s.name)] = s;
        ctx.subjectsByCode[lower(s.code)] = s;
      });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const name = v.name.trim();
      const code = v.code.trim().toUpperCase();
      if (!name) rec.errors.push({ field: 'name', message: 'Missing subject name.', fix: 'Add the subject name.' });
      if (!code) rec.errors.push({ field: 'code', message: 'Missing subject code.', fix: 'Add the subject code, e.g. MATH.' });
      else if (!/^[A-Z0-9\/\-_]+$/.test(code)) rec.errors.push({ field: 'code', message: 'Invalid subject code.', fix: 'Use only letters, numbers, /, - and _ (no spaces).' });
      let status = lower(v.status.trim()) || 'active';
      if (status !== 'active' && status !== 'inactive') {
        status = 'active';
        if (v.status.trim()) rec.errors.push({ field: 'status', message: 'Invalid status.', fix: 'Use active or inactive.' });
      }
      let statusLabel = rec.errors.length ? 'error' : 'ready';
      let existing = null;
      if (code && ctx.subjectsByCode[lower(code)]) existing = ctx.subjectsByCode[lower(code)];
      if (!existing && name && ctx.subjectsByName[normKey(name)]) existing = ctx.subjectsByName[normKey(name)];
      if (existing && !rec.errors.length) {
        statusLabel = 'exists';
        rec.existingId = existing.id;
        rec.errors = [{ field: 'code', message: 'Subject "' + (name || code) + '" already exists.', fix: 'No action needed, or choose "Update existing records" at import time.' }];
      }
      rec.status = statusLabel;
      rec.dupKey = code ? lower(code) : normKey(name);
      rec.dbRow = { name: name || null, code: code || null, status: status };
    }
  },

  assignments: {
    title: 'Import Teacher Assignments',
    noun: 'assignments',
    table: 'teacher_assignments',
    allowUpdate: false,
    roles: ['dos'],
    view: 'admin/assignments',
    filename: 'Teacher_Assignment_Import_Template',
    columns: [
      { key: 'teacher_code', label: 'Teacher Code', req: true, type: 'code11', aliases: ['teachercode', 'code', 'staffcode'] },
      { key: 'class', label: 'Class', req: true, type: 'class', aliases: ['class', 'classname', 'classroom', 'grade'] },
      { key: 'subject', label: 'Subject', req: true, type: 'subject', aliases: ['subject', 'subjectcode', 'subject name', 'subjectname'] },
      { key: 'academic_year', label: 'Academic Year', req: false, type: 'year', aliases: ['academicyear', 'year', 'acyear'] },
      { key: 'term', label: 'Term', req: false, type: 'term', aliases: ['term', 'termname'] }
    ],
    exampleRows: [
      ['54102325012', 'P5A', 'MATH', '2026-2027', 'Term 1'],
      ['54102325012', 'P5A', 'ENG', '2026-2027', 'Term 1']
    ],
    instructions: [
      'Teacher Code: exactly 11 digits (formatted as TEXT). Must match a teacher already in RMS.',
      'Class: an existing RMS class, e.g. P5A. Subject: an existing RMS subject code, e.g. MATH.',
      'Academic Year: e.g. 2026-2027. Leave blank to use the active year.',
      'Term: e.g. Term 1. Leave blank if terms are not used.',
      'A row is a duplicate (skipped) when the same teacher, class, subject and year already exist.',
      'Rows with errors are NEVER imported. Use Download Error Report to fix and re-upload.'
    ],
    load: async function (ctx) {
      await fetchRelated(ctx, ['teachers', 'classes', 'subjects', 'academic_years', 'terms', 'teacher_assignments']);
      ctx.teachersByCode = {}; ctx.teachersByEmail = {};
      (ctx.teachers || []).forEach(t => {
        ctx.teachersByCode[t.teacher_code] = t;
        if (t.email) ctx.teachersByEmail[lower(t.email)] = t;
      });
      ctx.classesById = {};
      ctx.classesByNorm = {};
      (ctx.classes || []).forEach(c => {
        ctx.classesById[c.id] = c;
        ctx.classesByNorm[normKey(c.name)] = c.id;
      });
      ctx.subjectsByCode = {}; ctx.subjectsByName = {};
      (ctx.subjects || []).forEach(s => {
        ctx.subjectsByCode[lower(s.code)] = s;
        ctx.subjectsByName[normKey(s.name)] = s;
      });
      ctx.termsByKey = {};
      (ctx.terms || []).forEach(t => { ctx.termsByKey[normKey(t.name)] = t; });
      ctx.assignKeys = {};
      (ctx.teacher_assignments || []).forEach(a => {
        ctx.assignKeys[assignmentKey(a, ctx)] = true;
      });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const code = v.teacher_code.trim();
      let teacher = null;
      if (!code) rec.errors.push({ field: 'teacher_code', message: 'Missing Teacher Code.', fix: 'Add the 11-digit teacher code.' });
      else if (!isCode11(code)) rec.errors.push({ field: 'teacher_code', message: 'Teacher Code must contain exactly 11 digits.', fix: 'Check the code. 12345, 5410232501 and ABC54102325012 are invalid.' });
      else {
        teacher = ctx.teachersByCode[code] || (ctx.teachersByEmail[lower(code)] || null);
        if (!teacher) rec.errors.push({ field: 'teacher_code', message: 'No teacher matches code ' + code + '.', fix: 'Import the teacher first, or fix the code.' });
      }
      const cls = resolveClass(v.class, '', ctx);
      if (!v.class.trim()) rec.errors.push({ field: 'class', message: 'Missing class.', fix: 'Add the class, e.g. P5A.' });
      else if (!cls.id) rec.errors.push({ field: 'class', message: 'Class ' + v.class + ' does not exist.', fix: 'Create the class first, or fix the name.' });
      const subjRaw = v.subject.trim();
      let subject = null;
      if (!subjRaw) rec.errors.push({ field: 'subject', message: 'Missing subject.', fix: 'Add the subject code, e.g. MATH.' });
      else {
        subject = ctx.subjectsByCode[lower(subjRaw)] || ctx.subjectsByName[normKey(subjRaw)];
        if (!subject) rec.errors.push({ field: 'subject', message: 'Subject ' + subjRaw + ' does not exist.', fix: 'Import the subject first, or fix the code.' });
      }
      const year = resolveYear(v.academic_year, ctx, true);
      if (!v.academic_year.trim() && !year && (ctx.years || []).length) {
        rec.errors.push({ field: 'academic_year', message: 'No active academic year to default to.', fix: 'Set a current year first, then re-import.' });
      }
      let term = null;
      if (v.term.trim()) {
        term = ctx.termsByKey[normKey(v.term)];
        if (!term) rec.errors.push({ field: 'term', message: 'Term "' + v.term + '" not found.', fix: 'Create the term in Academic Setup, or leave blank.' });
      }
      let status = rec.errors.length ? 'error' : 'ready';
      const yearId = year ? year.id : null;
      if (status === 'ready' && teacher && cls.id && subject) {
        const full = assignmentKey({ teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: yearId }, ctx);
        if (ctx.assignKeys[full]) {
          status = 'exists';
          rec.dupKey = full;
          rec.errors = [{ field: 'teacher_code', message: 'Duplicate assignment (same teacher, class, subject, year).', fix: 'No action needed — it will be skipped.' }];
        } else {
          rec.dupKey = full;
        }
      }
      rec.status = status;
      if (status === 'ready') {
        rec.dbRow = { teacher_id: teacher.id, class_id: cls.id, subject_id: subject.id, academic_year_id: yearId, term_id: term ? term.id : null };
      }
    }
  },

  assessments: {
    title: 'Import Assessments',
    noun: 'assessments',
    table: 'assessments',
    allowUpdate: true,
    roles: ['dos'],
    view: 'admin/assessments',
    filename: 'Assessment_Import_Template',
    columns: [
      { key: 'assessment_name', label: 'Assessment Name', req: true, type: 'text', aliases: ['assessmentname', 'assessment', 'name', 'exam', 'test', 'assessmenttitle'] },
      { key: 'unit', label: 'Unit / Topic', req: true, type: 'text', aliases: ['unit', 'topic', 'unitname', 'unit topic'] },
      { key: 'class', label: 'Class', req: true, type: 'class', aliases: ['class', 'classname', 'classroom', 'grade'] },
      { key: 'subject', label: 'Subject', req: true, type: 'subject', aliases: ['subject', 'subjectcode', 'subject name', 'subjectname'] },
      { key: 'teacher_code', label: 'Teacher Code', req: true, type: 'code11', aliases: ['teachercode', 'code', 'staffcode'] },
      { key: 'maximum_mark', label: 'Maximum Mark', req: false, type: 'number', aliases: ['maximummark', 'maxmark', 'outof', 'total', 'max'] },
      { key: 'assessment_date', label: 'Assessment Date', req: true, type: 'date', aliases: ['assessmentdate', 'date', 'examdate', 'testdate'] },
      { key: 'academic_year', label: 'Academic Year', req: false, type: 'year', aliases: ['academicyear', 'year', 'acyear'] },
      { key: 'term', label: 'Term', req: false, type: 'term', aliases: ['term', 'termname'] },
      { key: 'status', label: 'Status', req: false, type: 'status', aliases: ['status'] }
    ],
    exampleRows: [
      ['Term 1 Mathematics Test', 'Fractions', 'P5A', 'MATH', '54102325012', 30, '2026-05-12', '2026-2027', 'Term 1', 'draft'],
      ['English Composition', 'Creative Writing', 'P5B', 'ENG', '54102325012', 20, '2026-05-14', '2026-2027', 'Term 1', 'draft']
    ],
    instructions: [
      'Assessment Name, Unit / Topic, Class, Subject, Teacher Code and Assessment Date are required.',
      'Teacher Code must be exactly 11 digits and already be an RMS teacher.',
      'Maximum Mark defaults to 30. Assessment Date: YYYY-MM-DD or DD/MM/YYYY.',
      'Status: draft, submitted or locked (default draft).',
      'An assessment is treated as a duplicate when the same name, class, subject and date already exist.',
      'Rows with errors are NEVER imported. Use Download Error Report to fix and re-upload.'
    ],
    load: async function (ctx) {
      await fetchRelated(ctx, ['teachers', 'classes', 'subjects', 'academic_years', 'terms', 'assessments']);
      ctx.teachersByCode = {}; ctx.teachersByEmail = {};
      (ctx.teachers || []).forEach(t => {
        ctx.teachersByCode[t.teacher_code] = t;
        if (t.email) ctx.teachersByEmail[lower(t.email)] = t;
      });
      ctx.classesByNorm = {};
      (ctx.classes || []).forEach(c => { ctx.classesByNorm[normKey(c.name)] = c.id; });
      ctx.subjectsByCode = {}; ctx.subjectsByName = {};
      (ctx.subjects || []).forEach(s => {
        ctx.subjectsByCode[lower(s.code)] = s;
        ctx.subjectsByName[normKey(s.name)] = s;
      });
      ctx.termsByKey = {};
      (ctx.terms || []).forEach(t => { ctx.termsByKey[normKey(t.name)] = t; });
      ctx.assessmentKey = {};
      (ctx.assessments || []).forEach(a => {
        ctx.assessmentKey[assessmentKey(a, ctx)] = true;
      });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const name = v.assessment_name.trim();
      const unit = v.unit.trim();
      if (!name) rec.errors.push({ field: 'assessment_name', message: 'Missing assessment name.', fix: 'Add the assessment name.' });
      if (!unit) rec.errors.push({ field: 'unit', message: 'Missing unit / topic.', fix: 'Add the unit or topic name.' });
      const cls = resolveClass(v.class, '', ctx);
      if (!v.class.trim()) rec.errors.push({ field: 'class', message: 'Missing class.', fix: 'Add the class, e.g. P5A.' });
      else if (!cls.id) rec.errors.push({ field: 'class', message: 'Class ' + v.class + ' does not exist.', fix: 'Create the class first, or fix the name.' });
      const subjRaw = v.subject.trim();
      let subject = null;
      if (!subjRaw) rec.errors.push({ field: 'subject', message: 'Missing subject.', fix: 'Add the subject code, e.g. MATH.' });
      else {
        subject = ctx.subjectsByCode[lower(subjRaw)] || ctx.subjectsByName[normKey(subjRaw)];
        if (!subject) rec.errors.push({ field: 'subject', message: 'Subject ' + subjRaw + ' does not exist.', fix: 'Import the subject first, or fix the code.' });
      }
      const code = v.teacher_code.trim();
      let teacher = null;
      if (!code) rec.errors.push({ field: 'teacher_code', message: 'Missing Teacher Code.', fix: 'Add the 11-digit teacher code.' });
      else if (!isCode11(code)) rec.errors.push({ field: 'teacher_code', message: 'Teacher Code must contain exactly 11 digits.', fix: 'Check the code.' });
      else {
        teacher = ctx.teachersByCode[code] || ctx.teachersByEmail[lower(code)];
        if (!teacher) rec.errors.push({ field: 'teacher_code', message: 'No teacher matches code ' + code + '.', fix: 'Import the teacher first, or fix the code.' });
      }
      let maxMark = 30;
      if (v.maximum_mark.trim()) {
        const m = parseDecimal(v.maximum_mark);
        if (m == null || m <= 0 || !/^\d+(\.\d{1,2})?$/.test(v.maximum_mark.trim().replace(',', '.'))) {
          rec.errors.push({ field: 'maximum_mark', message: 'Invalid Maximum Mark.', fix: 'Use a positive number such as 30 or 50.5.' });
        } else maxMark = m;
        if (!rec.errors.length) maxMark = m;
      }
      let date = null;
      if (!v.assessment_date.trim()) rec.errors.push({ field: 'assessment_date', message: 'Missing assessment date.', fix: 'Add the assessment date.' });
      else {
        date = parseDateStr(v.assessment_date);
        if (!date) rec.errors.push({ field: 'assessment_date', message: 'Invalid date.', fix: 'Use YYYY-MM-DD or DD/MM/YYYY.' });
      }
      const year = resolveYear(v.academic_year, ctx, true);
      if (!v.academic_year.trim() && !year && (ctx.years || []).length) {
        rec.errors.push({ field: 'academic_year', message: 'No active academic year to default to.', fix: 'Set a current year first, then re-import.' });
      }
      let term = null;
      if (v.term.trim()) {
        term = ctx.termsByKey[normKey(v.term)];
        if (!term) rec.errors.push({ field: 'term', message: 'Term "' + v.term + '" not found.', fix: 'Create the term first, or leave blank.' });
      }
      let status = lower(v.status.trim()) || 'draft';
      if (['draft', 'submitted', 'locked'].indexOf(status) === -1) {
        status = 'draft';
        if (v.status.trim()) rec.errors.push({ field: 'status', message: 'Invalid status.', fix: 'Use draft, submitted or locked.' });
      }
      let statusLabel = rec.errors.length ? 'error' : 'ready';
      const dateStr = date || '';
      if (statusLabel === 'ready' && cls.id && subject) {
        const full = assessmentKey({ name: name, class_id: cls.id, subject_id: subject.id, assessment_date: dateStr }, ctx);
        if (ctx.assessmentKey[full]) {
          statusLabel = 'exists';
          rec.dupKey = full;
          rec.errors = [{ field: 'assessment_name', message: 'Duplicate assessment (same name, class, subject, date).', fix: 'No action needed, or choose "Update existing records" at import time.' }];
        } else {
          rec.dupKey = full;
        }
      }
      rec.status = statusLabel;
      if (statusLabel === 'ready' || statusLabel === 'exists') {
        rec.dbRow = { name: name, unit: unit, class_id: cls.id, subject_id: subject.id, teacher_id: teacher ? teacher.id : null, maximum_mark: maxMark, assessment_date: dateStr, academic_year_id: year ? year.id : null, term_id: term ? term.id : null, status: status };
      }
    }
  },

  marks: {
    title: 'Import Marks',
    noun: 'marks',
    table: 'marks',
    allowUpdate: true,
    roles: ['dos', 'teacher'],
    view: 'admin/marks',
    filename: 'Marks_Import_Template',
    columns: [
      { key: 'assessment_name', label: 'Assessment Name', req: true, type: 'text', aliases: ['assessmentname', 'assessment', 'exam', 'test', 'name', 'assessmenttitle'] },
      { key: 'assessment_date', label: 'Assessment Date', req: false, type: 'date', aliases: ['assessmentdate', 'date', 'examdate'] },
      { key: 'student_code', label: 'Student Code', req: true, type: 'code11', aliases: ['studentcode', 'studentnumber', 'studentno', 'learnercode', 'sk', 'sn', 'code'] },
      { key: 'mark', label: 'Mark', req: true, type: 'number', aliases: ['mark', 'marks', 'score', 'obtained', 'obtainedmark', 'grade'] },
      { key: 'status', label: 'Status', req: false, type: 'status', aliases: ['status'] }
    ],
    exampleRows: [
      ['Term 1 Mathematics Test', '2026-05-12', '541023250123', 24, 'draft'],
      ['Term 1 Mathematics Test', '2026-05-12', '541023250124', 18.5, 'draft']
    ],
    instructions: [
      'Assessment Name, Student Code and Mark are required. One row per student mark.',
      'Assessment Date is optional, but ADD it whenever more than one assessment shares the same name.',
      'Student Code must be 11 or 12 digits and belong to an RMS student.',
      'Mark: a number from 0 up to the assessment maximum (decimals allowed).',
      'A student is treated as an existing mark when that assessment + student already has a mark.',
      'Rows with errors are NEVER imported. Use Download Error Report to fix and re-upload.'
    ],
    load: async function (ctx) {
      await fetchRelated(ctx, ['assessments', 'learners', 'marks', 'classes', 'grading_scales']);
      ctx.assessmentsByNorm = {};
      (ctx.assessments || []).forEach(a => {
        const k = normKey(a.name);
        if (!ctx.assessmentsByNorm[k]) ctx.assessmentsByNorm[k] = [];
        ctx.assessmentsByNorm[k].push(a);
      });
      ctx.learnersByCode = {};
      (ctx.learners || []).forEach(l => { ctx.learnersByCode[lower(l.learner_code)] = l; });
      ctx.marksKey = {};
      (ctx.marks || []).forEach(m => {
        ctx.marksKey[m.assessment_id + '|' + m.learner_id] = m;
      });
      ctx.classesById = {};
      (ctx.classes || []).forEach(c => { ctx.classesById[c.id] = c; });
    },
    validate: function (rec, ctx) {
      const v = rec.values;
      const name = v.assessment_name.trim();
      if (!name) rec.errors.push({ field: 'assessment_name', message: 'Missing assessment name.', fix: 'Add the assessment name.' });
      const dateStr = v.assessment_date.trim() ? dateKey(v.assessment_date) : '';
      if (v.assessment_date.trim() && !dateStr) rec.errors.push({ field: 'assessment_date', message: 'Invalid date.', fix: 'Use YYYY-MM-DD or DD/MM/YYYY.' });
      let assessment = null;
      if (name) {
        const matches = (ctx.assessmentsByNorm[normKey(name)] || []).slice();
        if (dateStr && matches.length > 1) {
          const filtered = matches.filter(a => dateKey(a.assessment_date) === dateStr);
          if (filtered.length) assessment = filtered[0];
          else rec.errors.push({ field: 'assessment_date', message: 'No assessment named "' + name + '" exists on ' + dateStr + '.', fix: 'Check the name and date.' });
        } else if (matches.length === 1) {
          assessment = matches[0];
        } else if (matches.length === 0) {
          rec.errors.push({ field: 'assessment_name', message: 'No assessment named "' + name + '" found.', fix: 'Import the assessment first, or fix the name.' });
        } else {
          rec.errors.push({ field: 'assessment_name', message: 'Multiple assessments named "' + name + '".', fix: 'Add the Assessment Date column to pick the correct one.' });
        }
      }
      const code = v.student_code.trim();
      let learner = null;
      if (!code) rec.errors.push({ field: 'student_code', message: 'Missing Student Code.', fix: 'Add the student code.' });
      else if (!isStudentCode(code)) rec.errors.push({ field: 'student_code', message: 'Student Code must contain 11 or 12 digits.', fix: 'Check the code.' });
      else {
        learner = ctx.learnersByCode[lower(code)];
        if (!learner) rec.errors.push({ field: 'student_code', message: 'No student matches code ' + code + '.', fix: 'Import the student first, or fix the code.' });
      }
      let mark = null;
      if (!v.mark.trim()) rec.errors.push({ field: 'mark', message: 'Missing mark.', fix: 'Add the mark obtained.' });
      else {
        mark = parseDecimal(v.mark);
        if (mark == null) rec.errors.push({ field: 'mark', message: 'Invalid mark.', fix: 'Use a number such as 24 or 18.5.' });
        else if (assessment && mark > Number(assessment.maximum_mark)) {
          rec.errors.push({ field: 'mark', message: 'Mark exceeds the assessment maximum (' + assessment.maximum_mark + ').', fix: 'Check that the mark is not above the maximum.' });
        }
      }
      let status = lower(v.status.trim()) || 'draft';
      if (['draft', 'submitted', 'locked'].indexOf(status) === -1) {
        status = 'draft';
        if (v.status.trim()) rec.errors.push({ field: 'status', message: 'Invalid status.', fix: 'Use draft, submitted or locked.' });
      }
      const existsKey = assessment && learner ? assessment.id + '|' + learner.id : null;
      let statusLabel = rec.errors.length ? 'error' : 'ready';
      const existing = existsKey ? ctx.marksKey[existsKey] : null;
      if (existing && statusLabel === 'ready') {
        statusLabel = 'exists';
        rec.existingId = existing.id;
        rec.dupKey = existsKey;
        rec.errors = [{ field: 'mark', message: 'Mark already exists for this student + assessment.', fix: 'No action needed, or choose "Update existing records" at import time.' }];
      } else if (existsKey) {
        rec.dupKey = existsKey;
      }
      rec.status = statusLabel;
      if (statusLabel === 'ready' || statusLabel === 'exists') {
        const max = assessment ? Number(assessment.maximum_mark) : 0;
        let percentage = null, grade = null, remark = null;
        if (assessment && max > 0) {
          percentage = Math.round((mark / max) * 10000) / 100;
          const g = resolveGrade(percentage, ctx);
          grade = g.grade; remark = g.remark;
        }
        rec.dbRow = { assessment_id: assessment.id, learner_id: learner.id, mark: mark, percentage: percentage, grade: grade, remark: remark, status: status };
      }
    }
  }
  };

  const API = {};
  API.DEFS = DEFS;

  API.close = () => Modal.close();

  API.downloadTemplate = () => {
    if (STATE.type) downloadTemplate(STATE.type);
  };

  API.open = (type, opts) => {
    const def = DEFS[type];
    if (!def) return;
    const me = Auth.currentUser;
    if (!me || !def.roles.includes(me.role)) {
      Utils.toast('You are not allowed to import ' + def.noun, 'error');
      return;
    }
    STATE.type = type;
    STATE.fileName = '';
    STATE.fileSize = 0;
    STATE.headers = [];
    STATE.dataRows = [];
    STATE.column = {};
    STATE.records = [];
    STATE.ctx = {};
    STATE.filter = 'all';
    STATE.counts = { total: 0, valid: 0, errors: 0, duplicates: 0, exists: 0, warnings: 0 };
    STATE.selection = { assessmentId: (opts && opts.assessmentId) || null };
    if (type === 'marks' && !STATE.selection.assessmentId) { API.showMarksPicker(); return; }
    API.renderStep1(def);
  };

  API.showMarksPicker = async () => {
    const def = DEFS.marks;
    const me = Auth.currentUser;
    Modal.show(def.title, '<div id="imp-picker"></div>',
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" onclick="ImportSystem.pickAssessment()"><i data-lucide="arrow-right"></i> Continue</button>`, true);
    const div = document.getElementById('imp-picker');
    div.innerHTML = '<div class="alert alert-info"><i data-lucide="loader"></i> Loading assessments...</div>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    let assessments = [];
    try {
      if (me.role === 'teacher') assessments = await DB.query('assessments', '*', { teacher_id: Auth.getTeacherId() }, { column: 'assessment_date', asc: false });
      else assessments = await DB.query('assessments', '*', {}, { column: 'assessment_date', asc: false });
    } catch (e) {
      div.innerHTML = `<div class="alert alert-error"><i data-lucide="alert-circle"></i> ${es(e.message)}</div>`;
      return;
    }
    const [classes, subjects] = await Promise.all([DB.get('classes'), DB.get('subjects')]);
    div.innerHTML = `
      <p>Select the assessment you want to enter marks for. Every imported mark will be stored against this assessment.</p>
      <div class="form-group" style="margin-top:12px"><label>Assessment <span class="required">*</span></label>
      <select id="imp-assess" class="select-field">
        <option value="">-- Select assessment --</option>
        ${assessments.map(a => {
          const cls = classes.find(c => c.id === a.class_id);
          const sub = subjects.find(s => s.id === a.subject_id);
          return `<option value="${a.id}">${es(a.name)} ${a.unit ? ' · ' + es(a.unit) : ''} — ${es((cls && cls.name) || '?')} · ${es((sub && sub.name) || '?')} (max ${a.maximum_mark})</option>`;
        }).join('')}
      </select></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.pickAssessment = () => {
    const sel = document.getElementById('imp-assess');
    if (!sel || !sel.value) { Utils.toast('Choose an assessment first', 'error'); return; }
    STATE.selection.assessmentId = sel.value;
    API.renderStep1(DEFS.marks);
  };

  API.renderStep1 = def => {
    Modal.show(def.title, `
      ${stepHtml(1)}
      <div class="flex justify-between items-center" style="flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <p class="text-sm text-muted" style="margin:0">Upload a spreadsheet. Required columns: <strong>${def.columns.filter(c => c.req).map(c => c.label).join(', ')}</strong>.</p>
        <button class="btn btn-secondary" onclick="ImportSystem.downloadTemplate()"><i data-lucide="download"></i> Download Template</button>
      </div>
      <div class="dropzone" id="imp-dropzone">
        <div class="dz-icon"><i data-lucide="file-spreadsheet"></i></div>
        <h4>Drag &amp; drop your file here</h4>
        <p>or click to browse</p>
        <div class="dz-formats"><span>.xlsx</span><span>.xls</span><span>.csv</span></div>
      </div>
      <input type="file" id="imp-file" accept=".xlsx,.xls,.csv,.txt" style="display:none">
      <div id="imp-preview"></div>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>`, true);
    API.bindDropzone();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.bindDropzone = () => {
    const dz = document.getElementById('imp-dropzone');
    const input = document.getElementById('imp-file');
    if (!dz || !input) return;
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => API.handleFile(input.files[0]));
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag-over'); }));
    dz.addEventListener('drop', e => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) API.handleFile(files[0]);
    });
  };

  API.handleFile = async file => {
    const def = DEFS[STATE.type];
    const previewDiv = document.getElementById('imp-preview');
    if (!file || !def) return;
    if (!file.name.match(/\.(xlsx|xls|csv|txt)$/i)) {
      previewDiv.innerHTML = '<div class="alert alert-error"><i data-lucide="alert-circle"></i> Unsupported file type. Please upload an Excel (.xlsx, .xls) or CSV file.</div>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }
    STATE.fileName = file.name;
    STATE.fileSize = file.size;
    previewDiv.innerHTML = `
      <div class="file-card">
        <div class="file-icon"><i data-lucide="file-spreadsheet"></i></div>
        <div class="file-meta">
          <div class="file-name">${es(file.name)}</div>
          <div class="file-detail">${formatFileSize(file.size)}</div>
        </div>
        <button class="btn-remove" onclick="ImportSystem.resetFile()"><i data-lucide="x"></i> Remove</button>
      </div>
      <div class="alert alert-info"><i data-lucide="loader"></i> Parsing and validating file...</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    try {
      const parsed = await readFile(file);
      STATE.headers = parsed.headers;
      STATE.dataRows = parsed.rows;
      STATE.column = mapColumns(STATE.headers, def);
      if (notifyMissingColumns(def, previewDiv)) return;
      try {
        STATE.ctx = {};
        if (def.load) await def.load(STATE.ctx);
        validateAll(def);
      } catch (e) {
        previewDiv.innerHTML = `<div class="alert alert-error"><i data-lucide="alert-circle"></i> Could not validate data: ${es(e.message)}</div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }
      API.renderPreview();
    } catch (e) {
      previewDiv.innerHTML = `<div class="alert alert-error"><i data-lucide="alert-circle"></i> Could not read the file: ${es(e.message || 'Unknown error')}</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  };

  API.resetFile = () => {
    const dz = document.getElementById('imp-dropzone');
    if (dz) dz.style.display = '';
    const previewDiv = document.getElementById('imp-preview');
    if (previewDiv) previewDiv.innerHTML = '';
    const input = document.getElementById('imp-file');
    if (input) input.value = '';
    STATE.headers = [];
    STATE.dataRows = [];
    STATE.records = [];
    STATE.counts = { total: 0, valid: 0, errors: 0, duplicates: 0, exists: 0, warnings: 0 };
  };

  API.filterRecords = () => {
    const f = STATE.filter;
    if (f === 'all') return STATE.records;
    if (f === 'valid') return STATE.records.filter(r => r.status === 'ready');
    if (f === 'errors') return STATE.records.filter(r => r.status === 'error');
    if (f === 'duplicates') return STATE.records.filter(r => r.status === 'duplicate');
    if (f === 'exists') return STATE.records.filter(r => r.status === 'exists');
    return STATE.records;
  };

  API.setFilter = f => {
    STATE.filter = f;
    API.renderPreview();
  };

  API.renderPreview = () => {
    const def = DEFS[STATE.type];
    const previewDiv = document.getElementById('imp-preview');
    if (!def || !previewDiv) return;
    computeCounts();
    const c = STATE.counts;
    const dz = document.getElementById('imp-dropzone');
    if (dz) dz.style.display = 'none';

    const marksBanner = STATE.type === 'marks' && STATE.selection.assessmentId
      ? `<div class="alert alert-info" style="margin-bottom:10px"><i data-lucide="target"></i> Importing into assessment: <strong>${es(STATE.ctx.assessment ? (STATE.ctx.assessment.name + (STATE.ctx.assessment.unit ? ' · ' + STATE.ctx.assessment.unit : '')) : 'selected')}</strong> (max mark ${STATE.ctx.assessment ? STATE.ctx.assessment.maximum_mark : '-'})</div>`
      : '';

    const filtered = API.filterRecords();
    const rowsHtml = filtered.map(r => {
      const cells = def.columns.map((col, ci) => {
        if (ci >= 5) return null;
        const raw = r.values[col.key];
        return `<td class="${col.key.indexOf('code') !== -1 || col.key === 'mark' ? 'col-code' : col.key.indexOf('name') !== -1 ? 'col-name' : ''}">${es(raw || '-')}</td>`;
      }).filter(Boolean).join('');
      const notes = r.errors.slice(0, 3).map(e => `<span class="badge badge-danger" style="margin:1px;font-size:10px">${es(e.message)}</span>`).join('')
        || (r.warnings.slice(0, 2).map(w => `<span class="badge" style="margin:1px;font-size:10px;background:var(--amber-50);color:var(--amber-700)">${es(w)}</span>`).join(''))
        || '<span class="text-xs text-muted">—</span>';
      return `<tr class="${r.status === 'error' ? 'table-highlight' : ''}">
        <td class="text-muted text-center">${r.rowNumber}</td>${cells}<td>${badged(r)}</td><td class="text-sm">${notes}</td></tr>`;
    }).join('');

    const tabBtn = (key, label, count, extraCls, icon) => `
      <button class="import-filter-tab ${STATE.filter === key ? 'active' : ''} ${extraCls || ''}" onclick="ImportSystem.setFilter('${key}')">${icon ? `<i data-lucide="${icon}"></i>` : ''} ${label} <span class="imp-filter-count">${count}</span></button>`;

    const alerts = [];
    if (c.valid) alerts.push(`<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> ${c.valid} valid record${c.valid !== 1 ? 's' : ''} ready to import</div>`);
    if (c.exists) alerts.push(`<div class="alert alert-info" style="margin-bottom:6px"><i data-lucide="info"></i> ${c.exists} record${c.exists !== 1 ? 's' : ''} already exist in RMS</div>`);
    if (c.duplicates) alerts.push(`<div class="alert alert-warning" style="margin-bottom:6px"><i data-lucide="copy"></i> ${c.duplicates} duplicate record${c.duplicates !== 1 ? 's' : ''} inside the uploaded file</div>`);
    if (c.errors) alerts.push(`<div class="alert alert-error" style="margin-bottom:6px"><i data-lucide="alert-triangle"></i> ${c.errors} record${c.errors !== 1 ? 's' : ''} contain errors and will not be imported</div>`);
    if (c.warnings) alerts.push(`<div class="alert" style="margin-bottom:6px;background:var(--amber-50);color:var(--amber-800)"><i data-lucide="triangle-alert"></i> ${c.warnings} record${c.warnings !== 1 ? 's' : ''} imported with warnings</div>`);
    if (!alerts.length) alerts.push(`<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> All rows are valid</div>`);

    const issueCount = c.errors + c.duplicates + c.exists;
    const footer = `
      <div class="mt-4" style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1px solid var(--gray-200);flex-wrap:wrap">
        <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
        <button class="btn btn-secondary" onclick="ImportSystem.resetFile()"><i data-lucide="file-up"></i> Replace File</button>
        ${issueCount ? `<button class="btn btn-secondary" onclick="ImportSystem.downloadErrorReport()"><i data-lucide="file-warning"></i> Download Error Report</button>` : ''}
        ${c.errors ? `<button class="btn btn-warning" onclick="ImportSystem.renderErrors()"><i data-lucide="file-warning"></i> View Errors (${c.errors})</button>` : ''}
        ${c.valid ? `<button class="btn btn-primary" onclick="ImportSystem.confirmImport()"><i data-lucide="upload"></i> Import ${c.valid} Valid Record${c.valid !== 1 ? 's' : ''}</button>` : ''}
      </div>`;

    previewDiv.innerHTML = `
      ${stepHtml(3)}
      <div class="file-card">
        <div class="file-icon"><i data-lucide="file-spreadsheet"></i></div>
        <div class="file-meta">
          <div class="file-name">${es(STATE.fileName)}</div>
          <div class="file-detail">${formatFileSize(STATE.fileSize)} | ${c.total} records</div>
        </div>
        <button class="btn-remove" onclick="ImportSystem.resetFile()"><i data-lucide="x"></i> Replace</button>
      </div>
      ${marksBanner}
      ${alerts.join('')}
      <div class="import-stats">
        <div class="import-stat"><div class="is-value">${c.total}</div><div class="is-label">Total Rows</div></div>
        <div class="import-stat is-green"><div class="is-value">${c.valid}</div><div class="is-label">Ready</div></div>
        <div class="import-stat is-red"><div class="is-value">${c.errors}</div><div class="is-label">Errors</div></div>
        <div class="import-stat is-amber"><div class="is-value">${c.duplicates}</div><div class="is-label">Duplicates</div></div>
        <div class="import-stat is-blue"><div class="is-value">${c.exists}</div><div class="is-label">Already Exist</div></div>
      </div>
      <div class="import-filter-tabs">
        ${tabBtn('all', 'All', c.total, '', 'list')}
        ${tabBtn('valid', 'Valid', c.valid, 'green', 'check-circle-2')}
        ${tabBtn('errors', 'Errors', c.errors, c.errors ? 'red' : '', 'alert-triangle')}
        ${tabBtn('duplicates', 'Duplicates', c.duplicates, c.duplicates ? 'amber' : '', 'copy')}
        ${tabBtn('exists', 'Existing', c.exists, c.exists ? 'blue' : '', 'user-check')}
      </div>
      <div class="table-container" style="max-height:300px;overflow:auto;border:1px solid var(--gray-200);border-radius:var(--radius)">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th style="width:44px">No.</th>${def.columns.slice(0, 5).map(c => `<th>${es(c.label)}</th>`).join('')}<th>Status</th><th style="width:150px">Notes</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="${Math.min(def.columns.length, 5) + 3}" class="text-center text-muted">No rows to show</td></tr>`}</tbody>
        </table>
      </div>
      <p class="form-hint" style="margin-top:8px"><i data-lucide="info"></i> Only <strong>Ready</strong> rows are imported. Nothing is saved until you confirm.</p>
      ${footer}`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.renderErrors = () => {
    const def = DEFS[STATE.type];
    const previewDiv = document.getElementById('imp-preview');
    if (!def || !previewDiv) return;
    const bad = STATE.records.filter(r => r.status === 'error' || r.status === 'duplicate' || r.status === 'exists');
    if (!bad.length) { API.renderPreview(); return; }
    previewDiv.innerHTML = `
      ${stepHtml(3)}
      <div class="alert alert-error mb-4"><i data-lucide="file-warning"></i> ${bad.length} record${bad.length !== 1 ? 's' : ''} need attention before importing.</div>
      <div class="import-errors-list">${bad.map(r => `
        <div class="import-error-item">
          <div class="ie-row">Row ${r.rowNumber}</div>
          <div class="ie-code">${es(r.values[def.columns[0].key] || '(no code)')}</div>
          ${r.errors.map(e => `<div class="ie-problem"><strong>Problem:</strong> ${es(e.message)}</div>
            <div class="ie-fix"><strong>Fix:</strong> ${es(e.fix)}</div>`).join('')}
          ${(r.warnings || []).map(w => `<div class="ie-fix"><strong>Note:</strong> ${es(w)}</div>`).join('')}
        </div>`).join('')}</div>
      <p class="form-hint mt-4"><i data-lucide="alert-triangle"></i> Invalid and duplicate records are never imported. Fix them in the file, then re-upload.</p>
      <div class="mt-4" style="display:flex;justify-content:flex-end;gap:8px;padding-top:16px;border-top:1px solid var(--gray-200)">
        <button class="btn btn-secondary" onclick="ImportSystem.downloadErrorReport()"><i data-lucide="download"></i> Download Error Report</button>
        <button class="btn btn-primary" onclick="ImportSystem.renderPreview()"><i data-lucide="arrow-left"></i> Back to Preview</button>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.downloadErrorReport = () => {
    const def = DEFS[STATE.type];
    if (!def) return;
    const bad = STATE.records.filter(r => r.status !== 'ready');
    if (!bad.length) { Utils.toast('No errors to report', 'info'); return; }
    const head = def.columns.map(c => c.label).concat(['Row', 'Status', 'Error Reason', 'Suggestion']);
    const rows = bad.map(r => def.columns.map(c => r.values[c.key] || '')
      .concat(String(r.rowNumber), r.status,
        r.errors.map(e => e.message).join(' | ') || (r.warnings || []).join(' | '),
        r.errors.map(e => e.fix).join(' | ')));
    csvOrBook('RMS_' + def.filename.replace('_Template', '_Error_Report'), 'Errors', head, rows);
    Utils.toast('Error report downloaded', 'success');
  };

  API.confirmImport = () => {
    const def = DEFS[STATE.type];
    const c = STATE.counts;
    if (!c.valid) return Utils.toast('No valid records to import', 'error');
    const canUpdate = def.allowUpdate && c.exists > 0;
    const modeField = canUpdate ? `
      <div class="form-group" style="margin-top:12px"><label>Existing records (${c.exists})</label>
      <select id="imp-mode" class="select-field">
        <option value="skip">Skip existing records</option>
        <option value="update">Update existing records with file values</option>
      </select>
      <p class="form-hint">Updating overwrites the current values — for example the name, gender, phone or mark.</p></div>` : '';
    Modal.show('Confirm Import',
      `<div class="alert alert-info" style="margin-bottom:12px"><i data-lucide="upload-cloud"></i> <strong>${c.valid}</strong> valid record${c.valid !== 1 ? 's' : ''} are ready to import. ${c.duplicates} duplicate${c.duplicates !== 1 ? 's' : ''} and ${c.errors} invalid record${c.errors !== 1 ? 's' : ''} will NOT be imported.</div>
       <p class="text-sm text-muted">You can download an error report and fix the remaining rows, then re-upload.</p>${modeField}`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" onclick="ImportSystem.executeImport()"><i data-lucide="upload"></i> Import ${c.valid} Record${c.valid !== 1 ? 's' : ''}</button>`, true);
  };

  function prepareRows(def, mode) {
    const insert = [];
    const update = [];
    STATE.records.forEach(rec => {
      if (rec.status === 'ready' && rec.dbRow) insert.push(rec.dbRow);
      else if (rec.status === 'exists' && mode === 'update' && rec.dbRow && rec.existingId && def.allowUpdate) {
        update.push({ id: rec.existingId, update: rec.dbRow });
      }
    });
    return { insert, update };
  }

  API.executeImport = async () => {
    const def = DEFS[STATE.type];
    const mode = document.getElementById('imp-mode') ? document.getElementById('imp-mode').value : 'skip';
    let { insert, update } = prepareRows(def, mode);
    if (!insert.length && !update.length) { Utils.toast('Nothing to import', 'error'); return; }

    Modal.show('Importing...', `
      ${stepHtml(4)}
      <div class="import-progress">
        <div class="spinner" style="width:20px;height:20px;border-width:2px"></div>
        <span class="ip-text" id="imp-progress-text">Preparing...</span>
      </div>
      <div class="progress-bar"><div class="progress-bar-fill" id="imp-progress-bar" style="width:0%"></div></div>`, '', true);

    let imported = 0;
    let updated = 0;
    const totalWork = insert.length + update.length;
    const setProgress = (done) => {
      const txt = document.getElementById('imp-progress-text');
      const bar = document.getElementById('imp-progress-bar');
      if (txt) txt.textContent = `Imported ${imported} · Updated ${updated} / ${insert.length + update.length}...`;
      const pct = totalWork ? Math.round((done / totalWork) * 100) : 100;
      if (bar) bar.style.width = pct + '%';
    };

    try {
      const batchSize = 50;
      for (let i = 0; i < insert.length; i += batchSize) {
        const batch = insert.slice(i, i + batchSize);
        const { error } = await sbClient.from(def.table).insert(batch);
        if (error) throw error;
        imported += batch.length;
        setProgress(imported + updated);
      }
      for (const u of update) {
        const { error } = await sbClient.from(def.table).update(u.update).eq('id', u.id);
        if (error) throw error;
        updated++;
        setProgress(imported + updated);
      }
      if (typeof DB !== 'undefined') DB.invalidate(def.table);
      await API.recordAfter(def, insert.length, updated);
      API.renderResult(imported, updated);
    } catch (e) {
      await API.recordAfter(def, imported, updated, true, e.message);
      Modal.close();
      Utils.toast('Import error: ' + e.message, 'error');
    }
  };

  API.recordAfter = async (def, imported, updated, failed, failMsg) => {
    try {
      const c = STATE.counts;
      const year = (STATE.ctx.years || []).find(y => y.status === 'active' || y.is_current);
      await DB.insert('audit_logs', {
        user_id: Auth.currentUser && Auth.currentUser.id,
        user_name: Auth.currentUser && Auth.currentUser.full_name,
        role: Auth.currentUser && Auth.currentUser.role,
        action: 'import_' + def.table,
        new_value: 'Imported ' + imported + ' ' + def.noun + (updated ? ', updated ' + updated : '') + ' from ' + STATE.fileName + (failed ? '. FAILED: ' + failMsg : ''),
        timestamp: new Date().toISOString()
      });
      await DB.insert('import_history', {
        user_id: Auth.currentUser && Auth.currentUser.id,
        user_name: Auth.currentUser && Auth.currentUser.full_name,
        import_type: def.table,
        file_name: STATE.fileName,
        academic_year_name: year ? year.name : null,
        total_records: c.total,
        imported: imported,
        updated: updated,
        skipped: c.duplicates + c.errors,
        duplicates: c.duplicates,
        status: failed ? 'failed' : (c.duplicates + c.errors > 0 ? 'partial' : 'completed')
      });
    } catch (e) { console.error('Import logging error:', e); }
  };

  API.renderResult = (imported, updated) => {
    const def = DEFS[STATE.type];
    const c = STATE.counts;
    const skipped = Math.max(0, c.total - imported - updated);
    const year = (STATE.ctx.years || []).find(y => y.status === 'active' || y.is_current);
    const viewRoute = STATE.type === 'marks'
      ? (Auth.currentUser && Auth.currentUser.role === 'teacher' && STATE.selection.assessmentId
          ? 'teacher/enter-marks?assessment=' + STATE.selection.assessmentId
          : 'admin/marks')
      : def.view || ('admin/' + (STATE.type === 'assignments' ? 'assignments' : STATE.type === 'assessments' ? 'assessments' : STATE.type === 'classes' || STATE.type === 'subjects' ? 'academic' : STATE.type === 'teachers' ? 'teachers' : 'learners'));

    const resultBody = `
      <div class="text-center mb-4">
        <div style="width:56px;height:56px;margin:0 auto 12px;border-radius:50%;background:var(--green-50);color:var(--green-600);display:flex;align-items:center;justify-content:center"><i data-lucide="check-circle-2" style="width:28px;height:28px"></i></div>
        <h2 style="font-size:20px;font-weight:800;color:var(--gray-900)">Import Completed Successfully</h2>
        <p class="text-sm text-muted">${es(STATE.fileName)} ${year ? '· ' + es(year.name) : ''}</p>
      </div>
      <div class="import-stats">
        <div class="import-stat"><div class="is-value">${c.total}</div><div class="is-label">Total Rows</div></div>
        <div class="import-stat is-green"><div class="is-value">${imported + updated}</div><div class="is-label">Imported / Updated</div></div>
        <div class="import-stat is-blue"><div class="is-value">${skipped}</div><div class="is-label">Skipped</div></div>
        <div class="import-stat is-amber"><div class="is-value">${c.duplicates}</div><div class="is-label">Duplicates</div></div>
        <div class="import-stat is-red"><div class="is-value">${c.errors}</div><div class="is-label">Errors</div></div>
      </div>
      <div style="margin-top:12px">
        ${imported + updated ? `<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> ${imported} ${imported === 1 ? 'record' : 'records'} imported${updated ? ' and ' + updated + ' updated' : ''}.</div>` : ''}
        ${c.exists ? `<div class="alert alert-info" style="margin-bottom:6px"><i data-lucide="info"></i> ${c.exists} existing record${c.exists !== 1 ? 's' : ''} were skipped.</div>` : ''}
        ${skipped && !c.exists ? `<div class="alert alert-warning" style="margin-bottom:6px"><i data-lucide="copy"></i> ${c.skipped} invalid/duplicate record${c.skipped !== 1 ? 's' : ''} were skipped.</div>` : ''}
        ${c.errors ? `<div class="alert alert-error" style="margin-bottom:6px"><i data-lucide="alert-triangle"></i> ${c.errors} record${c.errors !== 1 ? 's' : ''} with errors were not imported. Download the error report and fix them.</div>` : ''}
      </div>`;

    Modal.show(def.title, `${stepHtml(4)}${resultBody}`,
      `${c.errors || c.duplicates ? `<button class="btn btn-secondary" onclick="ImportSystem.downloadErrorReport()"><i data-lucide="file-warning"></i> Download Error Report</button>` : ''}
       <button class="btn btn-secondary" onclick="ImportSystem.open('${STATE.type}')"><i data-lucide="upload"></i> Import Another File</button>
       <button class="btn btn-primary" onclick="Modal.close();Router.go('${viewRoute}')"><i data-lucide="eye"></i> View ${def.noun === 'classes' || def.noun === 'subjects' ? def.noun : def.noun === 'marks' ? 'Marks' : def.noun === 'assignments' ? 'Assignments' : def.noun === 'assessments' ? 'Assessments' : def.noun === 'teachers' ? 'Teachers' : 'Learners'}</button>`, true);
  };

  return API;
})();