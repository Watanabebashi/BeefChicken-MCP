import { describe, it, expect } from 'vitest';
import { generateTools, type OpenAPISpec } from '../scripts/generate-tools';

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
