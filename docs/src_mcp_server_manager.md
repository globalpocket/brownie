# Blueprint: `src/mcp_server/manager.py`

## 1. 責務 (Responsibility)
MCP サーバー (Workspace, Knowledge) のライフサイクル一式を管理するコンポーネント。各サーバーを子プロセス（StdioTransport）として起動し、`fastmcp` クライアントを確立する。非同期コンテキストマネージャーインターフェースを提供し、スコープ終了時にリソース（クライアント接続）を確実にクリーンアップする責務を持つ。

## 2. 復元要件 (Recreation Requirements for AI)
本モジュールを再実装する場合、以下のコントラクトを厳格に守ること。

### クラス: `MCPServerManager`
**初期化引数:**
- `project_root` (str): プロジェクトのルートディレクトリ。サーバー起動時の `cwd` として利用される。

**内部状態:**
- `workspace_client` (Optional[Client]): Workspace MCP クライアント。
- `knowledge_client` (Optional[Client]): Knowledge MCP クライアント。

**公開メソッド:**
1. `async start_workspace_server(repo_path: str, reference_path: str, user_id: int, group_id: int) -> Optional[Client]`
   - **入力**: ワークスペースのパス、参照パス、サンドボックス実行ユーザーID/グループID。
   - **振る舞い**:
     1. `sys.executable` を使用して `src.mcp_server.workspace_server` モジュールを起動。
     2. 環境変数 `BROWNIE_WORKSPACE_ROOT`, `BROWNIE_REFERENCE_ROOT`, `PYTHONPATH=.` を設定。
     3. `StdioTransport` を介して `fastmcp.Client` を初期化。
     4. `await client.__aenter__()` を呼び出し接続を確立。
   - **例外処理**: 失敗時は `None` を返し、エラーログを記録。

2. `async start_knowledge_server(repo_path: str, memory_path: str, repo_name: str) -> Optional[Client]`
   - **入力**: リポジトリパス、ベクトルDB保存先パス、リポジトリ名。
   - **振る舞い**:
     1. `src.mcp_server.knowledge_server` モジュールを起動。
     2. 環境変数 `BROWNIE_TARGET_REPO`, `BROWNIE_REPO_PATH`, `BROWNIE_MEMORY_PATH` を設定。
     3. `fastmcp.Client` を確立・接続。
   - **出力**: 成功時はクライアント、失敗時は `None`。

3. `async stop_all()`
   - **振る舞い**:
     1. 保持している全てのクライアントに対して `await client.__aexit__(None, None, None)` を呼び出す。
     2. 各クライアント変数を `None` にリセット。
   - **副作用**: 子プロセス（MCP サーバー）が終了する。

4. `async __aenter__()` / `async __aexit__(...)`
   - **振る舞い**: 非同期コンテキストマネージャーとして `stop_all` を自動実行する。

## 3. 依存関係 (Dependencies)
- 標準ライブラリ: `os`, `sys`, `logging`, `asyncio`
- 外部依存: `fastmcp` (Client, StdioTransport)
