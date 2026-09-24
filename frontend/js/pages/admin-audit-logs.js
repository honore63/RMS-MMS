let auditLogsSearch = '';
let auditLogsAction = 'all';

function auditLogDate(value) {
  if (!value) return 'Unknown time';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
}

async function renderAuditLogs() {
  setHeader('Audit Logs', 'Track important changes and activity across the system');
  setContent(Utils.loading());

  let logs;
  try {
    logs = await DB.query('audit_logs', 'id,user_id,user_name,role,action,assessment_id,learner_id,old_value,new_value,timestamp', {}, { column: 'timestamp', asc: false }, 500, { cache: false });
  } catch (e) {
    setContent(`<div class="alert alert-danger"><strong>Audit logs could not be loaded.</strong><br>${Utils.escapeHtml(e.message || 'Database request failed')}</div>`);
    return;
  }

  const actions = [...new Set((logs || []).map(log => log.action).filter(Boolean))].sort();
  const filtered = (logs || []).filter(log => {
    const text = `${log.user_name || ''} ${log.role || ''} ${log.action || ''} ${log.new_value || ''} ${log.old_value || ''}`.toLowerCase();
    return (!auditLogsSearch || text.includes(auditLogsSearch.toLowerCase()))
      && (auditLogsAction === 'all' || log.action === auditLogsAction);
  });

  const rows = filtered.map(log => `
    <tr>
      <td><strong>${Utils.escapeHtml(log.user_name || 'System')}</strong><small>${Utils.escapeHtml(log.role || 'system')}</small></td>
      <td><span class="audit-action">${Utils.escapeHtml(log.action || 'unknown')}</span></td>
      <td class="audit-details">${Utils.escapeHtml(log.new_value || log.old_value || 'No details recorded')}</td>
      <td class="audit-time">${Utils.escapeHtml(auditLogDate(log.timestamp))}</td>
    </tr>`).join('');

  setContent(`
    <style>
      .audit-page { display:grid; gap:18px; }
      .audit-hero { display:flex; justify-content:space-between; align-items:flex-start; gap:18px; padding:22px; border:1px solid var(--gray-200); border-radius:var(--radius-lg); background:linear-gradient(135deg,#fff 0%,#f8fbff 100%); box-shadow:var(--shadow-sm); }
      .audit-hero h2 { margin:0 0 5px; font-size:20px; color:var(--gray-900); }
      .audit-hero p { margin:0; color:var(--gray-600); font-size:13px; }
      .audit-toolbar { display:flex; justify-content:space-between; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 16px; border-bottom:1px solid var(--gray-200); }
      .audit-filters { display:flex; align-items:center; gap:10px; flex:1 1 460px; }
      .audit-search { position:relative; flex:1 1 280px; }
      .audit-search i { position:absolute; left:12px; top:50%; width:16px; transform:translateY(-50%); color:var(--gray-400); }
      .audit-search input { padding-left:36px; }
      .audit-table .data-table { min-width:760px; }
      .audit-table td small { display:block; margin-top:3px; color:var(--gray-500); font-size:11px; text-transform:capitalize; }
      .audit-action { display:inline-flex; padding:5px 9px; border-radius:999px; background:var(--blue-50); color:var(--blue-700); font-size:11px; font-weight:700; }
      .audit-details { max-width:420px; color:var(--gray-600); font-size:12px; }
      .audit-time { white-space:nowrap; color:var(--gray-500); font-size:12px; }
      @media (max-width:760px) { .audit-hero { flex-direction:column; padding:18px; } .audit-filters { flex-direction:column; align-items:stretch; } .audit-filters > * { width:100%; } }
    </style>
    <div class="audit-page">
      <section class="audit-hero">
        <div><h2>System activity</h2><p>Review who changed records, what happened, and when it happened.</p></div>
        <span class="badge badge-info"><i data-lucide="history"></i> ${filtered.length} events</span>
      </section>
      <section class="card audit-table">
        <div class="audit-toolbar">
          <div><strong>Activity history</strong><div class="text-xs text-muted">Showing ${filtered.length} of ${(logs || []).length} recorded events</div></div>
          <div class="audit-filters">
            <div class="audit-search"><i data-lucide="search"></i><input id="audit-search" class="input-field" placeholder="Search user, action or details" value="${Utils.escapeHtml(auditLogsSearch)}"></div>
            <select id="audit-action" class="select-field"><option value="all">All actions</option>${actions.map(action => `<option value="${Utils.escapeHtml(action)}" ${auditLogsAction === action ? 'selected' : ''}>${Utils.escapeHtml(action)}</option>`).join('')}</select>
          </div>
        </div>
        <div class="table-container"><table class="data-table"><thead><tr><th>User</th><th>Action</th><th>Details</th><th>Time</th></tr></thead><tbody>${rows || `<tr><td colspan="4">${Utils.empty('No audit activity found', 'history')}</td></tr>`}</tbody></table></div>
      </section>
    </div>`);

  document.getElementById('audit-search')?.addEventListener('input', event => {
    auditLogsSearch = event.target.value.trim();
    renderAuditLogs();
  });
  document.getElementById('audit-action')?.addEventListener('change', event => {
    auditLogsAction = event.target.value;
    renderAuditLogs();
  });
  if (typeof lucide !== 'undefined') lucide.createIcons();
}