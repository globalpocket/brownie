# Blueprint: `src/core/graph/nodes/completion.py`

## 1. 責務 (Responsibility)
`completion_node` は、Brownie ワークフローの **Final Phase: Completion** を担当します。
- **成果の納品**: 修正が行われた場合、トピックブランチからメインブランチへの Pull Request を作成。
- **クローズ処理**: GitHub Issue に完了報告を投稿し、ワークフローを正常終了（`END`）へ導く。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `completion_node(state: TaskState) -> Dict` (async)
- **振る舞い**: 
  1. `has_changes` が `True` の場合：
     - `gh_client.create_pull_request` を実行。PR のタイトルと本文（サマリー、検証結果を含む）を構成。
     - 得られた PR URL を含む完了告知を GitHub に投稿。
  2. `has_changes` が `False` の場合：
     - コード修正不要と判断された旨の完了告知を GitHub に投稿。
- **出力**: ステータスを `Completed` に設定。

## 3. 依存関係 (Dependencies)
- `src.gh_platform.client.GitHubClientWrapper`
- `src.version.get_footer`
