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
from datetime import datetime, timedelta

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger

from src.core.state import StateManager
from src.core.worker_pool import WorkerPool
from src.core.agent import CoderAgent
from src.gh_platform.client import GitHubClientWrapper, GitHubRateLimitException, GitHubConnectionException
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
        self.worker_pool = WorkerPool(self.project_root)
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
        self._initialized_repos = set()
        
        # APScheduler の初期化
        self.scheduler = AsyncIOScheduler()
        self.polling_job_id = "github_mention_polling"

    async def start(self):
        """オーケストレーターの起動"""
        await self.state.connect()
        from src.version import get_build_id
        self.process_build_id = get_build_id()
        logger.info(f"Orchestrator starting. Build ID: {self.process_build_id}")
        
        # 起動時に仕掛品タスクがあれば異常終了ではなく「中断」としてマーク（再起動後の自動復旧対応）
        await self.state.reset_orphaned_tasks()
        
        # Taskiq ブローカーのステートに自身を登録 (Transparent DI)
        self.worker_pool.broker.state.orchestrator = self
        
        self.worker_task = asyncio.create_task(self.worker_pool.run())
        
        # 中断中のタスクがあれば自動的に再開
        await self._resurrect_suspended_tasks()
        
        # メンション監視ジョブの登録 (設計書に基づきインターバルジョブ化)
        self.scheduler.add_job(
            self._poll_mentions_job,
            IntervalTrigger(seconds=self.config['agent']['polling_interval_sec']),
            id=self.polling_job_id,
            max_instances=1,
            coalesce=True
        )
        self.scheduler.start()
        
        logger.info("BOOT SEQUENCE COMPLETED. APScheduler started. Entering idle state.")

        # プロセスを維持するための待機
        try:
            while self.is_running:
                await asyncio.sleep(1)
        except (KeyboardInterrupt, asyncio.CancelledError):
            pass
        finally:
            await self.shutdown()

    async def shutdown(self):
        """オーケストレーターのクリーンアップ"""
        logger.info("Orchestrator shutting down. Cleaning up resources...")
        self.is_running = False
        self.scheduler.shutdown()
        
        await self.worker_pool.stop()
        if hasattr(self, 'worker_task'):
            self.worker_task.cancel()
            try:
                await self.worker_task
            except asyncio.CancelledError:
                pass
        
        await self.http_client.aclose()
        await self.mcp_manager.stop_all()
        logger.info("Orchestrator cleanup completed.")

    async def _poll_mentions_job(self):
        """APScheduler によって実行されるメンションポ−リングジョブ"""
        try:
            # 全プロジェクトを対象としたグローバルメンション検索
            exclude_list = self.config['agent'].get('exclude_repositories', [])
            all_mentions = await self.gh_client.get_mentions_to_process()
            
            for m in all_mentions:
                target_repo = m['repo_name']
                if target_repo in exclude_list:
                    logger.info(f"SKIP: Mention in excluded repository: {target_repo}")
                    continue
                    
                task_id = f"{target_repo}#{m['number']}"
                await self._queue_if_needed(task_id, target_repo, m['number'], "mention_trigger", comment_id=str(m['comment_id']))
            
            await self._check_llm_health()
            self.sandbox.cleanup_orphans()
        except GitHubRateLimitException as e:
            await self._handle_rate_limit(e)
        except GitHubConnectionException as e:
            logger.error(f"Network error detected: {e}")
            # ネットワークエラー時はリトライを待機
        except Exception as e:
            logger.error(f"Orchestrator job error: {e}", exc_info=True)

    async def _handle_rate_limit(self, e: GitHubRateLimitException):
        """スケジューラーの機能を用いた GitHub Rate Limit (冬眠) の制御"""
        wait_seconds = int(e.reset_at - time.time()) + 60
        logger.warning(f"HIBERNATION MODE: Rate limit hit. Pausing polling job for {wait_seconds}s...")
        
        await self._update_hibernation_status("RateLimit", e.reset_at)
        
        # ジョブの一時停止
        self.scheduler.pause_job(self.polling_job_id)
        
        # 再開時刻の設定
        resume_time = datetime.fromtimestamp(e.reset_at + 60)
        
        # 一度だけ実行される再開ジョブを登録
        self.scheduler.add_job(
            self._resume_polling_job,
            'date',
            run_date=resume_time
        )

    async def _resume_polling_job(self):
        """冬眠からの復帰"""
        logger.info("HIBERNATION END: Resuming polling job.")
        self.scheduler.resume_job(self.polling_job_id)
        await self._update_hibernation_status(None)
        # 復旧時に中断タスクをチェック
        await self._resurrect_suspended_tasks()

    async def _ensure_repo_context(self, repo_name: str):
        """リポジトリのオンデマンド構成（クローン・解析）を実行する"""
        if repo_name in self._initialized_repos:
            return
            
        repo_path = os.path.join(self.project_root, "workspaces", repo_name.replace("/", "_"))
        await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
        
        # 解析の実行 (設計書 6.2)
        analyzer = CodeAnalyzer(repo_path)
        # 解析は時間がかかる場合があるため、Orchestratorレベルで一度だけ実行
        await analyzer.scan_project()
        
        self._initialized_repos.add(repo_name)

    async def _update_hibernation_status(self, reason: Optional[str], reset_at: float = 0):
        """冬眠状態を外部ファイルに保存する (CLI表示用)"""
        status_file = "/tmp/brownie_hibernation.json"
        if reason is None:
            if os.path.exists(status_file):
                try: os.remove(status_file)
                except: pass
            return

        try:
            with open(status_file, "w") as f:
                json.dump({
                    "reason": reason,
                    "wake_up_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(reset_at)) if reset_at > 0 else "Network Recovery",
                    "reset_at": reset_at,
                    "timestamp": time.time()
                }, f)
        except Exception as e:
            logger.error(f"Failed to write hibernation status: {e}")

    async def _hibernate_network(self):
        """ネットワークエラーによる一時中断モード"""
        logger.warning("Entering NETWORK HIBERNATION MODE. Waiting for connectivity...")
        await self._update_hibernation_status("NetworkError")
        
        wait_interval = 300 # 5分
        while self.is_running:
            try:
                # ヘルスチェック: 自分のユーザー名が取れれば復旧とみなす
                logger.info("Network Health Check: Contacting GitHub API...")
                self.gh_client.get_my_username() 
                logger.info("Network connectivity RESTORED. Resuming operations.")
                break
            except Exception:
                logger.warning(f"Network still down. Retrying health check in {wait_interval}s...")
                await asyncio.sleep(wait_interval)
        
        await self._update_hibernation_status(None)
        # 接続復旧時に中断中のタスクを即座に再開
        await self._resurrect_suspended_tasks()

    async def _resurrect_suspended_tasks(self):
        """Suspended 状態のタスクを自動的に WorkPool に再投入する (レジューム)"""
        try:
            # DBから現在 Suspended なタスクの一覧を直接取得したいが、StateManager に専用メソッドがないため簡易的に全検索またはステータスベースで処理
            # 今回は get_task をループするのではなく、SQLを直接叩くか、state.py を拡張するのがスマート。
            # ひとまず state.py に get_tasks_by_status を追加する。
            suspended_tasks = await self._get_pending_tasks_for_resurrection()
            if not suspended_tasks:
                return

            logger.info(f"RESUME: Found {len(suspended_tasks)} suspended tasks. Resurrecting...")
            for t in suspended_tasks:
                task_id = t['id']
                repo_name = t['repo_full_name']
                issue_number = t['issue_number']
                
                await self.state.update_task_status(task_id, "InQueue")
                priority = self.config['agent']['inference_priority']['manual_issue']
                await self.worker_pool.add_task(task_id, priority, repo_name, issue_number)
                logger.info(f"  - Task {task_id} re-queued.")
        except Exception as e:
            logger.error(f"Failed to resurrect suspended tasks: {e}")

    async def _get_pending_tasks_for_resurrection(self) -> List[Dict[str, Any]]:
        """再開待ちのタスクをDBから取得する"""
        query = "SELECT * FROM tasks WHERE status = 'Suspended'"
        async with self.state.conn.execute(query) as cursor:
            rows = await cursor.fetchall()
            results = []
            for row in rows:
                results.append({
                    "id": row[0],
                    "repo_full_name": row[1],
                    "issue_number": row[2],
                    "status": row[4]
                })
            return results
        """リポジトリのオンデマンド構成（クローン・解析）を実行する"""
        if repo_name in self._initialized_repos:
            return

        workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
        repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
        
        logger.info(f"DYNAMIC DISCOVERY: Initializing context for {repo_name}...")
        os.makedirs(repo_path, exist_ok=True)
        await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
        
        logger.info(f"WDCA: Building symbol map for {repo_name}...")
        analyzer = CodeAnalyzer(repo_path)
        await analyzer.scan_project()
        analyzer.close()
        
        self._initialized_repos.add(repo_name)
        logger.info(f"DYNAMIC DISCOVERY: Context for {repo_name} is now ready.")

    async def _poll_repository(self, repo_name: str):
        """リポジトリの最新状態を確認し、タスクをキューイングする (DEPRECATED: start内でのグローバル検索に移行)"""
        mentions = await self.gh_client.get_mentions_to_process(repo_name)
        for m in mentions:
            task_id = f"{repo_name}#{m['number']}"
            await self._queue_if_needed(task_id, repo_name, m['number'], "mention_trigger", comment_id=str(m['comment_id']))

    async def _queue_if_needed(self, task_id: str, repo_name: str, issue_number: int, user_login: str, comment_id: Optional[str] = None):
        existing_task = await self.state.get_task(task_id)
        
        if existing_task:
            status = existing_task.get("status")
            # すでに実行中またはキューにある場合はスキップ
            if status in ['InProgress', 'InQueue']:
                return

            # 再開（Resurrection）ロジック: Completed, WaitingForClarification, Failed 等から InQueue に戻す
            logger.info(f"Resurrecting task {task_id} for issue {repo_name}#{issue_number} due to new trigger (Status: {status})")
            
            # 再開用コメントIDを context に保存して再開時に読めるようにする
            if comment_id:
                await self.state.update_task_context(task_id, {"resume_comment_id": comment_id})
            
            await self.state.update_task_status(task_id, "InQueue")
            priority = self.config['agent']['inference_priority']['manual_issue']
            await self.worker_pool.add_task(task_id, priority, repo_name, issue_number)
            return

        labels = await self.gh_client.get_issue_labels(repo_name, issue_number)
        if user_login != "mention_trigger":
            if "in-progress" in labels: return
            if not await self.gh_client.check_rbac(repo_name, user_login): return

        logger.info(f"Queueing new task: {task_id}")
        await self.state.update_task(task_id, "InQueue", repo_name, issue_num=issue_number)
        if comment_id:
            await self.state.update_task_context(task_id, {"trigger_comment_id": comment_id})
            
        priority = self.config['agent']['inference_priority']['manual_issue']
        await self.worker_pool.add_task(task_id, priority, repo_name, issue_number)

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (新アーキテクチャ統合版)"""
        # リポジトリのオンデマンド構成 (Lazy Initialization)
        await self._ensure_repo_context(repo_name)

        # 初期化 (UnboundLocalError 防止のため関数の冒頭で確実に行う)
        active_label = None
        success = False
        repo_path = None
        comment_id = None
        
        # task_id は {repo}#{issue} 形式。トリガーとなったコメントIDはコンテキストから取得。
        current_task_row = await self.state.get_task(task_id)
        task_context = current_task_row.get('context') or {} if current_task_row else {}
        
        resume_comment_id = task_context.get('resume_comment_id')
        trigger_comment_id = task_context.get('trigger_comment_id')
        comment_id = resume_comment_id or trigger_comment_id or "body"

        # コンテキスト（resume_comment_id等）を保持したまま実行中に移行
        await self.state.update_task_status(task_id, "InProgress")
        stop_heartbeat = asyncio.Event()
        
        # 各タスクごとにクリーンな MCP マネージャーとコンテキストを使用
        async with MCPServerManager(self.project_root) as task_mcp_manager:
            try:
                asyncio.create_task(self._send_heartbeat(stop_heartbeat))
                
                # 1. コンテキスト作成 (オンデマンド・クローン)
                workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
                repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
                os.makedirs(repo_path, exist_ok=True)
                
                # 対象ブランチの特定 (Issue か PR か)
                repo = self.gh_client.g.get_repo(repo_name)
                default_branch = repo.default_branch
                target_issue = repo.get_issue(issue_number)
                target_branch = default_branch
                
                if target_issue.pull_request:
                    try:
                        pr = target_issue.as_pull_request()
                        # PR の head ブランチ（最新のコミットがあるブランチ）を取得
                        # 他のリポジトリからのPR（フォーク）の場合は一旦考慮外とするが、
                        # 同じリポジトリ内のブランチであれば pr.head.ref で取得可能。
                        if pr.head.repo and pr.head.repo.full_name == repo_name:
                            target_branch = pr.head.ref
                            logger.info(f"Target is a Pull Request. Switching to branch: {target_branch}")
                    except Exception as e:
                        logger.warning(f"Failed to get PR details, falling back to default branch: {e}")

                # 最新状態を pull (fetch & reset --hard)
                await self.gh_client.ensure_repo_cloned(repo_name, repo_path, branch_name=target_branch)
                
                # WDCA を強制実行して最新のシンボルマップを構築
                from src.workspace.analyzer.core import CodeAnalyzer
                logger.info(f"WDCA: Refreshing symbol map for {repo_name}...")
                analyzer = CodeAnalyzer(repo_path)
                await analyzer.scan_project()
                analyzer.close()
                
                ws_context = WorkspaceContext(repo_path, self.project_root)
                self.sandbox.context = ws_context
                
                # --- LangGraph ワークフローの反映 (Step 2: 稟議モデル) ---
                from src.core.workflow import TaskWorkflow
                from langgraph.checkpoint.sqlite import SqliteSaver
                
                checkpoint_path = os.path.join(self.project_root, ".brwn", "checkpoints.db")
                os.makedirs(os.path.dirname(checkpoint_path), exist_ok=True)
                
                async with SqliteSaver.from_conn_string(checkpoint_path) as checkpointer:
                    workflow = TaskWorkflow(self.config, self.project_root)
                    app = workflow.compile(checkpointer=checkpointer)
                    config = {"configurable": {"thread_id": task_id}}
                    
                    state = await app.aget_state(config)
                    
                    if not state.values:
                        # 初回: 分析とプラン策定まで実行 (approve_wait の直前で interrupt)
                        initial_state = {
                            "task_id": task_id,
                            "repo_name": repo_name,
                            "issue_number": issue_number,
                            "repo_path": repo_path,
                            "instruction": target_issue.body or "",
                            "history": []
                        }
                        async for _ in app.astream(initial_state, config=config): pass
                    else:
                        # 再開: ユーザーからの回答を反映
                        resume_body = ""
                        if resume_comment_id:
                            resume_body = await self.gh_client.get_comment_body(repo_name, issue_number, resume_comment_id)
                        
                        await app.aupdate_state(config, {
                            "is_approved": any(kw in resume_body.lower() for kw in ["承認", "ok", "proceed", "go"]),
                            "user_feedback": resume_body if not any(kw in resume_body.lower() for kw in ["承認", "ok", "proceed", "go"]) else None
                        })
                        async for _ in app.astream(None, config=config): pass

                    # 状態確認: 中断中か完了か
                    state = await app.aget_state(config)
                    if state.next and "approve_wait" in state.next:
                        # 稟議書を GitHub に投稿
                        plan_msg = f"## 🛠 実行計画（稟議）\n\n分析に基づき、以下のプランを策定しました。承認される場合は「承認」または「OK」とコメントしてください。\n\n{state.values.get('plan', '')}\n\n### コード構造解析結果 (NetworkX)\n```mermaid\n{state.values.get('context_mermaid', '')}\n```"
                        await self.gh_client.post_comment(repo_name, issue_number, plan_msg + get_footer())
                        success = "WAITING"
                        return 

                # 実行フェーズへの移行 (app.astream完了後)
                task_description = f"Plan: {state.values.get('plan')}\n\nIssue Body: {target_issue.body}"
                
                # 2. MCP サーバー起動
                memory_path = os.path.expanduser(self.config['database'].get('memory_path', '~/.local/share/brownie/vector_db'))
                memory_db_path = os.path.expanduser(self.config['database'].get('memory_db_path', '~/.local/share/brownie/memory.db'))
                
                sqlite_client = await task_mcp_manager.start_sqlite_server(memory_db_path)
                kn_client = await task_mcp_manager.start_knowledge_server(repo_path, memory_path, repo_name)
                ws_client = await task_mcp_manager.start_workspace_server(
                    repo_path, self.project_root, 
                    self.config['workspace']['sandbox_user_id'], 
                    self.config['workspace']['sandbox_group_id']
                )

                task_agent = CoderAgent(
                    self.config, self.sandbox, self.state, self.gh_client,
                    knowledge_mcp_client=kn_client,
                    workspace_mcp_client=ws_client,
                    sqlite_mcp_client=sqlite_client,
                    workspace_context=ws_context
                )

                success = await task_agent.run(
                    task_id=task_id, repo_name=repo_name, issue_number=issue_number,
                    repo_path=repo_path, task_description=task_description,
                    is_resume=bool(resume_comment_id)
                )
                
                if success is False:
                    raise Exception("Agent exited without completing the task.")

                # 5. Git 操作 (成功時のみ)
                if success is True:
                    from src.workspace.git_ops import GitOperations
                    git_ops = GitOperations(repo_path)
                    if git_ops.has_changes():
                        branch_name = f"issue-{issue_number}"
                        git_ops.create_and_checkout_branch(branch_name, default_branch)
                        git_ops.commit_and_push(branch_name, f"feat: automated implementation for #{issue_number}")
                        await self.gh_client.create_pull_request(
                            repo_name=repo_name, title=f"Fix #{issue_number}: {target_issue.title}",
                            body=f"## 概要\n#{issue_number} に対する自動実装PRです。",
                            head=branch_name, base=default_branch
                        )

            except GitHubConnectionException as e:
                logger.warning(f"Task {task_id} suspended due to connection failure: {e}")
                success = "SUSPENDED"
            except Exception as e:
                import traceback
                from src.version import get_build_id
                
                logger.error(f"Task {task_id} failed: {e}", exc_info=True)
                success = False
                current_version = get_build_id()
                stack_trace = traceback.format_exc()
                
                # エラー報告用の詳細ログ作成
                repo_url = f"https://github.com/{repo_name}"
                issue_url = f"{repo_url}/issues/{issue_number}"
                error_report_repo = os.getenv("BROWNIE_REPO_NAME", "globalpocket/brownie")
                
                # スタックトレースから関連ファイルを抽出（簡易版）
                related_files = list(set([line.split('"')[1] for line in stack_trace.splitlines() if 'File "' in line and "python" not in line.lower()]))
                files_str = "\n".join([f"- `{f}`" for f in related_files])

                error_body = f"""## エラー概要
