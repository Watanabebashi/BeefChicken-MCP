import { describe, it, expect, vi, afterEach } from 'vitest';
import { logToolCall } from '../src/logging';

describe('logToolCall', () => {
  afterEach(() => {
    delete process.env.ENABLE_TOOL_CALL_LOGS;
    vi.restoreAllMocks();
  });

  it('stays silent on Node.js runtime when ENABLE_TOOL_CALL_LOGS is not set', () => {
    delete process.env.ENABLE_TOOL_CALL_LOGS;
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logToolCall({ tool: 'tasks_get', authenticated: true, ok: true, durationMs: 1 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('logs a structured JSON line on Node.js runtime when ENABLE_TOOL_CALL_LOGS=true', () => {
    process.env.ENABLE_TOOL_CALL_LOGS = 'true';
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    logToolCall({ tool: 'tasks_get', authenticated: true, ok: true, durationMs: 5 });
    expect(spy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(spy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ tool: 'tasks_get', authenticated: true, ok: true, durationMs: 5 });
    expect(typeof logged.ts).toBe('string');
  });
});
