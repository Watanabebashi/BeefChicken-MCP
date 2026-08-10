# Authentication

*English | [日本語](oauth.md)*

## API key authentication (default)

Send the target API's API key from the MCP client via the `Authorization: Bearer <API key>` header. This is the only authentication path.

`tools/list` can be fetched without an API key (it only discloses tool schemas), but tool calls (`tools/call`) always require a valid `Authorization` header, with no exceptions. **There is no fallback that sets a default API key as an environment variable on the server side and applies it automatically to requests that omit the header.** This is a deliberate design choice to prevent any third party who can reach `/mcp` from executing tools with the operator's privileges.

For clients like claude.ai Web that cannot directly set a header, see the lightweight OAuth server below for an alternative path.

## Lightweight OAuth server (for claude.ai custom connectors)

claude.ai's Web custom connector has no way to directly specify a static `Authorization` header (as of August 2026, the Request headers feature is in beta and rolling out gradually, unavailable to some accounts). For environments where only an OAuth Client ID/Secret input is available, setting `PUBLIC_URL` makes this server act as a minimal OAuth 2.1 authorization server itself (`src/oauth.ts`). It works on both Cloudflare Workers and Node.js; only the state persistence backend differs per platform.

| Platform | Persistence | Additional setup required |
|---|---|---|
| Node.js | `node:sqlite` (local file, `OAUTH_DB_PATH`) | None in particular. `node:sqlite` is required by the base server regardless of whether OAuth is enabled, so **Node.js 22.5+** is not an OAuth-specific extra requirement (see [Deploy](deploy.en.md)). Since state is persisted to a file, even if the worker process is reclaimed while idle under shared hosting behind Passenger, the next process simply reopens the same file and picks up where it left off (WAL mode). Just make sure `OAUTH_DB_PATH` points to a directory that isn't web-exposed and isn't wiped on every deploy |
| Cloudflare Workers | D1 (`[[d1_databases]]` binding in `wrangler.toml`) | Create a database with `wrangler d1 create` and set `database_id` |

In both cases the schema is created automatically on the first request (no migration command needed).

On both platforms, you also need to set `OAUTH_ENCRYPTION_KEY`, used to encrypt the stored target API key with AES-GCM. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Enabling on Node.js

```bash
PUBLIC_URL=https://your-public-hostname \
OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback \
OAUTH_ENCRYPTION_KEY=<value generated above> \
npm run node:dev
```

### Enabling on Cloudflare Workers

```bash
npx wrangler d1 create beefchicken-mcp-oauth
```

Set the resulting `database_id` in the `[[d1_databases]]` section of `wrangler.toml` (replacing the placeholder `local-only-placeholder-replace-before-deploy`), and set `PUBLIC_URL` and `OAUTH_ALLOWED_REDIRECT_URIS` via `wrangler.toml`'s `[vars]` (or `wrangler secret put`). `OAUTH_ENCRYPTION_KEY` must be a secret, not a `[vars]` entry (`[vars]` is stored in plaintext in the repo):

```bash
npx wrangler secret put OAUTH_ENCRYPTION_KEY
```

Then run `wrangler deploy`.

`wrangler d1 create` is not needed to test locally. Even with `database_id` left as the placeholder in `wrangler.toml`, `wrangler dev` (normal mode, without `--remote`) automatically simulates D1 using a local SQLite file under `.wrangler/state/`. Set `PUBLIC_URL` / `OAUTH_ALLOWED_REDIRECT_URIS` / `OAUTH_ENCRYPTION_KEY` by creating a `.dev.vars` file (git-ignored) at the repository root.

```
# .dev.vars
PUBLIC_URL=https://beefchicken-mcp.test.workers.dev
OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback
OAUTH_ENCRYPTION_KEY=<output of the node -e "..." command above>
```

### Common behavior

- Once `PUBLIC_URL` is set, `/mcp` stops accepting a raw `Authorization: Bearer <API key>` and only accepts opaque access tokens issued via OAuth
- The target API key is persisted to D1/SQLite only in AES-GCM encrypted form, using `OAUTH_ENCRYPTION_KEY` (see [Environment variables](environment.en.md))
- `OAUTH_ALLOWED_REDIRECT_URIS` must explicitly list, as a comma-separated, exact-match, `https://`-only set, the redirect URIs of OAuth clients allowed to connect. Leaving it empty/unset causes an error at startup (Node.js) or at request time (Workers). The callback URL for claude.ai (covering Web, Desktop, mobile, and Cowork's hosted Claude) is fixed at `https://claude.ai/api/mcp/auth_callback` per the [official Anthropic documentation](https://claude.com/docs/connectors/building/authentication#callback-urls), and the example above uses that value. To additionally allow other MCP clients, append their callback URLs to the same comma-separated list

Connection flow: claude.ai automatically walks `/.well-known/oauth-protected-resource/mcp` → `/.well-known/oauth-authorization-server` → `/register` (Dynamic Client Registration), and the browser is redirected to `/authorize`. Entering the target API's API key into the displayed form issues an authorization code, which claude.ai exchanges at `/token` for an access token (1 hour) and a refresh token (90 days, rotated on each use, with a 30-second grace window allowing exactly one resend of the immediately preceding token). Subsequent tool calls are relayed by this server, which internally resolves the access token back to the target API's API key.

### What this lightweight OAuth server does not guarantee

This does not satisfy the property real OAuth assumes: "the user authenticates via an existing trusted means, and long-lived secrets are never exposed externally." The substance of `/authorize` is having the user type a raw API key directly into a form in the browser, and that key passes through this server's process once.

- Anyone who can reach the `/authorize` URL can open this form. **Do not share this URL with anyone else.** `OAUTH_ALLOWED_REDIRECT_URIS` closes off the phishing vector of "an authorization code being redirected to an unregistered redirect_uri," but it does not prevent phishing that lures the legitimate user to the genuine form itself
- Client registrations, authorization codes, access tokens, and refresh tokens each have an expiry, and expired entries are swept periodically. However, no explicit rate limiting is implemented, so if you expose this publicly, apply rate limiting upstream (Cloudflare Tunnel/WAF, etc.)
- Encrypting the API key with `OAUTH_ENCRYPTION_KEY` protects against a leaked DB snapshot or backup **in isolation**. It does not protect against a compromised Workers/Node.js runtime (RCE, SSRF, etc.), since the key is readable from the same environment's secrets
- This is a stopgap implementation intended for a single personal user; do not distribute it to multiple users or use it for a production third-party service. If a permanent solution is needed, the correct approach is to implement a proper OAuth 2.1 authorization server on the target API side, based on the user's login session
