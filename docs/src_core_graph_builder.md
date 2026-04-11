# Blueprint: `src/core/graph/builder.py`

## 1. 責務 (Responsibility)
`builder.py` は、Brownie の **5-Phase ワークフローの構造と遷移ロジック** を定義します。
- **グラフ構築**: LangGraph の `StateGraph` を使用して、各ノード（Phase）を接続。
- **遷移制御**: ステータスやユーザーの意思決定に基づいた、動的な条件付きエッジ（Conditional Edges）の実装。
- **コンパイル**: 外部（Orchestrator）から利用可能なグラフの生成と、中断ポイント（Interrupt）の注入。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `create_brownie_graph() -> StateGraph`
- **振る舞い**: 
  1. `TaskState` を用いた `StateGraph` を初期化。
  2. 以下のノードを登録:
     - `intent_alignment` (Phase 0)
     - `core_analysis` (Phase 1)
     - `dynamic_handshake` (Phase 2)
     - `execution_delegation` (Phase 3)
     - `governance` (Phase 4)
     - `completion` (Phase 5)
  3. エントリーポイントを `intent_alignment` に設定。
  4. 条件付きエッジの定義:
     - `route_after_analysis`: ステータスが `Phase1_Completed` になるまで `core_analysis` をループ。
     - `route_after_execution`: `Execution_Completed/Failed` になるまで `execution_delegation` をループ。
     - `route_after_governance`: 承認 (`Approve`) -> `completion`, 却下 (`Reject`) -> `intent_alignment`, 修復中 -> `governance` ループ。

### 関数: `compile_workflow(checkpointer=None)`
- **振る舞い**: 
  - `create_brownie_graph()` を呼び出し、グラフをコンパイル。
  - **重要要件**: `interrupt_before=["governance"]` を指定し、エージェントが修正を完了した後、PR作成（Phase 5）に進む前に必ず人間の承認（Phase 4）を挟む。

## 3. 依存関係 (Dependencies)
- **外部依存**: 
  - `langgraph.graph.StateGraph`
  - `src.core.graph.state.TaskState`
  - `src.core.graph.nodes.*`
