import os
import time
import logging
import asyncio
import pathspec
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from src.workspace.analyzer.core import CodeAnalyzer
from src.workspace.linter import LinterEngine

logger = logging.getLogger(__name__)

class RepoWatcher(FileSystemEventHandler):
    """ リポジトリの変更を監視し、自動的に再スキャンを実行する """
    def __init__(self, repo_path: str):
        self.repo_path = repo_path
        self.analyzer = CodeAnalyzer(repo_path)
        self.linter = LinterEngine(repo_path)
        self.last_trigger = 0
        self.debounce_seconds = 2 # 連続した保存に対するデバウンス
        self.spec = self._load_gitignore()

    def _load_gitignore(self):
        """ .gitignore を読み込み pathspec オブジェクトを返す """
        gitignore_path = os.path.join(self.repo_path, ".gitignore")
        patterns = [".git/", "__pycache__/", "node_modules/"] # デフォルト除外
        if os.path.exists(gitignore_path):
            with open(gitignore_path, "r", encoding="utf-8") as f:
                patterns.extend(f.readlines())
        return pathspec.PathSpec.from_lines("gitwildmatch", patterns)

    def on_modified(self, event):
        if event.is_directory:
            return
        
        # 相対パスを取得
        rel_path = os.path.relpath(event.src_path, self.repo_path)
        
        # .gitignore にマッチ（除外対象）しているかチェック
        if self.spec.match_file(rel_path):
            return

        # 前は拡張子制限があったが、すべての管理対象ファイルを対象にする
        self._trigger_rescan()

    def on_created(self, event):
        self.on_modified(event)

    def _trigger_rescan(self):
        """ デバウンスを挟んで再スキャン及びバックグラウンド解析を実行 """
        now = time.time()
        if now - self.last_trigger < self.debounce_seconds:
            return
            
        self.last_trigger = now
        logger.info(f"Change detected in {self.repo_path}. Triggering background scans...")
        
        # 非同期でスキャンを実行（既存のイベントループを利用）
        try:
            loop = asyncio.get_running_loop()
            # 既存のプロジェクトスキャン
            loop.create_task(self.analyzer.scan_project())
            # 新規：バックグラウンドでの静的解析 (Semgrep & ast-grep)
            loop.create_task(self.linter.scan_semgrep())
            loop.create_task(self.linter.scan_astgrep())
        except RuntimeError:
            # ループが回っていない場合（テスト時・初期化時など）
            asyncio.run(self._run_all_scans())

    async def _run_all_scans(self):
        """ 同期的に実行する場合（フォールバック） """
        await self.analyzer.scan_project()
        await self.linter.scan_semgrep()
        await self.linter.scan_astgrep()

def start_watching(repo_paths: list):
    """ 複数のリポジトリを一括で監視開始 """
    observer = Observer()
    for path in repo_paths:
        if os.path.exists(path):
            handler = RepoWatcher(path)
            observer.schedule(handler, path, recursive=True)
            logger.info(f"Started watching for changes (language-agnostic): {path}")
            
    observer.start()
    return observer
