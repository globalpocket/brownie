import logging
import asyncio
import time
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
def execution_task(task_id: str, repo_path: str, plan: str):
    """
    Phase 3: 専門的実行ワーカー (Strict Prompt v2)
    1. 修正が必要か判定 (現在は簡易判定)
    2. 必要に応じてトピックブランチを作成 (Lazy Branching)
    3. コード修正の実行
    4. サンドボックスでの検証 (pytest 等)
    """
    from src.workspace.git_ops import GitOperations
    from src.workspace.sandbox import SandboxManager
    import os
    
    logger.info(f"Worker: Starting execution for {task_id}")
    
    # モジュール初期化
    git = GitOperations(repo_path)
    # 本来は config から取得。ここでは簡易化
    sandbox = SandboxManager(user_id=1000, group_id=1000) 
    sandbox.set_workspace_root(repo_path)
    
    has_changes = False
    topic_branch = None
    test_results = None
    
    try:
        # 1. 修正が必要か判定 (ここではプランの内容を見て擬似的に判定)
        # 本来は分析結果や LLM の判定に基づきます
        if "MODIFICATION_REQUIRED" in plan or "FIX" in plan.upper():
            has_changes = True
            topic_branch = f"brwn-fix-{int(time.time())}"
            
            # 2. 遅延ブランチ作成 (Lazy Branching)
            logger.info(f"Worker: Modifications required. Creating branch {topic_branch}")
            git.create_and_checkout_branch(topic_branch, "main") # 仮のベースブランチ
            
            # 3. コード修正 (モック: 実際はエージェントが実施)
            # 例として README.md を更新
            sandbox.write_file("README.md", f"# Updated by Brownie\nPlan: {plan}")
            
            # 4. サンドボックス内検証 (pytest 等)
            logger.info("Worker: Running sandbox tests...")
            # asyncio ループを一時的に作成して非同期メソッドを呼ぶ
            import asyncio
            test_results = asyncio.run(sandbox.run_command("ls -R")) # 本来は "pytest" 等
        else:
            logger.info("Worker: No modifications required for this task.")

        result = {
            "status": "Execution_Completed",
            "has_changes": has_changes,
            "topic_branch": topic_branch,
            "test_results": test_results,
            "execution_status": "success"
        }
        
    except Exception as e:
        logger.error(f"Worker: Execution failed for {task_id}: {e}")
        result = {
            "status": "Execution_Failed",
            "error_context": str(e),
            "execution_status": "failed"
        }
        
    update_langgraph_state(task_id, result)
    logger.info(f"Worker: Execution processed for {task_id}")

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
