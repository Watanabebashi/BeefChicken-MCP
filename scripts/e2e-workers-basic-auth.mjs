const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8787';
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 500;

function must(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/mcp`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Server at ${BASE} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

async function main() {
  await waitUntilReady();

  const withBearer = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: 'Bearer real_target_api_key',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  must(withBearer.status === 200, `/mcp with a raw bearer token returns 200 (got ${withBearer.status})`);
  const withBearerText = await withBearer.text();
  must(withBearerText.includes('tasks_get'), '/mcp tools/list includes the expected tool');

  const withoutBearer = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'tasks_get', arguments: {} } }),
  });
  must(
    withoutBearer.status === 200,
    `/mcp tools/call without a bearer token still returns 200 (got ${withoutBearer.status})`
  );
  const withoutBearerText = await withoutBearer.text();
  must(
    withoutBearerText.includes('API key is required'),
    'tool call without a bearer token is rejected as isError with "API key is required"'
  );

  const wellKnown = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  must(wellKnown.status === 404, `OAuth metadata endpoint is 404 when PUBLIC_URL is unset (got ${wellKnown.status})`);

  const register = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://client.example/callback'] }),
  });
  must(register.status === 404, `/register is 404 when PUBLIC_URL is unset (got ${register.status})`);

  console.log('\nAll Workers/wrangler dev basic-auth smoke checks passed.');
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
