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
        self._my_username: Optional[str] = None

    def get_my_username(self) -> str:
        """認証されたユーザーのユーザー名を動的に取得する"""
        if self._my_username is None:
            try:
                user = self.g.get_user()
                self._my_username = user.login
                logger.info(f"Authenticated as GitHub user: {self._my_username}")
            except GithubException as e:
                logger.error(f"Failed to fetch authenticated user: {e}")
                raise
        return self._my_username

    async def get_issues_to_process(self, repo_name: str) -> List[Any]:
        """自分（アサイニ）に割り当てられたIssue/PRを取得する。"""
        try:
            my_username = self.get_my_username()
            repo = self.g.get_repo(repo_name)
            
            # アサイニが自分であるIssueを取得 (設計書改修: メンションではなくアサインベース)
            # PyGithubの get_issues は assignee 引数をサポートしている
            issues = repo.get_issues(state='open', assignee=my_username, sort='updated', direction='desc')
            
            to_process = []
            for issue in issues:
                # [bot] アカウントは無視
                if issue.user.type == "Bot":
                    continue
                
                to_process.append(issue)
            
            if to_process:
                logger.info(f"Found {len(to_process)} issues assigned to {my_username} in {repo_name}")
            
            return to_process
        except GithubException as e:
            logger.error(f"GitHub API Error: {e}")
            return []

    async def check_rbac(self, repo_name: str, username: str) -> bool:
        """ユーザーがリポジトリの Collaborator または Owner かを検証する"""
        try:
            repo = self.g.get_repo(repo_name)
            # 権限チェックの簡易化（実際には詳細な権限確認が必要な場合もある）
            # ここでは collaborator かどうかを確認
            return repo.has_in_collaborators(username)
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
