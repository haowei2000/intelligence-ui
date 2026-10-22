export const escapeHtml = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
export function validateDocument(doc) {
  if (!doc || doc.manifest?.formatVersion !== 1 || !/^[a-zA-Z0-9-]{1,80}$/.test(doc.manifest.id) || !Number.isInteger(doc.manifest.revision) || doc.manifest.revision < 0) throw new Error('文档格式或版本无效');
  if (typeof doc.title !== 'string' || !doc.title.trim() || doc.title.length > 200 || typeof doc.description !== 'string' || doc.description.length > 10000) throw new Error('文档标题或说明无效');
  if (!Array.isArray(doc.decisions) || doc.decisions.length > 100) throw new Error('文档最多支持 100 个决策');
  const ids = new Set();
  for (const d of doc.decisions) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(d.id) || ids.has(d.id) || typeof d.title !== 'string' || typeof d.description !== 'string' || !Array.isArray(d.options) || d.options.length < 2 || d.options.length > 10) throw new Error('决策 ID、内容或选项无效');
    ids.add(d.id);
    const opts = new Set();
    for (const o of d.options) {
      if (!/^[a-zA-Z0-9-]{1,80}$/.test(o.id) || opts.has(o.id) || typeof o.label !== 'string' || typeof o.description !== 'string') throw new Error('选项 ID 或内容无效');
      opts.add(o.id);
    }
  }
  if (!doc.state || !doc.state.selections || typeof doc.state.selections !== 'object' || Array.isArray(doc.state.selections) || typeof doc.state.notes !== 'string' || doc.state.notes.length > 20000) throw new Error('状态无效');
  for (const [id, value] of Object.entries(doc.state.selections)) {
    if (!doc.decisions.find(d => d.id === id)?.options.some(o => o.id === value)) throw new Error('状态包含失效选项');
  }
  if (doc.state.values !== undefined) {
    if (!doc.state.values || typeof doc.state.values !== 'object' || Array.isArray(doc.state.values)) throw new Error('表单数据无效');
    for (const [key, value] of Object.entries(doc.state.values)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key) || ['constructor', 'prototype'].includes(key) || !(typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value)) || value === null || (Array.isArray(value) && value.every(v => typeof v === 'string')))) throw new Error('表单字段或值无效');
    }
    if (JSON.stringify(doc.state.values).length > 100000) throw new Error('表单数据超过 100 KB');
  }
  if (!Array.isArray(doc.references) || doc.references.length > 100 || !Array.isArray(doc.analysis) || doc.analysis.length > 100 || !doc.ui || typeof doc.ui.html !== 'string' || doc.ui.html.length > 200000) throw new Error('引用、分析或界面无效');
  if (doc.ui.css !== undefined && (typeof doc.ui.css !== 'string' || doc.ui.css.length > 200000)) throw new Error('页面样式无效');
  for (const r of doc.references) {
    if (!ids.has(r.decisionId) || typeof r.path !== 'string' || typeof r.hash !== 'string' || !Number.isInteger(r.startLine) || !Number.isInteger(r.endLine) || r.startLine < 1 || r.endLine < r.startLine) throw new Error('代码引用无效');
  }
  for (const a of doc.analysis) if (!a || typeof a.text !== 'string' || typeof a.createdAt !== 'string' || typeof a.kind !== 'string') throw new Error('分析记录无效');
  return doc;
}

