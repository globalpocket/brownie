# Blueprint: `src/workspace/sandbox.py`

## 1. 責務 (Responsibility)
ワークスペース内での安全なファイル操作とコード実行環境（サンドボックス）を提供する。`Docker` を利用した実行環境の管理と、`WorkspaceContext` を通じたセキュリティ境界の維持を担当する。AI（エージェント）が直接ホストのファイルシステムを破壊したり、不適切なプロセスを起動したりすることを防ぐガードレールとして機能する。

## 2. 復元要件 (Recreation Requirements for AI)
本モジュールを再実装する場合、以下のコントラクトを厳格に守ること。

### クラス: `SandboxManager`
**初期化引数:**
- `user_id` (int): サンドボックス内での実行ユーザーID。
- `group_id` (int): 同グループID。

**コンストラクタの挙動:**
- `docker.from_env()` で接続を試み、失敗した場合は Mac/Linux の標準的なソケットパス (`~/.docker/run/docker.sock`, `/var/run/docker.sock`) を順次試行して `DockerClient` を確立する。

**公開メソッド:**
1. `sanitize_compose_yaml(yaml_content: str) -> str`
   - **入力**: LLM が生成した `docker-compose.yml` 文字列。
   - **振る舞い**:
     1. `privileged` フラグを削除。
     2. ホストパスをマウントする `volumes` をチェックし、`/etc`, `/root`, `/` などの機密パスであれば削除。
     3. `user` フィールドに `user_id:group_id` を強制設定。
   - **出力**: セキュリティ加工済みの YAML 文字列。

2. `async list_files(path: str = ".", max_depth: int = 1) -> str`
   - **振る舞い**: `os.walk` を使用。ディレクトリは `[DIR]`, ファイルは `[FILE]` のプレフィックスを付ける。ドットファイルは除外する。パスが存在しない場合は AI への修正ヒントを返す。

3. `async read_file(path: str) -> str`
   - **安全性**: `_get_full_path` で境界外アクセスを遮断。
   - **追加チェック**: 大文字小文字を区別しない OS 対策として `os.listdir` による実名存在チェック（Case-sensitive check）を行う。

4. `async write_file(path: str, content: str) -> str`
   - **振る舞い**: 親ディレクトリを自動生成 (`os.makedirs`)。`rw=True` 付きでパス解決し、境界外書き込みを構造的に遮断する。

5. `cleanup_orphans()`
   - **振る舞い**: `brownie_task_id` ラベルを持つコンテナのうち、実行中ではないものを一括削除する。また Docker ボリュームの `prune` を実行。

**内部補助メソッド:**
- `_get_full_path(path: str, rw: bool = False) -> str`
  - `self.context (WorkspaceContext)` に解決を委譲。`rw=True` の場合は、結果が `root_path` の配下にあることを `startswith` で再検証し、違反時は `PermissionError` を投げる。

## 3. 依存関係 (Dependencies)
- 標準ライブラリ: `os`, `yaml`, `logging`
- 外部依存: `docker` (SDK)
- 内部モジュール: `src.workspace.context.WorkspaceContext`
