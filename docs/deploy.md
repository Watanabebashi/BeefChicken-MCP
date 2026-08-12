# デプロイ

*[English](deploy.en.md) | 日本語*

## Cloudflare Workers

前提として [Cloudflare アカウント](https://dash.cloudflare.com/sign-up) が必要です。初回のみログインします。

```bash
npx wrangler login
```

デプロイします。

```bash
npx wrangler deploy
```

デプロイに成功すると、コマンドの出力に実際のURL（既定では `https://beefchicken-mcp.<あなたのサブドメイン>.workers.dev/mcp`。`wrangler.toml` の `name` から決まります）が表示されます。独自ドメインを使いたい場合は `wrangler.toml` に `routes` を追加してください。

`wrangler.toml` の `[observability]` を有効化しているため、`console.log` によるツール呼び出しログは Cloudflare ダッシュボードの Workers Logs から確認できます。デフォルトの API キーをシークレットとして設定する運用は行いません（[認証](oauth.md)参照）。

claude.ai カスタムコネクタ向けに簡易OAuthサーバーを使う場合は、デプロイ前に `wrangler.toml` の `database_id`（プレースホルダーのまま）を実際のD1データベースIDに置き換える必要があります（[簡易OAuthサーバー](oauth.md)参照）。置き換えずに `wrangler deploy` すると、本番環境でOAuth関連エンドポイントがエラーになります。

デプロイしたURLに対して、MCPクライアント側で以下のように接続します（設定形式はクライアントによって異なります）。

```json
{
  "mcpServers": {
    "my-api": {
      "type": "http",
      "url": "https://beefchicken-mcp.<あなたのサブドメイン>.workers.dev/mcp",
      "headers": { "Authorization": "Bearer <対象APIのAPIキー>" }
    }
  }
}
```

なお、README冒頭の Deploy to Cloudflare ボタンは、この手順とは別の導線です。ボタンは自分の GitHub/GitLab アカウントにリポジトリを複製し、push 時に自動デプロイされる Workers Builds（CI/CD）まで設定します。ローカルの clone から一度だけ手元でデプロイしたい場合は、本項の `wrangler login` → `wrangler deploy` で十分です。ボタン自体はリポジトリのURLに依存するため、公開先リポジトリが確定してからREADME内のプレースホルダーを差し替えて有効化してください。

**注意**: ボタンはリポジトリの中身をそのまま fork してビルド・デプロイするだけで、ファイルの中身を差し替える手段は提供していません。そのためボタンをクリックした直後の初回デプロイは、同梱のサンプル `docs/openapi.yaml`（Task API）のまま、`wrangler.toml` の `[vars]` もコメントアウトされた状態でデプロイされます。`API_BASE_URL` が未設定のため、この時点では `tools/call` は全て失敗します。自分の対象APIをMCP化するには、ボタンが作成した自分のfork先リポジトリで以下を行い、push して Workers Builds に再デプロイさせてください。

1. `docs/openapi.yaml` を対象APIの仕様書に差し替える
2. `wrangler.toml` の `[vars]` に `API_BASE_URL`（簡易OAuthサーバーを使う場合は `PUBLIC_URL` / `OAUTH_ALLOWED_REDIRECT_URIS` も）を設定する。

 `OAUTH_ENCRYPTION_KEY` などのシークレットは `wrangler.toml` には**書かず**、以下のいずれかの方法で設定してください：
   * **Webダッシュボードから設定する場合**: プロジェクトの `Settings > Variables and Secrets`（ランタイム用）に追加してください。（※誤って `Settings > Build > Build variables and secrets` に追加しないようご注意ください）
   * **CLIから設定する場合**: `npx wrangler secret put OAUTH_ENCRYPTION_KEY` コマンドで設定してください。
3. 変更をコミットして push する

## Docker

GHCR からイメージを pull して実行します。ビルドは不要です。

```bash
docker run -p 3000:3000 \
  -e HOST=0.0.0.0 \
  -e ALLOWED_HOSTS=127.0.0.1,localhost \
  -e API_BASE_URL=https://api.example.com \
  -v $(pwd)/docs/openapi.yaml:/app/docs/openapi.yaml:ro \
  ghcr.io/watanabebashi/beefchicken-mcp
```

- コンテナを外部からの接続を受け付けさせるには `HOST=0.0.0.0` が必須です。`HOST=0.0.0.0` を設定して `ALLOWED_HOSTS` を設定しない場合、DNSリバインディング対策のため起動時にエラーで停止します（[環境変数](environment.md)参照）。
- 自分の `openapi.yaml` を `/app/docs/openapi.yaml` に read-only でマウントすると、そのAPIを対象にできます。コンテナのエントリポイント（`scripts/docker-entrypoint.sh`）が起動のたびに、その時点でマウントされている仕様書に対して `npm run generate` を実行してからサーバーを起動するため、マウントした仕様書を差し替えた際も再ビルドは不要で、コンテナの再起動だけで反映されます。
- マウントしない場合は、クローン直後と同じ、同梱のサンプル `docs/openapi.yaml`（Task API）が使われます。
- 簡易OAuthサーバーを使う場合（`PUBLIC_URL` を設定する場合）は、SQLiteファイルへの書き込みが発生します。コンテナ再起動後もトークンを維持したい場合は `/app`（または `OAUTH_DB_PATH` が指す場所。[認証](oauth.md)参照）にボリュームをマウントしてください。

### イメージタグ

| タグ | 意味 | ビルド元 |
|---|---|---|
| `latest` | 最新のリリース | Gitタグ `vX.Y.Z` |
| `vX.Y.Z`, `vX.Y`, `vX` | 特定バージョンに固定 | Gitタグ `vX.Y.Z` |
| `edge` | デフォルトブランチの最新ビルド（未リリースの可能性あり） | `main` への push |

公開は [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml) が `docker/build-push-action` で行います。`npm run typecheck` と `vitest run` の成功を前提条件（gate）としています。

### ローカルでビルドする場合

```bash
docker build -t beefchicken-mcp .
docker run -p 3000:3000 -e HOST=0.0.0.0 -e ALLOWED_HOSTS=localhost -e API_BASE_URL=https://api.example.com beefchicken-mcp
```

## Node.js（共有ホスティング / セルフホスト）

1. Node.js 22.5+（`node:sqlite` を使用するため。OAuthを使わない場合も含めた実要件です）が動作するホスティング環境にアプリを配置し、Application startup file（または相当する起動エントリ）を `src/node.ts`（またはビルド後のエントリ）に設定します
2. `npm install` を実行します
3. 外部公開する場合は環境変数 `HOST=0.0.0.0` と、実際にアクセスされるドメイン名を含む `ALLOWED_HOSTS` を設定します（`ALLOWED_HOSTS` を設定せずに `HOST=0.0.0.0` にすると起動時にエラーで停止します）
4. Restartします
