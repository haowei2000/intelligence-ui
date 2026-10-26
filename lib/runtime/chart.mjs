// Dependency-free SVG renderer. All labels are text nodes, never markup.
export function renderChart(node, rows, { document: doc, h, labels, lang }) {
  const svg = (tag, attrs = {}, ...children) => {
    const element = doc.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    element.append(...children);
    return element;
  };
  const text = (tag, attrs, value) => { const element = svg(tag, attrs); element.textContent = value; return element; };
  const format = value => value === null ? '—' : typeof value === 'number' ? value.toLocaleString(lang) : String(value);
  const colors = ['#2563a6', '#b45309', '#16806a', '#8b4cb8', '#c33b53', '#53721b', '#486779', '#965d35'];
  const color = index => colors[index % colors.length];
  const figure = h('figure', { class: 'chart' }, h('figcaption', {}, h('strong', { text: node.title }), node.description ? h('p', { text: node.description }) : null));
  const values = rows.flatMap(row => node.series.map(series => row[series.field])).filter(value => value !== null);
  const empty = !values.length || (node.kind === 'pie' && !values.some(value => value > 0));
  if (empty) figure.append(h('p', { class: 'fallback', text: node.emptyText || labels.empty }));
  else {
    const height = node.height || 300, width = node.kind === 'pie' ? height : 400;
    const graphic = svg('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': node.title, class: 'chart-graphic', preserveAspectRatio: node.kind === 'pie' ? 'xMidYMid meet' : 'none' });
    graphic.style.height = `${height}px`;
    // The complete text alternative is the adjacent data table. Marks also expose native pointer tooltips.
    const plot = svg('g', { 'aria-hidden': 'true' });
    graphic.append(plot);
    const mark = (tag, attrs, tip) => svg(tag, attrs, text('title', {}, tip));
    let legend;
    if (node.kind === 'pie') {
      const field = node.series[0].field;
      const maximum = Math.max(...values), total = values.reduce((sum, value) => sum + value / maximum, 0);
      const cx = width / 2, cy = height / 2, radius = Math.min(height / 2 - 12, 140);
      let angle = -Math.PI / 2;
      rows.forEach((row, i) => {
        const value = row[field];
        if (!(value > 0)) return;
        const fraction = (value / maximum) / total, end = angle + fraction * Math.PI * 2;
        const tip = `${format(row[node.x])} · ${node.series[0].label}: ${format(value)} (${(fraction * 100).toFixed(1)}%)`;
        const attrs = { fill: color(i), stroke: 'var(--_surface)', 'stroke-width': 1 };
        if (fraction >= 1 - Number.EPSILON) plot.append(mark('circle', { ...attrs, cx, cy, r: radius }, tip));
        else plot.append(mark('path', { ...attrs, d: `M ${cx} ${cy} L ${cx + radius * Math.cos(angle)} ${cy + radius * Math.sin(angle)} A ${radius} ${radius} 0 ${fraction > .5 ? 1 : 0} 1 ${cx + radius * Math.cos(end)} ${cy + radius * Math.sin(end)} Z` }, tip));
        angle = end;
      });
      legend = rows.map((row, i) => ({ label: format(row[node.x]), color: color(i) }));
    } else {
      const left = 62, right = width - 16, top = 16, bottom = height - 42;
      // Normalize before subtracting: finite values close to +/-Number.MAX_VALUE must not overflow.
      const magnitude = Math.max(...values.map(value => Math.abs(value))) || 1;
      const scaled = values.map(value => value / magnitude);
      const low = Math.min(0, ...scaled), high = Math.max(0, ...scaled) || (low === 0 ? 1 : 0), span = high - low;
      const y = value => bottom - ((value / magnitude - low) / span) * (bottom - top);
      const zero = y(0), step = (right - left) / Math.max(rows.length, 1);
      const x = i => left + (i + .5) * step;
      for (let i = 0; i <= 4; i++) {
        const ratio = i / 4, position = bottom - ratio * (bottom - top), value = (low + ratio * span) * magnitude;
        const scientific = Math.abs(value) >= 1e12 || (value !== 0 && Math.abs(value) < .001);
        const label = new Intl.NumberFormat(lang, { notation: scientific ? 'scientific' : 'compact', maximumSignificantDigits: 3 }).format(value);
        plot.append(svg('line', { x1: left, x2: right, y1: position, y2: position, class: 'chart-grid' }), text('text', { x: left - 8, y: position + 4, 'text-anchor': 'end', class: 'chart-label' }, label));
      }
      plot.append(svg('line', { x1: left, x2: right, y1: zero, y2: zero, class: 'chart-axis' }));
      rows.forEach((row, i) => {
        if (i % Math.max(1, Math.ceil(rows.length / 5)) !== 0) return;
        const label = format(row[node.x]);
        plot.append(text('text', { x: x(i), y: bottom + 24, 'text-anchor': 'middle', class: 'chart-label' }, label.length > 8 ? `${label.slice(0, 7)}…` : label));
      });
      node.series.forEach((series, seriesIndex) => {
        let segment = [];
        const flush = () => {
          if (segment.length > 1) plot.append(svg('polyline', { points: segment.join(' '), fill: 'none', stroke: color(seriesIndex), 'stroke-width': 2, 'stroke-dasharray': ['none', '7 3', '2 3', '9 3 2 3'][seriesIndex % 4], 'vector-effect': 'non-scaling-stroke' }));
          segment = [];
        };
        const dots = [];
        rows.forEach((row, i) => {
          const value = row[series.field];
          if (value === null) { flush(); return; }
          const tip = `${format(row[node.x])} · ${series.label}: ${format(value)}`;
          if (node.kind === 'bar') {
            const barWidth = step * .8 / node.series.length;
            plot.append(mark('rect', { x: left + i * step + step * .1 + seriesIndex * barWidth, y: Math.min(zero, y(value)), width: barWidth, height: Math.abs(y(value) - zero), fill: color(seriesIndex) }, tip));
          } else {
            segment.push(`${x(i)},${y(value)}`);
            dots.push(mark('circle', { cx: x(i), cy: y(value), r: 3, fill: color(seriesIndex) }, tip));
          }
        });
        flush();
        plot.append(...dots);
      });
      legend = node.series.map((series, i) => ({ label: series.label, color: color(i) }));
    }
    figure.append(graphic);
    if (node.showLegend !== false) figure.append(h('ul', { class: 'chart-legend' }, legend.map(item => {
      const swatch = h('span', { class: 'chart-swatch', 'aria-hidden': 'true' }); swatch.style.backgroundColor = item.color;
      return h('li', {}, swatch, h('span', { text: item.label }));
    })));
  }
  const table = h('table', {}, h('caption', { text: node.title }),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: node.x }), node.series.map(series => h('th', { scope: 'col', text: series.label })))),
    h('tbody', {}, rows.map(row => h('tr', {}, h('th', { scope: 'row', text: format(row[node.x]) }), node.series.map(series => h('td', { class: 'number', text: format(row[series.field]) }))))));
  figure.append(h('details', { class: 'chart-data' }, h('summary', { text: labels.chartData }), h('div', { class: 'table-wrap', tabindex: 0, role: 'region', 'aria-label': node.title }, table)));
  return figure;
}
