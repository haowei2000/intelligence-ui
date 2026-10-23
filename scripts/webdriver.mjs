// Minimal W3C WebDriver driver for scripts/browser-check.mjs: Safari through safaridriver, no dependencies.
// Same interface as cdp.mjs, except that Safari cannot emulate prefers-color-scheme (no colorScheme: the
// check uses the system appearance) and exposes no console: page errors are captured from inside the
// page after each navigation, so errors thrown while the page loads are not seen.
// Needs Safari > Settings > Developer > Allow remote automation. Opens a visible window.
import { spawn } from 'node:child_process';
import net from 'node:net';
import { writeFile } from 'node:fs/promises';

const keys = { ArrowLeft: '', ArrowUp: '', ArrowRight: '', ArrowDown: '', Enter: '', Tab: '' };
const capture = `if (!window.__iuiLogs) {
  const logs = window.__iuiLogs = [];
  for (const level of ['error', 'warn']) { const original = console[level]; console[level] = (...args) => { logs.push('console.' + level + ': ' + args.join(' ')); original.apply(console, args); }; }
  addEventListener('error', event => logs.push('exception: ' + event.message));
  addEventListener('unhandledrejection', event => logs.push('exception: ' + event.reason));
  document.addEventListener('securitypolicyviolation', event => logs.push('csp: ' + event.violatedDirective + ' blocked ' + event.blockedURI), true);
}`;

export async function launch() {
  const port = await new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
  const driver = spawn(process.env.SAFARIDRIVER_PATH || 'safaridriver', ['-p', String(port)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/status`).then(r => r.ok, () => false)) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const request = async (method, path, body) => {
    const response = await fetch(base + path, { method, headers: { 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
    const { value } = await response.json();
    if (!response.ok) throw new Error(`${value.error}: ${value.message}`);
    return value;
  };
  const session = await request('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'safari' } } }).catch(error => { driver.kill(); throw error; });
  const send = (method, path, body) => request(method, `/session/${session.sessionId}${path}`, body);
  await send('POST', '/timeouts', { script: 30000 });
  const logs = [];
  const run = body => send('POST', '/execute/async', { args: [], script: `const done = arguments[0];
    Promise.resolve().then(async () => { ${body} }).then(value => done({ ok: true, value }), error => done({ ok: false, error: String(error && error.stack || error) }));` });
  // Scripts run as a function body; try the source as an expression first, then as statements (axe).
  const evaluate = async source => {
    let result = await run(`return (${source}\n);`).catch(error => /SyntaxError|Unexpected|Parse error/i.test(error.message) ? null : Promise.reject(error));
    result ??= await run(`${source}\n;`);
    if (!result.ok) throw new Error(result.error);
    return result.value;
  };
  const collect = async () => { logs.push(...await evaluate(`(window.__iuiLogs || []).splice(0)`).catch(() => [])); };
  const resize = (width, height) => send('POST', '/window/rect', { width, height });
  await resize(1280, 900);
  return {
    evaluate, logs, resize, collect,
    async press(key) {
      if (!keys[key]) throw new Error(`no WebDriver key for ${key}`);
      await send('POST', '/actions', { actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: keys[key] }, { type: 'keyUp', value: keys[key] }] }] });
    },
    async goto(url) { await collect(); await send('POST', '/url', { url }); await run(capture); await new Promise(r => setTimeout(r, 500)); },
    async screenshot(file, width = 1280, height = 900) {
      await resize(width, height);
      await new Promise(r => setTimeout(r, 300));
      await writeFile(file, Buffer.from(await send('GET', '/screenshot'), 'base64'));
    },
    async waitFor(expression, ms = 10000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await evaluate(expression).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)); }
      throw new Error(`timeout waiting for ${expression}`);
    },
    async close() { await send('DELETE', '').catch(() => {}); driver.kill(); }
  };
}
