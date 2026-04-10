import asyncio
import os
import sys
from src.core.orchestrator import Orchestrator

async def force_trigger():
    # プロジェクトルートをパスに追加
    sys.path.append(os.getcwd())
    
    orc = Orchestrator('config/config.yaml')
    await orc.state.connect()
    
    repo_name = 'globalpocket/brownie-sampleproject'
    issue_number = 1
    
    print(f"--- Force Triggering {repo_name}#{issue_number} ---")
    
    # 最新のコメントを取得
    try:
        repo = orc.gh_client.g.get_repo(repo_name)
        issue = repo.get_issue(issue_number)
        comments = list(issue.get_comments())
        if not comments:
             print("No comments found. Using issue body.")
             comment_id = "body"
             user_login = issue.user.login
        else:
             last_comment = comments[-1]
             comment_id = str(last_comment.id)
             user_login = last_comment.user.login
             
        task_id = f"{repo_name}#{issue_number}:{comment_id}"
        print(f"Target Task ID: {task_id} (User: {user_login})")
        
        # 既存の失敗状態を掃除
        if orc.state.conn:
            await orc.state.conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            await orc.state.conn.commit()
        
        # キューイング
        await orc._queue_if_needed(task_id, repo_name, issue_number, user_login)
        print("Successfully queued task into Orchestrator.")
        
    except Exception as e:
        print(f"Force trigger failed: {e}")

if __name__ == "__main__":
    asyncio.run(force_trigger())
