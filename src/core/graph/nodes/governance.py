from typing import Dict, Any, Optional
from src.core.graph.state import TaskState
from src.core.workers.tasks import repair_task

async def governance_node(state: TaskState) -> Dict[str, Any]:
    """
    Phase 4: Governance & Fail-Safe
    実行失敗時は修復ワーカーをキックし、稟議書（Ringi-sho）を提示する。
    """
    print(f"--- Phase 4: Governance & Ringi ({state['task_id']}) ---")
    
    # 実行失敗かつ修復がまだの場合
    if state.get("status") == "Execution_Failed" and not state.get("ringi_document"):
        print(f"Execution failed. Enqueuing repair_task for {state['task_id']}...")
        repair_task(state['task_id'], state.get("error_context", "Unknown error"))
        return {
            "status": "Waiting_Repair",
            "history": [{"node": "governance", "status": "repair_enqueued"}]
        }

    # 承認済みかどうかをチェック
    if state.get("governance_decision") == "Approve":
        return {
            "status": "Completed",
            "history": [{"node": "governance", "status": "approved"}]
        }
    
    # 稟議書（Ringi）が作成されているか、再考が必要な状態
    ringi = state.get("ringi_document") or "【稟議書】タスクの実行準備が整いました。実施してよろしいでしょうか？"
    
    return {
        "status": "WaitingForApproval",
        "ringi_document": ringi,
        "history": [{"node": "governance", "status": "waiting_ringi"}]
    }
