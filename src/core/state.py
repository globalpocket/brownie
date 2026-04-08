import os
import aiosqlite
import logging
from typing import Optional, Dict, Any, List
from pathlib import Path

logger = logging.getLogger(__name__)

class StateManager:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn: Optional[aiosqlite.Connection] = None

    async def connect(self):
        """データベース接続とWALモードの有効化、テーブル初期化を行う"""
        self.conn = await aiosqlite.connect(self.db_path)
        # WALモード設定 (設計書：完全自律デーモン、整合性確保のため)
        await self.conn.execute("PRAGMA journal_mode=WAL")
        await self.conn.execute("PRAGMA synchronous=NORMAL")
        
        # Stale Lockのチェック (設計書 4. 状態管理)
        await self._check_integrity()
        
        await self._init_tables()
        logger.info(f"State Database initialized at {self.db_path}")

    async def _check_integrity(self):
        """OSクラッシュ等による Stale Lock の自動検知と復旧"""
        try:
            # 整合性チェック実行
            async with self.conn.execute("PRAGMA integrity_check") as cursor:
                row = await cursor.fetchone()
                if row and row[0] != "ok":
                    logger.warning(f"Database integrity issue: {row[0]}")
                    # 簡易的な復旧試行（実際にはバックアップからの復旧などが望ましいが、要件に従い自動検知）
        except Exception as e:
            logger.error(f"Failed to check database integrity: {e}")

    async def _init_tables(self):
        """必要なテーブルの作成"""
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS tasks (
                id TEXT PRIMARY KEY,
                repo_full_name TEXT NOT NULL,
                issue_number INTEGER,
                pr_number INTEGER,
                status TEXT NOT NULL,
                context JSON,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS metrics (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await self.conn.commit()

    async def update_task(self, task_id: str, status: str, repo_name: str, 
                        issue_num: Optional[int] = None, pr_num: Optional[int] = None,
                        context: Optional[Dict[str, Any]] = None):
        """タスク状態の更新"""
        import json
        await self.conn.execute("""
            INSERT INTO tasks (id, repo_full_name, issue_number, pr_number, status, context, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(id) DO UPDATE SET
                status=excluded.status,
                context=COALESCE(excluded.context, tasks.context),
                updated_at=CURRENT_TIMESTAMP
        """, (task_id, repo_name, issue_num, pr_num, status, json.dumps(context) if context else None))
        await self.conn.commit()

    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """タスクの取得"""
        async with self.conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)) as cursor:
            row = await cursor.fetchone()
            if row:
                import json
                return {
                    "id": row[0],
                    "repo_full_name": row[1],
                    "issue_number": row[2],
                    "pr_number": row[3],
                    "status": row[4],
                    "context": json.loads(row[5]) if row[5] else None,
                    "updated_at": row[6],
                    "created_at": row[7]
                }
        return None

    async def get_active_tasks_for_issue(self, repo_name: str, issue_number: int) -> List[Dict[str, Any]]:
        """指定された Issue に対して実行中または待機中のタスクをすべて取得する (設計書 4. 状態管理)"""
        query = "SELECT * FROM tasks WHERE repo_full_name = ? AND issue_number = ? AND status IN ('InProgress', 'InQueue')"
        async with self.conn.execute(query, (repo_name, issue_number)) as cursor:
            rows = await cursor.fetchall()
            results = []
            for row in rows:
                import json
                results.append({
                    "id": row[0],
                    "repo_full_name": row[1],
                    "issue_number": row[2],
                    "pr_number": row[3],
                    "status": row[4],
                    "context": json.loads(row[5]) if row[5] else None,
                    "updated_at": row[6],
                    "created_at": row[7]
                })
            return results

    async def get_latest_task_for_issue(self, repo_name: str, issue_number: int) -> Optional[Dict[str, Any]]:
        """指定された Issue に対して最後に実行されたタスク（状態問わず）を取得する"""
        query = "SELECT * FROM tasks WHERE repo_full_name = ? AND issue_number = ? ORDER BY updated_at DESC LIMIT 1"
        async with self.conn.execute(query, (repo_name, issue_number)) as cursor:
            row = await cursor.fetchone()
            if row:
                import json
                return {
                    "id": row[0],
                    "repo_full_name": row[1],
                    "issue_number": row[2],
                    "pr_number": row[3],
                    "status": row[4],
                    "context": json.loads(row[5]) if row[5] else None,
                    "updated_at": row[6],
                    "created_at": row[7]
                }
        return None

    async def reset_orphaned_tasks(self):
        """起動時に終了ステータス ('Completed', 'Failed', 'Suspended') 以外で残っているタスクを Failed にリセットする (リカバリー)"""
        query = "UPDATE tasks SET status = 'Failed' WHERE status NOT IN ('Completed', 'Failed', 'Suspended')"
        await self.conn.execute(query)
        await self.conn.commit()
        logger.info("Orphaned or stale tasks reset to Failed during startup recovery.")

    async def update_task_context(self, task_id: str, context: Dict[str, Any]):
        """タスクのcontext（サマリー等）のみを部分更新する"""
        import json
        
        # 現在のコンテキストを取得
        current_task = await self.get_task(task_id)
        if current_task is None:
            return

        # 既存のコンテキストとマージ
        current_context = (current_task.get("context") or {})
        current_context.update(context)

        await self.conn.execute("""
            UPDATE tasks 
            SET context = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        """, (json.dumps(current_context), task_id))
        await self.conn.commit()

    async def close(self):
        if self.conn:
            await self.conn.close()
