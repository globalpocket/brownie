from typing import Dict, Any, Optional
from src.core.graph.state import TaskState

async def governance_node(state: TaskState) -> Dict[str, Any]:
    """
    Phase 4: Governance & Fail-Safe
    稟議書（Ringi-sho）を提示し、人間の最終承認を待つ。
    """
    print(f"--- Phase 4: Governance & Ringi ({state['task_id']}) ---")
    
    # 承認済みかどうかをチェック
    if state.get("governance_decision") == "Approve":
        return {
            "status": "Completed",
            "history": [{"node": "governance", "status": "approved"}]
        }
    
    # ここに到達したということは、まだ承認されていないか、再考が必要
    ringi = state.get("ringi_document") or "【稟議書】タスクの実行準備が整いました。実施してよろしいでしょうか？"
    
    return {
        "status": "WaitingForApproval",
        "ringi_document": ringi,
        "history": [{"node": "governance", "status": "waiting_ringi"}]
    }
