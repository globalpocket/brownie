import os
import sys
import logging
import asyncio
from typing import Optional, Dict, Any
from fastmcp import Client
from fastmcp.client.transports.stdio import StdioTransport

logger = logging.getLogger(__name__)

class MCPServerManager:
    """
    MCP サーバー (Knowledge, Workspace) のライフサイクルを管理する。
    非同期コンテキストマネージャーとして動作し、確実なクリーンアップを保証する。
    """
    def __init__(self, project_root: str):
        self.project_root = project_root
        self.workspace_client: Optional[Client] = None
        self.knowledge_client: Optional[Client] = None
        self.sqlite_client: Optional[Client] = None

    async def start_workspace_server(self, repo_path: str, reference_path: str, user_id: int, group_id: int):
        """Workspace MCP Server を起動し、クライアントを返す"""
        try:
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
            await client.__aenter__()
            self.workspace_client = client
            logger.info("Workspace MCP Server connected successfully.")
            return client
        except Exception as e:
            logger.error(f"Failed to start Workspace MCP Server: {e}")
            self.workspace_client = None
            return None

    async def start_knowledge_server(self, repo_path: str, memory_path: str, repo_name: str):
        """Knowledge MCP Server を起動し、クライアントを返す"""
        try:
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
            await client.__aenter__()
            self.knowledge_client = client
            logger.info(f"Knowledge MCP Server connected successfully for {repo_name}")
            return client
        except Exception as e:
            logger.error(f"Failed to start Knowledge MCP Server: {e}")
            self.knowledge_client = None
            return None

    async def start_sqlite_server(self, db_path: str):
        """SQLite MCP Server を起動し、クライアントを返す"""
        try:
            logger.info(f"Starting SQLite MCP Server: db={db_path}")
            db_path = os.path.expanduser(db_path)
            os.makedirs(os.path.dirname(db_path), exist_ok=True)
            
            transport = StdioTransport(
                command="uvx",
                args=["mcp-server-sqlite", "--db-path", db_path],
                keep_alive=False
            )
            
            client = Client(transport)
            await client.__aenter__()
            self.sqlite_client = client
            logger.info("SQLite MCP Server connected successfully.")
            return client
        except Exception as e:
            logger.error(f"Failed to start SQLite MCP Server: {e}")
            self.sqlite_client = None
            return None

    async def stop_all(self):
        """全ての MCP サーバーを停止する"""
        if self.workspace_client:
            logger.info("Stopping Workspace MCP Server...")
            try:
                await self.workspace_client.__aexit__(None, None, None)
            except Exception as e:
                logger.error(f"Error stopping Workspace MCP Client: {e}")
            self.workspace_client = None

        if self.knowledge_client:
            logger.info("Stopping Knowledge MCP Server...")
            try:
                await self.knowledge_client.__aexit__(None, None, None)
            except Exception as e:
                logger.error(f"Error stopping Knowledge MCP Client: {e}")
            self.knowledge_client = None

        if self.sqlite_client:
            logger.info("Stopping SQLite MCP Server...")
            try:
                await self.sqlite_client.__aexit__(None, None, None)
            except Exception as e:
                logger.error(f"Error stopping SQLite MCP Client: {e}")
            self.sqlite_client = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.stop_all()
