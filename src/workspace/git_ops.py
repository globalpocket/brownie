import subprocess
import os
import logging
import re
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

class GitOperations:
    def __init__(self, repo_path: str):
        self.repo_path = repo_path

    def _run_git(self, args: List[str]) -> str:
        """Gitコマンドの実行ラッパー"""
        try:
            result = subprocess.run(
                ["git"] + args,
                cwd=self.repo_path,
                capture_output=True,
                text=True,
                check=True
            )
            return result.stdout.strip()
        except subprocess.CalledProcessError as e:
            logger.error(f"Git execution error: {e.stderr}")
            raise

    def sync_lfs(self):
        """Git LFSの同期 (設計書 3.2, 5.1)"""
        logger.info("Syncing Git LFS...")
        self._run_git(["lfs", "install"])
        self._run_git(["lfs", "pull"])

    def fetch_rebase(self, branch: str = "main"):
        """Git Fetch & Rebase (設計書 7.1)"""
        self._run_git(["fetch", "origin"])
        self._run_git(["rebase", f"origin/{branch}"])

    def pull_rebase(self, branch: str = "main"):
        """Resume時の Pull-Rebase 同期 (設計書 3.2, 6)"""
        # 設計書では、人間が解決した最新状態を取り込むため必須。
        self._run_git(["pull", "--rebase", "origin", branch])

    def fuzzy_ast_replace(self, file_path: str, target: str, replacement: str):
        """Fuzzy / AST 置換 (設計書 3.2, 6)
        トークン保護と行ズレ補正（Desync）の自動補正を目指す。
        """
        full_path = os.path.join(self.repo_path, file_path)
        with open(full_path, 'r') as f:
            content = f.read()
        
        # 簡易的なFuzzy置換 (空白や記号の差を許容する)
        # 実際には tree-sitter 等による AST 置換が望ましい
        if target in content:
            new_content = content.replace(target, replacement)
        else:
            # 正規表現による Fuzzy マッチ
            fuzzy_pattern = re.escape(target).replace(r"\ ", r"\s+")
            new_content = re.sub(fuzzy_pattern, replacement, content, count=1)
        
        with open(full_path, 'w') as f:
            f.write(new_content)

    def verify_remote_sha(self, branch: str = "main") -> bool:
        """Race Condition 回避のための SHA 検証 (設計書 7.1)"""
        local_sha = self._run_git(["rev-parse", "HEAD"])
        remote_sha = self._run_git(["rev-parse", f"origin/{branch}"])
        return local_sha == remote_sha

    def create_and_checkout_branch(self, branch_name: str):
        """トピックブランチの作成と切り替え (設計書 7.1)"""
        logger.info(f"Creating and switching to branch: {branch_name}")
        # 最新の main からブランチを切る
        self._run_git(["checkout", "main"])
        self._run_git(["fetch", "origin", "main"])
        self._run_git(["reset", "--hard", "origin/main"])
        
        # 既存ブランチがあれば削除
        try:
            self._run_git(["branch", "-D", branch_name])
        except Exception:
            pass
        self._run_git(["checkout", "-b", branch_name])

    def checkout(self, branch_name: str):
        """ブランチの切り替え"""
        self._run_git(["checkout", branch_name])

    def commit_and_push(self, branch: str, message: str):
        """コミットとプッシュ"""
        self._run_git(["add", "."])
        # 未変更の場合にエラーにならないよう、差分チェック
        status = self._run_git(["status", "--porcelain"])
        if not status:
            logger.info("No changes to commit.")
            return
        self._run_git(["commit", "-m", message])
        self._run_git(["push", "origin", branch, "--force"]) # トピックブランチなので強制プッシュで上書き可とする