// crypto.randomUUID only exists in secure contexts; getRandomValues also works on plain-HTTP pages.
function uuid() {
  if (typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createDocument(title = '交互文档的第一版', description = '把方案、决策和代码依据保存在同一份文档里。') {
  const options = title && typeof title === 'object' ? title : undefined;
  if (options) { title = options.title; description = options.description || ''; }
  return validateDocument({
    manifest: { formatVersion: 1, id: uuid(), revision: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    title, description,
    decisions: options ? options.decisions || [] : [
      { id: 'persistence', title: '用户选择如何保存？', description: '决定文档关闭、再次打开以及导出后的状态行为。', options: [
        { id: 'embedded', label: '写入文档', description: '选择和备注属于文档，随文件一起携带。' },
        { id: 'session', label: '仅保留会话', description: '作为临时草稿，不要求跨设备携带状态。' }
      ]},
      { id: 'references', title: '代码引用如何校验？', description: '代码变化后，旧行号可能指向不同内容。', options: [
        { id: 'hash', label: '内容摘要校验', description: '对比文件摘要，失效时阻止使用旧引用。' },
        { id: 'refresh', label: '重新绑定引用', description: '用户确认当前内容后，记录新的摘要和行范围。' }
      ]},
      { id: 'regeneration', title: '更新文档时如何处理决策？', description: '界面更新不应悄悄覆盖已经做出的选择。', options: [
        { id: 'merge', label: '保留稳定 ID', description: '沿用仍然有效的选项，归档已经删除的决策。' },
        { id: 'review', label: '先查看新版本', description: '导入为另一份文档，再人工比较与迁移选择。' }
      ]}
    ],
    state: options?.state || { selections: {}, notes: '' }, references: [], analysis: [], archivedSelections: [], ui: { html: options?.html || '', ...(options?.css ? { css: options.css } : {}) }
  });
}

export function mergeDocument(current, next) {
  const selections = {}, archived = [...(current.archivedSelections || [])];
  for (const [id, value] of Object.entries(current.state.selections)) {
    if (next.decisions.find(d => d.id === id)?.options.some(o => o.id === value)) selections[id] = value;
    else archived.push({ decisionId: id, optionId: value, archivedAt: new Date().toISOString() });
  }
  return validateDocument({ ...next, manifest: current.manifest, state: { ...current.state, selections, notes: current.state.notes }, analysis: current.analysis, archivedSelections: archived });
}

export function renderDocument(doc, standalone = false) {
  const customStyle = (doc.ui.css || '').replace(/</g, String.fromCharCode(92) + '3c ');
  const data = JSON.stringify(doc).replace(/</g, '\\u003c');
  const cards = doc.decisions.map((d, i) => `<section><div class="number">${String(i + 1).padStart(2, '0')}</div><h2>${escapeHtml(d.title)}</h2><p>${escapeHtml(d.description)}</p><div class="options">${d.options.map(o => `<button class="option ${doc.state.selections[d.id] === o.id ? 'selected' : ''}" data-decision="${escapeHtml(d.id)}" data-option="${escapeHtml(o.id)}" aria-pressed="${doc.state.selections[d.id] === o.id}"><span class="radio"></span><span><strong>${escapeHtml(o.label)}</strong><small>${escapeHtml(o.description)}</small></span></button>`).join('')}</div></section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'"><title>${escapeHtml(doc.title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fff;color:#21334a;font:15px/1.7 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}main{max-width:760px;margin:auto;padding:42px 38px}header{border-bottom:1px solid #e6ebef;padding-bottom:28px}h1{font-size:29px;line-height:1.4;letter-spacing:-.7px;margin:12px 0}h2{font-size:18px;margin:4px 0 8px}p{color:#6d7d90;margin:0}.eyebrow{font-size:12px;color:#48796d}.number{font:12px monospace;color:#8a9aa9}section{padding:28px 0;border-bottom:1px solid #e6ebef}.options{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}.option{display:flex;text-align:left;gap:12px;border:1px solid #dce3e9;border-radius:9px;background:#fff;padding:17px;cursor:pointer;color:inherit;font:inherit}.option.selected{border-color:#3c806f;background:#f0f8f5}.radio{border:1.5px solid #bcc8d1;border-radius:50%;width:16px;height:16px;flex-shrink:0;margin-top:5px}.selected .radio{border:5px solid #3c806f}.option strong{display:block;font-size:14px}.option small{display:block;color:#728092;font-size:12px;margin-top:5px}textarea{width:100%;min-height:100px;border:1px solid #dce3e9;border-radius:8px;padding:12px;font:inherit;resize:vertical;color:inherit}button:focus-visible,textarea:focus-visible{outline:3px solid #649eeb;outline-offset:3px}.footer{font-size:12px;color:#8a9aa9;margin-top:24px}#download{border:0;background:#3c806f;color:white;padding:12px 20px;border-radius:8px;cursor:pointer}@media(max-width:520px){main{padding:24px 18px}.options{grid-template-columns:1fr}}
  </style><style>${customStyle}</style></head><body><main><header><h1>${escapeHtml(doc.title)}</h1><p>${escapeHtml(doc.description)}</p></header>${doc.ui.html ? `<section>${doc.ui.html}</section>` : ''}${cards}<section><h2>决策备注</h2><textarea id="notes" aria-label="决策备注">${escapeHtml(doc.state.notes)}</textarea></section>${standalone ? '<button id="download">下载文档</button>' : ''}</main><script id="intelligence-document" type="application/json">${data}</script><script>
  const doc=JSON.parse(document.getElementById('intelligence-document').textContent);
  function changed(){document.getElementById('intelligence-document').textContent=JSON.stringify(doc).replace(/</g,'\\u003c'); parent.postMessage({type:'document-state',documentId:doc.manifest.id,revision:doc.manifest.revision,state:doc.state},'*');}
  document.querySelectorAll('[data-decision]').forEach(b=>b.addEventListener('click',()=>{doc.state.selections[b.dataset.decision]=b.dataset.option;document.querySelectorAll('[data-decision]').forEach(x=>{const active=doc.state.selections[x.dataset.decision]===x.dataset.option;x.classList.toggle('selected',active);x.setAttribute('aria-pressed',String(active));});changed();}));
  document.getElementById('notes').addEventListener('input',e=>{doc.state.notes=e.target.value;changed();});
  document.querySelectorAll('input[data-field],textarea[data-field],select[data-field]').forEach(field=>{
    const key=field.dataset.field;if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(key)||['constructor','prototype'].includes(key))return;
    const values=doc.state.values||{};if(Object.hasOwn(values,key)){const value=values[key];if(field.type==='checkbox')field.checked=Boolean(value);else if(field.type==='radio')field.checked=field.value===value;else if(field.multiple&&field.tagName==='SELECT')Array.from(field.options).forEach(o=>o.selected=Array.isArray(value)&&value.includes(o.value));else field.value=String(value??'');}
    const update=()=>{if(field.type==='radio'&&!field.checked)return;let value=field.value;if(field.type==='checkbox')value=field.checked;else if(field.type==='number'||field.type==='range')value=field.value===''||!Number.isFinite(field.valueAsNumber)?null:field.valueAsNumber;else if(field.multiple&&field.tagName==='SELECT')value=Array.from(field.selectedOptions).map(o=>o.value);doc.state.values={...doc.state.values,[key]:value};changed();};field.addEventListener('input',update);field.addEventListener('change',update);
  });
  const download=document.getElementById('download');if(download)download.addEventListener('click',()=>{document.getElementById('notes').textContent=doc.state.notes;document.getElementById('intelligence-document').textContent=JSON.stringify(doc).replace(/</g,'\\u003c');const url=URL.createObjectURL(new Blob(['<!doctype html>'+document.documentElement.outerHTML],{type:'text/html'}));const a=document.createElement('a');a.href=url;a.download='document.html';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
  </script></body></html>`;
}
