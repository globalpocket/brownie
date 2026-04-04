import asyncio
import os
import logging
import yaml
import time
import subprocess
from typing import Optional, Dict, Any, List
from src.core.state import StateManager
from src.core.worker_pool import WorkerPool
from src.core.agent import CoderAgent
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
        self.agent = CoderAgent(self.config, self.sandbox, self.gh_client)
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
        # 1. アサインベースのタスク取得
        issues = await self.gh_client.get_issues_to_process(repo_name)
        for issue in issues:
            task_id = f"{repo_name}#{issue.number}"
            await self._queue_if_needed(task_id, repo_name, issue.number, issue.user.login)

        # 2. メンションベースのタスク取得 (アサイン・ラベル不問)
        mentions = await self.gh_client.get_mentions_to_process(repo_name)
        for m in mentions:
            # メンションの場合は "repo#issue:comment_id" 形式で一意性を管理
            task_id = f"{repo_name}#{m['number']}:{m['comment_id']}"
            await self._queue_if_needed(task_id, repo_name, m['number'], "mention_trigger")

    async def _queue_if_needed(self, task_id: str, repo_name: str, issue_number: int, user_login: str):
        """未処理のタスクをキューに追加する"""
        # 1. 重複実行防止チェック (設計書 4. 状態管理)
        existing_task = await self.state.get_task(task_id)
        if existing_task:
            status = existing_task['status']
            if status in ['InProgress', 'InQueue', 'Completed']:
                return

        # 2. GitHub ラベルチェック (二重のループ防止策)
        # メンション起動の場合は「ラベルに関わらず反応する」要件に従い、このチェックをスキップする
        if user_login != "mention_trigger":
            labels = await self.gh_client.get_issue_labels(repo_name, issue_number)
            if "completed" in labels:
                await self.state.update_task(task_id, "Completed", repo_name)
                return
            if "in-progress" in labels:
                return

        # 3. RBAC確認 (メンションの場合はトリガー元を確認すべきだが、一旦リポジトリ単位で許可)
        if user_login != "mention_trigger":
            is_collaborator = await self.gh_client.check_rbac(repo_name, user_login)
            if not is_collaborator:
                logger.warning(f"RBAC Denied for {user_login} on {task_id}")
                return

        # 4. キューに追加
        logger.info(f"Queueing new task: {task_id}")
        await self.state.update_task(task_id, "InQueue", repo_name, issue_num=issue_number)
        priority = self.config['agent']['inference_priority']['manual_issue']
        await self.worker_pool.add_task(task_id, priority, self._execute_task, task_id, repo_name, issue_number)
        
        # UX通知 (新規投入時のみ)
        if self.config['agent'].get('queue_ux_notification', True):
            status = self.worker_pool.get_queue_status()
            await self.gh_client.post_comment(repo_name, issue_number, 
                                           f"現在順番待ちです。推定開始時刻：約 {len(status['active_tasks']) * 10} 分後")

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (設計書 7.2 タスク処理シーケンス)"""
        # メンション情報が含まれているか確認 (ID形式: repo#issue:comment_id)
        comment_id = None
        if ":" in task_id:
            _, suffix = task_id.split(":", 1)
            comment_id = suffix

        await self.state.update_task(task_id, "InProgress", repo_name)
        success = False
        stop_heartbeat = asyncio.Event()
        
        try:
            # ハートビート送信開始
            asyncio.create_task(self._send_heartbeat(stop_heartbeat))
            
            # 1. ユーザー情報 / Workspace 準備
            my_username = self.gh_client.get_my_username()
            repo_path = os.path.join("/tmp/brownie_workspace", repo_name.replace("/", "_"))
            os.makedirs(repo_path, exist_ok=True)
            await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
            
            from src.workspace.git_ops import GitOperations
            git_ops = GitOperations(repo_path)
            project_root = repo_path
            
            # 2. Issue情報の取得と指示の決定
            target_issue = self.gh_client.g.get_repo(repo_name).get_issue(issue_number)
            issue_title = target_issue.title
            issue_body = target_issue.body or ""
            
            active_label = "in-progress"
            
            # メンション起動時の特別処理
            if comment_id:
                active_label = "ai-active"
                # 初動コメントの投稿 (要件)
                await self.gh_client.post_comment(repo_name, issue_number, "@globalpocket 承知しました。作業を開始します。")
                
                # コメント内容を指示として取得
                if comment_id != "body":
                    comment = target_issue.get_comment(int(comment_id))
                    issue_body = comment.body
                logger.info(f"Mention-based task detected via comment {comment_id}. Instruction: {issue_body[:50]}")

            # 3. タスクの振り分け
            title_lower = issue_title.lower()
            if "wiki" in title_lower or "説明" in title_lower:
                logger.info(f"Wiki description task detected for {task_id}")
                await self._handle_wiki_task(task_id, repo_name, issue_number, project_root)
                success = True
            else:
                logger.info(f"General implementation task detected (Issue #{issue_number})")
                await self.gh_client.add_label(repo_name, issue_number, active_label)
                if not comment_id:
                    await self.gh_client.post_comment(repo_name, issue_number, f"🔍 トピックブランチ `issue-{issue_number}` を作成し、実装を開始します...")
                
                # トピックブランチの作成
                branch_name = f"issue-{issue_number}"
                git_ops.create_and_checkout_branch(branch_name)
                
                # エージェントによる自律実行 (指示を issue_body として渡す)
                success = await self.agent.plan_and_execute(task_id, project_root, issue_title, issue_body, repo_name, issue_number)
                
                if success:
                    commit_msg = f"feat: automated implementation for Issue #{issue_number}"
                    git_ops.commit_and_push(branch_name, commit_msg)
                    
                    pr_title = f"Fix #{issue_number}: {issue_title}"
                    pr_body = f"## 概要\nIssue #{issue_number} に対する自動実装PRです。\n\n## 変更点\n{issue_body}"
                    pr = await self.gh_client.create_pull_request(
                        repo_name=repo_name,
                        title=pr_title,
                        body=pr_body,
                        head=branch_name,
                        base="main"
                    )
                    
                    if pr:
                        summary = f"### 📝 対応内容の要約\n\nIssue #{issue_number} に対して以下の対応を行い、自律的な修正と検証を完了しました：\n- **実装内容**: {issue_title}\n- **Pull Request**: {pr.html_url}"
                        await self.gh_client.post_comment(repo_name, issue_number, f"✅ 実装が完了し、プルリクエストを作成しました！\n\n{summary}")
                    else:
                        success = False
                        await self.gh_client.post_comment(repo_name, issue_number, "❌ 実装は完了しましたが、PR作成に失敗しました。")
                else:
                    await self.gh_client.post_comment(repo_name, issue_number, "❌ 自律実装中にエラーが発生しました。ログを確認してください。")

        except Exception as e:
            logger.error(f"Task {task_id} failed with exception: {e}", exc_info=True)
            success = False
            await self.gh_client.post_comment(repo_name, issue_number, f"❌ 予期せぬエラーでタスクが中断されました: {e}")
        finally:
            stop_heartbeat.set()
            final_status = "Completed" if success else "Failed"
            await self.state.update_task(task_id, final_status, repo_name)
            # ラベルの連動
            active_label = "ai-active" if comment_id else "in-progress"
            await self.gh_client.remove_label(repo_name, issue_number, active_label)
            await self.gh_client.add_label(repo_name, issue_number, "completed" if success else "failed")
            logger.info(f"Task {task_id} cycle finished (Success: {success}, Status: {final_status}).")

    async def _handle_wiki_task(self, task_id: str, repo_name: str, issue_number: int, repo_path: str):
        """Wiki説明の自動生成とプッシュ (Issue #1)"""
        logger.info(f"Generating Wiki description for {repo_name}...")
        await self.gh_client.add_label(repo_name, issue_number, "in-progress")
        
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
            git_ops.commit_and_push("main", f"docs: update system description from Issue #{issue_number}")
            
            # 4. Wiki リポジトリへの同期 (WikiSync)
            from src.workspace.wiki_sync import WikiSync
            wiki_sync = WikiSync(repo_path)
            
            repo_url = f"https://github.com/{repo_name}.git"
            wiki_sync.setup_wiki_remote(repo_url)
            wiki_sync.sync_docs_to_wiki(prefix="docs", branch="main")
            
            await self.gh_client.remove_label(repo_name, issue_number, "in-progress")
            await self.gh_client.add_label(repo_name, issue_number, "completed")
            await self.gh_client.post_comment(repo_name, issue_number, 
                                           "### ✅ Wiki の更新が完了しました\n\n"
                                           "- `/docs/About-System.md` を作成しました。\n"
                                           "- Wiki リポジトリへの同期に成功しました。")
        except Exception as e:
            logger.error(f"Wiki task failed: {e}")
            await self.gh_client.remove_label(repo_name, issue_number, "in-progress")
            await self.gh_client.add_label(repo_name, issue_number, "failed")
            await self.gh_client.post_comment(repo_name, issue_number, 
                                           f"❌ Wiki の更新中にエラーが発生しました: {e}")
            raise

    async def _send_heartbeat(self, stop_event: asyncio.Event):
        """Watchdogへの生存信号。設計書 4. ハートビート"""
        while not stop_event.is_set():
            # Watchdogへの生存信号（例：ファイルへの書き込みや特定APIの呼び出し）
            await asyncio.sleep(10)

    async def _check_llm_health(self):
        """LLMサーバーの死活監視と自動起動 (設計書 4. Orchestrator)"""
        import httpx
        base_url = self.config['llm']['endpoint'].replace("/v1", "")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.get(base_url + "/api/tags", timeout=5.0)
                if resp.status_code == 200:
                    return # 正常
                logger.warning(f"LLM Server health check failed (Status: {resp.status_code}). Attempting to start Ollama...")
        except (httpx.ConnectError, httpx.TimeoutException, Exception):
            logger.warning("LLM Server unreachable. Attempting to start Ollama...")
        
        # Ollama の起動試行 (Mac)
        try:
            # バックグラウンドで起動
            subprocess.Popen(["ollama", "serve"], 
                             stdout=subprocess.DEVNULL, 
                             stderr=subprocess.DEVNULL,
                             start_new_session=True)
            logger.info("Executed 'ollama serve' in background. Waiting for startup...")
            await asyncio.sleep(10) # 起動待ち
        except Exception as e:
            logger.error(f"Failed to start Ollama: {e}")
