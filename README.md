# 📦 BROWNIE

**AIエージェントによる、AIエージェントのための、真に自律的なエンジニアリング環境**

[![Architecture: Planner-Executor](https://img.shields.io/badge/Architecture-Planner--Executor-blueviolet.svg)](#)
[![Security: WorkspaceContext](https://img.shields.io/badge/Security-WorkspaceContext-red.svg)](#)
[![Reliability: Dual--MLX--Managed](https://img.shields.io/badge/Reliability-Dual--MLX--Managed-green.svg)](#)

BROWNIE（ブラウニー）は、GitHub Issue を起点に「調査・設計・実装・テスト・Pull Request 作成」までの全工程を自律的に完結させる AI ソフトウェアエンジニアリングエージェントです。

最大の特徴は、人間ではなく **"AI 自身" が最も効率的に推論・操作できるように最適化された「Agent-Friendly Architecture」** です。最新バージョンでは、軽量モデルの特性を活かしたマルチエージェント構成へと進化しました。

---

## 💎 最大の特徴: Agent-Friendly Architecture

BROWNIE は、AI が「迷わず、壊さず、学び続ける」ための 4 つの柱を実装しています。

### 1. High Locality (境界の集約)
AI が直面する「複雑なパス解決」の問題を構造的に解決しました。`WorkspaceContext` がすべてのパス解決とセキュリティ境界を一元管理。AI はリポジトリルートからの相対パスのみを意識すればよく、物理的な絶対パスというノイズから完全に解放されます。

### 2. Explicit Tools (明示的なコントラクト)
ツールの誤用やハルシネーションを極限まで抑制しています。すべてのツールは、型ヒントと詳細な Docstring を持つ静的メソッドとして定義され、AI にとって「何をするためのツールか」が明白です。

### 3. Robust Infrastructure (堅牢なプロセス管理)
`MCPServerManager` と `Orchestrator` による鉄壁の管理。各タスクごとに独立した MCP サーバーを起動し、MLX サーバー（Llama 3.1 / Qwen 2.5 Coder）をポート単位で死活監視。ゾンビプロセスを許さない設計です。

### 4. Meta-Cognition (自己診断能力)
エージェントは自らの実行状態やコンテキストを客観的に把握するツール（`get_agent_context`）を持っています。エラー発生時には自己診断を行い、プロジェクト環境の不整合を自律的に検知・修正します。

---

## 🧠 Multi-Agent（マルチエージェント）アーキテクチャ

BROWNIE は、役割を分担させた複数の AI モデルを連携させる「Multi-Agent アーキテクチャ」を採用しています。これにより、単一の軽量モデルが抱えていた「Function Calling の不安定さ」と「コーディング能力の不足」というトレードオフを、構造的に解決しました。

### Planner-Executor（計画者と実行者）パターン

このアーキテクチャの核となるのが、司令塔と職人を分担させる「Planner-Executor パターン」です。MacBook M1 Pro のメモリ上で 2 つのモデルを同時に並行稼働させることで、以下のシナリオを実現します。

- **Planner (計画者 / Meta-Llama-3.1-8B)**: 
  プロジェクトマネージャーとして、全体の計画立案、ファイル一覧の取得、読み込み、コマンド実行などの「環境操作」と「意思決定」に専念します。複雑なコード作成は行わず、Executor に指示を出します。
- **Executor (実行者 / Qwen2.5-Coder-7B)**: 
  コーディング専門家として、Planner から渡されたコードコンテキストと指示のみを基に、高精度なコード分析、バグ修正案、実装コードの生成を行います。ツール呼び出しを行わないため、高い出力を安定して生成可能です。

この 2 つのモデルは、オーケストレーターによって管理される独立した MLX サーバー（Port 8080/8081）を介して通信します。

---

## 🏗 システムアーキテクチャ (Overview)

BROWNIE は以下の統合されたコンポーネントで構成されています。

- **🧠 Orchestrator**: システムの核心部。デュアル MLX サーバーの監視、GitHub との連携、タスクのコーディネーションを司ります。
- **🤖 CoderAgent (Planner)**: 推論ループの主体。明示的なツールセットを駆使し、専門家 (Executor) と連携して Issue を解決します。
- **🛡 SandboxManager**: Docker を基盤とした安全な実行環境。ワークスペース外への干渉を構造的に遮断します。
- **💾 StateManager**: SQLite (WAL モード) による高信頼な状態管理。タスクの進捗とコンテキストを確実に永続化します。

## AIモデルの管理：HuggingFaceの「デフォルトの罠」とBrownieの対策

Brownieはローカル環境で強力なAIを稼働させるため、数十GBに及ぶ巨大なLLM（大規模言語モデル）をダウンロードします。このモデルファイルの管理において、BrownieはHuggingFaceのデフォルト挙動が抱えるリスクを回避する独自の安全設計を採用しています。

### 🚨 HuggingFaceの「デフォルトの罠」
通常、HuggingFaceのライブラリは「インストール不要ですぐにモデルを試せる」ことを優先し、モデルをOS標準の一時保管場所（`~/.cache/huggingface/hub/`）に保存します。
しかし、15GBを超えるような「再ダウンロードに膨大な時間とネットワークリソースを要するデータ」を、OSの都合で消去されうる「一時キャッシュ」として扱うことは、巨大なローカルLLMを運用する上で大きなリスク（設計上の脆弱性）となります。

### 🛡️ Brownieの解決策：キャッシュから「大切な資産」へ
Brownieは、この危ういデフォルト挙動にあえて従いません。
システムとスクリプトレベルで保存先を明示的に上書きし、**Brownie専用の安全な永続データ領域**へとモデルを隔離します。

* **専用の保存場所:** `~/.local/share/brownie/models/`
* **設定のカスタマイズ:** `config/config.yaml` の `model_dir` にて、ユーザーの環境に合わせて柔軟に変更可能です。

これにより、Brownieは巨大なAIモデルを単なる「キャッシュ（一時的なゴミ）」ではなく、システムの中核を成す**「大切な資産（アセット）」**として保護します。OSのクリーンアップ等による不意の消失を防ぎ、安定したローカル開発環境を約束します。

### 💾 ディスク容量の解放（不要な過去モデルの削除）について
Brownieは上記のようにモデルを大切に保管するため、設定（`config.yaml`）でAIモデルを別のモデルに切り替えて試行した場合でも、過去にダウンロードした古いモデルデータは自動的には削除されません。そのため、過去の試行錯誤の跡が蓄積し、ディスク容量を数十GB圧迫する場合があります。

**容量を解放するには：**
ストレージを圧迫している場合は、`bin/unsetup.sh` を実行してクリーンアップを行うか、`~/.local/share/brownie/models/` 内の不要なモデルディレクトリを手動で削除してください。
これらを削除してもBrownieのプログラム自体が壊れることはなく、次回起動時にその時点で設定されている必要なモデルのみが安全に再ダウンロードされます。

---

## 📚 ドキュメント (Blueprints)

AI がシステムを完全に理解し、再構築・拡張するために最適化された「厳密な設計書」です。

- [StateManager 設計書](docs/src_core_state.md)
- [MCPServerManager 設計書](docs/src_mcp_server_manager.md)
- [SandboxManager 設計書](docs/src_workspace_sandbox.md)
- [Orchestrator 設計書](docs/src_core_orchestrator.md)

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

BROWNIE は 24時間 365日、あなたの隣で最適解を出し続けるエンジニアです。
