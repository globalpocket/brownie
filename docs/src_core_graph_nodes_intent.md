# Blueprint: `src/core/graph/nodes/intent.py`

## 1. 責務 (Responsibility)
`intent_alignment_node` は、Brownie ワークフローの **Phase 0: Intent Alignment** を担当します。
- **意図の言語化**: ユーザーの曖昧な指示を、AI が評価可能な具体的な「評価軸（Evaluation Axes）」を含むドラフトに変換。
- **コンテキストの固定**: 最初期の状態を定義し、その後の全フェーズの基準となる「意図」をステートに記録。

## 2. 復元要件 (Recreation Requirements for AI)

### 関数: `intent_alignment_node(state: TaskState) -> Dict` (async)
- **入力**: 現在の `TaskState`。
- **振る舞い**: 
  1. ユーザーの `instruction` を読み取り、LLM を用いて `intent_draft` と `evaluation_axes` を生成。
  2. 初回実行時は `intent_confirmed = False` とし、ユーザーの反応を待つ状態にする。
  3. ステータスを `Phase0_Alignment` に更新。
- **出力**: 更新されたステートの差分。

## 3. 依存関係 (Dependencies)
- `src.core.graph.state.TaskState`
