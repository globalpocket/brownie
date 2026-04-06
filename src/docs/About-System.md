# BROWNIE: System Architecture Overview

BROWNIE は、「脳 (Brain)」「記憶 (Memory)」「手足 (Hands)」を分離した、Model Context Protocol (MCP) ベースの自律型 AI エージェント・プラットフォームです。

---

## 🏗 THE 3-PLANE ARCHITECTURE

システムは独立した 3 つのプレーンで構成され、標準プロトコル (stdio) を介して安全に通信します。

### 1. 🧠 THE BRAIN (Control Plane)
**Orchestrator & CoderAgent**
- **役割**: タスクの優先順位付け、推論、意思決定。
- **特徴**: ツールを直接呼び出す権限を持ちません。MCP Client として動作し、下位プレーンの機能を必要に応じて呼び出します。
- **安全性**: 最小権限で動作し、ホスト環境から論理的に切り離されています。

### 2. 💾 THE MEMORY (Perception Plane)
**Knowledge MCP Server**
- **役割**: コンテキストの提供、情報の保存と検索。
- **コンポーネント**: 
  - **ChromaDB**: セマンティック検索 (RAG) による過去事例の提供。
  - **DuckDB**: AST (抽象構文木) ベースの高度なコードフロー解析。
- **特徴**: 大規模なコードベースでも、ミリ秒単位でシンボルの依存関係や関連箇所を Agent に伝えます。

### 3. 🛠 THE HANDS (Execution Plane)
**Workspace MCP Server**
- **役割**: 物理的なファイル操作、コマンド実行、検証。
- **保護機構**: 4層サンドボックス (Docker, DNS Proxy, YAML Sanitizer, User ID Mapping)。
- **特徴**: 「手を動かす」ことに特化。厳密なサニタイズを経て認可された操作のみをサンドボックス内で実行します。

---

## 🛡 SECURITY & RESILIENCE (堅牢性の設計思想)

### 最小権限の原則 (Least Privilege)
推論を行う「脳」が直接ファイルシステムを書き換えることはありません。すべての操作は「手足」である Workspace Server を経由し、プロトコルレベルで監視・制限されています。

### 自己修復メタ・ループ (Self-healing Meta-loop)
システム自体に異常が発生した場合、Watchdog がそれを検知。BROWNIE 自らが自分自身のバグ修正 Issue を起票し、パッチを適用した PR を自律的に作成します。

### ステートレス & 再起動耐性
タスクの状態は SQLite (WALモード) で管理。OS クラッシュや電源切断が発生しても、再起動時に Stale Lock を自動解除し、中断したタスクのチェックポイントから即座に再開します。

---

BROWNIE は、単なるコード生成 AI ではなく、**「自律的なエンジニアとして機能するセキュアなインフラ」**として設計されています。