# Blueprint: `src/core/graph/nodes/analysis.py`

## 1. 責務 (Responsibility)
`core_analysis_node` は、Brownie ワークフローの **Phase 1: Core Analysis** を担当します。
- **全方位解析の委譲**: 重たい AST 解析やシンボル依存関係の抽出を、Huey ワーカー（`analysis_task`）に非同期で依頼。
- **ポーリング待機**: ワーカーの結果がステートに反映されるまで、ワークフローを一時的にこのノードで待機・ループさせる。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `core_analysis_node(state: TaskState) -> Dict` (async)
- **振る舞い**: 
  1. ステータスが `Analysis_Completed` 以外の場合：
     - `analysis_task(task_id, repo_path)` を呼び出し、Huey キューに投入。
     - ステータスを `Waiting_Analysis` に設定してリターン（グラフビルダー側のループ処理へ）。
  2. ステータスが `Analysis_Completed` の場合：
     - 解析結果がステートに書き戻されているため、ステータスを `Phase1_Completed` に更新。

## 3. 依存関係 (Dependencies)
- `src.core.graph.state.TaskState`
- `src.core.workers.tasks.analysis_task`
