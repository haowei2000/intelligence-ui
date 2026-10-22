import http from 'node:http';
import { parseArgs } from 'node:util';
import { readFile, writeFile } from 'node:fs/promises';
import { validate } from './protocol/validate.mjs';
import { fix } from './protocol/fix.mjs';
import { instructions } from './protocol/instructions.mjs';
import { createContract } from './protocol/contract.mjs';
import { createUIService, tokenAuth } from './service/service.mjs';
import { MemoryUIStore } from './service/store.mjs';
import { SqliteUIStore } from './service/sqlite-store.mjs';
import { createMCPHandler, serveStdio, createMCPHttpHandler } from './service/mcp.mjs';
import { createAssetHandler } from './service/assets.mjs';

export const commands = new Set(['contract', 'instructions', 'validate', 'fix', 'serve', 'mcp', 'playground']);
// Exit codes: 0 valid / success, 1 invalid document, 2 usage error, 3 input or runtime failure.
const EXIT = { ok: 0, invalid: 1, usage: 2, failure: 3 };
const HELP = `Usage:
  intelligence-ui contract [--deployment <file>] [--out <file>]
  intelligence-ui instructions [--deployment <file>]
  intelligence-ui validate [<file> | -] [--deployment <file>] [--format text|json]
  intelligence-ui fix [<file> | -] [--deployment <file>] [--format text|json] [--write | --out <file>]
  intelligence-ui serve --config <file> [--port <n>] [--host <address>]
  intelligence-ui mcp [--config <file>] [--surface <id>] [--delivery-port <n>]
  intelligence-ui playground [--port <n>]
  intelligence-ui [--workspace <path>] [--port <n>]      (legacy document studio)

--deployment  JSON with createContract options: components, actions, policy, limits.
--config      JSON with { "contract": {...}, "tokens": {...}, "cors": { "origins": [] }, "store": { "sqlite": "ui.db" } }.
validate/fix exit with 0 when valid, 1 when invalid, 2 on usage errors and 3 on I/O errors.
fix never writes files unless --write or --out is given.`;

class UsageError extends Error {}
async function readJSONFile(file, what) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw Object.assign(new Error(`Cannot read ${what} ${file}: ${error.message}`), { exit: EXIT.failure }); }
}
async function loadContract(values) {
  if (values.deployment) return createContract(await readJSONFile(values.deployment, 'deployment'));
  if (values.config) return createContract((await readJSONFile(values.config, 'config')).contract || {});
  return createContract();
}
async function readInput(positional, stdin) {
  const source = positional[0] ?? '-';
  if (source === '-') { const chunks = []; for await (const chunk of stdin) chunks.push(chunk); return { text: Buffer.concat(chunks).toString('utf8'), file: null }; }
  try { return { text: await readFile(source, 'utf8'), file: source }; } catch (error) { throw Object.assign(new Error(`Cannot read ${source}: ${error.message}`), { exit: EXIT.failure }); }
}
function formatDiagnostics(result) {
  const lines = [result.valid ? 'valid' : 'invalid'];
  for (const fixApplied of result.applied || []) lines.push(`  fixed   ${fixApplied.rule} ${fixApplied.path || '/'}`);
  for (const d of result.diagnostics) lines.push(`  ${d.severity.padEnd(7)} ${d.code} ${d.path || '/'}: ${d.message}${d.suggestion ? ` ${d.suggestion}` : ''}`);
  return lines.join('\n');
}
function listen(server, port, host) {
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.removeListener('error', reject); resolve(server.address()); }); });
}
function parsePort(value, fallback) {
  const port = Number(value ?? fallback);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError('port must be an integer between 0 and 65535');
  return port;
}

/** Builds service, MCP-over-HTTP and asset handlers from a config file. */
export async function createServer(config, { log = () => {} } = {}) {
  const contract = createContract(config.contract || {});
  const authenticate = tokenAuth(config.tokens);
  const store = config.store?.sqlite ? new SqliteUIStore(config.store.sqlite, { eventRetentionMs: config.store.eventRetentionMs }) : new MemoryUIStore({ eventRetentionMs: config.store?.eventRetentionMs });
  const service = createUIService({ contract, store, authenticate, cors: config.cors, onError: error => log(`error: ${error.stack || error.message}`) });
  const mcp = createMCPHttpHandler({ authenticate, allowedOrigins: config.cors?.origins || [], handlerFor: principal => createMCPHandler({ service, principal, defaultSurfaceId: principal.defaultSurface }) });
  const assets = createAssetHandler();
  const server = http.createServer(async (request, response) => {
    try {
      if (await service.handle(request, response) || await mcp(request, response) || await assets(request, response)) return;
      response.writeHead(404, { 'Content-Type': 'text/plain' }); response.end('Not found');
    } catch (error) { log(`error: ${error.message}`); if (!response.headersSent) { response.writeHead(500); response.end(); } }
  });
  return { server, service, contract };
}

