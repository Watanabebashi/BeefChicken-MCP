import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import * as path from 'node:path';

const BIN_PATH = path.join(process.cwd(), 'bin', 'beefchicken-mcp.mjs');

interface JsonRpcMessage {
  id?: number;
  [key: string]: unknown;
}

function spawnBin(args: string[], env: Record<string, string | undefined>) {
  return spawn(process.execPath, [BIN_PATH, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

describe('stdio entrypoint (bin/beefchicken-mcp.mjs -> src/stdio.ts)', () => {
  it('generates tools in-memory from --openapi and serves tools/list over stdio', async () => {
    const child = spawnBin(['--openapi', 'docs/openapi.yaml'], { API_KEY: 'test_key' });
    const stderrChunks: string[] = [];
    child.stderr.on('data', (chunk) => stderrChunks.push(String(chunk)));

    const rl = createInterface({ input: child.stdout });
    const messages: JsonRpcMessage[] = [];
    const waiters: Array<{ predicate: (msg: JsonRpcMessage) => boolean; resolve: (msg: JsonRpcMessage) => void }> = [];

    rl.on('line', (line) => {
      if (!line.trim()) {
        return;
      }
      let msg: JsonRpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      messages.push(msg);
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].predicate(msg)) {
          const [waiter] = waiters.splice(i, 1);
          waiter.resolve(msg);
        }
      }
    });

    function waitFor(predicate: (msg: JsonRpcMessage) => boolean, timeoutMs = 10_000): Promise<JsonRpcMessage> {
      const existing = messages.find(predicate);
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Timed out waiting for a stdio response. stderr: ${stderrChunks.join('')}`));
        }, timeoutMs);
        waiters.push({
          predicate,
          resolve: (msg) => {
            clearTimeout(timer);
            resolve(msg);
          },
        });
      });
    }

    function send(msg: unknown): void {
      child.stdin.write(`${JSON.stringify(msg)}\n`);
    }

    try {
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke-test', version: '0.0.0' },
        },
      });
      const initResponse = (await waitFor((msg) => msg.id === 1)) as {
        result?: { serverInfo?: { name?: string } };
      };
      expect(initResponse.result?.serverInfo?.name).toBe('beefchicken-mcp');

      send({ jsonrpc: '2.0', method: 'notifications/initialized' });

      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      const listResponse = (await waitFor((msg) => msg.id === 2)) as {
        result?: { tools?: Array<{ name: string }> };
      };
      const toolNames = (listResponse.result?.tools ?? []).map((tool) => tool.name);
      expect(toolNames).toContain('tasks_get');
    } finally {
      rl.close();
      child.kill();
    }
  }, 20_000);

  it('falls back to the pre-generated src/generated/tools.json when --openapi is not passed', async () => {
    const child = spawnBin([], { API_KEY: 'test_key' });
    const rl = createInterface({ input: child.stdout });

    try {
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'smoke-test', version: '0.0.0' },
          },
        })}\n`
      );

      const line = await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timed out waiting for initialize response')), 10_000);
        rl.once('line', (received) => {
          clearTimeout(timer);
          resolve(received);
        });
      });
      const response = JSON.parse(line) as { result?: { serverInfo?: { name?: string } } };
      expect(response.result?.serverInfo?.name).toBe('beefchicken-mcp');
    } finally {
      rl.close();
      child.kill();
    }
  }, 20_000);

  it('exits with a clear error when API_KEY is not set', async () => {
    const child = spawnBin(['--openapi', 'docs/openapi.yaml'], { API_KEY: '' });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(stderr).toContain('API_KEY');
  }, 10_000);

  it('exits with a clear error for a missing --openapi file', async () => {
    const child = spawnBin(['--openapi', 'docs/does-not-exist.yaml'], { API_KEY: 'test_key' });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    const [code] = await once(child, 'exit');
    expect(code).toBe(1);
    expect(stderr.length).toBeGreaterThan(0);
  }, 10_000);
});
