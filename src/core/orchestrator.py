import asyncio
import os
import sys
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
from src.workspace.analyzer.core import CodeAnalyzer
from src.llm.model_manager import OllamaModelManager
import json
from fastmcp import Client
from fastmcp.client.transports.stdio import StdioTransport

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
        
        # モデル管理の初期化
        self.model_manager = OllamaModelManager(self.config['llm']['endpoint'].replace("/v1", ""))
        
        self.agent = CoderAgent(self.config, self.sandbox, self.state, self.gh_client, 
                               http_client=self.http_client, model_manager=self.model_manager)
        self.is_running = True
        self._knowledge_server_proc = None   # Knowledge MCP サブプロセス (Phase 2)
        self._workspace_server_proc = None   # Workspace MCP サブプロセス (Phase 3)

    async def start(self):
        """オーケストレーターの起動"""
        await self.state.connect()
        await self.state.reset_orphaned_tasks()
        asyncio.create_task(self.worker_pool.run()) # ワーカープール起動
        
        # 0. 起動初期化: 全リポジトリの深層解析 (WDCA)
        repo_list = self.config['agent'].get('repositories', [])
        workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
        
        # 解析には重量モデル (coder) を使用
        await self.model_manager.switch_model(self.config['llm']['models']['coder'])
        
        logger.info(f"BOOT SEQUENCE: Initializing Deep Context for {len(repo_list)} repositories...")
        for repo_name in repo_list:
            repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
            os.makedirs(repo_path, exist_ok=True)
            
            # リポジトリの同期
            logger.info(f"WDCA Phase 1: Ensuring repo is cloned: {repo_name}")
            await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
            
            # フルスキャン (同期待機)
            logger.info(f"WDCA Phase 2: Building symbol map for {repo_name}...")
            analyzer = CodeAnalyzer(repo_path)
            await analyzer.scan_project()
            analyzer.close()
            
        logger.info("BOOT SEQUENCE COMPLETED. Starting Knowledge MCP Server...")

        # Knowledge MCP Server の起動 (Phase 2)
        # 最初のリポジトリを対象として起動（複数リポ対応は将来の拡張）
        if repo_list:
            first_repo = repo_list[0]
            first_repo_path = os.path.join(workspace_base, first_repo.replace("/", "_"))
            memory_path = os.path.expanduser(self.config['database'].get('memory_path', '~/.local/share/brownie/vector_db'))
            os.makedirs(memory_path, exist_ok=True)

            await self._start_knowledge_server(first_repo_path, memory_path, first_repo)

        # Workspace MCP Server の起動 (Phase 3)
        if repo_list:
            first_repo = repo_list[0]
            first_repo_path = os.path.join(workspace_base, first_repo.replace("/", "_"))
            user_id = self.config['workspace']['sandbox_user_id']
            group_id = self.config['workspace']['sandbox_group_id']
            await self._start_workspace_server(first_repo_path, self.project_root, user_id, group_id)

        logger.info("All MCP Servers initialized. Entering main polling loop.")

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

        # Knowledge MCP Server の停止 (Phase 2)
        await self._stop_knowledge_server()

        # Workspace MCP Server の停止 (Phase 3)
        await self._stop_workspace_server()

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
        if existing_task and existing_task.get("status") != "Failed":
            return

        # 2. GitHub ラベルチェック (重複・完了・失敗ガード)
        labels = await self.gh_client.get_issue_labels(repo_name, issue_number)
        
        # 完了または失敗ラベルがついている場合は、原則としてキューイングしない
        # ただし、メンションベースのトリガー（指示あり）の場合は許容することも検討できるが、
        # 現状は一度 Failed になったら手動でラベルを消す運用とする（無限ループ防止を優先）
        if "completed" in labels or "failed" in labels:
            if user_login != "mention_trigger":
                # アサインベースの定期実行は完全停止
                return
            else:
                # メンションベースでも、前回の失敗から時間が経過していない場合はスキップ（二重起動防止）
                # ここでは安全のため、明示的にこれらラベルがある間はスキップを維持
                logger.info(f"Skipping task {task_id} because issue has 'completed' or 'failed' label.")
                return

        if user_login != "mention_trigger":
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
        
        # タスク開始フェーズ: router モデルへ切り替え
        await self.model_manager.switch_model(self.config['llm']['models']['router'])
        
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
                await self.gh_client.post_comment(repo_name, issue_number, f"🔍 {start_msg}" + get_footer())
                
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
                trigger_user = target_issue.user.login if hasattr(target_issue, 'user') else ""
                mention_prefix = f"@{trigger_user} " if trigger_user else ""
                await self.gh_client.post_comment(repo_name, issue_number, f"{mention_prefix}🔍 課題を確認しました。解析と作業を開始します..." + get_footer())
            
            branch_name = f"issue-{issue_number}"
            
            # 指示通り、実装前に重量モデル (coder) へ切り替える
            await self.model_manager.switch_model(self.config['llm']['models']['coder'])

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
                
            if success == True:
                has_changes = git_ops.has_changes()
                if is_mention and not has_changes:
                    pass # Summary will be handled in finally
                elif has_changes:
                    # サンドボックス上で変更が生じた場合のみ、ここで初めてブランチを切ってコミットする
                    git_ops.create_and_checkout_branch(branch_name)
                    
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
                        logger.info(f"[{task_id}] PR created: {pr.html_url}")
                else:
                    # メンションでない通常実行で、変更が発生しなかった場合
                    pass

            elif success == "SUSPENDED":
                pass # The summary will be posted in finally block
            else:
                pass # Failed case is handled by agent's error reporter

        except Exception as e:
            logger.error(f"Task {task_id} failed with exception: {e}", exc_info=True)
            success = False
            
            # オーナー取得処理を追加
            try:
                owner = await self.gh_client.get_repo_owner(repo_name)
                mention_prefix = f"@{owner} " if owner else ""
            except Exception:
                mention_prefix = ""
                
            await self.gh_client.post_comment(repo_name, issue_number, f"{mention_prefix}❌ 予期せぬエラーでタスクが中断されました: {e}" + get_footer())

        finally:
            stop_heartbeat.set()
            if success == "SUSPENDED":
                final_status = "Suspended"
            else:
                final_status = "Completed" if success else "Failed"
            
            # 最終要約の投稿 (Success or Suspended 時)
            if success in [True, "SUSPENDED"]:
                latest_task = await self.state.get_task(task_id)
                summary = latest_task.get('context', {}).get('final_summary') if latest_task else None
                if summary:
                    status_icon = "⏳ 一時中断（回答待ち）" if success == "SUSPENDED" else "✅ タスク完了"
                    msg = f"### {status_icon}\n\n{summary}"
                    await self.gh_client.post_comment(repo_name, issue_number, msg + get_footer())
            
            await self.state.update_task(task_id, final_status, repo_name)
            active_label = "ai-active" if comment_id else "in-progress"
            await self.gh_client.remove_label(repo_name, issue_number, active_label)
            
            if final_status == "Completed":
                await self.gh_client.add_label(repo_name, issue_number, "completed")
            elif final_status == "Failed":
                await self.gh_client.add_label(repo_name, issue_number, "failed")
            elif final_status == "Suspended":
                await self.gh_client.add_label(repo_name, issue_number, "waiting-for-user")
            
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

    # --- Knowledge MCP Server ライフサイクル管理 (Phase 2) ---

    async def _start_knowledge_server(self, repo_path: str, memory_path: str, repo_name: str):
        """Knowledge MCP Server を stdio サブプロセスとして起動し、Agent に MCP クライアントを注入"""
        try:
            logger.info(f"Starting Knowledge MCP Server for {repo_name}...")

            # サブプロセスとして起動
            # MCP クライアントの接続 (StdioTransport を明示的に使用)
            try:
                env = {**os.environ, "BROWNIE_TARGET_REPO": repo_name, "BROWNIE_REPO_PATH": repo_path, "BROWNIE_MEMORY_PATH": memory_path}
                if "PYTHONPATH" not in env:
                    env["PYTHONPATH"] = "."

                transport = StdioTransport(
                    command=sys.executable,
                    args=["-m", "src.mcp_server.knowledge_server", repo_path, memory_path, repo_name],
                    env=env,
                    cwd=self.project_root,
                    keep_alive=False # 切断時にプロセスを終了
                )
                mcp_client = Client(transport)
                await mcp_client.__aenter__()
                self.agent.knowledge_mcp_client = mcp_client
                logger.info(f"Knowledge MCP Server connected successfully via StdioTransport for {repo_name}")
            except Exception as e:
                logger.warning(f"MCP クライアント接続に失敗しました。フォールバックモードで動作します: {e}")
                self.agent.knowledge_mcp_client = None

        except Exception as e:
            logger.error(f"Knowledge MCP Server の起動に失敗しました: {e}")
            logger.info("Agent はフォールバックモード（直接呼び出し）で動作を継続します。")

    async def _stop_knowledge_server(self):
        """Knowledge MCP Server の停止"""
        if self.agent.knowledge_mcp_client:
            logger.info("Stopping Knowledge MCP Server...")
            try:
                await self.agent.knowledge_mcp_client.__aexit__(None, None, None)
            except Exception as e:
                logger.error(f"Error stopping Knowledge MCP Client: {e}")
            finally:
                self.agent.knowledge_mcp_client = None

    # --- Workspace MCP Server ライフサイクル管理 (Phase 3) ---

    async def _start_workspace_server(self, repo_path: str, reference_path: str, user_id: int, group_id: int):
        """Workspace MCP Server を stdio サブプロセスとして起動し、Agent に MCP クライアントを注入"""
        try:
            logger.info(f"Starting Workspace MCP Server: workspace={repo_path}")

            # Workspace MCP クライアントの接続 (StdioTransport を明示的に使用)
            try:
                env = {**os.environ, "BROWNIE_WORKSPACE_ROOT": repo_path, "BROWNIE_REFERENCE_ROOT": reference_path}
                if "PYTHONPATH" not in env:
                    env["PYTHONPATH"] = "."

                transport = StdioTransport(
                    command=sys.executable,
                    args=["-m", "src.mcp_server.workspace_server", repo_path, reference_path, str(user_id), str(group_id)],
                    env=env,
                    cwd=self.project_root,
                    keep_alive=False # 切断時にプロセスを終了
                )
                ws_client = Client(transport)
                await ws_client.__aenter__()
                self.agent.workspace_mcp_client = ws_client
                logger.info("Workspace MCP Server connected successfully via StdioTransport")
            except Exception as e:
                logger.warning(f"Workspace MCP クライアント接続に失敗。フォールバックモードで動作します: {e}")
                self.agent.workspace_mcp_client = None

        except Exception as e:
            logger.error(f"Workspace MCP Server の起動に失敗しました: {e}")
            logger.info("Agent はフォールバックモード（self.sandbox 直接呼び出し）で動作を継続します。")

    async def _stop_workspace_server(self):
        """Workspace MCP Server の停止"""
        if self.agent.workspace_mcp_client:
            logger.info("Stopping Workspace MCP Server...")
            try:
                await self.agent.workspace_mcp_client.__aexit__(None, None, None)
            except Exception as e:
                logger.error(f"Error stopping Workspace MCP Client: {e}")
            finally:
                self.agent.workspace_mcp_client = None
