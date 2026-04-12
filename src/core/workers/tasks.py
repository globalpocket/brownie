import logging
import asyncio
import time
import os
from src.core.workers.pool import huey

logger = logging.getLogger(__name__)

def update_langgraph_state(thread_id: str, new_values: dict):
    db_path = ".brwn/checkpoints.db"
    try:
        from langgraph.checkpoint.sqlite import SqliteSaver
        import sqlite3
        conn = sqlite3.connect(db_path, check_same_thread=False)
        saver = SqliteSaver(conn)
        config = {"configurable": {"thread_id": thread_id}}
        saver.update_state(config, new_values)
        conn.close()
        logger.info(f"Worker updated state for {thread_id}")
    except Exception as e:
        logger.error(f"Failed to update state: {e}")

@huey.task()
def analysis_task(task_id, repo_name, issue_number, payload):
    logger.info(f"Worker: Starting analysis for {task_id}")
    # 実際はここでエージェントを実行する
    time.sleep(1)
    update_langgraph_state(task_id, {"status": "Analysis_Completed"})

@huey.task()
def execution_task(task_id, repo_name, issue_number, payload):
    logger.info(f"Worker: Starting execution for {task_id}")
    time.sleep(1)
    update_langgraph_state(task_id, {"status": "Execution_Completed"})

@huey.task()
def repair_task(task_id, repo_name, issue_number, payload):
    logger.info(f"Worker: Starting repair for {task_id}")
    time.sleep(1)
    update_langgraph_state(task_id, {"status": "Repair_Completed"})
