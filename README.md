# BROWNIE: Agent-Friendly Engineering Environment

BROWNIE（ブラウニー）は、AI エージェントが自律的にソフトウェア開発の全工程（調査・設計・実装・検証・PR作成）を完結させるために最適化された、次世代のエンジニアリング環境です。

GitHub Issue をハブとし、人間と AI が自然言語で協働する **「Pull-based Autonomous Engineering」** を実現します。

---

## 💎 最大の特徴: Agent-Friendly Architecture

BROWNIE の設計思想は、「人間にとっての使いやすさ」を超え、**「AI エージェントが迷わず、安全に、確実な成果を出すこと」** に特化しています。

### 1. High Locality (境界の集約)
AI が直面する「複雑なパストラバーサルの恐怖」と「コンテキストの欠如」を構造的に解決しました。`WorkspaceContext` がすべてのパス解決とセキュリティ境界を一元管理。AI はリポジトリルートからの相対パスのみを意識すればよく、環境差異というノイズから解放されます。

### 2. Explicit Tools (明示的なコントラクト)
ツールの誤用やハルシネーションを極限まで抑制します。すべてのツールは、Pydantic AI を用いた厳格な型定義と、AI 向けの「設計意図」が記述された Docstring を持ち、エージェントは自らの「手」の機能を正確に把握できます。

### 3. Robust Infrastructure (堅牢なプロセス管理)
`MCPServerManager` による鉄壁のプロセス制御。タスクごとに独立した MCP サーバー群を起動し、AnyIO を用いた確実なクリーンアップを行うことで、ゾンビプロセスやリソース競合を完全に排除します。

### 4. Meta-Cognition (自己診断能力)
エージェントは自らの実行状態やコンテキストを客観的に把握する能力（`get_agent_context`）を持っています。エラー発生時には自己診断を行い、プロジェクト環境の不整合を自律的に修復するループ（Self-Healing）を回します。

---

## 🏗 アーキテクチャ概要 (Overview)

BROWNIE は、以下の 3 つのプレーンに分離された疎結合なマイクロサービス構成を採用しています。

- **🧠 Control Plane (Orchestrator & Agent)**: LangGraph によるワークフロー制御と、Planner-Executor パターンによる高度な意思決定。
- **💾 Perception Plane (Knowledge MCP Server)**: AST 解析 (DuckDB) と 依存関係グラフ (NetworkX) による、リポジトリの「空間的」把握。
- **🛠 Execution Plane (Workspace MCP Server & Sandbox)**: Docker 隔離環境内での全副作用の実行と検証。

---

## 📚 資産としての設計書 (Blueprints)

BROWNIE の各コンポーネントは、AI がシステムを再構築・拡張できるレベルの **「厳密な設計書（Blueprint）」** を備えています。

- **Core**: [Orchestrator](docs/src_core_orchestrator.md) | [Agent](docs/src_core_agent.md) | [Workflow](docs/src_core_workflow.md)
- **Workspace**: [Context](docs/src_workspace_context.md) | [Sandbox](docs/src_workspace_sandbox.md) | [GitOps](docs/src_workspace_git_ops.md)
- **Analysis**: [CodeAnalyzer](docs/src_workspace_analyzer_core.md) | [FlowTracer](docs/src_workspace_analyzer_flow.md)
- **Infrastructure**: [MCPServerManager](docs/src_mcp_server_manager.md) | [WorkspaceServer](docs/src_mcp_server_workspace_server.md) | [KnowledgeServer](docs/src_mcp_server_knowledge_server.md)

---

## 🚀 クイックスタート

### 1. セットアップ
```bash
./bin/setup.sh
```

### 2. 起動 (Orchestrator & Worker)
```bash
./bin/brwn start
```

BROWNIE は、AI が「ただの道具」ではなく「自律的なチームメンバー」として機能するための、最も信頼できる基盤を提供します。
