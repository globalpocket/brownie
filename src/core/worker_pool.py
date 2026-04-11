import os
import logging
from huey import SqliteHuey

logger = logging.getLogger(__name__)

# 設計書課題: Huey (SQLite) による軽量な非同期タスクキューの実現
# project_root からの相対パスで DB ファイルを指定
db_path = os.path.join(os.getcwd(), ".brwn", "huey.db")
os.makedirs(os.path.dirname(db_path), exist_ok=True)

# Huey インスタンスの初期化
huey = SqliteHuey(filename=db_path)

@huey.task()
def execute_task_wrapper(task_id: str, repo_name: str, issue_number: int):
    """
    Huey ワーカープロセスで実行されるタスクの実体。
    Orchestrator とは別プロセスで動作するため、ここで必要なコンテキストを再構成し、
    LangGraph ワークフローを実行する。
    """
    import asyncio
    from src.core.orchestrator import global_orchestrator
    
    logger.info(f"Huey Worker: Starting task {task_id} for {repo_name}#{issue_number}")
    
    # 実際の実装では、Orchestrator のインスタンスを取得（またはシリアライズされた設定から再構築）
    # し、非同期ループ内で実行する。
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    # 実行実体 (Orchestrator._execute_task_internal) を非同期実行
    # NOTE: global_orchestrator はワーカープロセス側では通常 None になるため、
    # ワーカー自身が Orchestrator 相当の最小限のコンテキストを持つ必要がある。
    # ここでは概念設計に基づき、Orchestrator 経由で実行をキックする構造を示す。
    if global_orchestrator:
        loop.run_until_complete(global_orchestrator._execute_task(task_id, repo_name, issue_number))
    else:
        # ワーカー用に Orchestrator を最小構成で初期化（または共有設定からロード）
        # 実際には config ファイルパスなどを引数で渡すのがより堅牢
        from src.core.orchestrator import Orchestrator
        config_path = os.environ.get("BROWNIE_CONFIG", "config/config.yaml")
        worker_orchestrator = Orchestrator(config_path)
        # state.py 廃止に伴い、状態はすべて LangGraph の Checkpointer から復元される
        loop.run_until_complete(worker_orchestrator._execute_task(task_id, repo_name, issue_number))

class WorkerPool:
    """
    Huey へのブリッジ。Orchestrator からタスクを投入するために使用。
    """
    def __init__(self, project_root: str):
        self.project_root = project_root
        self.huey = huey

    async def add_task(self, task_id: str, priority: int, repo_name: str, issue_number: int):
        """
        タスクを Huey のキュー（SQLite）に投入する。
        """
        logger.info(f"Queueing task {task_id} via Huey...")
        # Huey は同期ライブラリだが、キューへの投入は軽量なため、
        # 必要に応じて thread でラップするか、そのまま呼び出す。
        execute_task_wrapper(task_id, repo_name, issue_number)
        return {"task_id": task_id, "status": "queued"}

    async def run(self):
        """
        Orchestrator 起動時にワーカープロセスを自動起動する（ユーザー指示 1）。
        """
        import subprocess
        import sys
        
        logger.info("WorkerPool: Starting Huey consumer process...")
        # python -m huey.bin.consumer src.core.worker_pool.huey 形式で起動
        cmd = [
            sys.executable, "-m", "huey.bin.consumer", 
            "src.core.worker_pool.huey", 
            "-w", "1" # 推論 VRAM 保護のため、デフォルトはシングルワーカー
        ]
        
        # バックグラウンドプロセスとして起動
        process = subprocess.Popen(
            cmd, 
            stdout=subprocess.PIPE, 
            stderr=subprocess.PIPE,
            cwd=self.project_root
        )
        logger.info(f"Huey consumer started with PID: {process.pid}")
        return process

    async def stop(self):
        logger.info("WorkerPool: Huey is managed as a separate process. Manual cleanup may be required if not handled by OS signals.")
