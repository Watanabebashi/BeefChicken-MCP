import * as fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createServer, type ServerAuthInfo } from './server';
import { resolveSpecPath, loadToolsFromSpecFile } from '../scripts/generate-tools';
import type { ToolDefinition } from './tools/executor';

const GENERATED_TOOLS_PATH = fileURLToPath(new URL('./generated/tools.json', import.meta.url));

const KNOWN_FLAGS = new Set(['--openapi']);

export function loadTools(argv: string[]): ToolDefinition[] {
  const unknownFlag = argv.find((arg) => arg.startsWith('--') && !KNOWN_FLAGS.has(arg));
  if (unknownFlag) {
    throw new Error(`Unknown option "${unknownFlag}". Usage: beefchicken-mcp [--openapi] <path-to-openapi.yaml>`);
  }
  const specPathPassed = argv.includes('--openapi') || argv.some((arg) => !arg.startsWith('--'));
  if (specPathPassed) {
    return loadToolsFromSpecFile(resolveSpecPath(argv));
  }
  if (!fs.existsSync(GENERATED_TOOLS_PATH)) {
    throw new Error(
      'No tool definitions found. Pass --openapi <path-to-openapi.yaml> (always required when installed from npm), or run "npm run generate" first if you are running from a cloned repository.'
    );
  }
  return JSON.parse(fs.readFileSync(GENERATED_TOOLS_PATH, 'utf-8')) as ToolDefinition[];
}

export async function main(): Promise<void> {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY environment variable is required to run beefchicken-mcp over stdio.');
  }
  const tools = loadTools(process.argv.slice(2));
  const authInfo: ServerAuthInfo = { token: apiKey, clientId: '', scopes: [] };

  serveStdio(() => createServer({ authInfo, tools }), {
    onerror: (error) => console.error(`[beefchicken-mcp] ${error.message}`),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
