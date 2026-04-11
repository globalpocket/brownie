import logging
from typing import TypedDict, List, Dict, Any, Optional, Annotated
from langgraph.graph import StateGraph, END
from src.workspace.analyzer.flow import FlowTracer
from src.workspace.analyzer.core import CodeAnalyzer
import operator

logger = logging.getLogger(__name__)

class TaskState(TypedDict):
    """LangGraph のワークフロー状態定義"""
    task_id: str
    repo_name: str
    issue_number: int
    repo_path: str
    instruction: str
    
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
    
    # 履歴
    history: Annotated[List[Dict[str, Any]], operator.add]

class TaskWorkflow:
    def __init__(self, config: Dict[str, Any], project_root: str):
        self.config = config
        self.project_root = project_root
        self.builder = StateGraph(TaskState)
        self._setup_graph()

    def _setup_graph(self):
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
        
        # 条件付きエッジ: 承認されたら execute へ、却下されたら（または修正指示があれば）plan へ戻る
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
        """NetworkX を用いたコード解析と急所特定"""
        logger.info(f"[{state['task_id']}] Node: analyze")
        
        # CodeAnalyzer で最新化
        analyzer = CodeAnalyzer(state['repo_path'])
        await analyzer.scan_project()
        analyzer.close()
        
        # FlowTracer (NetworkX) で解析
        db_path = f"{state['repo_path']}/.brwn/index.db"
        tracer = FlowTracer(db_path)
        tracer.build_graph()
        
        # Out-Degree/Betweenness に基づく Top-K 抽出
        critical = tracer.get_critical_dependencies(top_k=5)
        # 代表的なシンボル（entry）からの Mermaid
        mermaid = ""
        if critical:
            mermaid = tracer.trace_flow(critical[0]['symbol'])
        
        tracer.close()
        
        return {
            "critical_dependencies": critical,
            "context_mermaid": mermaid,
            "history": [{"node": "analyze", "status": "success"}]
        }

    async def planning_node(self, state: TaskState) -> Dict[str, Any]:
        """実行計画の策定"""
        logger.info(f"[{state['task_id']}] Node: plan")
        
        # ここでは本来 LLM を呼び出してプランを作成するが、
        # 今回はデモ・土台構築のためスケルトンを返すプロンプトを想定
        plan = f"以下の急所を中心にリファクタリングを行います:\n"
        for dep in state['critical_dependencies']:
            plan += f"- {dep['symbol']} (重要度: {dep['score']:.2f})\n"
            
        return {
            "plan": plan,
            "history": [{"node": "plan", "status": "created"}]
        }

    async def approve_wait_node(self, state: TaskState) -> Dict[str, Any]:
        """
        ユーザー承認待ち状態を表現するノード。
        Orchestrator 側でこのノードの直前で interrupt する。
        """
        logger.info(f"[{state['task_id']}] Node: approve_wait")
        # 実際にはここでは何もしない。Orchestrator が状態を更新して再開する。
        return {"history": [{"node": "approve_wait", "status": "waiting"}]}

    def check_approval(self, state: TaskState) -> str:
        """承認状態に基づく分岐"""
        if state.get("is_approved"):
            return "approved"
        if state.get("user_feedback"):
            return "needs_revision"
        return "rejected"

    async def execution_node(self, state: TaskState) -> Dict[str, Any]:
        """エージェントによる実際のコード変更実行"""
        logger.info(f"[{state['task_id']}] Node: execute")
        
        # 実際のエージェント実行は Orchestrator が保持する Agent 経由で行うため
        # ここでは成功フラグのみを管理するスケルトンとする。
        # (Orchestrator との疎結合を保つため、実際には callback 等で注入する)
        return {
            "implementation_result": True,
            "history": [{"node": "execute", "status": "completed"}]
        }

    async def reporting_node(self, state: TaskState) -> Dict[str, Any]:
        """結果のレポーティング"""
        logger.info(f"[{state['task_id']}] Node: report")
        summary = f"タスク {state['task_id']} が完了しました。\n\n分析された主要コンポーネント: "
        summary += ", ".join([d['symbol'] for d in state['critical_dependencies'][:2]])
        
        return {
            "final_summary": summary,
            "history": [{"node": "report", "status": "done"}]
        }

    def compile(self, checkpointer=None):
        """グラフをコンパイルして実行可能にする"""
        # approve_wait ノードの実行前に割り込む設定
        return self.builder.compile(checkpointer=checkpointer, interrupt_before=["approve_wait"])
