# Blueprint: `src/core/state.py`

## 1. 責務 (Responsibility)
Brownie システムの永続的な状態管理を担当する。`SQLite` (aiosqlite) をバックエンドに使用し、タスクの進捗、実行結果、メタデータ（context）を管理する。システムのクラッシュ時や再起動時における「整合性の担保」と「リカバリー」を主要な役割とし、セントラルデーモンとしての信頼性を支える。

## 2. 復元要件 (Recreation Requirements for AI)
本モジュールを再実装する場合、以下のコントラクトを厳格に守ること。

### クラス: `StateManager`
**初期化引数:**
- `db_path` (str): SQLite データベースファイルへのパス（自動で `expanduser` とディレクトリ作成を行うこと）。

**主要メソッド:**
1. `async connect()`
   - **振る舞い**:
     1. DB接続を確立。
     2. パフォーマンスと堅牢性の両立のため `PRAGMA journal_mode=WAL`, `PRAGMA synchronous=NORMAL` を設定。
     3. `_check_integrity` 実行後、`_init_tables` で初期化。

2. `async _init_tables()`
   - **スキーマ**:
     - `tasks` テーブル: `id` (PK), `repo_full_name`, `issue_number`, `pr_number`, `status`, `context` (JSON), `updated_at`, `created_at`。
     - `metrics` テーブル: `key` (PK), `value`, `updated_at`。

3. `async update_task(task_id: str, status: str, repo_name: str, ...)`
   - **振る舞い**: `INSERT ... ON CONFLICT(id) DO UPDATE` を使用し、既存タスクの状態をアトミックに更新する。`context` 引数が渡された場合は JSON 形式にシリアライズして保存する。

4. `async get_task(task_id: str) -> Optional[Dict]`
   - **出力**: タスク情報を Python 辞書形式で返す。`context` カラムの内容は自動的に `json.loads` でパースすること。

5. `async get_active_tasks_for_issue(repo_name: str, issue_number: int) -> List[Dict]`
   - **振る舞い**: 同一リポジトリ/Issue 番号で status が `InProgress` または `InQueue` のタスクを全て取得する。多重実行の防止に利用される。

6. `async reset_orphaned_tasks()`
   - **リカバリー要件**: 起動時に実行される。`Completed`, `Failed`, `Suspended` 以外の（＝中断された可能性がある）全てのタスク状態を強制的に `Failed` にリセットする。

## 3. 依存関係 (Dependencies)
- 標準ライブラリ: `os`, `logging`, `json`, `pathlib`
- 外部依存: `aiosqlite`
