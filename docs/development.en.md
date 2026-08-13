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

### stdio (for local MCP clients)

```bash
API_KEY=<your target API's API key> npm run stdio -- --openapi ./docs/openapi.yaml
```

Communicates over stdin/stdout as JSON-RPC (no HTTP server is started). Omit `--openapi` to fall back to `src/generated/tools.json` (requires `npm run generate` first). For registering this with a client like Claude Desktop, see "Use directly from a local MCP client" in the README (don't use `npm run stdio` as the client's launch command — npm's own banner output gets mixed into stdout and breaks stdio JSON-RPC framing; it's fine for a manual one-off check in your terminal).

## Testing

```bash
npm test
npm run typecheck
```

### Node.js support range (runtime vs. development)

`engines.node` in `package.json` is `>=22.5.0` — the version that made `node:sqlite` available. That is the requirement **for running this server**. The CLI installed from npm (`beefchicken-mcp`) pulls only the runtime dependencies, and works fine on 22.5.0.

**Developing in this repository, however, requires 22.13.0 or newer.** ESLint 10 requires `^20.19.0 || ^22.13.0 || >=24`, and the npm bundled with older releases (npm 10.8.2 on Node 22.5.0) hits `Exit handler never called!` against this dependency tree: it exits 0 while never creating `node_modules/.bin/`, so every following command fails with `command not found`.

That is why the `test` job matrix in CI floors at `22.13.0`. `engines` is deliberately left alone, because the runtime requirement has not changed.

## Lint / formatting

```bash
npm run lint          # ESLint (typescript-eslint)
npm run lint:fix      # Auto-fix fixable violations
npm run format:check  # Prettier formatting check
npm run format        # Auto-format with Prettier
```

The CI `lint` job runs `npm run lint` and `npm run format:check`.

## Coverage thresholds

`vitest.config.ts` sets `coverage.thresholds` to fail CI if overall statements/branches/functions/lines coverage drops below 90%. `bin/**` and `scripts/e2e-*.mjs` (entry points that only ever run as a spawned subprocess, which v8 coverage can't observe) are excluded from the denominator. The threshold is a safety margin a few points below the actual measurement taken on 2026-08-13 (~94%), meant to be ratcheted up as the remaining gaps close — mainly the `main()`/CLI-entry guards in `src/stdio.ts`, `src/node.ts`, and `scripts/generate-tools.ts`.

## When updating the OpenAPI spec

After updating `docs/openapi.yaml`, re-run the following:

```bash
npm run generate
npm run typecheck
npm test
```

This regenerates `src/generated/tools.json` and updates the MCP tool definitions.

`npm run generate` validates that every `paths` key resolves to a safe relative path (starting with `/`, not an absolute or protocol-relative URL) and fails the build otherwise. This prevents the target API key from being exfiltrated to a third-party host if `docs/openapi.yaml` is ever replaced with a tampered or malicious spec. Be especially careful when loading a spec from a source you don't fully trust (e.g. an unofficial mirror).
