#!/usr/bin/env node
// Real-browser check in headless Chrome: the Playground, and the full cycle of a Python Agent, the
// service and the separately hosted frontend under its strict CSP. Also checks color contrast with real
// layout in light and dark mode. Usage: node scripts/browser-check.mjs [screenshot-dir]
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { launch } from './cdp.mjs';
import { createServer } from '../lib/cli.mjs';
import { createAssetHandler } from '../lib/service/assets.mjs';
import { createFrontend } from '../examples/protocol/frontend/server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const shots = process.argv[2];
if (shots) await mkdir(shots, { recursive: true });
const python = ['python3', 'python'].find(command => spawnSync(command, ['--version']).status === 0);
if (!python) { console.error('python3 is required for the Agent'); process.exit(2); }
const freePort = () => new Promise(resolve => { const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });
const listen = (server, port) => new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
const axe = await readFile(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const contrast = `axe.run(document, { runOnly: ['color-contrast'] }).then(r => r.violations.flatMap(v => v.nodes.map(n => n.target.join(' '))))`;

const [servicePort, frontendPort, playgroundPort] = [await freePort(), await freePort(), await freePort()];
const serviceUrl = `http://127.0.0.1:${servicePort}`, frontendOrigin = `http://localhost:${frontendPort}`;
const config = JSON.parse(await readFile(path.join(root, 'examples/protocol/config.json'), 'utf8'));
config.cors = { origins: [frontendOrigin] };
const { server: service } = await createServer(config);
await listen(service, servicePort);
const frontend = createFrontend({ serviceUrl });
await listen(frontend, frontendPort);
const assets = createAssetHandler();
const playground = http.createServer(async (request, response) => { if (!(await assets(request, response))) { response.writeHead(404); response.end(); } });
await listen(playground, playgroundPort);
const agent = spawn(python, [path.join(root, 'examples/protocol/agent-python/agent.py'), '--service', serviceUrl, '--max-events', '1', '--poll', '0.2'], { stdio: 'ignore', env: { ...process.env, AI_BASE_URL: '' } });

const browser = await launch();
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const shot = async (name, width, height) => { if (shots) await browser.screenshot(path.join(shots, name), width, height); };
// Ignore the example image host, which does not resolve by design (the card shows a text fallback).
const errors = () => browser.logs.filter(line => !/ERR_NAME_NOT_RESOLVED/.test(line));
let card = `document.querySelector('#surface > div')?.shadowRoot`;
try {
  for (const scheme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await browser.goto(`http://localhost:${playgroundPort}/assets/playground/`);
    await browser.waitFor(`document.querySelector('#verdict').textContent === 'valid'`);
    await browser.evaluate(`document.querySelector('#publish').click()`);
    await browser.waitFor(`!!${card}?.querySelector('form')`);
    await browser.evaluate(axe);
    const violations = await browser.evaluate(contrast);
    expect(!violations.length, `playground contrast (${scheme}): ${violations.join(', ')}`);
  }
  await browser.evaluate(`(() => { const s = ${card}; s.querySelector('input[value=paris]').click(); s.querySelector('input[value=food]').click(); s.querySelector('button[type=submit]').click(); })()`);
  await browser.waitFor(`${card}.querySelector('.status').textContent.includes('Handled')`);
  expect((await browser.evaluate(`document.querySelector('#events li').textContent`)).includes('"destination":"paris"'), 'playground event values');
  await browser.evaluate(`${card}.querySelector('input[value=berlin]').focus()`);
  for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  expect(await browser.evaluate(`${card}.querySelector('input[value=paris]').checked`), 'arrow keys move the single choice');
  await shot('playground.png');
  await shot('playground-phone.png', 390, 844);
  expect(!(await browser.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)), 'no horizontal scroll at phone width');
  await browser.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  expect(!errors().length, `playground console: ${errors().join(' | ')}`);
  browser.logs.length = 0;

  card = `document.querySelector('#surface [data-document] > div')?.shadowRoot`;
  await browser.goto(frontendOrigin + '/');
  await browser.waitFor(`!!${card}?.querySelector('form')`, 20000);
  expect(await browser.evaluate(`getComputedStyle(${card}.querySelector('.card')).borderRadius`) === '8px', 'nonce styles apply under the strict CSP');
  await shot('frontend-revision-1.png');
  await browser.evaluate(`(() => { const s = ${card}; s.querySelector('input[value=paris]').click(); s.querySelector('input[value=cycling]').click(); s.querySelector('button[type=submit]').click(); })()`);
  await browser.waitFor(`${card}.querySelector('h3').textContent.includes('Paris')`, 20000);
  expect(await browser.evaluate(`${card}.querySelector('input[value=paris]').checked`), 'choice preserved in revision 2');
  await browser.waitFor(`${card}.querySelector('.status').textContent === 'Done.'`, 10000);
  for (const scheme of ['light', 'dark']) {
    await browser.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: scheme }] });
    await browser.evaluate(axe);
    const violations = await browser.evaluate(contrast);
    expect(!violations.length, `frontend contrast (${scheme}): ${violations.join(', ')}`);
    await shot(`frontend-revision-2-${scheme}.png`);
  }
  expect(!errors().length, `frontend console: ${errors().join(' | ')}`);
} catch (error) {
  failures.push(`${error.message}${browser.logs.length ? ` (console: ${browser.logs.join(' | ')})` : ''}`);
} finally {
  browser.close(); agent.kill();
  for (const server of [service, frontend, playground]) { server.closeAllConnections(); server.close(); }
}
if (failures.length) { console.error(`browser check failed:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log(`browser check passed${shots ? `; screenshots in ${shots}` : ''}`);
