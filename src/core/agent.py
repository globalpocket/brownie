import os
import logging
import asyncio
import contextlib
from typing import Dict, Any, List, Optional
from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions.in_memory_session_service import InMemorySessionService
from google.genai import types
from src.workspace.sandbox import SandboxManager
from src.version import get_footer

logger = logging.getLogger(__name__)

class CoderAgent:
    def __init__(self, config: Dict[str, Any], sandbox: SandboxManager, state: 'StateManager', 
                 gh_client: Optional['GitHubClientWrapper'] = None, 
                 knowledge_mcp_client = None,
                 workspace_mcp_client = None):
        self.config = config
        self.sandbox = sandbox
        self.state = state
        self.gh_client = gh_client
        self.knowledge_mcp_client = knowledge_mcp_client
        self.workspace_mcp_client = workspace_mcp_client
        
        # モデルの設定 (LiteLLM 形式)
        # 例: ollama/llama3, openai/gpt-4
        raw_model = config['llm']['models'].get('coder', 'mlx-community/Qwen3.5-35B-A3B-4bit')
        # MLX server is OpenAI compatible, so LiteLLM needs the 'openai/' prefix
        if not raw_model.startswith("openai/"):
            self.model_name = f"openai/{raw_model}"
        else:
            self.model_name = raw_model
            
        self.base_url = config['llm']['endpoint'] # 例: http://localhost:11434/v1
        
        # プロンプトの読み込み
        self.instructions = self._load_instructions()
        
        # エージェントの初期化
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
        
        return "\n".join(instructions)

    def _init_agent(self) -> LlmAgent:
        """Google ADK LlmAgent を初期化し、ツールをバインドする"""
        
        # MCP ツールを ADK が扱える形式にラップする
        tools = self._get_mcp_tools()
        
        # LiteLLM/MLX 接続用の設定 (OpenAI 互換サーバー)
        if self.base_url:
            os.environ["OPENAI_API_BASE"] = self.base_url
            os.environ["LITELLM_API_BASE"] = self.base_url
            os.environ["OPENAI_API_KEY"] = "EMPTY"

        agent = LlmAgent(
            name="BROWNIE_Coder",
            model=self.model_name,
            instruction=self.instructions,
            tools=tools
        )
        
        # Runner の初期化 (セッション管理サービスが必要)
        self.runner = Runner(
            app_name="BROWNIE",
            agent=agent,
            session_service=InMemorySessionService(),
            auto_create_session=True
        )
        
        return agent

    def _get_mcp_tools(self) -> List[Any]:
        """MCP クライアントからツール定義を取得し、呼び出し可能な関数としてラップする"""
        adk_tools = []
        
        # GitHub 操作ツール (直接実装)
        async def post_comment(body: str):
            """GitHub の Issue または PR にコメントを投稿します。"""
            await self.gh_client.post_comment(self._current_repo_name, self._current_issue_number, body + get_footer())
            return "Successfully posted comment."

        adk_tools.append(post_comment)

        async def finish(summary: str):
            """タスクを正常に完了し、最終回答を投稿します。summary にはユーザーへの最終的な回答内容を含めてください。"""
            task_id = f"{self._current_repo_name}#{self._current_issue_number}"
            await self.state.update_task_context(task_id, {"final_summary": summary})
            return "Task completed and summary saved. This is the end of your current run."

        async def suspend(summary: str):
            """タスクを一時中断し、ユーザーに確認や情報の入力を求めます。summary には質問や確認事項を具体的に含めてください。"""
            task_id = f"{self._current_repo_name}#{self._current_issue_number}"
            await self.state.update_task_context(task_id, {"final_summary": summary})
            return "Task suspended and information request saved. You will be resumed when the user responds."

        adk_tools.append(finish)
        adk_tools.append(suspend)

        # Workspace/Knowledge MCP サーバーのツールを動的にバインド
        
        # 汎用 MCP ツール呼び出しアダプター
        def create_mcp_wrapper(client_getter, tool_name, description):
            # ADK が型ヒントを検知してパラメータを正しくマップできるよう、
            # 特によく使われるツールには明示的なシグネチャを持たせる
            if tool_name == "read_file":
                async def wrapper(path: str = None, **kwargs):
                    return await self._execute_mcp_tool(client_getter, tool_name, {"path": path, **kwargs})
            elif tool_name == "write_file":
                async def wrapper(path: str = None, content: str = None, **kwargs):
                    return await self._execute_mcp_tool(client_getter, tool_name, {"path": path, "content": content, **kwargs})
            elif tool_name == "run_command":
                async def wrapper(command: str = None, **kwargs):
                    return await self._execute_mcp_tool(client_getter, tool_name, {"command": command, **kwargs})
            elif tool_name == "list_files":
                async def wrapper(path: str = None, **kwargs):
                    return await self._execute_mcp_tool(client_getter, tool_name, {"path": path, **kwargs})
            else:
                async def wrapper(**kwargs):
                    return await self._execute_mcp_tool(client_getter, tool_name, kwargs)
            
            wrapper.__name__ = tool_name
            wrapper.__doc__ = description
            return wrapper

        # 主要な Workspace ツールの登録
        ws_tool_names = [
            ("list_files", "指定パスのファイル一覧を表示します。"),
            ("read_file", "指定したファイルの内容を読み取ります。"),
            ("write_file", "ファイルを新規作成または上書きします。"),
            ("run_command", "シェルコマンドを実行します。"),
            ("lint_code", "コード品質を診断します。"),
            ("format_code", "コードをフォーマットします。"),
        ]
        for name, desc in ws_tool_names:
            adk_tools.append(create_mcp_wrapper(lambda: self.workspace_mcp_client, name, desc))

        # 主要な Knowledge ツールの登録
        kn_tool_names = [
            ("get_code_flow", "処理フローを Mermaid 形式で取得します。"),
            ("semantic_search", "コードベースからセマンティック検索を実行します。"),
        ]
        for name, desc in kn_tool_names:
            adk_tools.append(create_mcp_wrapper(lambda: self.knowledge_mcp_client, name, desc))

        return adk_tools

    async def _execute_mcp_tool(self, client_getter, tool_name: str, kwargs: dict):
        """MCP ツールの実行コアロジック (バリデーション、パス正規化、エラーハンドリング)"""
        client = client_getter() if callable(client_getter) else client_getter
        if not client:
            logger.error(f"MCP client for tool {tool_name} is not initialized.")
            return f"Error: Tool {tool_name} is currently unavailable because the MCP server is not connected."
        
        logger.info(f"Calling MCP tool: {tool_name} with {kwargs}")
        
        # パラメータ不足のチェック
        if tool_name == "read_file" and not kwargs.get('path'):
            return f"Error executing {tool_name}: Missing required argument 'path'. Please provide the file path as a string in the 'path' argument."

        # パスの正規化 (path 引数がある場合)
        if 'path' in kwargs and isinstance(kwargs['path'], str) and kwargs['path'] and not kwargs['path'].startswith('/'):
            workspace_root = getattr(self.sandbox, 'workspace_root', None)
            if workspace_root:
                original_path = kwargs['path']
                kwargs['path'] = os.path.normpath(os.path.join(workspace_root, original_path))
                logger.debug(f"Normalized path for {tool_name}: {original_path} -> {kwargs['path']}")

        try:
            result = await client.call_tool(tool_name, kwargs)
            if hasattr(result, 'content'):
                return result.content[0].text
            return str(result)
        except Exception as e:
            logger.warning(f"Error calling MCP tool {tool_name}: {e}")
            error_msg = str(e)
            if "validation error" in error_msg.lower():
                return f"Error executing {tool_name}: Argument validation failed. Details: {error_msg}. Please ensure your JSON arguments match the tool's schema."
            return f"Error executing {tool_name}: {error_msg}. Please check your arguments and try again."

    async def run(self, task_id: str, repo_name: str, issue_number: int, repo_path: str = None, **kwargs) -> bool:
        """エージェントの実行ループ (ADK Runner を使用)"""
        # 以前のシグネチャとの互換性維持
        task_description = kwargs.get('task_description', f"Issue #{issue_number} in {repo_name} を解決してください。")
        self._current_repo_name = repo_name
        self._current_issue_number = issue_number
        
        logger.info(f"[{task_id}] ADK Agent starting for {repo_name}#{issue_number}")
        
        # 自律ループのスコープ内限定でカレントディレクトリを移動
        if repo_path and os.path.exists(repo_path):
            cwd_context = contextlib.chdir(repo_path)
        else:
            cwd_context = contextlib.nullcontext()

        with cwd_context:
            if repo_path:
                logger.info(f"[{task_id}] Process context anchored to: {os.getcwd()}")
            
            new_message = f"GitHub Issue #{issue_number} in {repo_name} を解決または分析してください。\n指示内容: {task_description}"
            
            # リトライ設定
            max_llm_retries = self.config['agent'].get('max_llm_retries', 3)
            
            for attempt in range(max_llm_retries):
                try:
                    result = None
                    async for event in self.runner.run_async(
                        user_id="brownie_operator",
                        session_id=task_id,
                        new_message=types.Content(parts=[types.Part(text=new_message)], role="user")
                    ):
                        # トレースログ出力
                        model_response = getattr(event, 'model_response', None)
                        if model_response and hasattr(model_response, 'candidates') and model_response.candidates:
                            try:
                                content = model_response.candidates[0].content
                                text = "".join([p.text for p in content.parts if hasattr(p, 'text') and p.text])
                                if text: logger.info(f"[{task_id}] AI Response: \n{text}")
                            except Exception: pass
                        
                        tool_call = getattr(event, 'tool_call', None)
                        if tool_call:
                            logger.info(f"[{task_id}] Tool Call: {getattr(tool_call, 'name', 'unknown')}")

                        tool_response = getattr(event, 'tool_response', None)
                        if tool_response:
                            logger.info(f"[{task_id}] Tool Response: {str(tool_response)[:200]}...")

                        result = event
                    
                    logger.info(f"[{task_id}] ADK Agent finished successfully.")
                    return True

                except Exception as e:
                    error_msg = str(e).lower()
                    # 接続エラーやサーバーエラーの場合はリトライを検討
                    is_transient = any(kw in error_msg for kw in ["connection error", "internal server error", "refused", "timeout"])
                    
                    if is_transient and attempt < max_llm_retries - 1:
                        wait_sec = (attempt + 1) * 10
                        logger.warning(f"[{task_id}] Transient LLM error (Attempt {attempt+1}/{max_llm_retries}): {e}. Retrying in {wait_sec}s...")
                        await asyncio.sleep(wait_sec)
                        continue
                    else:
                        logger.error(f"[{task_id}] ADK Agent fatal error: {e}", exc_info=True)
                        break
            
            return False
