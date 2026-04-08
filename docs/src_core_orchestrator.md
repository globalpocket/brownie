# Blueprint: `src/core/orchestrator.py`

## 1. 責務 (Responsibility)
`Orchestrator` は BROWNIE システムの司令塔であり、GitHub リポジトリの監視、MLX サーバー（Planner/Executor）のライフサイクル管理、およびエージェントの実行コーディネーションを担います。

最新のアーキテクチャでは、**Multi-Agent（マルチエージェント）アーキテクチャ**における **Planner-Executor（計画者と実行者）パターン**をサポートするため、2つの異なるポート (8080, 8081) で MLX サーバーを並行稼働・監視する責務を持ちます。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `Orchestrator`

**初期化引数:**
- `config_path` (str): `config.yaml` へのパス。

**公開メソッド:**

1. `start() -> None` (Async)
   - **振る舞い**: データベースの初期化、リポジトリの同期（クローン）、およびメインのポーリングループを開始します。
   - **ループ内容**:GitHub の Issue/Mention 監視、LLM ヘルスチェック (`_check_llm_health`)、サンドボックスの定期掃除を実行。

**内部主要メソッド (契約):**

1. `_check_llm_health() -> None` (Async)
   - **振る舞い**: 
     - Port 8080 (Planner) と Port 8081 (Executor) の両方の `/models` エンドポイントをチェックします。
     - 応答がない場合、`lsof -ti :port` を使用して該当ポートの PID を特定し、`kill -9` で強制終了させてから再起動します。
     - `mlx_lm.server` を起動する際、`--port` 引数でポートを指定し、`HF_HOME` 環境変数でモデルパスを固定します。
   - **制約**: デュアルモデル展開のため、M1 Pro 32GB 以上のメモリリソースを前提とします。

2. `_execute_task(task_id, repo_name, issue_number) -> None` (Async)
   - **振る舞い**: 
     - 各タスク専用の `MCPServerManager` と `WorkspaceContext` を生成。
     - `CoderAgent` (Planner) を初期化し、Issue の内容に基づいてタスクを実行。
     - 実行結果（成功・中断・失敗）に応じて、GitHub へのラベル付与とサマリーの投稿を行います。

## 3. 依存関係 (Dependencies)
- **コアモジュール**: `src.core.agent`, `src.core.state`, `src.core.worker_pool`
- **インフラ**: `src.gh_platform.client`, `src.workspace.sandbox`, `src.mcp_server.manager`
- **外部**: `httpx`, `subprocess`, `asyncio`, `pyyaml`
