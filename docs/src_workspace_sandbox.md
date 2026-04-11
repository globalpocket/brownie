# Blueprint: `src/workspace/sandbox.py`

## 1. 責務 (Responsibility)
`SandboxManager` は、コードの実装、テスト、シェルコマンドの実行を、ホスト環境から安全に分離された **Docker サンドボックス** 内で実行・管理します。
- **実行環境の隔離**: ホストのファイルシステムや環境変数を直接触らせず、コンテナを介した間接操作を保証。
- **リソース制限と権限管理**: 最小権限の原則に基づき、指定された UID/GID でコマンドを実行し、破壊的変更の影響をファイルシステム境界内に留める。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `SandboxManager`

**初期化引数:**
- `user_id` (int): コンテナ内でコマンドを実行する際の UID。
- `group_id` (int): コンテナ内でコマンドを実行する際の GID。

**公開メソッド:**

1. `run_command(command, cwd, env=None) -> Dict` (async)
   - **振る舞い**: 
     - 実行中の Docker コンテナに対し、`docker exec` を実行。
     - 指定された `cwd`（コンテナ内のパス）でコマンドを走らせる。
     - 標準出力・標準エラーをキャプチャし、終了コードと併せて返却。
   - **例外発生**: Docker 自体の接続エラーやコンテナ停止時にエラーを記録。

2. `start_container(image_name, volumes) -> str` (async)
   - **振る舞い**: 
     - ワークスペースディレクトリをマウントした状態で Docker コンテナをバックグラウンド起動。
     - **セキュリティ要件**: 外部通信（ネットワーク）の制限、メモリ/CPU 制限を課した状態で起動。
   - **出力**: 起動したコンテナの ID。

## 3. 依存関係 (Dependencies)
- **外部依存**: `docker-py` (Python Docker SDK)
