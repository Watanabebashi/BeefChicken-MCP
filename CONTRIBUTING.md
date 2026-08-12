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

## CI and GitHub Actions

This is a public repository that accepts PRs from forks. `pull_request` (the trigger this project uses and intends to keep using) gives fork PR workflow runs a read-only `GITHUB_TOKEN` with no access to secrets by default. Do not switch CI to `pull_request_target` to work around this: since CI needs to build and test the PR's own changes, that would mean checking out and running untrusted fork code with access to this repository's secrets and a write-capable token.

When adding a third-party GitHub Action (coverage reporting, JUnit visualization, etc.), pin it to a commit SHA rather than a mutable tag (e.g. `uses: some/action@<sha>` instead of `@v1`), and keep the marketplace Action's permissions scoped to what the step actually needs.

## Reporting security issues

Do not open a public issue for security vulnerabilities. See [`SECURITY.md`](SECURITY.md) for the private reporting process.

## License

By contributing, you agree that your contributions will be licensed under this project's [MIT License](LICENSE).
