# intelligence-ui

嵌入现有项目的页面渲染与数据回写库。调用方传入文档（HTML、CSS、决策和数据），包负责渲染与交互，通过回调把变化交给调用方保存。

浏览器端不启动服务器、不依赖 Node.js，也不指定数据库或后端。支持原生 JavaScript 和 React。Node 宿主、CLI 是可选工具。

## 安装

当前未发布 npm registry，可安装打包文件：

```sh
npm install /absolute/path/intelligence-ui-0.2.0.tgz
```

有私有仓库权限时也可从 GitHub 安装：

```sh
npm install git+ssh://git@github.com/haowei2000/intelligence-ui.git
```

React 项目使用调用方已有的 React（18 或 19），不会再打包一份 React。原生入口没有运行时第三方依赖。

TypeScript React 项目使用项目自己的 `@types/react` 类型声明；未配置时可安装 `npm install -D @types/react @types/react-dom`。

## 创建一份页面

```js
import { createDocument } from 'intelligence-ui';

const page = createDocument({
  title: '项目设置',
  html: `
    <label>项目名称<input data-field="projectName"></label>
    <label>人数<input type="number" data-field="members"></label>
    <label><input type="checkbox" data-field="notifications">接收通知</label>
  `,
  css: 'label{display:block;margin-bottom:16px}',
  state: {
    selections: {},
    notes: '',
    values: { projectName: '我的项目', members: 5, notifications: true },
  },
});
```

也可直接传入符合 `InteractiveDocument` 类型的 JSON，例如从后端加载或由 AI 生成的文档。HTML、CSS 和数据随文档保存；没有决策的纯表单页面同样支持。

## 在 React 项目中渲染和回写

```jsx
import { useState } from 'react';
import { DocumentRenderer } from 'intelligence-ui/react';

function ProjectSettings({ initialDocument }) {
  const [page, setPage] = useState(initialDocument);

  return (
    <DocumentRenderer
      value={page}
      onChange={setPage}
      onSave={async (next, { signal, baseRevision }) => {
        const response = await fetch(`/api/pages/${next.manifest.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ document: next, expectedRevision: baseRevision }),
          signal,
        });
        if (!response.ok) throw new Error(`保存失败：${response.status}`);
        return response.json();
      }}
      onError={error => console.error(error)}
    />
  );
}
```

`/api/pages/:id` 是调用方自己的接口，不是本包提供的云服务。它可以把文档存入数据库、对象存储或文件，并返回包含新 revision 的完整文档。返回值会同步到组件和 `onChange`；不要通过 `onSaved={setPage}` 用旧保存快照覆盖正在编辑的数据。

如果后端只返回成功状态，`onSave` 可以不返回内容；库保留当前数据。也可仅使用 `onChange`，让调用方自行实现保存流程。通常选择一种保存方式，避免在 `onChange` 与 `onSave` 中重复提交。

## 在原生 JavaScript / Vue 等项目中使用

```js
import { mountDocument } from 'intelligence-ui';

const renderer = mountDocument(document.querySelector('#page'), {
  document: page,
  onChange(next, context) {
    applicationState.page = next;
  },
  async onSave(next, { signal, baseRevision }) {
    return await yourRepository.save(next, { signal, expectedRevision: baseRevision });
  },
  onError(error) {
    showSaveError(error);
  },
});

// 外部加载的数据更新页面，不触发回写循环。
renderer.update(await yourRepository.load(page.manifest.id));

