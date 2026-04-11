# Blueprint: `src/version.py`

## 1. 責務 (Responsibility)
`version.py` は、システム全体の **「バージョン管理とトレーサビリティ」** を提供します。
- **ビルドIDの動的生成**: Git のコミットハッシュを利用して、実行中のコードがどのリビジョンに基づいているかを特定。
- **フッター生成**: GitHub コメントなどの外部出力に、トレーサビリティのための情報を付与。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `get_build_id() -> str`
- **振る舞い**: 
  1. `git rev-parse --short HEAD` を実行し、現在のコミットハッシュ（短縮版）を取得。
  2. Git コマンドが失敗した場合、またはリポジトリ環境でない場合は、ハードコードされた定数 `VERSION` を返す。

### 関数: `get_footer() -> str`
- **振る舞い**: 
  - `get_build_id()` を含む、GitHub コメント末尾に付加するための Markdown 文字列を生成。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `subprocess`, `os`
