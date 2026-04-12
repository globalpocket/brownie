import os
import sys

# プロジェクトルートを追加
sys.path.append(os.getcwd())

from src.core.worker_pool import execute_task_wrapper, huey
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("verify_worker")

def test_enqueue():
    task_id = "globalpocket/brownie-sampleproject#1"
    repo_name = "globalpocket/brownie-sampleproject"
    issue_number = 1
    
    logger.info(f"Manually enqueuing task: {task_id}")
    # Huey タスクを呼び出す（非同期エンキュー）
    result = execute_task_wrapper(task_id, repo_name, issue_number)
    logger.info(f"Task enqueued. Result: {result}")

if __name__ == "__main__":
    test_enqueue()
