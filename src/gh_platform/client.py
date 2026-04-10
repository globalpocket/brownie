import logging
import time
import random
import functools
from typing import Optional, List, Dict, Any
from github import Github, GithubException, Auth
import re
import json
import asyncio

logger = logging.getLogger(__name__)

class GitHubRateLimitException(Exception):
    """GitHubのレートリミットに達したことを示す例外"""
    def __init__(self, message: str, reset_at: float):
        super().__init__(message)
        self.reset_at = reset_at

class GitHubClientWrapper:
    def __init__(self, token: str):
        if not token:
            raise ValueError("GITHUB_TOKEN is not set. Please set it as an environment variable (e.g., export GITHUB_TOKEN=...).")
        self.auth = Auth.Token(token)
        self.g = Github(auth=self.auth)
        self.etags: Dict[str, str] = {}
        self.last_api_call_time = 0
        self._my_username: Optional[str] = None

    def github_retry(func):
        """GitHub API の一時的なエラーに対するリトライデコレータ"""
        @functools.wraps(func)
        async def wrapper(self, *args, **kwargs):
            max_retries = 3
            base_delay = 5  # 秒
            for attempt in range(max_retries):
                try:
                    return await func(self, *args, **kwargs)
                except GithubException as e:
                    # 429 (Too Many Requests) または 403 (Secondary Rate Limit) はリトライ可能
                    is_retryable = (e.status == 429) or (e.status == 403 and "secondary" in str(e).lower())
                    
                    if is_retryable and attempt < max_retries - 1:
                        # Exponential Backoff + Jitter (揺らぎ)
                        delay = (base_delay ** (attempt + 1)) + (random.random() * 5)
                        logger.warning(f"Retryable GitHub API error {e.status}. Retrying in {delay:.2f}s... (Attempt {attempt+1}/{max_retries})")
                        await asyncio.sleep(delay)
                        continue
                    
                    # リトライ不可、または最大回数到達時は通常の例外ハンドラへ
                    self._handle_exception(e)
            return None
        return wrapper

    async def _throttle(self, is_write: bool = False):
        """API呼び出しの流量を制御する (設計書 拡張)"""
        now = time.time()
        elapsed = now - self.last_api_call_time
        # 読み取りは最低1秒、書き込みは最低3秒空ける
        delay = 3.0 if is_write else 1.0
        if elapsed < delay:
            await asyncio.sleep(delay - elapsed)
        self.last_api_call_time = time.time()

    def _handle_exception(self, e: GithubException):
        """GitHub例外の共通処理。レートリミットを検知して専用例外を投げる"""
        if e.status == 403 and "rate limit" in str(e).lower():
            # リセット時刻を取得 (デフォルトは1回リトライ後の1時間後)
            reset_at = time.time() + 3600
            if e.headers and 'x-ratelimit-reset' in e.headers:
                reset_at = float(e.headers['x-ratelimit-reset'])
            raise GitHubRateLimitException(f"GitHub Rate Limit Reached: {e}", reset_at)
        raise e

    def get_my_username(self) -> str:
        """認証されたユーザーのユーザー名を動的に取得する"""
        if self._my_username is None:
            try:
                user = self.g.get_user()
                self._my_username = user.login
                logger.info(f"Authenticated as GitHub user: {self._my_username}")
            except GithubException as e:
                self._handle_exception(e)
        return self._my_username

    async def get_repo_owner(self, repo_name: str) -> str:
        """ リポジトリのオーナー名を取得する """
        try:
            await self._throttle(is_write=False)
            repo = self.g.get_repo(repo_name)
            return repo.owner.login
        except Exception as e:
            logger.error(f"Failed to get repo owner for {repo_name}: {e}")
            return ""

    async def get_issues_to_process(self, repo_name: str) -> List[Any]:
        """自分（アサイニ）に割り当てられたIssue/PRを取得する。"""
        try:
            await self._throttle(is_write=False)
            my_username = self.get_my_username()
            repo = self.g.get_repo(repo_name)
            
            issues = repo.get_issues(state='open', assignee=my_username, sort='updated', direction='desc')
            
            to_process = []
            for issue in issues:
                if issue.user.type == "Bot":
                    continue
                to_process.append(issue)
            
            if to_process:
                logger.info(f"Found {len(to_process)} issues assigned to {my_username} in {repo_name}")
            return to_process
        except GithubException as e:
            self._handle_exception(e)
            return []

    async def check_rbac(self, repo_name: str, username: str) -> bool:
        """ユーザーがリポジトリの Collaborator または Owner かを検証する"""
        try:
            await self._throttle(is_write=False)
            repo = self.g.get_repo(repo_name)
            return repo.has_in_collaborators(username)
        except GithubException as e:
            self._handle_exception(e)
            return False

    @github_retry
    async def post_comment(self, repo_name: str, issue_number: int, body: str):
        """コメントを投稿する"""
        try:
            await self._throttle(is_write=True)
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            issue.create_comment(body)
        except GithubException as e:
            self._handle_exception(e)

    @github_retry
    async def create_pull_request(self, repo_name: str, title: str, body: str, head: str, base: str):
        """プルリクエストを作成する (既存の場合は取得する)"""
        try:
            await self._throttle(is_write=True)
            repo = self.g.get_repo(repo_name)
            pr = repo.create_pull(title=title, body=body, head=head, base=base)
            return pr
        except GithubException as e:
            if e.status == 422:
                logger.info(f"PR already exists for {head}. Fetching existing PR...")
                pulls = repo.get_pulls(state='open', head=f"{repo.owner.login}:{head}")
                if pulls.totalCount > 0:
                    return pulls[0]
            self._handle_exception(e)
            return None

    @github_retry
    async def close_pull_request(self, repo_name: str, pull_number: int):
        """プルリクエストを閉じる"""
        try:
            repo = self.g.get_repo(repo_name)
            pr = repo.get_pull(pull_number)
            
            # 関連 Issue の抽出 (タイトルと本文から抽出)
            context_to_scan = f"{pr.title}\n{pr.body or ''}"
            # パターンを強化: Issue #5, Fix #5, または単なる #5 にもマッチさせる
            issue_matches = re.findall(r"(?:Fixes|Closes|Fix|Close|Resolved|Resolves|Issue|See)?\s*#(\d+)", context_to_scan, re.IGNORECASE)
            
            # PR を閉じる
            pr.edit(state="closed")
            logger.info(f"Closed Pull Request #{pull_number} in {repo_name}")
            
            # 関連 Issue への通知
            for issue_num_str in set(issue_matches): # 重複を除去
                issue_num = int(issue_num_str)
                # 自身（PR番号）への通知は避ける
                if issue_num == pull_number:
                    continue
                    
                try:
                    msg = f"📢 この Issue に関連する PR #{pull_number} がキャンセル（クローズ）されました。必要に応じて作業状況を再確認してください。"
                    issue = repo.get_issue(issue_num)
                    issue.create_comment(msg)
                    logger.info(f"Notified Issue #{issue_num} about PR #{pull_number} closure.")
                except Exception as ie:
                    logger.warning(f"Failed to notify linked Issue #{issue_num}: {ie}")
            
            # トピックブランチの削除 (設計書 7.1)
            # 安全のため、主要なブランチは除外
            branch_name = pr.head.ref
            protected_branches = ["main", "master", "develop", "stg", "prod"]
            
            # head と base が同じリポジトリ（自リポジトリ内ブランチ）の場合のみ削除
            if branch_name not in protected_branches and pr.head.repo.full_name == repo_name:
                try:
                    ref = repo.get_git_ref(f"heads/{branch_name}")
                    ref.delete()
                    logger.info(f"Deleted topic branch '{branch_name}' after closing PR #{pull_number}.")
                except GithubException as ge:
                    if ge.status == 404:
                        logger.info(f"Branch '{branch_name}' already deleted or not found.")
                    else:
                        logger.warning(f"Failed to delete branch '{branch_name}': {ge}")
                except Exception as e:
                    logger.warning(f"Unexpected error deleting branch '{branch_name}': {e}")
                    
        except GithubException as e:
            logger.error(f"Failed to close PR #{pull_number}: {e}")

    async def create_issue(self, repo_name: str, title: str, body: str) -> int:
        """新しいIssueを作成する"""
        try:
            repo = self.g.get_repo(repo_name)
            issue = repo.create_issue(title=title, body=body)
            logger.info(f"Successfully created Issue #{issue.number} in {repo_name}: {title}")
            # レートリミット対策: 書き込み操作の後にスリープを入れる
            time.sleep(2)
            return issue.number
        except GithubException as e:
            logger.error(f"Failed to create issue in {repo_name}: {e}")
            raise

    async def close_issue(self, repo_name: str, issue_number: int):
        """Issueをクローズする"""
        try:
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            issue.edit(state="closed")
            logger.info(f"Closed Issue #{issue_number} in {repo_name}")
            # レートリミット対策: 書き込み操作の後にスリープを入れる
            time.sleep(2)
        except GithubException as e:
            logger.error(f"Failed to close issue in {repo_name}: {e}")
            raise

    async def merge_pull_request(self, repo_name: str, pull_number: int, commit_message: str = ""):
        """プルリクエストをマージする"""
        try:
            repo = self.g.get_repo(repo_name)
            pr = repo.get_pull(pull_number)
            pr.merge(commit_message=commit_message)
            logger.info(f"Merged Pull Request #{pull_number} in {repo_name}")
            # レートリミット対策: 書き込み操作の後にスリープを入れる
            time.sleep(2)
        except GithubException as e:
            logger.error(f"Failed to merge PR #{pull_number}: {e}")

    async def get_inline_comment_context(self, repo_name: str, comment_id: int):
        """インラインコメント（Diffコメント）から対象ファイルと行番号、コード断片を取得する"""
        try:
            repo = self.g.get_repo(repo_name)
            # GitHub API では pull コメントとして取得
            comment = repo.get_pull_review_comment(comment_id)
            return {
                "path": comment.path,
                "line": comment.line or comment.original_line,
                "diff_hunk": comment.diff_hunk,
                "body": comment.body
            }
        except Exception as e:
            logger.error(f"Failed to get inline context for comment {comment_id}: {e}")
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

    async def get_comment_body(self, repo_name: str, issue_number: int, comment_id: str) -> Optional[str]:
        """各種 ID 形式（body, 数値, review-, rc-）からコメント本文を取得する"""
        try:
            await self._throttle(is_write=False)
            repo = self.g.get_repo(repo_name)
            issue = repo.get_issue(issue_number)
            
            if comment_id == "body":
                return issue.body
                
            if comment_id.startswith("review-"):
                review_id = int(comment_id.split("-")[1])
                # PullRequest オブジェクトを取得
                pr = issue.as_pull_request()
                # 特定の Review を ID で直接取得するメソッドがないため、一覧から探す
                for r in pr.get_reviews():
                    if r.id == review_id:
                        return r.body
                return None
                
            if comment_id.startswith("rc-"):
                rc_id = int(comment_id.split("-")[1])
                # レビューコメント（インラインコメント）を取得
                comment = repo.get_pull_review_comment(rc_id)
                return comment.body
                
            # 通常の Issue/PR コメント (数値文字列)
            comment = issue.get_comment(int(comment_id))
            return comment.body
        except Exception as e:
            logger.error(f"Failed to get comment body for {comment_id}: {e}")
            return None

    async def get_mentions_to_process(self, repo_name: Optional[str] = None) -> List[Dict[str, Any]]:
        """@mentions を含む未処理の通知/コメントを取得する。repo_name が None の場合は全リポジトリから検索する。"""
        try:
            import os
            my_username = os.getenv("USER_NAME") or self.get_my_username()
            
            if repo_name:
                query = f"repo:{repo_name} \"@{my_username}\" is:open"
            else:
                # 全プロジェクトを対象としたメンション検索
                query = f"mentions:{my_username} is:open"
            
            issues = self.g.search_issues(query, sort="updated", order="desc")
            
            results = []
            # 検索で見つかったIssue/PRごとに、最新のメンションコメントを特定する
            for issue in issues:
                try:
                    latest_mention = None
                    issue_repo_name = issue.repository.full_name
                    
                    # 1. まずIssue本文をチェック (自分自身の投稿は除外)
                    issue_author = issue.user.login if issue.user else None
                    if f"@{my_username}" in (issue.body or "") and issue_author != my_username:
                        latest_mention = {
                            "repo_name": issue_repo_name,
                            "number": issue.number,
                            "comment_id": "body",
                            "body": issue.body,
                            "created_at": issue.created_at
                        }
                    
                    # 2. 次にすべてのコメントをチェック
                    try:
                        comments = issue.get_comments()
                        for comment in comments:
                            comment_author = comment.user.login.lower() if comment.user else None
                            if f"@{my_username.lower()}" in (comment.body or "").lower() and comment_author != my_username.lower():
                                if not latest_mention or comment.created_at > latest_mention["created_at"]:
                                    latest_mention = {
                                        "repo_name": issue_repo_name,
                                        "number": issue.number,
                                        "comment_id": str(comment.id),
                                        "body": comment.body,
                                        "created_at": comment.created_at
                                    }
                    except Exception as ce:
                        logger.warning(f"Failed to scan comments for Issue #{issue.number} in {issue_repo_name}: {ce}")

                    # 3. プルリクエストの場合、レビューとレビューコメントもチェック
                    if issue.pull_request:
                        try:
                            pr = issue.as_pull_request()
                            
                            # レビューサマリー (承認/却下時のタイトルコメント)
                            reviews = pr.get_reviews()
                            for review in reviews:
                                review_author = review.user.login.lower() if review.user else None
                                if review.body and f"@{my_username.lower()}" in review.body.lower() and review_author != my_username.lower():
                                    if not latest_mention or review.submitted_at > latest_mention["created_at"]:
                                        latest_mention = {
                                            "repo_name": issue_repo_name,
                                            "number": issue.number,
                                            "comment_id": f"review-{review.id}",
                                            "body": review.body,
                                            "created_at": review.submitted_at
                                        }

                            # レビューインラインコメント (コードへの直接指摘)
                            review_comments = pr.get_review_comments()
                            for r_comment in review_comments:
                                r_author = r_comment.user.login.lower() if r_comment.user else None
                                if f"@{my_username.lower()}" in (r_comment.body or "").lower() and r_author != my_username.lower():
                                    if not latest_mention or r_comment.created_at > latest_mention["created_at"]:
                                        latest_mention = {
                                            "repo_name": issue_repo_name,
                                            "number": issue.number,
                                            "comment_id": f"rc-{r_comment.id}",
                                            "body": r_comment.body,
                                            "created_at": r_comment.created_at
                                        }
                        except Exception as pe:
                            logger.warning(f"Failed to scan PR details for Issue #{issue.number} in {issue_repo_name}: {pe}")
                    
                    if latest_mention:
                        results.append(latest_mention)
                except Exception as ie:
                    logger.error(f"Error processing Issue in search results: {ie}")
                    continue
            
            return results
        except GithubException as e:
            logger.error(f"Failed to get mentions: {e}")
            return []
        except GithubException as e:
            logger.error(f"Failed to get mentions: {e}")
            return []
