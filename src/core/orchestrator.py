import asyncio
import os
import sys
import logging
import yaml
import time
from typing import Optional, Dict, Any, List
from datetime import datetime

from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from src.core.workers.pool import WorkerPool # 修正後のパス
# from src.core.workflow import TaskWorkflow # 古いワークフローは使用しない
from src.gh_platform.client import GitHubClientWrapper, GitHubRateLimitException
from src.workspace.sandbox import SandboxManager
from src.mcp_server.manager import MCPServerManager
from src.version import get_footer, get_build_id

logger = logging.getLogger(__name__)

# 設計書課題: Orchestrator 側でのステート・キュー管理の OSS 化
# state.py を廃止し、LangGraph の SqliteSaver に一本化。
# APScheduler を廃止し、シンプルな非同期ポ−リングループに集約。

class Orchestrator:
    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        
        self.project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        self.worker_pool = WorkerPool(self.project_root)
        self.gh_client = GitHubClientWrapper(os.getenv("GITHUB_TOKEN", ""))
        self.sandbox = SandboxManager(self.config['workspace']['sandbox_user_id'], 
                                     self.config['workspace']['sandbox_group_id'])
        self.mcp_manager = MCPServerManager(self.project_root)
        
        self.is_running = True
        self._checkpointer: Optional[SqliteSaver] = None
        self._workflow_app = None

    async def start(self):
        """オーケストレーター（メンション監視プロセス）の起動"""
        logger.info(f"Orchestrator starting. Build ID: {get_build_id()}")
        
        # 1. LangGraph Checkpointer の初期化 (Async 版)
        checkpoint_path = os.path.join(self.project_root, ".brwn", "checkpoints.db")
        os.makedirs(os.path.dirname(checkpoint_path), exist_ok=True)
        self._checkpointer = AsyncSqliteSaver.from_conn_string(checkpoint_path)
        
        # 2. ワークフローの準備
        from src.core.graph.builder import compile_workflow
        self._workflow_app = compile_workflow(checkpointer=self._checkpointer)
        
        # 3. 消去: 既存の WorkerPool.run は以前のアーキテクチャ用なので、必要に応じて調整
        # 本アーキテクチャでは、ユーザーが別途 huey consumer を起動することを想定するか、
        # ここで新しく再定義する。
        # await self.worker_pool.run()
        
        logger.info("BOOT SEQUENCE COMPLETED. Entering polling loop.")

        # 4. メンション監視ループ (APScheduler の代わりにシンプルな while ループを使用)
        try:
            while self.is_running:
                await self._poll_mentions()
                await asyncio.sleep(self.config['agent']['polling_interval_sec'])
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            await self.shutdown()

    async def shutdown(self):
        """オーケストレーターのクリーンアップ"""
        logger.info("Orchestrator shutting down...")
        self.is_running = False
        if self._checkpointer:
            # SqliteSaver は context manager ではないため、直接的な close は不要（接続が閉じられるのを待つのみ）
            pass
        await self.mcp_manager.stop_all()
        logger.info("Orchestrator cleanup completed.")

    async def _poll_mentions(self):
        """GitHub からのメンションを取得し、Huey キューに投入する"""
        try:
            exclude_list = self.config['agent'].get('exclude_repositories', [])
            all_mentions = await self.gh_client.get_mentions_to_process()
            
            for m in all_mentions:
                target_repo = m['repo_name']
                if target_repo in exclude_list:
                    continue
                    
                task_id = f"{target_repo}#{m['number']}"
                await self._queue_task(task_id, target_repo, m['number'], comment_id=str(m['comment_id']))
        except GitHubRateLimitException as e:
            wait_seconds = int(e.reset_at - time.time()) + 60
            logger.warning(f"Rate limit hit. Sleeping for {wait_seconds}s...")
            await asyncio.sleep(wait_seconds)
        except Exception as e:
            logger.error(f"Polling error: {e}")

    async def _queue_task(self, task_id: str, repo_name: str, issue_number: int, comment_id: Optional[str] = None):
        """タスクの状態を確認し、必要であれば Huey キューに投入する"""
        config = {"configurable": {"thread_id": task_id}}
        state = await self._workflow_app.aget_state(config)
        
        # 既存状態の確認
        if state.values:
            status = state.values.get("status")
            # 実行中またはキューにある場合は二重投入を避ける
            if status in ['InProgress', 'InQueue']:
                return
            
            # 再開（Resurrection）の場合: resume_comment_id を更新
            if comment_id:
                await self._workflow_app.aupdate_state(config, {"resume_comment_id": comment_id, "status": "InQueue"})
        else:
            # 新規タスク: 状態を初期化
            initial_values = {
                "task_id": task_id,
                "repo_name": repo_name,
                "issue_number": issue_number,
                "status": "InQueue",
                "trigger_comment_id": comment_id,
                "created_at": datetime.utcnow().isoformat()
            }
            await self._workflow_app.aupdate_state(config, initial_values)

        # Huey キューへ投入 (別プロセスワーカーが Pull して実行する)
        await self.worker_pool.add_task(task_id, 0, repo_name, issue_number)
        logger.info(f"Task {task_id} PUSHed to Huey queue.")

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """
        Huey ワーカーから呼び出される実行実体。
        このメソッドは別プロセス（Worker）の非盟ループ内で動作する。
        """
        config = {"configurable": {"thread_id": task_id}}
        
        # 1. 状態の取得
        state = await self._workflow_app.aget_state(config)
        if not state.values:
            logger.error(f"Task {task_id} state not found. Cannot execute.")
            return

        # 2. ワークフローの実行 (LangGraph に制御を移譲)
        # 既に承認待ち等で interrupt されている場合は、入力を None にして再開
        try:
            # 実行ノード（agent等）に必要なコンテキストを準備（本来は Agent 側で解決）
            # ここではエージェント実行をダミーではなく、次ステップで Pydantic AI に移行する実体として扱う。
            async for event in self._workflow_app.astream(None, config=config):
                # 中断（承認待ち）が発生した時点で astream は停止する
                pass
            
            # 3. ワークフローの結果に応じた GitHub 報告（簡易版）
            final_state = await self._workflow_app.aget_state(config)
            if final_status := final_state.values.get("status"):
                if final_status == "WaitingForClarification":
                    plan = final_state.values.get("plan", "No plan.")
                    await self.gh_client.post_comment(repo_name, issue_number, f"### 🛠 実行計画（承認待ち）\n\n{plan}" + get_footer())
                elif final_status == "Completed":
                    summary = final_state.values.get("final_summary", "Done.")
                    await self.gh_client.post_comment(repo_name, issue_number, f"### ✅ 完了報告\n\n{summary}" + get_footer())

        except Exception as e:
            logger.error(f"Task execution error: {e}", exc_info=True)
            await self._workflow_app.aupdate_state(config, {"status": "Failed"})

# グローバル参照 (Huey ワーカーからの呼び出し用)
global_orchestrator: Optional[Orchestrator] = None
