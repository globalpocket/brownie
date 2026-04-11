# Blueprint: `src/core/graph/nodes/governance.py`

## 1. 責務 (Responsibility)
`governance_node` は、Brownie ワークフローの **Phase 4: Governance & Fail-Safe** を担当します。
- **ヒューマンインザループ (HITL)**: 実行結果（ブランチ差分、テスト結果）をまとめ、GitHub に「稟議書（Ringi-sho）」として投稿。人間の承認が得られるまでワークフローを中断。
- **Fail-Safe & Repair**: 実装失敗時、エラーコンテキストをワーカー（`repair_task`）に渡し、自律的な修復試行をキック。
- **ゲートキーパー**: 人間の承認 (`Approve`) なしに PR 作成（Phase 5）に進むことを構造的に防止。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `governance_node(state: TaskState) -> Dict` (async)
- **振る舞い**: 
  1. ステータスが `Execution_Failed` の場合：
     - `repair_task` を投入し、ステータスを `Waiting_Repair` に更新。
  2. 承認も却下もされていない場合（初回訪問）：
     - `execution_logs` 等から `ringi_document` (Markdown) を構成。
     - `gh_client.post_comment` で GitHub に投稿。
     - ステータスを `WaitingForApproval` に更新し、Orchestrator （およびグラフビルダーの中断設定）により処理を停止。
  3. ユーザーが GitHub で `/approve` し、ステートが `governance_decision = "Approve"` に更新された後：
     - ステータスを `Approved` にして次ノードへ。

## 3. 依存関係 (Dependencies)
- `src.gh_platform.client.GitHubClientWrapper`
- `src.core.workers.tasks.repair_task`
- `src.version.get_footer`
