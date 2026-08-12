const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8787';
const REDIRECT_URI = 'https://client.example/callback';
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
      const res = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
      if (res.status === 200 || res.status === 404) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Server at ${BASE} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

async function main() {
  await waitUntilReady();

  const meta = await fetch(`${BASE}/.well-known/oauth-authorization-server`);
  must(meta.status === 200, `metadata endpoint returns 200 (got ${meta.status})`);
  const metaBody = await meta.json();
  must(metaBody.issuer === 'https://mcp.example.com', `issuer matches PUBLIC_URL (got ${metaBody.issuer})`);

  const registerRes = await fetch(`${BASE}/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT_URI] }),
  });
  must(registerRes.status === 201, `register returns 201 (got ${registerRes.status})`);
  const { client_id } = await registerRes.json();
  must(Boolean(client_id), `client_id issued (${client_id})`);

  const verifier = 'test-code-verifier-1234567890123456789012345678901234567890';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = Buffer.from(digest).toString('base64url');

  const authorizeUrl = new URL(`${BASE}/authorize`);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', client_id);
  authorizeUrl.searchParams.set('redirect_uri', REDIRECT_URI);
  authorizeUrl.searchParams.set('state', 'xyz');
  authorizeUrl.searchParams.set('code_challenge', challenge);
  const getAuthRes = await fetch(authorizeUrl, { redirect: 'manual' });
  must(getAuthRes.status === 200, `GET /authorize returns 200 (got ${getAuthRes.status})`);
  const setCookie = getAuthRes.headers.get('set-cookie') ?? '';
  const csrfMatch = setCookie.match(/oauth_csrf=([^;]+)/);
  must(Boolean(csrfMatch), `oauth_csrf cookie set (${setCookie})`);
  const csrfToken = csrfMatch[1];

  const form = new URLSearchParams({
    client_id,
    redirect_uri: REDIRECT_URI,
    state: 'xyz',
    code_challenge: challenge,
    api_key: 'real_target_api_key',
    csrf_token: csrfToken,
  });
  const postAuthRes = await fetch(`${BASE}/authorize`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: `oauth_csrf=${csrfToken}`,
    },
    body: form.toString(),
    redirect: 'manual',
  });
  must(postAuthRes.status === 302, `POST /authorize returns 302 (got ${postAuthRes.status})`);
  const location = new URL(postAuthRes.headers.get('location'));
  const code = location.searchParams.get('code');
  must(Boolean(code), `authorization code issued (${code})`);

  const tokenForm = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
    client_id,
  });
  const tokenRes = await fetch(`${BASE}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: tokenForm.toString(),
  });
  must(tokenRes.status === 200, `POST /token returns 200 (got ${tokenRes.status})`);
  const { access_token, refresh_token } = await tokenRes.json();
  must(Boolean(access_token) && Boolean(refresh_token), 'access_token and refresh_token issued');

  const mcpRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${access_token}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  must(mcpRes.status === 200, `/mcp with real access_token returns 200 (got ${mcpRes.status})`);
  const mcpText = await mcpRes.text();
  must(mcpText.includes('tasks_get'), '/mcp tools/list includes the expected tool');

  const noTokenRes = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  must(noTokenRes.status === 401, `/mcp without a token returns 401 (got ${noTokenRes.status})`);

  console.log('\nAll Workers/wrangler dev smoke checks passed.');
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
