from typing import Dict, Any
from src.core.graph.state import TaskState
from src.core.workers.tasks import analysis_task

async def core_analysis_node(state: TaskState) -> Dict[str, Any]:
    """
    Phase 1: Core Analysis (全方位分析)
    Huey ワーカーに分析タスクを投入し、結果を待つ。
    """
    print(f"--- Phase 1: Core Analysis ({state['task_id']}) ---")
    
    # ワーカーの結果がまだ無い場合
    if state.get("status") != "Analysis_Completed":
        print(f"Enqueuing analysis_task for {state['task_id']}...")
        analysis_task(state['task_id'], state['repo_path'])
        
        return {
            "status": "Waiting_Analysis",
            "history": [{"node": "core_analysis", "status": "enqueued"}]
        }
    
    # ワーカーが結果を書き戻した後の処理
    print(f"Analysis data received for {state['task_id']}.")
    return {
        "status": "Phase1_Completed",
        "history": [{"node": "core_analysis", "status": "completed"}]
    }
