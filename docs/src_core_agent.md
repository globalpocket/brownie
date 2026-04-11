# Blueprint: `src/core/agent.py`

## 1. 責務 (Responsibility)
`CoderAgent` およびその周辺クラスは、Brownie の推論の核心である **Planner-Executor パターン** を Pydantic AI を用いて実装します。
- **意思決定 (Planner)**: 状況に応じた環境操作ツールの選択、および実装指示書（Strict Blueprint）の作成。
- **実装実行 (Executor)**: Planner の指示に基づいた、副作用のない純粋なコード生成。
- **多重防御**: 強力な型定義（Pydantic）による JSON 通信の強制と、ツール呼出し権限の分離。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `AgentDeps`
エージェントの実行に必要なコンテキスト（依存関係）を保持します。
- **保持属性**: `config`, `sandbox`, `gh_client`, `mcp_manager`, `workspace_context`, `current_task_id`, `status`。

### クラス: `Blueprint` (Pydantic Model)
Planner から Executor へ渡される唯一の通信フォーマット。
- `target_files` (List[BlueprintFile]): 変更対象ファイル。
- `logic_constraints` (List[str]): 実装上の制約。
- `prohibited_actions` (List[str]): 禁止事項。

### クラス: `CoderAgent` (Facade)
外部（Orchestrator）からエージェント機能を呼び出すためのインターフェース。

**初期化引数:**
- `config`, `sandbox`, `gh_client`, `mcp_manager`, `workspace_context`。

**公開メソッド:**

1. `run(task_id, repo_name, issue_number, **kwargs) -> Union[bool, str]` (async)
   - **振る舞い**: 
     - 実行環境（`AgentDeps`）を初期化。
     - `mcp_manager` から全 MCP サーバーのツールを動的に取得し、`LangChainToolset` として Planner にバインド。
     - `planner_agent.run` を実行。
     - **HITL 検知**: ステータスが `waiting_for_clarification` の場合は `"WAITING"` を返す。
     - **完了検知**: ステータスが `finished` の場合は `True` を返す。

### 提供ツール (Planner 向け)

1. `post_comment(body)`
   - GitHub に推論結果や進捗を投稿。
2. `ask_user(question)`
   - 承認や質問が必要な際、ステータスを `waiting_for_clarification` に変更し、ワークフローを一時停止（Interrupt）させるトリガー。
3. `delegate_to_executor(blueprint)`
   - Planner が作成した `Blueprint` を Executor に渡し、コード実装案を取得する。

## 3. 依存関係 (Dependencies)
- **外部依存**: 
  - `pydantic`, `pydantic_ai`
  - `pydantic_ai.ext.langchain.LangChainToolset`
  - `src.workspace.sandbox.SandboxManager`
  - `src.workspace.context.WorkspaceContext`
  - `src.version.get_footer`
