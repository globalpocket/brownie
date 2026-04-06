#!/bin/bash
set -e

# Brownie 環境削除スクリプト (Unsetup)
# 0. Docker サービスの停止とリソース削除 (ChromaDB 等)
if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
    echo "Stopping Docker services and removing volumes..."
    if docker compose version &> /dev/null; then
        docker compose down -v || true
    else
        docker-compose down -v || true
    fi
fi

# 1. Python 仮想環境の削除
if [ -d ".venv" ]; then
    echo "Removing Python virtual environment (.venv)..."
    rm -rf .venv
fi

# 2. ローカルデータの削除 (データベース, ベクトルDB 等)
DATA_DIR="$HOME/.local/share/brownie"
if [ -d "$DATA_DIR" ]; then
    echo "Removing local data directory ($DATA_DIR)..."
    rm -rf "$DATA_DIR"
fi

# 3. キャッシュの削除 (Tree-sitter 文法ファイル等)
CACHE_DIR="$HOME/.cache/brownie"
if [ -d "$CACHE_DIR" ]; then
    echo "Removing cache directory ($CACHE_DIR)..."
    rm -rf "$CACHE_DIR"
fi

# 4. ログの削除
if [ -d "logs" ]; then
    echo "Removing logs directory..."
    rm -rf logs
fi

# 5. 環境設定ファイルの削除
if [ -f ".env" ]; then
    read -p "Do you want to remove the .env file (containing GitHub token)? [y/N]: " REMOVE_ENV
    if [[ "$REMOVE_ENV" =~ ^[Yy]$ ]]; then
        echo "Removing .env file..."
        rm .env
    fi
fi

# 6. シェルエイリアスの削除 (~/.zshrc)
if [ -f "$HOME/.zshrc" ]; then
    if grep -q "alias brownie=" "$HOME/.zshrc"; then
        echo "Removing brownie alias from ~/.zshrc..."
        # 該当行を削除した一時ファイルを作成し、上書き
        sed -i.bak '/alias brownie=/d' "$HOME/.zshrc"
        rm "${HOME}/.zshrc.bak"
    fi
fi

# 7. LLM モデルの削除 (Ollama)
if command -v ollama &> /dev/null; then
    read -p "Do you want to remove the Ollama models used by Brownie (qwen3-coder)? [y/N]: " REMOVE_MODELS
    if [[ "$REMOVE_MODELS" =~ ^[Yy]$ ]]; then
        echo "Removing Ollama models..."
        ollama rm llama3.1:8b || true
        ollama rm qwen3-coder:30b || true
        # --- Clean up legacy models ---
        ollama rm qwen2.5-coder:7b || true
        ollama rm qwen2.5-coder:14b || true
        ollama rm qwen2.5-coder:32b || true
    fi
fi

# 8. システムツール (brew/aptで入れたもの) について
echo ""
echo "Note: System-wide tools (Node.js, Docker, Ollama, etc.) were not removed."
echo "If you want to uninstall them, please use your package manager (brew/apt) manually."
echo ""
echo "✅ Brownie environment has been uninstalled successfully."
