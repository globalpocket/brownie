# Blueprint: `src/workspace/analyzer/flow.py`

## 1. 責務 (Responsibility)
`FlowTracer` は、リポジトリ全体の **「処理フローの可視化と重要箇所の特定（NetworkX）」** を担当します。
- **コールグラフの構築**: `CodeAnalyzer` が作成したシンボルと呼び出し関係の情報を NetworkX グラフに変換。
- **急所の特定 (Criticality Analysis)**: 媒介中心性 (Betweenness Centrality) や出次数 (Out-Degree) を計算し、変更時の影響範囲が広い「急所」のコンポーネントを特定。
- **トレーサビリティの提供**: 特定のシンボルから始まる処理フローを追跡し、Mermaid シーケンス図として出力。

## 2. 復元要件 (Recreation Requirements for AI)

### クラス: `FlowTracer`

**初期化引数:**
- `db_path` (str): `CodeAnalyzer` が作成した DuckDB/SQLite ファイルへのパス。

**公開メソッド:**

1. `get_critical_dependencies(top_k=5) -> List[Dict]`
   - **振る舞い**: 
     - 全シンボルに対してグラフ理論的な中心性を計算。
     - 影響範囲の広さをスコア化し、上位 K 個のシンボルを返却。
   - **出力**: `{symbol, score, type}` のリスト。

2. `trace_flow(entry_symbol, max_depth=5) -> str`
   - **振る舞い**: 
     - `entry_symbol` を起点として幅優先探索（BFS）を行い、呼び出し階層を抽出。
     - 内部メソッド `_format_mermaid` を用いて、シーケンス図形式の Markdown を生成。

## 3. 依存関係 (Dependencies)
- **標準ライブラリ**: `logging`, `typing`
- **外部依存**: `networkx`, `duckdb`
