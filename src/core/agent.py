import os
import logging
import asyncio
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
        self.model_name = config['llm']['models'].get('coder', 'ollama/llama3')
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
        
        # LiteLLM が Ollama 等のカスタムエンドポイントを認識できるように環境変数を設定
        if self.base_url:
            # LiteLLM/Ollama 接続用の標準的な設定
            os.environ["OPENAI_API_BASE"] = self.base_url
            os.environ["OLLAMA_API_BASE"] = self.base_url.replace("/v1", "")
            os.environ["LITELLM_API_BASE"] = self.base_url
            # Ollama 直接指定時のための追加設定
            os.environ["OLLAMA_HOST"] = os.environ["OLLAMA_API_BASE"]

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
            async def wrapper(**kwargs):
                client = client_getter() if callable(client_getter) else client_getter
                if not client:
                    logger.error(f"MCP client for tool {tool_name} is not initialized.")
                    return f"Error: Tool {tool_name} is currently unavailable because the MCP server is not connected."
                
                logger.info(f"Calling MCP tool: {tool_name} with {kwargs}")
                result = await client.call_tool(tool_name, kwargs)
                return result.content[0].text
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

    async def run(self, task_id: str, repo_name: str, issue_number: int, task_description: str) -> bool:
        """タスクを実行する (ADK Agent)"""
        self._task_id = task_id
        self._current_repo_name = repo_name
        self._current_issue_number = issue_number
        
        logger.info(f"[{task_id}] Starting ADK Agent for task: {task_description[:100]}...")
        
        try:
            # ADK Runner を使って実行 (これが 0.0.5 の推奨される実行方法)
            new_message = types.Content(parts=[types.Part(text=task_description)], role="user")
            
            result = None
            async for event in self.runner.run_async(
                user_id="brownie_operator",
                session_id=task_id,
                new_message=new_message
            ):
                # 必要に応じて進捗を記録
                result = event
            
            logger.info(f"[{task_id}] ADK Agent finished: {result}")
            return True
        except Exception as e:
            logger.error(f"[{task_id}] ADK Agent error: {e}", exc_info=True)
            return False
