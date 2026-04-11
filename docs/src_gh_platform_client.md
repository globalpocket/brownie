# Blueprint: `src/gh_platform/client.py`

## 1. 責務 (Responsibility)
`GitHubClientWrapper` は、Brownie と GitHub API (PyGithub) の間の **「通信・リトライ・認証の抽象化」** を担当します。
- **認可の管理**: GitHub Personal Access Token (PAT) を用いたセキュアな通信。
- **レート制限への対応**: GitHub API のレート制限（Secondary Rate Limits を含む）を検知し、自動的な指数バックオフ・リトライを実行。
- **高レベル API の提供**: メンション監視、コメント投稿、PR 作成などの複雑な操作を、エージェントが利用しやすい単純なメソッドとして公開。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `GitHubClientWrapper`

**初期化引数:**
- `token` (str): GitHub PAT。

**公開メソッド:**

1. `get_mentions_to_process(repo_name=None) -> List[Dict]` (async)
   - **振る舞い**: 
     - ユーザー（Brownie）への通知 API をポーリング。
     - 自身が関与すべき Issue/PR のメンションを特定。
     - コメントの作成日時と ID を含むメタデータを取得。

2. `post_comment(repo_name, issue_number, body) -> None` (async)
   - **振る舞い**: 
     - 指定された `issue_number` に対してコメントを投稿。
     - **重要**: `github_retry` デコレータにより、通信失敗時の堅牢性を確保。

3. `create_pull_request(repo_name, title, body, head_branch, base_branch) -> PullRequest` (async)
   - **振る舞い**: 
     - 実装済みのトピックブランチから、PR を作成。

## 3. 依存関係 (Dependencies)
- **外部依存**: `github` (PyGithub)
- **内部依存**: リトライ用デコレータ `github_retry` (同ファイル内定義)
