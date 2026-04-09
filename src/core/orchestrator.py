import asyncio
import os
import sys
import logging
import yaml
import time
import subprocess
import httpx
import json
from typing import Optional, Dict, Any, List

from src.core.state import StateManager
from src.core.worker_pool import WorkerPool
from src.core.agent import CoderAgent
from src.gh_platform.client import GitHubClientWrapper, GitHubRateLimitException
from src.workspace.sandbox import SandboxManager
from src.workspace.context import WorkspaceContext
from src.mcp_server.manager import MCPServerManager
from src.workspace.analyzer.core import CodeAnalyzer
from src.version import get_footer

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        
        # プロジェクトルートを取得
        self.project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        self.state = StateManager(self.config['database']['db_path'])
        self.worker_pool = WorkerPool()
        self.gh_client = GitHubClientWrapper(os.getenv("GITHUB_TOKEN", ""))
        self.sandbox = SandboxManager(self.config['workspace']['sandbox_user_id'], 
                                     self.config['workspace']['sandbox_group_id'])
        self.http_client = httpx.AsyncClient(timeout=300.0)
        self.mcp_manager = MCPServerManager(self.project_root)
        
        # LLM サーバーの重複起動を防ぐためのロックとフラグ
        self._llm_startup_lock = asyncio.Lock()
        
        # エージェントはタスク実行時に最新のコンテキストを取得して再構成するため、ここでは雛形として保持
        self.agent = None 
        self.is_running = True

    async def start(self):
        """オーケストレーターの起動"""
        await self.state.connect()
        await self.state.reset_orphaned_tasks()
        asyncio.create_task(self.worker_pool.run())
        
        # リポジトリの初期化 (WDCA)
        repo_list = self.config['agent'].get('repositories', [])
        workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
        
        logger.info(f"BOOT SEQUENCE: Initializing Deep Context for {len(repo_list)} repositories...")
        for repo_name in repo_list:
            repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
            os.makedirs(repo_path, exist_ok=True)
            await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
            
            logger.info(f"WDCA: Building symbol map for {repo_name}...")
            analyzer = CodeAnalyzer(repo_path)
            await analyzer.scan_project()
            analyzer.close()
            
        logger.info("BOOT SEQUENCE COMPLETED. Entering main polling loop.")

        # メインポーリングループ
        while self.is_running:
            try:
                for repo_name in repo_list:
                    await self._poll_repository(repo_name)
                
                await self._check_llm_health()
                self.sandbox.cleanup_orphans()
                await asyncio.sleep(self.config['agent']['polling_interval_sec'])
            except GitHubRateLimitException as e:
                wait_seconds = int(e.reset_at - time.time()) + 60
                logger.warning(f"HIBERNATION MODE: Captured GitHub rate limit. Sleeping for {wait_seconds}s...")
                await asyncio.sleep(wait_seconds)
            except Exception as e:
                logger.error(f"Orchestrator error: {e}", exc_info=True)
                await asyncio.sleep(10)
        
        await self.http_client.aclose()
        await self.mcp_manager.stop_all()

    async def _poll_repository(self, repo_name: str):
        """リポジトリの最新状態を確認し、タスクをキューイングする"""
        mentions = await self.gh_client.get_mentions_to_process(repo_name)
        for m in mentions:
            task_id = f"{repo_name}#{m['number']}:{m['comment_id']}"
            await self._queue_if_needed(task_id, repo_name, m['number'], "mention_trigger")

    async def _queue_if_needed(self, task_id: str, repo_name: str, issue_number: int, user_login: str):
        active_tasks = await self.state.get_active_tasks_for_issue(repo_name, issue_number)
        if active_tasks: return

        existing_task = await self.state.get_task(task_id)
        if existing_task and existing_task.get("status") != "Failed": return

        labels = await self.gh_client.get_issue_labels(repo_name, issue_number)
        if ("completed" in labels or "failed" in labels) and "ai-active" not in labels: return

        if user_login != "mention_trigger":
            if "in-progress" in labels: return
            if not await self.gh_client.check_rbac(repo_name, user_login): return

        logger.info(f"Queueing new task: {task_id}")
        await self.state.update_task(task_id, "InQueue", repo_name, issue_num=issue_number)
        priority = self.config['agent']['inference_priority']['manual_issue']
        await self.worker_pool.add_task(task_id, priority, self._execute_task, task_id, repo_name, issue_number)

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (新アーキテクチャ統合版)"""
        comment_id = None
        if ":" in task_id:
            _, suffix = task_id.split(":", 1)
            comment_id = suffix

        await self.state.update_task(task_id, "InProgress", repo_name)
        stop_heartbeat = asyncio.Event()
        active_label = None
        success = False
        
        # 各タスクごとにクリーンな MCP マネージャーとコンテキストを使用
        async with MCPServerManager(self.project_root) as task_mcp_manager:
            try:
                asyncio.create_task(self._send_heartbeat(stop_heartbeat))
                
                # 1. コンテキスト作成
                workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
                repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
                os.makedirs(repo_path, exist_ok=True)
                await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
                
                ws_context = WorkspaceContext(repo_path, self.project_root)
                self.sandbox.context = ws_context # Sandboxも新コンテキストを共有
                
                # 2. MCP サーバー起動
                memory_path = os.path.expanduser(self.config['database'].get('memory_path', '~/.local/share/brownie/vector_db'))
                
                kn_client = await task_mcp_manager.start_knowledge_server(repo_path, memory_path, repo_name)
                ws_client = await task_mcp_manager.start_workspace_server(
                    repo_path, self.project_root, 
                    self.config['workspace']['sandbox_user_id'], 
                    self.config['workspace']['sandbox_group_id']
                )

                # 3. エージェントの初期化 (Dependency Injection)
                task_agent = CoderAgent(
                    self.config, self.sandbox, self.state, self.gh_client,
                    knowledge_mcp_client=kn_client,
                    workspace_mcp_client=ws_client,
                    workspace_context=ws_context
                )

                # 4. タスク実行
                target_issue = self.gh_client.g.get_repo(repo_name).get_issue(issue_number)
                active_label = "ai-active" if comment_id else "in-progress"
                await self.gh_client.add_label(repo_name, issue_number, active_label)
                
                instruction_priority = None
                if comment_id and comment_id != "body":
                    instruction_priority = await self.gh_client.get_comment_body(repo_name, issue_number, comment_id)

                task_description = f"Title: {target_issue.title}\n\nBody: {target_issue.body or ''}"
                if instruction_priority:
                    task_description += f"\n\nAdditional Instructions: {instruction_priority}"

                success = await task_agent.run(
                    task_id=task_id, repo_name=repo_name, issue_number=issue_number,
                    repo_path=repo_path, task_description=task_description
                )
                
                # エージェントが False を返した場合（finish/suspendを呼ばずに終了）、エラーとして扱う
                if success is False:
                    raise Exception("Agent exited without completing the task (finish() was not called).")

                # 5. Git 操作 (成功時のみ)
                if success is True:
                    from src.workspace.git_ops import GitOperations
                    git_ops = GitOperations(repo_path)
                    if git_ops.has_changes():
                        branch_name = f"issue-{issue_number}"
                        git_ops.create_and_checkout_branch(branch_name)
                        git_ops.commit_and_push(branch_name, f"feat: automated implementation for #{issue_number}")
                        await self.gh_client.create_pull_request(
                            repo_name=repo_name, title=f"Fix #{issue_number}: {target_issue.title}",
                            body=f"## 概要\n#{issue_number} に対する自動実装PRです。",
                            head=branch_name, base="main"
                        )

            except Exception as e:
                logger.error(f"Task {task_id} failed: {e}", exc_info=True)
                success = False
                await self.gh_client.post_comment(repo_name, issue_number, f"❌ エラーが発生しました: {e}" + get_footer())
            finally:
                stop_heartbeat.set()
                final_status = "Suspended" if success == "SUSPENDED" else ("Completed" if success else "Failed")
                
                if success in [True, "SUSPENDED"]:
                    latest_task = await self.state.get_task(task_id)
                    summary = (latest_task.get('context') or {}).get('final_summary') if latest_task else None
                    if summary:
                        status_icon = "⏳ 中断" if success == "SUSPENDED" else "✅ 完了"
                        await self.gh_client.post_comment(repo_name, issue_number, f"### {status_icon}\n\n{summary}" + get_footer())
                
                await self.state.update_task(task_id, final_status, repo_name)
                if active_label:
                    await self.gh_client.remove_label(repo_name, issue_number, active_label)
                await self.gh_client.add_label(repo_name, issue_number, final_status.lower())

    async def _send_heartbeat(self, stop_event: asyncio.Event):
        while not stop_event.is_set():
            await asyncio.sleep(10)

    async def _check_llm_health(self):
        async with self._llm_startup_lock:
            models_config = [
                ("planner", self.config['llm']['planner_endpoint'], 8080),
                ("executor", self.config['llm']['executor_endpoint'], 8081)
            ]
            
            for role, endpoint, port in models_config:
                try:
                    resp = await self.http_client.get(f"{endpoint}/models", timeout=5.0)
                    if resp.status_code == 200:
                        continue
                except Exception:
                    pass
                
                model_name = self.config['llm']['models'].get(role)
                logger.info(f"LLM Server ({role}) down on port {port}. Restarting MLX: {model_name}")
                
                # ポートに基づいた特定プロセスのクリーンアップ
                try:
                    # lsof -ti :port で PID を取得して kill する
                    result = subprocess.run(["lsof", "-ti", f":{port}"], capture_output=True, text=True, check=False)
                    pids = result.stdout.strip().split("\n")
                    for pid in pids:
                        if pid:
                            logger.info(f"Killing process {pid} using port {port}")
                            subprocess.run(["kill", "-9", pid], check=False)
                    await asyncio.sleep(1)
                except Exception as e:
                    logger.warning(f"Failed to cleanup processes on port {port}: {e}")

                env = os.environ.copy()
                model_dir = self.config.get('llm', {}).get('model_dir', '~/.local/share/brownie/models')
                env["HF_HOME"] = os.path.expanduser(model_dir)
                
                subprocess.Popen([sys.executable, "-m", "mlx_lm.server", "--model", model_name, "--port", str(port)], 
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, 
                                 start_new_session=True, env=env)
                
                # 起動待機
                max_retries = 90
                ready = False
                for i in range(max_retries):
                    try:
                        resp = await self.http_client.get(f"{endpoint}/models", timeout=2.0)
                        if resp.status_code == 200:
                            logger.info(f"MLX Server ({role}) is now ready on port {port}.")
                            ready = True
                            break
                    except Exception:
                        pass
                    await asyncio.sleep(1)
                
                if not ready:
                    logger.error(f"MLX Server ({role}) failed to start on port {port} within timeout.")

