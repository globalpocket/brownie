import os
import logging
import asyncio
import contextlib
import httpx
import json
from typing import Dict, Any, List, Optional, Union
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.adk.models.lite_llm import LiteLlm
from google.genai import types
import litellm

from src.workspace.sandbox import SandboxManager
from src.workspace.context import WorkspaceContext
from src.version import get_footer

logger = logging.getLogger(__name__)

class CoderAgent:
    def __init__(self, 
                 config: Dict[str, Any], 
                 sandbox: SandboxManager, 
                 state: 'StateManager', 
                 gh_client: Optional['GitHubClientWrapper'] = None, 
                 knowledge_mcp_client = None,
                 workspace_mcp_client = None,
                 workspace_context: Optional[WorkspaceContext] = None):
        self.config = config
        self.sandbox = sandbox
        self.state = state
        self.gh_client = gh_client
        self.knowledge_mcp_client = knowledge_mcp_client
        self.workspace_mcp_client = workspace_mcp_client
        self.workspace_context = workspace_context
        self.language = os.getenv("BROWNIE_LANGUAGE", "Japanese")
        self._status = "running"
        
        # モデルの設定 (Planner)
        raw_model = config['llm']['models'].get('planner', 'mlx-community/Meta-Llama-3.1-8B-Instruct-4bit')
        if not raw_model.startswith("openai/"):
            self.model_name = f"openai/{raw_model}"
        else:
            self.model_name = raw_model
            
        self.base_url = config['llm']['planner_endpoint']
        
        # Executor の設定
        self.executor_endpoint = config['llm']['executor_endpoint']
        self.executor_model = config['llm']['models'].get('executor', 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit')
        
        # プロンプトの読み込み
        self.instructions = self._load_instructions()
        
        # エージェントの初期化
        self.max_context_tokens = config['llm'].get('max_context_tokens', 12000)
        self.agent = self._init_agent()

    def _load_instructions(self) -> str:
        """外部プロンプトファイルを読み込み、結合する"""
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        system_prompt_path = os.path.join(project_root, ".agent", "system_prompt.md")
        common_rules_path = os.path.join(project_root, ".agent", "rules", "common.md")
        
        instructions = []
        if os.path.exists(system_prompt_path):
            with open(system_prompt_path, "r", encoding="utf-8") as f:
                instructions.append(f.read())
        
        instructions.append("\n## Common Rules\n")
        if os.path.exists(common_rules_path):
            with open(common_rules_path, "r", encoding="utf-8") as f:
                instructions.append(f.read())
        
        instructions.append(f"\n## Language Setting\n思考 (thought) およびユーザーへの報告は、原則として {self.language} で行ってください。\n")
        
        return "\n".join(instructions)

    def _init_agent(self) -> LlmAgent:
        """Google ADK LlmAgent を初期化し、ツールをバインドする"""
        # 明示的に定義されたツールメソッドを取得
        tools = self._get_defined_tools()
        
        # LiteLLM/MLX 接続用の設定
        if self.base_url:
            os.environ["OPENAI_API_BASE"] = self.base_url
            os.environ["LITELLM_API_BASE"] = self.base_url
            os.environ["OPENAI_API_KEY"] = "EMPTY"

        # 構造化生成と KV キャッシュ制限の設定
        # Gemma 4 向けに native tool calling / response_format を最適化
        model_obj = LiteLlm(
            model=self.model_name,
            extra_body={
                "response_format": {"type": "json_object"} if "Gemma" in self.model_name else None,
                "max_tokens": 4096, # 生成トークン上限
            }
        )

        agent = LlmAgent(
            name="BROWNIE_Coder",
            model=model_obj,
            instruction=self.instructions,
            tools=tools
        )
        
        # コンテキスト制限(12k)を適用したセッションサービス
        session_service = TruncatingSessionService(max_tokens=self.max_context_tokens, model=self.model_name)
        
        self.runner = Runner(
            app_name="BROWNIE",
            agent=agent,
            session_service=session_service,
            auto_create_session=True
        )
        
        return agent

class TruncatingSessionService(InMemorySessionService):
    def __init__(self, max_tokens: int = 12000, model: str = ""):
        super().__init__()
        self.max_tokens = max_tokens
        self.model = model

    async def get_session(self, session_id: str) -> Any:
        session = await super().get_session(session_id)
        if session and session.events:
            session.events = self._truncate_events(session.events)
        return session

    def _truncate_events(self, events: List[Any]) -> List[Any]:
        if not events:
            return events
        
        # 簡易的なトークン計算
        try:
            # Event リストを LiteLLM 用のメッセージリストに変換してカウント
            # (ADK 内部の _session_util.py 等のロジックを簡略化)
            total_tokens = sum(len(str(e)) for e in events) // 4 # 概算
        except Exception:
            total_tokens = sum(len(str(e)) for e in events) // 4

        if total_tokens <= self.max_tokens:
            return events

        logger.info(f"Context overflow detected ({total_tokens} > {self.max_tokens}). Truncating events...")
        
        # 古い履歴から順に削除。ただし直近の User メッセージ等は維持するため、後ろから残す。
        # システムプロンプト等は Agent オブジェクト側で保持されるため、Session のイベントを削る。
        while len(events) > 2 and total_tokens > self.max_tokens:
            events.pop(0)
            total_tokens = sum(len(str(e)) for e in events) // 4
        
        return events

    def _get_defined_tools(self) -> List[Any]:
        """ADK に登録する明示的ツール一覧を返す"""
        return [
            self.post_comment,
            self.finish,
            self.suspend,
            self.get_agent_context,
            self.read_file,
            self.write_file,
            self.list_files,
            self.run_command,
            self.get_code_flow,
            self.semantic_search,
            self.ask_coding_expert
        ]

    # --- ツール定義 (明示的な型ヒントとDocstring) ---

    async def post_comment(self, body: str) -> str:
        """GitHub の Issue または PR にコメントを投稿します。
        
        Args:
            body: コメントの内容。Markdown形式が使用可能です。
        """
        await self.gh_client.post_comment(self._current_repo_name, self._current_issue_number, body + get_footer())
        return "Successfully posted comment."

    async def finish(self, summary: str) -> str:
        """タスクを正常に完了し、最終回答を投稿して終了します。
        
        Args:
            summary: ユーザーへの最終的な報告内容。どのような修正を行ったか、何を確認したかを詳しく含めてください。
        """
        self._status = "finished"
        task_id = f"{self._current_repo_name}#{self._current_issue_number}"
        await self.state.update_task_context(task_id, {"final_summary": summary})
        return "Task completed and summary saved."

    async def suspend(self, summary: str) -> str:
        """タスクを一時中断し、ユーザーに確認や情報の入力を求めます。
        
        Args:
            summary: ユーザーへの質問や確認事項。具体的に何を答えてほしいかを記述してください。
        """
        self._status = "suspended"
        task_id = f"{self._current_repo_name}#{self._current_issue_number}"
        await self.state.update_task_context(task_id, {"final_summary": summary})
        return "Task suspended. Waiting for user response."

    async def get_agent_context(self) -> str:
        """エージェントの現在のステータス、カレントディレクトリ、接続されているMCPサーバーの情報を取得します。
        デバッグや「自分が今どこにいるか」を確認するために使用します。
        """
        workspace_root = self.workspace_context.root_path if self.workspace_context else "Not Set"
        cwd = os.getcwd()
        servers = {
            "workspace_server": "Connected" if self.workspace_mcp_client else "Disconnected",
            "knowledge_server": "Connected" if self.knowledge_mcp_client else "Disconnected"
        }
        return f"Current Context:\n- Workspace Root: {workspace_root}\n- Current Directory: {cwd}\n- Servers: {servers}"

    async def read_file(self, path: str) -> str:
        """指定したファイルの内容を読み取ります。
        
        Args:
            path: 読み取るファイルのパス（相対パス推奨）。
        """
        return await self._call_mcp_tool(self.workspace_mcp_client, "read_file", {"path": path})

    async def write_file(self, path: str, content: str) -> str:
        """ファイルを新規作成または上書きします。
        
        Args:
            path: 書き込み先ファイルのパス。
            content: ファイルの全内容。
        """
        return await self._call_mcp_tool(self.workspace_mcp_client, "write_file", {"path": path, "content": content})

    async def list_files(self, path: str = ".", max_depth: int = 1) -> str:
        """指定パスのファイル一覧を表示します。
        
        Args:
            path: 対象ディレクトリのパス。
            max_depth: 探索の最大深度（デフォルト1）。
        """
        return await self._call_mcp_tool(self.workspace_mcp_client, "list_files", {"path": path, "max_depth": max_depth})

    async def run_command(self, command: str) -> str:
        """Docker コンテナ内でシェルコマンドを実行します。
        
        Args:
            command: 実行するシェルコマンド。
        """
        return await self._call_mcp_tool(self.workspace_mcp_client, "run_command", {"command": command})

    async def get_code_flow(self, function_name: str) -> str:
        """指定された関数の処理フローを解析し、Mermaid 形式で取得します。
        
        Args:
            function_name: 解析対象の関数名。
        """
        return await self._call_mcp_tool(self.knowledge_mcp_client, "get_code_flow", {"function_name": function_name})

    async def semantic_search(self, query: str) -> str:
        """コードベース全体に対して自然言語による意味検索（ベクトル検索）を実行します。
        
        Args:
            query: 検索クエリ。
        """
        return await self._call_mcp_tool(self.knowledge_mcp_client, "semantic_search", {"query": query})

    async def ask_coding_expert(self, code_context: str, instruction: str) -> str:
        """コーディングの専門家（Executor）に高度なコード分析や実装案の作成を依頼します。
        複雑なロジックの実装、バグの原因究明、リファクタリング案の提示などに使用してください。
        
        Args:
            code_context: 関連するソースコード、エラーログ、これまでの調査結果などのコンテキスト。
            instruction: 専門家への具体的な指示。
        """
        logger.info(f"Delegating task to Coding Expert (Executor): {instruction[:50]}...")
        
        prompt = f"Context:\n{code_context}\n\nInstruction: {instruction}\n\nPlease provide your analysis and implementation proposal in a clear markdown format."
        
        payload = {
            "model": self.executor_model,
            "messages": [
                {"role": "system", "content": "You are an expert software engineer specializing in high-quality code implementation and debugging. Your task is to provide clear, correct, and professional code analysis and proposals based on the given context and instructions. Return only the text response without calling any tools."},
                {"role": "user", "content": prompt}
            ],
            "temperature": 0.1
        }
        
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                response = await client.post(
                    f"{self.executor_endpoint}/chat/completions",
                    json=payload,
                    headers={"Content-Type": "application/json"}
                )
                response.raise_for_status()
                data = response.json()
                return data['choices'][0]['message']['content']
        except Exception as e:
            logger.error(f"Error calling Coding Expert: {e}")
            return f"Error: Failed to contact coding expert. {e}"

    # --- ヘルパーメソッド ---

    async def _call_mcp_tool(self, client: Any, tool_name: str, kwargs: dict) -> str:
        """MCP サーバーとの通信を正規化して実行する内部メソッド"""
        if not client:
            return f"Error: {tool_name} is unavailable. MCP server is not connected."
        
        # パスの正規化 (AIのリクエストが相対パスの場合、WorkspaceContextで安全に解決)
        if self.workspace_context and 'path' in kwargs and kwargs['path']:
            try:
                # 解決された絶対パスをサーバーに渡す
                abs_path = self.workspace_context.resolve_path(kwargs['path'])
                kwargs['path'] = str(abs_path)
            except PermissionError as e:
                return f"Permission Denied: {e}"

        try:
            result = await client.call_tool(tool_name, kwargs)
            if hasattr(result, 'content') and result.content:
                return result.content[0].text
            return str(result)
        except Exception as e:
            logger.warning(f"MCP Tool Error ({tool_name}): {e}")
            return f"Tool Error: {e}"

    async def run(self, task_id: str, repo_name: str, issue_number: int, repo_path: str = None, **kwargs) -> bool:
        """エージェントの実行ループ (ADK Runner を使用)"""
        task_description = kwargs.get('task_description', f"Issue #{issue_number} in {repo_name} を解決してください。")
        self._current_repo_name = repo_name
        self._current_issue_number = issue_number
        
        logger.info(f"[{task_id}] ADK Agent starting for {repo_name}#{issue_number}")
        
        # 以前のカレントディレクトリ移動を WorkspaceContext 方式に統合（内部で resolve するため chdir 不要にしたいが、一応維持）
        if repo_path and os.path.exists(repo_path):
            cwd_context = contextlib.chdir(repo_path)
        else:
            cwd_context = contextlib.nullcontext()

        with cwd_context:
            self._status = "running"
            new_message = f"GitHub Issue #{issue_number} in {repo_name} を解決または分析してください。\n指示内容: {task_description}"
            max_llm_retries = self.config['agent'].get('max_llm_retries', 3)
            
            for attempt in range(max_llm_retries):
                try:
                    async for event in self.runner.run_async(
                        user_id="brownie_operator",
                        session_id=task_id,
                        new_message=types.Content(parts=[types.Part(text=new_message)], role="user") if new_message else None
                    ):
                        # 進捗ログの抽出と出力
                        if event.content and event.content.parts:
                            for part in event.content.parts:
                                if part.text:
                                    logger.info(f"[{task_id}] Agent Thought: {part.text}")
                                if part.function_call:
                                    logger.info(f"[{task_id}] Tool Call: {part.function_call.name}({part.function_call.args})")

                        if self._status != "running":
                            break

                    if self._status == "finished":
                        logger.info(f"[{task_id}] ADK Agent finished successfully.")
                        return True
                    elif self._status == "suspended":
                        logger.info(f"[{task_id}] ADK Agent suspended.")
                        return "SUSPENDED"
                    else:
                        logger.warning(f"[{task_id}] ADK Agent exited prematurely (Attempt {attempt + 1}/{max_llm_retries}).")
                        new_message = "作業が完了していません。必ずツールを呼び出して作業を継続するか、または finish/suspend ツールを呼び出して終了してください。テキストのみの応答は許可されていません。"
                        continue
                except Exception as e:
                    logger.error(f"[{task_id}] LLM Error: {e}")
                    if attempt < max_llm_retries - 1:
                        await asyncio.sleep(5)
                        continue
                    break
            return False
