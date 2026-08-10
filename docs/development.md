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

## テスト

```bash
npm test
npm run typecheck
```

## OpenAPI 更新時

`docs/openapi.yaml` を更新したら、以下を再実行してください。

```bash
npm run generate
npm run typecheck
npm test
```

`src/generated/tools.json` が再生成され、MCP ツール定義が更新されます。

`npm run generate` は `paths` のキーが安全な相対パス（`/`始まり、絶対URLやプロトコル相対URLでない）であることを検証し、違反時はビルドを失敗させます。これは `docs/openapi.yaml` を改ざんされた/悪意ある仕様書に差し替えられた場合に、対象APIキーが第三者のホストへ流出することを防ぐためです。出所を信頼できない仕様書（インターネット上の非公式ミラー等）を読み込む際は特に注意してください。
