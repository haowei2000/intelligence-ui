#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readFile, realpath } from 'node:fs/promises';
import { startStudio, createChatCompletionProvider } from '../lib/host.mjs';

export async function runCLI(args = process.argv.slice(2)) {
  // Protocol and service commands; anything else keeps the 0.2 studio behavior.
  const { commands, runCommand } = await import('../lib/cli.mjs');
  if (commands.has(args[0])) {
    const result = await runCommand(args);
    if (typeof result === 'number') process.exitCode = result;
    return result;
  }
  try {
    const { values } = parseArgs({ args, options: {
      workspace: { type: 'string', short: 'w' },
      'data-dir': { type: 'string' }, port: { type: 'string', short: 'p' },
      help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' }
    } });
    if (values.help) {
      console.log('Usage: intelligence-ui [--workspace <path>] [--data-dir <path>] [--port <0-65535>]\n       intelligence-ui <contract|instructions|validate|fix|serve|mcp|playground> --help\n\n-w, --workspace  Code workspace (default: current directory)\n    --data-dir   Document storage (default: <workspace>/.data/documents)\n-p, --port       Local HTTP port (default: 4310; 0 selects a free port)\n-h, --help       Show help\n-v, --version    Show package version');
      return;
    }
    if (values.version) { console.log(JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version); return; }
    const ai = process.env.AI_BASE_URL && process.env.AI_MODEL && process.env.AI_API_KEY
      ? createChatCompletionProvider({ baseURL: process.env.AI_BASE_URL, model: process.env.AI_MODEL, apiKey: process.env.AI_API_KEY }) : undefined;
    const studio = await startStudio({
      workspaceRoot: values.workspace || process.env.WORKSPACE_ROOT,
      dataDirectory: values['data-dir'] || process.env.DOCUMENT_DATA_DIR,
      port: Number(values.port ?? process.env.PORT ?? 4310), ai
    });
    console.log(`Document Studio: ${studio.url}\nWorkspace: ${studio.workspaceRoot}\nAI: ${ai?.model || '本地检查模式'}`);
    const stop = () => { studio.close().catch(e => { console.error(e.message); process.exitCode = 1; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return studio;
  } catch (error) { console.error(`intelligence-ui: ${error.message}`); process.exitCode = 1; }
}

// npm links executables through node_modules/.bin; compare resolved paths.
if (process.argv[1] && await realpath(path.resolve(process.argv[1])).catch(() => null) === fileURLToPath(import.meta.url)) await runCLI();
