import asyncio
import os
import json
import yaml
import pytest
import shutil
from pathlib import Path
from unittest.mock import AsyncMock, patch, MagicMock

import respx
from httpx import Response

from src.core.orchestrator import Orchestrator
from src.gh_platform.client import GitHubClientWrapper

# --- Constants & Paths ---
TEST_DATA_DIR = Path(__file__).parent / "test_data"
TMP_REPO_PATH = TEST_DATA_DIR / "tmp_repo"
TMP_CONFIG_PATH = TEST_DATA_DIR / "tmp_config.yaml"
TMP_DB_PATH = TEST_DATA_DIR / "tmp_brownie.db"
TMP_MEMORY_PATH = TEST_DATA_DIR / "tmp_memory"
TMP_WORKSPACE_BASE = TEST_DATA_DIR / "tmp_workspaces"

# --- Fixtures ---

@pytest.fixture
def mock_repo_env():
    """テスト用のダミーリポジトリと環境設定を作成"""
    if TEST_DATA_DIR.exists():
        shutil.rmtree(TEST_DATA_DIR, ignore_errors=True)
    
    TEST_DATA_DIR.mkdir(parents=True, exist_ok=True)
    TMP_REPO_PATH.mkdir(parents=True, exist_ok=True)
    TMP_WORKSPACE_BASE.mkdir(parents=True, exist_ok=True)
    TMP_MEMORY_PATH.mkdir(parents=True, exist_ok=True)
    
    (TMP_REPO_PATH / "README.md").write_text("# Mock Repo\nThis is a mock repository for E2E testing.")
    (TMP_REPO_PATH / "src").mkdir(exist_ok=True)
    (TMP_REPO_PATH / "src/main.py").write_text("print('hello world')")

    config = {
        "database": {
            "db_path": str(TMP_DB_PATH),
            "memory_path": str(TMP_MEMORY_PATH)
        },
        "workspace": {
            "base_dir": str(TMP_WORKSPACE_BASE),
            "sandbox_user_id": os.getuid(),
            "sandbox_group_id": os.getgid()
        },
        "llm": {
            "endpoint": "http://localhost:11434/v1",
            "models": {
                "router": "llama3.1:8b",
                "coder": "qwen3-coder:30b",
                "reviewer": "llama3.1:8b"
            }
        },
        "agent": {
            "repositories": ["test-user/test-repo"],
            "polling_interval_sec": 1,
            "max_llm_retries": 3,
            "max_auto_retries": 10,
            "mention_name": "@brownie",
            "inference_priority": {
                "manual_issue": 10
            }
        }
    }
    
    with open(TMP_CONFIG_PATH, "w") as f:
        yaml.dump(config, f)
    
    yield config

@pytest.mark.asyncio
async def test_mcp_lifecycle_and_agent_dispatch(mock_repo_env):
    """MCP サーバーのライフサイクルと、Agent によるツール呼び出しの E2E 検証"""
    
    # 1. GitHub Client のモック化
    mock_gh = MagicMock(spec=GitHubClientWrapper)
    mock_gh.get_issues_to_process = AsyncMock(return_value=[])
    mock_gh.ensure_repo_cloned = AsyncMock()
    mock_gh.add_label = AsyncMock()
    mock_gh.remove_label = AsyncMock()
    mock_gh.post_comment = AsyncMock()
    mock_gh.get_repo_owner = AsyncMock(return_value="test-user")
    mock_gh.get_my_username = MagicMock(return_value="brownie")
    
    # 2. LLM 応答のモック化 (respx)
    mock_responses = [
        # 1: Intent Analysis
        {
            "category": "DIAGNOSTICS",
            "goal": "リポジトリ調査",
            "constraints": [],
            "initial_action_suggestion": "get_repo_summary"
        },
        # 2: ReAct Step 1
        {
            "thought": "概要を取得します。",
            "action": {"tool": "get_repo_summary", "parameters": {}}
        },
        # 3: ReAct Step 2 (Finish decision)
        {
            "thought": "完了します。",
            "action": {"tool": "Finish", "parameters": {"reason": "Test done"}}
        },
        # 4: Summary Generation
        {
            "summary": "E2Eテストは正常に終了しました。"
        }
    ]
    
    with respx.mock:
        # Ollama API Mocks
        respx.post("http://localhost:11434/api/chat").mock(return_value=Response(200, json={"status": "success"}))
        
        chat_route = respx.post("http://localhost:11434/v1/chat/completions")
        chat_route.side_effect = [
            Response(200, json={"choices": [{"message": {"content": json.dumps(mock_responses[0])}}]}),
            Response(200, json={"choices": [{"message": {"content": json.dumps(mock_responses[1])}}]}),
            Response(200, json={"choices": [{"message": {"content": json.dumps(mock_responses[2])}}]}),
            Response(200, json={"choices": [{"message": {"content": json.dumps(mock_responses[3])}}]})
        ]

        # 3. Initialization
        with patch('src.core.orchestrator.GitHubClientWrapper', return_value=mock_gh), \
             patch('src.core.orchestrator.CodeAnalyzer'):
            
            orchestrator = Orchestrator(str(TMP_CONFIG_PATH))
            await orchestrator.state.connect()
            
            # 4. Starting MCP
            repo_name = "test-user/test-repo"
            repo_path = str(TMP_REPO_PATH)
            await orchestrator._start_knowledge_server(repo_path, str(TMP_MEMORY_PATH), repo_name)
            await orchestrator._start_workspace_server(repo_path, orchestrator.project_root, os.getuid(), os.getgid())
            
            assert orchestrator.agent.knowledge_mcp_client is not None
            assert orchestrator.agent.workspace_mcp_client is not None
            
            # 5. Execution
            task_id = f"{repo_name}#1"
            success = await orchestrator.agent.plan_and_execute(
                task_id=task_id,
                repo_name=repo_name,
                issue_number=1,
                issue_title="E2E Test",
                issue_body="調査",
                is_mention=False,
                location_type="ISSUE",
                location_context={},
                instruction_priority=None
            )
            
            assert success is True

            # 6. Stop
            await orchestrator._stop_knowledge_server()
            await orchestrator._stop_workspace_server()
            assert orchestrator.agent.knowledge_mcp_client is None
            assert orchestrator.agent.workspace_mcp_client is None

if __name__ == "__main__":
    pytest.main([__file__, "-v", "-s"])
