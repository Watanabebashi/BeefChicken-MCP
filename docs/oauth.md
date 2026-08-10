# 認証

*[English](oauth.en.md) | 日本語*

## APIキー認証（既定）

対象APIのAPIキーを、MCP クライアントから `Authorization: Bearer <APIキー>` ヘッダーで送信します。これが唯一の認証経路です。

`tools/list` は API キーなしでも取得できますが（ツールのスキーマ開示のみのため）、ツール呼び出し（`tools/call`）は例外なく有効な `Authorization` ヘッダーを要求します。**サーバー側にデフォルトの API キーを環境変数として設定し、ヘッダー未送信のリクエストへ自動的に用いるフォールバックは存在しません。** `/mcp` に到達できる第三者が運営者権限でツールを実行できてしまうことを避けるための意図的な設計です。

claude.ai Web版のようにヘッダーを直接指定できないクライアント向けの代替経路については、以下の簡易OAuthサーバーを参照してください。

## 簡易OAuthサーバー（claude.ai カスタムコネクタ向け）

claude.ai の Web 版カスタムコネクタは静的な `Authorization` ヘッダーを直接指定する手段を持ちません（2026年8月時点、Request headers 機能はベータで段階的ロールアウト中で未提供のアカウントがあります）。OAuth Client ID/Secret の入力欄しか出ない環境向けに、`PUBLIC_URL` を設定するとこのサーバー自身が最小限の OAuth 2.1 認可サーバーとして振る舞います（`src/oauth.ts`）。Cloudflare Workers・Node.js の両方で動作し、状態の永続化先だけがプラットフォームごとに異なります。

| プラットフォーム | 永続化先 | 必要な追加設定 |
|---|---|---|
| Node.js | `node:sqlite`（ローカルファイル、`OAUTH_DB_PATH`） | 特にありません。`node:sqlite` はOAuthを使わない場合も含めてベースサーバーに必須のため、**Node.js 22.5+** はOAuth固有の追加要件ではありません（[デプロイ手順](deploy.md)参照）。ファイルに永続化されるため、Passenger配下の共有ホスティング等でアイドル時にワーカープロセスが回収されても、次のプロセスが同じファイルを開き直すだけで状態を引き継げます（WALモード使用）。ただし `OAUTH_DB_PATH` はWeb非公開かつデプロイのたびに消えないディレクトリに置いてください |
| Cloudflare Workers | D1（`wrangler.toml` の `[[d1_databases]]` バインディング） | `wrangler d1 create` でデータベースを作成し `database_id` を設定します |

どちらもスキーマは初回リクエスト時に自動作成されます（マイグレーションコマンドは不要です）。

どちらのプラットフォームでも、保存する対象APIキーを AES-GCM で暗号化するための `OAUTH_ENCRYPTION_KEY` の設定が別途必要です。生成例:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### Node.js での有効化

```bash
PUBLIC_URL=https://your-public-hostname \
OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback \
OAUTH_ENCRYPTION_KEY=<上記で生成した値> \
npm run node:dev
```

### Cloudflare Workers での有効化

```bash
npx wrangler d1 create beefchicken-mcp-oauth
```

出力される `database_id` を `wrangler.toml` の `[[d1_databases]]` セクションに設定し（プレースホルダー `local-only-placeholder-replace-before-deploy` を置き換えます）、`PUBLIC_URL` と `OAUTH_ALLOWED_REDIRECT_URIS` を `wrangler.toml` の `[vars]`（または `wrangler secret put`）で設定します。`OAUTH_ENCRYPTION_KEY` は secret 専用にしてください（`[vars]` は平文でリポジトリに残るため不可）。

```bash
npx wrangler secret put OAUTH_ENCRYPTION_KEY
```

設定後 `wrangler deploy` します。

