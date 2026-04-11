# Blueprint: `src/mcp_server/knowledge_server.py`

## 1. 責務 (Responsibility)
`KnowledgeServer` は、Brownie の **「記憶（Memory）と構造掌握（Perception Plane）」** を担当します。
- **コード検索 (RAG)**: ChromaDB を用いたセマンティック検索により、過去の実装例や関連コードを抽出。
- **構造解析 (WDCA)**: `FlowTracer` を通じて、DuckDB に格納された AST 情報を Mermaid 形式のシーケンス図やリポジトリサマリーとして提供。
- **コンテキストの提供 (Resource)**: リポジトリ全体の技術スタック、統計、ホットスポット、エントリーポイントを一括で返す `brownie://repo/context` リソースを公開。

## 2. 復元要件 (Recreation Requirements for AI)

### 公開ツール (MCP Tools)

1. `semantic_search(query, limit)`
   - ChromaDB から `repo_name` でフィルタリングされた類似コード片を取得。
2. `get_code_flow(entry_symbol, depth)`
   - `FlowTracer.trace_flow` を呼び出し、Mermaid 形式のシーケンス図を返却。
3. `get_repo_summary()`
   - 技術スタック（`pyproject.toml` 等に基づく）、ファイル・シンボル統計、主要クラス/関数の一覧を JSON 形式で返却。

### 公開リソース (MCP Resource)
- `brownie://repo/context`: `get_repo_summary` と同等の内容をリソースとして提供。

## 3. 依存関係 (Dependencies)
- **外部依存**: `fastmcp.FastMCP`
- **内部依存**: 
  - `src.workspace.analyzer.flow.FlowTracer`
  - `src.memory.vector_db.MemoryManager`
