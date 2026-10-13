const $ = id => document.getElementById(id);
const text = (tag, value, className) => { const e = document.createElement(tag); e.textContent = value; if (className) e.className = className; return e; };
let config, documents = [], current, frameRevision, pendingState, saveTimer, savePromise, switching = false, busy = false, conflict = false;
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Document-Token': config.token }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '请求失败'); error.status = response.status; throw error; }
  return result;
}
let toastTimer;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
function setStatus(message, error = false) { $('save-status').textContent = message; $('save-status').classList.toggle('error-text', error); }
function updateList() {
  $('document-count').textContent = documents.length;
  $('document-list').replaceChildren(...documents.map(doc => {
    const button = text('button', '', `document-item ${current?.manifest.id === doc.manifest.id ? 'active' : ''}`);
    button.append(text('span', '▤', 'document-icon'));
    const label = text('span', doc.title); label.append(text('small', `${doc.decisions.length} 项决策 · v${doc.manifest.revision}`)); button.append(label);
    button.addEventListener('click', () => selectDocument(doc.manifest.id).catch(e => toast(e.message))); return button;
  }));
}
function record(doc) { current = doc; const index = documents.findIndex(d => d.manifest.id === doc.manifest.id); if (index === -1) documents.unshift(doc); else documents[index] = doc; updateList(); updateInspector(); }
function updateInspector() {
  if (!current) return;
  const count = Object.keys(current.state.selections).length;
  $('breadcrumb-title').textContent = current.title; $('revision').textContent = `v${current.manifest.revision}`; $('selection-count').textContent = `${count} 项选择`; $('decision-progress').textContent = `${count} / ${current.decisions.length}`;
  $('selection-list').replaceChildren(...current.decisions.map(d => {
    const selected = d.options.find(o => o.id === current.state.selections[d.id]);
    const row = text('div', '', 'selection-row'); row.append(text('span', selected ? '✓' : '○', 'selection-check'));
    const content = text('div', ''); content.append(text('strong', d.title)); if (selected) content.append(text('small', selected.label)); row.append(content); return row;
  }));
  $('references').replaceChildren(...current.references.map(r => {
    const button = text('button', '', 'reference-row'); button.append(text('span', '⌘', 'reference-symbol'));
    const content = text('span', ''); content.append(text('code', r.path), text('small', `L${r.startLine}–${r.endLine} · ${current.decisions.find(d => d.id === r.decisionId)?.title || r.decisionId}`));
    button.append(content, text('span', '↗', 'reference-arrow')); button.addEventListener('click', () => showCode(r).catch(e => toast(e.message))); return button;
  }));
  const latest = current.analysis.at(-1); $('analysis-content').replaceChildren();
  if (latest) {
    if (JSON.stringify(latest.selections) !== JSON.stringify(current.state.selections) || latest.notes !== current.state.notes) $('analysis-content').append(text('div', '结果对应旧选择或备注', 'stale'));
    $('analysis-content').append(text('div', latest.text));
    $('analysis-kind').textContent = latest.kind === 'ai' ? 'AI 分析' : '本地检查';
  } else {
    $('analysis-kind').textContent = config.aiEnabled ? 'AI' : '本地检查';
  }
  $('analyze').disabled = !count || busy || conflict;
  $('analyze').textContent = busy ? '正在处理…' : config.aiEnabled ? '分析所选方案 ↗' : '检查所选方案 ↗';
  $('regenerate').disabled = !config.aiEnabled || busy || conflict;
  $('add-reference').disabled = busy || conflict;
  $('update-section').hidden = !config.aiEnabled;
}
async function loadFrame() {
  const response = await fetch(`/api/documents/${current.manifest.id}/preview`);
  if (!response.ok) throw new Error('文档预览加载失败');
  frameRevision = current.manifest.revision;
  // A URL-backed iframe has its own CSP; srcdoc would inherit the host's
  // script-src policy and block the document's isolated inline runtime.
  $('document-frame').src = `/api/documents/${current.manifest.id}/preview?revision=${frameRevision}`;
}
async function flushState() {
  clearTimeout(saveTimer);
  if (savePromise) await savePromise;
  if (!pendingState) return;
  if (conflict) throw new Error('请重新加载最新文档，再继续修改。');
  const state = pendingState; pendingState = null;
  const id = current.manifest.id, revision = current.manifest.revision;
  setStatus('正在保存…');
  savePromise = api(`/api/documents/${id}/state`, { revision, state }).then(doc => {
    const newerState = pendingState;
    record(doc);
    if (newerState) { current.state = newerState; updateInspector(); }
    setStatus(newerState ? '等待保存…' : '✓ 已保存到本地');
  }).catch(e => { pendingState ||= state; if (e.status === 409) conflict = true; setStatus('保存失败', true); updateInspector(); throw e; }).finally(() => savePromise = null);
  await savePromise;
  if (pendingState) await flushState();
}
async function selectDocument(id) {
  if (switching || busy) return;
  switching = true;
  try { await flushState(); record(await api(`/api/documents/${id}`)); conflict = false; await loadFrame(); setStatus('✓ 已保存到本地'); } finally { switching = false; }
}
window.addEventListener('message', event => {
  const data = event.data;
  if (event.source !== $('document-frame').contentWindow || !data || data.type !== 'document-state' || data.documentId !== current?.manifest.id || data.revision !== frameRevision || switching || busy || conflict) return;
  const state = data.state;
  if (!state || typeof state.notes !== 'string' || state.notes.length > 20000 || !state.selections || typeof state.selections !== 'object' || Array.isArray(state.selections)) return;
  if (Object.entries(state.selections).some(([id, value]) => !current.decisions.find(d => d.id === id)?.options.some(o => o.id === value))) return;
  pendingState = structuredClone(state); current.state = structuredClone(state); updateInspector(); setStatus('等待保存…');
  clearTimeout(saveTimer); saveTimer = setTimeout(() => flushState().catch(e => toast(e.message)), 350);
});
window.addEventListener('beforeunload', e => { if (pendingState || savePromise || busy) { e.preventDefault(); e.returnValue = ''; } });
async function mutate(action, values = {}) {
  if (busy) return;
  await flushState(); busy = true; $('document-frame').inert = true; updateInspector();
  try { record(await api(`/api/documents/${current.manifest.id}/${action}`, { revision: current.manifest.revision, ...values })); await loadFrame(); setStatus('✓ 已保存到本地'); }
  finally { busy = false; $('document-frame').inert = false; updateInspector(); }
}
async function showCode(ref) {
  const result = await api(`/api/reference?${new URLSearchParams({ path: ref.path, start: ref.startLine, end: ref.endLine })}`);
  $('code-title').textContent = ref.path;
  const same = result.hash === ref.hash;
  $('code-status').textContent = same ? '摘要一致 · 引用有效' : '文件内容与引用版本不一致'; $('code-status').classList.toggle('error-text', !same);
  $('code-content').textContent = result.content.split('\n').map((line, i) => `${String(i + result.startLine).padStart(4)}  ${line}`).join('\n'); $('code-dialog').showModal();
}
$('new-document').addEventListener('click', () => $('new-dialog').showModal());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('new-form').addEventListener('submit', async e => {
  e.preventDefault(); const button = e.submitter; button.disabled = true;
  try { await flushState(); const doc = await api('/api/documents', { title: $('new-title').value.trim(), description: $('new-description').value.trim() }); record(doc); await loadFrame(); $('new-dialog').close(); e.target.reset(); } catch (e) { toast(e.message); } finally { button.disabled = false; }
});
$('add-reference').addEventListener('click', () => {
  $('reference-decision').replaceChildren(...current.decisions.map(d => { const o = text('option', d.title); o.value = d.id; return o; })); $('reference-dialog').showModal();
});
$('reference-form').addEventListener('submit', async e => {
  e.preventDefault(); e.submitter.disabled = true;
  try { await mutate('reference', { decisionId: $('reference-decision').value, path: $('reference-path').value.trim(), startLine: Number($('reference-start').value), endLine: Number($('reference-end').value) }); $('reference-dialog').close(); } catch (err) { toast(err.message); } finally { e.submitter.disabled = false; }
});
$('analyze').addEventListener('click', () => mutate('analyze').catch(e => toast(e.message)));
$('regenerate').addEventListener('click', async () => { try { await mutate('regenerate', { prompt: $('update-prompt').value }); $('update-prompt').value = ''; } catch (e) { toast(e.message); } });
$('reload-document').addEventListener('click', async () => {
  if (busy) return;
  try {
    if (conflict) { if (!confirm('重新加载会放弃未保存的本地选择。继续？')) return; pendingState = null; clearTimeout(saveTimer); }
    else await flushState();
    record(await api(`/api/documents/${current.manifest.id}`)); conflict = false; updateInspector(); await loadFrame(); setStatus('✓ 已加载最新版本');
  } catch (e) { toast(e.message); }
});
$('export-document').addEventListener('click', async () => {
  try { await flushState(); const a = document.createElement('a'); a.href = `/api/documents/${current.manifest.id}/export`; a.download = 'document.html'; a.click(); } catch (e) { toast(e.message); }
});
$('import-document').addEventListener('click', () => $('import-file').click());
$('import-file').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('文件不能超过 2 MB');
    const content = await file.text();
    const data = file.name.endsWith('.json') ? JSON.parse(content) : JSON.parse(new DOMParser().parseFromString(content, 'text/html').getElementById('intelligence-document')?.textContent || 'null');
    if (!data) throw new Error('HTML 中没有可识别的交互文档数据');
    await flushState(); const doc = await api('/api/documents', { document: data }); record(doc); await loadFrame();
  } catch (e) { toast(e.message); } finally { e.target.value = ''; }
});
try { config = await api('/api/config'); $('workspace-name').textContent = config.workspace.split('/').at(-1); documents = await api('/api/documents'); if (documents.length) await selectDocument(documents[0].manifest.id); }
catch (e) { setStatus('连接失败', true); toast(e.message); }
