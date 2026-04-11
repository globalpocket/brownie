import logging
import operator
from typing import TypedDict, List, Dict, Any, Optional, Annotated
from langgraph.graph import StateGraph, END
from src.workspace.analyzer.flow import FlowTracer
from src.workspace.analyzer.core import CodeAnalyzer

logger = logging.getLogger(__name__)

class TaskState(TypedDict):
    """
    LangGraph のワークフロー状態定義 (設計書課題: 状態管理の一本化)
    state.py の tasks テーブルの責務をすべて統合します。
    """
    task_id: str
    repo_name: str
    issue_number: int
    pr_number: Optional[int]
    status: str # 'InQueue', 'InProgress', 'Completed', 'Failed', 'Suspended', 'WaitingForClarification'
    
    # コンテキスト (GitHub 連携用)
    trigger_comment_id: Optional[str]
    resume_comment_id: Optional[str]
    
    # ライフサイクル
    created_at: str
    updated_at: str
    
    # 実行指示
    instruction: str
    repo_path: str
    
    # 解析結果
    critical_dependencies: List[Dict[str, Any]]
    context_mermaid: str
    
    # 承認フロー
    plan: str
    is_approved: bool
    user_feedback: Optional[str]
    
    # 実行結果
    implementation_result: bool
    final_summary: str
    
    # 履歴 (Annotated でリストの追加マージを指定)
    history: Annotated[List[Dict[str, Any]], operator.add]

class TaskWorkflow:
    def __init__(self, config: Dict[str, Any], project_root: str):
        self.config = config
        self.project_root = project_root
        self.builder = StateGraph(TaskState)
        self._setup_graph()

    def _setup_graph(self):
        """ワークフローグラフの構築"""
        # ノードの登録
        self.builder.add_node("analyze", self.analyze_node)
        self.builder.add_node("plan", self.planning_node)
        self.builder.add_node("approve_wait", self.approve_wait_node)
        self.builder.add_node("execute", self.execution_node)
        self.builder.add_node("report", self.reporting_node)

        # エッジの設定
        self.builder.set_entry_point("analyze")
        self.builder.add_edge("analyze", "plan")
        self.builder.add_edge("plan", "approve_wait")
        
        # 条件付きエッジ: 承認されたら execute へ、却下されたら plan へ
        self.builder.add_conditional_edges(
            "approve_wait",
            self.check_approval,
            {
                "approved": "execute",
                "needs_revision": "plan",
                "rejected": END
            }
        )
        
        self.builder.add_edge("execute", "report")
        self.builder.add_edge("report", END)

    async def analyze_node(self, state: TaskState) -> Dict[str, Any]:
        """コード解析ノード"""
        logger.info(f"[{state['task_id']}] Node: analyze | Status: InProgress")
        
        analyzer = CodeAnalyzer(state['repo_path'])
        await analyzer.scan_project()
        analyzer.close()
        
        # FlowTracer (NetworkX) で解析
        db_path = f"{state['repo_path']}/.brwn/index.db"
        tracer = FlowTracer(db_path)
        tracer.build_graph()
        
        critical = tracer.get_critical_dependencies(top_k=5)
        mermaid = ""
        if critical:
            mermaid = tracer.trace_flow(critical[0]['symbol'])
        tracer.close()
        
        return {
            "status": "InProgress",
            "critical_dependencies": critical,
            "context_mermaid": mermaid,
            "history": [{"node": "analyze", "status": "success"}]
        }

    async def planning_node(self, state: TaskState) -> Dict[str, Any]:
        """プラン策定ノード"""
        logger.info(f"[{state['task_id']}] Node: plan")
        
        plan = f"以下の急所を中心にリファクタリングを行います:\n"
        for dep in state['critical_dependencies']:
            plan += f"- {dep['symbol']} (重要度: {dep['score']:.2f})\n"
            
        return {
            "plan": plan,
            "history": [{"node": "plan", "status": "created"}]
        }

    async def approve_wait_node(self, state: TaskState) -> Dict[str, Any]:
        """
        承認待ち状態を表現するノード。
        """
        logger.info(f"[{state['task_id']}] Node: approve_wait | Status: WaitingForClarification")
        return {
            "status": "WaitingForClarification",
            "history": [{"node": "approve_wait", "status": "waiting"}]
        }

    def check_approval(self, state: TaskState) -> str:
        """承認分岐ロジック"""
        if state.get("is_approved"):
            return "approved"
        if state.get("user_feedback"):
            return "needs_revision"
        return "rejected"

    async def execution_node(self, state: TaskState) -> Dict[str, Any]:
        """エージェント実行ノード"""
        logger.info(f"[{state['task_id']}] Node: execute")
        # 実際のエージェント実行結果は、Orchestrator側で反映される
        return {
            "status": "InProgress",
            "history": [{"node": "execute", "status": "completed"}]
        }

    async def reporting_node(self, state: TaskState) -> Dict[str, Any]:
        """完了報告ノード"""
        logger.info(f"[{state['task_id']}] Node: report | Status: Completed")
        summary = f"タスク {state['task_id']} が完了しました。\n\n分析された主要コンポーネント: "
        summary += ", ".join([d['symbol'] for d in state['critical_dependencies'][:2]])
        
        return {
            "status": "Completed",
            "final_summary": summary,
            "history": [{"node": "report", "status": "done"}]
        }

    def compile(self, checkpointer=None):
        """グラフをコンパイルし、承認待ちノードの直前で割り込む設定"""
        return self.builder.compile(
            checkpointer=checkpointer, 
            interrupt_before=["approve_wait"]
        )
