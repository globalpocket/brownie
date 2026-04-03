#!/bin/bash
set -e

# Brownie Cleanup Script
echo "Starting Brownie Environment Cleanup..."

# 1. 稼働中のプロセスを停止
echo "Stopping Brownie processes..."
if [ -f "./bin/brwn" ]; then
    ./bin/brwn stop || true
fi

# 2. 仮想環境の削除
if [ -d ".venv" ]; then
    echo "Removing .venv directory..."
    rm -rf .venv
fi

# 3. 環境設定ファイルの削除
if [ -f ".env" ]; then
    echo "Removing .env file..."
    rm .env
fi

# 4. ログのクリーンアップ (オプション: ユーザーは残したい場合があるため、重要度低)
# if [ -d "logs" ]; then
#     echo "Clearing logs..."
#     rm -rf logs/*
# fi

echo "Cleanup completed. You can now run ./bin/setup.sh for a fresh start."
