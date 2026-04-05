import os
import time
import logging
import asyncio
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler
from src.workspace.analyzer.core import CodeAnalyzer

logger = logging.getLogger(__name__)

class RepoWatcher(FileSystemEventHandler):
    """ リポジトリの変更を監視し、自動的に再スキャンを実行する """
    def __init__(self, repo_path: str):
        self.repo_path = repo_path
        self.analyzer = CodeAnalyzer(repo_path)
        self.last_trigger = 0
        self.debounce_seconds = 2 # 連続した保存に対するデバウンス

    def on_modified(self, event):
        if event.is_directory:
            return
        
        # 解析対象の拡張子かチェック
        ext = os.path.splitext(event.src_path)[1].lower()
        if ext in ('.py', '.js', '.ts', '.go'):
            self._trigger_rescan()

    def on_created(self, event):
        self.on_modified(event)

    def _trigger_rescan(self):
        """ デバウンスを挟んで再スキャンを実行 """
        now = time.time()
        if now - self.last_trigger < self.debounce_seconds:
            return
            
        self.last_trigger = now
        logger.info(f"Change detected in {self.repo_path}. Triggering incremental re-scan...")
        
        # 非同期でスキャンを実行（既存のイベントループを利用）
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self.analyzer.scan_project())
        except RuntimeError:
            # ループが回っていない場合（テスト時など）
            import asyncio
            asyncio.run(self.analyzer.scan_project())

def start_watching(repo_paths: list):
    """ 複数のリポジトリを一括で監視開始 """
    observer = Observer()
    for path in repo_paths:
        if os.path.exists(path):
            handler = RepoWatcher(path)
            observer.schedule(handler, path, recursive=True)
            logger.info(f"Started watching for changes: {path}")
            
    observer.start()
    return observer
