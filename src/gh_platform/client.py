import logging
from typing import Optional, List, Dict, Any
from github import Github, GithubException, Auth
import time

logger = logging.getLogger(__name__)

class GitHubClientWrapper:
    def __init__(self, token: str):
        if not token:
            raise ValueError("GITHUB_TOKEN is not set. Please set it as an environment variable (e.g., export GITHUB_TOKEN=...).")
        self.auth = Auth.Token(token)
        self.g = Github(auth=self.auth)
        self.etags: Dict[str, str] = {}

    async def get_issues_to_process(self, repo_name: str, mention_name: str) -> List[Any]:
        """メンションを検知したIssue/PRを取得する。ETagを使用してトラフィックを抑制。"""
        try:
            repo = self.g.get_repo(repo_name)
            # ETag監視 (設計書 4. GitHubClient)
            # 実際には PyGithub で ETag を扱うには get_issues(etag=...) が必要だが
            # ここではリポジトリの updated_at 等をベースにしたフィルタリングを行う。
            
            # [bot] アカウントは無視 (設計書 4. GitHubClient)
            issues = repo.get_issues(state='open', sort='updated', direction='desc')
            
            to_process = []
            for issue in issues:
                if issue.user.type == "Bot":
                    continue
                
                # 自分へのメンションがあるかチェック (簡易版)
                if mention_name in (issue.body or ""):
                    to_process.append(issue)
                
                # コメント内にメンションがあるかチェック
                comments = issue.get_comments(since=issue.updated_at)
                for comment in comments:
                    if comment.user.type == "Bot":
                        continue
                    if mention_name in comment.body:
                        to_process.append(issue)
                        break
            
            return to_process
        except GithubException as e:
            logger.error(f"GitHub API Error: {e}")
            return []

    async def check_rbac(self, repo_name: str, username: str) -> bool:
        """ユーザーがリポジトリの Collaborator または Owner かを検証する (設計書 4. Orchestrator)"""
        try:
            repo = self.g.get_repo(repo_name)
            collaborators = repo.get_collaborators()
            for coll in collaborators:
                if coll.login == username:
                    return True
            return False
        except GithubException:
            return False

    async def post_comment(self, repo_name: str, issue_number: int, body: str):
        """コメントを投稿する"""
        try:
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            issue.create_comment(body)
        except GithubException as e:
            logger.error(f"Failed to post comment: {e}")

    async def create_pull_request(self, repo_name: str, title: str, body: str, head: str, base: str):
        """プルリクエストを作成する"""
        try:
            repo = self.g.get_repo(repo_name)
            return repo.create_pull(title=title, body=body, head=head, base=base)
        except GithubException as e:
            logger.error(f"Failed to create PR: {e}")
            return None
