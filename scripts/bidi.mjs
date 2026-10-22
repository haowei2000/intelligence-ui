// Minimal WebDriver BiDi driver for scripts/browser-check.mjs: headless Firefox, no dependencies.
// Set FIREFOX_PATH to use another Firefox build. Same interface as cdp.mjs.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const keys = { ArrowLeft: '', ArrowUp: '', ArrowRight: '', ArrowDown: '', Enter: '', Tab: '' };
// RemoteValue to plain JSON-like value; enough for the strings, booleans and arrays the check reads.
const plain = value => {
  if (value.type === 'undefined') return undefined;
  if (value.type === 'null') return null;
  if (value.type === 'array') return value.value.map(plain);
  if (value.type === 'object') return Object.fromEntries(value.value.map(([key, item]) => [typeof key === 'string' ? key : plain(key), plain(item)]));
  return value.value ?? null;
};

export async function launch() {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'iui-firefox-'));
  const executable = process.env.FIREFOX_PATH || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : 'firefox');
  // System access lets the check switch prefers-color-scheme, which BiDi cannot emulate yet.
  const firefox = spawn(executable, ['--headless', '--remote-debugging-port=0', '--remote-allow-system-access', '--profile', profile, '--no-remote', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Firefox did not start WebDriver BiDi: ${output.slice(-500)}`)), 30000);
    firefox.on('error', reject);
    firefox.stderr.on('data', chunk => { output += chunk; const match = output.match(/WebDriver BiDi listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const ws = new WebSocket(`${url}/session`);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.type === 'error' ? reject(new Error(`${message.error}: ${message.message}`)) : resolve(message.result); }
    if (message.method === 'log.entryAdded') logs.push(`${message.params.type}.${message.params.level}: ${message.params.text}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('session.new', { capabilities: {} });
  await send('session.subscribe', { events: ['log.entryAdded'] });
  const context = (await send('browsingContext.getTree')).contexts[0].context;
  const chrome = (await send('browsingContext.getTree', { 'moz:scope': 'chrome' })).contexts[0].context;
  const run = async (expression, target) => {
    const result = await send('script.evaluate', { expression, target: { context: target }, awaitPromise: true, resultOwnership: 'none', serializationOptions: { maxObjectDepth: 20 } });
    if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
    return plain(result.result);
  };
  const evaluate = expression => run(expression, context);
  const resize = (width, height) => send('browsingContext.setViewport', { context, viewport: { width, height } });
  await resize(1280, 900);
  return {
    evaluate, logs, resize,
    colorScheme: scheme => run(`Services.prefs.setIntPref('layout.css.prefers-color-scheme.content-override', ${scheme === 'dark' ? 0 : 1})`, chrome),
    async press(key) {
      if (!keys[key]) throw new Error(`no WebDriver key for ${key}`);
      await send('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [{ type: 'keyDown', value: keys[key] }, { type: 'keyUp', value: keys[key] }] }] });
    },
    async goto(url) { await send('browsingContext.navigate', { context, url, wait: 'complete' }); await new Promise(r => setTimeout(r, 500)); },
    async screenshot(file, width = 1280, height = 900) {
      await resize(width, height);
      const { data } = await send('browsingContext.captureScreenshot', { context, origin: 'document' });
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    async waitFor(expression, ms = 10000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await evaluate(expression).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)); }
      throw new Error(`timeout waiting for ${expression}`);
    },
    close() { ws.close(); firefox.kill(); }
  };
}
