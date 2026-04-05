import asyncio
import os
import logging
import yaml
import time
import subprocess
import httpx
from typing import Optional, Dict, Any, List
from src.core.state import StateManager
from src.core.worker_pool import WorkerPool
from src.core.agent import CoderAgent
from src.gh_platform.client import GitHubClientWrapper, GitHubRateLimitException
from src.workspace.sandbox import SandboxManager
from src.version import get_footer
import json

logger = logging.getLogger(__name__)

class Orchestrator:
    def __init__(self, config_path: str):
        with open(config_path, 'r') as f:
            self.config = yaml.safe_load(f)
        
        # プロジェクトルートを取得 (src/core/orchestrator.py の3階層上)
        self.project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        
        self.state = StateManager(self.config['database']['db_path'])
        self.worker_pool = WorkerPool()
        self.gh_client = GitHubClientWrapper(os.getenv("GITHUB_TOKEN", ""))
        self.sandbox = SandboxManager(self.config['workspace']['sandbox_user_id'], 
                                     self.config['workspace']['sandbox_group_id'])
        self.http_client = httpx.AsyncClient(timeout=300.0)
        self.agent = CoderAgent(self.config, self.sandbox, self.state, self.gh_client, http_client=self.http_client)
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
                
                # 3. 定期的なクリーンアップ (Dockerコンテナ等)
                self.sandbox.cleanup_orphans()
                
                # 4. 待機 (configのインターバル)
                await asyncio.sleep(self.config['agent']['polling_interval_sec'])
            except GitHubRateLimitException as e:
                wait_seconds = int(e.reset_at - time.time()) + 60 # 余裕を持って+60秒
                logger.warning(f"HIBERNATION MODE: Captured GitHub rate limit. Sleeping for {wait_seconds}s until {time.ctime(e.reset_at)}")
                
                # 冬眠情報をファイルに記録 (CLI/Watchdog用)
                hibernation_info = {
                    "reset_at": e.reset_at,
                    "wake_up_at": time.ctime(e.reset_at + 60),
                    "reason": str(e)
                }
                with open("/tmp/brownie_hibernation.json", "w") as f:
                    json.dump(hibernation_info, f)
                
                # 冬眠中も定期的に生存信号（ダミーのウェイクアップ）を送り、Watchdogに殺されないようにする
                # (Orchestrator自体はループを止めるが、 asyncio.sleep で待機)
                try:
                    await asyncio.sleep(wait_seconds)
                finally:
                    # 冬眠終了
                    if os.path.exists("/tmp/brownie_hibernation.json"):
                        os.remove("/tmp/brownie_hibernation.json")
                    logger.info("HIBERNATION MODE: Wake up. Resuming polling.")
            except Exception as e:
                logger.error(f"Orchestrator error: {e}", exc_info=True)
                await asyncio.sleep(10)
        
        # 終了時にクライアントを閉じる
        await self.http_client.aclose()

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
        """未処理のタスクをキューに追加する (設計書 4. 状態管理)"""
        # 1. 広範な重複実行防止チェック (同一Issueに対する二重起動防止)
        active_tasks = await self.state.get_active_tasks_for_issue(repo_name, issue_number)
        if active_tasks:
            return

        # 2. 個別タスクIDの状態チェック
        existing_task = await self.state.get_task(task_id)
        if existing_task:
            status = existing_task['status']
            if status == 'Completed':
                return
            if user_login == "mention_trigger" and status == 'Failed':
                return

        # 2. GitHub ラベルチェック
        if user_login != "mention_trigger":
            labels = await self.gh_client.get_issue_labels(repo_name, issue_number)
            if "completed" in labels:
                await self.state.update_task(task_id, "Completed", repo_name)
                return
            if "in-progress" in labels:
                return

        # 3. RBAC確認
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
        
        if self.config['agent'].get('queue_ux_notification', True):
            status = self.worker_pool.get_queue_status()
            await self.gh_client.post_comment(repo_name, issue_number, 
                                           f"現在順番待ちです。推定開始時刻：約 {len(status['active_tasks']) * 10} 分後" + get_footer())

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (設計書 7.2 タスク処理シーケンス)"""
        comment_id = None
        if ":" in task_id:
            _, suffix = task_id.split(":", 1)
            comment_id = suffix

        await self.state.update_task(task_id, "InProgress", repo_name)
        success = False
        stop_heartbeat = asyncio.Event()
        
        try:
            asyncio.create_task(self._send_heartbeat(stop_heartbeat))
            
            workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
            repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
            os.makedirs(repo_path, exist_ok=True)
            await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
            
            from src.workspace.git_ops import GitOperations
            git_ops = GitOperations(repo_path)
            
            # サンドボックスの設定
            self.sandbox.set_workspace_root(repo_path)
            self.sandbox.set_reference_root(self.project_root) # ローカルリポジトリを参照用として設定
            
            target_issue = self.gh_client.g.get_repo(repo_name).get_issue(issue_number)
            issue_title = target_issue.title
            issue_body = target_issue.body or ""
            
            location_type = "ISSUE"
            location_context = {}
            active_label = "in-progress"
            is_mention = False
            instruction_priority = None

            if comment_id:
                is_mention = True
                active_label = "ai-active"
                is_pr = False
                try:
                    target_issue.as_pull_request()
                    is_pr = True
                    location_type = "PR"
                except:
                    is_pr = False

                start_msg = "プルリクエストを確認しました。指示に従います。" if is_pr else "課題を確認しました。作業を開始します。"
                # 依頼主（user_login）がいればその人にメンションし、いなければリクエスト本体へ
                trigger_user = user_login if user_login != "mention_trigger" else ""
                mention_prefix = f"@{trigger_user} " if trigger_user else ""
                await self.gh_client.post_comment(repo_name, issue_number, f"{mention_prefix}{start_msg}" + get_footer())
                
                if comment_id != "body":
                    if comment_id.startswith("review-"):
                        location_type = "PR_REVIEW"
                        review_id = int(comment_id.replace("review-", ""))
                        review = target_issue.as_pull_request().get_review(review_id)
                        instruction_priority = review.body
                        location_context["review_body"] = review.body
                        location_context["state"] = review.state
                    elif comment_id.startswith("rc-"):
                        location_type = "PR_INLINE"
                        rc_id = int(comment_id.replace("rc-", ""))
                        ctx = await self.gh_client.get_inline_comment_context(repo_name, rc_id)
                        if ctx:
                            instruction_priority = ctx["body"]
                            location_context.update(ctx)
                    else:
                        comment = target_issue.get_comment(int(comment_id))
                        instruction_priority = comment.body
                
                issue_body = (issue_body[:5000] + "... (truncated)") if len(issue_body) > 5000 else issue_body
                if instruction_priority:
                    instruction_priority = (instruction_priority[:5000] + "... (truncated)") if len(instruction_priority) > 5000 else instruction_priority

            await self.gh_client.add_label(repo_name, issue_number, active_label)
            if not is_mention:
                await self.gh_client.post_comment(repo_name, issue_number, f"🔍 トピックブランチ `issue-{issue_number}` を作成し、実装を開始します..." + get_footer())
            
            branch_name = f"issue-{issue_number}"
            git_ops.create_and_checkout_branch(branch_name)
            
            success = await self.agent.plan_and_execute(
                task_id=task_id,
                repo_name=repo_name,
                issue_number=issue_number,
                issue_title=issue_title,
                issue_body=issue_body,
                is_mention=is_mention,
                location_type=location_type,
                location_context=location_context,
                instruction_priority=instruction_priority
            )
                
            if success:
                if is_mention and not git_ops.has_changes():
                    await self.gh_client.post_comment(repo_name, issue_number, "✅ 依頼された操作（または確認）を完了しました。")
                else:
                    commit_msg = f"feat: automated implementation for {location_type} #{issue_number}"
                    git_ops.commit_and_push(branch_name, commit_msg)
                    
                    pr_title = f"Fix #{issue_number}: {issue_title}"
                    pr_body = f"## 概要\n{location_type} #{issue_number} に対する自動実装PRです。\n\n## 変更点\n{issue_body}"
                    pr = await self.gh_client.create_pull_request(
                        repo_name=repo_name,
                        title=pr_title,
                        body=pr_body,
                        head=branch_name,
                        base="main"
                    )
                    
                    if pr:
                        summary = f"### 📝 対応内容の要約\n\n{location_type} #{issue_number} に対して以下の対応を行い、自律的な修正と検証を完了しました：\n- **実装内容**: {issue_title}\n- **Pull Request**: {pr.html_url}"
                        await self.gh_client.post_comment(repo_name, issue_number, f"✅ 実装が完了し、プルリクエストを作成しました！\n\n{summary}" + get_footer())
                    else:
                        await self.gh_client.post_comment(repo_name, issue_number, "❌ 実装は完了しましたが、PR作成に失敗しました。" + get_footer())
            else:
                await self.gh_client.post_comment(repo_name, issue_number, "❌ 自律実装中にエラーが発生しました。ログを確認してください。" + get_footer())

        except Exception as e:
            logger.error(f"Task {task_id} failed with exception: {e}", exc_info=True)
            success = False
            await self.gh_client.post_comment(repo_name, issue_number, f"❌ 予期せぬエラーでタスクが中断されました: {e}" + get_footer())
        finally:
            stop_heartbeat.set()
            final_status = "Completed" if success else "Failed"
            await self.state.update_task(task_id, final_status, repo_name)
            active_label = "ai-active" if comment_id else "in-progress"
            await self.gh_client.remove_label(repo_name, issue_number, active_label)
            await self.gh_client.add_label(repo_name, issue_number, "completed" if success else "failed")
            logger.info(f"Task {task_id} cycle finished (Success: {success}, Status: {final_status}).")


    async def _send_heartbeat(self, stop_event: asyncio.Event):
        while not stop_event.is_set():
            await asyncio.sleep(10)

    async def _check_llm_health(self):
        """LLMサーバーの死活監視と自動起動"""
        base_url = self.config['llm']['endpoint'].replace("/v1", "")
        try:
            resp = await self.http_client.get(base_url + "/api/tags", timeout=5.0)
            if resp.status_code == 200:
                return
        except Exception:
            pass
        
        try:
            subprocess.Popen(["ollama", "serve"], 
                             stdout=subprocess.DEVNULL, 
                             stderr=subprocess.DEVNULL,
                             start_new_session=True)
            await asyncio.sleep(10)
        except Exception:
            pass
