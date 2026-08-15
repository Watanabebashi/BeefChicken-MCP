# BeefChicken MCP 🚀

<div align="center">
  <h3>openapi.yaml を1枚置くだけ。コード記述ゼロでどんなWeb APIも即座にMCPサーバー化</h3>
  <p><strong>簡易OAuth 2.1内蔵の超軽量OpenAPIプロキシサーバー</strong></p>

  <p><a href="README.en.md">English</a> | 日本語</p>
  
  [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Watanabebashi/BeefChicken-MCP)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![MCP Protocol](https://img.shields.io/badge/MCP-Compatible-blue.svg)](https://modelcontextprotocol.io/)
  [![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020.svg?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
  [![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](https://www.docker.com/)
  [![npm version](https://img.shields.io/npm/v/beefchicken-mcp.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/beefchicken-mcp)
  [![npm downloads](https://img.shields.io/npm/dm/beefchicken-mcp.svg?logo=npm&logoColor=white)](https://www.npmjs.com/package/beefchicken-mcp)
</div>

---

## 💡 これは何？

**BeefChicken MCP** は、任意の `openapi.yaml` を配置するだけで、対象の Web API を Claude や Cursor などの **MCPクライアント** から直接呼び出せるようにする汎用 MCP サーバー（プロキシ）です。

特定のAPIに依存する実装コードは一切不要。APIキーを直接指定できないクライアント向けに **簡易 OAuth 2.1 サーバー** まで同梱しているため、**Claude.ai (Web版)** にもそのまま接続できます。

```mermaid
graph LR
    subgraph Client [AIクライアント]
        Claude[🤖 Claude.ai / Cursor 等]
    end

    subgraph Proxy [BeefChicken MCP]
        MCP[⚡ MCPサーバー<br/>Workers / Node.js / Docker]
        OAuth[🔐 内蔵 OAuth 2.1]
    end

    subgraph Target [接続先API]
        Spec[📄 docs/openapi.yaml]
        API[🌐 対象Web API<br/>Stripe / GitHub / 社内API]
    end

    Spec -->|ビルド時/起動時に静的JSON化| MCP
    Claude -->|MCPプロトコル / OAuth| MCP
    MCP -->|ネイティブfetch| API
```

---

## ⚡ なぜ BeefChicken MCP なのか？

### ❌ 従来の課題
- MCPサーバーを作るために、TypeScriptやPythonでツール定義やリクエストハンドラをガリガリ書く必要がある。
- APIの仕様変更のたびにコードを修正・テストして再デプロイするのが大変。
- Claude.ai (Web版) で自作ツールを使いたいが、OAuth 2.1 認証サーバー構築のハードルが高い。

### ✅ BeefChicken MCP なら
- 🧩 **コード記述 0 行**: `docs/openapi.yaml` を繋ぎたいAPIの仕様書に差し替えるだけ！
- 🔐 **Claude.ai (Web版) 即対応**: 簡易 OAuth 2.1 サーバー内蔵で、Web版Claudeのカスタムコネクタも一発接続。
- ⚡️ **サーバー維持費 0 円**: **Cloudflare Workers** に数秒でデプロイ（Docker / Node.js にも対応）。無料枠内ならタダでMCPサーバーがあなたのものに。
- 📥 **デプロイすら不要な最短経路**: Claude Desktop 等のローカルクライアントなら、cloneもビルドも不要。[npm](https://www.npmjs.com/package/beefchicken-mcp) から `npx beefchicken-mcp` で即起動。
- 📦 **超軽量＆ゼロパースオーバーヘッド**: OpenAPI 仕様書はビルド時（Workers）・起動時（Docker）・デプロイ前の `npm run generate`（Node.js）のいずれかで静的 JSON へ変換済み。リクエスト処理中の YAML パースは一切不要。

---

## 📊 他の手段との比較

| 機能 / 特徴 | 手動実装 (TS/Python SDK) | 一般的なMCPフレームワーク (FastMCP等) | **BeefChicken MCP** |
|---|:---:|:---:|:---:|
| **コード記述** | 必要 (多) | 必要 (少) | **不要 (0行・YAML置くだけ)** |
| **OpenAPI対応** | ❌ 要手動変換 | ⚠️ 要ハンドラ実装 | **✅ ファイル差し替えのみ** |
| **OAuth 2.1 サーバー内蔵** | ❌ 自作が必要 | ❌ 自作が必要 | **✅ 内蔵 (Claude Web即対応)** |
| **Cloudflare Workers** | ⚠️ 要調整 | ⚠️ 要調整 | **✅ 完全対応 (ボタンデプロイ)** |
| **実行時フットプリント** | - | 中〜大 | **極小 (静的JSON化)** |

---

## ✨ 主な特徴

- 🧩 **設定ファイルの差し替えだけで完結**: コードを1行も書かずに任意の Web API を MCP ツール化。
- 🎯 **専用プロキシに徹した設計**: 複雑なハンドラ記述を排除し、仕様書通りの純粋なプロキシとして動作。
- 📦 **静的JSON変換**: 実行時の YAML パーサーや `$ref` 解決ロジックを非搭載にし、Worker バンドルサイズを最小化。
- 🔌 **ネイティブ `fetch` 中継**: 余計な HTTP クライアントライブラリを挟まずレスポンスをダイレクト中継。
- 🛡️ **Stateless & Robust**: SSE 長時間保持に依存しない `responseMode: 'json'` 構成。タイムアウト制限に強い堅牢設計。
- 📦 **4通りの配布形態**: Cloudflare Workers / Node.js / Docker イメージ（GHCR）/ npm CLI（`npx beefchicken-mcp`）。用途に応じて選択可能。

> **⚠️ 本番公開前の注意点**:
> 本サーバー自体にはレート制限がありません。公開時は Cloudflare の [Rate Limiting Rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) やリバースプロキシ等で制御してください。また同梱の OAuth 2.1 サーバーは簡易実装です。詳細は [認証ドキュメント](docs/oauth.md) を確認してください。

---

## 🚀 クイックスタート

### 1. 仕様書の配置
`docs/openapi.yaml` を繋ぎたい API の OpenAPI 3.0 仕様書に差し替えます。

> **💡 ヒント**: Stripe や GitHub などの標準 OpenAPI は公式や [APIs.guru](https://github.com/APIs-guru/openapi-directory) 等から入手できます。

```bash
npm install
npm run generate   # docs/openapi.yaml を解析し、src/generated/tools.json を自動生成
```

### 2. デプロイ / 実行

**ローカル MCP クライアント（Claude Desktop 等）の場合 — 最短:**
```bash
npx beefchicken-mcp --openapi /絶対パス/to/openapi.yaml
```
[npm パッケージ](https://www.npmjs.com/package/beefchicken-mcp)として配布しているため、cloneもデプロイも不要です（この経路では手順1の `npm install` / `npm run generate` も不要で、指定した仕様書を起動のたびにオンメモリで解析します）。クライアント設定への具体的な登録方法は[手順4](#4-ローカル-mcp-クライアントclaude-desktop-等から直接使う場合)を参照してください。

**Cloudflare Workers の場合:**
```bash
npx wrangler deploy
```
成功すると `https://beefchicken-mcp.<あなたのサブドメイン>.workers.dev/mcp` が発行されます（D1設定等の詳細は [デプロイ手順](docs/deploy.md) 参照）。

**Node.js の場合:**
```bash
API_BASE_URL=https://api.example.com npm run node:dev
```

**Docker の場合:**
```bash
docker run -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e ALLOWED_HOSTS=127.0.0.1,localhost \
  -e API_BASE_URL=https://api.example.com \
  -v $(pwd)/docs/openapi.yaml:/app/docs/openapi.yaml:ro \
  ghcr.io/watanabebashi/beefchicken-mcp
```
イメージは [GHCR](https://github.com/Watanabebashi/BeefChicken-MCP/pkgs/container/beefchicken-mcp) から配布されており、ビルドは不要です。自分の `openapi.yaml` をマウントすると、コンテナ起動時にそれを解析して `tools.json` を生成します（マウントしない場合は同梱のサンプル仕様書が使われます）。タグは `latest`（最新リリース）・`vX.Y.Z`（特定バージョン固定）・`edge`（main ブランチの最新ビルド）から選べます。ローカルの変更を試したい場合は、従来どおり `docker build -t beefchicken-mcp .` でビルドできます。

### 3. クライアントから接続
発行された URL に対し `Authorization: Bearer <対象APIのAPIキー>` ヘッダーを付けて MCP クライアントに設定します。

### 4. ローカル MCP クライアント（Claude Desktop 等）から直接使う場合

Claude Desktop / Claude Code のように MCP サーバーをサブプロセスとして起動するクライアントには、デプロイ不要で `npx` 経由で直接接続できます。設定ファイル（例: `claude_desktop_config.json`）に以下を追加してください。

```json
{
  "mcpServers": {
    "my-api": {
      "command": "npx",
      "args": ["beefchicken-mcp", "--openapi", "/絶対パス/to/your-api-openapi.yaml"],
      "env": {
        "API_KEY": "<対象APIのAPIキー>",
        "API_BASE_URL": "https://api.example.com"
      }
    }
  }
}
```

- `--openapi` に対象APIの OpenAPI 仕様書への絶対パスを指定すると、起動のたびにオンメモリでツール定義を生成します（事前の `npm run generate` は不要）。フラグを省いた位置引数（`["beefchicken-mcp", "/絶対パス/to/your-api-openapi.yaml"]`）でも同じ動作です。パスを一切指定しなかった場合は、クローン済みリポジトリ内で事前に生成済みの `src/generated/tools.json` にフォールバックします（無ければ起動時にエラーで停止します）。cwd 相対のデフォルト仕様書は意図的に持ちません。MCPクライアントがサブプロセスを起動する際の cwd は予測できないため、必ず絶対パスで指定してください。
- `API_KEY` は必須です。stdio モードは Web版向けの簡易OAuthサーバーを経由せず、`API_KEY` の値をそのまま対象APIへの `Authorization: Bearer` として使います。
- リポジトリを clone した状態でクライアントに登録したい場合は、`command` を `npx`、`args` を `["tsx", "src/stdio.ts", "--openapi", "./docs/openapi.yaml"]` にし、`cwd`（対応しているクライアントの場合）をリポジトリのルートに設定しても同じエントリーポイント（`src/stdio.ts`）が起動します（`npm run stdio` は `npm` のバナー出力が標準出力に混ざり stdio の JSON-RPC 通信を壊すため、クライアント設定には使わないでください。手元のターミナルで単体動作を確認する用途に留めてください）。

---

## 📚 ドキュメント

| トピック | 内容 |
|---|---|
| 🔑 [認証](docs/oauth.md) | APIキーの送信方法・設計方針、claude.ai Web版向けカスタムコネクタの接続方法 |
| ☁️ [デプロイ](docs/deploy.md) | Cloudflare Workers / Node.js / Docker へのデプロイ手順 |
| ⚙️ [環境変数](docs/environment.md) | 全設定項目のリファレンス |
| 🛠 [開発](docs/development.md) | ローカル実行・テスト手順・OpenAPI更新・安全性チェック |

---

## 📜 ライセンス

MIT License. 詳細は [LICENSE](LICENSE) を参照してください。
