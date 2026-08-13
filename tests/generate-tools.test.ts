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

describe('generateTools $ref resolution', () => {
  it('resolves a $ref pointing at components.schemas', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Widget' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Widget: {
            type: 'object',
            properties: { name: { type: 'string' } },
            required: ['name'],
          },
        },
      },
    };
    const tools = generateTools(spec);
    expect(tools[0].inputSchema).toMatchObject({
      properties: { name: { type: 'string' } },
      required: ['name'],
    });
  });

  it('resolves a $ref nested inside another referenced schema', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Widget' } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Widget: {
            type: 'object',
            properties: { owner: { $ref: '#/components/schemas/Owner' } },
          },
          Owner: { type: 'string' },
        },
      },
    };
    const tools = generateTools(spec);
    const properties = (tools[0].inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.owner).toEqual({ type: 'string' });
  });

  it('throws for a non-local $ref', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: 'https://external.example/schema.json' } } },
            },
          },
        },
      },
    };
    expect(() => generateTools(spec)).toThrow(/Unsupported \$ref/);
  });

  it('throws for a $ref that does not resolve to anything', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/DoesNotExist' } } },
            },
          },
        },
      },
      components: { schemas: {} },
    };
    expect(() => generateTools(spec)).toThrow(/Could not resolve \$ref/);
  });
});

describe('generateTools nullable conversion', () => {
  it('converts nullable: true with a string type into a type array', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          get: {
            parameters: [{ name: 'label', in: 'query', schema: { type: 'string', nullable: true } }],
          },
        },
      },
    };
    const tools = generateTools(spec);
    const properties = (tools[0].inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.label).toEqual({ type: ['string', 'null'] });
  });

  it('strips nullable without touching a non-string type', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          get: {
            parameters: [{ name: 'count', in: 'query', schema: { type: ['integer', 'null'], nullable: true } }],
          },
        },
      },
    };
    const tools = generateTools(spec);
    const properties = (tools[0].inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.count).toEqual({ type: ['integer', 'null'] });
  });

  it('drops the nullable keyword even when there is no type to convert', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          get: {
            parameters: [{ name: 'anything', in: 'query', schema: { nullable: true, description: 'x' } }],
          },
        },
      },
    };
    const tools = generateTools(spec);
    const properties = (tools[0].inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.anything).toEqual({ description: 'x' });
  });
});

describe('generateTools tool naming', () => {
  it('uses operationId when present', () => {
    const spec: OpenAPISpec = {
      paths: { '/widgets/{id}': { get: { operationId: 'getWidgetById' } } },
    };
    const tools = generateTools(spec);
    expect(tools[0].name).toBe('getWidgetById');
  });

  it('derives a name from the path and method when operationId is absent', () => {
    const spec: OpenAPISpec = {
      paths: { '/api/widgets/{widget-id}': { get: {} } },
    };
    const tools = generateTools(spec);
    expect(tools[0].name).toBe('widgets_widget_id_get');
  });

  it('ignores an empty-string operationId and falls back to the derived name', () => {
    const spec: OpenAPISpec = {
      paths: { '/widgets': { get: { operationId: '' } } },
    };
    const tools = generateTools(spec);
    expect(tools[0].name).toBe('widgets_get');
  });
});

