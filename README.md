# Document Studio

本地交互文档宿主。一个文档同时携带方案、稳定 ID 的选项、用户状态、代码引用和分析结果。

## 启动

需要 Node.js 22 或更新版本，无第三方依赖。

```sh
npm start
```

打开 http://localhost:4310 。开发时可运行 `npm run dev`，测试运行 `npm test`。

## 已实现

- 创建文档、选择方案、编辑备注，自动保存到 `.data/documents/`。
- 串行化写入、临时文件原子替换、上一个版本 `.backup` 和 revision 冲突校验。
- 导入 JSON 或本应用导出的 HTML；导入创建独立文档 ID。
- 导出单文件 HTML，包含完整 JSON 数据、界面、选择、引用和分析记录。独立打开后可继续选择；点击“下载更新后的文档”保存新的文件。
- 文档预览运行在仅允许脚本的 sandbox iframe 中；通过受校验的 postMessage 更新状态。预览不允许网络请求，不获得工作区读取或文件写入能力。
- 绑定真实工作区文件与行范围，SHA-256 校验文件版本，查看代码；引用变化会阻止分析，需重新绑定。
- 未配置 AI 时运行明确标识的本地一致性检查。配置后可分析所选方案、更新文档内容，并按稳定 ID 保留选择、归档失效选择。

## 工作区与 AI 配置

默认代码工作区为本项目目录。读取其他项目时显式设置：

```sh
WORKSPACE_ROOT=/absolute/path/to/project npm start
```

AI 适配器使用支持 `/chat/completions` 的服务，密钥只保存在宿主进程。设置下面三个环境变量后重启：

```sh
export AI_BASE_URL=https://your-provider.example/v1
export AI_MODEL=your-model
export AI_API_KEY=your-key
npm start
```

也可使用 `node --env-file=.env server.mjs`，`.env` 已被忽略。AI 分析会把所选决策、备注和关联代码片段发送给配置的服务。修改监听端口可设置 `PORT`。

## 第一版边界

应用仅监听本机 127.0.0.1，不提供多人账户或网络托管。HTML 独立副本不会直接覆写原文件，需下载新副本再导入。代码定位使用路径、文件内容摘要和行范围，尚未实现 AST 符号重定位、调用图或测试运行。更新操作不会修改工作区代码。AI 服务未配置时更新按钮禁用；真实供应商集成需要使用用户自己的配置验证。

文档协议为 `manifest / title / description / decisions / ui / state / references / analysis / archivedSelections`。`formatVersion` 当前为 1；宿主管理 `revision`。预览只接受当前 iframe、文档 ID 与预览版本的状态消息；保存再次校验选项和状态。文件读取禁止绝对路径、父目录、隐藏路径、依赖目录和逃逸符号链接，单文件上限 1 MB，引用最多 501 行。
