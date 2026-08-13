import { describe, it, expect } from 'vitest';
import { loadTools } from '../src/stdio';

describe('stdio loadTools (in-process)', () => {
  it('generates tools in memory from --openapi without touching src/generated/tools.json', () => {
    const tools = loadTools(['--openapi', 'docs/openapi.yaml']);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.name === 'tasks_get')).toBe(true);
  });

  it('throws a clear error when --openapi points at a missing file', () => {
    expect(() => loadTools(['--openapi', 'docs/does-not-exist.yaml'])).toThrow();
  });

  it('accepts a positional spec path without the --openapi flag', () => {
    const tools = loadTools(['docs/openapi.yaml']);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.name === 'tasks_get')).toBe(true);
  });

  it('throws instead of silently ignoring a positional path that does not exist', () => {
    expect(() => loadTools(['docs/does-not-exist.yaml'])).toThrow();
  });

  it('rejects an unknown option instead of ignoring it', () => {
    expect(() => loadTools(['--openapi=docs/openapi.yaml'])).toThrow(/Unknown option/);
    expect(() => loadTools(['--verbose'])).toThrow(/Unknown option/);
  });

  it('falls back to the pre-generated src/generated/tools.json when no spec path is given', () => {
    const tools = loadTools([]);
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.name === 'tasks_get')).toBe(true);
  });
});
