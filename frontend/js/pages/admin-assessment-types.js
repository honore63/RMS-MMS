/* ============================================================
   ADMIN — ASSESSMENT TYPES
   Structured Professional Layout
   ============================================================ */

let assessmentTypesCache = null;
let assessmentTypesSearch = '';
let assessmentTypesCategory = 'all';
let assessmentTypesStatus = 'all';
let typeModalMode = 'add';

const TYPE_ICONS = {
  EOU: 'clipboard-check',
  QUIZ: 'clipboard-list',
  ASSIGNMENT: 'file-text',
  EXAM: 'book-open',
  TEST: 'clipboard-check',
  HOMEWORK: 'book-open',
  PROJECT: 'briefcase',
  PORTFOLIO: 'folder-knee',
  PARTICIPATION: 'users',
  PRACTICE: 'pen-tool',
  DEFAULT: 'tag'
};

const TYPE_COLORS = {
  EOU: '#2563eb',
  QUIZ: '#7c3aed',
  ASSIGNMENT: '#0891b2',
  EXAM: '#dc2626',
  TEST: '#7c3aed',
  HOMEWORK: '#059669',
  PROJECT: '#d97706',
  PORTFOLIO: '#4f46e5',
  PARTICIPATION: '#64748b',
  PRACTICE: '#0891b2',
  DEFAULT: '#6b7280'
};

const TYPE_CATEGORIES = [
  { id: 'all', label: 'All Types', icon: 'layers' },
  { id: 'formative', label: 'Formative', icon: 'pen-tool' },
  { id: 'summative', label: 'Summative', icon: 'scale' },
  { id: 'diagnostic', label: 'Diagnostic', icon: 'search' },
  { id: 'performance', label: 'Performance', icon: 'trending-up' }
];

// strict = true re-throws so the page can render a real error instead of
// silently showing an empty list (which is indistinguishable from "no data").
async function getAssessmentTypes(force = false, strict = false) {
  if (Array.isArray(assessmentTypesCache) && !force) return assessmentTypesCache;
  try {
    assessmentTypesCache = (await DB.get('assessment_types')) || [];
  } catch (e) {
    if (strict) throw e;
    assessmentTypesCache = assessmentTypesCache || [];
  }
  return assessmentTypesCache;
}

function getAssessmentTypeName(types, id, fallback) {
  const t = (types || []).find(x => x.id === id);
  return (t && t.name) || fallback || 'Assessment';
}

function getCategoryForType(type) {
  const code = (type.code || '').toUpperCase();
  if (['EOU', 'QUIZ', 'HOMEWORK', 'PRACTICE'].includes(code)) return 'formative';
  if (['EXAM', 'TEST', 'PROJECT', 'PORTFOLIO'].includes(code)) return 'summative';
  if (code === 'DIAGNOSTIC') return 'diagnostic';
  return 'performance';
}

function getCategoryLabel(catId) {
  const cat = TYPE_CATEGORIES.find(c => c.id === catId);
  return cat ? cat.label : 'All';
}

function categoryIcon(catId) {
  const cat = TYPE_CATEGORIES.find(c => c.id === catId);
  return cat ? cat.icon : 'layers';
}

/* ============================================================
   RENDER
   ============================================================ */