export async function runCommand(args, { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const [command, ...rest] = args;
  const print = text => stdout.write(text.endsWith('\n') ? text : text + '\n');
  try {
    const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, options: {
      deployment: { type: 'string' }, config: { type: 'string' }, out: { type: 'string' }, write: { type: 'boolean' },
      format: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' }, surface: { type: 'string' }, 'delivery-port': { type: 'string' }, help: { type: 'boolean', short: 'h' }
    } });
    if (values.help) { print(HELP); return EXIT.ok; }
    const format = values.format ?? 'text';
    if (!['text', 'json'].includes(format)) throw new UsageError('--format must be text or json');
    switch (command) {
      case 'contract': {
        const text = JSON.stringify(await loadContract(values), null, 2) + '\n';
        if (values.out) await writeFile(values.out, text); else print(text);
        return EXIT.ok;
      }
      case 'instructions': print(instructions(await loadContract(values))); return EXIT.ok;
      case 'validate': case 'fix': {
        if (positionals.length > 1) throw new UsageError(`${command} takes one input file`);
        if (values.write && values.out) throw new UsageError('use either --write or --out');
        const contract = await loadContract(values);
        const { text, file } = await readInput(positionals, stdin);
        const result = command === 'fix' ? fix(text, { contract }) : validate(text, { contract });
        if (command === 'fix' && (values.write || values.out)) {
          if (values.write && !file) throw new UsageError('--write needs an input file');
          const output = result.valid ? result.document : result.candidate;
          if (output !== undefined) await writeFile(values.out || file, JSON.stringify(output, null, 2) + '\n');
        }
        if (format === 'json') print(JSON.stringify(result, null, 2));
        else if (command === 'fix') {
          // Text mode keeps stdout pipeable: the repaired document goes to stdout, the report to stderr.
          stderr.write(formatDiagnostics(result) + '\n');
          const output = result.valid ? result.document : result.candidate;
          if (!values.write && !values.out && output !== undefined) print(JSON.stringify(output, null, 2));
        } else print(formatDiagnostics(result));
        return result.valid ? EXIT.ok : EXIT.invalid;
      }
      case 'serve': {
        if (!values.config) throw new UsageError('serve needs --config');
        const config = await readJSONFile(values.config, 'config');
        const { server, contract } = await createServer(config, { log: message => stderr.write(message + '\n') });
        const address = await listen(server, parsePort(values.port, config.port ?? 4320), values.host || config.host || '127.0.0.1');
        stderr.write(`Intelligence UI service on http://${address.address}:${address.port}\n  service: /ui  mcp: /mcp  runtime: /assets/runtime.mjs  playground: /assets/playground/\n  contract: ${contract.id}\n`);
        const stop = () => server.close();
        process.once('SIGINT', stop); process.once('SIGTERM', stop);
        return { server };
      }
      case 'mcp': {
        const config = values.config ? await readJSONFile(values.config, 'config') : {};
        const contract = createContract(config.contract || {});
        const surface = values.surface || config.surface || 'default';
        // The stdio client is the local Agent; its identity comes from this process, not from the Agent.
        const principal = { id: 'stdio-agent', roles: ['agent'], surfaces: [surface] };
        const authenticate = tokenAuth(config.tokens);
        const service = createUIService({ contract, authenticate, cors: config.cors, onError: error => stderr.write(`error: ${error.message}\n`) });
        if (values['delivery-port'] !== undefined) {
          const assets = createAssetHandler();
          const server = http.createServer(async (request, response) => { if (await service.handle(request, response) || await assets(request, response)) return; response.writeHead(404); response.end(); });
          const address = await listen(server, parsePort(values['delivery-port']), '127.0.0.1');
          stderr.write(`delivery: http://127.0.0.1:${address.port}/ui/surfaces/${surface}/stream\n`);
        }
        const stdio = serveStdio(createMCPHandler({ service, principal, defaultSurfaceId: surface }), { input: stdin, output: stdout });
        await stdio.done;
        return EXIT.ok;
      }
      case 'playground': {
        const assets = createAssetHandler();
        const server = http.createServer(async (request, response) => {
          if (request.url === '/') { response.writeHead(302, { Location: '/assets/playground/' }); response.end(); return; }
          if (!(await assets(request, response))) { response.writeHead(404); response.end(); }
        });
        const address = await listen(server, parsePort(values.port, 4330), '127.0.0.1');
        stderr.write(`Playground: http://localhost:${address.port}/assets/playground/\n`);
        return { server };
      }
    }
    throw new UsageError(`Unknown command ${command}`);
  } catch (error) {
    if (error instanceof UsageError || error.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || error.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE' || error.code === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL') { stderr.write(`intelligence-ui: ${error.message}\n${HELP}\n`); return EXIT.usage; }
    stderr.write(`intelligence-ui: ${error.message}\n`);
    return error.exit ?? EXIT.failure;
  }
}
