import logging
from src.core.workers.pool import huey

logger = logging.getLogger(__name__)

class WorkerPool:
    def __init__(self, project_root=None):
        self.huey = huey

    async def run(self):
        logger.info("WorkerPool: Active.")

    def stop(self):
        pass

    async def add_task(self, task_id, priority, repo_name, issue_number, **kwargs):
        from src.core.workers.tasks import analysis_task
        # decorator 経由ではなく、明示的にシグネチャを作成して投入を試みる
        logger.info(f"Adding task {task_id} to queue...")
        try:
            analysis_task(task_id, repo_name, issue_number, kwargs)
            logger.info("Task enqueued successfully.")
            return True
        except Exception as e:
            logger.error(f"Task enqueue FAILED: {e}")
            return False
