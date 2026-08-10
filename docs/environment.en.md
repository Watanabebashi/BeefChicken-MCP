# Environment variables

*English | [日本語](environment.md)*

| Name | Description | Required |
|---|---|---|
| `API_BASE_URL` | Base URL of the target API. Has no default; calling a tool while unset returns a server misconfiguration error | **Required** |
| `MCP_SERVER_NAME` | MCP server name (default: `beefchicken-mcp`) | Optional |
| `MCP_SERVER_DESCRIPTION` | MCP server description text (default: generic text) | Optional |
| `HOST` | Bind address for Node.js (default: `127.0.0.1`) | Optional |
| `ALLOWED_HOSTS` | Allowlist of `Host` header values for Node.js (comma-separated, hostname only, port ignored when comparing) | **Required if `HOST` is `0.0.0.0` or `::`**. Startup fails if unset |
| `ALLOWED_ORIGINS` | Allowlist of `Origin` header values for Node.js (comma-separated, hostname only). When `HOST` is `127.0.0.1`/`localhost`/`::1` (the default), requests with an `Origin` other than localhost are rejected unless this is set. When exposing externally via a tunnel (e.g. Cloudflare Tunnel) or reverse proxy, set the actual public hostname here alongside `ALLOWED_HOSTS` | Optional (restricted to localhost if unset) |
| `PORT` | Listen port for Node.js (default: 3000) | Optional |
| `PUBLIC_URL` | Public HTTPS URL that enables the lightweight OAuth server (see [Lightweight OAuth server](oauth.en.md)). Node.js: environment variable; Workers: `[vars]` in `wrangler.toml` | Optional. `https://` required if set |
| `OAUTH_ALLOWED_REDIRECT_URIS` | Allowlist of OAuth client redirect_uris (comma-separated, exact match). Node.js: environment variable; Workers: `[vars]` in `wrangler.toml` | Required if `PUBLIC_URL` is set |
| `OAUTH_ENCRYPTION_KEY` | Key used to encrypt the target API key at rest with AES-GCM. A base64-encoded 256-bit (32-byte) value. Generate with: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. **Rotating this key makes all stored tokens undecryptable, forcing every user to re-authorize (re-enter their API key)**. This encryption protects against a leaked DB snapshot/backup in isolation — it does not protect against a compromised Workers/Node.js runtime, since the key is readable from the same environment's secrets. Node.js: environment variable; Workers: `wrangler secret put OAUTH_ENCRYPTION_KEY` | Required if `PUBLIC_URL` is set |
| `OAUTH_DB_PATH` | Path to the `node:sqlite` file storing OAuth state, used at Node.js runtime (default: `oauth-state.db`). The target API key is stored encrypted with `OAUTH_ENCRYPTION_KEY`, but as defense in depth, **place it in a directory that isn't directly web-accessible and deny access to `.db` files via `.htaccess` or similar** | Optional |
| `ENABLE_TOOL_CALL_LOGS` | At Node.js runtime, enables structured logging of tool calls (tool name, auth success/failure, HTTP status, duration) when set to `true` | Optional. Always on for Cloudflare Workers (via Workers Logs, controlled by `[observability]` in `wrangler.toml`) |
