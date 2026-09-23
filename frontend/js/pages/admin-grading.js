/* ============================================================
   RMS-MIS GRADING SYSTEM MANAGEMENT
   DOS/Admin → Settings → Grading System
   Full CRUD for grading ranges with validation, preview, and restore defaults
   ============================================================ */

let gradingState = {
  rows: [],
  dirty: false
};

const DEFAULT_GRADING = [
  { minimum_percentage: 80, maximum_percentage: 100, grade: 'A', descriptor: 'Excellent', remark: 'Excellent', comment: 'Excellent performance. Keep up the outstanding work and continue striving for greater achievement.', is_pass: true, display_order: 1, is_active: true },
  { minimum_percentage: 75, maximum_percentage: 79, grade: 'B', descriptor: 'Very Good', remark: 'Very Good', comment: 'Very good performance. You have demonstrated strong understanding and consistent effort. Keep working hard.', is_pass: true, display_order: 2, is_active: true },
  { minimum_percentage: 70, maximum_percentage: 74, grade: 'C', descriptor: 'Good', remark: 'Good', comment: 'Good performance. You have shown a good understanding of the subject. Continue practicing to improve further.', is_pass: true, display_order: 3, is_active: true },
  { minimum_percentage: 65, maximum_percentage: 69, grade: 'D', descriptor: 'Satisfactory', remark: 'Satisfactory', comment: 'Satisfactory performance. You are making good progress. More practice and revision will help you achieve higher results.', is_pass: true, display_order: 4, is_active: true },
  { minimum_percentage: 60, maximum_percentage: 64, grade: 'E', descriptor: 'Adequate', remark: 'Adequate', comment: 'Adequate performance. You have met the basic expectations. Continue working consistently to strengthen your understanding.', is_pass: true, display_order: 5, is_active: true },
  { minimum_percentage: 50, maximum_percentage: 59, grade: 'S', descriptor: 'Minimum Pass', remark: 'Minimum Pass', comment: 'Minimum pass achieved. Increase your effort, revise regularly, and focus on areas that need improvement.', is_pass: true, display_order: 6, is_active: true },
  { minimum_percentage: 0, maximum_percentage: 49, grade: 'F', descriptor: 'Fail', remark: 'Fail', comment: 'Performance needs improvement. Review the fundamental concepts, practice regularly, and seek support from your teacher where necessary.', is_pass: false, display_order: 7, is_active: true }
];

async function renderGradingTab() {
  await loadGradingData();
  renderGradingUI();
}

async function loadGradingData() {
  const data = await DB.get('grading_scales');
  gradingState.rows = (data || [])
    .filter(s => s.is_active)
    .sort((a, b) => a.display_order - b.display_order)
    .map(s => ({
      id: s.id,
      minimum_percentage: s.minimum_percentage,
      maximum_percentage: s.maximum_percentage,
      grade: s.grade,
      descriptor: s.descriptor || s.remark,
      remark: s.remark,
      comment: s.comment || '',
      is_pass: s.is_pass,
      display_order: s.display_order,
      is_active: s.is_active,
      original: { ...s }
    }));
  if (!gradingState.rows.length) {
    gradingState.rows = DEFAULT_GRADING.map((d, i) => ({ ...d, display_order: i + 1, id: null, original: null }));
  }
}

