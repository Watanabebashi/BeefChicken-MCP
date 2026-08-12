# Deploy

*English | [日本語](deploy.md)*

## Cloudflare Workers

You need a [Cloudflare account](https://dash.cloudflare.com/sign-up). Log in once, the first time.

```bash
npx wrangler login
```

Deploy.

```bash
npx wrangler deploy
```

On success, the command output shows the actual URL (by default `https://beefchicken-mcp.<your-subdomain>.workers.dev/mcp`, determined by `name` in `wrangler.toml`). To use a custom domain, add `routes` to `wrangler.toml`.

Because `[observability]` in `wrangler.toml` is enabled, tool-call logs from `console.log` can be viewed in the Cloudflare dashboard's Workers Logs. We do not set a default API key as a secret (see [Authentication](oauth.en.md)).

If you use the lightweight OAuth server for claude.ai custom connectors, you must replace the placeholder `database_id` in `wrangler.toml` with the actual D1 database ID before deploying (see [Lightweight OAuth server](oauth.en.md)). Running `wrangler deploy` without replacing it will make the OAuth-related endpoints error out in production.

Connect to the deployed URL from your MCP client as follows (the exact config format varies by client):

```json
{
  "mcpServers": {
    "my-api": {
      "type": "http",
      "url": "https://beefchicken-mcp.<your-subdomain>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <your target API's API key>" }
    }
  }
}
```

Note that the "Deploy to Cloudflare" button at the top of the README is a separate path from this procedure. The button forks the repository into your own GitHub/GitLab account and sets up Workers Builds (CI/CD) that auto-deploys on push. If you only want a one-off deploy from a local clone, `wrangler login` → `wrangler deploy` as described above is sufficient. The button itself depends on the repository URL, so enable it in the README only after the publishing repository is finalized and the placeholder has been replaced.

**Note**: The button only forks the repository as-is and builds/deploys it — it has no mechanism for substituting file contents. So the first deploy triggered by clicking the button ships with the bundled sample `docs/openapi.yaml` (the Task API) and with `wrangler.toml`'s `[vars]` still commented out. Since `API_BASE_URL` is unset at that point, every `tools/call` will fail. To actually turn your target API into MCP tools, go to the fork the button created for you and do the following, then push to trigger a redeploy via Workers Builds:

1. Replace `docs/openapi.yaml` with your target API's spec
2. Set `API_BASE_URL` in `wrangler.toml`'s `[vars]` (and `PUBLIC_URL` / `OAUTH_ALLOWED_REDIRECT_URIS` if you're using the lightweight OAuth server).

Do **NOT** put secrets like `OAUTH_ENCRYPTION_KEY` in `[vars]`; set them using one of the following methods:
   * **Via Web Dashboard**: Add it under `Settings > Variables and Secrets` (for runtime). (*Note: Be careful not to add it under `Settings > Build > Build variables and secrets` by mistake*)
   * **Via CLI**: Set it by running `npx wrangler secret put OAUTH_ENCRYPTION_KEY`.
3. Commit and push the changes

## Docker

Pull and run the image from GHCR — no build step required:

```bash
docker run -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e ALLOWED_HOSTS=127.0.0.1,localhost \
  -e API_BASE_URL=https://api.example.com \
  -v $(pwd)/docs/openapi.yaml:/app/docs/openapi.yaml:ro \
  ghcr.io/watanabebashi/beefchicken-mcp
```

- `HOST=0.0.0.0` is required for the container to accept connections from outside; the server refuses to start with `HOST=0.0.0.0` unless `ALLOWED_HOSTS` is also set (DNS-rebinding protection — see [Environment variables](environment.en.md)).
- Mount your own `openapi.yaml` read-only at `/app/docs/openapi.yaml` to target your API. The container's entrypoint (`scripts/docker-entrypoint.sh`) runs `npm run generate` against whatever spec is present at startup, then starts the server — so there's nothing to rebuild when the mounted spec changes, just restart the container.
- Without a mount, the image ships with the bundled sample `docs/openapi.yaml` (the Task API), same as a fresh clone.
- If you use the lightweight OAuth server (`PUBLIC_URL` set), it needs a writable SQLite file; mount a volume at `/app` (or wherever `OAUTH_DB_PATH` points, see [Authentication](oauth.en.md)) if you want tokens to survive container restarts.

### Image tags

| Tag | Meaning | Built from |
|---|---|---|
| `latest` | Newest tagged release | Git tag `vX.Y.Z` |
| `vX.Y.Z`, `vX.Y`, `vX` | A specific release, pinned | Git tag `vX.Y.Z` |
| `edge` | Latest build on the default branch, not necessarily released | Push to `main` |

Published by [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) via `docker/build-push-action`, gated on `npm run typecheck` and `vitest run` passing first.

### Building locally

```bash
docker build -t beefchicken-mcp .
docker run -p 3000:3000 -e HOST=0.0.0.0 -e ALLOWED_HOSTS=localhost -e API_BASE_URL=https://api.example.com beefchicken-mcp
```
## Node.js (shared hosting / self-hosted)

1. Place the app on a hosting environment running Node.js 22.5+ (because it uses `node:sqlite`; this is the real requirement even if you never enable OAuth), and set the Application startup file (or equivalent entry point) to `src/node.ts` (or the built entry file)
2. Run `npm install`
3. If exposing it externally, set the environment variables `HOST=0.0.0.0` and `ALLOWED_HOSTS` including the actual domain name that will be accessed (setting `HOST=0.0.0.0` without `ALLOWED_HOSTS` causes the server to stop with an error at startup)
4. Restart
