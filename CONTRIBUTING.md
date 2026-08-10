# Contributing

Thanks for your interest in contributing to BeefChicken-MCP.

## Before you start

For anything beyond a small fix (new features, architectural changes), please open an issue first to discuss the approach. This avoids wasted work on PRs that don't fit the project's direction.

## Setup

```bash
npm install
npm run generate   # parses docs/openapi.yaml, generates src/generated/tools.json
```

See [`docs/development.md`](docs/development.md) for running the server locally (Node.js and Cloudflare Workers).

## Before opening a PR

Run the full check locally — this is also what CI enforces:

```bash
npm run typecheck
npm test
```

If you changed `docs/openapi.yaml`, re-run `npm run generate` so `src/generated/tools.json` (gitignored, generated on build/deploy) reflects it before testing.

## Pull requests

- Keep PRs focused on a single change; unrelated cleanups belong in a separate PR.
- Add or update tests under `tests/` for any behavior change.
- Update relevant docs under `docs/` (and `README.md`/`README.en.md` if user-facing) in the same PR.
- Describe the "why" in the PR description, not just the "what".

## Reporting security issues

Do not open a public issue for security vulnerabilities. See [`SECURITY.md`](SECURITY.md) for the private reporting process.

## License

By contributing, you agree that your contributions will be licensed under this project's [MIT License](LICENSE).
