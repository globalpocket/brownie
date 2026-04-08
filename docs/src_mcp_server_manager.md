# Blueprint: `src/mcp_server/manager.py`

## 1. 責務 (Responsibility)
`MCPServerManager` は、BROWNIE エージェントが外部ツール（Workspace 管理、ナレッジ検索）にアクセスするための MCP サーバーのライフサイクルを管理します。`fastmcp` クライアントを使用して stdio 経由でサーバーと通信し、非同期コンテキストマネージャー (`__aenter__` / `__aexit__`) を通じてリソースの確実な回収を保証します。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `MCPServerManager`

**初期化引数:**
- `project_root` (str): プロジェクトのルートディレクトリ。MCP サーバーの実行ディレクトリとして使用されます。

**公開メソッド:**

1. `start_workspace_server(repo_path, reference_path, user_id, group_id) -> Optional[Client]`
   - **入力**: ターゲットリポジトリのパス、参照パス、および Docker 実行用の UID/GID。
   - **振る舞い**: `src.mcp_server.workspace_server` を別プロセスとして stdio トランスポートで起動します。環境変数をセットアップし、`fastmcp.Client` を初期化します。
   - **副作用**: `self.workspace_client` にクライアント实例を保持します。
   - **出力**: 成功時は `Client` オブジェクト、失敗時は `None`。

2. `start_knowledge_server(repo_path, memory_path, repo_name) -> Optional[Client]`
   - **入力**: リポジトリパス、ベクトル DB の保存パス、リポジトリ名。
   - **振る舞い**: `src.mcp_server.knowledge_server` を起動します。ナレッジ抽出に必要な環境変数（`BROWNIE_MEMORY_PATH` 等）を注入します。
   - **副作用**: `self.knowledge_client` にクライアント实例を保持します。
   - **出力**: 成功時は `Client` オブジェクト、失敗時は `None`。

3. `stop_all() -> None` (Async)
   - **振る舞い**: 起動中の全ての MCP クライアントに対し `__aexit__` を呼び出し、サーバープロセスを正常終了させます。

### コンテキストマネージャーの挙動
- `__aenter__` でインスタンスを返し、`__aexit__` で `stop_all()` を自動的に呼び出すことで、ゾンビプロセスの発生を防止します。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `os`, `sys`, `asyncio`, `logging`
- **外部依存**: `fastmcp` (Client, StdioTransport)
