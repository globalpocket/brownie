import chromadb
from chromadb.config import Settings
import logging
from typing import List, Dict, Any, Optional
import time

logger = logging.getLogger(__name__)

class MemoryManager:
    def __init__(self, persist_directory: str):
        self.client = chromadb.PersistentClient(path=persist_directory)
        self.collection = self.client.get_or_create_collection(
            name="brownie_memories",
            metadata={"hnsw:space": "cosine"}
        )

    async def save_experience(self, repo_name: str, issue_id: int, 
                             scope: str, task_type: str, 
                             content: str, commit_hash: str):
        """成功体験を保存 (設計書 4. MemoryManager, 5.2 スキーマ)"""
        timestamp = time.time()
        
        # ID の生成
        doc_id = f"{repo_name}_{issue_id}_{scope}_{timestamp}"
        
        # 設計書通りのメタデータ保存
        metadata = {
            "repo_name": repo_name,
            "issue_id": issue_id,
            "scope": scope,
            "type": task_type,
            "commit_hash": commit_hash,
            "last_modified": timestamp,
            "timestamp": timestamp
        }
        
        self.collection.add(
            documents=[content],
            metadatas=[metadata],
            ids=[doc_id]
        )
        logger.info(f"Saved experience to memory: {doc_id}")

    async def search_memory(self, query: str, repo_name: str, 
                           limit: int = 5) -> List[Dict[str, Any]]:
        """記憶の検索 (設計書 7.1)"""
        results = self.collection.query(
            query_texts=[query],
            where={"repo_name": repo_name},
            n_results=limit
        )
        
        memories = []
        if results['documents']:
            for i in range(len(results['documents'][0])):
                memories.append({
                    "content": results['documents'][0][i],
                    "metadata": results['metadatas'][0][i],
                    "distance": results['distances'][0][i]
                })
        return memories

    def invalidate_index(self, repo_name: str, file_path_pattern: str):
        """Index Invalidation (デッドリンクGC) (設計書 4. MemoryManager, 7.1)
        ファイル移動・削除時にDB内の無効な記憶を消去。
        """
        # 実際にはスコープ（ファイルパス等）がパターンにマッチするものを削除
        # WHERE句でメタデータをフィルタリングして削除
        try:
            self.collection.delete(
                where={"$and": [
                    {"repo_name": {"$eq": repo_name}},
                    {"scope": {"$contains": file_path_pattern}}
                ]}
            )
            logger.info(f"Invalidated index for pattern: {file_path_pattern} in {repo_name}")
        except Exception as e:
            logger.error(f"Failed to invalidate index: {e}")
