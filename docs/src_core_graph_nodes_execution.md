# Blueprint: `src/core/graph/nodes/execution.py`

## 1. 責務 (Responsibility)
`execution_delegation_node` は、Brownie ワークフローの **Phase 3: Execution Delegation** を担当します。
- **実装実行の委譲**: 実際のコード変更、テスト実行、ブランチ操作などの重たい副作用を伴うタスクを、Huey ワーカー（`execution_task`）に委譲。
- **進捗監視**: ワーカーが実装を完了し、ステータスを `Execution_Completed` または `Execution_Failed` に更新するまで待機。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `execution_delegation_node(state: TaskState) -> Dict` (async)
- **振る舞い**: 
  1. ステータスが `Execution_Completed/Failed` 以外の場合：
     - `execution_task(task_id, repo_path, plan)` を呼び出し。
     - ステータスを `Waiting_Execution` に設定してリターン。
  2. ステータスが完了・失敗済みの場：
     - そのステータスを維持して次ノード（Governance）へ。

## 3. 依存関係 (Dependencies)
- `src.core.graph.state.TaskState`
- `src.core.workers.tasks.execution_task`
