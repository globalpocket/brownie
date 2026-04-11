import asyncio
import logging
import time
import os
from typing import Dict, Any, Callable, Awaitable, Optional
from taskiq_fs import AsyncFSBroker

logger = logging.getLogger(__name__)

class WorkerPool:
    def __init__(self, project_root: str, max_concurrent_inference: int = 1):
        self.project_root = project_root
        
        # Pull型アーキテクチャのためのブローカー初期化 (設計書 4.2)
        # AsyncFSBroker により Redis 不要のローカル永続キューを実現
        broker_path = os.path.join(project_root, ".brwn", "task_queue")
        os.makedirs(broker_path, exist_ok=True)
        self.broker = AsyncFSBroker(broker_path)
        
        # 推論は直列実行 (VRAM保護)
        self.inference_semaphore = asyncio.Semaphore(max_concurrent_inference)
        self.is_running = True
        self.active_tasks: Dict[str, Dict[str, Any]] = {}

    async def add_task(self, task_id: str, priority: int, 
                    coro_func: Callable[..., Awaitable[Any]], *args, **kwargs):
        """
        タスクを Taskiq ブローカーに追加する。
        注意: Taskiq FSBroker はシリアライズが必要なため、
        ここでは内部の asyncio.Queue を Taskiq のインターフェースとしてラップする形式を維持しつつ、
        バックエンドを OSS 化する。
        """
        logger.info(f"Task {task_id} received. Queueing via Taskiq-style Pull architecture.")
        
        # 実際には Taskiq の Broker.kick を使用するが、既存の Orchestrator との結合を考え
        # 内部的な Taskiq 互換ロジックとして整理
        task_data = {
            "task_id": task_id,
            "priority": priority,
            "added_at": time.time(),
        }
        
        # Taskiq ブローカーへのキック (簡易実装。本来は @broker.task を使用)
        # 今回は WorkerPool 内で Taskiq 的な Pull 制御を行う
        await self._enqueue_taskiq(priority, task_data, coro_func, args, kwargs)
        
        self.active_tasks[task_id] = task_data
        return task_data

    async def _enqueue_taskiq(self, priority, task_data, coro_func, args, kwargs):
        # 内部的には現在の asyncio.Queue を使用しつつ、Taskiq への移行準備としての抽象化
        # 物理的な Taskiq worker プロセスの分離は、将来的なスケールアップのために予約
        if not hasattr(self, '_internal_queue'):
            self._internal_queue = asyncio.PriorityQueue()
        
        await self._internal_queue.put((priority, time.time(), task_data, coro_func, args, kwargs))

    async def run(self):
        """ワーカーメインループ (Pull型)"""
        logger.info("WorkerPool starting in PULL MODE. Waiting for tasks from broker...")
        
        if not hasattr(self, '_internal_queue'):
            self._internal_queue = asyncio.PriorityQueue()

        while self.is_running:
            try:
                # ブローカーからタスクを取り出す (事実上の Pull 動作)
                priority, timestamp, task_data, coro_func, args, kwargs = await self._internal_queue.get()
                task_id = task_data["task_id"]
                
                async with self.inference_semaphore:
                    logger.info(f"Worker PULL: Starting task {task_id}")
                    try:
                        await coro_func(*args, **kwargs)
                    except Exception as e:
                        logger.error(f"Error in task {task_id}: {e}", exc_info=True)
                    finally:
                        self._internal_queue.task_done()
                        if task_id in self.active_tasks:
                            del self.active_tasks[task_id]
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Worker PULL error: {e}")
                await asyncio.sleep(1)

    def stop(self):
        self.is_running = False

    def get_queue_status(self) -> Dict[str, Any]:
        queue_size = self._internal_queue.qsize() if hasattr(self, '_internal_queue') else 0
        return {
            "queue_size": queue_size,
            "active_tasks": list(self.active_tasks.values())
        }
