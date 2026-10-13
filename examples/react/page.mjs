import { createDocument } from 'intelligence-ui';

export const initialDocument = createDocument({
  title: '项目设置',
  html: `
    <div class="settings-grid">
      <label>项目名称<input data-field="projectName"></label>
      <label>成员数量<input type="number" min="1" data-field="memberCount"></label>
      <label><input type="checkbox" data-field="notifications">接收通知</label>
    </div>
  `,
  css: '.settings-grid{display:grid;gap:16px}label{margin:0}input[type=text],input[type=number]{display:block;width:100%;margin-top:8px}',
  state: {
    selections: {}, notes: '',
    values: { projectName: '我的项目', memberCount: 5, notifications: true },
  },
});
