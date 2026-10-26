#!/usr/bin/env node
// Builds the GitHub Pages site into _site/: landing page, rendered docs, the Playground with the
// browser modules it imports, and the raw protocol files. Usage: node scripts/build-site.mjs [outDir]
import { readFile, writeFile, mkdir, rm, cp, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Marked } from 'marked';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.resolve(process.argv[2] || path.join(root, '_site'));
const repo = 'https://github.com/haowei2000/intelligence-ui/blob/main';
const docs = [
  ['quick-start', 'Quick start'], ['api', 'API reference'], ['components', 'Components'], ['protocol', 'Protocol'], ['autofix', 'Validation and Autofix'],
  ['deployment', 'Deployment'], ['security', 'Security'], ['migration', 'Migration'], ['implementation-plan', 'Implementation plan'],
  ['experiments/structured-output', 'Structured output experiment']
];
const rendered = new Set(docs.map(([name]) => name));
const escape = text => text.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const slug = text => text.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');

function markedFor(docName) {
  const depth = docName.split('/').length; // 1 for docs/x.html, 2 for docs/experiments/x.html
  const toRoot = '../'.repeat(depth);
  const marked = new Marked();
  marked.use({
    renderer: {
      // Wide code blocks and tables scroll sideways, so keyboard users must be able to focus them.
      code({ text, lang }) {
        return `<pre tabindex="0"><code${lang ? ` class="language-${escape(lang)}"` : ''}>${escape(text)}</code></pre>\n`;
      },
      heading({ tokens, depth: level }) {
        const html = this.parser.parseInline(tokens);
        return `<h${level} id="${slug(html)}">${html}</h${level}>\n`;
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens);
        let target = href;
        if (!/^[a-z]+:|^#/.test(href)) {
          const [file, hash = ''] = href.split('#');
          const resolved = path.posix.normalize(path.posix.join('docs', path.posix.dirname(docName), file));
          const name = resolved.replace(/^docs\//, '').replace(/\.md$/, '');
          if (resolved.startsWith('docs/') && rendered.has(name)) target = `${toRoot}docs/${name}.html${hash ? `#${hash}` : ''}`;
          else if (resolved.startsWith('protocol/')) target = `${toRoot}${resolved}`;
          else target = `${repo}/${resolved}${hash ? `#${hash}` : ''}`;
        }
        return `<a href="${escape(target)}"${title ? ` title="${escape(title)}"` : ''}>${text}</a>`;
      }
    }
  });
  return { marked, toRoot };
}

function page({ title, body, toRoot, current }) {
  const nav = docs.map(([name, label]) => `<li><a href="${toRoot}docs/${name}.html"${name === current ? ' aria-current="page"' : ''}>${label}</a></li>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escape(title)} · Intelligence UI</title>
  <link rel="icon" href="${toRoot}favicon.svg" type="image/svg+xml">
  <link rel="stylesheet" href="${toRoot}site.css">
</head>
<body>
  <header class="top"><div class="top-inner">
    <a class="brand" href="${toRoot}">Intelligence UI</a>
    <nav aria-label="Main"><a href="${toRoot}docs/quick-start.html"${current && current !== 'api' ? ' aria-current="page"' : ''}>Docs</a><a href="${toRoot}docs/api.html"${current === 'api' ? ' aria-current="page"' : ''}>API</a><a href="${toRoot}playground/">Playground</a><a href="${toRoot}protocol/">Protocol files</a><a href="https://github.com/haowei2000/intelligence-ui">GitHub</a></nav>
  </div></header>
  <div class="layout">
    <nav class="sidebar" aria-label="Documentation"><h2>Docs</h2><ul>${nav}</ul></nav>
    <main class="doc">${body}</main>
  </div>
  <footer><div>MIT License · <a href="https://github.com/haowei2000/intelligence-ui">Source on GitHub</a></div></footer>
</body>
</html>
`;
}

await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, 'docs/experiments'), { recursive: true });
await cp(path.join(root, 'site'), out, { recursive: true });

for (const [name, label] of docs) {
  const { marked, toRoot } = markedFor(name);
  const markdown = await readFile(path.join(root, 'docs', `${name}.md`), 'utf8');
  await writeFile(path.join(out, 'docs', `${name}.html`), page({ title: label, body: marked.parse(markdown), toRoot, current: name }));
}

// The Playground imports ../agent.mjs, ../protocol.mjs and ../runtime.mjs, which import lib/.
for (const file of ['agent.mjs', 'protocol.mjs', 'runtime.mjs']) await cp(path.join(root, file), path.join(out, file));
await mkdir(path.join(out, 'lib/runtime'), { recursive: true });
await cp(path.join(root, 'lib/protocol'), path.join(out, 'lib/protocol'), { recursive: true });
for (const file of ['mount.mjs', 'connect.mjs', 'styles.mjs', 'chart.mjs']) await cp(path.join(root, 'lib/runtime', file), path.join(out, 'lib/runtime', file));
await cp(path.join(root, 'playground'), path.join(out, 'playground'), { recursive: true });
await cp(path.join(root, 'protocol'), path.join(out, 'protocol'), { recursive: true });

// A browsable index of the raw protocol files.
const files = [];
for (const entry of await readdir(path.join(root, 'protocol'), { withFileTypes: true })) {
  if (entry.isFile()) files.push(entry.name);
  else for (const nested of await readdir(path.join(root, 'protocol', entry.name))) files.push(`${entry.name}/${nested}`);
}
const { marked } = markedFor('protocol-index');
const list = files.sort().map(file => `<li><a href="${escape(file)}"><code>${escape(file)}</code></a></li>`).join('');
await writeFile(path.join(out, 'protocol/index.html'), page({
  title: 'Protocol files', toRoot: '../', current: null,
  body: marked.parse('# Protocol files\n\nThese files are the language independent contract. Download them without installing anything; [semantic-rules.md](../protocol/semantic-rules.md) describes the rules JSON Schema cannot express, and `conformance/cases.json` lists the cases every validator must agree on.\n') + `<ul>${list}</ul>`
}));
await writeFile(path.join(out, '.nojekyll'), '');
console.log(`site built in ${out}`);
