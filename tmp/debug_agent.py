import asyncio
import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

# プロジェクトルートをパスに追加
sys.path.append(str(Path(__file__).parent.parent))

# モック化して依存関係を回避
from src.core.agent import CoderAgent

async def debug():
    print("Initializing mocked components...")
    
    # 依存オブジェクトを最小限にモック
    sandbox = MagicMock()
    state = MagicMock()
    gh_client = MagicMock()
    
    # 必要最低限の設定
    config = {
        'llm': {
            'models': {'coder': 'ollama/llama3'}, 
            'endpoint': 'http://localhost:11434/v1'
        },
        'workspace': {'base_dir': '/tmp/brownie_workspace'}
    }
    
    print("Initializing CoderAgent...")
    agent = CoderAgent(config, sandbox, state, gh_client=gh_client)
    
    print("Starting agent.run()...")
    try:
        # 内部で self.runner.run_async(...) が呼ばれるはず
        success = await agent.run(
            task_id="debug_task",
            repo_name="globalpocket/brownie",
            issue_number=37,
            task_description="Title: TEST\n\nBody: このプログラムについて教えて"
        )
        print(f"Agent execution finished. Success: {success}")
    except Exception as e:
        print(f"CRITICAL ERROR in debug script: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(debug())
