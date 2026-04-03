#!/bin/bash
set -e

# Brownie 統合セットアップスクリプト (設計書 11.1)
echo "Starting Brownie Provisioning..."

# 1. OS チェック
OS="$(uname)"
case $OS in
  "Darwin")
    echo "Running on macOS..."
    # Homebrew がない場合は入れる
    if ! command -v brew &> /dev/null; then
        /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    fi
    # 設計書 11.2: ツール導入 (brew)
    brew install git-lfs gh docker docker-compose ollama
    ;;
  "Linux")
    echo "Running on Linux..."
    # Ubuntu 22.04 推奨 (設計書 11.1)
    sudo apt update
    sudo apt install -y git-lfs gh docker.io docker-compose-v2 curl
    # Ollama インストール
    curl -fsSL https://ollama.com/install.sh | sh
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

# 2. Git LFS インストール (設計書 2.2, 11.2)
git lfs install

# 3. Python 仮想環境 (uv) の構築 (設計書 2.2, 11.3)
if ! command -v uv &> /dev/null; then
    curl -LsSf https://astral.sh/uv/install.sh | sh
fi
source $HOME/.cargo/env || true
uv sync

# 4. ディレクトリ初期化 (設計書 11.4)
mkdir -p ~/.local/share/brownie/
mkdir -p ~/.cache/brownie/
mkdir -p logs

# 5. 保守・保護設定 (設計書 11.4: Nice値)
# メインプロセスより LLM 等の重い処理の優先度を下げるため
# 実際には実行時に nice -n 10 を適用するよう alias や wrapper を設定
echo "alias brownie='nice -n 10 ./bin/brwn'" >> ~/.zshrc

# 6. Docker ボリュームの初期化
docker-compose up -d chromadb

# 7. LLM 推奨モデルの事前プル (設計書 11.2)
ollama pull llama3:latest

echo "Brownie setup completed successfully!"
