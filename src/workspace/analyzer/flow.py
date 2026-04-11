import logging
import duckdb
import networkx as nx
from typing import List, Dict, Any, Set, Tuple

logger = logging.getLogger(__name__)

class FlowTracer:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = duckdb.connect(self.db_path)
        self.graph = nx.DiGraph()

    def build_graph(self):
        """DuckDB の `calls` テーブルと `symbols` テーブルから NetworkX グラフを構築する"""
        logger.info("Building global call graph using NetworkX")
        self.graph.clear()
        
        # すべての呼び出し関係を取得
        calls = self.conn.execute("SELECT caller_name, callee_name, file_path, line FROM calls").fetchall()
        for caller, callee, file_path, line in calls:
            self.graph.add_edge(caller, callee, file=file_path, line=line)
            
        # シンボルの属性（Type等）を付与
        symbols = self.conn.execute("SELECT name, type FROM symbols").fetchall()
        for name, type_str in symbols:
            if name in self.graph:
                self.graph.nodes[name]['type'] = type_str

    def get_critical_dependencies(self, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        Out-Degree (影響範囲の広さ) と Betweenness Centrality (媒介中心性) を用いて
        プロジェクトの急所（Top-K）を特定する。
        """
        if not self.graph:
            self.build_graph()
            
        if not self.graph.nodes:
            return []

        # 1. Out-Degree (影響範囲の広さ: 分岐点の大きさ)
        out_degrees = dict(self.graph.out_degree())
        
        # 2. Betweenness Centrality (媒介中心性: ハブ機能)
        # 計算コストが高いため、ノード数が多い場合は近似計算を行う
        if len(self.graph) > 500:
            betweenness = nx.betweenness_centrality(self.graph, k=min(len(self.graph), 100))
        else:
            betweenness = nx.betweenness_centrality(self.graph)
        
        # スコア合算 (Out-Degree 優先)
        combined_scores = []
        for node in self.graph.nodes():
            # 重み付け: Out-Degree を主、Betweenness を従とする
            score = float(out_degrees.get(node, 0)) + (float(betweenness.get(node, 0)) * 50)
            combined_scores.append({
                "symbol": node,
                "score": score,
                "out_degree": out_degrees.get(node, 0),
                "betweenness": betweenness.get(node, 0),
                "type": self.graph.nodes[node].get('type', 'unknown')
            })
            
        # スコア順にソートして Top-K を取得
        combined_scores.sort(key=lambda x: x["score"], reverse=True)
        return combined_scores[:top_k]

    def trace_flow(self, entry_symbol: str, max_depth: int = 5) -> str:
        """ 指定されたシンボルから始まる処理フローを NetworkX を用いて追跡し、Mermaid 形式で返す """
        logger.info(f"Tracing flow from: {entry_symbol}")
        
        if not self.graph:
            self.build_graph()

        if entry_symbol not in self.graph:
            # 旧実装の互換性維持: クラス名等で検索
            alternative_calls = self.conn.execute("""
                SELECT caller_name FROM calls 
                WHERE file_path IN (SELECT file_path FROM symbols WHERE name = ?)
                LIMIT 1
            """, (entry_symbol,)).fetchone()
            if alternative_calls:
                entry_symbol = alternative_calls[0]
            else:
                return f"No flow data found for symbol: {entry_symbol}"

        # 幅優先探索でフローを抽出
        flow_steps = []
        visited = {entry_symbol}
        queue = [(entry_symbol, 0)]
        
        while queue:
            current_node, depth = queue.pop(0)
            if depth >= max_depth:
                continue
                
            for neighbor in self.graph.successors(current_node):
                edge_data = self.graph.get_edge_data(current_node, neighbor)
                step = {
                    "caller": current_node,
                    "callee": neighbor,
                    "file": edge_data["file"],
                    "line": edge_data["line"],
                    "depth": depth,
                    "type": self.graph.nodes[neighbor].get('type', 'unknown')
                }
                flow_steps.append(step)
                
                if neighbor not in visited:
                    visited.add(neighbor)
                    queue.append((neighbor, depth + 1))
        
        if not flow_steps:
            return f"No downstream calls found starting from {entry_symbol}."
            
        return self._format_mermaid(flow_steps)

    def _format_mermaid(self, flow_steps: List[Dict]) -> str:
        """ Mermaid sequenceDiagram 形式に整形 """
        lines = ["sequenceDiagram", "    autonumber"]
        
        for step in flow_steps:
            caller = step["caller"].replace(" ", "_")
            callee = step["callee"].replace(" ", "_")
            line = f"    {caller}->>+ {callee}: call ({step['file']}:{step['line']})"
            lines.append(line)
            lines.append(f"    {callee}-->>- {caller}: return")
            
        return "\n".join(lines)

    def close(self):
        self.conn.close()

if __name__ == "__main__":
    pass
