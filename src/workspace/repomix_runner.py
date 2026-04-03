import subprocess
import os
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

class RepomixRunner:
    def __init__(self, repo_path: str):
        self.repo_path = repo_path
        self.output_file = os.path.join(self.repo_path, ".brownie_repomix.md")

    def run_discovery(self, exclude_patterns: Optional[List[str]] = None) -> str:
        """Repomixによる階層化探索 (Discovery) (設計書 3.2, 7.1)
        モデル崩壊防止のため /docs や Wiki は探索除外。
        """
        if exclude_patterns is None:
            # 既定の除外パターン
            exclude_patterns = ["docs/**", "wiki/**", "*.md", ".git/**"]
        
        exclude_str = ",".join(exclude_patterns)
        
        logger.info(f"Running Repomix discovery for {self.repo_path}...")
        try:
            # repomix コマンドの実行 (npx repomix)
            # 実際には JSON 出力などをパースして LLM に渡す形式にする
            cmd = [
                "npx", "-y", "repomix",
                "--output", self.output_file,
                "--exclude", exclude_str,
                "--include", "**/*"
            ]
            
            subprocess.run(cmd, cwd=self.repo_path, check=True)
            
            with open(self.output_file, 'r') as f:
                content = f.read()
            
            # 一時ファイルの削除
            # os.remove(self.output_file)
            
            return content
        except subprocess.CalledProcessError as e:
            logger.error(f"Repomix discovery failed: {e}")
            return ""

    def extract_relevant_files(self, query: str) -> List[str]:
        """クエリに基づいて関連ファイルを抽出する (コードRAG Hybrid)"""
        # 実際には tree-sitter も組み合わせた高度な抽出が必要だが
        # ここでは簡易的な RAG 形式での抽出を想定
        return []
        
    def ast_summarize(self, file_path: str) -> str:
        """AST解析によるファイルの要約 (設計書 7.2)"""
        # tree-sitter 等を使用した要約ロジック
        return f"Summary of {file_path}"