describe('generateTools requestBody expansion', () => {
  it('merges JSON request body properties and required fields into the input schema', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            parameters: [{ name: 'dryRun', in: 'query', schema: { type: 'boolean' } }],
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' }, dryRun: { type: 'string' } },
                    required: ['name'],
                  },
                },
              },
            },
          },
        },
      },
    };
    const tools = generateTools(spec);
    const tool = tools[0];
    expect(tool.hasBody).toBe(true);
    const schema = tool.inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(schema.properties.name).toEqual({ type: 'string' });
    // Query parameter mapping wins over a same-named body property.
    expect(tool.paramMapping.dryRun).toEqual({ in: 'query', name: 'dryRun' });
    expect(schema.required).toEqual(['name']);
  });

  it('does not duplicate a required field already required by a path/query parameter', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            parameters: [{ name: 'name', in: 'query', required: true, schema: { type: 'string' } }],
            requestBody: {
              content: {
                'application/json': {
                  schema: { type: 'object', properties: {}, required: ['name'] },
                },
              },
            },
          },
        },
      },
    };
    const tools = generateTools(spec);
    const schema = tools[0].inputSchema as { required: string[] };
    expect(schema.required).toEqual(['name']);
  });

  it('sets hasBody false when there is no requestBody', () => {
    const spec: OpenAPISpec = { paths: { '/widgets': { get: {} } } };
    const tools = generateTools(spec);
    expect(tools[0].hasBody).toBe(false);
    expect(tools[0].inputSchema).not.toHaveProperty('required');
  });

  it('sets hasBody false when requestBody has no application/json content', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } },
          },
        },
      },
    };
    const tools = generateTools(spec);
    expect(tools[0].hasBody).toBe(false);
  });

  it('sets hasBody true without merging properties when the body schema has none', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { type: 'array', items: { type: 'string' } } } },
            },
          },
        },
      },
    };
    const tools = generateTools(spec);
    const tool = tools[0];
    expect(tool.hasBody).toBe(true);
    expect(tool.inputSchema).toMatchObject({ properties: {} });
  });
});

describe('generateTools parameter merging', () => {
  it('merges path-item-level and operation-level parameters', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            parameters: [{ name: 'verbose', in: 'query', schema: { type: 'boolean' } }],
          },
        },
      },
    };
    const tools = generateTools(spec);
    const tool = tools[0];
    expect(tool.paramMapping.id).toEqual({ in: 'path', name: 'id' });
    expect(tool.paramMapping.verbose).toEqual({ in: 'query', name: 'verbose' });
    expect((tool.inputSchema as { required: string[] }).required).toEqual(['id']);
  });

  it('lets the path-item-level parameter win over a same-named operation-level parameter', () => {
    const spec: OpenAPISpec = {
      paths: {
        '/widgets/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          get: {
            parameters: [{ name: 'id', in: 'query', schema: { type: 'number' } }],
          },
        },
      },
    };
    const tools = generateTools(spec);
    const tool = tools[0];
    expect(tool.paramMapping.id).toEqual({ in: 'path', name: 'id' });
    const properties = (tool.inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.id).toEqual({ type: 'string' });
  });

  it('defaults a parameter with no schema to type: string', () => {
    const spec: OpenAPISpec = {
      paths: { '/widgets': { get: { parameters: [{ name: 'q', in: 'query' }] } } },
    };
    const tools = generateTools(spec);
    const properties = (tools[0].inputSchema as { properties: Record<string, unknown> }).properties;
    expect(properties.q).toEqual({ type: 'string' });
  });
});

describe('generateTools operation and path-item filtering', () => {
  it('skips a path item that is not an object', () => {
    const spec: OpenAPISpec = { paths: { '/widgets': null as unknown as Record<string, unknown> } };
    expect(generateTools(spec)).toHaveLength(0);
  });

  it('skips a method entry that is not an object', () => {
    const spec: OpenAPISpec = { paths: { '/widgets': { get: 'not-an-operation' } } };
    expect(generateTools(spec)).toHaveLength(0);
  });

  it('generates one tool per declared HTTP method on the same path', () => {
    const spec: OpenAPISpec = {
      paths: { '/widgets': { get: {}, post: {}, put: {}, delete: {}, patch: {} } },
    };
    const tools = generateTools(spec);
    expect(tools.map((t) => t.endpoint.method).sort()).toEqual(['DELETE', 'GET', 'PATCH', 'POST', 'PUT']);
  });

  it('joins summary and description into the tool description', () => {
    const spec: OpenAPISpec = {
      paths: { '/widgets': { get: { summary: 'List widgets', description: '  Returns all widgets.  ' } } },
    };
    const tools = generateTools(spec);
    expect(tools[0].description).toBe('List widgets\n\nReturns all widgets.');
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
