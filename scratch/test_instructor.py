import asyncio
import sys
import os
from pydantic import BaseModel

# プロジェクトルートをパスに追加
sys.path.append(os.getcwd())

from src.core.validation.bridge import InstructorBridge

async def test_dynamic_generation():
    bridge = InstructorBridge()
    
    # ダミーの JSON Schema
    dummy_schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string", "description": "エージェントの名前"},
            "version": {"type": "integer", "description": "バージョン番号"},
            "capabilities": {"type": "array", "description": "利用可能な機能一覧"}
        },
        "required": ["name", "version"]
    }
    
    model = bridge.create_dynamic_model("AgentInfo", dummy_schema)
    
    print(f"Generated Model: {model}")
    print(f"Model Fields: {model.model_fields.keys()}")
    
    # インスタンス化テスト
    try:
        instance = model(name="TestAgent", version=1, capabilities=["coding", "browsing"])
        print(f"Instance: {instance}")
    except Exception as e:
        print(f"Instantiation failed: {e}")

if __name__ == "__main__":
    asyncio.run(test_dynamic_generation())
