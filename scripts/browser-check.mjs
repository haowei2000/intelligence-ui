#!/usr/bin/env node
// Real-browser check in headless Chrome or Firefox, or in Safari: the Playground, and the full cycle of a Python Agent,
// the service and the separately hosted frontend under its strict CSP. Also checks color contrast with
// real layout in light and dark mode.
// Usage: node scripts/browser-check.mjs [--browser chrome|firefox|safari] [screenshot-dir]
import http from 'node:http';
import net from 'node:net';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from '../lib/cli.mjs';
import { createAssetHandler } from '../lib/service/assets.mjs';
import { createFrontend } from '../examples/protocol/frontend/server.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args = process.argv.slice(2);
const flag = args.indexOf('--browser');
const browserName = flag === -1 ? 'chrome' : args.splice(flag, 2)[1];
const drivers = { chrome: './cdp.mjs', firefox: './bidi.mjs', safari: './webdriver.mjs' };
if (!drivers[browserName]) { console.error(`unknown browser "${browserName}"; use chrome, firefox or safari`); process.exit(2); }
const { launch } = await import(drivers[browserName]);
const shots = args[0];
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

const browser = await launch().catch(error => {
  agent.kill();
  for (const server of [service, frontend, playground]) server.close();
  console.error(`could not start ${browserName}: ${error.message}`);
  process.exit(3);
});
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };
const shot = async (name, width, height) => { if (shots) await browser.screenshot(path.join(shots, name), width, height); };
// Ignore the example image host, which does not resolve by design (the card shows a text fallback).
const errors = async () => { await browser.collect?.(); return browser.logs.filter(line => !/ERR_NAME_NOT_RESOLVED/.test(line)); };
// Safari cannot emulate the color scheme, so it is checked in the system appearance only.
const schemes = async () => browser.colorScheme ? ['light', 'dark'] : [await browser.evaluate(`matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'`)];
const notes = [];
let card = `document.querySelector('#surface > div')?.shadowRoot`;
try {
  const playgroundSchemes = await schemes();
  if (playgroundSchemes.length === 1) notes.push(`color contrast checked in ${playgroundSchemes[0]} mode only`);
  for (const scheme of playgroundSchemes) {
    await browser.colorScheme?.(scheme);
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
  await browser.press('ArrowRight');
  expect(await browser.evaluate(`${card}.querySelector('input[value=paris]').checked`), 'arrow keys move the single choice');
  await shot('playground.png');
  await shot('playground-phone.png', 390, 844);
  expect(!(await browser.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)), 'no horizontal scroll at phone width');
  await browser.resize(1280, 900);
  // All Chart families use the served SVG module and remain usable at phone width.
  await browser.evaluate(`(() => { const select = document.querySelector('#example'); select.value = 'charts'; select.dispatchEvent(new Event('change')); })()`);
  await browser.waitFor(`document.querySelector('#document').value.includes('revenue-bars')`);
  await browser.evaluate(`document.querySelector('#publish').click()`);
  await browser.waitFor(`${card}?.querySelectorAll('.chart svg').length === 3`);
  expect(await browser.evaluate(`${card}.querySelectorAll('svg rect').length === 7`), 'chart grouped bars omit null values');
  await browser.evaluate(`${card}.querySelector('.chart-data summary').click()`);
  expect(await browser.evaluate(`${card}.querySelector('.chart-data').open`), 'chart data table opens');
  for (const scheme of playgroundSchemes) {
    await browser.colorScheme?.(scheme);
    await browser.evaluate(axe);
    const violations = await browser.evaluate(contrast);
    expect(!violations.length, `charts contrast (${scheme}): ${violations.join(', ')}`);
  }
  await shot('charts.png');
  await shot('charts-phone.png', 390, 844);
  await browser.resize(390, 844);
  expect(!(await browser.evaluate(`document.documentElement.scrollWidth > window.innerWidth`)), 'charts have no page overflow at phone width');
  expect(await browser.evaluate(`Array.from(${card}.querySelectorAll('svg')).every(svg => { const r = svg.getBoundingClientRect(); return r.width > 0 && r.right <= window.innerWidth; })`), 'chart graphics fit the phone viewport');
  await browser.resize(1280, 900);
  const playgroundErrors = await errors();
  expect(!playgroundErrors.length, `playground console: ${playgroundErrors.join(' | ')}`);
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
  for (const scheme of await schemes()) {
    await browser.colorScheme?.(scheme);
    await browser.evaluate(axe);
    const violations = await browser.evaluate(contrast);
    expect(!violations.length, `frontend contrast (${scheme}): ${violations.join(', ')}`);
    await shot(`frontend-revision-2-${scheme}.png`);
  }
  const frontendErrors = await errors();
  expect(!frontendErrors.length, `frontend console: ${frontendErrors.join(' | ')}`);
} catch (error) {
  failures.push(`${error.message}${browser.logs.length ? ` (console: ${browser.logs.join(' | ')})` : ''}`);
} finally {
  await browser.close(); agent.kill();
  for (const server of [service, frontend, playground]) { server.closeAllConnections(); server.close(); }
}
if (failures.length) { console.error(`browser check failed in ${browserName}:\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log(`browser check passed in ${browserName}${notes.length ? ` (${notes.join('; ')})` : ''}${shots ? `; screenshots in ${shots}` : ''}`);
