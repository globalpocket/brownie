import os
import logging
from huey import SqliteHuey

logger = logging.getLogger(__name__)

# プロジェクトルートの取得
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

# Huey (SQLite) の初期化
# 複数のプロセス（Orchestrator と Worker）が同じファイルを参照する
huey_db_path = os.path.join(PROJECT_ROOT, ".brwn", "huey.db")
os.makedirs(os.path.dirname(huey_db_path), exist_ok=True)

huey = SqliteHuey(filename=huey_db_path)

def get_huey():
    return huey
