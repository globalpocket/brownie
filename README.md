# 📦 BROWNIE (Autonomous AI Engineering Environment)

[![Architecture: MCP-Microservices](https://img.shields.io/badge/Architecture-MCP--Microservices-blueviolet.svg)](#)
[![Sandbox: 4-Layer](https://img.shields.io/badge/Sandbox-4--Layer%20Defense-red.svg)](#)
[![Memory: Hybrid RAG (MCP)](https://img.shields.io/badge/Memory-Hybrid%20RAG-green.svg)](#)

**GitHubをハブとした、完全疎結合・MCPベースの自律AIソフトウェアエンジニアリング環境**

本システム「BROWNIE」は、人間とAIがGitHub Issue/PR上で自然言語を用いて協働し、AIが要件定義から実装、テスト、PR作成、Wiki更新までの全ライフサイクルを自動完結させる実戦仕様のエンジニアリング・オートメーションです。

最新版では **Model Context Protocol (MCP)** を全面採用。推論（脳）・記憶（海馬）・実行（手足）を独立したマイクロサービスとして分離し、**最小権限の原則 (Least Privilege)** に基づく圧倒的な堅牢性と拡張性を実現しました。

---

## 🏗 アーキテクチャ構成 (The 3-Layer Design)

BROWNIE は以下の 3 つのプレーンが標準プロトコル (stdio) で通信する、ハッカーライクなマイクロサービス構成をとっています。

1.  **🧠 Control Plane (The Brain)**: 
    - `Orchestrator` & `CoderAgent`: 推論と意思決定。ツールを直接持たず、MCP Client として外部機能を動的に呼び出します。
2.  **💾 Perception Plane (The Memory)**: 
    - `Knowledge MCP Server`: ChromaDB (RAG) と DuckDB (AST解析) を統合。Agent に「知覚と記憶」を提供します。
3.  **🛠 Execution Plane (The Hands)**: 
    - `Workspace MCP Server`: Docker 隔離サンドボックス内でのファイル操作・コマンド実行・Linter を制御。「実行の自由と安全」を担保します。

---

## 🚀 クイックスタート

### 1. プロビジョニング (ワンライナー)
以下のコマンドを実行します。Linux/Mac の依存関係、Docker、Ollama モデルを自動セットアップします。

```bash
./bin/setup.sh
```

### 2. Brownie の起動

```bash
./bin/brwn start
```

---

## 🛠 ディレクトリ構成とモジュール設計

```plaintext
brownie/
├── bin/
│   ├── brwn                  # CLIエントリポイント（PIDロック・二重起動防止）
│   └── setup.sh              # 統合プロビジョニング（Linux/Mac自動判別）
├── src/mcp/                  # 【NEW】MCP Microservices (The Hand & Memory)
│   ├── knowledge_server.py   # 記憶・解析サーバー (RAG + AST + SQL)
│   └── workspace_server.py   # 実行・操作サーバー (Sandbox + Git ops)
├── src/core/                 # 【Brain】オーケストレーター・インテリジェンス
│   ├── orchestrator.py       # メインループ (MCP ライフサイクル管理・RBAC)
│   ├── agent.py              # 疎結合エージェント (Dynamic Tool Dispatcher)
│   └── state.py              # 状態管理 (SQLite WAL・Stale Lock復旧)
├── src/workspace/            # 【Hands 実装】サンドボックス・保護ロジック
│   └── sandbox.py            # 4層防御 (Docker隔離、DNS Proxy、YAMLサニタイザ)
├── src/memory/               # 【Memory 実装】ベクトルDB・ナレッジ
│   └── vector_db.py          # 記憶保存・Index Invalidation
├── src/github/               # コミュニケーション・ハブ
│   └── client.py             # PyGithub ラッパー (ETag/Backoff対応)
└── config/
    └── config.yaml           # システム共通設定
```

---

## 🛡 堅牢性とセキュリティポリシー

### 1. 最小権限の原則 (Least Privilege)
推論エンジン（Agent）はホストのファイルシステムや Docker に直接アクセスする権限を持ちません。すべては子プロセスとして隔離された Workspace Server を通じ、MCP プロトコル経由で厳密に認可された操作のみが実行されます。

### 2. 4層防御サンドボックス
- **Docker隔離**: 各タスクは専用のコンテナ内で実行。
- **権限マウント禁止**: YAMLサニタイザにより `privileged` や広域マウントをブロック。
- **非Root実行**: `--user $(id -u):$(id -g)` によるホスト環境の保護。
- **NW制御**: 未認可の外部通信を DNS Proxy で完全遮断。

---

## 🔄 自己修復・運用シーケンス (Self-healing)
* **メタ・ループ**: システム内部エラー検知時、自ら修正 Issue を起票し、修正 PR を作成。
* **CrashLoopBackOff**: 連続クラッシュ時は OOB 通知を行い停止。
* **履歴同期**: 再開時は必ず `git pull --rebase` を実行し、人間に優しいクリーンなコミット履歴を維持。

---

## 💻 動作環境
- **Mac**: M1/M2/M3 (32GB Unified Memory以上推奨)
- **Linux**: Ryzen AI / NVidia 推論環境 (RAM 64GB以上推奨)
- **ストレージ**: 1TB以上のNVMe SSD (モデル、Vector DB用)

BROWNIE は 24時間稼働し、GitHub Issue を「チャットルーム」としてエンジニアの隣で働き続けます。