// 导航或卸载前，显式等待保存完成。
await renderer.flush();
renderer.destroy();
```

Vue/Svelte 等可在挂载钩子创建 renderer，在接收到新数据时 `update`，在卸载前按项目流程 `flush` 与 `destroy`。

## 数据绑定

在 HTML 表单元素上标记 `data-field="字段名"`，对应 `document.state.values[字段名]`：

- 文本框、文本域、单选 select：字符串。
- number/range：数字；空数字框为 `null`。
- checkbox：布尔值。
- radio：选中项的 value。
- 多选 select：字符串数组。

字段名以字母开头，可包含字母、数字、下划线和连字符，最长 80 个字符。当前为扁平字段，不解析 `a.b` 路径。决策按钮写入 `state.selections[decisionId]`，备注写入 `state.notes`。传入的数据和回调快照彼此独立，不直接修改调用方对象。

`onChange(next, context)` 的 `context.type` 为 `selection / notes / field / saved`。`saved` 表示服务端回传的文档或版本已同步，不会再次触发自动保存。

## 保存行为与生命周期

默认 300 ms 防抖，可设置 `debounceMs`。保存串行执行；写入期间继续编辑会排队保存，使用前一次回传的新 revision，避免旧响应覆盖新输入。

`onSave(next, context)` 接收完整文档与 `signal / documentId / baseRevision / changeId`。返回完整已保存文档或 `void`。实际的事务、版本冲突和持久化由调用方实现。

保存失败保留当前编辑数据，通过 `onError` 和 `onSaveStatus('error')` 报告。调用 `renderer.flush()` 或 React ref 的 `flush()` 可重试；`flush` 在失败时拒绝 Promise。`onSaveStatus` 可能为 `idle / pending / saving / saved / error`，库本身不显示提示文字。

`destroy` 取消定时器并通过 AbortSignal 通知正在保存的适配器；不自动补一次卸载保存。React 卸载同样如此。需要保证保存时，在项目的路由退出流程中先等待 `ref.current.flush()`。即使适配器忽略取消信号，旧文档的迟到响应也不会覆盖新文档。

React ref 提供 `getDocument()` 与 `flush()`。原生 controller 还提供 `update(document, settings)` 与 `destroy()`。`readOnly` 禁用交互，程序更新仍可渲染数据。

## 样式与 HTML

页面在 Shadow DOM 中渲染，默认样式不会污染宿主页面。可通过 `ui.css` 定义页面样式，或使用 `--document-accent / --document-text / --document-muted / --document-border / --document-background / --document-selected` CSS 变量。使用严格 CSP 的项目可传入 `styleNonce`。

嵌入入口接受常用 HTML 内容与表单标签。自定义 HTML 的 script、iframe、事件属性和网络资源元素会被移除；数据绑定由库完成，不执行文档携带的任意 JavaScript。CSS 由调用方审核后提供。原有 `renderDocument(page, true)` 返回独立 HTML 文件，不等同于嵌入入口的 HTML 清理模式。

React wrapper 使用 `useEffect` 管理挂载和清理，支持 StrictMode。SSR 时返回容器，在浏览器挂载后渲染页面。

## 入口与示例

- `intelligence-ui` / `intelligence-ui/browser`：`mountDocument`、文档创建/验证/合并/HTML 导出。
- `intelligence-ui/react`：`DocumentRenderer` 与组件类型。
- `intelligence-ui/document`：浏览器兼容的文档工具。
- `intelligence-ui/node`：可选的 `DocumentStore`、`readReference`、`createStudio`、`startStudio`、AI 适配器。

React 接 HTTP 后端示例见 `examples/react/App.jsx`，页面定义见 `examples/react/page.mjs`。原生浏览器接 localStorage 示例见 `examples/vanilla/index.mjs`。这些示例属于调用方集成代码，不要求安装或运行独立工作台。

在源码仓库中运行 `npm run demo`，打开 http://localhost:4311 即可测试 React 嵌入 → 自有 HTTP 接口 → 文件保存 → 重新加载。示例后端代码为 `examples/server.mjs`，数据保存在 `.data/embedding-demo/`。

从 0.1 升级时，原来的 Node 导入需改成 `intelligence-ui/node`。CLI `intelligence-ui` 保留，Node 功能需要 Node.js 22+；浏览器代码依赖现代浏览器的 Web Crypto、Shadow DOM 和 structuredClone。

## 开发与打包

```sh
npm install
npm run check:types
npm test
npm pack
```

打包前自动验证类型和测试。包仅包含 SDK、声明、可选 CLI/工作台资源与 README，不包含本地文档数据、密钥或开发测试。当前 license 为 `UNLICENSED`，尚未发布 npm registry。
