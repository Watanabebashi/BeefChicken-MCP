# 環境変数

*[English](environment.en.md) | 日本語*

| 名前 | 説明 | 必須 |
|---|---|---|
| `API_BASE_URL` | 対象APIのベース URL。デフォルト値は持たず、未設定のままツールを呼び出すとサーバー設定不備のエラーを返します | **必須** |
| `MCP_SERVER_NAME` | MCPサーバー名（デフォルト: `beefchicken-mcp`） | 任意 |
| `MCP_SERVER_DESCRIPTION` | MCPサーバーの説明文（デフォルト: 汎用文言） | 任意 |
| `HOST` | Node.js 時の bind アドレス（デフォルト: `127.0.0.1`） | 任意 |
| `ALLOWED_HOSTS` | Node.js 時の `Host` ヘッダー許可リスト（カンマ区切り、ホスト名のみ・ポート無視で比較） | **`HOST` が `0.0.0.0` または `::` の場合は必須。未設定だと起動に失敗します** |
| `ALLOWED_ORIGINS` | Node.js 時の `Origin` ヘッダー許可リスト（カンマ区切り、ホスト名のみ）。`HOST` が `127.0.0.1`/`localhost`/`::1`（デフォルト）のときはこれを設定しない限り`Origin`がlocalhost以外のリクエストは拒否されます。トンネル（Cloudflare Tunnel等）やリバースプロキシ経由で外部公開する場合、`ALLOWED_HOSTS`とあわせて実際の公開ホスト名を設定してください | 任意（未設定時はlocalhost限定） |
| `PORT` | Node.js 時の待受ポート（デフォルト: 3000） | 任意 |
| `PUBLIC_URL` | 簡易OAuthサーバーを有効化する公開HTTPS URL（[簡易OAuthサーバー](oauth.md)参照）。Node.js は環境変数、Workers は `wrangler.toml` の `[vars]` | 任意。設定時は `https://` 必須 |
| `OAUTH_ALLOWED_REDIRECT_URIS` | OAuthクライアントのredirect_uri許可リスト(カンマ区切り、完全一致)。Node.js は環境変数、Workers は `wrangler.toml` の `[vars]` | `PUBLIC_URL` 設定時は必須 |
| `OAUTH_ENCRYPTION_KEY` | 対象APIキーを保存時に AES-GCM で暗号化するための鍵。base64エンコードされた256bit（32byte）値。生成例: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`。**鍵を変更すると保存済みの全トークンが復号不能になり、全ユーザーの再認可（APIキー再入力）が必要になります**。この暗号化はDBスナップショット/バックアップ単体の漏洩を防ぐものであり、Workers/Node.jsの実行環境自体が侵害された場合（鍵も同じ環境の secret から読めるため）は保護になりません。Node.js は環境変数、Workers は `wrangler secret put OAUTH_ENCRYPTION_KEY` | `PUBLIC_URL` 設定時は必須 |
| `OAUTH_DB_PATH` | Node.js 実行時、OAuth状態を保存する `node:sqlite` ファイルパス（デフォルト: `oauth-state.db`）。対象APIキーは `OAUTH_ENCRYPTION_KEY` で暗号化された状態で保存されますが、多層防御として **Webから直接アクセスできないディレクトリに置き、`.htaccess` 等で `.db` へのアクセスを拒否してください** | 任意 |
| `ENABLE_TOOL_CALL_LOGS` | Node.js 実行時、ツール呼び出しの構造化ログ（ツール名・認証成否・HTTPステータス・所要時間）を有効化（`true` で有効） | 任意。Cloudflare Workers では常時有効（Workers Logs 経由、`wrangler.toml` の `[observability]` で制御） |
