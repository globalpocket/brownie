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
        """プルリクエストを作成する (既存の場合は取得する)"""
        try:
            repo = self.g.get_repo(repo_name)
            return repo.create_pull(title=title, body=body, head=head, base=base)
        except GithubException as e:
            if e.status == 422:
                # すでにPRが存在する場合、既存のPRを探して返す
                logger.info(f"PR already exists for {head}. Fetching existing PR...")
                pulls = repo.get_pulls(state='open', head=f"{repo.owner.login}:{head}")
                if pulls.totalCount > 0:
                    return pulls[0]
            logger.error(f"Failed to create PR: {e}")
            return None

    async def get_issue_labels(self, repo_name: str, issue_number: int) -> List[str]:
        """Issue のラベル一覧を取得する"""
        try:
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            return [l.name for l in issue.get_labels()]
        except GithubException as e:
            logger.error(f"Failed to get labels: {e}")
            return []

    async def add_label(self, repo_name: str, issue_number: int, label_name: str):
        """Issue にラベルを付与する"""
        try:
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            # ラベルが存在しない場合に備えて、リポジトリ側での存在確認は省略（PyGithubが良きに計らう）
            issue.add_to_labels(label_name)
            logger.info(f"Added label '{label_name}' to Issue #{issue_number}")
        except GithubException as e:
            logger.error(f"Failed to add label: {e}")

    async def remove_label(self, repo_name: str, issue_number: int, label_name: str):
        """Issue からラベルを削除する"""
        try:
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            issue.remove_from_labels(label_name)
            logger.info(f"Removed label '{label_name}' from Issue #{issue_number}")
        except GithubException as e:
            # ラベルが元々付いていない場合のエラーは無視
            logger.debug(f"Label '{label_name}' not found on Issue #{issue_number}, skipping remove.")

    async def ensure_repo_cloned(self, repo_name: str, repo_path: str):
        """設計書 7.2: リポジトリをクローンまたは最新状態にする"""
        import subprocess
        import os
        if not os.path.exists(os.path.join(repo_path, ".git")):
            # クローン (OAuthトークンを含ませる)
            token = os.getenv("GITHUB_TOKEN", "")
            clone_url = f"https://x-access-token:{token}@github.com/{repo_name}.git"
            logger.info(f"Cloning {repo_name} to {repo_path}...")
            subprocess.run(["git", "clone", clone_url, "."], cwd=repo_path, check=True)
        else:
            # 最新化 (mainブランチであることを前提)
            logger.info(f"Updating {repo_name} in {repo_path}...")
            subprocess.run(["git", "fetch", "origin"], cwd=repo_path, check=True)
            subprocess.run(["git", "checkout", "main"], cwd=repo_path, check=True)
            subprocess.run(["git", "reset", "--hard", "origin/main"], cwd=repo_path, check=True)

    async def get_mentions_to_process(self, repo_name: str) -> List[Dict[str, Any]]:
        """@mentions を含む未処理の通知/コメントを取得する"""
        try:
            my_username = self.get_my_username()
            query = f"repo:{repo_name} mentions:{my_username} is:open"
            issues = self.g.search_issues(query, sort="updated", order="desc")
            
            results = []
            # 検索で見つかったIssue/PRごとに、最新のメンションコメントを特定する
            for issue in issues:
                latest_mention = None
                
                # 1. まずIssue本文をチェック
                if f"@{my_username}" in (issue.body or ""):
                    latest_mention = {
                        "number": issue.number,
                        "comment_id": "body",
                        "body": issue.body,
                        "created_at": issue.created_at
                    }
                
                # 2. 次にすべてのコメントをチェックして、より新しいメンションがあれば上書き
                comments = issue.get_comments()
                for comment in comments:
                    if f"@{my_username}" in (comment.body or ""):
                        latest_mention = {
                            "number": issue.number,
                            "comment_id": str(comment.id),
                            "body": comment.body,
                            "created_at": comment.created_at
                        }
                
                if latest_mention:
                    results.append(latest_mention)
            
            return results
        except GithubException as e:
            logger.error(f"Failed to get mentions: {e}")
            return []
