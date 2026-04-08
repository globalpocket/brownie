# 📦 BROWNIE

**AIエージェントによる、AIエージェントのための、真に自律的なエンジニアリング環境**

[![Architecture: Agent-Friendly](https://img.shields.io/badge/Architecture-Agent--Friendly-blueviolet.svg)](#)
[![Security: WorkspaceContext](https://img.shields.io/badge/Security-WorkspaceContext-red.svg)](#)
[![Reliability: MCP--Managed](https://img.shields.io/badge/Reliability-MCP--Managed-green.svg)](#)

BROWNIE（ブラウニー）は、GitHub Issue を起点に「調査・設計・実装・テスト・Pull Request 作成」までの全工程を自律的に完結させる AI ソフトウェアエンジニアリングエージェントです。

最大の特徴は、人間ではなく **"AI 自身" が最も効率的に推論・操作できるように最適化された「Agent-Friendly Architecture」** です。従来の AI エージェントが直面していたパス解決の混乱、ツールの誤用、プロセスの不安定性を排除し、高度な自律稼働を実現しています。

---

## 💎 最大の特徴: Agent-Friendly Architecture

BROWNIE は、AI が「迷わず、壊さず、学び続ける」ための 4 つの柱を実装しています。

### 1. High Locality (境界の集約)
AI が直面する「複雑なパス解決」の問題を構造的に解決しました。`WorkspaceContext` がすべてのパス解決とセキュリティ境界を一元管理。AI はリポジトリルートからの相対パスのみを意識すればよく、ホスト環境の物理的な絶対パスというノイズから完全に解放されます。

### 2. Explicit Tools (明示的なコントラクト)
ツールの動的な生成や曖昧なディスパッチを廃止。`CoderAgent` は厳密な型ヒントと詳細な Docstring を持つ静的メソッドによってツールを提供します。これにより、LLM の推論時における引数の取り違えやハルシネーションを極限まで抑制しています。

### 3. Robust Infrastructure (堅牢なプロセス管理)
`MCPServerManager` による非同期ライフサイクル管理を導入。各タスクごとに独立した MCP サーバー（Knowledge / Workspace）が起動・終了され、ゾンビプロセスの発生を防ぎます。長期間の連続稼働においても、システムリソースの整合性が保たれます。

### 4. Meta-Cognition (自己診断能力)
エージェントは自らの実行状態やコンテキストを客観的に把握するツールを持っています。エラー発生時には自己診断を行い、ワークスペースの不整合を自律的に検知・修正。AI 自身が「今何をしているか、何が起きたか」を正しく理解し、迷走を防止します。

---

## 🏗 システムアーキテクチャ (Overview)

BROWNIE は以下の統合されたコンポーネントで構成されています。

- **🧠 Orchestrator**: システムの司令塔。GitHub のポーリング、タスクのキューイング、リソースの初期化、そして全体の状態管理を司ります。
- **🤖 CoderAgent**: 推論のコア。明示的なツールセットを駆使し、Workspace / Knowledge の両 MCP サーバーと連携して Issue に立ち向かいます。
- **🛡 SandboxManager**: Docker を基盤とした安全な実行環境。YAML サニタイザにより、特権実行や不正なマウントを構造的に遮断します。
- **💾 StateManager**: SQLite (WAL モード) を使用した高信頼な状態管理。OS クラッシュ時でもタスクの整合性を維持し、再起動後のリカバリーを可能にします。
- **🔌 MCP Servers**:
  - **Knowledge Server**: AST 解析、RAG、シンボル検索を提供し、AI に「深いコード理解」を与えます。
  - **Workspace Server**: サンドボックス内での安全なファイル操作、Git 操作、Linter 実行を担います。

---

## 📚 ドキュメント (Documentation)

BROWNIE の各モジュールに関する詳細な設計書は `docs/` ディレクトリに格納されています。

- **Blueprints**: AI がシステムを完全にリバースエンジニアリング・再構築するために最適化された「厳密な設計図」です。
  - [StateManager 設計書](https://github.com/globalpocket/brownie/wiki/src_core_state)
  - [MCPServerManager 設計書](https://github.com/globalpocket/brownie/wiki/src_mcp_server_manager)
  - [SandboxManager 設計書](https://github.com/globalpocket/brownie/wiki/src_workspace_sandbox)
  - [Orchestrator 設計書](https://github.com/globalpocket/brownie/wiki/src_core_orchestrator)

---

## 🚀 クイックスタート

### 1. セットアップ
```bash
./bin/setup.sh
```

### 2. 起動
```bash
./bin/brwn start
```

BROWNIE は 24時間 365日、あなたの隣で GitHub Issue を解決し続けます。
