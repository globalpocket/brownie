import sys
import os

# プロジェクトルートをパスに追加
sys.path.append(os.getcwd())

from src.core.graph.builder import compile_workflow

def test_compile():
    try:
        app = compile_workflow()
        print("Successfully compiled the LangGraph workflow.")
        print(f"Nodes: {app.nodes.keys()}")
    except Exception as e:
        print(f"Failed to compile: {e}")
        sys.exit(1)

if __name__ == "__main__":
    test_compile()
