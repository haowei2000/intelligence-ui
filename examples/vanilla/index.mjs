import { createDocument, mountDocument } from '@haowei2000/intelligence-ui';

// Replace localStorage with the host project's HTTP/database/file adapter.
const key = 'project-settings';
const initial = localStorage.getItem(key);
const document = initial ? JSON.parse(initial) : createDocument({
  title: '项目设置',
  html: '<label>项目名称<input data-field="projectName"></label><label><input type="checkbox" data-field="notifications">接收通知</label>',
  state: { selections: {}, notes: '', values: { projectName: '新项目', notifications: true } },
});

const renderer = mountDocument(window.document.querySelector('#page'), {
  document,
  onChange(next) {
    // The host owns this snapshot; it may also derive other UI from it.
    window.document.querySelector('#data').textContent = JSON.stringify(next.state.values, null, 2);
  },
  onSave(next) { localStorage.setItem(key, JSON.stringify(next)); },
  onError(error) { window.document.querySelector('#error').textContent = error.message; },
});

// Before navigating away: await renderer.flush(); renderer.destroy();
export { renderer };
