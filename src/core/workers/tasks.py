import logging
import asyncio
from src.core.workers.pool import huey
from src.core.validation.bridge import InstructorBridge
from src.core.validation.schemas import RingiDocument
from langgraph.checkpoint.sqlite import SqliteSaver

logger = logging.getLogger(__name__)

def update_langgraph_state(thread_id: str, new_values: dict):
    """
    ワーカーから LangGraph の状態を直接更新するユーティリティ。
    """
    db_path = ".brwn/checkpoints.db"
    try:
        # Checkpointer を一時的に初期化して更新
        # 本来は Orchestrator と接続を共有するか、短時間の書き込みを行う
        from langgraph.checkpoint.sqlite import SqliteSaver
        import sqlite3
        
        conn = sqlite3.connect(db_path, check_same_thread=False)
        saver = SqliteSaver(conn)
        
        config = {"configurable": {"thread_id": thread_id}}
        saver.update_state(config, new_values)
        logger.info(f"Worker updated state for {thread_id}: {new_values.keys()}")
        conn.close()
    except Exception as e:
        logger.error(f"Failed to update LangGraph state: {e}")

@huey.task()
def analysis_task(task_id: str, repo_path: str):
    """
    Phase 1: 全方位分析ワーカー
    """
    logger.info(f"Worker: Starting analysis for {task_id}")
    # 疑似的な重い処理
    import time
    time.sleep(2) 
    
    result = {
        "analysis_data": {"critical_files": ["main.py", "utils.py"], "complexity": "high"},
        "status": "Analysis_Completed"
    }
    update_langgraph_state(task_id, result)
    logger.info(f"Worker: Analysis completed for {task_id}")

@huey.task()
def execution_task(task_id: str, plan: str):
    """
    Phase 3: 専門的実行ワーカー
    """
    logger.info(f"Worker: Starting execution for {task_id}")
    time.sleep(3)
    
    # 失敗をシミュレート (自己修復の禁止を検証するため)
    success = False 
    
    if not success:
        logger.error(f"Worker: Execution failed for {task_id}. Emitting error logs.")
        result = {
            "execution_status": "failed",
            "error_context": "Permission denied during file write in main.py",
            "status": "Execution_Failed"
        }
    else:
        result = {
            "execution_status": "success",
            "status": "Execution_Completed"
        }
        
    update_langgraph_state(task_id, result)

@huey.task()
def repair_task(task_id: str, error_context: str):
    """
    Phase 4: 修復専用ワーカー (Repair Agent)
    実行エージェントとは独立して動作し、代替案を作成する。
    """
    logger.info(f"Worker: Starting repair proposal for {task_id}")
    
    # Instructor を用いて 稟議書 (RingiDocument) を生成
    # (実際は LLM 呼び出しを行うが、ここではモック)
    ringi = RingiDocument(
        summary="ファイル書き込み権限エラーによる実行失敗",
        impact_analysis="main.py の更新が中断されたため、一部の機能が未実装のままです。",
        proposed_fix="Docker コンテナの権限設定を見直し、root ユーザーで再開するか、手動で権限を付与します。",
        risk_assessment="低: 一時的な書き込みエラーであり、コード自体の論理破綻ではありません。"
    )
    
    update_langgraph_state(task_id, {
        "ringi_document": ringi.model_dump_json(),
        "status": "Repair_Completed",
        "repair_needed": False # 修復案作成が完了したという意味
    })
    logger.info(f"Worker: Repair proposal created for {task_id}")
