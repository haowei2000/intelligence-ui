// Minimal Chrome DevTools Protocol driver for scripts/browser-check.mjs: headless Chrome, no dependencies.
// Same interface as bidi.mjs.
// Set CHROME_PATH to use another Chromium-based browser.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function launch() {
  const profile = await mkdtemp(path.join(os.tmpdir(), 'iui-chrome-'));
  const executable = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
  const chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise(r => setTimeout(r, 100));
    port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0];
  }
  const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map(); const logs = [];
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
    if (message.method === 'Runtime.consoleAPICalled') logs.push(`console.${message.params.type}: ${message.params.args.map(a => a.value ?? a.description).join(' ')}`);
    if (message.method === 'Runtime.exceptionThrown') logs.push(`exception: ${message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text}`);
    if (message.method === 'Log.entryAdded') logs.push(`log.${message.params.entry.level}: ${message.params.entry.text}`);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  const resize = (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  return {
    send, evaluate, logs, resize,
    colorScheme: scheme => send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] }),
    async press(key) {
      const codes = { ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Enter: 13, Tab: 9 };
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: codes[key] });
    },
    async goto(url) { await send('Page.navigate', { url }); await new Promise(r => setTimeout(r, 1500)); },
    async screenshot(file, width = 1280, height = 900) {
      await resize(width, height);
      const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      await writeFile(file, Buffer.from(data, 'base64'));
    },
    async waitFor(expression, ms = 10000) {
      const end = Date.now() + ms;
      while (Date.now() < end) { if (await evaluate(expression).catch(() => false)) return true; await new Promise(r => setTimeout(r, 100)); }
      throw new Error(`timeout waiting for ${expression}`);
    },
    close() { ws.close(); chrome.kill(); }
  };
}
