# Blueprint: `src/workspace/context.py`

## 1. 責務 (Responsibility)
`WorkspaceContext` は、Brownie の設計原則である **「High Locality（境界の集約）」** を実現する中核コンポーネントです。
- **パス解決の一元化**: AI エージェントが操作する相対パスを、セキュアな絶対パスに変換。
- **セキュリティ境界の防衛**: Path Traversal などの脆弱性を構造的に遮断し、許可されたディレクトリ（`root_path` および `reference_path`）外へのアクセスを禁止。
- **情報の正規化**: 絶対パスを AI にとって理解しやすい相対パスに逆変換。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `WorkspaceContext`

**初期化引数:**
- `root_path` (str): 書き換え可能かつ優先的に解決されるルートディレクトリ。
- `reference_path` (Optional[str]): 読み取り専用の参照用ディレクトリ（ライブラリソースなど）。

**公開メソッド:**

1. `resolve_path(target_path, strict=True) -> Path`
   - **振る舞い**: 
     - 渡された `target_path` を `root_path` 基点で解決。
     - `strict=True` の場合、解決後のパスが `root_path`（または `reference_path`）の内側にあるか厳格にチェック。
   - **例外発生**: 境界外へのアクセス（Path Traversal）が検出された場合、`PermissionError` を発行。

2. `get_relative_path(absolute_path) -> str`
   - **振る舞い**: 
     - 絶対パスを `root_path` 基点の相対パスに変換する。
     - AI への出力（ファイル一覧の提示等）の際に、環境固有の情報を隠蔽するために使用。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `os`, `pathlib.Path`
