# Blueprint: `src/core/orchestrator.py`

## 1. 責務 (Responsibility)
Brownie システムのセントラルエンジン。設定の読み込み、各コンポーネント（State, WorkerPool, GitHub, Sandbox, MCP）の統合、リポジトリの監視（ポーリング）、およびタスク実行のオーケストレーションを担う。システムのブートシーケンスから自律的なループの管理までを全うする。

## 2. 復元要件 (Recreation Requirements for AI)
本モジュールを再実装する場合、以下のコントラクトを厳格に守ること。

### クラス: `Orchestrator`
**初期化引数:**
- `config_path` (str): `config.yaml` へのパス。

**主要メソッド:**
1. `async start()`
   - **振る舞い**:
     1. DB接続、Orphaned Task（孤立タスク）のリセット、WorkerPool の実行開始。
     2. WDCA (Whole Directory Context Awareness) シーケンスの実行: 全対象リポジトリをクローンし、`CodeAnalyzer` でシンボルマップを事前構築。
     3. メイン終了まで `_poll_repository` と `_check_llm_health` を一定間隔でループ実行。
   - **例外処理**: `GitHubRateLimitException` 発生時はリセット時刻までスリープ。

2. `async _poll_repository(repo_name: str)`
   - **振る舞い**: GitHub API を通じて Issue と Mention を取得し、`_queue_if_needed` を呼び出す。

3. `async _queue_if_needed(...)`
   - **安全性チェック**: すでに同一 Issue に対してアクティブなタスクがある場合や、完了ラベルが付与されている場合はキューイングをスキップする。
   - **タスク投入**: `State.update_task` で状態を `InQueue` にし、`WorkerPool.add_task` に `_execute_task` を登録。

4. `async _execute_task(task_id: str, repo_name: str, issue_number: int)`
   - **フロー**:
     1. `MCPServerManager` のコンテキストを開始。
     2. `WorkspaceContext` を生成し、最新のソースコードを同期。
     3. Workspace/Knowledge MCP サーバーを起動。
     4. `CoderAgent` を依存注入（Dependency Injection）で初期化。
     5. GitHub Issue/Comment から命令を抽出し、`agent.run` を実行。
     6. **成功時**: `GitOperations` を用いて変更をコミットし、GitHub 上で Pull Request を作成。
     7. **事後処理**: ハートビートの停止、状態の更新（Completed/Failed/Suspended）、GitHub への報告コメント投稿。

5. `async _check_llm_health()`
   - **副作用**: LLMサーバー（MLX等）への疎通確認を行い、応答がない場合は `subprocess.Popen` を用いてバックグラウンドでサーバーを再起動する。

## 3. 依存関係 (Dependencies)
- 内部モジュール: `StateManager`, `WorkerPool`, `CoderAgent`, `GitHubClientWrapper`, `SandboxManager`, `WorkspaceContext`, `MCPServerManager`, `CodeAnalyzer`, `GitOperations`
- 外部依存: `yaml`, `httpx`, `asyncio`
