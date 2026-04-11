# Blueprint: `src/workspace/analyzer/core.py`

## 1. 責務 (Responsibility)
`CodeAnalyzer` は、リポジトリの **「高度な構造解析（AST Parsing）」** を担当します。
- **シンボル抽出**: Tree-sitter を用いて、多言語（Python, JS/TS, Go）のソースコードからクラス、関数、メソッド、および関数呼び出しを抽出。
- **インデックス管理**: 解析結果をハッシュ値と共に SQLite (DuckDB) に保存し、変更があったファイルのみを効率的に再解析。
- **言語非依存の抽象化**: 異なるプログラミング言語の構文差を吸収し、統一された形式でシンボル情報をデータベース化。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `CodeAnalyzer`

**初期化引数:**
- `repo_root` (str): 解析対象リポジトリの絶対パス。
- `db_path` (Optional[str]): インデックス情報を保存する SQLite/DuckDB ファイルパス。

**公開メソッド:**

1. `scan_project() -> None` (async)
   - **振る舞い**: 
     - リポジトリ内を再帰的にスキャン。
     - 特定の拡張子（`.py`, `.js`, `.ts`, `.go`）を持つファイルを識別。
     - ファイルの変更（ハッシュ値）をチェックし、`_scan_file` を実行。

2. `_scan_file(full_path, rel_path) -> None` (内部/重要)
   - **振る舞い**: 
     - 対応する Tree-sitter パーサを呼び出し、抽象構文木を作成。
     - 言語固有のクエリ（S-expression）を実行し、シンボル定義と呼び出し関係を抽出。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `sqlite3`, `hashlib`, `os`, `asyncio`
- **外部依存**: `tree_sitter`, `tree_sitter_python`, `tree_sitter_javascript`, `tree_sitter_typescript`, `tree_sitter_go`
