# Blueprint: `src/workspace/git_ops.py`

## 1. 責務 (Responsibility)
`GitOperations` は、Brownie の **「Git 基盤操作」と「履歴の整合性確保」** を担当します。
- **レジリエンス (回復力)**: タスク再開時（Resume）の `pull --rebase` による最新状態の強制同期。
- **トピックブランチ管理**: 修正対象ごとに独立したブランチを作成し、メインブランチを汚染せずに PR の土台を準備。
- **安全性**: Race Condition を防ぐための SHA 検証や、不必要な空コミットの防止。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `GitOperations`

**初期化引数:**
- `repo_path` (str): Git 操作の対象となるリポジトリの絶対パス。

**公開メソッド:**

1. `pull_rebase(branch) -> None`
   - **振る舞い**: 
     - ユーザーが手動で Issue を更新したりコードを修正したりした場合に備え、`git pull --rebase` を実行。
     - AI の作業ベースを常に最新かつクリーンに保つ。

2. `create_and_checkout_branch(branch_name, base_branch) -> None`
   - **振る舞い**: 
     - ベースブランチ（通常は `main`）を最新に更新し、そこから新規ブランチを作成。
     - 既存の同名ブランチがある場合は強制的に削除して再作成（クリーンビルドの徹底）。

3. `commit_and_push(branch, message) -> None`
   - **振る舞い**: 
     - `git status` で変更の有無を確認し、変更がある場合のみコミット。
     - トピックブランチに対して `--force` プッシュを行い、PR を最新の実装案に更新。

4. `fuzzy_ast_replace(file_path, target, replacement) -> None`
   - **振る舞い**: 
     - AI が生成したコード片と元のファイルの差分を、単純な文字列置換だけでなく正規表現（Fuzzy）を用いて吸収しながら置換。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `subprocess`, `os`, `re`