- **対象タスク**: `{task_id}`
- **発生バージョン**: `{current_version}`
- **実行リポジトリ**: [{repo_name}]({repo_url})
- **対応Issue**: [#{issue_number}]({issue_url})

## 原因と詳細説明
```text
{str(e)}
```

### スタックトレース
```python
{stack_trace}
```
"""
                try:
                    await self.gh_client.create_issue(
                        repo_name=error_report_repo,
                        title=f"[BUG] Task Failure: {repo_name}#{issue_number} ({current_version})",
                        body=error_body
                    )
                except Exception as ie:
                    logger.error(f"Failed to report error issue: {ie}")

                await self.gh_client.post_comment(
                    repo_name, issue_number, 
                    f"❌ 予期せぬエラーが発生したため作業を中断しました。エラーの詳細は `{error_report_repo}` に報告されました。" + get_footer()
                )
            finally:
                stop_heartbeat.set()
                final_status = "WaitingForClarification" if success == "WAITING" else ("Suspended" if success == "SUSPENDED" else ("Completed" if success is True else "Failed"))
                
                if success in [True, "SUSPENDED", "WAITING"]:
                    latest_task = await self.state.get_task(task_id)
                    summary = (latest_task.get('context') or {}).get('final_summary') if latest_task else None
                    if summary:
                        # 二重投稿防止ガードレール
                        is_duplicate = False
                        
                        # A. メモリ内トラッキング（同一実行サイクル内）
                        if hasattr(task_agent, 'last_manual_comment') and task_agent.last_manual_comment:
                            if summary.strip() == task_agent.last_manual_comment.strip():
                                is_duplicate = True
                        
                        # B. GitHub 履歴チェック（表記揺れを許容する正規化比較）
                        if not is_duplicate:
                            last_bot_body = await self.gh_client.get_last_bot_comment(repo_name, issue_number)
                            if last_bot_body:
                                # フッターとヘッダーを除去して正規化
                                normalized_last = last_bot_body.split("---")[0].strip()
                                # 記号や空白を除いて「意味的な文字の並び」だけで比較
                                import re
                                def clean(text): return re.sub(r'[^\w\s]', '', text).replace('\n', '').replace(' ', '')
                                if clean(summary) == clean(normalized_last):
                                    is_duplicate = True
                        
                        if is_duplicate:
                            logger.info(f"[{task_id}] Skip final comment to avoid duplication.")
                        else:
                            status_icons = {"WAITING": "⏳ 確認待ち", "SUSPENDED": "⏳ 中断", True: "✅ 完了"}
                            status_icon = status_icons.get(success, "✅ 完了")
                            await self.gh_client.post_comment(repo_name, issue_number, f"### {status_icon}\n\n{summary}" + get_footer())
                
                await self.state.update_task(task_id, final_status, repo_name)
                if active_label:
                    await self.gh_client.remove_label(repo_name, issue_number, active_label)
                
                # failed ラベルの自動付与はスキップ（再開ロジックのため）
                if final_status.lower() != "failed":
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

