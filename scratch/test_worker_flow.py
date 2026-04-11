import asyncio
import sys
import os
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

# プロジェクトルートを追加
sys.path.append(os.getcwd())

from src.core.graph.builder import compile_workflow
from src.core.workers.pool import get_huey

async def verify_flow():
    # 1. データベースのクリーンアップ
    if os.path.exists(".brwn/checkpoints.db"):
        os.remove(".brwn/checkpoints.db")
    if os.path.exists(".brwn/huey.db"):
        os.remove(".brwn/huey.db")

    # 2. Huey の初期化 (テーブル作成)
    huey = get_huey()
    huey.storage.create_tables()

    # 3. Checkpointer の準備 (Async 版を使用)
    saver = AsyncSqliteSaver.from_conn_string(".brwn/checkpoints.db")
    
    try:
        async with saver as checkpointer:
            # checkpointer は instance
            app = compile_workflow(checkpointer=checkpointer)

            thread_id = "test-task-001"
            config = {"configurable": {"thread_id": thread_id}}

            print("--- Starting Workflow Run ---")
            initial_state = {
                "task_id": thread_id,
                "instruction": "Fix error in main.py",
                "repo_path": "/tmp/test-repo",
                "status": "InQueue"
            }

            # 3. ワークフロー開始
            # Note: 内部で astream が終わるときにフラグ管理される
            events = []
            async for event in app.astream(initial_state, config=config):
                events.append(event)
                for node, values in event.items():
                    print(f"Node: {node} | Status: {values.get('status')}")
                    if values.get('status') == "Waiting_Analysis":
                        print("Captured Waiting_Analysis. Node execution finished.")
            
            print("\n[Check] Phase 1 task should be in Huey queue.")
            huey = get_huey()
            pending = huey.pending()
            print(f"Pending tasks in Huey: {len(pending)}")
            
            # 4. ワーカーを手動で1回回して結果を書き戻す
            print("\n--- Simulating Worker Execution ---")
            if pending:
                task = pending[0]
                huey.execute(task)
            
            # 5. 再開テスト
            print("\n--- Resuming Workflow ---")
            # astream を再度呼ぶ。今度は input=None
            async for event in app.astream(None, config=config):
                for node, values in event.items():
                    print(f"Node: {node} | Status: {values.get('status')}")
                    if values.get('status') == "Phase1_Completed":
                        print("Successfully resumed and recognized analysis completion!")
    finally:
        # ここで確実にクローズ（aiosqlite の後始末）
        pass

if __name__ == "__main__":
    asyncio.run(verify_flow())
