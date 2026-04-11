import asyncio
import logging
from typing import Dict, Any, Optional
from taskiq import TaskiqWorker, Context, TaskiqDepends
from taskiq_fs import AsyncFSBroker

logger = logging.getLogger(__name__)

# 設計書課題: Pull型アーキテクチャの徹底 & Taskiq FSBroker による永続キューの実現
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
        
        from src.core.worker_pool import execute_agent_task
        await execute_agent_task.kick(task_id, repo_name, issue_number)
        
        self.active_tasks[task_id] = task_data
        return task_data

    async def run(self):
        """Taskiq ワーカーを同一プロセス内で起動する"""
        logger.info("WorkerPool: Starting Taskiq Worker in-process...")
        self.is_running = True
        
        self._worker = TaskiqWorker(self.broker, modules=["src.core.worker_pool"])
        
        if not self.broker.is_startup:
             await self.broker.startup()

        try:
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
        return {
            "queue_size": "Check .brwn/task_queue",
            "active_tasks": list(self.active_tasks.values())
        }

# --- Taskiq Task Definitions ---

@broker.task(task_name="execute_agent_task")
async def execute_agent_task(
    task_id: str, 
    repo_name: str, 
    issue_number: int,
    context: Context = TaskiqDepends()
):
    """
    Taskiq によって Pull される実行実体。
    broker.state 経由で Orchestrator インスタンスを取得する透明性の高い DI 構成。
    """
    orchestrator = context.state.orchestrator
    
    if orchestrator is None:
        logger.error(f"Task {task_id} failed: orchestrator is not found in broker state.")
        return

    # VRAM保護セマフォ（Orchestrator側で管理）による制御
    async with orchestrator.worker_pool.inference_semaphore:
        logger.info(f"Taskiq PULL: Starting task {task_id}")
        try:
            await orchestrator._execute_task(task_id, repo_name, issue_number)
        except Exception as e:
            logger.error(f"Error in task {task_id}: {e}", exc_info=True)
        finally:
            if task_id in orchestrator.worker_pool.active_tasks:
                del orchestrator.worker_pool.active_tasks[task_id]
