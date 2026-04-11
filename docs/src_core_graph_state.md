# Blueprint: `src/core/graph/state.py`

## 1. 責務 (Responsibility)
`TaskState` は、Brownie の全ライフサイクルを貫く **「共有メモリ」** の定義です。
- **データ構造の定義**: 5つのフェーズ（Intent, Analysis, Handshake, Execution, Governance）で必要となるすべての情報を一元管理。
- **トレーサビリティ**: `history` フィールドにより、どのノードがいつ実行されたかの証跡を保持。
- **永続化の基礎**: LangGraph のチェックポインタがシリアライズ・デシリアライズする際の型定義を提供。

## 2. 復元要件 (Recreation Requirements for AI)

### 型定義: `TaskState` (TypedDict)

**主要フィールド:**

- **初期情報**:
  - `task_id` (str): リポジトリ名#Issue番号 (例: `owner/repo#1`)。
  - `instruction` (str): ユーザーからの元々の指示。
  - `status` (str): 現在の状態を示す予約名。
  
- **フェーズ別の成果物**:
  - `evaluation_axes` (List[str]): Phase 0 で合意された評価指標。
  - `analysis_data` (Dict): Phase 1 の解析結果（シンボル依存関係等）。
  - `agent_specific_schemas` (Dict): Phase 2 で特定された、実行エージェントの動的スキーマ。
  - `execution_logs` (List[Dict]): Phase 3 の実装プロセスの記録。
  - `ringi_document` (str): Phase 4 で人間に提示される稟議書の Markdown。
  
- **制御フラグ**:
  - `governance_decision` (str): 'Approve', 'Reject' などの人間の決定。
  - `has_changes` (bool): コード修正が行われたか。

- **メタ情報**:
  - `history` (Annotated[List[Dict], operator.add]): 各ノード実行時の履歴。リストが累積されるように `operator.add` を指定。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `operator`, `typing`
