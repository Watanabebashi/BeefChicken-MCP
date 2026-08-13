# 開発

*[English](development.en.md) | 日本語*

## ローカル実行

### Node.js

```bash
API_BASE_URL=https://api.example.com npm run node:dev
```

`http://127.0.0.1:3000/mcp` でアクセスできます（デフォルトで `127.0.0.1` にのみ bind されます）。リクエストには `Authorization: Bearer <対象APIのAPIキー>` ヘッダーを付与してください。外部公開する場合は `HOST=0.0.0.0` と `ALLOWED_HOSTS` を明示的に設定します。

### Cloudflare Workers

```bash
npx wrangler dev
```

`http://localhost:8787/mcp` でアクセスできます。

### stdio（ローカル MCP クライアント向け）

```bash
API_KEY=<対象APIのAPIキー> npm run stdio -- --openapi ./docs/openapi.yaml
```

標準入出力でJSON-RPCをやり取りします（HTTPサーバーは起動しません）。`--openapi` を省略すると `src/generated/tools.json`（要 `npm run generate`）にフォールバックします。Claude Desktop 等のクライアントに登録する場合の手順は README の「ローカル MCP クライアント（Claude Desktop 等）から直接使う場合」を参照してください（`npm run stdio` はnpmのバナー出力が標準出力に混ざるため、手元での動作確認用途に留め、クライアント設定には使わないでください）。

## テスト

```bash
npm test
npm run typecheck
```

## Lint / フォーマット

```bash
npm run lint          # ESLint（typescript-eslint）
npm run lint:fix      # 自動修正可能な違反を修正
npm run format:check  # Prettier フォーマットチェック
npm run format        # Prettier で自動整形
```

CIの `lint` ジョブが `npm run lint` と `npm run format:check` を実行します。

## カバレッジ閾値

`vitest.config.ts` の `coverage.thresholds` で全体（statements/branches/functions/lines）90%を下回るとCIが失敗します。`bin/**` と `scripts/e2e-*.mjs`（サブプロセスとしてのみ実行され、v8カバレッジが計測できないエントリーポイント）は分母から除外しています。閾値は2026-08-13時点の実測値（約94%）から数ポイント低く設定した安全マージンであり、残存ギャップ（`src/stdio.ts` / `src/node.ts` / `scripts/generate-tools.ts` の `main()` などCLI起動部分）が埋まるにつれて段階的に引き上げる想定です。

## OpenAPI 更新時

`docs/openapi.yaml` を更新したら、以下を再実行してください。

```bash
npm run generate
npm run typecheck
npm test
```

`src/generated/tools.json` が再生成され、MCP ツール定義が更新されます。

`npm run generate` は `paths` のキーが安全な相対パス（`/`始まり、絶対URLやプロトコル相対URLでない）であることを検証し、違反時はビルドを失敗させます。これは `docs/openapi.yaml` を改ざんされた/悪意ある仕様書に差し替えられた場合に、対象APIキーが第三者のホストへ流出することを防ぐためです。出所を信頼できない仕様書（インターネット上の非公式ミラー等）を読み込む際は特に注意してください。
