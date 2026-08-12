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

## Node.js (shared hosting / self-hosted)

1. Place the app on a hosting environment running Node.js 22.5+ (because it uses `node:sqlite`; this is the real requirement even if you never enable OAuth), and set the Application startup file (or equivalent entry point) to `src/node.ts` (or the built entry file)
2. Run `npm install`
3. If exposing it externally, set the environment variables `HOST=0.0.0.0` and `ALLOWED_HOSTS` including the actual domain name that will be accessed (setting `HOST=0.0.0.0` without `ALLOWED_HOSTS` causes the server to stop with an error at startup)
4. Restart
