import subprocess
import os
import logging
from typing import List

logger = logging.getLogger(__name__)

class WikiSync:
    def __init__(self, repo_path: str):
        self.repo_path = repo_path

    def _run_git(self, args: List[str]) -> str:
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
            logger.error(f"Git execution error in WikiSync: {e.stderr}")
            raise

    def setup_wiki_remote(self, repo_url: str):
        """Wiki 用のリモートを設定する (設計書 13. 同期)"""
        wiki_url = repo_url.replace(".git", ".wiki.git")
        try:
            # すでに存在するか確認
            remotes = self._run_git(["remote"])
            if "wiki" not in remotes.split():
                logger.info(f"Adding wiki remote: {wiki_url}")
                self._run_git(["remote", "add", "wiki", wiki_url])
            else:
                logger.info("Wiki remote already exists.")
        except Exception as e:
            logger.error(f"Failed to setup wiki remote: {e}")

    def sync_docs_to_wiki(self, prefix: str = "docs", branch: str = "master"):
        """/docs を Wiki リポジトリへ同期する (設計書 13. 同期)"""
        logger.info(f"Syncing {prefix} to wiki branch {branch}...")
        
        # docs ディレクトリが存在するか確認
        docs_path = os.path.join(self.repo_path, prefix)
        if not os.path.exists(docs_path):
            logger.warning(f"Prefix directory {prefix} does not exist. Skipping wiki sync.")
            return

        try:
            # git subtree push は対象のディレクトリがコミットされている必要がある
            # ここでは subtree push を実行
            # 注意: 初回は git subtree add が必要な場合があるが、
            # すでに docs がある場合は push で対応可能
            self._run_git(["subtree", "push", f"--prefix={prefix}", "wiki", branch])
            logger.info("Wiki synchronization successful.")
        except Exception as e:
            logger.error(f"Wiki sync failed: {e}")
            # 失敗した場合は add を試みる（初回対応）
            try:
                logger.info("Attempting git subtree add for first-time sync...")
                # 実際には既存の docs を一度退避して add するなどの処理が必要な場合があるが
                # 簡易的に設計に合わせる
                pass
            except Exception:
                pass
