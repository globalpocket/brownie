import logging
import duckdb
from typing import List, Dict, Any, Set

logger = logging.getLogger(__name__)

class FlowTracer:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = duckdb.connect(self.db_path)

    def trace_flow(self, entry_symbol: str, max_depth: int = 5) -> str:
        """ 指定されたシンボルから始まる処理フローを追跡し、Mermaid 形式で返す """
        logger.info(f"Tracing flow from: {entry_symbol}")
        
        flow_steps = []
        visited = set()
        
        self._trace_recursive(entry_symbol, 0, max_depth, flow_steps, visited)
        
        if not flow_steps:
            return "No flow data found for the given entry symbol."
            
        return self._format_mermaid(flow_steps)

    def _trace_recursive(self, symbol_name: str, depth: int, max_depth: int, flow_steps: List[Dict], visited: Set[str]):
        if depth >= max_depth or symbol_name in visited:
            return
        
        visited.add(symbol_name)
        
        # このシンボルが呼び出しているものを取得
        calls = self.conn.execute("""
            SELECT callee_name, file_path, line 
            FROM calls 
            WHERE caller_name = ?
        """, (symbol_name,)).fetchall()

        if not calls and depth == 0:
            # global スコープやクラス内のメソッド呼び出しを探索
            calls = self.conn.execute("""
                SELECT callee_name, file_path, line 
                FROM calls 
                WHERE file_path IN (SELECT file_path FROM symbols WHERE name = ?)
            """, (symbol_name,)).fetchall()

        for callee, file_path, line in calls:
            # 呼び出し先の詳細（クラス名など）があれば取得
            callee_info = self.conn.execute("""
                SELECT type FROM symbols WHERE name = ? LIMIT 1
            """, (callee,)).fetchone()
            
            step = {
                "caller": symbol_name,
                "callee": callee,
                "file": file_path,
                "line": line,
                "depth": depth,
                "type": callee_info[0] if callee_info else "unknown"
            }
            flow_steps.append(step)
            
            # 再帰的に追跡
            self._trace_recursive(callee, depth + 1, max_depth, flow_steps, visited)

    def _format_mermaid(self, flow_steps: List[Dict]) -> str:
        """ Mermaid sequenceDiagram 形式に整形 """
        lines = ["sequenceDiagram", "    autonumber"]
        
        for step in flow_steps:
            caller = step["caller"].replace(" ", "_")
            callee = step["callee"].replace(" ", "_")
            # 重複を避けるための簡易的なフィルタリング
            line = f"    {caller}->>+ {callee}: call ({step['file']}:{step['line']})"
            lines.append(line)
            # 戻りの表現（簡易版）
            lines.append(f"    {callee}-->>- {caller}: return")
            
        return "\n".join(lines)

    def close(self):
        self.conn.close()

if __name__ == "__main__":
    # 簡易テスト（実際のDBパスが必要）
    # tracer = FlowTracer(".brwn/index.db")
    # print(tracer.trace_flow("main"))
    pass
