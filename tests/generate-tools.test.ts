import { describe, it, expect } from 'vitest';
import { generateTools, resolveSpecPath, loadToolsFromSpecFile, type OpenAPISpec } from '../scripts/generate-tools';

function specWithPath(path: string): OpenAPISpec {
  return {
    paths: {
      [path]: {
        get: { summary: 'test' },
      },
    },
  };
}

describe('generateTools path safety', () => {
  it('accepts a normal relative path', () => {
    const tools = generateTools(specWithPath('/tasks/{id}'));
    expect(tools).toHaveLength(1);
    expect(tools[0].endpoint.path).toBe('/tasks/{id}');
  });

  it('rejects an absolute URL path', () => {
    expect(() => generateTools(specWithPath('https://attacker.example/steal'))).toThrow(
      /resolves to a different origin/
    );
  });

  it('rejects a protocol-relative path', () => {
    expect(() => generateTools(specWithPath('//attacker.example/steal'))).toThrow(/resolves to a different origin/);
  });

  it('rejects a backslash host-override path', () => {
    expect(() => generateTools(specWithPath('/\\attacker.example/steal'))).toThrow(/resolves to a different origin/);
  });
});

describe('resolveSpecPath', () => {
  it('defaults to docs/openapi.yaml when no argument is given', () => {
    expect(resolveSpecPath([])).toBe('docs/openapi.yaml');
  });

  it('accepts a positional argument', () => {
    expect(resolveSpecPath(['./my-api.yaml'])).toBe('./my-api.yaml');
  });

  it('accepts an --openapi flag', () => {
    expect(resolveSpecPath(['--openapi', './my-api.yaml'])).toBe('./my-api.yaml');
  });

  it('prefers --openapi over a positional argument', () => {
    expect(resolveSpecPath(['./ignored.yaml', '--openapi', './my-api.yaml'])).toBe('./my-api.yaml');
  });

  it('throws when --openapi is missing its value', () => {
    expect(() => resolveSpecPath(['--openapi'])).toThrow(/requires a file path/);
  });
});

describe('loadToolsFromSpecFile', () => {
  it('reads and parses an OpenAPI file into tool definitions without writing to disk', () => {
    const tools = loadToolsFromSpecFile('docs/openapi.yaml');
    expect(tools.length).toBeGreaterThan(0);
    expect(tools.some((tool) => tool.name === 'tasks_get')).toBe(true);
  });

  it('throws a clear error for a missing spec file', () => {
    expect(() => loadToolsFromSpecFile('docs/does-not-exist.yaml')).toThrow();
  });
});
