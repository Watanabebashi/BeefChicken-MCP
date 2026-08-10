# Security Policy

## Supported Versions

This project is pre-1.0 and does not yet maintain multiple supported release lines. Security fixes are applied to the latest commit on `main` only.

| Version | Supported |
|---|---|
| main (latest) | ✅ |
| older tags/commits | ❌ |

## Reporting a Vulnerability

This server proxies Bearer tokens and API keys between MCP clients and upstream APIs, and includes an OAuth 2.1 authorization server. Please report suspected vulnerabilities privately rather than opening a public issue.

Use GitHub's [Private Vulnerability Reporting](https://github.com/Watanabebashi/BeefChicken-MCP/security/advisories/new) feature (Security tab → "Report a vulnerability") to submit details. Do not disclose the issue publicly until a fix has been released.

Please include, where applicable:
- A description of the vulnerability and its potential impact
- Steps to reproduce, or a minimal proof of concept
- Affected component (e.g. OAuth flow, API key handling, tool executor, Origin validation)

We aim to acknowledge reports within a reasonable timeframe and will coordinate disclosure with the reporter.

## Scope

Areas of particular security interest for this project:
- Handling and forwarding of API keys / Bearer tokens (`src/client.ts`, `src/tools/executor.ts`)
- OAuth 2.1 authorization server (`src/oauth.ts`, `src/oauthStore.ts`, `src/oauthStoreD1.ts`)
- `Origin` header / `ALLOWED_ORIGINS` validation (`src/server.ts`)
- SSRF potential via user-configured `API_BASE_URL` or OpenAPI-derived request targets
