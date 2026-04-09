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

# 1. 設定の読み込み (削除前に実施)
MODEL_DIR="~/.local/share/brownie/models"
if [ -f "config/config.yaml" ]; then
    # uv が使える場合は優先使用、使えない場合は grep で簡易取得
    if command -v uv &> /dev/null && [ -d ".venv" ]; then
        MODEL_DIR=$(uv run python -c "import yaml; print(yaml.safe_load(open('config/config.yaml'))['llm'].get('model_dir', '~/.local/share/brownie/models'))" 2>/dev/null || echo "~/.local/share/brownie/models")
    else
        MODEL_DIR=$(grep 'model_dir:' config/config.yaml | awk '{print $2}' | tr -d '"' | tr -d "'" || echo "~/.local/share/brownie/models")
    fi
fi
EXPANDED_MODEL_DIR=$(echo $MODEL_DIR | sed "s|^~|$HOME|")

# 1. Python 仮想環境の削除
if [ -d ".venv" ]; then
    echo "Removing Python virtual environment (.venv)..."
    rm -rf .venv
fi

# 2. ローカルデータの削除 (データベース, ベクトルDB 等)
DATA_DIR="$HOME/.local/share/brownie"
if [ -d "$DATA_DIR" ]; then
    echo "Removing local databases and memory from $DATA_DIR..."
    # モデル以外のデータを選択的に削除
    rm -f "$DATA_DIR/brownie.db"
    rm -rf "$DATA_DIR/vector_db"
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

# 7. Persistent Model Storage (永続化モデル) の削除
read -p "Do you want to remove all AI models stored in $MODEL_DIR? [y/N]: " REMOVE_MODELS
if [[ "$REMOVE_MODELS" =~ ^[Yy]$ ]]; then
    echo "Removing persistent model directory..."
    rm -rf "$EXPANDED_MODEL_DIR"
    
    # 以前のキャッシュディレクトリが残っている場合も念のため削除
    echo "Cleaning up legacy cache directories if exist..."
    rm -rf "$HOME/.cache/huggingface/hub/models--mlx-community*"
    rm -rf "$HOME/.cache/huggingface/hub/models--google--gemma*"
fi

# 8. システムツール (brew/aptで入れたもの) について
echo ""
echo "Note: System-wide tools (Node.js, Docker, Ollama, etc.) were not removed."
echo "If you want to uninstall them, please use your package manager (brew/apt) manually."
echo ""
echo "✅ Brownie environment has been uninstalled successfully."
