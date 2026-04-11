import os
import sys
import logging
import asyncio
import anyio
from typing import Optional, Dict, Any
from fastmcp import Client
from fastmcp.client.transports.stdio import StdioTransport

logger = logging.getLogger(__name__)

class MCPServerManager:
    """
    MCP サーバー (Knowledge, Workspace, SQLite) のライフサイクルを管理する。
    AnyIO の TaskGroup を用いて、プロセスの確実なクリーンアップを保証する。
    """
    def __init__(self, project_root: str):
        self.project_root = project_root
        self.workspace_client: Optional[Client] = None
        self.knowledge_client: Optional[Client] = None
        self.sqlite_client: Optional[Client] = None
        self._task_group: Optional[anyio.abc.TaskGroup] = None
        self._exit_stack: Optional[asyncio.ExitStack] = None

    async def start_workspace_server(self, repo_path: str, reference_path: str, user_id: int, group_id: int):
        """Workspace MCP Server を起動し、クライアントを返す"""
        logger.info(f"Starting Workspace MCP Server: workspace={repo_path}")
        env = {
            **os.environ, 
            "BROWNIE_WORKSPACE_ROOT": repo_path, 
            "BROWNIE_REFERENCE_ROOT": reference_path,
            "PYTHONPATH": "."
        }

        transport = StdioTransport(
            command=sys.executable,
            args=["-m", "src.mcp_server.workspace_server", repo_path, reference_path, str(user_id), str(group_id)],
            env=env,
            cwd=self.project_root,
            keep_alive=False
        )
        
        client = Client(transport)
        await self._exit_stack.enter_async_context(client)
        self.workspace_client = client
        logger.info("Workspace MCP Server connected successfully.")
        return client

    async def start_knowledge_server(self, repo_path: str, memory_path: str, repo_name: str):
        """Knowledge MCP Server を起動し、クライアントを返す"""
        logger.info(f"Starting Knowledge MCP Server for {repo_name}...")
        env = {
            **os.environ, 
            "BROWNIE_TARGET_REPO": repo_name, 
            "BROWNIE_REPO_PATH": repo_path, 
            "BROWNIE_MEMORY_PATH": memory_path,
            "PYTHONPATH": "."
        }

        transport = StdioTransport(
            command=sys.executable,
            args=["-m", "src.mcp_server.knowledge_server", repo_path, memory_path, repo_name],
            env=env,
            cwd=self.project_root,
            keep_alive=False
        )
        
        client = Client(transport)
        await self._exit_stack.enter_async_context(client)
        self.knowledge_client = client
        logger.info(f"Knowledge MCP Server connected successfully for {repo_name}")
        return client

    async def start_sqlite_server(self, db_path: str):
        """SQLite MCP Server を起動し、クライアントを返す"""
        logger.info(f"Starting SQLite MCP Server: db={db_path}")
        db_path = os.path.expanduser(db_path)
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        
        transport = StdioTransport(
            command="uvx",
            args=["mcp-server-sqlite", "--db-path", db_path],
            keep_alive=False
        )
        
        client = Client(transport)
        await self._exit_stack.enter_async_context(client)
        self.sqlite_client = client
        logger.info("SQLite MCP Server connected successfully.")
        return client

    async def stop_all(self):
        """全ての MCP サーバーを停止する (ExitStack により自動化されているが、明示的な呼び出しにも対応)"""
        if self._exit_stack:
            await self._exit_stack.aclose()
            self._exit_stack = asyncio.ExitStack()

    async def __aenter__(self):
        # AsyncExitStack を使用して、タスクグループと各クライアントのライフサイクルを統合管理
        self._exit_stack = asyncio.AsyncExitStack()
        self._task_group = await self._exit_stack.enter_async_context(anyio.create_task_group())
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._exit_stack:
            await self._exit_stack.__aexit__(exc_type, exc_val, exc_tb)
