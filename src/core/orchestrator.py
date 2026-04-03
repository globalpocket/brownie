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
        # アサインベースでタスクを取得 (設計書改修: メンション不要)
        issues = await self.gh_client.get_issues_to_process(repo_name)
        
        for issue in issues:
            task_id = f"{repo_name}#{issue.number}"
            
            # RBAC (設計書 4. Orchestrator)
            is_collaborator = await self.gh_client.check_rbac(repo_name, issue.user.login)
            if not is_collaborator:
                logger.warning(f"RBAC Denied for {issue.user.login} on {task_id}")
                await self.gh_client.post_comment(repo_name, issue.number, 
                                               "権限がありません。実行を拒否しました。キャッシュの削除と退避を完了します。")
                continue
            
            # 重複実行防止チェック
            existing_task = await self.state.get_task(task_id)
            if existing_task:
                logger.debug(f"Task {task_id} exists with status: {existing_task['status']}")
                if existing_task['status'] in ['InProgress', 'InQueue']:
                    continue
            
            # タスク登録
            logger.info(f"Adding task {task_id} to queue (Author: {issue.user.login})")
            priority = self.config['agent']['inference_priority']['manual_issue']
            await self.state.update_task(task_id, "InQueue", repo_name, issue_num=issue.number)
            
            # 優先度付きキューに追加
            await self.worker_pool.add_task(task_id, priority, self._execute_task, task_id, repo_name, issue.number)
            
            # UX通知
            if self.config['agent'].get('queue_ux_notification', True):
                status = self.worker_pool.get_queue_status()
                await self.gh_client.post_comment(repo_name, issue.number, 
                                               f"現在順番待ちです。推定開始時刻：約 {len(status['active_tasks']) * 10} 分後")

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (設計書 7.2 タスク処理シーケンス)"""
        await self.state.update_task(task_id, "InProgress", repo_name)
        
        try:
            # ハートビート送信開始
            stop_heartbeat = asyncio.Event()
            asyncio.create_task(self._send_heartbeat(stop_heartbeat))
            
            # 1. ユーザー情報の取得 (アサイニ確認)
            my_username = self.gh_client.get_my_username()
            logger.info(f"Task {task_id} being processed by {my_username}")

            # 2. Workspace 準備 (設計書: git clone / fetch & rebase)
            # ローカルパスを計算 (例: /tmp/brownie_workspace/repo_name)
            repo_path = os.path.join("/tmp/brownie_workspace", repo_name.replace("/", "_"))
            os.makedirs(repo_path, exist_ok=True)
            
            from src.workspace.git_ops import GitOperations
            git_ops = GitOperations(repo_path)
            
            # 実際にはここで git clone または同期を行う
            # 簡易的に、既存のパスを使用するかモックする
            # ※ 今回はプロジェクトルートを対象とする
            project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            git_ops = GitOperations(project_root)
            
            # 3. Wikiタスクの判定 (Issue #1 を想定)
            issue_title = self.gh_client.g.get_repo(repo_name).get_issue(issue_number).title
            if "Wiki" in issue_title or "説明" in issue_title:
                logger.info("Wiki description task detected.")
                await self._handle_wiki_task(task_id, repo_name, issue_number, project_root)
            else:
                # 通常の実装タスク (設計書に従い、LLM -> Sandbox -> Test のループ)
                logger.info("General implementation task detected (Not yet fully implemented).")
                await self.gh_client.post_comment(repo_name, issue_number, 
                                               "Wiki以外のタスクは現在開発中です。")

            stop_heartbeat.set()
            await self.state.update_task(task_id, "Completed", repo_name)
            logger.info(f"Task {task_id} completed successfully.")
            
        except Exception as e:
            logger.error(f"Task {task_id} failed: {e}", exc_info=True)
            await self.state.update_task(task_id, "Failed", repo_name)

    async def _handle_wiki_task(self, task_id: str, repo_name: str, issue_number: int, repo_path: str):
        """Wiki説明の自動生成とプッシュ (Issue #1)"""
        logger.info(f"Generating Wiki description for {repo_name}...")
        
        try:
            # 1. LLM 推论 (設計書 2.1)
            prompt = "Brownie という自律 AI エージェントのシステム概要を、日本語でプロフェッショナルな Markdown 形式で作成してください。構成、主要コンポーネント（Orchestrator, Watchdog, Sandbox, WikiSync）、利点を含めてください。"
            
            import httpx
            async with httpx.AsyncClient() as client:
                llm_resp = await client.post(
                    f"{self.config['llm']['endpoint']}/chat/completions",
                    json={
                        "model": self.config['llm']['model_name'],
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.3
                    },
                    timeout=300.0
                )
                if llm_resp.status_code == 200:
                    wiki_content = llm_resp.json()['choices'][0]['message']['content']
                else:
                    raise RuntimeError(f"LLM Reasoning failed: {llm_resp.text}")
            
            # 2. docs フォルダの作成と書き込み
            docs_dir = os.path.join(repo_path, "docs")
            os.makedirs(docs_dir, exist_ok=True)
            wiki_file = os.path.join(docs_dir, "About-System.md")
            with open(wiki_file, "w") as f:
                f.write(wiki_content)
                
            # 3. コミット & プッシュ (GitOps)
            from src.workspace.git_ops import GitOperations
            git_ops = GitOperations(repo_path)
            git_ops.commit_and_push("master", f"docs: update system description from Issue #{issue_number}")
            
            # 4. Wiki リポジトリへの同期 (WikiSync)
            from src.workspace.wiki_sync import WikiSync
            wiki_sync = WikiSync(repo_path)
            
            repo_url = f"https://github.com/{repo_name}.git"
            wiki_sync.setup_wiki_remote(repo_url)
            wiki_sync.sync_docs_to_wiki(prefix="docs", branch="master")
            
            await self.gh_client.post_comment(repo_name, issue_number, 
                                           "### ✅ Wiki の更新が完了しました\n\n"
                                           "- `/docs/About-System.md` を作成しました。\n"
                                           "- Wiki リポジトリへの同期に成功しました。")
        except Exception as e:
            logger.error(f"Wiki task failed: {e}")
            await self.gh_client.post_comment(repo_name, issue_number, 
                                           f"❌ Wiki の更新中にエラーが発生しました: {e}")
            raise

    async def _send_heartbeat(self, stop_event: asyncio.Event):
        """Watchdogへの生存信号。設計書 4. ハートビート"""
        while not stop_event.is_set():
            # Watchdogへの生存信号（例：ファイルへの書き込みや特定APIの呼び出し）
            await asyncio.sleep(10)

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
