const Modal = {
  show(title, body, footer = '', wide = false) {
    document.getElementById('modal-root').innerHTML = `
      <div class="modal-overlay" onclick="if(event.target===this)Modal.close()">
        <div class="modal ${wide ? 'modal-wide' : ''}">
          <div class="modal-header">${title}</div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
        </div>
      </div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  confirm(title, message, onConfirm) {
    window._pendingModalConfirm = onConfirm;
    this.show(title, `<p style="color:var(--gray-600)">${message}</p>`,
      `<button class="btn btn-secondary" onclick="Modal.close()">Cancel</button>
       <button class="btn btn-primary" onclick="Modal.handleConfirm()">
         <i data-lucide="check" style="width:16px;height:16px"></i> Confirm</button>`);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  async handleConfirm() {
    const fn = window._pendingModalConfirm;
    window._pendingModalConfirm = null;
    this.close();
    if (typeof fn === 'function') {
      await fn();
    } else if (typeof fn === 'string') {
      const exec = new Function(`return ${fn}`);
      const res = exec();
      if (typeof res === 'function') await res();
    }
  },

  close() {
    document.getElementById('modal-root').innerHTML = '';
  }
};

function setHeader(title, subtitle = '') {
  const hasYearCtx = typeof getActiveYearId === 'function' && typeof ensureHeaderYears === 'function';
  const isDos = typeof Auth !== 'undefined' && Auth.currentUser && Auth.currentUser.role === 'dos';
  const yearSelHtml = hasYearCtx && isDos ? headerYearSelector() : '';
  document.getElementById('app-header').innerHTML = `
    <button class="sidebar-toggle-btn" id="sidebar-toggle" onclick="Sidebar.toggle()" aria-controls="sidebar">
      <i data-lucide="menu"></i>
    </button>
    <div class="header-left">
      <div>
        <h1>${title}</h1>
        ${subtitle ? `<p>${subtitle}</p>` : ''}
      </div>
    </div>
    ${yearSelHtml}`;
  if (typeof Sidebar !== 'undefined') Sidebar.updateToggleBtn();
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function headerYearSelector() {
  const years = ensureHeaderYears() || [];
  if (!years.length) return '';
  const activeId = getActiveYearId(years) || '';
  return `<div class="header-year-wrap" style="margin-left:auto;display:flex;align-items:center;gap:8px;padding-right:8px">
    <span style="color:var(--gray-500);font-size:12px">Academic Year</span>
    <select class="select-field" id="header-year" style="width:auto;min-width:160px" onchange="setActiveYearId(this.value)">
      ${years.map(y => `<option value="${y.id}" ${y.id === activeId ? 'selected' : ''}>${typeof Utils !== 'undefined' ? Utils.escapeHtml(y.name) : y.name}${y.status === 'active' && y.is_current ? ' (Current)' : ''}</option>`).join('')}
    </select>
  </div>`;
}

function setContent(html) {
  document.getElementById('main-content').innerHTML = html;
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
