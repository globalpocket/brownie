from typing import Dict, Any
from src.core.graph.state import TaskState

async def intent_alignment_node(state: TaskState) -> Dict[str, Any]:
    """
    Phase 0: Intent Alignment
    ユーザーの意図を汲み取り、評価軸（Evaluation Axes）を提示して合意を得る。
    """
    print(f"--- Phase 0: Intent Alignment ({state['task_id']}) ---")
    
    # 本来は Instructor を使って LLM からドラフト生成
    draft = f"以下の意図で受け承りました: {state['instruction']}\n評価軸: [論理整合性, 破壊的変更の有無]"
    
    return {
        "status": "Phase0_Alignment",
        "intent_confirmed": False, # 初回は False でユーザー確認待ちを促す想定
        "intent_draft": draft,
        "history": [{"node": "intent_alignment", "status": "draft_created"}]
    }
