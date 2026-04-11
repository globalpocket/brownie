import asyncio
import logging
import os
from typing import Dict, Any, Optional
from taskiq import TaskiqWorker, TaskiqEvents
from taskiq_fs import AsyncFSBroker

logger = logging.getLogger(__name__)

# 設計書課題: Pull型アーキテクチャの徹底 & Taskiq FSBroker による永続キューの実現
# ブローカーの初期化はモジュールレベルで行う（Taskiq のデコレータ登録のため）
broker = AsyncFSBroker(".brwn/task_queue")

class WorkerPool:
    def __init__(self, project_root: str, max_concurrent_inference: int = 1):
        self.project_root = project_root
        self.broker = broker
        
        # 推論の直列実行 (VRAM保護)
        self.inference_semaphore = asyncio.Semaphore(max_concurrent_inference)
        self.active_tasks: Dict[str, Dict[str, Any]] = {}
        self.is_running = False
        self._worker: Optional[TaskiqWorker] = None

    async def add_task(self, task_id: str, priority: int, 
                    repo_name: str, issue_number: int):
        """
        タスクを Taskiq ブローカーに追加する。
        """
        logger.info(f"Task {task_id} received. Queueing via Taskiq.")
        
        task_data = {
            "task_id": task_id,
            "priority": priority,
        }
        
        # Taskiq タスクのキック
        # orchestrator の参照はタスク実行時に解決するか、グローバルに保持する設計とする
        from src.core.worker_pool import execute_agent_task
        await execute_agent_task.kick(task_id, repo_name, issue_number)
        
        self.active_tasks[task_id] = task_data
        return task_data

    async def run(self):
        """Taskiq ワーカーを同一プロセス内で起動する (設計承認済み方針)"""
        logger.info("WorkerPool: Starting Taskiq Worker in-process...")
        self.is_running = True
        
        # ワーカーの初期化
        # self を通じて Orchestrator や Semaphore にアクセス可能にするため、
        # 依存関係注入（DI）的にブローカーに状態を持たせるか、グローバル参照を使用する
        self._worker = TaskiqWorker(self.broker, modules=["src.core.worker_pool"])
        
        # ブローカーの startup を明示的に呼ぶ必要がある場合
        if not self.broker.is_startup:
             await self.broker.startup()

        try:
            # Taskiq のワーカーメインループ
            await self._worker.run()
        except asyncio.CancelledError:
            logger.info("WorkerPool received CancelledError.")
        except Exception as e:
            logger.error(f"WorkerPool run error: {e}", exc_info=True)
        finally:
            self.is_running = False

    async def stop(self):
        self.is_running = False
        if self._worker:
            await self._worker.shutdown()
        await self.broker.shutdown()

    def get_queue_status(self) -> Dict[str, Any]:
        # Taskiq FSBroker ではキューのサイズ取得が直接的には難しいため、
        # 必要に応じて FS のディレクトリ内のファイル数を数えるなどの対応が可能
        return {
            "queue_size": "Check .brwn/task_queue",
            "active_tasks": list(self.active_tasks.values())
        }

# --- Taskiq Task Definitions ---

@broker.task(task_name="execute_agent_task")
async def execute_agent_task(task_id: str, repo_name: str, issue_number: int):
    """
    Taskiq によって Pull される実行実体。
    """
    # Orchestrator のインスタンスを取得（シングルトンまたはモジュールレベルの参照を想定）
    # ここでは循環参照を避けるため、実行時にインポートし、グローバルに登録された
    # Orchestrator インスタンスを使用して実処理（_execute_task）を呼び出す。
    from src.core.orchestrator import global_orchestrator
    
    if global_orchestrator is None:
        logger.error(f"Task {task_id} failed: global_orchestrator is not initialized.")
        return

    # VRAM保護セマフォによる制御
    async with global_orchestrator.worker_pool.inference_semaphore:
        logger.info(f"Taskiq PULL: Starting task {task_id}")
        try:
            await global_orchestrator._execute_task(task_id, repo_name, issue_number)
        except Exception as e:
            logger.error(f"Error in task {task_id}: {e}", exc_info=True)
        finally:
            if task_id in global_orchestrator.worker_pool.active_tasks:
                del global_orchestrator.worker_pool.active_tasks[task_id]
