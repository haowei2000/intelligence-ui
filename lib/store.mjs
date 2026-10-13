import { mkdir, readFile, writeFile, rename, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateDocument, hash } from './document.mjs';

export class DocumentStore {
  constructor(directory) { this.directory = directory; this.queue = Promise.resolve(); }
  file(id) {
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('文档 ID 无效');
    return path.join(this.directory, `${id}.json`);
  }
  async list() {
    await mkdir(this.directory, { recursive: true });
    const files = await readdir(this.directory);
    return Promise.all(files.filter(f => f.endsWith('.json')).map(async f => validateDocument(JSON.parse(await readFile(path.join(this.directory, f), 'utf8')))));
  }
  async get(id) { return validateDocument(JSON.parse(await readFile(this.file(id), 'utf8'))); }
  save(doc, expectedRevision, create = false) {
    const job = this.queue.then(async () => {
      validateDocument(doc);
      let existing;
      try { existing = await this.get(doc.manifest.id); } catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (create && existing) throw Object.assign(new Error('文档已经存在'), { status: 409 });
      if (!create && !existing) throw Object.assign(new Error('文档不存在'), { status: 404 });
      if (existing && existing.manifest.revision !== expectedRevision) throw Object.assign(new Error('文档已被其他窗口更新，请重新加载后再修改。'), { status: 409 });
      const saved = structuredClone(doc);
      saved.manifest.revision = existing ? existing.manifest.revision + 1 : 1;
      saved.manifest.updatedAt = new Date().toISOString();
      await mkdir(this.directory, { recursive: true });
      const target = this.file(saved.manifest.id);
      if (existing) await writeFile(`${target}.backup`, JSON.stringify(existing, null, 2), { mode: 0o600 });
      const temp = `${target}.${randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(saved, null, 2), { mode: 0o600 });
      await rename(temp, target);
      return saved;
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

export async function readReference(root, relativePath, startLine = 1, endLine = 100) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath) || relativePath.split(/[\\/]/).some(p => p === '..' || p.startsWith('.')) || !/\.(mjs|js|jsx|ts|tsx|json|md|css|html|py|rs|go|swift|tex)$/.test(relativePath) || relativePath.split(/[\\/]/).includes('node_modules')) throw new Error('只能读取工作区内的代码或文档文件');
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < startLine || endLine - startLine > 500) throw new Error('行范围应为 1–501 行');
  const base = await realpath(root), file = await realpath(path.join(base, relativePath));
  if (!file.startsWith(base + path.sep)) throw new Error('代码引用超出工作区');
  const info = await stat(file);
  if (!info.isFile() || info.size > 1024 * 1024) throw new Error('文件超过 1 MB 或不是普通文件');
  const content = await readFile(file, 'utf8'), lines = content.split('\n');
  if (startLine > lines.length) throw new Error('起始行超出文件范围');
  return { path: relativePath, startLine, endLine: Math.min(endLine, lines.length), hash: hash(content), lineCount: lines.length, content: lines.slice(startLine - 1, endLine).join('\n') };
}
