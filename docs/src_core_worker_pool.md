# Blueprint: `src/core/worker_pool.py`

## 1. 責務 (Responsibility)
`WorkerPool` およびそれに付随する Huey タスクは、システムの **「Pull 型（非同期）タスク実行」** を支えるインフラ層を担当します。
- **タスクキューイング**: Orchestrator (Main Process) からのタスク投入を受け、永続化された SQLite DB (`.brwn/huey.db`) へ保存。
- **ワーカー管理**: メインプロセスとは物理的に異なる Python プロセス（`huey.bin.consumer`）でタスクを実行。
- **隔離実行**: 各タスク実行ごとに Orchestrator コンテキスト（最小構成）を再構成し、LangGraph ワークフローをキック。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `execute_task_wrapper(task_id, repo_name, issue_number)`
- **責務**: Huey ワーカープロセスのエントリーポイント。
- **振る舞い**: 
  1. `asyncio` イベントループを取得または新規作成。
  2. 環境変数 `BROWNIE_CONFIG` から設定を読み込み、`Orchestrator` インスタンスをワーカー専用に初期化。
  3. `orchestrator._execute_task` を非同期実行。
  4. LangGraph 側のチェックポインタ（SQLite）からタスクの状態を復旧・更新。

### クラス: `WorkerPool`
Orchestrator から Huey タスクを投入するためのプロキシクラス。

**初期化引数:**
- `project_root` (str): プロジェクトのルートディレクトリ。

**公開メソッド:**

1. `add_task(task_id, priority, repo_name, issue_number) -> Dict` (async)
   - **振る舞い**: Huey の `@huey.task` でラップされた `execute_task_wrapper` を呼び出す。
   - **出力**: `{"task_id": ..., "status": "queued"}`。

2. `run() -> subprocess.Popen` (async)
   - **振る舞い**: 
     - 別の OS プロセスとして Huey コンシューマーを起動。
     - コマンド: `python -m huey.bin.consumer src.core.worker_pool.huey -w 1`。
     - **VRAM 保護**: 推論リソース競合を避けるため、デフォルトはシングルワーカー (`-w 1`) で動作。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `os`, `logging`, `subprocess`, `sys`, `asyncio`
- **外部依存**: 
  - `huey.SqliteHuey`
  - `src.core.orchestrator.Orchestrator`
