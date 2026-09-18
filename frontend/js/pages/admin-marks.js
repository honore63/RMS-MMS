let marksAssessFilter = 'all';
async function renderAdminMarks() {
  setHeader('View All Marks', 'Review and manage all entered marks');
  setContent(Utils.loading());
  const [marks, assessments] = await Promise.all([
    DB.query('marks','*',{},{column:'created_at',asc:false}),
    DB.get('assessments')
  ]);
  const filtered = marksAssessFilter === 'all' ? marks : marks.filter(m => m.assessment_id === marksAssessFilter);
  let rows = '';
  for (const m of filtered) {
    const a = assessments.find(a => a.id === m.assessment_id);
    const l = m.learner_id ? (await DB.getRelated('learners','*',{id:m.learner_id}))[0] : null;
    const pct = m.percentage || (m.mark != null ? Utils.pct(m.mark, a?.maximum_mark || 30) : 0);
    const grade = m.grade || Utils.grade(pct, await getGradingScale());
    const pf = Utils.passFail(pct);
    rows += `<tr>
      <td class="col-name">${Utils.escapeHtml(a?.name||'-')}</td>
      <td>${Utils.escapeHtml(l?.full_name||'-')}</td>
      <td>${m.mark != null ? m.mark + '/' + (a?.maximum_mark||30) : '-'}</td>
      <td class="font-semibold">${pct}%</td>
      <td><span class="badge badge-info">${grade}</span></td>
      <td><span class="badge ${pf==='PASS'?'badge-success':'badge-danger'}">${pf}</span></td>
      <td>${Utils.escapeHtml(m.remark||'-')}</td></tr>`;
  }

  setContent(`
    <div class="flex justify-between items-center mb-6" style="flex-wrap:wrap;gap:12px">
      <select class="select-field" style="max-width:400px" onchange="marksAssessFilter=this.value;renderAdminMarks()">
        <option value="all">All Assessments</option>
        ${assessments.map(a=>`<option value="${a.id}" ${marksAssessFilter===a.id?'selected':''}>${a.name}</option>`).join('')}
      </select>
      <span class="text-sm text-muted">${filtered.length} marks</span>
      <button class="btn btn-primary" onclick="MarksImport.open()"><i data-lucide="file-up"></i> Import Marks</button>
    </div>
    <div class="card"><div class="table-container"><table class="data-table">
      <thead><tr><th>Assessment</th><th>Learner</th><th>Mark</th><th>%</th><th>Grade</th><th>Status</th><th>Remark</th></tr></thead>
      <tbody>${rows||`<tr><td colspan="7">${Utils.empty('No marks found','list-checks')}</td></tr>`}</tbody></table></div></div>`);
}

let _gradingCache = null;
async function getGradingScale() {
  if (!_gradingCache) _gradingCache = await DB.get('grading_scales');
  return _gradingCache;
}