async function renderAssessmentTypes() {
  setHeader('Assessment Types', 'Configure assessment categories and manage the school-wide evaluation structure');
  setContent(Utils.loading());

  try {
    const [types, assessments] = await Promise.all([
      getAssessmentTypes(true, true),
      DB.get('assessments', {}, { select: 'id,assessment_type_id' })
    ]);

    const used = {};
    (assessments || []).forEach(a => {
      if (a.assessment_type_id) used[a.assessment_type_id] = (used[a.assessment_type_id] || 0) + 1;
    });

    const ordered = [...types].sort((a, b) =>
      (a.display_order || 0) - (b.display_order || 0) || a.name.localeCompare(b.name)
    );

    const activeCount = types.filter(t => t.status === 'active').length;
    const combinedCount = types.filter(t => t.contributes_to_combined).length;
    const inUseCount = types.filter(t => used[t.id]).length;
    const totalMax = types.reduce((s, t) => s + (t.default_maximum_mark || 0), 0);

    /* Filter by category and status */
    const filtered = ordered.filter(t => {
      const catMatch = assessmentTypesCategory === 'all' || getCategoryForType(t) === assessmentTypesCategory;
      const searchText = `${t.name || ''} ${t.code || ''} ${t.description || ''}`.toLowerCase();
      const searchMatch = !assessmentTypesSearch || searchText.includes(assessmentTypesSearch.toLowerCase());
      const statusMatch = assessmentTypesStatus === 'all' || t.status === assessmentTypesStatus;
      return catMatch && searchMatch && statusMatch;
    });

    /* Stats */
    const formativeCount = types.filter(t => getCategoryForType(t) === 'formative').length;
    const summativeCount = types.filter(t => getCategoryForType(t) === 'summative').length;
    const diagnosticCount = types.filter(t => getCategoryForType(t) === 'diagnostic').length;
    const performanceCount = types.filter(t => getCategoryForType(t) === 'performance').length;

    setContent(`
      <style>
        /* ---- Page Layout ---- */
        .ats-page { display: grid; gap: 24px; }

        /* ---- Hero Banner ---- */
        .ats-hero {
          background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 50%, #3b82f6 100%);
          border-radius: var(--radius-xl); padding: 32px; color: #fff;
          box-shadow: var(--shadow-lg); position: relative; overflow: hidden;
        }
        .ats-hero::before {
          content: ''; position: absolute; top: -50%; right: -20%; width: 400px; height: 400px;
          background: radial-gradient(circle, rgba(255,255,255,.08) 0%, transparent 70%);
          border-radius: 50%;
        }
        .ats-hero h2 { margin: 0 0 6px; font-size: 24px; font-weight: 700; letter-spacing: -.02em; }
        .ats-hero p { margin: 0; font-size: 14px; opacity: .85; max-width: 540px; line-height: 1.5; }
        .ats-stats-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 16px; margin-top: 28px; }
        .ats-stat {
          background: rgba(255,255,255,.12); backdrop-filter: blur(10px);
          border-radius: var(--radius-lg); padding: 20px; text-align: center;
          border: 1px solid rgba(255,255,255,.1);
        }
        .ats-stat-value { font-size: 32px; font-weight: 800; line-height: 1; }
        .ats-stat-label { font-size: 12px; opacity: .75; margin-top: 6px; text-transform: uppercase; letter-spacing: .05em; }

        /* ---- Category Nav ---- */
        .ats-category-nav {
          display: flex; gap: 8px; flex-wrap: wrap;
          background: #fff; border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg); padding: 12px 16px;
          box-shadow: var(--shadow-sm);
        }
        .ats-cat-btn {
          padding: 8px 16px; border-radius: var(--radius);
          border: 1px solid var(--gray-200); background: #fff;
          color: var(--gray-600); font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all var(--transition);
          font-family: var(--font-sans); display: inline-flex;
          align-items: center; gap: 6px;
        }
        .ats-cat-btn:hover { border-color: var(--blue-300); color: var(--blue-600); background: var(--blue-50); }
        .ats-cat-btn.active { background: var(--blue-600); color: #fff; border-color: var(--blue-600); }
        .ats-cat-btn .cat-count {
          background: rgba(0,0,0,.1); padding: 1px 8px; border-radius: 99px;
          font-size: 11px; font-weight: 700;
        }
        .ats-cat-btn.active .cat-count { background: rgba(255,255,255,.2); }

        /* ---- Toolbar ---- */
        .ats-toolbar {
          display: flex; justify-content: space-between; align-items: center;
          gap: 16px; flex-wrap: wrap;
          background: #fff; border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg); padding: 16px 20px;
          box-shadow: var(--shadow-sm);
        }
        .ats-toolbar-left { display: flex; align-items: center; gap: 12px; flex: 1 1 300px; }
        .ats-search { position: relative; flex: 1 1 280px; }
        .ats-search i { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: var(--gray-400); }
        .ats-search input { width: 100%; padding-left: 42px; }
        .ats-filters { display: flex; gap: 8px; align-items: center; }
        .ats-filter-btn {
          padding: 8px 16px; border-radius: var(--radius);
          border: 1px solid var(--gray-200); background: #fff;
          color: var(--gray-600); font-size: 13px; font-weight: 500;
          cursor: pointer; transition: all var(--transition); font-family: var(--font-sans);
        }
        .ats-filter-btn:hover { border-color: var(--blue-300); color: var(--blue-600); background: var(--blue-50); }
        .ats-filter-btn.active { background: var(--blue-600); color: #fff; border-color: var(--blue-600); }

        /* ---- Section Cards ---- */
        .ats-sections { display: grid; gap: 20px; }
        .ats-section-card {
          background: #fff; border: 1px solid var(--gray-200);
          border-radius: var(--radius-lg); overflow: hidden;
          box-shadow: var(--shadow-sm);
        }
        .ats-section-header {
          display: flex; justify-content: space-between; align-items: center;
          padding: 16px 20px; border-bottom: 1px solid var(--gray-100);
          background: var(--gray-50);
        }
        .ats-section-header h3 { font-size: 15px; font-weight: 600; color: var(--gray-800); margin: 0; }
        .ats-section-header span { font-size: 13px; color: var(--gray-500); }

        /* ---- Type Cards Grid ---- */
        .ats-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; padding: 20px; }
        .ats-card {
          border: 1px solid var(--gray-200); border-radius: var(--radius-lg);
          padding: 20px; transition: all var(--transition); cursor: default;
          position: relative; overflow: hidden;
        }
        .ats-card:hover { border-color: var(--blue-300); box-shadow: 0 4px 16px rgba(37,99,235,.1); transform: translateY(-2px); }
        .ats-card-header { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
        .ats-card-icon {
          width: 48px; height: 48px; border-radius: var(--radius);
          display: grid; place-items: center; font-size: 20px; flex-shrink: 0;
        }
        .ats-card-info { flex: 1; min-width: 0; }
        .ats-card-name { font-size: 15px; font-weight: 700; color: var(--gray-800); margin-bottom: 2px; }
        .ats-card-code { font-size: 12px; color: var(--gray-500); font-weight: 500; text-transform: uppercase; letter-spacing: .05em; }
        .ats-card-body { margin-bottom: 14px; }
        .ats-card-desc { font-size: 13px; color: var(--gray-600); line-height: 1.5; margin-bottom: 10px; }
        .ats-card-meta { display: flex; gap: 12px; font-size: 12px; color: var(--gray-500); }
        .ats-card-meta span { display: inline-flex; align-items: center; gap: 4px; }
        .ats-card-footer { display: flex; justify-content: space-between; align-items: center; padding-top: 14px; border-top: 1px solid var(--gray-100); }

        /* ---- Badges ---- */
        .ats-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600; white-space: nowrap; }
        .ats-badge.success { background: var(--green-50); color: var(--green-700); }
        .ats-badge.warning { background: var(--amber-50); color: var(--amber-700); }
        .ats-badge.neutral { background: var(--gray-100); color: var(--gray-600); }
        .ats-badge.blue { background: var(--blue-50); color: var(--blue-700); }

        /* ---- Action Buttons ---- */
        .ats-action-btn {
          padding: 6px 12px; border-radius: var(--radius-sm);
          border: 1px solid var(--gray-200); background: #fff;
          color: var(--gray-600); font-size: 12px; font-weight: 500;
          cursor: pointer; transition: all var(--transition);
          display: inline-flex; align-items: center; gap: 5px; font-family: var(--font-sans);
        }
        .ats-action-btn:hover { border-color: var(--blue-300); color: var(--blue-600); background: var(--blue-50); }
        .ats-action-btn.primary { background: var(--blue-600); color: #fff; border-color: var(--blue-600); }
        .ats-action-btn.primary:hover { background: var(--blue-700); }
        .ats-action-btn.danger { color: var(--red-600); border-color: var(--red-200); }
        .ats-action-btn.danger:hover { background: var(--red-50); border-color: var(--red-400); }
        .ats-action-btn:disabled { opacity: .5; cursor: not-allowed; }

        /* ---- Add Button ---- */
        .ats-add-btn {
          padding: 8px 20px; border-radius: var(--radius);
          background: var(--blue-600); color: #fff; border: none;
          font-size: 13px; font-weight: 600; cursor: pointer;
          font-family: var(--font-sans); display: inline-flex;
          align-items: center; gap: 6px; transition: all var(--transition);
        }
        .ats-add-btn:hover { background: var(--blue-700); box-shadow: 0 4px 12px rgba(37,99,235,.3); }

        /* ---- Empty State ---- */
        .ats-empty { padding: 60px 20px; text-align: center; color: var(--gray-400); }
        .ats-empty i { margin-bottom: 12px; }
        .ats-empty p { font-size: 14px; margin-top: 8px; }

        /* ---- Table View (compact) ---- */
        .ats-table-wrapper { min-width: 0; background: #fff; border: 1px solid var(--gray-200); border-radius: var(--radius-lg); overflow: hidden; }
        .ats-table-header { display: flex; justify-content: space-between; align-items: center; padding: 16px 20px; border-bottom: 1px solid var(--gray-100); background: var(--gray-50); }
        .ats-table-header h3 { font-size: 15px; font-weight: 600; color: var(--gray-800); margin: 0; }
        .ats-table-header span { font-size: 13px; color: var(--gray-500); }
        .ats-table-scroll { width: 100%; overflow-x: auto; -webkit-overflow-scrolling: touch; }
        .ats-table { width: 100%; min-width: 1080px; table-layout: fixed; border-collapse: collapse; }
        .ats-table thead { background: var(--gray-100); }
        .ats-table th { padding: 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--gray-500); border-bottom: 1px solid var(--gray-200); white-space: nowrap; }
        .ats-table td { padding: 14px 12px; font-size: 14px; border-bottom: 1px solid var(--gray-100); vertical-align: middle; white-space: nowrap; overflow-wrap: normal; word-break: normal; }
        .ats-table .ats-type-cell { overflow: hidden; text-overflow: ellipsis; }
        .ats-table .ats-description-cell { overflow: hidden; text-overflow: ellipsis; }
        .ats-table-actions { display: flex; justify-content: flex-end; align-items: center; gap: 6px; }
        .ats-table .ats-action-btn { width: 36px; height: 36px; padding: 0; flex: 0 0 36px; justify-content: center; }
        .ats-table tbody tr { transition: background var(--transition); }
        .ats-table tbody tr:hover { background: var(--blue-50); }
        .ats-table tbody tr:last-child td { border-bottom: none; }

        /* ---- Footer ---- */
        .ats-footer { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; border-top: 1px solid var(--gray-100); background: var(--gray-50); font-size: 13px; color: var(--gray-500); }

        /* ---- Modal ---- */
        .ats-modal .modal-content { max-width: 560px; width: 90%; border-radius: var(--radius-xl); overflow: hidden; }
        .ats-modal-header { background: linear-gradient(135deg, var(--blue-600), var(--blue-700)); padding: 24px; color: #fff; }
        .ats-modal-header h3 { font-size: 18px; font-weight: 700; margin: 0 0 4px; }
        .ats-modal-header p { font-size: 13px; opacity: .8; margin: 0; }
        .ats-modal-body { padding: 24px; }
        .ats-form-group { margin-bottom: 20px; }
        .ats-form-group label { display: block; font-size: 13px; font-weight: 600; color: var(--gray-700); margin-bottom: 6px; }
        .ats-form-group label .req { color: var(--red-500); }
        .ats-form-group input, .ats-form-group select, .ats-form-group textarea {
          width: 100%; padding: 10px 14px; border: 1px solid var(--gray-200); border-radius: var(--radius);
          font-size: 14px; font-family: var(--font-sans); color: var(--gray-800);
          transition: border-color var(--transition); background: #fff;
        }
        .ats-form-group input:focus, .ats-form-group select:focus, .ats-form-group textarea:focus {
          outline: none; border-color: var(--blue-500); box-shadow: 0 0 0 3px rgba(59,130,246,.1);
        }
        .ats-form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .ats-form-actions { display: flex; justify-content: flex-end; gap: 12px; padding-top: 8px; }
        .ats-btn { padding: 10px 24px; border-radius: var(--radius); border: none; font-size: 14px; font-weight: 600; cursor: pointer; font-family: var(--font-sans); transition: all var(--transition); }
        .ats-btn.secondary { background: var(--gray-100); color: var(--gray-600); }
        .ats-btn.secondary:hover { background: var(--gray-200); }
        .ats-btn.primary { background: var(--blue-600); color: #fff; }
        .ats-btn.primary:hover { background: var(--blue-700); }
        .ats-btn:disabled { opacity: .6; cursor: not-allowed; }
        .ats-form-hint { font-size: 12px; color: var(--gray-400); margin-top: 4px; }
        .ats-checkbox-label { display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; }

        /* ---- Confirm Modal ---- */
        .ats-confirm-body { padding: 24px; text-align: center; }
        .ats-confirm-body .confirm-icon { width: 64px; height: 64px; border-radius: 50%; background: var(--red-50); color: var(--red-500); display: grid; place-items: center; margin: 0 auto 16px; }
        .ats-confirm-body h4 { font-size: 16px; color: var(--gray-800); margin: 0 0 8px; }
        .ats-confirm-body p { font-size: 14px; color: var(--gray-500); margin: 0 0 24px; }

        /* ---- Responsive ---- */
        @media (max-width: 768px) {
          .ats-hero { padding: 20px; }
          .ats-hero h2 { font-size: 20px; }
          .ats-stats-row { grid-template-columns: repeat(2, 1fr); gap: 12px; }
          .ats-category-nav { flex-direction: column; }
          .ats-toolbar { flex-direction: column; align-items: stretch; }
          .ats-toolbar-left { flex-direction: column; }
          .ats-cards { grid-template-columns: 1fr; }
          .ats-form-row { grid-template-columns: 1fr; }
        }
        @media (max-width: 480px) {
          .ats-stats-row { grid-template-columns: 1fr 1fr; }
          .ats-cards { grid-template-columns: 1fr; padding: 12px; }
          .ats-card { padding: 14px; }
        }
      </style>

      <div class="ats-page">
        <!-- Hero Banner -->
        <div class="ats-hero">
          <h2>Assessment Catalogue</h2>
          <p>Define assessment categories used in mark entry, reporting, and combined results across the school.</p>
          <div class="ats-stats-row">
            <div class="ats-stat"><div class="ats-stat-value">${types.length}</div><div class="ats-stat-label">Total Types</div></div>
            <div class="ats-stat"><div class="ats-stat-value">${activeCount}</div><div class="ats-stat-label">Active</div></div>
            <div class="ats-stat"><div class="ats-stat-value">${combinedCount}</div><div class="ats-stat-label">In Combined</div></div>
            <div class="ats-stat"><div class="ats-stat-value">${inUseCount}</div><div class="ats-stat-label">In Use</div></div>
          </div>
        </div>

        <!-- Category Navigation -->
        <div class="ats-category-nav">
          ${TYPE_CATEGORIES.map(c => `
            <button class="ats-cat-btn ${assessmentTypesCategory === c.id ? 'active' : ''}" data-category="${c.id}">
              <i data-lucide="${c.icon}"></i> ${c.label}
              <span class="cat-count">${types.filter(t => assessmentTypesCategory === 'all' || getCategoryForType(t) === c.id).length}</span>
            </button>
          `).join('')}
        </div>

        <!-- Toolbar -->
        <div class="ats-toolbar">
          <div class="ats-toolbar-left">
            <div class="ats-search">
              <i data-lucide="search"></i>
              <input id="ats-search" type="search" placeholder="Search by name, code, or description..." value="${Utils.escapeHtml(assessmentTypesSearch)}">
            </div>
            <div class="ats-filters">
              <button class="ats-filter-btn ${assessmentTypesStatus === 'all' ? 'active' : ''}" data-status="all">All</button>
              <button class="ats-filter-btn ${assessmentTypesStatus === 'active' ? 'active' : ''}" data-status="active">Active</button>
              <button class="ats-filter-btn ${assessmentTypesStatus === 'inactive' ? 'active' : ''}" data-status="inactive">Inactive</button>
            </div>
          </div>
          <button class="ats-add-btn" id="ats-add-btn"><i data-lucide="plus"></i> Add Type</button>
        </div>

        <!-- Type Cards -->
        <div class="ats-sections">
          ${filtered.length === 0 ? `
            <div class="ats-section-card">
              <div class="ats-empty">
                <i data-lucide="inbox"></i>
                <p>No assessment types match your filters</p>
              </div>
            </div>
          ` : `
          <div class="ats-section-card">
            <div class="ats-section-header">
              <h3>${getCategoryLabel(assessmentTypesCategory)} Assessment Types</h3>
              <span>${filtered.length} of ${types.length} shown</span>
            </div>
            <div class="ats-cards">
              ${filtered.map(t => {
                const isActive = t.status === 'active';
                const usedCount = used[t.id] || 0;
                const color = TYPE_COLORS[t.code?.toUpperCase()] || '#6b7280';
                const icon = TYPE_ICONS[t.code?.toUpperCase()] || 'tag';
                const cat = getCategoryForType(t);
                return `
                <div class="ats-card">
                  <div class="ats-card-header">
                    <div class="ats-card-icon" style="background: ${color}20; color: ${color};"><i data-lucide="${icon}"></i></div>
                    <div class="ats-card-info">
                      <div class="ats-card-name">${Utils.escapeHtml(t.name)}</div>
                      <div class="ats-card-code">${Utils.escapeHtml(t.code || '—')}</div>
                    </div>
                  </div>
                  <div class="ats-card-body">
                    <div class="ats-card-desc">${Utils.escapeHtml(t.description || 'No description provided.')}</div>
                    <div class="ats-card-meta">
                      <span><i data-lucide="scale"></i> ${t.default_maximum_mark ?? '—'} max</span>
                      <span><i data-lucide="trending-up"></i> Weight ${t.weight ?? '—'}</span>
                      <span><i data-lucide="folder"></i> ${usedCount} in use</span>
                    </div>
                  </div>
                  <div class="ats-card-footer">
                    <span class="ats-badge ${isActive ? 'success' : 'neutral'}">${isActive ? 'Active' : 'Inactive'}</span>
                    <div style="display:flex;gap:6px;">
                      <button class="ats-action-btn" onclick="openTypeModal('${t.id}')" title="Edit"><i data-lucide="pencil"></i></button>
                      ${isActive
                        ? `<button class="ats-action-btn" onclick="toggleTypeStatus('${t.id}','inactive')" title="Deactivate" style="color:var(--amber-600);border-color:var(--amber-200)"><i data-lucide="pause"></i></button>`
                        : `<button class="ats-action-btn" onclick="toggleTypeStatus('${t.id}','active')" title="Activate" style="color:var(--green-600);border-color:var(--green-200)"><i data-lucide="play"></i></button>`
                      }
                      ${usedCount > 0
                        ? `<button class="ats-action-btn" disabled title="In use"><i data-lucide="lock"></i></button>`
                        : `<button class="ats-action-btn danger" onclick="confirmDeleteType('${t.id}')" title="Delete"><i data-lucide="trash-2"></i></button>`
                      }
                    </div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>
          `}
        </div>

        <!-- Table View (below cards for larger screens) -->
        <div class="ats-table-wrapper">
          <div class="ats-table-header">
            <h3>Detailed View</h3>
            <span>Full listing</span>
          </div>
          <div class="ats-table-scroll">
          <table class="ats-table">
            <colgroup>
              <col style="width:16%"><col style="width:10%"><col style="width:21%">
              <col style="width:8%"><col style="width:7%"><col style="width:10%">
              <col style="width:7%"><col style="width:9%"><col style="width:12%">
            </colgroup>
            <thead>
              <tr>
                <th>Type</th>
                <th>Category</th>
                <th>Description</th>
                <th style="text-align:center">Default Max</th>
                <th style="text-align:center">Weight</th>
                <th style="text-align:center">Combined</th>
                <th style="text-align:center">In Use</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(t => {
                const isActive = t.status === 'active';
                const usedCount = used[t.id] || 0;
                const catLabel = getCategoryForType(t).charAt(0).toUpperCase() + getCategoryForType(t).slice(1);
                return `<tr>
                  <td class="ats-type-cell">
                    <div style="display:flex;align-items:center;gap:10px;">
                      <div style="width:32px;height:32px;border-radius:var(--radius);display:grid;place-items:center;font-size:14px;background:${TYPE_COLORS[t.code?.toUpperCase()] || '#6b7280'}20;color:${TYPE_COLORS[t.code?.toUpperCase()] || '#6b7280'}"><i data-lucide="${TYPE_ICONS[t.code?.toUpperCase()] || 'tag'}"></i></div>
                      <strong>${Utils.escapeHtml(t.name)}</strong>
                    </div>
                  </td>
                  <td><span class="ats-badge neutral">${catLabel}</span></td>
                  <td class="ats-description-cell" title="${Utils.escapeHtml(t.description || '—')}" style="font-size:13px;color:var(--gray-600)">${Utils.escapeHtml(t.description || '—')}</td>
                  <td style="text-align:center"><strong>${t.default_maximum_mark ?? '—'}</strong></td>
                  <td style="text-align:center">${t.weight ?? '—'}</td>
                  <td style="text-align:center">${t.contributes_to_combined ? '<span class="ats-badge success">Yes</span>' : '<span class="ats-badge neutral">No</span>'}</td>
                  <td style="text-align:center"><strong>${usedCount}</strong></td>
                  <td><span class="ats-badge ${isActive ? 'success' : 'neutral'}">${isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div class="ats-table-actions">
                    <button class="ats-action-btn" onclick="openTypeModal('${t.id}')" title="Edit" aria-label="Edit assessment type"><i data-lucide="pencil"></i></button>
                    ${isActive
                      ? `<button class="ats-action-btn" onclick="toggleTypeStatus('${t.id}','inactive')" title="Deactivate" aria-label="Deactivate assessment type" style="color:var(--amber-600);border-color:var(--amber-200)"><i data-lucide="pause"></i></button>`
                      : `<button class="ats-action-btn" onclick="toggleTypeStatus('${t.id}','active')" title="Activate" aria-label="Activate assessment type" style="color:var(--green-600);border-color:var(--green-200)"><i data-lucide="play"></i></button>`
                    }
                    ${usedCount > 0
                      ? `<button class="ats-action-btn" disabled title="In use" aria-label="Cannot delete: assessment type is in use"><i data-lucide="lock"></i></button>`
                      : `<button class="ats-action-btn danger" onclick="confirmDeleteType('${t.id}')" title="Delete" aria-label="Delete assessment type"><i data-lucide="trash-2"></i></button>`
                    }
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
          </div>
          <div class="ats-footer">
            <span>Showing ${filtered.length} of ${types.length} assessment types</span>
            <span>Total max marks: ${totalMax}</span>
          </div>
        </div>
      </div>
    `);

    // Event listeners
    document.getElementById('ats-search')?.addEventListener('input', event => {
      assessmentTypesSearch = event.target.value.trim();
      renderAssessmentTypes();
    });
    document.querySelectorAll('[data-status]').forEach(btn => {
      btn.addEventListener('click', () => {
        assessmentTypesStatus = btn.dataset.status;
        renderAssessmentTypes();
      });
    });
    document.querySelectorAll('[data-category]').forEach(btn => {
      btn.addEventListener('click', () => {
        assessmentTypesCategory = btn.dataset.category;
        renderAssessmentTypes();
      });
    });
    document.getElementById('ats-add-btn')?.addEventListener('click', () => openTypeModal());
    if (typeof lucide !== 'undefined') lucide.createIcons();
  } catch (error) {
    setContent(`
      <div class="ats-page">
        <div class="ats-hero" style="background:var(--red-50);color:var(--red-700)">
          <h2>Error Loading Assessment Types</h2>
          <p>${Utils.escapeHtml(error.message || 'Could not load assessment types from the database.')}</p>
        </div>
        <div style="text-align:center;padding:60px 20px;color:var(--gray-500)">
          <i data-lucide="alert-circle" style="width:48px;height:48px;margin-bottom:12px"></i>
          <p>Make sure the database migration has been run. Check the server console for details.</p>
        </div>
      </div>
    `);
  }
}

/* ============================================================
   MODAL — Add / Edit
   ============================================================ */

async function openTypeModal(id) {
  typeModalMode = id ? 'edit' : 'add';
  const [types, assessments] = await Promise.all([getAssessmentTypes(true), DB.get('assessments').catch(() => [])]);
  const t = id ? types.find(x => x.id === id) : null;
  const used = {};
  (assessments || []).forEach(a => { if (a.assessment_type_id) used[a.assessment_type_id] = (used[a.assessment_type_id] || 0) + 1; });

  const weightHelp = t && t.weight != null
    ? `Overrides the type weight (default: ${t.weight}).`
    : 'Optional. Combined reports use the weighted average.';

  const modalBody = typeModalMode === 'add' ? `
    <div class="ats-form-group"><label>Type Name <span class="req">*</span></label><input id="atf-name" placeholder="e.g., End-of-Unit Assessment"></div>
    <div class="ats-form-row">
      <div class="ats-form-group"><label>Code <span class="req">*</span></label><input id="atf-code" placeholder="e.g., EOU" style="text-transform:uppercase"></div>
      <div class="ats-form-group"><label>Default Max Mark</label><input id="atf-max" type="number" min="1" value="30"></div>
    </div>
    <div class="ats-form-group"><label>Description</label><textarea id="atf-desc" rows="3" placeholder="Short description of this category" style="resize:vertical"></textarea></div>
    <div class="ats-form-row">
      <div class="ats-form-group"><label>Weight (optional)</label><input id="atf-weight" type="number" min="0" step="any" placeholder="blank = unweighted"></div>
      <div class="ats-form-group"><label>Status</label><select id="atf-status"><option value="active">Active</option><option value="inactive">Inactive</option></select></div>
    </div>
    <div class="ats-form-group"><label class="ats-checkbox-label"><input type="checkbox" id="atf-combined" checked> Include in combined reports</label></div>
    <p class="ats-form-hint">${weightHelp}</p>
  ` : `
    <div class="ats-form-group"><label>Type Name <span class="req">*</span></label><input id="atf-name" value="${Utils.escapeHtml(t?.name || '')}" placeholder="e.g., End-of-Unit Assessment"></div>
    <div class="ats-form-row">
      <div class="ats-form-group"><label>Code <span class="req">*</span></label><input id="atf-code" value="${Utils.escapeHtml(t?.code || '')}" placeholder="e.g., EOU" style="text-transform:uppercase"></div>
      <div class="ats-form-group"><label>Default Max Mark</label><input id="atf-max" type="number" min="1" value="${t?.default_maximum_mark ?? 30}"></div>
    </div>
    <div class="ats-form-group"><label>Description</label><textarea id="atf-desc" rows="3" placeholder="Short description" style="resize:vertical">${Utils.escapeHtml(t?.description || '')}</textarea></div>
    <div class="ats-form-row">
      <div class="ats-form-group"><label>Weight (optional)</label><input id="atf-weight" type="number" min="0" step="any" value="${t?.weight != null ? t.weight : ''}" placeholder="blank = unweighted"></div>
      <div class="ats-form-group"><label>Status</label><select id="atf-status"><option value="active" ${t?.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${t?.status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
    </div>
    <div class="ats-form-group"><label class="ats-checkbox-label"><input type="checkbox" id="atf-combined" ${t?.contributes_to_combined !== false ? 'checked' : ''}> Include in combined reports</label></div>
    <p class="ats-form-hint">${weightHelp}</p>
    ${t && used[t.id] ? `<div style="background:var(--amber-50);border:1px solid var(--amber-200);border-radius:var(--radius);padding:12px;font-size:13px;color:var(--amber-700)"><i data-lucide="alert-triangle"></i> <strong>${used[t.id]} assessment(s)</strong> currently use this type.</div>` : ''}
  `;

  const modalFooter = `<div class="ats-form-actions">
    <button class="ats-btn secondary" onclick="Modal.close()">Cancel</button>
    <button class="ats-btn primary" id="at-save-btn"><i data-lucide="save"></i> ${typeModalMode === 'add' ? 'Create Type' : 'Save Changes'}</button>
  </div>`;

  Modal.show('', `
    <div class="ats-modal-header">
      <h3>${typeModalMode === 'add' ? 'Add Assessment Type' : 'Edit ' + Utils.escapeHtml(t?.name || 'Assessment Type')}</h3>
      <p>${typeModalMode === 'add' ? 'Create a new assessment category' : 'Modify the assessment type settings'}</p>
    </div>
    <div class="ats-modal-body">${modalBody}</div>
    ${modalFooter}
  `, null);

  document.getElementById('at-save-btn')?.addEventListener('click', () => saveType(id));
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function saveType(id) {
  const name = document.getElementById('atf-name').value.trim();
  const code = document.getElementById('atf-code').value.trim().toUpperCase();
  const d = {
    name, code,
    description: document.getElementById('atf-desc').value.trim() || null,
    default_maximum_mark: parseFloat(document.getElementById('atf-max').value) || 30,
    weight: document.getElementById('atf-weight').value.trim() === '' ? null : parseFloat(document.getElementById('atf-weight').value),
    contributes_to_combined: document.getElementById('atf-combined').checked,
    status: document.getElementById('atf-status').value
  };
  if (!d.name || !d.code) return Utils.toast('Name and code are required', 'error');

  const btn = document.getElementById('at-save-btn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader" style="width:16px;height:16px;animation:spin 1s linear infinite"></i> Saving...'; }
  try {
    if (id) { await DB.update('assessment_types', id, d); Utils.toast('Assessment type updated', 'success'); }
    else { await DB.insert('assessment_types', d); Utils.toast('Assessment type created', 'success'); }
    assessmentTypesCache = null;
    Modal.close();
    renderAssessmentTypes();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = typeModalMode === 'add' ? '<i data-lucide="plus"></i> Create Type' : '<i data-lucide="save"></i> Save Changes'; if (typeof lucide !== 'undefined') lucide.createIcons(); }
    Utils.toast('Error: ' + (e.message || 'Could not save'), 'error');
  }
}

async function toggleTypeStatus(id, status) {
  try {
    await DB.update('assessment_types', id, { status });
    assessmentTypesCache = null;
    Utils.toast('Type ' + (status === 'active' ? 'activated' : 'deactivated'), 'success');
    renderAssessmentTypes();
  } catch (e) { Utils.toast('Error: ' + (e.message || 'Could not update'), 'error'); }
}

async function confirmDeleteType(id) {
  const [types] = await Promise.all([getAssessmentTypes(true), DB.get('assessments').catch(() => [])]);
  const t = types.find(x => x.id === id);
  if (!t) return;

  Modal.show('', `
    <div class="ats-confirm-body">
      <div class="confirm-icon"><i data-lucide="alert-triangle" style="width:32px;height:32px"></i></div>
      <h4>Delete "${Utils.escapeHtml(t.name)}"?</h4>
      <p>This cannot be undone. Any assessments using this type will keep working without it.</p>
      <div style="display:flex;justify-content:center;gap:12px">
        <button class="ats-btn secondary" onclick="Modal.close()">Cancel</button>
        <button class="ats-btn" style="background:var(--red-500);color:#fff" onclick="deleteType('${id}')">Delete</button>
      </div>
    </div>
  `, null);
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function deleteType(id) {
  try {
    await DB.remove('assessment_types', id);
    assessmentTypesCache = null;
    Modal.close();
    Utils.toast('Assessment type deleted', 'success');
    renderAssessmentTypes();
  } catch (e) {
    Modal.close();
    Utils.toast('Delete failed: ' + (e.message || 'Type may be in use; deactivate instead'), 'error');
  }
}
