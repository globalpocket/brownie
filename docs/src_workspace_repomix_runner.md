# Blueprint: `src/workspace/repomix_runner.py`

## 1. 責務 (Responsibility)
`RepomixRunner` は、AI エージェントがプロジェクト全体の構造とコンテキストを効率的に把握するための **「プロジェクト情報のパッキングと階層化探索（Discovery）」** を担当します。
- **コンテキストの集約**: リポジトリ内の複数のファイルを 1 つの Markdown または JSON にまとめ、LLM が一度のコンテキストウィンドウで全体像を理解できるように最適化。
- **ノイズ除去**: ドキュメント、Wiki、Git 履歴などの推論には直接関係ないパスをフィルタリングし、モデル崩壊やトークンの浪費を防止。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `RepomixRunner`

**初期化引数:**
- `repo_path` (str): 解析対象リポジトリの絶対パス。

**公開メソッド:**

1. `run_discovery(exclude_patterns=None) -> str`
   - **振る舞い**: 
     - `npx repomix` を実行し、リポジトリ全体の内容を集約した一時ファイルを作成。
     - 既定の除外パターン (`docs/**`, `wiki/**`, `.git/**`) を適用。
   - **出力**: 集約されたテキストデータ。

2. `ast_summarize(file_path) -> str`
   - **振る舞い**: 
     - tree-sitter 等を用いて、指定されたファイルのクラス、関数、メソッドの定義のみを抽出し、簡潔なサマリーを生成。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `subprocess`, `os`
- **外部依存**: `npx repomix` (Node.js runtime required)
