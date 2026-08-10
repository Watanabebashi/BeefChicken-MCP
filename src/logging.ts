import { getRuntimeKey } from 'hono/adapter';

export interface ToolCallLogEntry {
  tool: string;
  authenticated: boolean;
  ok: boolean;
  httpStatus?: number;
  durationMs: number;
}

function isEnabled(): boolean {
  if (getRuntimeKey() === 'workerd') {
    return true;
  }
  const env = typeof process !== 'undefined' ? process.env : undefined;
  return env?.ENABLE_TOOL_CALL_LOGS === 'true';
}

export function logToolCall(entry: ToolCallLogEntry): void {
  if (!isEnabled()) {
    return;
  }
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...entry }));
}
