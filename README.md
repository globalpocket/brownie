<div align="center">

![BROWNIE Banner](file:///Users/satoshitanaka/.gemini/antigravity/brain/d6b5cc59-c155-40c3-ad36-d7a6967bf15e/brownie_banner_modern_1775898089950.png)

# 🍪 BROWNIE
### The Autonomous Engineering Environment Built for Agents

[![Status](https://img.shields.io/badge/status-active-success.svg)]()
[![License](https://img.shields.io/badge/license-MIT-blue.svg)]()
[![Version](https://img.shields.io/badge/version-0.1.0--alpha-orange.svg)]()
[![Powered By](https://img.shields.io/badge/powered%20by-Model%20Context%20Protocol-8A2BE2.svg)]()

**BROWNIE** は、AI エージェントが自律的にソフトウェア開発の全工程（調査・設計・実装・検証・PR作成）を完結させるために最適化された、次世代のエンジニアリング基盤です。

[Explore the Docs »](docs/Home.md)
/
[View Blueprints »](#-blueprints)
/
[Quick Start »](#-getting-started)

</div>

---

## 🌟 Why BROWNIE?

従来の開発環境は「人間」のために設計されてきました。しかし、AI エージェントが自律的に働くためには、より「構造的」で「堅牢」な基盤が必要です。BROWNIE は、AI が「迷わず、安全に、確実な成果を出すこと」に特化した **Agent-Friendly Architecture** を提供します。

| 🏎️ **High Locality** | 🎯 **Explicit Tools** | 🛡️ **Robust Infra** | 🧠 **Meta-Cognition** |
| :--- | :--- | :--- | :--- |
| パス解決とセキュリティ境界を一元化し、AI の推論ノイズを排除。 | Pydantic AI による厳格な型定義でツールの誤用を構造的に防止。 | 独立した MCP サーバーと Docker 隔離による鉄壁のプロセス管理。 | 実行状態を客観視し、エラーを自律的に修復する Self-Healing ループ。 |

---

## 🏗️ Architecture Layers

BROWNIE は 3 つの分離されたプレーンで構成され、高い信頼性と拡張性を実現しています。

### 🧠 Control Plane
**The Brain.** LangGraph によるワークフロー制御と、Planner-Executor パターンによる高度な意思決定を行います。
- `Orchestrator` / `Agent` / `Workflow`

### 💾 Perception Plane
**The Eyes.** DuckDB による AST 解析と NetworkX による依存関係分析により、コードベースの「空間的」把握を支援します。
- `Knowledge MCP Server` / `Code Analyzer`

### 🛠️ Execution Plane
**The Hands.** Docker 隔離環境（Sandbox）内での副作用実行と、厳格な検証を担います。
- `Workspace MCP Server` / `Sandbox Manager`

---

## 📚 Blueprints

BROWNIE は、AI 自身がシステムを理解・再構築できるレベルの「厳格な設計書」として存在します。

| Category | Components |
| :--- | :--- |
| **Core** | [Orchestrator](docs/src_core_orchestrator.md) • [Agent](docs/src_core_agent.md) • [Workflow](docs/src_core_workflow.md) |
| **Workspace** | [Context](docs/src_workspace_context.md) • [Sandbox](docs/src_workspace_sandbox.md) • [GitOps](docs/src_workspace_git_ops.md) |
| **Analysis** | [Analyzer](docs/src_workspace_analyzer_core.md) • [FlowTracer](docs/src_workspace_analyzer_flow.md) • [Repomix](docs/src_workspace_repomix_runner.md) |
| **Infra** | [Manager](docs/src_mcp_server_manager.md) • [WorkspaceServer](docs/src_mcp_server_workspace_server.md) • [KnowledgeServer](docs/src_mcp_server_knowledge_server.md) |

---

## 🚀 Getting Started

### 📋 Prerequisites
- Docker & Docker Compose
- Python 3.11+
- GitHub Personal Access Token

### 🔧 Installation
```bash
# クローンとセットアップ
git clone https://github.com/globalpocket/brownie.git
cd brownie
./bin/setup.sh
```

### 🏃 Running
```bash
# Orchestrator と Worker の起動
./bin/brwn start
```

---

<div align="center">

### 🤝 Join the Autonomous Revolution
BROWNIE は、AI が「ただの道具」ではなく「自律的なチームメンバー」として機能するための、最も信頼できる基盤を提供します。

[GitHub](https://github.com/globalpocket/brownie) / [Wiki](docs/Home.md)

</div>
