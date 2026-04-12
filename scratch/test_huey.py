import os
import sys
# プロジェクトルートをパスに追加
sys.path.append(os.getcwd())

from src.core.workers.tasks import analysis_task
from src.core.workers.pool import huey

print(f"Using Huey DB: {huey.storage.filename}")

print("Enqueuing test task...")
res = analysis_task("test-task-id", "test-repo", 1, {"test": "payload"})
print(f"Task enqueued. Result object: {res}")
