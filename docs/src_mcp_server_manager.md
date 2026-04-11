# Blueprint: `src/mcp_server/manager.py`

## 1. 責務 (Responsibility)
`MCPServerManager` は、Brownie の推論・知覚・実行を支える **「MCP サーバー群のライフサイクル管理と統合インターフェース」** を担当します。
- **堅牢なインフラ (Robust Infrastructure)**: AnyIO の `TaskGroup` と `AsyncExitStack` を用い、メインプロセスの終了時や例外発生時に MCP サーバープロセスを確実にクリーンアップ。
- **動的プロビジョニング**: タスクの文脈（リポジトリ、メモリパス等）に合わせて Workspace, Knowledge, SQLite の各 MCP サーバーをオンデマンドで起動。
- **ツールアダプタ**: 複数の MCP サーバーが提供するツールを統合し、LangChain 形式に変換してエージェント（Planner）に提供。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `MCPServerManager`

**初期化引数:**
- `project_root` (str): Brownie 自体のルートディレクトリ（サーバープログラムの探索基点）。

**公開メソッド:**

1. `start_workspace_server(repo_path, reference_path, user_id, group_id) -> Client` (async)
   - **振る舞い**: 
     - `src.mcp_server.workspace_server` を別プロセスとして起動。
     - ワークスペースルートやサンドボックスの UID/GID を環境変数および引数で渡す。
     - `FastMCP` クライアントを初期化し、接続。

2. `start_knowledge_server(repo_path, memory_path, repo_name) -> Client` (async)
   - **振る舞い**: 
     - `src.mcp_server.knowledge_server` を起動（コアサーバー）。
     - リポジトリの AST 解析 DB へのパスやメモリパスを渡す。

3. `provision_servers(server_names: List[str]) -> None` (async)
   - **振る舞い**: 
     - JIT (Just-In-Time) ロード機構。13種類の高度解析プラグイン（`web_fetch`, `design_pattern_oracle`等）のうち、要求されたサーバーのみをオンデマンドで起動する。
     - 不要になった別タスクのプラグインは停止・破棄し、常に必要最小限のリソースとコンテキストのみを保つ。

4. `get_langchain_tools() -> List[Any]` (async)
   - **振る舞い**: 
     - 現在接続されているすべての MCP サーバー（コアおよびアクティブなJITプラグイン）から、`load_mcp_tools` を用いてツール定義を一括取得。

5. `stop_all() -> None` (async)
   - **振る舞い**: 
     - `AsyncExitStack` をクローズし、すべてのコア・プラグインプロセスを正常終了させる。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `asyncio`, `os`, `sys`
- **外部依存**: `fastmcp.Client`, `anyio`, `langchain_mcp_adapters.tools.load_mcp_tools`
