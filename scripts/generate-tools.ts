import * as fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as yaml from 'yaml';
import type { ToolDefinition } from '../src/tools/executor';

export type { ToolDefinition };

export interface OpenAPISpec {
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

interface Parameter {
  name: string;
  in: string;
  required?: boolean;
  schema?: unknown;
}

function resolveRef(ref: string, spec: OpenAPISpec): unknown {
  if (!ref.startsWith('#/')) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const parts = ref.slice(2).split('/');
  let current: unknown = spec;
  for (const part of parts) {
    if (current === null || typeof current !== 'object') {
      throw new Error(`Could not resolve $ref: ${ref}`);
    }
    current = (current as Record<string, unknown>)[part];
  }
  if (current === undefined) {
    throw new Error(`Could not resolve $ref: ${ref}`);
  }
  return current;
}

function convertSchema(schema: unknown, spec: OpenAPISpec): unknown {
  if (schema === null || typeof schema !== 'object') {
    return schema;
  }
  if (Array.isArray(schema)) {
    return schema.map((item) => convertSchema(item, spec));
  }

  const obj = schema as Record<string, unknown>;
  if (typeof obj.$ref === 'string') {
    return convertSchema(resolveRef(obj.$ref, spec), spec);
  }

  const nullable = obj.nullable === true;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'nullable') {
      continue;
    }
    result[key] = convertSchema(value, spec);
  }
  if (nullable && typeof result.type === 'string') {
    result.type = [result.type, 'null'];
  }
  return result;
}

const PATH_SENTINEL_ORIGIN = 'http://sentinel.invalid';

function assertSafeRelativePath(path: string): void {
  let resolved: URL;
  try {
    resolved = new URL(path, PATH_SENTINEL_ORIGIN);
  } catch {
    throw new Error(`Invalid path in OpenAPI spec: "${path}"`);
  }
  if (resolved.origin !== PATH_SENTINEL_ORIGIN) {
    throw new Error(
      `Unsafe path in OpenAPI spec: "${path}" resolves to a different origin (${resolved.origin}). ` +
        'Paths object keys must be relative paths (e.g. "/tasks/{id}"), not absolute or protocol-relative URLs.'
    );
  }
}

function makeToolName(operation: Record<string, unknown>, method: string, path: string): string {
  if (typeof operation.operationId === 'string' && operation.operationId.length > 0) {
    return operation.operationId;
  }
  const segments = path
    .replace(/^\/api\//, '')
    .split('/')
    .filter(Boolean);
  const normalized = segments.map((segment) => segment.replace(/^\{(.+)\}$/, '$1').replace(/-/g, '_')).join('_');
  return `${normalized}_${method.toLowerCase()}`;
}

export function generateTools(spec: OpenAPISpec): ToolDefinition[] {
  const tools: ToolDefinition[] = [];
  const methods = ['get', 'post', 'put', 'delete', 'patch'];

  for (const [path, pathItem] of Object.entries(spec.paths)) {
    assertSafeRelativePath(path);
    if (pathItem === null || typeof pathItem !== 'object') {
      continue;
    }
    const item = pathItem as Record<string, unknown>;
    for (const method of methods) {
      const operation = item[method];
      if (operation === undefined || operation === null || typeof operation !== 'object') {
        continue;
      }
      const op = operation as Record<string, unknown>;

      const name = makeToolName(op, method, path);
      const summary = typeof op.summary === 'string' ? op.summary : '';
      const description = typeof op.description === 'string' ? op.description.trim() : '';
      const fullDescription = [summary, description].filter(Boolean).join('\n\n');

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const paramMapping: Record<string, { in: string; name: string }> = {};

      const pathItemParams = (item.parameters ?? []) as Parameter[];
      const operationParams = (op.parameters ?? []) as Parameter[];
      const seen = new Set<string>();
      for (const param of [...pathItemParams, ...operationParams]) {
        if (seen.has(param.name)) {
          continue;
        }
        seen.add(param.name);
        properties[param.name] = convertSchema(param.schema ?? { type: 'string' }, spec);
        if (param.required) {
          required.push(param.name);
        }
        paramMapping[param.name] = { in: param.in, name: param.name };
      }

      const requestBody = op.requestBody as Record<string, unknown> | undefined;
      const requestBodySchema = requestBody?.content as Record<string, { schema: unknown }> | undefined;
      const jsonBodySchema = requestBodySchema?.['application/json']?.schema;
      let hasBody = false;
      if (jsonBodySchema !== undefined) {
        hasBody = true;
        const resolved = convertSchema(jsonBodySchema, spec) as Record<string, unknown>;
        const bodyProperties = resolved.properties as Record<string, unknown> | undefined;
        if (bodyProperties !== undefined) {
          for (const [propName, propSchema] of Object.entries(bodyProperties)) {
            properties[propName] = propSchema;
          }
        }
        const bodyRequired = resolved.required as string[] | undefined;
        if (Array.isArray(bodyRequired)) {
          for (const req of bodyRequired) {
            if (!required.includes(req)) {
              required.push(req);
            }
          }
        }
      }

      const inputSchema: Record<string, unknown> = {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties,
      };
      if (required.length > 0) {
        inputSchema.required = required;
      }

      tools.push({
        name,
        description: fullDescription,
        inputSchema,
        endpoint: { method: method.toUpperCase(), path },
        paramMapping,
        hasBody,
      });
    }
  }

  return tools;
}

export function resolveSpecPath(argv: string[]): string {
  const flagIndex = argv.indexOf('--openapi');
  if (flagIndex !== -1) {
    const value = argv[flagIndex + 1];
    if (!value) {
      throw new Error('--openapi requires a file path argument.');
    }
    return value;
  }
  const positional = argv.find((arg) => !arg.startsWith('--'));
  return positional ?? 'docs/openapi.yaml';
}

export function loadToolsFromSpecFile(specPath: string): ToolDefinition[] {
  const raw = fs.readFileSync(specPath, 'utf-8');
  const spec = yaml.parse(raw) as OpenAPISpec;
  return generateTools(spec);
}

function main() {
  const specPath = resolveSpecPath(process.argv.slice(2));
  const tools = loadToolsFromSpecFile(specPath);

  fs.mkdirSync('src/generated', { recursive: true });
  fs.writeFileSync('src/generated/tools.json', JSON.stringify(tools, null, 2));
  console.log(`Generated ${tools.length} tools`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
