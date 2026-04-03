# 📦 BROWNIE (Autonomous AI Engineering Environment)

[![Architecture: Stateless](https://img.shields.io/badge/Architecture-Stateless-blue.svg)](#)
[![Sandbox: 4-Layer](https://img.shields.io/badge/Sandbox-4--Layer%20Defense-red.svg)](#)
[![Memory: Hybrid RAG](https://img.shields.io/badge/Memory-Hybrid%20RAG-green.svg)](#)

**GitHubをハブとしたローカル完結型の自律AIソフトウェアエンジニアリング環境**

本システム「BROWNIE」は、人間とAIがGitHub Issue/PR上で自然言語を用いて協働し、AIが要件定義から実装、テスト、PR作成、レビュー対応、Wiki更新までの全ライフサイクルを自動完結させる実戦仕様のエンジニアリング・オートメーションです。

「疎結合アーキテクチャ」「4層サンドボックス」「自己修復ループ」「完全自律デーモン」を備え、途中アサイン時でも迷わず「今なすべき正解」を特定。物理限界（VRAM/RAM/Disk）を能動的に制御しながら24時間稼働します。

---

## 🚀 クイックスタート (真のワンライナー導入)

以下のコマンドで、依存ツールのインストールからモデルのフェッチ、環境構築まで完全自動で完了します。

```bash
curl -sL https://github.com/globalpocket/brownie/main/setup.sh | bash
```

**`setup.sh` が自動実行するプロビジョニング詳細:**
* **依存ツール導入**: `gh`, `git-lfs`, `docker`, `ollama`, `sqlite3`, `logrotate`, `Repomix` 等
* **モデル・フェッチ**: 推論・埋め込み用モデルの `ollama pull`
* **仮想環境隔離**: `uv` / `venv` によるBROWNIE専用環境構築
* **CLI登録**: `brwn` コマンドのパス登録（仮想環境直結）
* **権限・保守設定**: 非Root実行ユーザーでのデーモン登録、`nice` 値適用、`logrotate` 設定
* **設定初期化**: `config.yaml`, `.env`, `.brwn.json` テンプレート生成と初期設定ウィザード

---

## 💻 動作環境と物理仕様 (Hardware Specifications)

| プラットフォーム | 推奨ハードウェア仕様 | 備考・制約 |
| :--- | :--- | :--- |
| **Mac環境** | MacBook Pro M1/M2/M3 | 32GB Unified Memory以上推奨。ユニファイドメモリによるVRAM/RAMの動的共有を前提とした推論スロットリング制御を実施。 |
| **Linux環境** | GMKtec EVO-X2 等<br>(AMD Ryzen AI Max+ 395) | 128GB LPDDR5X-8000 メモリ搭載機。GPU/CPUリソースの割り当て最適化（優先度設定）を前提。 |
| **ストレージ** | 1TB 〜 2TB以上の高速NVMe SSD | **必須**。GMKtec EVO-X2等では標準2TBをベースとし、第2スロット（最大8TB）への拡張を強く推奨。<br>*用途*: LLMモデル複数保持, Dockerイメージ, Vector DB, 依存関係キャッシュ, 作業領域, 運用ログ |

---

## 🛠 技術スタックとソフトウェア詳細 (Software Specifications)

### 1. 推論・記憶エンジン
* **推論エンジン**: Ollama / vLLM (OpenAI互換API)
    * *仕様*: `OLLAMA_KEEP_ALIVE=-1`（常駐設定）および、起動時のAPIウォームアップ（空リクエストによる先行ロード）必須化。
* **記憶エンジン**: ChromaDB (Server Mode) または Qdrant
    * *仕様*: 永続化ストレージへの自動フラッシュ。

### 2. オーケストレーター・ツール・ライブラリ
* **環境**: Python 3.10+ (uv または venv による完全な仮想環境隔離)
* **主要ツール**:
    * `gh CLI` (GitHub API操作) / `git-lfs` (大型バイナリアセット同期) / `Repomix` (全ファイルスキャン・要約)
    * `Docker` / `Docker Compose` (マルチコンテナ隔離実行)
    * `SQLite 3.24+` (WALモード永続化) / `logrotate` (ログ自動圧縮・世代管理)
* **主要ライブラリ**:
    * `PyGithub` / `LangChain` (記憶・推論抽象化) / `tree-sitter` (AST解析) / `python-Levenshtein` (行ズレFuzzy補正) / `transformers` (HuggingFace: トークナイザー動的ロード)

---

## 🏗 アーキテクチャとディレクトリ構成

**疎結合・ステートレス原則**: 推論（脳）と記憶（海馬）を独立したAPIサーバーとし、オーケストレーターをステートレス化。OSクラッシュ時もSQLiteのチェックポイントから即座に復旧します。

```plaintext
brownie/
├── bin/
│   ├── brwn                  # CLIエントリポイント（PIDロックによる二重起動防止）
│   └── setup.sh              # 統合プロビジョニングスクリプト（ワンライナー対応）
├── src/
│   ├── main.py               # Watchdog駆動メイン（生存信号・LLM監視・要件監視・APIタイムアウト制御）
│   ├── watchdog.py           # 監視・ロールバック・CrashLoopBackOff・OOM/Disk監視・LLM再起動制御
├── src/core/
│   ├── orchestrator.py       # メインループ (RBAC・要件追従・エラー分類・退避優先クリーンアップ)
│   ├── worker_pool.py        # I/O並列・優先度付き推論直列キュー管理 (VRAM保護・UX通知)
│   └── state.py              # 状態管理 (SQLite WAL・整合性チェック・Stale Lock復旧)
├── src/github/
│   ├── client.py             # PyGithub ラッパー (ETag監視・diff_hunk追従・updated_at監視)
│   └── filter.py             # トークナイザー動的選択・厳密なTokenizerベースTruncation
├── src/workspace/
│   ├── sandbox.py            # Docker/Compose・DNS Proxy・権限マウント・GC・ログマスキング・YAMLサニタイザ
│   ├── repomix_runner.py     # 階層化探索 (Discovery) ＋ コードベースRAG (Hybrid)
│   └── git_ops.py            # LFS同期・Fuzzy/AST置換・SHA検証・Resume時のPull-Rebase同期
├── src/memory/
│   └── vector_db.py          # 記憶保存・Index Invalidation (デッドリンクGC)
└── config/
    └── config.yaml           # システム共通設定 (可変メンション名・OOB通知・優先度等)
```

---

## 🧠 オーケストレーター・AIの振る舞い (Core Logic)

### 1. 指示判定とアイデンティティ (Clean Start 原則)
情報の純度を保ち、ハルシネーションを抑制します。
* **初回/途中アサイン時**: アサイン時点の **Issue Description（本文）のみ** を唯一の「正解要件」とします。過去の全コメント・議論は「ノイズ」として完全遮断。
* **継続・修正フェーズ**: `config.yaml` の `mention_name` (例: `@BROWNIE`) を含むコメントのみに反応。メンションなしの会話や異なる呼称（`@AI`等）は完全に無視します。

### 2. 自律管理と追従ロジック
* **要件追従**: ループ開始前に `updated_at` を確認。Descriptionに変更があればメモリコンテキストを破棄し再構成。
* **自律参加/離脱**: 招待で自動 `git clone`。権限剥奪・削除検知時は、API報告に失敗してもローカル状態クリーンアップとワークスペース退避・削除を最優先で完遂します。
* **RBAC**: リポジトリの Collaborator / Owner 権限を持つ人間の指示のみ実行（プロンプトインジェクション防御）。

### 3. 実装・検証ポリシー
* **同期再開 (Resume)**: 再開指示受信時は必ず `git pull --rebase origin <branch>` を実行し履歴をクリーンに保ちます。
* **推測範囲の明示**: 不明点は推測実装し、前後にマーカー `// [AI-GUESS-START]` / `// [AI-GUESS-END]` を必ず挿入。
* **編集・検証**: 「Diffパッチ/Search-Replace方式」限定。`tree-sitter` によるAST構文チェックを必須化し、エラー時は自己修正ループへ。
* **Queue UX**: 推論待ち時は「推定開始時刻：約XX分後」と自動投稿。巨大IssueはAIが自動でチェックリスト化しサブタスク分割。

---

## 🛡 状態管理・記憶・インフラ保護 (Protection & Memory)

### 1. 状態管理とネットワーク仕様
* **SQLite保護**: WALモード動作。起動時に `PRAGMA integrity_check` を実行し、OSクラッシュ等による Stale Lock (`.shm` / `.wal` 不正残存) を自動検知・削除。
* **スマート・ポーリング**: Webhookを使わず `ETag` と `If-Modified-Since` でAPI制限消費を極小化。`[bot]` アカウントのコメントは完全無視。
* **デシンク補正**: 行ズレ発生時は `diff_hunk` 取得、Fuzzyマッチ、AST解析により適用位置を自動補正。

### 2. 記憶管理仕様 (Memory & RAG)
* **2層構造メタデータ**: 成功体験を `scope: local` (固有) / `scope: global` (共通) で保存・マージしてプロンプト注入。
* **整合性維持**: ファイル移動・削除検知でVector DBのデッドリンクを自動消去 (Index Invalidation)。物理破損時は `global-knowledge` ラベル付きIssue等から自動リビルド。

### 3. 4層防御サンドボックス & フェイルセーフ
* **隔離とNW制御**: Docker/Compose隔離。依存解決はDNSホワイトリスト (Egress Proxy)、テスト実行時はNW完全遮断。
* **保護と浄化**: YAMLサニタイザブロック、実行ユーザーIDマッピング (`--user $(id -u):$(id -g)`)。終了後はタスクIDラベルに基づきオーファンコンテナ・ボリュームを定期GC。
* **リソース監視**: 空きメモリ/ディスク枯渇前にコンテナPause・推論スロットリング。LLMに `nice` 値を設定し監視プロセスを保護。
* **保守の自動化**: `logrotate`, `git gc --prune=now`, SQLite `VACUUM` を定期実行。

---

## 🔄 自己修復・運用シーケンス (Self-healing & Operations)

### 自己修復メタ・ループと保守
* **メタ・ループ**: `SystemInternalError` 時に発動。自身専用リポジトリにIssueを起票し、自ら修正PRを作成。
* **自己承認ロック**: AIによる自動マージを禁止し、人間の手動承認 (Human-in-the-loop) を必須化。
* **Wiki同期**: 生成物を `/docs` に反映し、`git subtree push` によりWikiリポジトリ (`.wiki.git`) へ自動同期。
* **CrashLoopBackOff**: 連続起動失敗時は OOB (Out-of-Band) 通知を行い、プロセス完全停止。LLMは `15分` 以上の無限タイムアウトとTCP Keep-Alive、Watchdogへの定期生存信号(Heartbeat)で誤再起動を防止。

### 運用・コミュニケーションシーケンス
1.  **監視**: ETag/updated_atによる高頻度監視
2.  **探索**: 階層化探索 ＋ コードRAG
3.  **推論**: 優先度付き直列キュー ＋ TokenizerベースのTruncation
4.  **テスト**: ネットワーク分離サンドボックス実行
5.  **検証**: 人間による手動レビュー
6.  **記憶**: マージ後の成功体験のLocal/Global保存
