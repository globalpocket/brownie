import os
import logging
import json
from typing import Optional, Dict, Any, List
from pathlib import Path
from datetime import datetime

from sqlalchemy import MetaData, Table, Column, String, Integer, DateTime, JSON, select, update, delete, text
from sqlalchemy.ext.asyncio import create_async_engine, AsyncConnection
from sqlalchemy.dialects.sqlite import insert as sqlite_upsert

from src.version import get_build_id

logger = logging.getLogger(__name__)

# SQLAlchemy MetaData
metadata = MetaData()

# テーブル定義 (Core機能)
tasks_table = Table(
    "tasks",
    metadata,
    Column("id", String, primary_key=True),
    Column("repo_full_name", String, nullable=False),
    Column("issue_number", Integer),
    Column("pr_number", Integer),
    Column("status", String, nullable=False),
    Column("context", JSON),
    Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow),
    Column("created_at", DateTime, default=datetime.utcnow),
)

metrics_table = Table(
    "metrics",
    metadata,
    Column("key", String, primary_key=True),
    Column("value", String),
    Column("updated_at", DateTime, default=datetime.utcnow, onupdate=datetime.utcnow),
)

class StateManager:
    def __init__(self, db_path: str):
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        # SQLAlchemy Async Engine (aiosqlite をバックエンドに使用)
        self.engine = create_async_engine(f"sqlite+aiosqlite:///{self.db_path}")

    async def connect(self):
        """データベース接続と初期化を行う"""
        async with self.engine.begin() as conn:
            # WALモード設定 (設計書：整合性確保のため)
            await conn.execute(text("PRAGMA journal_mode=WAL"))
            await conn.execute(text("PRAGMA synchronous=NORMAL"))
            
            # 整合性チェック
            await self._check_integrity(conn)
            
            # テーブル作成
            await conn.run_sync(metadata.create_all)
            
        logger.info(f"State Database (SQLAlchemy Core) initialized at {self.db_path}")

    async def _check_integrity(self, conn: AsyncConnection):
        """OSクラッシュ等による Stale Lock の自動検知と復旧"""
        try:
            result = await conn.execute(text("PRAGMA integrity_check"))
            row = result.fetchone()
            if row and row[0] != "ok":
                logger.warning(f"Database integrity issue: {row[0]}")
        except Exception as e:
            logger.error(f"Failed to check database integrity: {e}")

    async def update_task(self, task_id: str, status: str, repo_name: str, 
                        issue_num: Optional[int] = None, pr_num: Optional[int] = None,
                        context: Optional[Dict[str, Any]] = None):
        """タスク状態の更新。contextが提供された場合は既存のものとマージする"""
        
        # 既存タスクを取得してコンテキストをマージ
        existing = await self.get_task(task_id)
        current_context = existing.get("context", {}) if existing else {}
        if context:
            current_context.update(context)
        current_context["version"] = get_build_id()

        async with self.engine.begin() as conn:
            stmt = sqlite_upsert(tasks_table).values(
                id=task_id,
                repo_full_name=repo_name,
                issue_number=issue_num,
                pr_number=pr_num,
                status=status,
                context=current_context,
                updated_at=datetime.utcnow()
            ).on_conflict_do_update(
                index_elements=["id"],
                set_={
                    "status": status,
                    "context": current_context,
                    "updated_at": datetime.utcnow()
                }
            )
            await conn.execute(stmt)

    async def update_task_status(self, task_id: str, status: str):
        """コンテキストを維持したままステータスのみを更新する"""
        async with self.engine.begin() as conn:
            stmt = update(tasks_table).where(tasks_table.c.id == task_id).values(
                status=status,
                updated_at=datetime.utcnow()
            )
            await conn.execute(stmt)

    async def get_task(self, task_id: str) -> Optional[Dict[str, Any]]:
        """タスクの取得"""
        async with self.engine.connect() as conn:
            stmt = select(tasks_table).where(tasks_table.c.id == task_id)
            result = await conn.execute(stmt)
            row = result.fetchone()
            if row:
                return dict(row._asdict())
        return None

    async def get_active_tasks_for_issue(self, repo_name: str, issue_number: int) -> List[Dict[str, Any]]:
        """指定された Issue に対して実行中、待機中、または確認待ちのタスクをすべて取得する"""
        async with self.engine.connect() as conn:
            stmt = select(tasks_table).where(
                tasks_table.c.repo_full_name == repo_name,
                tasks_table.c.issue_number == issue_number,
                tasks_table.c.status.in_(['InProgress', 'InQueue', 'WaitingForClarification'])
            )
            result = await conn.execute(stmt)
            return [dict(row._asdict()) for row in result.fetchall()]

    async def get_latest_task_for_issue(self, repo_name: str, issue_number: int) -> Optional[Dict[str, Any]]:
        """指定された Issue に対して最後に更新されたタスクを取得する"""
        async with self.engine.connect() as conn:
            stmt = select(tasks_table).where(
                tasks_table.c.repo_full_name == repo_name,
                tasks_table.c.issue_number == issue_number
            ).order_by(tasks_table.c.updated_at.desc()).limit(1)
            result = await conn.execute(stmt)
            row = result.fetchone()
            if row:
                return dict(row._asdict())
        return None

    async def reset_orphaned_tasks(self):
        """起動時に中断ステータス以外の仕掛品を Suspended にリセットする"""
        async with self.engine.begin() as conn:
            stmt = update(tasks_table).where(
                tasks_table.c.status.notin_(['Completed', 'Failed', 'Suspended', 'WaitingForClarification'])
            ).values(status='Suspended', updated_at=datetime.utcnow())
            await conn.execute(stmt)
        logger.info("Orphaned or stale tasks transitioned to Suspended status for automatic recovery.")

    async def update_task_context(self, task_id: str, context: Dict[str, Any]):
        """タスクのcontext（サマリー等）のみを部分更新する"""
        current_task = await self.get_task(task_id)
        if current_task is None:
            return

        current_context = (current_task.get("context") or {})
        current_context.update(context)
        current_context["version"] = get_build_id()

        async with self.engine.begin() as conn:
            stmt = update(tasks_table).where(tasks_table.c.id == task_id).values(
                context=current_context,
                updated_at=datetime.utcnow()
            )
            await conn.execute(stmt)

    async def close(self):
        """エンジンをクローズする"""
        await self.engine.dispose()
