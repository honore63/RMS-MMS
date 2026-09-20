const RMSCharts = {
  esc(v) {
    return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  round(v, d = 1) {
    if (v == null || isNaN(v)) return '';
    const p = Math.pow(10, d);
    return Math.round(Number(v) * p) / p;
  },

  fmtPct(v) {
    return v == null || isNaN(v) ? 'N/A' : this.round(v, 1) + '%';
  },

  niceMax(max) {
    if (!max || max <= 0) return 100;
    const step = [10, 20, 25, 50, 100].find(s => max <= s) || 100;
    return Math.ceil(max / step) * step;
  },

  defaultColors() {
    return ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d', '#ea580c', '#4f46e5', '#0d9488', '#b91c1c'];
  },

  mount(container, svg, opts = {}) {
    if (!container) return;
    container.innerHTML = `<div class="rms-chart">${svg}</div>`;
    const root = container.querySelector('.rms-chart');

    if (opts.onClick) {
      root.addEventListener('click', (e) => {
        const hit = e.target.closest('[data-idx]');
        if (!hit) return;
        const idx = Number(hit.getAttribute('data-idx'));
        const item = opts.items && opts.items[idx];
        opts.onClick(idx, item);
      });
    }

    root.addEventListener('mousemove', (e) => {
      const hit = e.target.closest('[data-tip]');
      if (!hit) return;
      this._showTip(hit.getAttribute('data-tip'), e);
    });
    root.addEventListener('mouseleave', () => this._hideTip());
  },

  empty(container, message) {
    if (!container) return;
    container.innerHTML = `<div class="rms-empty"><i data-lucide="bar-chart-3"></i><span>${this.esc(message || 'No data available for the selected filters.')}</span></div>`;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  },

  _tipEl() {
    let t = document.getElementById('rms-chart-tip');
    if (!t) {
      t = document.createElement('div');
      t.id = 'rms-chart-tip';
      t.className = 'rms-chart-tip';
      t.setAttribute('role', 'tooltip');
      document.body.appendChild(t);
    }
    return t;
  },

  _showTip(html, e) {
    const t = this._tipEl();
    t.innerHTML = html;
    t.style.display = 'block';
    const pad = 14;
    let x = e.clientX + pad;
    let y = e.clientY + pad;
    const r = t.getBoundingClientRect();
    if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
    t.style.left = x + 'px';
    t.style.top = y + 'px';
  },

  _hideTip() {
    const t = document.getElementById('rms-chart-tip');
    if (t) t.style.display = 'none';
  },

  _gridY(n, max) {
    const out = [];
    for (let i = 0; i <= n; i++) out.push((max / n) * i);
    return out;
  },

  barChart(container, opts) {
    const items = (opts.items || []).filter(x => x && x.label != null);
    if (!items.length) return this.empty(container, opts.emptyMessage);

    const W = opts.width || 560;
    const H = opts.height || 260;
    const padL = opts.padLeft != null ? opts.padLeft : 46;
    const padR = 14;
    const padT = 18;
    const padB = opts.padBottom != null ? opts.padBottom : 44;
    const max = this.niceMax(Math.max(...items.map(x => Number(x.value) || 0)) * 1.05);
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const colors = opts.colors || this.defaultColors();
    const skip = opts.keepBarsLeft ? false : true;

    let grid = '';
    this._gridY(5, max).forEach((val, i) => {
      const y = padT + chartH - (chartH * val) / max;
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="1"></line>`;
      grid += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${Math.round(val)}%</text>`;
    });

    const slot = chartW / items.length;
    const barW = Math.min(46, slot * 0.6);
    let bars = '';
    items.forEach((it, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const h = (Number(it.value) || 0) / max * chartH;
      const y = padT + chartH - h;
      const color = it.color || colors[i % colors.length];
      const tip = `<strong>${this.esc(it.label)}</strong><br>Average: <strong>${this.fmtPct(it.value)}</strong>${it.sub ? '<br>' + this.esc(it.sub) : ''}`;
      bars += `<rect class="rms-bar" x="${x}" y="${y}" width="${barW}" height="${Math.max(h, it.value > 0 ? 1 : 0)}" rx="3" fill="${color}" data-idx="${i}" data-tip="${this.esc(tip)}"></rect>`;
      const label = it.label;
      const disp = label.length > 22 ? label.slice(0, 20) + '…' : label;
      bars += `<text x="${x + barW / 2}" y="${H - padB + 14}" text-anchor="end" font-size="10" fill="#6b7280" transform="rotate(-28 ${x + barW / 2} ${H - padB + 14})">${this.esc(disp)}</text>`;
      bars += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="10" font-weight="600" fill="${color}">${this.round(it.value, 0)}</text>`;
    });

    const svg = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${this.esc(opts.title || 'Bar chart')}">${grid}${bars}</svg>`;
    this.mount(container, svg, { onClick: opts.onClick, items });
  },

  groupBarChart(container, opts) {
    const cats = opts.labels || [];
    const series = opts.series || [];
    if (!cats.length || !series.length) return this.empty(container, opts.emptyMessage);

    const W = opts.width || 620;
    const H = opts.height || 280;
    const padL = opts.padLeft != null ? opts.padLeft : 46;
    const padR = 14;
    const padT = 22;
    const padB = 58;
    const allVals = series.reduce((a, s) => a.concat(s.values.map(Number)), []);
    const max = this.niceMax((allVals.length ? Math.max(...allVals) : 0) * 1.05);
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const colors = opts.colors || this.defaultColors();

    let grid = '';
    this._gridY(5, max).forEach((val, i) => {
      const y = padT + chartH - (chartH * val) / max;
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="1"></line>`;
      grid += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${Math.round(val)}%</text>`;
    });

    const groupW = chartW / cats.length;
    const slotW = groupW / series.length;
    const barW = Math.min(30, slotW * 0.65);

    let bars = '';
    cats.forEach((c, ci) => {
      series.forEach((s, si) => {
        const v = Number(s.values[ci]) || 0;
        const x = padL + groupW * ci + slotW * si + (slotW - barW) / 2;
        const h = (v / max) * chartH;
        const y = padT + chartH - h;
        const color = s.color || colors[si % colors.length];
        const tip = `<strong>${this.esc(s.name)} &middot; ${this.esc(c)}</strong><br>Average: <strong>${this.fmtPct(v)}</strong>`;
        bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(h, v > 0 ? 1 : 0)}" rx="2" fill="${color}" data-tip="${this.esc(tip)}"></rect>`;
      });
      const disp = c.length > 18 ? c.slice(0, 16) + '…' : c;
      const cw = groupW;
      bars += `<text x="${padL + groupW * ci + cw / 2}" y="${H - padB + 34}" text-anchor="middle" font-size="10" fill="#6b7280">${this.esc(disp)}</text>`;
    });

    const legend = series.map((s, si) => `<span class="rms-legend-item"><span class="rms-legend-swatch" style="background:${s.color || colors[si % colors.length]}"></span>${this.esc(s.name)}</span>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H + 26}" width="100%" role="img" aria-label="${this.esc(opts.title || 'Grouped bar chart')}">${grid}${bars}<foreignObject x="${padL}" y="${H - 14}" width="${chartW}" height="26"><div class="rms-legend">${legend}</div></foreignObject></svg>`;
    this.mount(container, svg, {});
  },

  lineChart(container, opts) {
    const labels = opts.labels || [];
    const series = opts.series || [];
    const hasData = series.some(s => s.values.some(v => v != null));
    if (!labels.length || !series.length || !hasData) return this.empty(container, opts.emptyMessage);

    const W = opts.width || 620;
    const H = opts.height || 280;
    const padL = opts.padLeft != null ? opts.padLeft : 46;
    const padR = 14;
    const padT = 18;
    const padB = 48;
    const allVals = series.reduce((a, s) => a.concat(s.values.filter(v => v != null).map(Number)), []);
    const max = this.niceMax((allVals.length ? Math.max(...allVals) : 0) * 1.08);
    const chartW = W - padL - padR;
    const chartH = H - padT - padB;
    const colors = opts.colors || this.defaultColors();

    let grid = '';
    this._gridY(5, max).forEach((val, i) => {
      const y = padT + chartH - (chartH * val) / max;
      grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="#e5e7eb" stroke-width="1"></line>`;
      grid += `<text x="${padL - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="#6b7280">${Math.round(val)}%</text>`;
    });

    const px = i => labels.length === 1 ? padL + chartW / 2 : padL + (chartW * i) / (labels.length - 1);
    const py = v => v == null ? null : padT + chartH - (chartH * Number(v)) / max;

    let seriesSvg = '';
    series.forEach((s, si) => {
      const color = s.color || colors[si % colors.length];
      const pts = [];
      let dots = '';
      s.values.forEach((v, i) => {
        const x = px(i);
        const y = py(v);
        if (y == null) return;
        pts.push([x, y]);
        const tip = `<strong>${this.esc(s.name)}</strong><br>${this.esc(labels[i])}: <strong>${this.fmtPct(v)}</strong>`;
        dots += `<circle cx="${x}" cy="${y}" r="4" fill="#fff" stroke="${color}" stroke-width="2" data-tip="${this.esc(tip)}"></circle>`;
      });
      if (pts.length) {
        seriesSvg += `<polyline points="${pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"></polyline>`;
        seriesSvg += dots;
      }
    });

    let xLabels = '';
    labels.forEach((l, i) => {
      const x = px(i);
      const disp = String(l).length > 16 ? String(l).slice(0, 14) + '…' : l;
      xLabels += `<text x="${x}" y="${H - padB + 16}" text-anchor="middle" font-size="10" fill="#6b7280">${this.esc(disp)}</text>`;
    });

    const legend = series.map((s, si) => `<span class="rms-legend-item"><span class="rms-legend-swatch" style="background:${s.color || colors[si % colors.length]}"></span>${this.esc(s.name)}</span>`).join('');
    const svg = `<svg viewBox="0 0 ${W} ${H + 26}" width="100%" role="img" aria-label="${this.esc(opts.title || 'Line chart')}">${grid}${seriesSvg}${xLabels}<foreignObject x="${padL}" y="${H - 10}" width="${chartW}" height="26"><div class="rms-legend">${legend}</div></foreignObject></svg>`;
    this.mount(container, svg, {});
  },

  donutChart(container, opts) {
    const items = (opts.items || []).filter(x => x && x.value > 0);
    const total = items.reduce((a, x) => a + Number(x.value), 0);
    if (!total) return this.empty(container, opts.emptyMessage);

    const size = opts.size || 240;
    const stroke = opts.stroke || 30;
    const r = (size - stroke) / 2;
    const cx = size / 2;
    const cy = size / 2;
    const colors = opts.colors || this.defaultColors();
    const C = 2 * Math.PI * r;

    let offset = 0;
    let segs = '';
    items.forEach((it, i) => {
      const frac = Number(it.value) / total;
      const len = C * frac;
      const color = it.color || colors[i % colors.length];
      segs += `<circle class="rms-donut-seg" cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-dasharray="${len} ${C - len + 1}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})" data-tip="${this.esc(`<strong>${it.label}</strong><br>${it.value} (${this.round(frac * 100, 0)}%)`)}"></circle>`;
      offset += len;
    });

    const center = opts.centerLabel
      ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="20" font-weight="700" fill="#111827">${this.esc(opts.centerLabel)}</text><text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="11" fill="#6b7280">${this.esc(opts.centerSub || '')}</text>`
      : '';

    let legend = '';
    items.forEach((it, i) => {
      const color = it.color || colors[i % colors.length];
      const pct = this.round((Number(it.value) / total) * 100, 0);
      legend += `<div class="rms-donut-legend-item"><span class="rms-legend-swatch" style="background:${color}"></span><span class="rms-donut-legend-label">${this.esc(it.label)}</span><span class="font-semibold">${it.value}</span><span class="text-muted">(${pct}%)</span></div>`;
    });

    const svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${this.esc(opts.title || 'Donut chart')}">${segs}${center}</svg>`;
    const wrap = `<div class="rms-donut-flex">${svg}<div class="rms-donut-legend">${legend}</div></div>`;
    this.mount(container, wrap, {});
  },

  radarChart(container, opts) {
    const labels = opts.labels || [];
    const series = opts.series || [];
    if (!labels.length || !series.length) return this.empty(container, opts.emptyMessage);

    const size = opts.size || 300;
    const cx = size / 2;
    const cy = size / 2;
    const r = size / 2 - 44;
    const colors = opts.colors || this.defaultColors();
    const rings = 4;

    const angle = i => (Math.PI * 2 * i) / labels.length - Math.PI / 2;
    const point = (i, scale, max) => {
      const val = Number(series[scale].values[i]) || 0;
      const rr = (val / max) * r;
      return [cx + rr * Math.cos(angle(i)), cy + rr * Math.sin(angle(i))];
    };
    const max = this.niceMax(Math.max.apply(Math, series.reduce((a, s) => a.concat(s.values.map(Number)), [])) * 1.05);

    let grid = '';
    for (let ri = 1; ri <= rings; ri++) {
      const rr = (r * ri) / rings;
      let poly = '';
      for (let i = 0; i <= labels.length; i++) {
        const idx = i % labels.length;
        const a = angle(idx);
        poly += (i === 0 ? '' : ' ') + (cx + rr * Math.cos(a)).toFixed(1) + ',' + (cy + rr * Math.sin(a)).toFixed(1);
      }
      grid += `<polygon points="${poly}" fill="${ri === rings ? '#f3f4f6' : 'none'}" stroke="#e5e7eb" stroke-width="1"></polygon>`;
    }
    labels.forEach((l, i) => {
      const a = angle(i);
      grid += `<line x1="${cx}" y1="${cy}" x2="${cx + r * Math.cos(a)}" y2="${cy + r * Math.sin(a)}" stroke="#e5e7eb" stroke-width="1"></line>`;
      const lx = cx + (r + 18) * Math.cos(a);
      const ly = cy + (r + 18) * Math.sin(a);
      grid += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="#374151">${this.esc(l)}</text>`;
    });

    let seriesSvg = '';
    series.forEach((s, si) => {
      const color = s.color || colors[si % colors.length];
      let poly = '';
      let dots = '';
      labels.forEach((l, i) => {
        const [x, y] = point(i, si, max);
        poly += (i === 0 ? '' : ' ') + x.toFixed(1) + ',' + y.toFixed(1);
        const tip = `<strong>${this.esc(s.name)}</strong><br>${this.esc(l)}: <strong>${this.fmtPct(s.values[i])}</strong>`;
        dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="${color}" data-tip="${this.esc(tip)}"></circle>`;
      });
      seriesSvg += `<polygon points="${poly}" fill="${color}" fill-opacity="0.12" stroke="${color}" stroke-width="2" stroke-linejoin="round"></polygon>${dots}`;
    });

    const legend = series.map((s, si) => `<span class="rms-legend-item"><span class="rms-legend-swatch" style="background:${s.color || colors[si % colors.length]}"></span>${this.esc(s.name)}</span>`).join('');
    const svg = `<svg viewBox="0 0 ${size} ${size}" width="100%" role="img" aria-label="${this.esc(opts.title || 'Radar chart')}">${grid}${seriesSvg}</svg>`;
    const wrap = `<div class="rms-radar-wrap">${svg}<div class="rms-legend">${legend}</div></div>`;
    this.mount(container, wrap, {});
  },

  heatmap(container, opts) {
    const rows = opts.rows || [];
    const cols = opts.cols || [];
    if (!rows.length || !cols.length) return this.empty(container, opts.emptyMessage);

    const cellW = opts.cellW || 86;
    const cellH = opts.cellH || 44;
    const rowLabelW = opts.rowLabelW || 120;
    const W = rowLabelW + cols.length * cellW;
    const H = 30 + rows.length * cellH;

    const cellColor = v => {
      if (v == null || isNaN(v)) return '#f9fafb';
      if (v >= 80) return '#dcfce7';
      if (v >= 70) return '#bbf7d0';
      if (v >= 60) return '#fef3c7';
      if (v >= 50) return '#fed7aa';
      return '#fecaca';
    };
    const textColor = v => (v != null && v < 50 ? '#b91c1c' : '#166534');

    let parts = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="grid" aria-label="${this.esc(opts.title || 'Heatmap')}">`;
    parts += `<rect x="0" y="0" width="${rowLabelW}" height="30" fill="transparent"></rect>`;
    cols.forEach((c, i) => {
      parts += `<text x="${rowLabelW + i * cellW + cellW / 2}" y="20" text-anchor="middle" font-size="10" font-weight="600" fill="#374151">${this.esc(c)}</text>`;
    });
    rows.forEach((row, ri) => {
      const y = 30 + ri * cellH;
      parts += `<text x="${rowLabelW - 8}" y="${y + cellH / 2 + 3}" text-anchor="end" font-size="10" font-weight="600" fill="#111827">${this.esc(row.label)}</text>`;
      row.values.forEach((v, ci) => {
        const x = rowLabelW + ci * cellW;
        const tip = `<strong>${this.esc(row.label)} &middot; ${this.esc(cols[ci])}</strong><br>Average: <strong>${this.fmtPct(v)}</strong>`;
        parts += `<rect x="${x}" y="${y}" width="${cellW - 4}" height="${cellH - 4}" rx="4" fill="${cellColor(v)}" stroke="#e5e7eb" data-idx="${ri}" data-tip="${this.esc(tip)}"></rect>`;
        parts += `<text x="${x + (cellW - 4) / 2}" y="${y + (cellH - 4) / 2 + 3}" text-anchor="middle" font-size="11" font-weight="600" fill="${textColor(v)}">${v == null || isNaN(v) ? '—' : Math.round(v)}%</text>`;
      });
    });
    parts += `</svg>`;

    const rowsByIndex = rows.map((r, i) => ({ idx: i, label: r.label, click: r.click }));
    this.mount(container, parts, {
      onClick: (idx) => {
        const row = rowsByIndex[idx];
        if (row && row.click) row.click(row);
      }
    });
  }
};