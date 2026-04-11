# Blueprint: `src/core/orchestrator.py`

## 1. 責務 (Responsibility)
`Orchestrator` は Brownie システムの司令塔であり、以下の責務を担います：
- **ライフサイクル管理**: メインプロセスの起動、ポーリングループの実行、およびクリーンアップ（シャットダウン）の制御。
- **GitHub 連携**: メンションや Issue の監視を行い、新規タスクの検知および承認/却下（HITL）のハンドリングを行う。
- **ワークフローの統合**: LangGraph を用いた状態定義とチェックポイント（`AsyncSqliteSaver`）の管理。
- **インフラのオーケストレーション**: `WorkerPool` (Huey) へのタスク投入、`MCPServerManager` のライフサイクル制御。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `Orchestrator`

**初期化引数:**
- `config_path` (str): 設定ファイル (`config.yaml`) への絶対パス。

**公開メソッド:**

1. `start() -> None` (async)
   - **振る舞い**: 
     - LangGraph の `AsyncSqliteSaver` を初期化し、`.brwn/checkpoints.db` に接続。
     - `src.core.graph.builder.compile_workflow` を呼び出してワークフローをコンパイル。
     - 設定された `polling_interval_sec` ごとに `_poll_mentions` を実行する無限ループを開始。
   - **例外発生**: 設定ファイル読み込みエラー、ネットワークエラー時にログを記録。

2. `shutdown() -> None` (async)
   - **振る舞い**: 
     - `is_running` フラグを `False` に設定。
     - `mcp_manager.stop_all()` を呼び出し、稼働中の MCP サーバーを確実に停止。

3. `_poll_mentions() -> None` (async) (内部メソッドだが核心的)
   - **振る舞い**: 
     - `gh_client` を通じて未処理のメンションを取得。
     - 本文に `/approve` または `/reject` が含まれる場合、`_resume_workflow` を呼び出す。
     - それ以外は `_queue_task` を呼び出して新規または再開タスクを投入。

4. `_execute_task(task_id, repo_name, issue_number) -> None` (async)
   - **振る舞い**: 
     - **重要**: Huey ワーカーから呼び出される実行実体。
     - 特定の `thread_id` (task_id) の状態をチェックポインタから復元。
     - `workflow_app.astream` を実行し、LangGraph のノード遷移を開始。
     - 実行結果（完了または承認待ち）に基づいて GitHub にコメントを投稿。
   - **例外発生**: 実行中のエラーをキャッチし、状態を `Failed` に更新。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `asyncio`, `logging`, `yaml`, `time`
- **外部依存**: 
  - `langgraph.checkpoint.sqlite.aio.AsyncSqliteSaver`
  - `src.core.workers.pool.WorkerPool`
  - `src.gh_platform.client.GitHubClientWrapper`
  - `src.workspace.sandbox.SandboxManager`
  - `src.mcp_server.manager.MCPServerManager`
