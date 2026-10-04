/* selection.js – shared smart-selection chip helpers (report wizard pickers).
   Renders currently selected items as removable chips so users can see and
   clear their whole selection at once. No framework, no Utils dependency. */
window.SelectionChips = (function(){
  function esc(v){
    return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch){
      return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch];
    });
  }

  /* items: array of { label, onRemove (JS expression string), title? } */
  function render(items, opts){
    opts = opts || {};
    if (!items || !items.length) {
      return '<div class="rw-chips rw-chips-empty"><span class="rw-chip rw-chip-none">' + esc(opts.emptyLabel || 'Nothing selected yet') + '</span></div>';
    }
    const shown = items.slice(0, opts.limit || 40);
    let html = '<div class="rw-chips">';
    shown.forEach(function(it){
      const title = it.title ? ' title="' + esc(it.title) + '"' : '';
      html += '<span class="rw-chip"' + title + '><span class="rw-chip-label">' + esc(it.label) + '</span>'
            + '<button type="button" class="rw-chip-x" onclick="' + esc(it.onRemove) + '" aria-label="Remove">\u00d7</button></span>';
    });
    html += '</div>';
    if (items.length > shown.length) {
      html += '<div class="rw-chips-more">+' + String(items.length - shown.length) + ' more selected</div>';
    }
    return html;
  }

  /* Build chips for a wizard selection array from a lookup list. */
  function fromIds(key, ids, list, labelFn, titleFn){
    const items = (ids || []).map(function(id){
      const found = (list || []).find(function(x){ return String(x.id) === String(id); });
      return {
        label: found ? labelFn(found) : ('#' + String(id).slice(0, 8)),
        title: found && titleFn ? titleFn(found) : '',
        onRemove: "ReportWizard.removeOne('" + String(key) + "','" + String(id) + "')"
      };
    });
    return items;
  }

  return { esc: esc, render: render, fromIds: fromIds };
})();