function renderGradingUI() {
  const rowsHtml = gradingState.rows.map((r, i) => `
    <tr data-id="${r.id || ''}" data-order="${r.display_order}">
      <td class="text-center" style="width:48px">
        <button class="btn-icon btn-sm drag-handle" onclick="moveGrade(${i}, -1)" title="Move Up" ${i === 0 ? 'disabled' : ''}><i data-lucide="chevron-up"></i></button>
        <button class="btn-icon btn-sm drag-handle" onclick="moveGrade(${i}, 1)" title="Move Down" ${i === gradingState.rows.length - 1 ? 'disabled' : ''}><i data-lucide="chevron-down"></i></button>
      </td>
      <td>
        <input type="number" class="input-field grade-min" value="${r.minimum_percentage}" min="0" max="100" style="width:90px" data-field="min" data-idx="${i}" onchange="validateGradeRow(${i})" aria-label="Minimum percentage">
      </td>
      <td>
        <input type="number" class="input-field grade-max" value="${r.maximum_percentage}" min="0" max="100" style="width:90px" data-field="max" data-idx="${i}" onchange="validateGradeRow(${i})" aria-label="Maximum percentage">
      </td>
      <td>
        <input type="text" class="input-field grade-grade" value="${Utils.escapeHtml(r.grade)}" maxlength="2" style="width:70px;text-transform:uppercase" data-field="grade" data-idx="${i}" onchange="validateGradeRow(${i})" aria-label="Grade letter">
      </td>
      <td>
        <input type="text" class="input-field grade-descriptor" value="${Utils.escapeHtml(r.descriptor)}" maxlength="30" style="width:140px" data-field="descriptor" data-idx="${i}" onchange="validateGradeRow(${i})" aria-label="Descriptor">
      </td>
      <td>
        <select class="input-field grade-pass" style="width:100px" data-field="is_pass" data-idx="${i}" onchange="validateGradeRow(${i})">
          <option value="true" ${r.is_pass ? 'selected' : ''}>Pass</option>
          <option value="false" ${!r.is_pass ? 'selected' : ''}>Fail</option>
        </select>
      </td>
      <td>
        <button class="btn-icon btn-sm btn-secondary comment-btn" onclick="editComment(${i})" title="Edit Comment" aria-label="Edit comment"><i data-lucide="message-square"></i></button>
        ${r.comment ? '<span class="text-xs text-green-600" title="Custom comment set">✓</span>' : '<span class="text-xs text-muted" title="Using default">—</span>'}
      </td>
      <td class="text-center">
        <label class="checkbox-label"><input type="checkbox" class="grade-active" ${r.is_active ? 'checked' : ''} data-idx="${i}" onchange="validateGradeRow(${i})" aria-label="Active"></label>
      </td>
      <td class="text-center">
        <button class="btn-icon btn-sm btn-danger" onclick="deleteGrade(${i})" title="Delete" aria-label="Delete"><i data-lucide="trash-2"></i></button>
      </td>
    </tr>
  `).join('');

  const validation = validateAllRows();
  const isValid = validation.valid;

  const previewHtml = generatePreviewTable();

  document.getElementById('grading-content').innerHTML = `
    <div class="card mb-6">
      <div class="card-header" style="flex-wrap:wrap;gap:12px;align-items:flex-start">
        <div>
          <h3><i data-lucide="graduation-cap" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--amber-600)"></i>Grading System Configuration</h3>
          <p class="text-sm text-muted mt-1">Define percentage ranges, grades, descriptors, pass/fail status, and automatic comments. Ranges must be continuous (0–100) with no overlaps.</p>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-sm btn-outline" onclick="addGradeRow()"><i data-lucide="plus"></i> Add Range</button>
          <button class="btn btn-sm btn-outline" onclick="restoreDefaultGrading()"><i data-lucide="rotate-ccw"></i> Restore Defaults</button>
          <button class="btn btn-sm btn-secondary" onclick="previewGrading()"><i data-lucide="eye"></i> Preview</button>
        </div>
      </div>
      <div class="table-container">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width:56px">Order</th>
              <th style="width:100px">Min %</th>
              <th style="width:100px">Max %</th>
              <th style="width:80px">Grade</th>
              <th style="width:160px">Descriptor</th>
              <th style="width:100px">Pass/Fail</th>
              <th style="width:120px">Comment</th>
              <th style="width:60px">Active</th>
              <th style="width:56px">Actions</th>
            </tr>
          </thead>
          <tbody id="grade-tbody">${rowsHtml}</tbody>
        </table>
      </div>
      ${!isValid ? `<div class="alert alert-warning mt-3"><i data-lucide="alert-triangle"></i> <strong>Validation Errors:</strong> ${validation.errors.join('; ')}</div>` : ''}
    </div>

    <div class="card mb-6" id="grading-preview" style="display:none">
      <div class="card-header"><h3><i data-lucide="eye" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--blue-600)"></i>Grading System Preview</h3></div>
      <div class="table-container">${previewHtml}</div>
    </div>

    <div class="card">
      <div class="card-header"><h3><i data-lucide="clipboard-check" style="width:18px;height:18px;vertical-align:middle;margin-right:8px;color:var(--green-600)"></i>Boundary Test</h3></div>
      <div class="grid-4" style="gap:12px" id="boundary-test">
        ${DEFAULT_GRADING.map(r => `
          <div class="card" style="padding:12px;text-align:center">
            <div class="text-xs text-muted">${r.minimum_percentage}–${r.maximum_percentage}%</div>
            <div class="font-bold text-xl" style="color:${getGradeColor(r.grade)}">${r.grade}</div>
            <div class="text-sm">${Utils.escapeHtml(r.descriptor)}</div>
            <div class="text-xs text-muted mt-1">${r.is_pass ? '<span class="badge badge-success">Pass</span>' : '<span class="badge badge-danger">Fail</span>'}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function validateGradeRow(idx) {
  const row = gradingState.rows[idx];
  const tr = document.querySelector(`#grade-tbody tr[data-order="${idx + 1}"]`) || document.querySelector(`#grade-tbody tr:nth-child(${idx + 1})`);
  if (!tr) return;

  const min = parseFloat(tr.querySelector('[data-field="min"]')?.value) || 0;
  const max = parseFloat(tr.querySelector('[data-field="max"]')?.value) || 0;
  const grade = tr.querySelector('[data-field="grade"]')?.value?.trim().toUpperCase() || '';
  const descriptor = tr.querySelector('[data-field="descriptor"]')?.value?.trim() || '';
  const is_pass = tr.querySelector('[data-field="is_pass"]')?.value === 'true';
  const is_active = tr.querySelector('[data-field="active"]')?.checked ?? true;

  row.minimum_percentage = min;
  row.maximum_percentage = max;
  row.grade = grade;
  row.descriptor = descriptor;
  row.is_pass = is_pass;
  row.is_active = is_active;

  gradingState.dirty = true;
  updateValidationUI();
}

function validateAllRows() {
  const errors = [];
  const activeRows = gradingState.rows.filter(r => r.is_active);

  if (!activeRows.length) {
    errors.push('At least one active grading range is required');
    return { valid: false, errors };
  }

  const sorted = [...activeRows].sort((a, b) => a.minimum_percentage - b.minimum_percentage);

  sorted.forEach((r, i) => {
    if (r.minimum_percentage < 0) errors.push(`Row ${i + 1}: Minimum cannot be less than 0`);
    if (r.maximum_percentage > 100) errors.push(`Row ${i + 1}: Maximum cannot exceed 100`);
    if (r.minimum_percentage > r.maximum_percentage) errors.push(`Row ${i + 1}: Minimum cannot exceed maximum`);
    if (!r.grade) errors.push(`Row ${i + 1}: Grade is required`);
    if (!r.descriptor) errors.push(`Row ${i + 1}: Descriptor is required`);
  });

  const grades = sorted.map(r => r.grade);
  const dupGrades = grades.filter((g, i) => grades.indexOf(g) !== i);
  if (dupGrades.length) errors.push(`Duplicate grades: ${[...new Set(dupGrades)].join(', ')}`);

  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].maximum_percentage >= sorted[i + 1].minimum_percentage) {
      errors.push(`Overlap: ${sorted[i].grade} (${sorted[i].minimum_percentage}–${sorted[i].maximum_percentage}) overlaps with ${sorted[i + 1].grade} (${sorted[i + 1].minimum_percentage}–${sorted[i + 1].maximum_percentage})`);
    }
  }

  if (sorted[0].minimum_percentage > 0) errors.push(`Gap at start: 0–${sorted[0].minimum_percentage - 1}% not covered`);
  if (sorted[sorted.length - 1].maximum_percentage < 100) errors.push(`Gap at end: ${sorted[sorted.length - 1].maximum_percentage + 1}–100% not covered`);
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1].minimum_percentage - sorted[i].maximum_percentage - 1;
    if (gap > 0) errors.push(`Gap between ${sorted[i].grade} and ${sorted[i + 1].grade}: ${gap}% not covered`);
  }

  return { valid: errors.length === 0, errors };
}

