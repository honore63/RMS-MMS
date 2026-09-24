let marksAssessFilter = 'all';
let marksTypeFilter = 'all';
let marksClassFilter = 'all';
let marksLevelFilter = 'all';
async function renderAdminMarks() {
  setHeader('View All Marks', 'Review and manage all entered marks — filtered by education level');
  setContent(Utils.loading());
  let marks;
  let assessments;
  let types;
  let scale;
  let learners;
  let classes;
  try {
    [marks, assessments, types, scale] = await Promise.all([
      DB.query('marks', 'id,assessment_id,learner_id,mark,percentage,grade,status,remark,created_at', {}, { column: 'created_at', asc: false }, null, { cache: false }),
      DB.get('assessments', {}, { cache: false }),
      getAssessmentTypes(),
      getGradingScale()
    ]);
    const learnerIds = [...new Set(marks.map(m => m.learner_id).filter(Boolean))];
    [learners, classes] = await Promise.all([
      learnerIds.length ? DB.get('learners', { id: learnerIds }, { cache: false }) : [],
      DB.get('classes', {}, { cache: false })
    ]);
  } catch (e) {
    setContent(`<div class="alert alert-danger"><strong>Marks could not be loaded.</strong><br>${Utils.escapeHtml(e.message || 'Database request failed')}</div>`);
    return;
  }
  const learnerMap = new Map(learners.map(l => [l.id, l]));
  const classMap = new Map(classes.map(c => [c.id, c]));
  const levelMap = new Map();
  learners.forEach(l => { if (l.class_id) levelMap.set(l.id, EducationLevels.getCategory(classes.find(c => c.id === l.class_id))); });
  const scoped = (typeof Scope !== 'undefined' && Scope.isScoped());
  const filtered = (marksAssessFilter === 'all' ? marks : marks.filter(m => m.assessment_id === marksAssessFilter))
    .filter(m => {
      if (marksTypeFilter === 'all') return true;
      const a = assessments.find(a => a.id === m.assessment_id);
      return !!a && (a.assessment_type_id === marksTypeFilter);
    })
    .filter(m => marksClassFilter === 'all' || learnerMap.get(m.learner_id)?.class_id === marksClassFilter)
    .filter(m => {
      if (marksLevelFilter === 'all') return true;
      return levelMap.get(m.learner_id) === marksLevelFilter;
    });
  const sorted = [...filtered].sort((a, b) => {
    const classA = classMap.get(learnerMap.get(a.learner_id)?.class_id)?.name || '';
    const classB = classMap.get(learnerMap.get(b.learner_id)?.class_id)?.name || '';
    return classA.localeCompare(classB) || String(a.created_at || '').localeCompare(String(b.created_at || ''));
  });
  let rows = '';
  for (const m of sorted) {
    const a = assessments.find(a => a.id === m.assessment_id);
    const l = learnerMap.get(m.learner_id) || null;
    const cls = classMap.get(l?.class_id) || null;
    const pct = m.percentage || (m.mark != null ? Utils.pct(m.mark, a?.maximum_mark || 30) : 0);
    const grade = m.grade || Utils.grade(pct, scale);
    const pf = Utils.passFail(pct);
    rows += `<tr>
      <td>${Utils.escapeHtml(cls?.name || '-')}</td>
      <td class="col-name">${Utils.escapeHtml(a?.name||'-')}<div class="text-xs text-muted">${Utils.escapeHtml(assessmentTypeName(types, a?.assessment_type_id, 'End-of-Unit Assessment'))}${a?.unit ? ' - ' + Utils.escapeHtml(a.unit) : ''}</div></td>
      <td>${Utils.escapeHtml(l?.full_name||'-')}</td>
      <td>${m.mark != null ? m.mark + '/' + (a?.maximum_mark||30) : '-'}</td>
      <td class="font-semibold">${pct}%</td>
      <td><span class="badge badge-info">${grade}</span></td>
      <td><span class="badge ${pf==='PASS'?'badge-success':'badge-danger'}">${pf}</span></td>
      <td>${Utils.escapeHtml(m.remark||'-')}</td></tr>`;
  }

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <div class="flex gap-2" style="flex-wrap:wrap">
        <select class="select-field" style="max-width:240px" onchange="marksClassFilter=this.value;renderAdminMarks()">
          <option value="all">All Classes</option>
          ${classes.slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''))).map(c=>`<option value="${c.id}" ${marksClassFilter===c.id?'selected':''}>${Utils.escapeHtml(c.name)}</option>`).join('')}
        </select>
        <select class="select-field" style="max-width:420px" onchange="marksAssessFilter=this.value;renderAdminMarks()">
          <option value="all">All Assessments</option>
          ${assessments.map(a=>`<option value="${a.id}" ${marksAssessFilter===a.id?'selected':''}>${a.name} (${Utils.escapeHtml(assessmentTypeName(types, a.assessment_type_id, 'End-of-Unit Assessment'))})${a.unit ? ' - ' + Utils.escapeHtml(a.unit) : ''}</option>`).join('')}
        </select>
        <select class="select-field" style="max-width:260px" onchange="marksTypeFilter=this.value;renderAdminMarks()">
           <option value="all">All Types</option>
           ${types.filter(t => t.status === 'active').map(t=>`<option value="${t.id}" ${marksTypeFilter===t.id?'selected':''}>${Utils.escapeHtml(t.name)}</option>`).join('')}
         </select>
         <select class="select-field" style="max-width:220px" onchange="marksLevelFilter=this.value;renderAdminMarks()">
           <option value="all">All Levels</option>
           <option value="Primary" ${marksLevelFilter==='Primary'?'selected':''}>📗 Primary</option>
           <option value="Lower Secondary" ${marksLevelFilter==='Lower Secondary'?'selected':''}>📘 Lower Secondary</option>
           <option value="Upper Secondary" ${marksLevelFilter==='Upper Secondary'?'selected':''}>📙 Upper Secondary</option>
         </select>
       </div>
       <span class="text-sm text-muted">${filtered.length} marks</span>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Class</th><th>Assessment</th><th>Learner</th><th>Mark</th><th>%</th><th>Grade</th><th>Result</th><th>Remark</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="8">${Utils.empty('No marks found','list-checks')}</td></tr>`}</tbody></table></div></div>`);
}

let _gradingCache = null;
async function getGradingScale() {
  if (!_gradingCache) _gradingCache = await DB.get('grading_scales');
  return _gradingCache;
}