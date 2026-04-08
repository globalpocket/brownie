# Blueprint: `src/core/state.py`

## 1. 責務 (Responsibility)
`StateManager` は、BROWNIE の長期記憶と実行状態を管理します。SQLite をバックエンドに使用し、アプリケーションのクラッシュや再起動を跨いでタスクの整合性を維持することを目的としています。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `StateManager`

**初期化引数:**
- `db_path` (str): SQLite データベースファイルへのパス。

**公開メソッド:**

1. `connect() -> None` (Async)
   - **振る舞い**: データベースに接続し、` journal_mode=WAL` を有効化して並行性を高めます。初回起動時はテーブル作成と整合性チェック (`_check_integrity`) を行います。
2. `update_task(task_id, status, repo_name, ...) -> None` (Async)
   - **振る舞い**: `INSERT OR REPLACE` ロジックを用いて、タスクのメイン状態 (InProgress, Completed 等) を更新します。
3. `update_task_context(task_id, context_delta) -> None` (Async)
   - **入力**: タスクID、更新したいコンテキストの差分 (Dict)。
   - **振る舞い**: 保存されている JSON 型の `context` を読み込み、新しい値をマージしてから保存し直します。
4. `reset_orphaned_tasks() -> None` (Async)
   - **振る舞い**: 起動時に実行中だったタスク (未完了のもの) を一括して `Failed` 状態へ遷移させ、システムの健全性を回復します。

### データコントラクト
- `tasks` テーブル: `id`, `status`, `context` (JSON), `updated_at` 等。
- `status` 定義: `InQueue`, `InProgress`, `Completed`, `Failed`, `Suspended`。

## 3. 依存関係 (Dependencies)
- **外部**: `aiosqlite`, `json`, `pathlib`, `logging`