function updateValidationUI() {
  const validation = validateAllRows();
  let alertDiv = document.getElementById('grading-validation-alert');
  if (!validation.valid) {
    if (!alertDiv) {
      alertDiv = document.createElement('div');
      alertDiv.id = 'grading-validation-alert';
      alertDiv.className = 'alert alert-warning mt-3';
      const card = document.querySelector('#grading-content .card');
      card.parentNode.insertBefore(alertDiv, card.nextSibling);
    }
    alertDiv.innerHTML = `<i data-lucide="alert-triangle"></i> <strong>Validation Errors:</strong> ${validation.errors.join('; ')}`;
  } else if (alertDiv) {
    alertDiv.remove();
  }
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function addGradeRow() {
  const nextOrder = gradingState.rows.length + 1;
  const newRow = {
    id: null,
    minimum_percentage: 0,
    maximum_percentage: 0,
    grade: '',
    descriptor: '',
    remark: '',
    comment: '',
    is_pass: true,
    display_order: nextOrder,
    is_active: true,
    original: null
  };
  gradingState.rows.push(newRow);
  gradingState.dirty = true;
  renderGradingUI();
}

function deleteGrade(idx) {
  if (!confirm('Delete this grading range?')) return;
  gradingState.rows.splice(idx, 1);
  gradingState.rows.forEach((r, i) => r.display_order = i + 1);
  gradingState.dirty = true;
  renderGradingUI();
}

function moveGrade(idx, direction) {
  const newIdx = idx + direction;
  if (newIdx < 0 || newIdx >= gradingState.rows.length) return;
  [gradingState.rows[idx], gradingState.rows[newIdx]] = [gradingState.rows[newIdx], gradingState.rows[idx]];
  gradingState.rows.forEach((r, i) => r.display_order = i + 1);
  gradingState.dirty = true;
  renderGradingUI();
}

function editComment(idx) {
  const row = gradingState.rows[idx];
  const current = row.comment || '';
  Modal.show('Edit Automatic Comment', `
    <div style="max-width:520px">
      <div class="form-group">
        <label>Grade: <strong>${Utils.escapeHtml(row.grade)}</strong> (${Utils.escapeHtml(row.descriptor)}, ${row.minimum_percentage}–${row.maximum_percentage}%)</label>
      </div>
      <div class="form-group">
        <label>Automatic Comment</label>
        <textarea id="grade-comment-input" class="input-field" rows="5" placeholder="Enter the default comment for this grade range...">${Utils.escapeHtml(current)}</textarea>
        <p class="form-hint">This comment is automatically used in report cards and reports when a student falls in this range. Teachers can override per-student.</p>
      </div>
      <div class="text-sm text-muted mb-3">Default: ${Utils.escapeHtml(getDefaultComment(row.grade))}</div>
    </div>`,
    `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
     <button class="btn btn-primary" onclick="saveComment(${idx})"><i data-lucide="save"></i> Save</button>`);
  document.getElementById('grade-comment-input').focus();
}

function saveComment(idx) {
  const comment = document.getElementById('grade-comment-input')?.value?.trim() || '';
  gradingState.rows[idx].comment = comment;
  gradingState.dirty = true;
  Modal.close();
  renderGradingUI();
}

function getDefaultComment(grade) {
  const def = DEFAULT_GRADING.find(d => d.grade === grade);
  return def ? def.comment : '';
}

function restoreDefaultGrading() {
  if (!confirm('Restore the official RMS-MIS grading configuration? This will replace all current ranges.')) return;
  gradingState.rows = DEFAULT_GRADING.map((d, i) => ({ ...d, display_order: i + 1, id: null, original: null }));
  gradingState.dirty = true;
  renderGradingUI();
  Utils.toast('Default grading configuration restored', 'success');
}

function generatePreviewTable() {
  const activeRows = gradingState.rows.filter(r => r.is_active).sort((a, b) => a.minimum_percentage - b.minimum_percentage);
  return `
    <div class="table-container">
    <table class="data-table">
      <thead><tr><th>Range</th><th>Grade</th><th>Descriptor</th><th>Pass/Fail</th><th>Comment</th></tr></thead>
      <tbody>
        ${activeRows.map(r => `
          <tr>
            <td><strong>${r.minimum_percentage}–${r.maximum_percentage}%</strong></td>
            <td><span class="badge" style="background:${getGradeColor(r.grade)}20;color:${getGradeColor(r.grade)}">${Utils.escapeHtml(r.grade)}</span></td>
            <td>${Utils.escapeHtml(r.descriptor)}</td>
            <td>${r.is_pass ? '<span class="badge badge-success">Pass</span>' : '<span class="badge badge-danger">Fail</span>'}</td>
            <td class="text-sm" style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${Utils.escapeHtml(r.comment)}">${Utils.escapeHtml(r.comment) || '<span class="text-muted">(using default)</span>'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    </div>
  `;
}

function previewGrading() {
  const preview = document.getElementById('grading-preview');
  preview.style.display = preview.style.display === 'none' ? 'block' : 'none';
  if (preview.style.display === 'block') {
    const previewHtml = generatePreviewTable();
    document.querySelector('#grading-preview .table-container').innerHTML = previewHtml;
  }
}

function getGradeColor(grade) {
  const colors = { A: '#166534', B: '#15803d', C: '#166534', D: '#854d0e', E: '#92400e', S: '#92400e', F: '#991b1b' };
  return colors[grade] || '#374151';
}

async function saveGrading() {
  const validation = validateAllRows();
  if (!validation.valid) {
    Utils.toast('Please fix validation errors before saving', 'error');
    return;
  }

  try {
    Utils.toast('Saving grading configuration...', 'info');

    // Delete all existing and re-insert (simple approach for idempotency)
    // In production, you'd do upserts, but this ensures clean state
    await DB.query('grading_scales', '*').then(async data => {
      for (const existing of data || []) {
        await DB.delete('grading_scales', existing.id);
      }
    });

    for (const row of gradingState.rows) {
      if (!row.is_active) continue;
      await DB.insert('grading_scales', {
        minimum_percentage: row.minimum_percentage,
        maximum_percentage: row.maximum_percentage,
        grade: row.grade,
        descriptor: row.descriptor,
        remark: row.remark || row.descriptor,
        comment: row.comment,
        is_pass: row.is_pass,
        display_order: row.display_order,
        is_active: row.is_active
      });
    }

    gradingState.dirty = false;
    GradingEngine.invalidate();
    Utils.toast('Grading configuration saved successfully', 'success');
    renderGradingUI();
  } catch (err) {
    console.error('Save grading error:', err);
    Utils.toast('Error saving: ' + err.message, 'error');
  }
}

function renderGradingContent() {
  return `
    <div id="grading-content">
      <div class="empty-state"><div class="spinner"></div><p>Loading grading configuration...</p></div>
    </div>
  `;
}

/* ---------- Window exports ---------- */
if (typeof window !== 'undefined') {
  window.renderGradingTab = renderGradingTab;
  window.saveGrading = saveGrading;
  window.addGradeRow = addGradeRow;
  window.deleteGrade = deleteGrade;
  window.moveGrade = moveGrade;
  window.editComment = editComment;
  window.saveComment = saveComment;
  window.restoreDefaultGrading = restoreDefaultGrading;
  window.previewGrading = previewGrading;
  window.validateGradeRow = validateGradeRow;
}