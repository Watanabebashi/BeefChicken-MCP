const BASE = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000';
const READY_TIMEOUT_MS = 30_000;
const READY_POLL_INTERVAL_MS = 500;

function must(cond, msg) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
}

async function callMcp(method) {
  return fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
  });
}

async function waitUntilReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await callMcp('tools/list');
      if (res.status === 200) {
        return;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
  }
  throw new Error(`Server at ${BASE} did not become ready within ${READY_TIMEOUT_MS}ms`);
}

async function main() {
  await waitUntilReady();

  const res = await callMcp('tools/list');
  must(res.status === 200, `/mcp tools/list returns 200 (got ${res.status})`);
  const text = await res.text();
  must(text.includes('tasks_get'), 'tools/list includes the tool generated from docs/openapi.yaml at container startup');

  console.log('\nAll Docker image smoke checks passed.');
}

main().catch((err) => {
  console.error('ERROR:', err);
  process.exit(1);
});
