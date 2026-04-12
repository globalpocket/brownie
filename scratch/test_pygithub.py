import os
import time
from github import Github, Auth
from dotenv import load_dotenv

load_dotenv()
token = os.getenv("GITHUB_TOKEN")

auth = Auth.Token(token)
g = Github(auth=auth, timeout=30) # retry=None を外してみる

print("Testing PyGithub connectivity...")
try:
    user = g.get_user()
    print(f"✅ Success! Logged in as: {user.login}")
    
    # リポジトリ取得テスト
    repo = g.get_repo("globalpocket/brownie-sampleproject")
    print(f"✅ Repository found: {repo.full_name}")
    
    # コメント取得テスト
    issue = repo.get_issue(1)
    comments = issue.get_comments()
    print(f"✅ Found {comments.totalCount} comments in issue #1")
    
except Exception as e:
    print(f"❌ PyGithub Error: {type(e).__name__}: {e}")
    import traceback
    traceback.print_exc()
