import asyncio
import logging
import time
from typing import Dict, Any, Callable, Awaitable, Optional

logger = logging.getLogger(__name__)

class WorkerPool:
    def __init__(self, max_concurrent_inference: int = 1):
        # 推論は直列実行 (VRAM保護・設計書に従い)
        self.inference_semaphore = asyncio.Semaphore(max_concurrent_inference)
        self.queue = asyncio.PriorityQueue()
        self.is_running = True
        self.active_tasks: Dict[str, Dict[str, Any]] = {}

    async def add_task(self, task_id: str, priority: int, 
                    coro_func: Callable[..., Awaitable[Any]], *args, **kwargs):
        """タスクをキューに追加。priorityが低いほど優先度が高い。"""
        # 設計書 4. WorkerPool: 推定時間を通知
        estimated_start_time = self._calculate_estimated_wait()
        
        task_data = {
            "task_id": task_id,
            "priority": priority,
            "added_at": time.time(),
            "estimated_wait_min": estimated_start_time
        }
        
        # (priority, timestamp, task_data, coro_func, args, kwargs)
        await self.queue.put((priority, time.time(), task_data, coro_func, args, kwargs))
        self.active_tasks[task_id] = task_data
        
        logger.info(f"Task {task_id} added to queue with priority {priority}. Estimated wait: {estimated_start_time} min.")
        return task_data

    def _calculate_estimated_wait(self) -> int:
        """キューの長さに基づいた推定待ち時間の計算 (分)"""
        # 簡易的に1タスクあたり平均10分と仮定 (設計書 UX通知に基づき)
        return self.queue.qsize() * 10

    async def run(self):
        """ワーカーメインループ"""
        while self.is_running:
            try:
                priority, timestamp, task_data, coro_func, args, kwargs = await self.queue.get()
                task_id = task_data["task_id"]
                
                async with self.inference_semaphore:
                    logger.info(f"Starting task {task_id} (Priority: {priority})")
                    try:
                        await coro_func(*args, **kwargs)
                    except Exception as e:
                        logger.error(f"Error in task {task_id}: {e}", exc_info=True)
                    finally:
                        self.queue.task_done()
                        if task_id in self.active_tasks:
                            del self.active_tasks[task_id]
                
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Worker thread error: {e}")
                await asyncio.sleep(1)

    def stop(self):
        self.is_running = False

    def get_queue_status(self) -> Dict[str, Any]:
        return {
            "queue_size": self.queue.qsize(),
            "active_tasks": list(self.active_tasks.values())
        }