ローカルでの動作確認には `wrangler d1 create` は不要です。`wrangler.toml` の `database_id` がプレースホルダーのままでも、`wrangler dev`（`--remote` を付けない通常モード）は D1 を `.wrangler/state/` 配下のローカル SQLite ファイルへ自動的にシミュレートします。`PUBLIC_URL` / `OAUTH_ALLOWED_REDIRECT_URIS` はリポジトリ直下に `.dev.vars`（git 管理外）を作って設定します。

```
# .dev.vars
PUBLIC_URL=https://beefchicken-mcp.test.workers.dev
OAUTH_ALLOWED_REDIRECT_URIS=https://claude.ai/api/mcp/auth_callback
OAUTH_ENCRYPTION_KEY=<node -e "console.log(require('crypto').randomBytes(32).toString('base64'))" の出力>
```

### 共通の挙動

- `PUBLIC_URL` を設定すると `/mcp` は生の `Authorization: Bearer <APIキー>` を受け付けなくなり、OAuthで発行した不透明なアクセストークンのみを受理するようになります
- 保存される対象APIキーは `OAUTH_ENCRYPTION_KEY` を用いて AES-GCM で暗号化された状態でのみ D1/SQLite に永続化されます（詳細は[環境変数](environment.md)参照）
- `OAUTH_ALLOWED_REDIRECT_URIS` には接続を許可するOAuthクライアントの redirect_uri を完全一致・`https://` のみ・カンマ区切りで明示します。空/未設定だと起動時（Node.js）またはリクエスト時（Workers）にエラーになります。claude.ai（Web版・Desktop・mobile・Cowork共通のホスト版Claude）の callback URL は [Anthropic公式ドキュメント](https://claude.com/docs/connectors/building/authentication#callback-urls)で `https://claude.ai/api/mcp/auth_callback` に固定されており、上記の設定例はこれを使用しています。他のMCPクライアントを追加で許可する場合は、そのクライアントの callback URL を同様にカンマ区切りで追記します

接続の流れ: claude.aiが `/.well-known/oauth-protected-resource/mcp` → `/.well-known/oauth-authorization-server` → `/register`（Dynamic Client Registration）を自動で辿り、ブラウザが `/authorize` にリダイレクトされます。表示されたフォームに対象APIのAPIキーを入力すると認可コードが発行され、claude.aiが `/token` でアクセストークン（1時間）とリフレッシュトークン（90日、使用ごとにローテーション、直前の1回だけ再送を許容する30秒の猶予つき）に交換します。以降のツール呼び出しはこのサーバーがアクセストークンを内部で対象APIのAPIキーに解決して中継します。

### この簡易OAuthサーバーが保証しないこと

これは本来のOAuthが前提とする「ユーザーは既存の信頼された手段で認証し、長期シークレットは外部に晒さない」という性質を満たしません。`/authorize` の実体は生のAPIキーをブラウザのフォームに直接入力させることであり、そのキーは一度このサーバーのプロセスを経由します。

- `/authorize` の URL に到達できる人は誰でもこのフォームを開けます。**このURLを他人と共有しないでください。** `OAUTH_ALLOWED_REDIRECT_URIS` は「未登録のredirect_uriへ認可コードを横流しされる」フィッシング経路を塞ぎますが、正規のフォームへ本人を誘導する形のフィッシングそのものは防げません
- クライアント登録・認可コード・アクセストークン・リフレッシュトークンにはそれぞれ有効期限があり、期限切れは定期的に掃除されます。ただし明示的なレート制限は実装していないため、公開する場合は前段（Cloudflare Tunnel/WAF等）でかけてください
- `OAUTH_ENCRYPTION_KEY` によるAPIキーの暗号化は、DBスナップショットやバックアップ**単体**が漏洩した場合の保護であり、Workers/Node.jsの実行環境自体が侵害された場合（RCE・SSRF等）は無効です。鍵も同じ環境の secret から読み出せるためです
- 個人の単一ユーザー利用を前提とした暫定実装であり、複数ユーザーへの配布や本番の第三者向けサービスには使わないでください。恒久的に必要な場合は、対象API側にユーザーのログインセッションに基づく本来のOAuth 2.1認可サーバーを実装するのが正攻法です
