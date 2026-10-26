import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { validate, fix, createContract } from '@haowei2000/intelligence-ui/agent';
import { commitDocument } from '@haowei2000/intelligence-ui/protocol';
import { mountUI } from '@haowei2000/intelligence-ui/runtime';

const chart = (kind = 'bar', rows = [{ month: 'Jan', value: 10 }, { month: 'Feb', value: 20 }], props = {}) => ({
  schemaVersion: '1.0',
  root: { type: 'Chart', id: 'chart', title: 'Revenue', kind, dataset: 'sales', x: 'month', series: [{ field: 'value', label: 'Sales' }], ...props },
  datasets: { sales: { rows } }
});
const codes = candidate => validate(candidate).diagnostics.filter(d => d.severity === 'error').map(d => d.code);
function mount(candidate, options = {}) {
  const dom = new JSDOM('<main></main>');
  const ui = mountUI(dom.window.document.querySelector('main'), { document: commitDocument(candidate, { id: 'd', revision: 1 }).committed, ...options });
  return { ui, root: ui.element.shadowRoot, close() { ui.destroy(); dom.window.close(); } };
}

test('Chart rejects invalid dataset mappings, duplicate series and unsupported chart families', () => {
  const missing = chart(); delete missing.datasets;
  assert.ok(codes(missing).includes('UNKNOWN_DATASET'));
  for (const row of [{ month: 'Jan' }, { month: null, value: 1 }, { month: 'Jan', value: '10' }, { month: true, value: 1 }]) {
    assert.ok(codes(chart('bar', [row])).includes('INVALID_DATASET_VALUE'), JSON.stringify(row));
  }
  assert.ok(codes(chart('bar', [], { series: [{ field: 'value', label: 'A' }, { field: 'value', label: 'B' }] })).includes('DUPLICATE_SERIES'));
  assert.ok(codes(chart('scatter')).includes('INVALID_ENUM'));
  assert.ok(codes(chart('pie', [], { series: [{ field: 'value', label: 'A' }, { field: 'other', label: 'B' }] })).includes('INVALID_CHART_SERIES'));
  assert.ok(codes(chart('pie', [{ month: 'Jan', value: -1 }])).includes('INVALID_DATASET_VALUE'));
  assert.ok(validate(chart('bar', [{ month: 'Jan', value: -1 }, { month: 'Feb', value: null }])).valid);
  assert.ok(validate(chart('pie', [{ month: 1, value: null }])).valid);
  assert.ok(!validate(chart()).diagnostics.some(d => d.code === 'UNUSED_DATASET'));
  assert.ok(validate(chart(), { contract: createContract({ components: ['Text'] }) }).diagnostics.some(d => d.code === 'COMPONENT_UNAVAILABLE'));
});

test('Chart semantic checks tolerate malformed series and preserve bad data for Agent repair', () => {
  for (const series of [null, [null], [{}], 'bad']) assert.doesNotThrow(() => validate(chart('bar', [], { series })));
  const candidate = chart('pie', [{ month: 'Jan', value: -1 }]);
  const original = structuredClone(candidate);
  const result = fix(candidate);
  assert.equal(result.valid, false);
  assert.deepEqual(candidate, original);
  assert.deepEqual(result.candidate.datasets, original.datasets);
});

test('bar charts handle positive and negative values about zero, and expose exact data', () => {
  const { root, close } = mount(chart('bar', [{ month: '<Jan>', value: -10 }, { month: 'Feb', value: 20 }, { month: 'Mar', value: null }]));
  const bars = [...root.querySelectorAll('svg rect')];
  assert.equal(bars.length, 2);
  assert.ok(bars.every(bar => Number(bar.getAttribute('height')) > 0));
  assert.equal(bars[0].getAttribute('y'), root.querySelector('.chart-axis').getAttribute('y1'));
  assert.equal(root.querySelector('svg').namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(root.querySelector('svg').getAttribute('aria-label'), 'Revenue');
  assert.match(bars[0].textContent, /<Jan> · Sales: -10/);
  assert.equal(root.querySelector('tbody th').textContent, '<Jan>');
  assert.equal(root.querySelectorAll('tbody tr').length, 3);
  assert.equal(root.querySelector('tbody tr:last-child td').textContent, '—');
  assert.equal(root.querySelector('summary').textContent, 'View chart data');
  close();
});

test('lines keep null gaps and series separate; updates redraw data without host events', () => {
  const rows = [1, 2, null, 4, 5].map((value, i) => ({ month: String(i), value, other: i }));
  const candidate = chart('line', rows, { series: [{ field: 'value', label: 'Sales' }, { field: 'other', label: 'Cost' }] });
  const { ui, root, close } = mount(candidate, { onAction() { assert.fail('charts never emit actions'); } });
  assert.equal(root.querySelectorAll('polyline').length, 3);
  assert.equal(root.querySelectorAll('svg circle').length, 9);
  assert.equal(root.querySelectorAll('.chart-legend li').length, 2);
  const previous = ui.getDocument();
  const next = chart('line', [{ month: 'June', value: 99 }]);
  assert.equal(ui.apply(commitDocument(next, { id: 'd', revision: 2, previous }).committed).outcome, 'applied');
  assert.equal(root.querySelectorAll('svg circle').length, 1);
  assert.match(root.querySelector('svg circle').textContent, /June · Sales: 99/);
  close();
});

test('pie charts draw proportions, omit zero/null slices and handle one full circle', () => {
  const { root, close } = mount(chart('pie', [{ month: 'A', value: 1 }, { month: 'B', value: 3 }, { month: 'C', value: 0 }, { month: 'D', value: null }]));
  assert.equal(root.querySelectorAll('svg path').length, 2);
  assert.match(root.querySelector('svg path').textContent, /25.0%/);
  assert.equal(root.querySelectorAll('.chart-legend li').length, 4);
  close();
  const single = mount(chart('pie', [{ month: 'Only', value: 1 }]));
  assert.equal(single.root.querySelectorAll('svg circle').length, 1);
  assert.match(single.root.querySelector('svg circle').textContent, /100.0%/);
  single.close();
});

test('empty charts render a localized fallback and retain their data table', () => {
  for (const candidate of [chart('bar', []), chart('line', [{ month: 'A', value: null }]), chart('pie', [{ month: 'A', value: 0 }])]) {
    const { root, close } = mount(candidate, { labels: { empty: 'No observations', chartData: 'Data' } });
    assert.equal(root.querySelector('svg'), null);
    assert.equal(root.querySelector('.fallback').textContent, 'No observations');
    assert.equal(root.querySelector('summary').textContent, 'Data');
    assert.ok(root.querySelector('table'));
    close();
  }
});

test('Chart scales extreme finite values without nonfinite SVG coordinates', () => {
  for (const kind of ['bar', 'line', 'pie']) {
    const rows = [{ month: 'A', value: Number.MAX_VALUE }, { month: 'B', value: kind === 'pie' ? Number.MAX_VALUE : -Number.MAX_VALUE }];
    const { root, close } = mount(chart(kind, rows, { showLegend: false }));
    for (const element of root.querySelectorAll('svg *')) for (const attr of element.attributes) assert.doesNotMatch(attr.value, /NaN|Infinity/);
    assert.equal(root.querySelector('.chart-legend'), null);
    close();
  }
});
