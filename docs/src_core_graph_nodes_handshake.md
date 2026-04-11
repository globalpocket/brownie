# Blueprint: `src/core/graph/nodes/handshake.py`

## 1. 責務 (Responsibility)
`dynamic_handshake_node` は、Brownie ワークフローの **Phase 2: Dynamic Discovery & Handshake** を担当します。
- **エージェントの発見と合意**: 解析フェーズで得られた知識を基に、どの専門家（Executor）に、どのスキーマ（インターフェース）で仕事を頼むべきかを動的に決定。
- **実行計画の確定**: 実行フェーズ（Phase 3）へ渡すための具体的な `validated_plan` を構築。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `dynamic_handshake_node(state: TaskState) -> Dict` (async)
- **振る舞い**: 
  1. 解析結果（`analysis_data`）を読み取り、実行に必要な MCP サーバーやツールセット、専門家エージェントを特定。
  2. エージェントが期待する入力形式（スキーマ）とタスクの整合性をチェック（ハンドシェイク）。
  3. ステータスを `Phase2_HandshakeDone` に更新。

## 3. 依存関係 (Dependencies)
- `src.core.graph.state.TaskState`
