# Blueprint: `src/mcp_server/workspace_server.py`

## 1. 責務 (Responsibility)
`WorkspaceServer` は、Brownie の **「手足（Execution Plane）」** として機能し、ファイル操作やコマンド実行を MCP ツールとして公開します。
- **セキュリティの継承**: `SandboxManager` を内部で利用し、リポジトリ外へのアクセス禁止や Docker 隔離などの防御層を透過的に提供。
- **検証機能の提供**: Semgrep や Linter を用いたコード品質・セキュリティの診断ツールをエージェントに提供。

## 2. 復元要件 (Recreation Requirements for AI)

### 公開ツール (MCP Tools)

1. `list_files(path, max_depth)`
   - 指定されたパスのディレクトリ構造を取得。大規模リポジトリ向けの階層探索をサポート。
2. `read_file(path)`
   - セキュアなパス解決を経て、ファイル内容を読み取る。
3. `write_file(path, content)`
   - ワークスペース内限定で、新規作成または上書きを実行。
4. `run_command(command)`
   - Docker コンテナ内でシェルコマンドを実行。非 Root ユーザー権限。
5. `lint_code(path) / format_code(path) / scan_security(path)`
   - 静的解析ツール（Semgrep, Black, Bandit 等）をコンテナ内で実行し、結果を返却。

### サーバー初期化
- コマンドライン引数 `--repo_path`, `--user_id`, `--group_id` を受け取り、内部の `SandboxManager` を適切に構成する。

## 3. 依存関係 (Dependencies)
- **外部依存**: `fastmcp.FastMCP`
- **内部依存**: `src.workspace.sandbox.SandboxManager`
