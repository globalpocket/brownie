# Blueprint: `src/core/workflow.py`

## 1. 責務 (Responsibility)
`TaskWorkflow` は、タスクのライフサイクル（解析、実装、検証、報告）を定義する **LangGraph ベースのステートマシン** です。
- **状態管理 (Single Source of Truth)**: `TaskState` (TypedDict) を通じた、タスク全期間のコンテキスト（Issue番号、解析結果、PRステータス、履歴）の保持。
- **実行フローの定義**: 依存関係解析 (`analyze`) -> 計画策定 (`plan`) -> 承認待ち (`approve_wait`) -> 実装実行 (`execute`) -> 完了報告 (`report`) の遷移制御。
- **割り込み制御 (Interrupt)**: 重要な意思決定（HITL）が発生するポイントでの安全な一時停止と再開。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `TaskState` (TypedDict)
ワークフローの永続化対象となるデータ構造。
- **主要フィールド**: `task_id`, `status`, `instruction`, `critical_dependencies`, `plan`, `is_approved`, `history` (Annotated リスト)。

### クラス: `TaskWorkflow`

**初期化引数:**
- `config` (Dict[str, Any]): 設定情報。
- `project_root` (str): プロジェクトのルート。

**公開メソッド:**

1. `compile(checkpointer=None)`
   - **振る舞い**: 
     - グラフをコンパイルし、実行可能な `Pregel` オブジェクトを返す。
     - **重要**: `interrupt_before=["approve_wait"]` を設定し、承認待ちノードの直前で必ず制御をユーザー（Orchestrator）に戻す。

**抽象ノード (主要な振る舞い):**

1. `analyze_node(state)`
   - `CodeAnalyzer` でリポジトリをスキャンし、`FlowTracer` (NetworkX) でシンボル依存関係の急所を特定。
2. `approve_wait_node(state)`
   - ステータスを `WaitingForClarification` に変更。
3. `execution_node(state)`
   - Planner/Executor エージェントへ制御を渡し、実際の実装フェーズへ移行。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `logging`, `operator`
- **外部依存**: 
  - `langgraph.graph.StateGraph`
  - `src.workspace.analyzer.flow.FlowTracer`
  - `src.workspace.analyzer.core.CodeAnalyzer`
