# Blueprint: `src/workspace/sandbox.py`

## 1. 責務 (Responsibility)
`SandboxManager` は、コードの実行やファイル操作を行うための安全なコンテキストを提供します。Docker を使用したプロセス分離（将来の拡張）と、`WorkspaceContext` を活用した「ワークスペース外への書き込み防止」というセキュリティ境界の維持を担います。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `SandboxManager`

**初期化引数:**
- `user_id` (int), `group_id` (int): サンドボックス内およびファイル操作で使用する UID/GID。

**公開メソッド:**

1. `set_workspace_root(root_path) -> None`
   - **振る舞い**: `WorkspaceContext` にルートパスを設定（または初期化）します。
2. `read_file(path) -> str` (Async)
   - **振る舞い**: `WorkspaceContext.resolve_path` を使用してパスを解決し、ファイルを読み込みます。ディレクトリの場合はエラーを返し、存在しない場合は AI への修正ヒントを返します。
3. `write_file(path, content) -> str` (Async)
   - **入力**: ファイルパス、書き込む内容。
   - **振る舞い**: パスを安全に解決し、ディレクトリを自動作成して書き込みます。
   - **例外発生**: 解決されたパスがワークスペース外を指す場合、`PermissionError` を投げます。
4. `list_files(path, max_depth) -> str` (Async)
   - **振る舞い**: 指定された深さまで再帰的にファイルリストを生成します。

### セキュリティコントラクト (Agent-Friendly)
- 全てのファイル操作前に `_get_full_path` を通じてパスを検証します。
- `sanitize_compose_yaml` メソッドにより、サンドボックス定義の特権昇格や不正なマウントを事前にブロックします。

## 3. 依存関係 (Dependencies)
- **コアモジュール**: `src.workspace.context`
- **外部**: `docker` (docker-py), `pyyaml`, `os`
