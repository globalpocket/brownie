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
        self._initialized_repos = set()

    async def start(self):
        """オーケストレーターの起動"""
        await self.state.connect()
        from src.version import get_build_id
        self.process_build_id = get_build_id()
        logger.info(f"Orchestrator starting. Build ID: {self.process_build_id}")
        
        # 起動時に仕掛品タスクがあれば異常終了としてマーク（リカバリロジック）
        await self.state.reset_orphaned_tasks()
        self.worker_task = asyncio.create_task(self.worker_pool.run())
        
        logger.info("BOOT SEQUENCE COMPLETED. Dynamic Repo Management enabled. Entering main polling loop.")

        # メインポーリングループ
        try:
            while self.is_running:
                try:
                    # 全プロジェクトを対象としたグローバルメンション検索
                    exclude_list = self.config['agent'].get('exclude_repositories', [])
                    all_mentions = await self.gh_client.get_mentions_to_process()
                    
                    for m in all_mentions:
                        target_repo = m['repo_name']
                        if target_repo in exclude_list:
                            logger.info(f"SKIP: Mention in excluded repository: {target_repo}")
                            continue
                            
                        task_id = f"{target_repo}#{m['number']}:{m['comment_id']}"
                        await self._queue_if_needed(task_id, target_repo, m['number'], "mention_trigger")
                    
                    await self._check_llm_health()
                    self.sandbox.cleanup_orphans()
                    # config で指定された間隔で待機
                    await asyncio.sleep(self.config['agent']['polling_interval_sec'])
                except GitHubRateLimitException as e:
                    wait_seconds = int(e.reset_at - time.time()) + 60
                    logger.warning(f"HIBERNATION MODE: Captured GitHub rate limit. Sleeping for {wait_seconds}s...")
                    await asyncio.sleep(wait_seconds)
                except Exception as e:
                    logger.error(f"Orchestrator error: {e}", exc_info=True)
                    await asyncio.sleep(10)
        finally:
            logger.info("Orchestrator shutting down. Cleaning up resources...")
            self.worker_pool.stop()
            if hasattr(self, 'worker_task'):
                self.worker_task.cancel()
                try:
                    await self.worker_task
                except asyncio.CancelledError:
                    pass
            
            await self.http_client.aclose()
            await self.mcp_manager.stop_all()
            logger.info("Orchestrator cleanup completed.")

    async def _ensure_repo_context(self, repo_name: str):
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
            task_id = f"{repo_name}#{m['number']}:{m['comment_id']}"
            await self._queue_if_needed(task_id, repo_name, m['number'], "mention_trigger")

    async def _queue_if_needed(self, task_id: str, repo_name: str, issue_number: int, user_login: str):
        active_tasks = await self.state.get_active_tasks_for_issue(repo_name, issue_number)
        
        # すでに実行中またはキューにある場合はスキップ
        if any(t['status'] in ['InProgress', 'InQueue'] for t in active_tasks):
            return

        # 待機中のタスクがある場合、新しいメンションがあれば「再開」として処理する
        waiting_task = next((t for t in active_tasks if t['status'] == 'WaitingForClarification'), None)
        
        existing_task = await self.state.get_task(task_id)
        if existing_task:
            status = existing_task.get("status")
            if status == "Failed":
                # バージョン比較による再開ロジック
                from src.version import get_build_id
                context = existing_task.get("context") or {}
                recorded_version = context.get("version")
                current_version = get_build_id()
                
                if recorded_version != current_version:
                    logger.info(f"RESUMING: Task {task_id} failed on version {recorded_version}. Retrying on {current_version}")
                    # Failed なので、そのまま新規タスクとしてキューイング（後続の処理へ）
                else:
                    logger.info(f"SKIP: Task {task_id} already failed on current version {current_version}")
                    return
            else:
                 # すでにそのコメントIDでの処理が成功/待機中/実行中の場合はスキップ
                 return

        # 再開（Resurrection）ロジック
        if waiting_task:
            logger.info(f"Resurrecting task {waiting_task['id']} for issue {repo_name}#{issue_number} due to trigger {task_id}")
            # トリガーとなったタスクID（コメントID）を記録し、同じコメントで何度も再開しないようにする
            await self.state.update_task(task_id, "TriggeredResurrection", repo_name, issue_num=issue_number)
            
            # 待機中のタスクを InQueue に戻す (IDは元のままでよいが、新しい指示を含めるために更新)
            await self.state.update_task(waiting_task['id'], "InQueue", repo_name)
            priority = self.config['agent']['inference_priority']['manual_issue']
            # 新しいコメントIDを context に保存して再開時に読めるようにする
            await self.state.update_task_context(waiting_task['id'], {"resume_comment_id": task_id.split(":")[-1]})
            await self.worker_pool.add_task(waiting_task['id'], priority, self._execute_task, waiting_task['id'], repo_name, issue_number)
            return

        labels = await self.gh_client.get_issue_labels(repo_name, issue_number)
        if "completed" in labels and "ai-active" not in labels: return

        if user_login != "mention_trigger":
            if "in-progress" in labels: return
            if not await self.gh_client.check_rbac(repo_name, user_login): return

        logger.info(f"Queueing new task: {task_id}")
        await self.state.update_task(task_id, "InQueue", repo_name, issue_num=issue_number)
        priority = self.config['agent']['inference_priority']['manual_issue']
        await self.worker_pool.add_task(task_id, priority, self._execute_task, task_id, repo_name, issue_number)

    async def _execute_task(self, task_id: str, repo_name: str, issue_number: int):
        """タスク実行実体 (新アーキテクチャ統合版)"""
        from src.version import get_build_id
        if get_build_id() != self.process_build_id:
            logger.warning(f"ZOMBIE TASK PREVENTED: Task {task_id} belongs to a stale process. Aborting.")
            return

        # リポジトリのオンデマンド構成 (Lazy Initialization)
        await self._ensure_repo_context(repo_name)

        # 初期化 (UnboundLocalError 防止のため関数の冒頭で確実に行う)
        active_label = None
        success = False
        repo_path = None
        comment_id = None
        
        if ":" in task_id:
            _, suffix = task_id.split(":", 1)
            comment_id = suffix

        await self.state.update_task(task_id, "InProgress", repo_name)
        stop_heartbeat = asyncio.Event()
        
        # 各タスクごとにクリーンな MCP マネージャーとコンテキストを使用
        async with MCPServerManager(self.project_root) as task_mcp_manager:
            try:
                asyncio.create_task(self._send_heartbeat(stop_heartbeat))
                
                # 1. コンテキスト作成 (オンデマンド・クローン)
                workspace_base = self.config['workspace'].get('base_dir', "/tmp/brownie_workspace")
                repo_path = os.path.join(workspace_base, repo_name.replace("/", "_"))
                os.makedirs(repo_path, exist_ok=True)
                
                # デフォルトブランチを動的に取得
                repo = self.gh_client.g.get_repo(repo_name)
                default_branch = repo.default_branch
                
                await self.gh_client.ensure_repo_cloned(repo_name, repo_path)
                
                # WDCA を強制実行して最新のシンボルマップを構築
                from src.workspace.analyzer.core import CodeAnalyzer
                logger.info(f"WDCA: Refreshing symbol map for {repo_name}...")
                analyzer = CodeAnalyzer(repo_path)
                await analyzer.scan_project()
                analyzer.close()
                
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
                
                # パターン1: メンション認識時の受付確認
                # すでに active_label が付いている場合は再受理コメントを避ける（オプション）
                await self.gh_client.post_comment(repo_name, issue_number, "承知いたしました。作業を開始します。" + get_footer())
                
                # コンテキストから再開用コメントIDを取得
                current_task_row = await self.state.get_task(task_id)
                resume_comment_id = (current_task_row.get('context') or {}).get('resume_comment_id')
                
                instruction_priority = None
                if resume_comment_id:
                    # 再開時の指示
                    instruction_priority = await self.gh_client.get_comment_body(repo_name, issue_number, resume_comment_id)
                    instruction_priority = f"【再開指示】ユーザーから以下の回答がありました。不確実性が解消されたか評価し、完了していればブループリントを出力してください:\n\n{instruction_priority}"
                elif comment_id and comment_id != "body":
                    instruction_priority = await self.gh_client.get_comment_body(repo_name, issue_number, comment_id)

                task_description = f"Title: {target_issue.title}\n\nBody: {target_issue.body or ''}"
                if instruction_priority:
                    task_description += f"\n\nAdditional Instructions: {instruction_priority}"

                success = await task_agent.run(
                    task_id=task_id, repo_name=repo_name, issue_number=issue_number,
                    repo_path=repo_path, task_description=task_description,
                    is_resume=bool(resume_comment_id)
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
                        git_ops.create_and_checkout_branch(branch_name, default_branch)
                        git_ops.commit_and_push(branch_name, f"feat: automated implementation for #{issue_number}")
                        await self.gh_client.create_pull_request(
                            repo_name=repo_name, title=f"Fix #{issue_number}: {target_issue.title}",
                            body=f"## 概要\n#{issue_number} に対する自動実装PRです。",
                            head=branch_name, base=default_branch
                        )

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

## 関連ソースファイル
{files_str if files_str else "不詳"}

## 対応策（推論）
コードの修正、あるいは環境の再構築が必要な可能性があります。

---
**エラーログ全文:**
{stack_trace}
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

