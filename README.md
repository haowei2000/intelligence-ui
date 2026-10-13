# intelligence-ui

用于交互文档的 Node.js SDK 和本地工作台。文档携带方案、稳定 ID 的选项、用户状态、代码引用和分析结果。提供 ESM API、TypeScript 声明和 CLI；无运行时第三方依赖，需要 Node.js 22 或更新版本。

## 安装与运行

当前尚未发布 npm registry，可安装打包文件：

```sh
npm install /absolute/path/intelligence-ui-0.1.0.tgz
npx intelligence-ui --workspace ./my-project --port 4310
```

有私有仓库访问权限时，也可以从 GitHub 安装：

```sh
npm install git+ssh://git@github.com/haowei2000/intelligence-ui.git
```

在本仓库开发：

```sh
npm install
npm start
```

打开 http://localhost:4310 。开发时可运行 `npm run dev`。

## 在其他项目中启动宿主

```js
import { startStudio } from 'intelligence-ui';

const studio = await startStudio({
  workspaceRoot: '/absolute/path/to/my-project',
  dataDirectory: '/absolute/path/to/my-project/.data/documents',
  port: 0,
});

console.log(studio.url);
// 退出时关闭服务
await studio.close();
```

`port: 0` 分配可用端口；默认端口是 4310。工作区默认是调用进程的当前目录，文档默认保存在该工作区 `.data/documents/` 中，不会写进安装包或 `node_modules`。`createStudio(options)` 返回未监听的 `server`、`store`、`workspaceRoot` 和 `dataDirectory`，便于调用方控制生命周期。导入包本身不会启动服务或写文件。

工作台在自己的本地端口运行，目前不提供挂载到其他应用子路径的 middleware 或 React 组件。

## 独立使用文档 API

```js
import { writeFile } from 'node:fs/promises';
import { createDocument, validateDocument, renderDocument, DocumentStore } from 'intelligence-ui';

const doc = createDocument('缓存方案', '选择服务使用的缓存策略。');
doc.decisions = [{
  id: 'cache-strategy',
  title: '缓存放在哪里？',
  description: '比较单实例缓存与共享缓存。',
  options: [
    { id: 'memory', label: '进程内存', description: '无需外部服务。' },
    { id: 'shared', label: '共享缓存', description: '多个实例共享数据。' },
  ],
}];
doc.state.selections['cache-strategy'] = 'shared';
validateDocument(doc);

const store = new DocumentStore('./documents');
const saved = await store.save(doc, 0, true);
await writeFile('cache-plan.html', renderDocument(saved, true));
```

`save(doc, expectedRevision, create)` 在更新时校验版本；`create: true` 创建新文档。使用一个 store 实例串行化写入，临时文件原子替换，并保留上一版本 `.backup`。一个数据目录应由单个宿主进程管理，当前没有跨进程锁。

也可以从 `intelligence-ui/document` 导入 `createDocument`、`validateDocument`、`renderDocument` 和 `mergeDocument`，不加载 HTTP 宿主。此入口仍使用 Node.js 内置模块，不是浏览器入口。

导出 HTML 内嵌完整文档数据。独立打开后继续选择，点击“下载文档”保存新副本，再导入工作台。`mergeDocument(current, next)` 保留仍然有效的选项 ID、备注和历史分析，归档已删除的选择；它不会直接写文件。

## 接入自己的 AI

宿主接受 `ai.complete(messages)`，可以接现有服务或 SDK：

```js
import { startStudio } from 'intelligence-ui';

const studio = await startStudio({
  workspaceRoot: process.cwd(),
  ai: {
    model: 'my-model',
    async complete(messages) {
      return await myModelService.generateText(messages);
    },
  },
});
```

`complete` 返回文本，`messages` 为 `{ role: 'system' | 'user', content: string }[]`。分析操作接受文本；文档更新操作要求返回 JSON，包含 `title`、`description`、`decisions`、`ui`，其结构与现有文档相同，更新后由宿主验证再保存。

内置兼容 `/chat/completions` 的适配器：

```js
import { startStudio, createChatCompletionProvider } from 'intelligence-ui';

const studio = await startStudio({
  ai: createChatCompletionProvider({
    baseURL: process.env.AI_BASE_URL,
    model: process.env.AI_MODEL,
    apiKey: process.env.AI_API_KEY,
  }),
});
```

CLI 读取 `AI_BASE_URL`、`AI_MODEL`、`AI_API_KEY`；三个变量齐全时启用 AI。也兼容 `WORKSPACE_ROOT`、`DOCUMENT_DATA_DIR`、`PORT`，命令行参数优先。密钥只保存在宿主，分析向配置的服务发送所选决策、备注和关联代码片段。未配置 AI 时仅执行明确标识的本地一致性检查。

## CLI 参数

```text
intelligence-ui --workspace <path> --data-dir <path> --port <0-65535>
intelligence-ui --help
intelligence-ui --version
```

`--workspace` / `-w` 指定代码工作区，`--data-dir` 指定文档目录，`--port` / `-p` 指定本地端口。

## 校验与打包

```sh
npm run check:types
npm test
npm pack
```

`npm pack` 自动执行类型检查和测试，产出 `intelligence-ui-0.1.0.tgz`。包的文件白名单仅包括运行代码、声明、CLI、工作台静态资源和 README，不包含本地数据、密钥、测试或开发配置。配置参见 [npm package.json 文档](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/)。当前没有执行 npm 发布，包的 license 为 `UNLICENSED`。

## 边界与协议

宿主只监听 127.0.0.1；不提供多人账户或网络托管。HTML 在仅允许脚本的 sandbox iframe 内预览，宿主校验消息来源、文档 ID、预览版本和状态。文档脚本不获得文件读取或写入能力。

`readReference(workspaceRoot, path, startLine, endLine)` 校验文件 SHA-256。读取禁止绝对路径、父目录、隐藏路径、依赖目录和逃逸符号链接；单文件最多 1 MB，引用最多 501 行。文件变化后分析被阻止，需要重新绑定。尚未实现 AST 符号重定位、调用图或测试运行，宿主不会修改工作区代码。

协议字段为 `manifest / title / description / decisions / ui / state / references / analysis / archivedSelections`。`formatVersion` 为 1，宿主管理 `revision`。完整类型见 `index.d.ts` 和 `types/document.d.ts`。
