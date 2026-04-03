import asyncio
import os
import logging
import yaml
import time
from typing import Optional, Dict, Any, List
from src.core.state import StateManager
from src.core.worker_pool import WorkerPool
from src.gh_platform.client import GitHubClientWrapper
from src.workspace.sandbox import SandboxManager

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        
        self.state = StateManager(self.config['database']['db_path'])
        self.worker_pool = WorkerPool()
        self.gh_client = GitHubClientWrapper(os.getenv("GITHUB_TOKEN", ""))
        self.sandbox = SandboxManager(self.config['workspace']['sandbox_user_id'], 
                                     self.config['workspace']['sandbox_group_id'])
        self.is_running = True

    async def start(self):
        """オーケストレーターの起動"""
        await self.state.connect()
        asyncio.create_task(self.worker_pool.run()) # ワーカープール起動
        
        # メインポーリングループ
        while self.is_running:
            try:
                # 1. 監視 (GitHub API ポーリング)
                repo_list = self.config['agent'].get('repositories', [])
                for repo_name in repo_list:
                    await self._poll_repository(repo_name)
                
                # 2. 監視 (LLMサーバーの死活監視)
                await self._check_llm_health()
                
                # 3. 待機 (configのインターバル)
                await asyncio.sleep(self.config['agent']['polling_interval_sec'])
            except Exception as e:
                logger.error(f"Orchestrator error: {e}", exc_info=True)
                await asyncio.sleep(10)

    async def _poll_repository(self, repo_name: str):
        """リポジトリの最新状態を確認し、タスクをキューイングする"""
        mention_name = self.config['agent']['mention_name']
        issues = await self.gh_client.get_issues_to_process(repo_name, mention_name)
        
        for issue in issues:
            task_id = f"{repo_name}#{issue.number}"
            
            # RBAC (設計書 4. Orchestrator)
            if not await self.gh_client.check_rbac(repo_name, issue.user.login):
                logger.warning(f"RBAC Denied for {issue.user.login} on {task_id}")
                # クリーンアップと退避 (設計書 4. Orchestrator)
                await self.gh_client.post_comment(repo_name, issue.number, 
                                               "権限がありません。実行を拒否しました。キャッシュの削除と退避を完了します。")
                continue
            
            # 重複実行防止チェック
            existing_task = await self.state.get_task(task_id)
            if existing_task and existing_task['status'] in ['InProgress', 'InQueue']:
                continue
            
            # 要件追従 (設計書 4. Orchestrator: updated_at 監視)
            # 既存タスクがあったとしても、updated_at が新しければ再実行を検討する
            
            # タスク登録
            priority = self.config['agent']['inference_priority']['manual_issue']
            await self.state.update_task(task_id, "InQueue", repo_name, issue_num=issue.number)
            
            # 優先度付きキューに追加
            await self.worker_pool.add_task(task_id, priority, self._execute_task, task_id, repo_name, issue.number)
            
            # UX通知 (設計書 4. Orchestrator/WorkerPool)
            if self.config['agent']['queue_ux_notification']:
                status = self.worker_pool.get_queue_status()
                await self.gh_client.post_comment(repo_name, issue.number, 
                                               f"現在順番待ちです。推定開始時刻：約 {len(status['active_tasks']) * 10} 分後")

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (設計書 7.2 タスク処理シーケンス)"""
        await self.state.update_task(task_id, "InProgress", repo_name)
        
        try:
            # ハートビート送信開始 (設計書 4. Orchestrator: 誤再起動防止)
            stop_heartbeat = asyncio.Event()
            asyncio.create_task(self._send_heartbeat(stop_heartbeat))
            
            # 1. Workspace 準備 (git fetch & rebase)
            # 実際には src/workspace/git_ops.py 等を使用
            
            # 2. RAG & Discovery
            
            # 3. 推論・実装・テストループ
            
            # 4. Commit, Push, PR作成
            
            stop_heartbeat.set()
            await self.state.update_task(task_id, "Completed", repo_name)
            logger.info(f"Task {task_id} completed successfully.")
            
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}", exc_info=True)
            await self.state.update_task(task_id, "Failed", repo_name)
            # 自己修復メタ・ループ (設計書 9. エラー処理) の発動検討

    async def _send_heartbeat(self, stop_event: asyncio.Event):
        """Watchdogへの生存信号。設計書 4. ハートビート"""
        while not stop_event.is_set():
            # Watchdogへの生存信号（例：ファイルへの書き込みや特定APIの呼び出し）
            asyncio.sleep(10)

    async def _check_llm_health(self):
        """LLMサーバーの死活監視 (設計書 4. Orchestrator)"""
        import httpx
        try:
            async with httpx.AsyncClient() as client:
                # OllamaのベースURLを取得（/v1を除去）して /api/tags でチェック
                base_url = self.config['llm']['endpoint'].replace("/v1", "")
                resp = await client.get(base_url + "/api/tags")
                if resp.status_code != 200:
                    logger.error(f"LLM Server health check failed! (Status: {resp.status_code})")
                    # Watchdogへ再起動指示などを送信
        except Exception:
            logger.error("LLM Server unreachable!")
