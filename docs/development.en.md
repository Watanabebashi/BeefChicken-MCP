# Development

*English | [日本語](development.md)*

## Running locally

### Node.js

```bash
API_BASE_URL=https://api.example.com npm run node:dev
```

Accessible at `http://127.0.0.1:3000/mcp` (binds to `127.0.0.1` only by default). Attach an `Authorization: Bearer <your target API's API key>` header to requests. To expose it externally, explicitly set `HOST=0.0.0.0` and `ALLOWED_HOSTS`.

### Cloudflare Workers

```bash
npx wrangler dev
```

Accessible at `http://localhost:8787/mcp`.

## Testing

```bash
npm test
npm run typecheck
```

## When updating the OpenAPI spec

After updating `docs/openapi.yaml`, re-run the following:

```bash
npm run generate
npm run typecheck
npm test
```

This regenerates `src/generated/tools.json` and updates the MCP tool definitions.

`npm run generate` validates that every `paths` key resolves to a safe relative path (starting with `/`, not an absolute or protocol-relative URL) and fails the build otherwise. This prevents the target API key from being exfiltrated to a third-party host if `docs/openapi.yaml` is ever replaced with a tampered or malicious spec. Be especially careful when loading a spec from a source you don't fully trust (e.g. an unofficial mirror).
