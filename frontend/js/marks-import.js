/* ============================================================
   MARKS IMPORT - multi-format teacher/DOS marks import
   Supported: Excel (.xlsx/.xls), CSV, Word (.docx/.doc), PDF
   Workflow: context -> upload -> extract -> match -> validate
             -> preview -> teacher confirms -> save to Supabase
   Marks are written ONLY after the teacher reviewed the preview.
   Every mark is validated against the real assessment (year,
   class, subject, student) before saving. RLS also enforces that
   a teacher can only write marks for their own assessments.
   ============================================================ */
const MarksImport = (() => {
  'use strict';

  const S = {
    step: 1,
    isAdmin: false,
    teacherId: null,
    assignments: [],
    ctx: { year: null, term: null, class: null, subject: null, assessment: null },
    years: [], terms: [], classes: [], subjects: [],
    roster: [], rosterByCode: {}, existingMarks: {}, grading: [], settings: {},
    file: null, fileName: '', fileSize: 0, fileType: '',
    docMode: null, tables: [], selectedTable: -1,
    rows: [], records: [],
    filter: 'all',
    counts: { total: 0, valid: 0, errors: 0, duplicates: 0, existing: 0, replaces: 0, matched: 0, importable: 0 }
  };

  const esc = v => (typeof Utils !== 'undefined' && Utils.escapeHtml) ? Utils.escapeHtml(v) : String(v == null ? '' : v);
  const trim = v => String(v == null ? '' : v).trim();
  const low = v => trim(v).toLowerCase();
  const normHdr = v => low(v).replace(/[^a-z0-9]/g, '');
  // Extract digits only – handles Excel leading apostrophe, spaces, dashes, etc.
  const normCode = v => String(v == null ? '' : v).replace(/\D/g, '');
  const isCode11 = v => /^\d{11}$/.test(normCode(v));

  const codeAliases = ['studentcode', 'studentno', 'studentnumber', 'code', 'learnercode', 'studcode', 'admno', 'admissionno', 'admission', 'regno', 'indexno', 'registrationno', 'nationalid'];
  const nameAliases = ['studentname', 'name', 'names', 'fullname', 'learnername', 'student', 'pupil', 'candidate'];
  const markAliases = ['mark', 'marks', 'score', 'marksobtained', 'obtained', 'obtainedmarks', 'result', 'rawmark', 'markobtained'];
  const aliasSet = codeAliases.concat(nameAliases).concat(markAliases);

  function formatFileSize(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return (bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function parseMarkNum(v) {
    if (v == null) return null;
    let s = String(v).trim().replace(/\s+/g, '');
    if (!s) return null;
    s = s.replace(/%$/, '');
    const slash = s.indexOf('/');
    if (slash > 0) s = s.slice(0, slash);
    s = s.replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    const n = parseFloat(s);
    if (!isFinite(n) || n < 0) return null;
    return n;
  }

  function cell(row, idx) {
    if (idx == null || idx < 0 || !row) return '';
    return trim(row[idx]);
  }

  function computeDerived(rec) {
    const max = Number(S.ctx.assessment ? S.ctx.assessment.maximum_mark : 30) || 30;
    if (rec.mark == null) return { pct: null, grade: '', remark: '', pf: '' };
    const pct = Utils.pct(rec.mark, max);
    const scale = S.grading && S.grading.length ? S.grading : [];
    const grade = Utils.grade(pct, scale);
    const remark = Utils.remark(pct, scale);
    const passMark = (S.settings && S.settings.pass_mark != null) ? S.settings.pass_mark : 50;
    const pf = Utils.passFail(pct, passMark);
    return { pct: pct, grade: grade, remark: remark, pf: pf };
  }

  function downloadBlob(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 60);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector('script[data-mi="' + src + '"]')) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.setAttribute('data-mi', src);
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  function wizardSteps(active) {
    const steps = ['Context', 'Upload', 'Preview', 'Import'];
    return `<div class="import-steps">${steps.map((s, i) => {
      const n = i + 1;
      const cls = n < active ? 'done' : n === active ? 'active' : '';
      return `<span class="import-step ${cls}"><span class="step-num">${n < active ? '<i data-lucide="check"></i>' : n}</span>${s}</span>${n < steps.length ? '<span class="import-step-sep"></span>' : ''}`;
    }).join('')}</div>`;
  }

  function ctxCard() {
    const a = S.ctx.assessment;
    const c = S.ctx.class;
    const su = S.ctx.subject;
    const y = S.ctx.year;
    const t = S.ctx.term;
    return `<div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:12px 16px;margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px">
      <div><div class="text-xs text-muted">Academic Year</div><div class="text-sm font-semibold">${esc(y ? y.name : '-')}</div></div>
      <div><div class="text-xs text-muted">Term</div><div class="text-sm font-semibold">${esc(t ? t.name : '-')}</div></div>
      <div><div class="text-xs text-muted">Class</div><div class="text-sm font-semibold">${esc(c ? c.name : '-')}</div></div>
      <div><div class="text-xs text-muted">Subject</div><div class="text-sm font-semibold">${esc(su ? su.name : '-')}</div></div>
      <div><div class="text-xs text-muted">Type</div><div class="text-sm font-semibold">${esc(a ? assessmentTypeName(S.types, a.assessment_type_id, 'End-of-Unit Assessment') : '-')}</div></div>
      <div><div class="text-xs text-muted">Unit</div><div class="text-sm font-semibold">${esc(a ? (a.unit || a.name) : '-')}</div></div>
      <div><div class="text-xs text-muted">Assessment</div><div class="text-sm font-semibold">${esc(a ? a.name : '-')}</div></div>
      <div><div class="text-xs text-muted">Maximum Mark</div><div class="text-sm font-semibold">${a ? a.maximum_mark : '-'}</div></div>
      <div><div class="text-xs text-muted">Assessed</div><div class="text-sm font-semibold">${a ? (Utils.dateStr ? Utils.dateStr(a.assessment_date) : a.assessment_date || '-') : '-'}</div></div>
    </div>`;
  }

  const LIBS = {
    pdf: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
    pdfWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js',
    tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@4/dist/tesseract.min.js',
    mammoth: 'https://cdn.jsdelivr.net/npm/mammoth@1.6.0/mammoth.browser.min.js',
    jszip: 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    jspdf: 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
  };

  // ------------------------------------------------------------
  // Column/table detection (shared by Excel, CSV, Word, PDF text)
  // ------------------------------------------------------------
  function colStats(grid) {
    const nCols = grid.reduce((m, r) => Math.max(m, r ? r.length : 0), 0);
    const stats = [];
    for (let c = 0; c < nCols; c++) stats.push({ code: 0, numeric: 0, text: 0 });
    const limit = Math.min(grid.length, 2000);
    for (let r = 0; r < limit; r++) {
      const row = grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const v = cell(row, c);
        if (!v) continue;
        const st = stats[c];
        if (isCode11(v)) st.code++;
        else if (/^\d{10,12}$/.test(normCode(v)) && normCode(v).length !== 11) st.code++;
        const n = parseMarkNum(v);
        if (n != null) st.numeric++;
        if (/[A-Za-z]/.test(v)) st.text++;
      }
    }
    return stats;
  }

  function analyzeGrid(grid) {
    const rows = (grid || []).filter(r => Array.isArray(r) && r.length);
    if (!rows.length) return null;

    // Search for header row in first 8 rows — handles title rows or blank rows before header
    let headerIdx = -1;
    let headerMap = null;
    for (let r = 0; r < Math.min(8, rows.length); r++) {
      const hdr = (rows[r] || []).map(h => normHdr(h));
      let hits = 0;
      hdr.forEach(h => { if (h && aliasSet.indexOf(h) !== -1) hits++; });
      // Also check alias-specific hits
      const codeHits = hdr.filter(h => codeAliases.indexOf(h) !== -1).length;
      const markHits = hdr.filter(h => markAliases.indexOf(h) !== -1).length;
      if (hits >= 2 || (codeHits >= 1 && markHits >= 1) || hits >= 1 && hdr.filter(Boolean).length >= 2) {
        headerIdx = r;
        // Build direct column map from header aliases (most reliable)
        const cIdx = hdr.findIndex(h => codeAliases.indexOf(h) !== -1);
        const mIdx = hdr.findIndex(h => markAliases.indexOf(h) !== -1);
        const nIdx = hdr.findIndex(h => nameAliases.indexOf(h) !== -1);
        if (cIdx >= 0 && mIdx >= 0) headerMap = { codeIdx: cIdx, markIdx: mIdx, nameIdx: nIdx };
        break;
      }
    }
    // If header found with clear code/mark mapping, use it directly (works even when marks are empty)
    if (headerMap && headerMap.codeIdx >= 0 && headerMap.markIdx >= 0) {
      return { headerIdx: headerIdx, codeIdx: headerMap.codeIdx, nameIdx: headerMap.nameIdx, markIdx: headerMap.markIdx };
    }

    const data = headerIdx >= 0 ? rows.slice(headerIdx + 1) : rows;
    if (!data.length) return null;
    const stats = colStats(data);
    const max = Number(S.ctx.assessment ? S.ctx.assessment.maximum_mark : 200) || 200;

    let codeIdx = -1, codeBest = 0;
    stats.forEach((s, i) => { if (s.code > codeBest) { codeBest = s.code; codeIdx = i; } });
    if (codeBest < 1) codeIdx = -1;

    let markIdx = -1, markBest = 0;
    stats.forEach((s, i) => {
      if (i === codeIdx || s.numeric < 1) return;
      const within = data.reduce((acc, r) => {
        const v = parseMarkNum(cell(r, i));
        return acc + (v != null && v <= max * 1.5 ? 1 : 0);
      }, 0);
      if (within > markBest) { markBest = within; markIdx = i; }
      else if (within === markBest && within > 0 && i > markIdx) markIdx = i;
    });
    // Fallback: if header exists but marks were empty, use header mark alias
    if (markIdx < 0 && headerIdx >= 0) {
      const hdr = (rows[headerIdx] || []).map(h => normHdr(h));
      const mIdx = hdr.findIndex(h => markAliases.indexOf(h) !== -1);
      if (mIdx >= 0) markIdx = mIdx;
    }

    let nameIdx = -1, nameBest = 0;
    stats.forEach((s, i) => {
      if (i === codeIdx || i === markIdx) return;
      if (s.text > nameBest) { nameBest = s.text; nameIdx = i; }
    });
    if (nameIdx < 0 && headerIdx >= 0) {
      const hdr = (rows[headerIdx] || []).map(h => normHdr(h));
      const nIdx = hdr.findIndex(h => nameAliases.indexOf(h) !== -1);
      if (nIdx >= 0) nameIdx = nIdx;
    }
    if (nameIdx < 0 && codeIdx >= 0 && codeIdx + 1 !== markIdx && stats[codeIdx + 1]) nameIdx = codeIdx + 1;
    if (codeIdx < 0 || markIdx < 0) return null;
    return { headerIdx: headerIdx, codeIdx: codeIdx, nameIdx: nameIdx, markIdx: markIdx };
  }

  function stripEmptyRows(aoa) {
    return (aoa || []).filter(r => Array.isArray(r) && r.some(c => trim(c) !== ''));
  }

  function isFooterRow(r, codeIdx) {
    const c = low(cell(r, codeIdx));
    if (!c) return false;
    return ['total', 'average', 'avg', 'sum', 'subtotal', 'mean', 'remarks', 'remark', 'note'].indexOf(c) !== -1;
  }

  function rowsFromGrid(grid) {
    const det = analyzeGrid(grid);
    if (!det) throw new Error('NO_TABLE');
    const data = det.headerIdx >= 0 ? grid.slice(det.headerIdx + 1) : grid;
    const rows = [];
    for (const r of data) {
      if (isFooterRow(r, det.codeIdx)) continue;
      const code = cell(r, det.codeIdx);
      const name = det.nameIdx >= 0 ? cell(r, det.nameIdx) : '';
      const markRaw = cell(r, det.markIdx);
      if (!code && !markRaw && !name) continue;
      rows.push({ code: code, name: name, markRaw: markRaw });
    }
    return rows;
  }

  // fallback: single-column files and OCR lines like "54102325012 Jean Claude 78"
  function rowsFromCombined(text) {
    const rows = [];
    const lines = String(text || '').split(/\r?\n/).map(l => trim(l)).filter(Boolean);
    for (const line of lines) {
      const m = line.match(/^\s*(\d{11})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*$/);
      if (m) rows.push({ code: m[1], name: m[2].trim(), markRaw: m[3] });
    }
    return rows;
  }

  // O/I/S confusion repair (OCR safety) - only when a variant maps to
  // exactly one existing student. Otherwise the code stays flagged.
  function ocrFixCode(code, rosterByCode) {
    const map = { 'O': '0', 'o': '0', 'I': '1', 'l': '1', 'S': '5', 's': '5', 'B': '8', 'G': '6', 'Z': '2' };
    const norm = normCode(code);
    if (norm.length !== 11) return null;
    const base = norm.split('');
    const positions = [];
    base.forEach((ch, i) => { if (map[ch]) positions.push({ i: i, ch: ch }); });
    if (!positions.length) return null;
    const candidates = new Set();
    positions.forEach(p => {
      const arr = base.slice();
      arr[p.i] = map[p.ch];
      candidates.add(arr.join(''));
    });
    if (positions.length >= 2) {
      for (let a = 0; a < positions.length; a++) {
        for (let b = a + 1; b < positions.length; b++) {
          const arr = base.slice();
          arr[positions[a].i] = map[positions[a].ch];
          arr[positions[b].i] = map[positions[b].ch];
          candidates.add(arr.join(''));
        }
      }
    }
    for (const cand of candidates) {
      if (rosterByCode[cand]) return { code: cand, learner: rosterByCode[cand] };
    }
    return null;
  }

  // ------------------------------------------------------------
  // Excel / CSV extraction (SheetJS is already loaded)
  // ------------------------------------------------------------
  async function ensureSpreadsheetLib() {
    if (typeof XLSX === 'undefined') await loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  }

  async function extractSpreadsheet(file) {
    await ensureSpreadsheetLib();
    const buf = new Uint8Array(await file.arrayBuffer());
    const wb = XLSX.read(buf, { type: 'array', cellText: true });
    return wb.SheetNames.map(n => ({
      name: n,
      aoa: stripEmptyRows(XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, defval: '', raw: false }))
    }));
  }

  function pickSpreadsheet(sheets) {
    let best = null, bestCount = 0;
    for (const sh of sheets) {
      let cnt = 0;
      try { cnt = rowsFromGrid(sh.aoa).length; } catch (e) { cnt = 0; }
      if (cnt > bestCount) { bestCount = cnt; best = sh; }
    }
    if (!best) {
      for (const sh of sheets) {
        const combined = rowsFromCombined(sh.aoa.map(r => (r || []).join(' ')).join('\n'));
        if (combined.length) return { aoa: null, combined: combined };
      }
      throw new Error('NO_TABLE');
    }
    return { aoa: best.aoa, combined: [] };
  }

  // ------------------------------------------------------------
  // Word (.docx / .doc) extraction
  // ------------------------------------------------------------
  async function extractWord(file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'docx') {
      await loadScript(LIBS.mammoth);
      const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
      const doc = new DOMParser().parseFromString('<div>' + (result.value || '') + '</div>', 'text/html');
      const tables = Array.from(doc.querySelectorAll('table')).map(t =>
        Array.from(t.rows).map(r => Array.from(r.cells).map(c => trim(c.textContent)))
      ).filter(t => t.length && t.some(r => r.some(c => c)));
      if (!tables.length) throw new Error('NO_TABLE');
      return tables;
    }
    const dec = new TextDecoder('windows-1252');
    const text = dec.decode(new Uint8Array(await file.arrayBuffer()));
    const lines = text.split(/\r?\n/).map(l => trim(l.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' '))).filter(l => l.length);
    const found = lines.filter(l => /\b\d{11}\b/.test(l)).map(l => l.split(/\s{2,}|\t/).map(c => trim(c)).filter(Boolean));
    if (found.length) return [found];
    throw new Error('LEGACY_DOC');
  }

  // ------------------------------------------------------------
  // PDF extraction: text PDFs via pdf.js, scanned PDFs via OCR
  // ------------------------------------------------------------
  function groupTextItems(items) {
    const buckets = [];
    (items || []).forEach(it => {
      if (!it || !it.str) return;
      const y = it.transform[5];
      let b = buckets.find(x => Math.abs(x.y - y) < 3.5);
      if (!b) { b = { y: y, its: [] }; buckets.push(b); }
      b.its.push({ x: it.transform[4], w: it.width || 0, text: it.str });
    });
    return buckets.map(b => {
      b.its.sort((a, c) => a.x - c.x);
      const cells = [];
      let cur = null;
      b.its.forEach(it => {
        if (cur === null || it.x - (cur.x + cur.w) > 4) {
          cur = { x: it.x, w: it.w, parts: [] };
          cells.push(cur);
        } else if (it.x >= cur.x) {
          cur.w = it.x - cur.x + (it.w || 0);
        }
        cur.parts.push(it.text);
      });
      return cells.map(c => ({ x: c.x, text: c.parts.join(' ') }));
    }).filter(l => l.length && l.some(c => c.text.trim()));
  }

  async function ocrPdf(doc, onProgress) {
    await loadScript(LIBS.tesseract);
    const T = window.Tesseract;
    const allLines = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const viewport = page.getViewport({ scale: 2.2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
      onProgress('OCR page ' + p + '/' + doc.numPages + ' (scanned PDF)', 20 + Math.round(((p - 1) / doc.numPages) * 70));
      const res = await T.recognize(canvas, 'eng', {
        logger: m => { if (m && m.status === 'recognizing text' && onProgress) onProgress('OCR page ' + p + '/' + doc.numPages + ' ...' + (m.progress ? ' ' + Math.round(m.progress * 100) + '%' : ''), 20 + Math.round(((p - 1 + (m.progress || 0)) / doc.numPages) * 70)); }
      });
      const data = res && res.data ? res.data : null;
      const lines = data && data.lines ? data.lines.map(l => l.text) : [];
      allLines.push.apply(allLines, lines);
      await new Promise(r => setTimeout(r, 0));
    }
    return allLines;
  }

  function parseOcrLines(lines) {
    const rows = [];
    (lines || []).forEach(raw => {
      const line = trim(raw);
      if (!line) return;
      const m = line.match(/(\d{11})\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*$/);
      if (m) {
        rows.push({ code: m[1], name: m[2].trim(), markRaw: m[3] });
        return;
      }
      const names = line.split(/\s{2,}|\t+/).map(c => trim(c)).filter(Boolean);
      if (names.length >= 3 && /\d{11}/.test(names.join(' '))) {
        rows.push({ code: names[0], name: names.slice(1, -1).join(' '), markRaw: names[names.length - 1] });
      }
    });
    return rows;
  }

  async function extractPdf(file, onProgress) {
    await loadScript(LIBS.pdf);
    if (window.pdfjsLib) {
      try { pdfjsLib.GlobalWorkerOptions.workerSrc = LIBS.pdfWorker; } catch (e) { /* ignore */ }
    }
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    onProgress('Extracting marks...', 4);
    const pageLines = [];
    let totalText = '';
    for (let p = 1; p <= doc.numPages; p++) {
      onProgress('Extracting text... page ' + p + '/' + doc.numPages, 4 + Math.round(((p - 1) / doc.numPages) * 55));
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      const lines = groupTextItems(tc.items);
      pageLines.push(lines);
      totalText += lines.map(l => l.map(c => c.text).join(' ')).join('\n') + '\n';
      await new Promise(r => setTimeout(r, 0));
    }
    const textDensity = totalText.replace(/\s/g, '').length / Math.max(1, doc.numPages);
    const hasCodes = /\b\d{11}\b/.test(totalText) || (totalText.match(/\d{10,}/g) || []).length >= 2;

    if (hasCodes && textDensity > 25) {
      const grid = [];
      pageLines.forEach(lines => lines.forEach(line => grid.push(line.map(c => c.text))));
      let rows = [];
      try { rows = rowsFromGrid(grid); } catch (e) { rows = []; }
      if (!rows.length) rows = rowsFromCombined(totalText);
      if (rows.length) {
        onProgress('Preparing preview...', 98);
        return { mode: 'text', rows: rows };
      }
    }
    onProgress('Scanned PDF detected - OCR extraction required', 18);
    const ocrLines = await ocrPdf(doc, onProgress);
    const rows = parseOcrLines(ocrLines);
    if (!rows.length) rows.push.apply(rows, rowsFromCombined(ocrLines.join('\n')));
    onProgress('OCR complete - validating...', 96);
    return { mode: 'ocr', rows: rows };
  }

  // ------------------------------------------------------------
  // Record building + validation
  // ------------------------------------------------------------
  function buildRowsFromGrid(grid) {
    let rows = [];
    try { rows = rowsFromGrid(grid); } catch (e) { rows = []; }
    if (!rows.length) rows = rowsFromCombined(grid.map(r => (r || []).join(' ')).join('\n'));
    return rows;
  }

  function validateAll() {
    const seen = {};
    S.records.forEach((rec, i) => {
      rec.errors = [];
      rec.note = '';
      rec.ocrFixed = false;
      rec.mark = null;
      rec.learner = null;
      validateRecord(rec, seen, i);
    });
    computeCounts();
  }

  function validateRecord(rec, seen, idx) {
    const max = Number(S.ctx.assessment ? S.ctx.assessment.maximum_mark : 30) || 30;
    rec.code = normCode(rec.code);
    rec.mark = parseMarkNum(rec.markRaw);

    if (!rec.code) {
      rec.errors.push('Missing Student Code');
    } else if (!isCode11(rec.code)) {
      const fixed = ocrFixCode(rec.code, S.rosterByCode);
      if (fixed) {
        rec.ocrFixed = true;
        rec.note = 'Code corrected from OCR: ' + rec.code + ' -> ' + fixed.code;
        rec.code = fixed.code;
        rec.learner = fixed.learner;
      } else {
        rec.errors.push('Student Code must be exactly 11 digits');
      }
    }
    if (!rec.learner && rec.code && isCode11(rec.code)) {
      rec.learner = S.rosterByCode[rec.code];
      if (!rec.learner) rec.errors.push('Student Not Found');
    }

    if (!trim(rec.markRaw)) {
      rec.errors.push('Missing Mark');
      rec.mark = null;
    } else if (rec.mark == null) {
      rec.errors.push('Invalid Mark (not a number)');
    } else if (rec.mark > max) {
      rec.errors.push('Mark ' + rec.mark + ' exceeds the maximum (' + max + ')');
    } else if (rec.mark < 0) {
      rec.errors.push('Mark cannot be negative');
    }

    if (rec.errors.length) {
      rec.status = 'error';
      return;
    }

    if (seen[rec.code]) {
      rec.status = 'duplicate';
      rec.note = 'Duplicate inside the file - already listed above. Skipped.';
      return;
    }
    seen[rec.code] = true;

    const existing = rec.learner ? S.existingMarks[rec.learner.id] : null;
    if (existing) {
      rec.status = 'existing';
      rec.existing = existing;
      rec.action = rec.action || 'keep';
      rec.note = 'Student ' + rec.code + ' already has a mark of ' + existing.mark + ' for this assessment.';
    } else {
      rec.status = 'valid';
    }
  }

  function computeCounts() {
    const c = { total: S.records.length, valid: 0, errors: 0, duplicates: 0, existing: 0, replaces: 0, matched: 0, importable: 0 };
    S.records.forEach(r => {
      if (r.status === 'valid') { c.valid++; c.matched++; c.importable++; }
      else if (r.status === 'error') c.errors++;
      else if (r.status === 'duplicate') c.duplicates++;
      else if (r.status === 'existing') {
        c.existing++;
        if (r.learner) c.matched++;
        if (r.action === 'replace') { c.replaces++; c.importable++; }
      }
    });
    S.counts = c;
  }

  // ------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------
  const API = {};

  async function ensureRbLoad() {
    const loaders = [];
    if (!S.rosterByCode || Object.keys(S.rosterByCode).length === 0) {
      loaders.push(DB.query('learners', '*', { class_id: S.ctx.class.id, status: 'active' }, { column: 'full_name', asc: true }).then(list => {
        S.roster = list || [];
        S.rosterByCode = {};
        S.roster.forEach(l => { S.rosterByCode[trim(l.learner_code)] = l; });
      }));
    }
    if (!S.existingMarks || Object.keys(S.existingMarks).length === 0) {
      loaders.push(DB.query('marks', 'id, assessment_id, learner_id, mark', { assessment_id: S.ctx.assessment.id, status: 'draft' }).then(() => {}).catch(() => {}));
      loaders.push(DB.query('marks', 'id, assessment_id, learner_id, mark', { assessment_id: S.ctx.assessment.id, status: 'submitted' }).then(() => {}).catch(() => {}));
      loaders.push(DB.query('marks', 'id, assessment_id, learner_id, mark', { assessment_id: S.ctx.assessment.id, status: 'locked' }).then(() => {}).catch(() => {}));
      loaders.push(DB.query('marks', 'id, assessment_id, learner_id, mark', { assessment_id: S.ctx.assessment.id }).then(list => {
        S.existingMarks = {};
        (list || []).forEach(m => { S.existingMarks[m.learner_id] = m; });
      }));
    }
    if (!S.grading || !S.grading.length) {
      loaders.push(DB.get('grading_scales').then(g => { S.grading = g || []; }).catch(() => {}));
    }
    if (!S.settings || Object.keys(S.settings).length === 0) {
      loaders.push(DB.query('school_settings', '*').then(s => { S.settings = (s && s[0]) || {}; }).catch(() => {}));
    }
    await Promise.all(loaders);
  }

  function allowedAssignment(assessment) {
    if (S.isAdmin) return true;
    return S.assignments.some(a =>
      a.class_id === assessment.class_id &&
      a.subject_id === assessment.subject_id &&
      (!a.academic_year_id || !assessment.academic_year_id || a.academic_year_id === assessment.academic_year_id)
    ) || assessment.teacher_id === S.teacherId;
  }

  API.open = async (opts) => {
    opts = opts || {};
    if (typeof Auth === 'undefined' || !Auth.currentUser) return Utils.toast('Please sign in first', 'error');
    S.isAdmin = Auth.isAdmin();
    S.teacherId = Auth.getTeacherId();
    S.step = 1;
    S.ctx = { year: null, term: null, class: null, subject: null, assessment: null };
    S.file = null; S.fileName = ''; S.fileSize = 0; S.fileType = '';
    S.docMode = null; S.tables = []; S.selectedTable = -1;
    S.rows = []; S.records = []; S.filter = 'all';
    S.rosterByCode = {}; S.existingMarks = {}; S.grading = []; S.settings = {};

    const [years, terms, classes, subjects, types] = await Promise.all([
      DB.get('academic_years'),
      DB.get('terms'),
      DB.get('classes'),
      DB.get('subjects'),
      getAssessmentTypes()
    ]);
    S.years = years || [];
    S.terms = terms || [];
    S.classes = classes || [];
    S.subjects = subjects || [];
    S.types = types || [];
    S.assignments = [];
    if (!S.isAdmin && S.teacherId) {
      try { S.assignments = await DB.query('teacher_assignments', '*', { teacher_id: S.teacherId }); } catch (e) { S.assignments = []; }
    }

    const activeYear = (function(){ try { if (typeof getActiveYearId === 'function') return S.years.find(y => y.id === getActiveYearId(S.years)) || null; } catch (e) {} return S.years.find(y => y.status === 'active') || null; })();
    S.ctx.year = activeYear || (S.years[0] || null);

    if (opts.assessmentId) {
      const assessment = (await DB.getRelated('assessments', '*', { id: opts.assessmentId }))[0];
      if (!assessment) { Utils.toast('Assessment not found', 'error'); return; }
      if (!allowedAssignment(assessment)) { Utils.toast('You are not authorized to import marks for this assessment', 'error'); return; }
      if (!S.isAdmin && assessment.status && !['draft', 'rejected'].includes(assessment.status)) {
        Utils.toast('This assessment is ' + assessment.status + ' and can no longer accept imported marks', 'error');
        return;
      }
      S.ctx.assessment = assessment;
      S.ctx.class = S.classes.find(c => c.id === assessment.class_id) || null;
      S.ctx.subject = S.subjects.find(x => x.id === assessment.subject_id) || null;
      if (assessment.academic_year_id) S.ctx.year = S.years.find(y => y.id === assessment.academic_year_id) || S.ctx.year;
      S.ctx.term = S.terms.find(t => t.id === assessment.term_id) || null;
      await API.renderUpload();
      return;
    }

    API.renderContext();
  };

  API.renderContext = () => {
    S.step = 1;
    const yId = S.ctx.year ? S.ctx.year.id : '';
    const yearOptions = S.years.map(y => `<option value="${y.id}" ${y.id === yId ? 'selected' : ''}>${esc(y.name)}</option>`).join('');
    Modal.show('Import Marks - Select Context',
      wizardSteps(1) + `
      <p class="text-sm text-muted" style="margin-bottom:14px">First tell the system exactly which assessment the marks belong to. Teachers can only pick their own assigned classes, subjects and assessments.</p>
      <div class="form-group">
        <label>Academic Year <span class="required">*</span></label>
        <select id="mi-year" class="select-field" onchange="MarksImport.changeYear(this.value)">${yearOptions}</select>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Term</label><select id="mi-term" class="select-field" onchange="MarksImport.changeTerm(this.value)"></select></div>
        <div class="form-group"><label>Class</label><select id="mi-class" class="select-field" onchange="MarksImport.changeClass(this.value)"></select></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Subject</label><select id="mi-subject" class="select-field" onchange="MarksImport.changeSubject(this.value)"></select></div>
        <div class="form-group"><label>Assessment</label><select id="mi-assessment" class="select-field" onchange="MarksImport.changeAssessment(this.value)"></select></div>
      </div>
      <div id="mi-context-card">${ctxCard()}</div>
      <div id="mi-context-msg"></div>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" id="mi-context-next" onclick="MarksImport.gotoUpload()"><i data-lucide="arrow-right"></i> Continue</button>`, true);
    API.renderYearSelects(yId);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.renderYearSelects = (yId) => {
    const terms = S.terms.filter(t => !yId || t.academic_year_id === yId);
    const termSel = document.getElementById('mi-term');
    const assignYear = t => S.assignments.filter(a => !a.academic_year_id || a.academic_year_id === yId);
    // classes available to this year
    let classes = S.classes;
    let subjects = S.subjects;
    if (!S.isAdmin) {
      const as = assignYear(yId);
      const cIds = [...new Set(as.map(a => a.class_id))];
      classes = classes.filter(c => cIds.includes(c.id));
      const sIds = [...new Set(as.map(a => a.subject_id))];
      subjects = subjects.filter(s => sIds.includes(s.id));
    }
    S._availClasses = classes;
    S._availSubjects = subjects;
    S._availTerms = terms;

    if (termSel) {
      termSel.innerHTML = '<option value="">Select term</option>' + terms.map(t => {
        const sel = S.ctx.term && S.ctx.term.id === t.id ? 'selected' : '';
        return `<option value="${t.id}" ${sel}>${esc(t.name)}</option>`;
      }).join('');
      if (S.ctx.term && !terms.find(t => t.id === S.ctx.term.id)) { S.ctx.term = null; termSel.value = ''; }
    }
    const clsSel = document.getElementById('mi-class');
    if (clsSel) {
      clsSel.innerHTML = '<option value="">Select class</option>' + classes.map(c => {
        const sel = S.ctx.class && S.ctx.class.id === c.id ? 'selected' : '';
        return `<option value="${c.id}" ${sel}>${esc(c.name)}</option>`;
      }).join('');
    }
    const subjSel = document.getElementById('mi-subject');
    if (subjSel) {
      subjSel.innerHTML = '<option value="">Select subject</option>' + subjects.map(s => {
        const sel = S.ctx.subject && S.ctx.subject.id === s.id ? 'selected' : '';
        return `<option value="${s.id}" ${sel}>${esc(s.name)}</option>`;
      }).join('');
    }
  };

  API.changeYear = (id) => {
    S.ctx.year = S.years.find(y => y.id === id) || null;
    S.ctx.term = null;
    S.ctx.class = null;
    S.ctx.subject = null;
    S.ctx.assessment = null;
    S._assessments = [];
    API.renderYearSelects(id);
    API.renderAssessmentSelect();
    API.refreshContextCard();
  };

  API.changeTerm = (id) => {
    S.ctx.term = S.terms.find(t => t.id === id) || null;
    API.refreshContextCard();
  };

  API.changeClass = (id) => {
    S.ctx.class = S.classes.find(c => c.id === id) || null;
    S.ctx.subject = null;
    S.ctx.assessment = null;
    S._assessments = [];
    if (S.ctx.class) {
      let subjects = S._availSubjects || S.subjects;
      if (!S.isAdmin) {
        subjects = subjects.filter(s => S.assignments.some(a =>
          a.class_id === S.ctx.class.id && a.subject_id === s.id &&
          (!a.academic_year_id || (S.ctx.year && a.academic_year_id === S.ctx.year.id))
        ));
      }
      const subjSel = document.getElementById('mi-subject');
      if (subjSel) subjSel.innerHTML = '<option value="">Select subject</option>' + subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
    }
    API.renderAssessmentSelect();
    API.refreshContextCard();
  };

  API.changeSubject = (id) => {
    S.ctx.subject = S.subjects.find(s => s.id === id) || null;
    S.ctx.assessment = null;
    S._assessments = [];
    if (S.ctx.class && S.ctx.subject) {
      (async () => {
        if (!S.isAdmin && !S.assignments.some(a =>
          a.class_id === S.ctx.class.id && a.subject_id === S.ctx.subject.id &&
          (!a.academic_year_id || (S.ctx.year && a.academic_year_id === S.ctx.year.id))
        )) {
          document.getElementById('mi-context-msg').innerHTML = '<div class="alert alert-error"><i data-lucide="alert-circle"></i> You are not assigned to this class + subject. Choose a combination you teach.</div>';
          if (typeof lucide !== 'undefined') lucide.createIcons();
        }
      })();
    }
    API.renderAssessmentSelect();
    API.refreshContextCard();
  };

  API.renderAssessmentSelect = () => {
    const sel = document.getElementById('mi-assessment');
    if (!sel) return;
    const filters = { class_id: S.ctx.class ? S.ctx.class.id : undefined, subject_id: S.ctx.subject ? S.ctx.subject.id : undefined };
    if (S.ctx.year) filters.academic_year_id = S.ctx.year.id;
    DB.query('assessments', '*', filters, { column: 'assessment_date', asc: false }).then(list => {
      let items = list || [];
      if (!S.isAdmin) items = items.filter(a => a.teacher_id === S.teacherId || allowedAssignment(a));
      S._assessments = items;
      sel.innerHTML = '<option value="">Select assessment</option>' + items.map(a =>
        `<option value="${a.id}">${esc(a.name)} - ${esc(a.unit || a.name)} (${a.maximum_mark} marks)</option>`
      ).join('');
    }).catch(() => {
      sel.innerHTML = '<option value="">No assessments</option>';
    });
  };

  API.changeAssessment = (id) => {
    S.ctx.assessment = (S._assessments || []).find(a => a.id === id) || null;
    API.refreshContextCard();
  };

  API.refreshContextCard = () => {
    const card = document.getElementById('mi-context-card');
    if (card) card.innerHTML = ctxCard();
    const msg = document.getElementById('mi-context-msg');
    if (msg && S.ctx.assessment) msg.innerHTML = '';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.gotoUpload = async () => {
    if (!S.ctx.year) return Utils.toast('Select an Academic Year', 'error');
    if (!S.ctx.class) return Utils.toast('Select a Class', 'error');
    if (!S.ctx.subject) return Utils.toast('Select a Subject', 'error');
    if (!S.ctx.assessment) return Utils.toast('Select an Assessment', 'error');
    if (!S.isAdmin && S.ctx.assessment.teacher_id !== S.teacherId && !allowedAssignment(S.ctx.assessment)) {
      return Utils.toast('You are not authorized for this assessment', 'error');
    }
    if (!S.isAdmin && S.ctx.assessment.status && !['draft', 'rejected'].includes(S.ctx.assessment.status)) {
      return Utils.toast('This assessment is ' + S.ctx.assessment.status + ' and can no longer accept imported marks', 'error');
    }
    S.filter = 'all';
    await API.renderUpload();
  };

  API.renderUpload = async () => {
    S.step = 2;
    const a = S.ctx.assessment;
    Modal.show('Import Marks - Upload File',
      wizardSteps(2) + ctxCard() + `
      <p class="text-sm text-muted" style="margin-bottom:6px">Upload a marks sheet for <strong>${esc(a.name)}</strong> (${a.maximum_mark} marks max). Supported files: Excel, CSV, Word and PDF.</p>
      <div class="dropzone" id="mi-dropzone">
        <div class="dz-icon"><i data-lucide="file-upload"></i></div>
        <h4>Drag &amp; drop your marks sheet here</h4>
        <p>or click to browse</p>
        <div class="dz-formats"><span>.xlsx</span><span>.xls</span><span>.csv</span><span>.docx</span><span>.pdf</span></div>
      </div>
      <input type="file" id="mi-file" accept=".xlsx,.xls,.csv,.docx,.doc,.pdf" style="display:none">
      <div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between">
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" onclick="MarksImport.downloadTemplate('excel')"><i data-lucide="file-spreadsheet"></i> Excel Template</button>
          <button class="btn btn-sm btn-outline" onclick="MarksImport.downloadTemplate('csv')"><i data-lucide="file-text"></i> CSV Template</button>
          <button class="btn btn-sm btn-outline" onclick="MarksImport.downloadTemplate('word')"><i data-lucide="file-text"></i> Word Template</button>
          <button class="btn btn-sm btn-outline" onclick="MarksImport.downloadTemplate('pdf')"><i data-lucide="file-text"></i> PDF Template</button>
        </div>
      </div>
      <div id="mi-root"></div>`,
      `<button class="btn btn-secondary" onclick="MarksImport.back()">Back</button>
       <button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>`, true);
    API.bindUpload();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.back = () => {
    API.open();
  };

  API.bindUpload = () => {
    const dz = document.getElementById('mi-dropzone');
    const input = document.getElementById('mi-file');
    if (!dz || !input) return;
    dz.addEventListener('click', () => input.click());
    input.addEventListener('change', () => { if (input.files && input.files.length) API.handleFile(input.files[0]); });
    ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.add('drag-over'); }));
    ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, e => { e.preventDefault(); dz.classList.remove('drag-over'); }));
    dz.addEventListener('drop', e => {
      const files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) API.handleFile(files[0]);
    });
  };

  API.handleFile = async (file) => {
    const root = document.getElementById('mi-root');
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'xls', 'csv', 'docx', 'doc', 'pdf'].indexOf(ext) === -1) {
      if (root) root.innerHTML = '<div class="alert alert-error"><i data-lucide="alert-circle"></i> Unsupported file type. Use .xlsx, .xls, .csv, .docx, .doc or .pdf.</div>';
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }
    S.file = file;
    S.fileName = file.name;
    S.fileSize = file.size;
    S.fileType = ext;
    S.docMode = null;
    S.tables = [];
    S.selectedTable = -1;
    S.records = [];
    if (root) root.innerHTML = fileCard() + `<div class="import-progress"><div class="ip-text" id="mi-prog-label">Extracting marks...</div><div style="flex:1"><div id="mi-prog-track" class="progress-bar" style="width:100%"><div id="mi-prog-bar" class="progress-bar-fill" style="width:6%"></div></div></div><div class="text-xs text-muted" id="mi-prog-pct">6%</div></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
    try {
      let rows = [];
      if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') {
        S.docMode = 'spreadsheet';
        const sheets = await extractSpreadsheet(file);
        const chosen = pickSpreadsheet(sheets);
        rows = chosen.aoa ? buildRowsFromGrid(chosen.aoa) : chosen.combined;
      } else if (ext === 'docx' || ext === 'doc') {
        S.docMode = 'word';
        const tables = await extractWord(file);
        S.tables = tables;
        if (tables.length > 1) { API.renderTablePicker(); return; }
        S.selectedTable = 0;
        rows = buildRowsFromGrid(tables[0]);
      } else if (ext === 'pdf') {
        const res = await extractPdf(file, API.renderProgress);
        S.docMode = res.mode;
        rows = res.rows;
      }
      if (!rows || !rows.length) {
        if (root) root.innerHTML = fileCard() + `<div class="alert alert-error"><i data-lucide="file-warning"></i> No valid marks table was detected. Please use the provided marks template.</div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }
      S.rows = rows;
      S.records = rows.map(r => ({ code: r.code, name: r.name, markRaw: r.markRaw, status: 'error', errors: [], note: '', action: null, existing: null, learner: null, mark: null, ocrFixed: false }));
      await ensureRbLoad();
      validateAll();
      API.renderPreview();
    } catch (e) {
      console.error('[MarksImport]', e);
      let msg = 'Could not read this file. Please check it and try again.';
      if (e.message === 'NO_TABLE') msg = 'No valid marks table was detected. Please use the provided marks template.';
      else if (e.message === 'LEGACY_DOC') msg = 'This is an old .doc file. Please re-save it as .docx, Excel (.xlsx) or CSV for a reliable import.';
      if (root) root.innerHTML = fileCard() + `<div class="alert alert-error"><i data-lucide="file-warning"></i> ${esc(msg)}</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  };

  function fileCard() {
    return `<div class="file-card"><div class="file-icon"><i data-lucide="file-spreadsheet"></i></div>
      <div class="file-meta"><div class="file-name">${esc(S.fileName)}</div><div class="file-detail">${formatFileSize(S.fileSize)} | ${esc((S.fileType || '').toUpperCase())}</div></div>
      <button class="btn-remove" onclick="MarksImport.clearFile()"><i data-lucide="x"></i> Remove</button></div>`;
  }

  API.renderProgress = (label, pct) => {
    const bar = document.getElementById('mi-prog-bar');
    const txt = document.getElementById('mi-prog-label');
    const pctEl = document.getElementById('mi-prog-pct');
    if (bar) bar.style.width = (pct || 0) + '%';
    if (txt) txt.textContent = label || 'Working...';
    if (pctEl) pctEl.textContent = (pct || 0) + '%';
  };

  API.clearFile = () => {
    S.file = null;
    const root = document.getElementById('mi-root');
    if (root) root.innerHTML = '';
    const input = document.getElementById('mi-file');
    if (input) input.value = '';
    S.records = [];
    S.rows = [];
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.renderTablePicker = () => {
    const root = document.getElementById('mi-root');
    if (!root) return;
    root.innerHTML = fileCard() + `
      <p class="text-sm font-semibold" style="margin-bottom:8px">This Word document contains ${S.tables.length} tables. Select the marks table:</p>
      <div class="import-errors-list">${S.tables.map((t, i) => {
        const preview = t.slice(0, 3).map(r => r.join(' | ')).join('<br>');
        return `<div class="import-error-item" style="cursor:pointer" onclick="MarksImport.pickTable(${i})">
          <div class="ie-row">Table ${i + 1}</div><div class="ie-code">${esc(preview)}</div></div>`;
      }).join('')}</div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.pickTable = async (i) => {
    S.selectedTable = i;
    const rows = buildRowsFromGrid(S.tables[i]);
    if (!rows || !rows.length) {
      const root = document.getElementById('mi-root');
      if (root) root.innerHTML = fileCard() + `<div class="alert alert-error"><i data-lucide="file-warning"></i> That table has no recognizable marks. Pick another table or use the template.</div>`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
      return;
    }
    S.rows = rows;
    S.records = rows.map(r => ({ code: r.code, name: r.name, markRaw: r.markRaw, status: 'error', errors: [], note: '', action: null, existing: null, learner: null, mark: null, ocrFixed: false }));
    await ensureRbLoad();
    validateAll();
    API.renderPreview();
  };

  // ------------------------------------------------------------
  // Preview
  // ------------------------------------------------------------
  API.filteredRecords = () => {
    const f = S.filter;
    if (f === 'all') return S.records;
    if (f === 'valid') return S.records.filter(r => r.status === 'valid');
    if (f === 'errors') return S.records.filter(r => r.status === 'error');
    if (f === 'duplicates') return S.records.filter(r => r.status === 'duplicate');
    if (f === 'existing') return S.records.filter(r => r.status === 'existing');
    return S.records;
  };

  function statusRow(rec) {
    if (rec.status === 'valid') return `<span class="import-badge import-badge-ready"><i data-lucide="check-circle-2"></i> Valid</span>`;
    if (rec.status === 'duplicate') return `<span class="import-badge import-badge-dup"><i data-lucide="copy"></i> Duplicate in File</span>`;
    if (rec.status === 'existing') {
      if (rec.action === 'replace') return `<span class="import-badge import-badge-ready"><i data-lucide="refresh-cw"></i> Will Replace</span>`;
      if (rec.action === 'skip') return `<span class="import-badge import-badge-dup"><i data-lucide="skip-forward"></i> Skipped</span>`;
      return `<span class="import-badge import-badge-exists"><i data-lucide="user-check"></i> Existing</span>`;
    }
    return `<span class="import-badge import-badge-error"><i data-lucide="alert-triangle"></i> Error</span>`;
  }

  API.renderPreview = () => {
    S.step = 3;
    const c = S.counts;
    const max = Number(S.ctx.assessment.maximum_mark) || 30;
    const modeBanner = S.docMode === 'ocr'
      ? '<div class="alert alert-warning" style="margin-bottom:6px"><i data-lucide="scan"></i> <strong>Scanned PDF - OCR extraction required.</strong> OCR can confuse 0/O, 1/I and 5/S. Every code is checked against the real student list and was repaired only when it matched exactly one student. Review carefully before importing.</div>'
      : S.docMode === 'pdf' || S.docMode === 'text'
        ? '<div class="alert alert-info" style="margin-bottom:6px"><i data-lucide="file-text"></i> Text PDF detected.</div>'
        : '';
    const list = API.filteredRecords();
    const maxRows = 200;
    const shown = list.slice(0, maxRows);
    const truncated = list.length > maxRows;

    const rowsHtml = shown.map(rec => {
      const i = S.records.indexOf(rec);
      const good = rec.errors.length === 0;
      const derived = computeDerived(rec);
      const name = rec.name || (rec.learner ? rec.learner.full_name : '');
      const actionSel = rec.status === 'existing' && rec.existing
        ? `<select class="select-field" style="width:130px;padding:2px 6px;font-size:11px" onchange="MarksImport.setAction(${i}, this.value)">
            <option value="keep" ${rec.action === 'keep' ? 'selected' : ''}>Keep existing (${rec.existing.mark})</option>
            <option value="replace" ${rec.action === 'replace' ? 'selected' : ''}>Replace with ${rec.mark == null ? 'this' : rec.mark}</option>
            <option value="skip" ${rec.action === 'skip' ? 'selected' : ''}>Skip</option>
          </select>`
        : '';
      const note = rec.note ? `<div class="text-xs text-muted" style="margin-top:2px">${esc(rec.note)}</div>` : '';
      const errText = rec.errors.length
        ? `<span class="text-xs" style="color:var(--red-600)">${rec.errors.slice(0, 2).map(e => esc(e)).join('; ')}</span>`
        : '';
      const mark = rec.markRaw || renderMarkText(rec);
      return `<tr class="${rec.status === 'error' ? 'table-highlight' : ''}">
        <td class="text-muted text-center">${i + 1}</td>
        <td><input class="input-field" style="width:120px;color:var(--gray-800)" value="${esc(rec.code)}" onchange="MarksImport.editField(${i},'code',this.value)"></td>
        <td>${esc(name)}</td>
        <td><input type="text" inputmode="decimal" class="input-field" style="width:76px;text-align:center" value="${esc(mark)}" onchange="MarksImport.editField(${i},'mark',this.value)"></td>
        <td>${derived.pct != null ? '<span class="font-semibold">' + derived.pct + '%</span>' : '-'}</td>
        <td>${derived.grade ? `<span class="badge badge-info">${esc(derived.grade)}</span>` : '-'}</td>
        <td>${derived.pf ? `<span class="badge ${derived.pf === 'PASS' ? 'badge-success' : 'badge-danger'}">${derived.pf}</span>` : '-'}</td>
        <td>${statusRow(rec)}${actionSel}</td>
        <td style="max-width:180px">${errText}${note}</td>
      </tr>`;
    }).join('');

    const tab = (key, label, count, cls) => `
      <button class="import-filter-tab ${S.filter === key ? 'active' : ''}" onclick="MarksImport.setFilter('${key}')">${label} <span class="imp-filter-count ${cls || ''}">${count}</span></button>`;

    const alerts = [];
    if (c.valid) alerts.push(`<div class="alert alert-success" style="margin-bottom:6px"><i data-lucide="check-circle-2"></i> ${c.valid} mark${c.valid !== 1 ? 's' : ''} ready to import.</div>`);
    if (c.existing) alerts.push(`<div class="alert alert-info" style="margin-bottom:6px"><i data-lucide="info"></i> ${c.existing} student${c.existing !== 1 ? 's' : ''} already have a mark. Choose Keep Existing (default), Replace or Skip below.</div>`);
    if (c.duplicates) alerts.push(`<div class="alert alert-warning" style="margin-bottom:6px"><i data-lucide="copy"></i> ${c.duplicates} duplicate row${c.duplicates !== 1 ? 's' : ''} inside the file (kept the first occurrence, skipped the others).</div>`);
    if (c.errors) alerts.push(`<div class="alert alert-error" style="margin-bottom:6px"><i data-lucide="alert-triangle"></i> ${c.errors} record${c.errors !== 1 ? 's' : ''} have errors and will NOT be imported until you fix them.</div>`);

    const hasIssues = c.errors + c.duplicates > 0;

    Modal.show('Marks Import Preview',
      wizardSteps(3) + ctxCard() + fileCard() + modeBanner + alerts.join('') + `
      <div class="import-stats">
        <div class="import-stat"><div class="is-value">${c.total}</div><div class="is-label">Total Records</div></div>
        <div class="import-stat is-green"><div class="is-value">${c.matched}</div><div class="is-label">Matched</div></div>
        <div class="import-stat is-blue"><div class="is-value">${c.valid + (c.replaces || 0)}</div><div class="is-label">To Import</div></div>
        <div class="import-stat is-amber"><div class="is-value">${c.duplicates}</div><div class="is-label">Duplicates</div></div>
        <div class="import-stat is-red"><div class="is-value">${c.errors}</div><div class="is-label">Errors</div></div>
        <div class="import-stat" style="border-color:var(--blue-100);background:var(--blue-50)"><div class="is-value">${c.existing}</div><div class="is-label">Existing Marks</div></div>
      </div>
      <div class="import-filter-tabs">
        ${tab('all', 'All', c.total, '')}
        ${tab('valid', 'Valid', c.valid, 'green')}
        ${tab('existing', 'Existing', c.existing, c.existing ? 'blue' : '')}
        ${tab('duplicates', 'Duplicates', c.duplicates, c.duplicates ? 'amber' : '')}
        ${tab('errors', 'Errors', c.errors, c.errors ? 'red' : '')}
      </div>
      <div class="table-container" style="max-height:320px;overflow:auto;border:1px solid var(--gray-200);border-radius:var(--radius)">
        <table class="data-table" style="font-size:12px">
          <thead><tr><th style="width:40px">#</th><th>Student Code</th><th>Student Name</th><th>Mark /${max}</th><th>%</th><th>Grade</th><th>Pass/Fail</th><th>Status</th><th style="width:170px">Notes</th></tr></thead>
          <tbody>${rowsHtml || `<tr><td colspan="9" class="text-center text-muted">No rows to show</td></tr>`}</tbody>
        </table>
      </div>
      ${truncated ? `<p class="form-hint" style="margin-top:6px"><i data-lucide="info"></i> Showing the first ${maxRows} of ${list.length} records.</p>` : ''}
      <p class="form-hint" style="margin-top:6px"><i data-lucide="pencil-line"></i> You can correct a code or mark directly in the table and it is re-validated instantly. Nothing is saved until you confirm.</p>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-secondary" onclick="MarksImport.reUpload()"><i data-lucide="file-up"></i> Upload Another File</button>
       ${hasIssues ? `<button class="btn btn-secondary" onclick="MarksImport.downloadErrorReport()"><i data-lucide="file-warning"></i> Error Report</button>` : ''}
       ${c.importable ? `<button class="btn btn-primary" onclick="MarksImport.confirmImport()"><i data-lucide="upload"></i> Import ${c.importable} Mark${c.importable !== 1 ? 's' : ''}${c.replaces ? ' (incl. ' + c.replaces + ' replacement)' : ''}</button>` : `<button class="btn btn-primary" disabled><i data-lucide="upload"></i> Nothing to Import</button>`}`,
      true);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  function renderMarkText(rec) {
    return rec.mark == null ? '' : String(rec.mark);
  }

  API.reUpload = () => {
    API.clearFile();
    API.renderUpload();
  };

  API.setFilter = (f) => { S.filter = f; API.renderPreview(); };

  API.editField = (i, field, value) => {
    const rec = S.records[i];
    if (!rec) return;
    if (field === 'code') rec.code = value;
    else if (field === 'mark') rec.markRaw = value;
    validateAll();
    API.renderPreview();
  };

  API.setAction = (i, action) => {
    const rec = S.records[i];
    if (rec) rec.action = action;
    computeCounts();
    API.renderPreview();
  };

  // ------------------------------------------------------------
  // Confirm + execute
  // ------------------------------------------------------------
  API.confirmImport = () => {
    const c = S.counts;
    const replacing = c.replaces;
    const body = `
      <p class="text-sm text-muted" style="margin-bottom:12px">You are about to save marks for the assessment below. This writes to Supabase immediately.</p>
      <div style="background:var(--gray-50);border:1px solid var(--gray-200);border-radius:var(--radius);padding:14px 16px;margin-bottom:6px">
        <div class="flex justify-between mb-1"><span class="text-sm text-muted">Assessment</span><span class="text-sm font-semibold">${esc(S.ctx.assessment.name)}${S.ctx.assessment.unit ? ' - ' + esc(S.ctx.assessment.unit) : ''}</span></div>
        <div class="flex justify-between mb-1"><span class="text-sm text-muted">Class / Subject</span><span class="text-sm font-semibold">${esc(S.ctx.class.name)} / ${esc(S.ctx.subject.name)}</span></div>
        <div class="flex justify-between"><span class="text-sm text-muted">Maximum Mark</span><span class="text-sm font-semibold">${S.ctx.assessment.maximum_mark}</span></div>
      </div>
      <div class="flex justify-between mb-1"><span class="text-sm text-muted">New marks</span><span class="text-sm font-semibold" style="color:var(--green-600)">${c.valid}</span></div>
      ${replacing ? `<div class="flex justify-between mb-1"><span class="text-sm text-muted">Mark replacements</span><span class="text-sm font-semibold" style="color:var(--amber-600)">${replacing}</span></div>` : ''}
      <div class="flex justify-between"><span class="text-sm text-muted">Skipped (errors / duplicates / kept)</span><span class="text-sm font-semibold">${c.errors + c.duplicates + (c.existing - replacing)}</span></div>`;
    const footer = `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
      <button class="btn btn-primary" onclick="MarksImport.executeImport()"><i data-lucide="database"></i> ${replacing ? 'Confirm Replace & Import' : 'Confirm Import'}</button>`;
    if (replacing) {
      Modal.show('Confirm Mark Replacements', `
        <div class="alert alert-warning"><i data-lucide="alert-triangle"></i><div><strong>${replacing} existing mark${replacing !== 1 ? 's' : ''} will be overwritten.</strong><br>Replacing an existing mark is permanent and cannot be undone. Please double-check the preview.</div></div>` + body, footer, true);
    } else {
      Modal.show('Confirm Import', body, footer, true);
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  API.executeImport = async () => {
    const c = S.counts;
    const a = S.ctx.assessment;
    Modal.show('Importing Marks', `
      <div class="import-progress"><div class="ip-text" id="mi-prog-label">Importing marks...</div><div style="flex:1"><div id="mi-prog-track" class="progress-bar" style="width:100%"><div id="mi-prog-bar" class="progress-bar-fill" style="width:4%"></div></div></div><div class="text-xs text-muted" id="mi-prog-pct">4%</div></div>
      <p class="text-sm text-muted" id="mi-prog-note">Please wait - this only takes a moment.</p>`, '', false);
    try {
      const grad = S.grading && S.grading.length ? S.grading : (await Utils.getGradingScale()) || [];
      const passMark = (S.settings && S.settings.pass_mark != null) ? S.settings.pass_mark : 50;
      const max = Number(a.maximum_mark) || 30;
      const status = a.status === 'submitted' || a.status === 'approved' || a.status === 'locked' ? 'submitted' : 'draft';

      const toInsert = [];
      const toUpdate = [];
      S.records.forEach(rec => {
        if (rec.status === 'valid') toInsert.push(rec);
        else if (rec.status === 'existing' && rec.action === 'replace' && rec.existing) toUpdate.push(rec);
      });

      let imported = 0;
      let updated = 0;

      for (let i = 0; i < toInsert.length; i++) {
        const rec = toInsert[i];
        const pct = Utils.pct(rec.mark, max);
        const row = {
          assessment_id: a.id,
          learner_id: rec.learner.id,
          mark: rec.mark,
          percentage: pct,
          grade: Utils.grade(pct, grad),
          remark: Utils.remark(pct, grad),
          status: status
        };
        await retryUpsert(() => sbClient.from('marks').insert([row]).select());
        imported++;
        API.renderProgress('Importing marks...', 6 + Math.round((i / Math.max(1, toInsert.length)) * 70));
        await new Promise(r => setTimeout(r, 0));
      }

      for (let i = 0; i < toUpdate.length; i++) {
        const rec = toUpdate[i];
        const pct = Utils.pct(rec.mark, max);
        const row = {
          mark: rec.mark,
          percentage: pct,
          grade: Utils.grade(pct, grad),
          remark: Utils.remark(pct, grad)
        };
        await retryUpsert(() => sbClient.from('marks').update(row).eq('id', rec.existing.id).select());
        updated++;
        API.renderProgress('Updating existing marks...', 76 + Math.round((i / Math.max(1, toUpdate.length)) * 18));
        await new Promise(r => setTimeout(r, 0));
      }

      API.renderProgress('Recording import history...', 96);
      const skipped = c.errors + c.duplicates + (c.existing - updated);
      const errRows = S.records.filter(r => r.errors.length).slice(0, 50).map(r => ({
        code: r.code || '(none)',
        name: r.name || '',
        mark: r.markRaw || '',
        error: (r.errors[0] || '') + (r.errors[1] ? '; ' + r.errors[1] : '')
      }));
      const historyRow = {
        user_id: Auth.currentUser ? Auth.currentUser.id : null,
        user_name: Auth.currentUser ? Auth.currentUser.full_name : '',
        import_type: 'marks',
        file_name: S.fileName,
        file_type: (S.fileType || '').toUpperCase(),
        academic_year_name: S.ctx.year ? S.ctx.year.name : null,
        term_name: S.ctx.term ? S.ctx.term.name : null,
        class_name: S.ctx.class ? S.ctx.class.name : null,
        subject_name: S.ctx.subject ? S.ctx.subject.name : null,
        assessment_name: a.name,
        assessment_id: a.id,
        total_records: S.records.length,
        imported: imported,
        updated: updated,
        skipped: skipped,
        duplicates: c.duplicates,
        errors: c.errors,
        details: errRows.length ? errRows : null,
        status: (c.errors || c.duplicates) ? 'partial' : 'completed'
      };
      await sbClient.from('import_history').insert([historyRow]).catch(() => {});
      await sbClient.from('audit_logs').insert({
        user_id: Auth.currentUser ? Auth.currentUser.id : null,
        user_name: Auth.currentUser ? Auth.currentUser.full_name : null,
        role: Auth.currentUser ? Auth.currentUser.role : null,
        action: 'imported_marks',
        assessment_id: a.id,
        new_value: 'Imported ' + imported + ' marks (updated ' + updated + ', skipped ' + skipped + ') from ' + S.fileName,
        timestamp: new Date().toISOString()
      }).catch(() => {});
      // === SYNC EVERYWHERE: bulk import → analytics/reports/DOS dashboards ===
      DB.invalidate('marks');
      DB.invalidate('assessments');
      DB.invalidate('import_history');
      if (typeof AnalyticsEngine !== 'undefined') AnalyticsEngine.resetContext();
      if (typeof ReportUtils !== 'undefined') ReportUtils.invalidate();
    } catch (e) {
      console.error('[MarksImport] save error:', e);
      Utils.toast('Import failed: ' + e.message, 'error');
      Modal.close();
      return;
    }
    API.renderSummary();
  };

  async function retryUpsert(fn, tries) {
    tries = tries || 2;
    for (let i = 0; i < tries; i++) {
      try {
        const { error } = await fn();
        if (error) throw error;
        return;
      } catch (e) {
        if (i === tries - 1) throw e;
        await new Promise(r => setTimeout(r, 400));
      }
    }
  }

  API.renderSummary = () => {
    const c = S.counts;
    const imported = c.valid;
    const updated = c.replaces;
    const skipped = c.errors + c.duplicates + (c.existing - c.replaces);
    const viewRoute = S.isAdmin ? 'admin/marks' : 'teacher/enter-marks?assessment=' + S.ctx.assessment.id;
    const body = `
      <div class="alert alert-success" style="margin-bottom:12px"><i data-lucide="check-circle-2"></i> <strong>Marks Imported Successfully.</strong> Percentage, Grade, Pass/Fail and Remark were computed for every mark saved. Class and assessment statistics refresh automatically on the reports.</div>
      <div class="import-stats">
        <div class="import-stat"><div class="is-value">${S.records.length}</div><div class="is-label">Total Records</div></div>
        <div class="import-stat is-green"><div class="is-value">${imported}</div><div class="is-label">Imported</div></div>
        ${c.replaces ? `<div class="import-stat is-blue"><div class="is-value">${c.replaces}</div><div class="is-label">Updated</div></div>` : ''}
        <div class="import-stat is-amber"><div class="is-value">${skipped}</div><div class="is-label">Skipped</div></div>
        <div class="import-stat is-red"><div class="is-value">${c.errors}</div><div class="is-label">Errors</div></div>
      </div>
      <p class="text-sm text-muted" style="margin-top:8px">File: <strong>${esc(S.fileName)}</strong> &middot; ${esc(S.ctx.class.name)} - ${esc(S.ctx.subject.name)} &middot; ${esc(S.ctx.assessment.name)}</p>`;
    const footer = `<button class="btn btn-secondary" onclick="Modal.close()">Done</button>
      ${c.errors ? `<button class="btn btn-secondary" onclick="MarksImport.downloadErrorReport()"><i data-lucide="file-warning"></i> Download Error Report</button>` : ''}
      <button class="btn btn-primary" onclick="Modal.close();Router.go('${viewRoute}')"><i data-lucide="eye"></i> View Marks</button>`;
    Modal.show('Import Complete', body, footer, true);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  };

  // ------------------------------------------------------------
  // Error report
  // ------------------------------------------------------------
  API.downloadErrorReport = () => {
    const bad = S.records.filter(r => r.errors.length);
    const rows = [['Row', 'Student Code', 'Student Name', 'Mark', 'Error', 'Recommended Correction']];
    const fixes = {
      'Missing Student Code': 'Add the 11-digit student code',
      'Student Code must be exactly 11 digits': 'Check the code (exactly 11 digits, no letters, formatted as text)',
      'Student Not Found': 'Confirm the student is registered in this class, or fix the code',
      'Missing Mark': 'Enter the mark obtained',
      'Invalid Mark (not a number)': 'Use a number such as 78 or 15.5',
      'Mark ' : 'Enter a mark at or below the assessment maximum'
    };
    bad.forEach(r => {
      const err = r.errors[0] || '';
      let fix = fixes[err];
      if (!fix) fix = 'Check the value and correct it in the preview';
      rows.push([S.records.indexOf(r) + 1, r.code || '', r.name || '', r.markRaw || '', err, fix]);
    });
    const csv = rows.map(r => r.map(c => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c)).join(',')).join('\r\n');
    downloadBlob('marks-error-report.csv', new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    Utils.toast('Error report downloaded', 'success');
  };

  // ------------------------------------------------------------
  // Templates
  // ------------------------------------------------------------
  const TEMPLATE_HEADERS = ['Student Code', 'Student Name', 'Mark'];

  // Helper: ensure roster is loaded for template generation
  async function ensureRosterForTemplate(){
    if (S.roster && S.roster.length) return S.roster;
    if (S.ctx && S.ctx.class){
      try{
        const list = await DB.query('learners', '*', { class_id: S.ctx.class.id, status: 'active' }, { column: 'full_name', asc: true });
        S.roster = list || [];
        S.rosterByCode = {};
        S.roster.forEach(l=>{ S.rosterByCode[trim(l.learner_code)] = l; });
        return S.roster;
      }catch(e){ return []; }
    }
    // No context (e.g., called from generic import) – try to load from current marks entry if available
    if (typeof markAssessment !== 'undefined' && markAssessment && markAssessment.class_id){
      try{
        const list = await DB.query('learners', '*', { class_id: markAssessment.class_id, status: 'active' }, { column: 'full_name', asc: true });
        // Build a temporary roster for template without polluting S
        return list || [];
      }catch(e){ return []; }
    }
    return [];
  }

  API.downloadTemplate = async (kind) => {
    try {
      // If we have a roster context, populate template with Student Code + Name, empty Mark column
      const rosterForTemplate = await ensureRosterForTemplate();
      const hasRoster = rosterForTemplate && rosterForTemplate.length > 0;
      const templateRows = hasRoster
        ? [TEMPLATE_HEADERS].concat(rosterForTemplate.map(l=> [l.learner_code || '', l.full_name || '', '']))
        : [TEMPLATE_HEADERS, ['', '', '']];
      const templateFileBase = (S.ctx && S.ctx.assessment)
        ? `marks-template-${(S.ctx.class? S.ctx.class.name : 'Class').replace(/[^a-zA-Z0-9]/g,'_')}-${S.ctx.assessment.name.replace(/[^a-zA-Z0-9]/g,'_')}`
        : (typeof markAssessment !== 'undefined' && markAssessment ? `marks-template-${markAssessment.id.slice(0,8)}` : 'marks-template');
      if (kind === 'csv') {
        const csv = templateRows.map(r => r.map(c => /[",\n]/.test(String(c)) ? '"' + String(c).replace(/"/g, '""') + '"' : String(c)).join(',')).join('\r\n');
        downloadBlob(templateFileBase + '.csv', new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
        Utils.toast(hasRoster ? `CSV template downloaded (${rosterForTemplate.length} students)` : 'CSV template downloaded', 'success');
        return;
      }
      if (kind === 'excel') {
        await ensureSpreadsheetLib();
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet(templateRows);
        ws['!cols'] = [{ wch: 18 }, { wch: 28 }, { wch: 10 }];
        // Make Mark column editable, Code/Name not modified on import (matched by ID only)
        if (hasRoster){
          // Add data validation hint and freeze header
          ws['!autofilter'] = { ref: `A1:C${templateRows.length}` };
          // Highlight header
          const headerStyle = { font: { bold: true }, fill: { fgColor: { rgb: "0F172A" } } };
        }
        XLSX.utils.book_append_sheet(wb, ws, 'Marks');
        const info = XLSX.utils.aoa_to_sheet([
          ['MARKS SHEET TEMPLATE'],
          [],
          ['Fill in one row per student.'],
          ['Student Code: the 11-digit learner code (no letters, no spaces).'],
          ['Student Name: full name shown in the class register.'],
          ['Mark: the mark the student obtained out of the class assessment maximum.'],
          ['Do not change the header names. Keep the code as text (start with an apostrophe in Excel if needed).'],
          ['Save as .xlsx/.xls/.csv and upload it from the Import screen.']
        ]);
        info['!cols'] = [{ wch: 90 }];
        XLSX.utils.book_append_sheet(wb, info, 'Instructions');
        const data = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        downloadBlob(templateFileBase + '.xlsx', new Blob([data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        Utils.toast(hasRoster ? `Excel template downloaded (${rosterForTemplate.length} students)` : 'Excel template downloaded', 'success');
        return;
      }
      if (kind === 'word') {
        await loadScript(LIBS.jszip);
        if (!window.JSZip) throw new Error('Template library failed to load');
        const zip = new window.JSZip();
        zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
        zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
        let bodyRows = '';
        const escXml = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
        if (hasRoster){
          for (const l of rosterForTemplate){
            bodyRows += '<w:tr><w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>'+escXml(l.learner_code)+'</w:t></w:r></w:p></w:tc>'
              + '<w:tc><w:tcPr><w:tcW w:w="5200" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>'+escXml(l.full_name)+'</w:t></w:r></w:p></w:tc>'
              + '<w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr>';
          }
        } else {
          for (let i = 0; i < 8; i++) {
            bodyRows += '<w:tr><w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr><w:p/></w:tc>' +
              '<w:tc><w:tcPr><w:tcW w:w="5200" w:type="dxa"/></w:tcPr><w:p/></w:tc>' +
              '<w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/></w:tcPr><w:p/></w:tc></w:tr>';
          }
        }
        zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="32"/></w:rPr><w:t>MARKS SHEET TEMPLATE</w:t></w:r></w:p>
    <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:t>Fill in each student's 11-digit code, full name and the mark obtained (out of the assessment maximum).</w:t></w:r></w:p>
    <w:tbl>
      <w:tblPr><w:tblW w:w="8800" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="6"/><w:left w:val="single" w:sz="6"/><w:bottom w:val="single" w:sz="6"/><w:right w:val="single" w:sz="6"/><w:insideH w:val="single" w:sz="6"/><w:insideV w:val="single" w:sz="6"/></w:tblBorders></w:tblPr>
      <w:tr>
        <w:tc><w:tcPr><w:tcW w:w="2200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Student Code</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="5200" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Student Name</w:t></w:r></w:p></w:tc>
        <w:tc><w:tcPr><w:tcW w:w="1400" w:type="dxa"/></w:tcPr><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Mark</w:t></w:r></w:p></w:tc>
      </w:tr>
      ${bodyRows}
    </w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`);
        const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        downloadBlob(templateFileBase + '.docx', blob);
        Utils.toast(hasRoster ? `Word template downloaded (${rosterForTemplate.length} students)` : 'Word template downloaded', 'success');
        return;
      }
      if (kind === 'pdf') {
        await loadScript(LIBS.jspdf);
        const { jsPDF } = window.jspdf;
        if (!jsPDF) throw new Error('Template library failed to load');
        const doc = new jsPDF();
        doc.setFontSize(16);
        doc.setFont(undefined, 'bold');
        doc.text('MARKS SHEET TEMPLATE', 105, 22, { align: 'center' });
        doc.setFontSize(10);
        doc.setFont(undefined, 'normal');
        doc.text('Fill in each student\'s 11-digit code, full name and the mark obtained (out of the assessment maximum).', 105, 30, { align: 'center' });
        doc.setFontSize(11);
        doc.setFont(undefined, 'bold');
        doc.text('Student Code', 20, 48);
        doc.text('Student Name', 70, 48);
        doc.text('Mark', 170, 48);
        if (hasRoster){
          doc.setFontSize(8);
          doc.setFont(undefined, 'normal');
          let y = 56;
          for (let i = 0; i < rosterForTemplate.length; i++){
            if (y > 280){ doc.addPage(); y = 20; doc.setFontSize(11); doc.setFont(undefined,'bold'); doc.text('Student Code', 20, 14); doc.text('Student Name', 70, 14); doc.text('Mark', 170, 14); doc.setFont(undefined,'normal'); doc.setFontSize(8); y = 20; }
            const l = rosterForTemplate[i];
            doc.text(String(l.learner_code||''), 20, y);
            // Truncate name if too long
            const name = String(l.full_name||'');
            doc.text(name.length>42 ? name.slice(0,42)+'...' : name, 70, y);
            doc.line(20, y+2, 190, y+2);
            y += 10;
          }
        } else {
          doc.setFont(undefined, 'normal');
          for (let i = 0; i < 20; i++) {
            doc.line(20, 52 + i * 14, 190, 52 + i * 14);
          }
        }
        downloadBlob(templateFileBase + '.pdf', doc.output('blob'));
        Utils.toast(hasRoster ? `PDF template downloaded (${rosterForTemplate.length} students)` : 'PDF template downloaded', 'success');
        return;
      }
      throw new Error('Unknown template kind: ' + kind);
    } catch (e) {
      console.error('[MarksImport] template error:', e);
      Utils.toast('Could not build template: ' + e.message, 'error');
    }
  };

  return API;
})();

/* ============================================================
   GLOBAL EXPORT
   window.MarksImport  ->  { open, downloadTemplate, ... }
   Used by pages, sidebar and inline onclick handlers.
   ============================================================ */
if (typeof window !== 'undefined') {
  window.MarksImport = window.MarksImport || MarksImport;
}

/* ============================================================
   IMPORT HISTORY PAGE (registered as 'admin/import-history')
   Lists every import performed, marks included.
   ============================================================ */
async function renderImportHistory() {
  setHeader('Import History', 'Log of all bulk imports (learners, marks, etc.)');
  setContent(Utils.loading());
  try {
    const [rows, assessments] = await Promise.all([
      DB.query('import_history', '*', {}, { column: 'created_at', asc: false }),
      DB.get('assessments')
    ]);
    const byAid = {};
    assessments.forEach(a => { byAid[a.id] = a; });

    const body = (rows || []).map(h => {
      const when = h.created_at ? Utils.dateTimeStr(h.created_at) : '';
      const statusColor = h.status === 'completed' ? 'badge-success' : h.status === 'partial' ? 'badge-warning' : 'badge-danger';
      const details = (Array.isArray(h.details) && h.details.length)
        ? `<div class="text-xs text-muted" style="margin-top:4px">${h.details.slice(0, 3).map(d => esc(d.code) + ' - ' + esc(d.error)).join('<br>')}${h.details.length > 3 ? '<br>+' + (h.details.length - 3) + ' more' : ''}</div>`
        : '';
      return `<tr>
        <td>${h.id}</td>
        <td>${Utils.escapeHtml(h.user_name || '-')}</td>
        <td>${Utils.escapeHtml(h.file_name || '-')}<div class="text-xs text-muted">${Utils.escapeHtml((h.file_type || '')).toUpperCase()}</div></td>
        <td class="text-xs">${esc(h.academic_year_name || '-')}<br>${esc(h.term_name || '-')}</td>
        <td class="text-xs">${esc(h.class_name || '-')}<br>${esc(h.subject_name || '-')}</td>
        <td>${Utils.escapeHtml(h.assessment_name || '-')}</td>
        <td class="text-center">${h.total_records || 0}</td>
        <td class="text-center" style="color:var(--green-600)">${h.imported || 0}</td>
        <td class="text-center" style="color:var(--blue-600)">${h.updated || 0}</td>
        <td class="text-center" style="color:var(--amber-600)">${h.duplicates || 0}</td>
        <td class="text-center" style="color:var(--red-500)">${h.errors || 0}</td>
        <td class="text-sm text-muted">${when}</td>
        <td><span class="badge ${statusColor}">${Utils.escapeHtml(h.status || '-')}</span>${details}</td>
      </tr>`;
    }).join('');

    const legend = `
      <style>
        .import-history-legend { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:16px; font-size:12px; color:var(--gray-600); }
        .import-history-legend span { display:flex; align-items:center; gap:6px; }
        .legend-dot { width:10px; height:10px; border-radius:50%; display:inline-block; }
      </style>
      <div class="import-history-legend">
        <span><span class="legend-dot" style="background:var(--green-500)"></span>Completed</span>
        <span><span class="legend-dot" style="background:var(--amber-500)"></span>Partial (some rows failed)</span>
        <span><span class="legend-dot" style="background:var(--red-500)"></span>Failed</span>
      </div>`;

    setContent(legend + `
      <div class="card"><div class="table-container"><table class="data-table" style="font-size:12px">
        <thead><tr>
          <th>Import ID</th><th>Teacher</th><th>File</th><th>Year/Term</th><th>Class/Subject</th><th>Assessment</th>
          <th class="text-center">Records</th><th class="text-center">Imported</th><th class="text-center">Updated</th>
          <th class="text-center">Duplicates</th><th class="text-center">Errors</th><th>Date/Time</th><th>Status</th>
        </tr></thead>
        <tbody>${body || `<tr><td colspan="13">${Utils.empty('No imports recorded yet', 'inbox')}</td></tr>`}</tbody>
      </table></div></div>`);
  } catch (e) {
    console.error('[ImportHistory]', e);
    setContent(Utils.empty('Unable to load import history: ' + e.message, 'alert-triangle'));
  }
}