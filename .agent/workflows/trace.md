---
description: Brownie の最新の会話（プロンプト、ツール呼び出し、応答）を抽出して表示します。
---

1.  `logs/brownie.log` から最新の AI インタラクションを抽出します。
2.  ノイズ（httpcore, urllib3 等）を除去し、純粋な対話のみを時系列で表示します。

// turbo
3.  以下のコマンドを実行して最新のリポジトリ情報とトレースを取得します：
```bash
# 最新のリポジトリ情報を抽出
REPO_INFO=$(grep -a "ADK Agent starting for" logs/brownie.log | tail -n 1 | sed -E 's/.*starting for ([^#]+)#([0-9]+).*/\1 \2/')
REPO_NAME=$(echo $REPO_INFO | awk '{print $1}')
ISSUE_NUM=$(echo $REPO_INFO | awk '{print $2}')

if [ ! -z "$REPO_NAME" ]; then
  echo "--- 🎯 Current Task ---"
  echo "Repository: $REPO_NAME"
  echo "Issue URL:  https://github.com/$REPO_NAME/issues/$ISSUE_NUM"
  echo "-----------------------"
fi

# 最新の会話トレースを抽出
grep -E "AI Response:|Tool Call:|Tool Response:|ADK Agent starting with message:" logs/brownie.log | tail -n 50
```
