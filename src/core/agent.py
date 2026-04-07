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

        # Workspace/Knowledge MCP サーバーのツールを動的にバインド
        # 本来は MCP インスペクションで取得すべきだが、初期化タイミングの都合上、
        # ここでは指示通りの「薄いラッパー」を個別に用意、または汎用ラッパーを通す。
        
        # 汎用 MCP ツール呼び出しアダプター (指示に基づきシンプルに実装)
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

        # 主要な Workspace ツールの登録 (クライアントの状態に関わらずスキーマを定義)
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
        
        # パラメータ不足のチェック (モデルへのフィードバック用)
        if tool_name == "read_file" and not kwargs.get('path'):
            return f"Error executing {tool_name}: Missing required argument 'path'. Please provide the file path as a string in the 'path' argument."

        # パスの正規化 (path 引数がある場合)
        if 'path' in kwargs and isinstance(kwargs['path'], str) and kwargs['path'] and not kwargs['path'].startswith('/'):
            workspace_root = getattr(self.sandbox, 'workspace_root', None)
            if workspace_root:
                import os
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
            # エラーをメッセージとして返して、AI に自己修正を促す
            error_msg = str(e)
            if "validation error" in error_msg.lower():
                return f"Error executing {tool_name}: Argument validation failed. Details: {error_msg}. Please ensure your JSON arguments match the tool's schema."
            return f"Error executing {tool_name}: {error_msg}. Please check your arguments and try again."

    async def run(self, task_id: str, repo_name: str, issue_number: int, repo_path: str = None, **kwargs) -> bool:
        """エージェントの実行ループ (ADK Runner を使用)"""
        # 以前のシグネチャとの互換性維持
        task_description = kwargs.get('task_description', f"Issue #{issue_number} in {repo_name} を解決してください。")
        
        logger.info(f"[{task_id}] ADK Agent starting for {repo_name}#{issue_number}")
        
        # ユーザー指示: 以降の操作はローカルリポジトリパスを起点にする
        # 自律ループのスコープ内限定でカレントディレクトリを移動
        if repo_path and os.path.exists(repo_path):
            cwd_context = contextlib.chdir(repo_path)
        else:
            cwd_context = contextlib.nullcontext()

        with cwd_context:
            if repo_path:
                logger.info(f"[{task_id}] Process context anchored to: {os.getcwd()}")
            
            new_message = f"GitHub Issue #{issue_number} in {repo_name} を解決または分析してください。\n指示内容: {task_description}"
            
            result = None
            try:
                async for event in self.runner.run_async(
                    user_id="brownie_operator",
                    session_id=task_id,
                    new_message=types.Content(parts=[types.Part(text=new_message)], role="user")
                ):
                    # トレース: AI の思考プロセスやツール呼び出しを可視化
                    event_type = type(event).__name__
                    # 生のイベントデータを詳細にデバッグ出力
                    logger.debug(f"[{task_id}] Raw Event Object: {event}")
                    
                    # 安全なプロパティアクセス
                    model_response = getattr(event, 'model_response', None)
                    if model_response and hasattr(model_response, 'candidates') and model_response.candidates:
                        try:
                            content = model_response.candidates[0].content
                            parts = getattr(content, 'parts', [])
                            text = "".join([p.text for p in parts if hasattr(p, 'text') and p.text])
                            if text:
                                logger.info(f"[{task_id}] AI Response: \n{text}")
                            
                            # 関数呼び出しの生データを candidates から直接確認
                            for part in parts:
                                if hasattr(part, 'function_call'):
                                    logger.info(f"[{task_id}] Raw Function Call (Parts): {part.function_call.name}({part.function_call.args})")
                        except (IndexError, AttributeError) as e:
                            logger.debug(f"Could not extract text or function_call from model_response: {e}")
                    
                    tool_call = getattr(event, 'tool_call', None)
                    if tool_call:
                        # 生の引数データを確認するためのデバッグログ
                        args = getattr(tool_call, 'args', {})
                        logger.info(f"[{task_id}] Tool Call (from Event): {getattr(tool_call, 'name', 'unknown')}")
                        logger.debug(f"[{task_id}] Raw Tool Args: {args}")

                    # ツール応答の取得とログ出力
                    tool_response = getattr(event, 'tool_response', None)
                    if not tool_response:
                        # 他のプロパティ名で存在するか確認 (ADK のバージョンによる差分対策)
                        tool_response = getattr(event, 'response', None)
                    
                    if tool_response:
                        res_str = str(tool_response)
                        logger.info(f"[{task_id}] Tool Response: {res_str[:200]}...")

                    result = event
                
                logger.info(f"[{task_id}] ADK Agent finished: {result}")
                return True
            except Exception as e:
                logger.error(f"[{task_id}] ADK Agent error: {e}", exc_info=True)
                return False
