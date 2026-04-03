from transformers import AutoTokenizer
import logging
from typing import Optional, List

logger = logging.getLogger(__name__)

class TokenFilter:
    def __init__(self, model_name: str = "gpt2"):
        # 設計書 3.2: 動的選択 (transformersによりモデル構成をロード)
        try:
            self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        except Exception:
            # フォールバック (設計書 5.1: auto)
            logger.warning(f"Could not load tokenizer for {model_name}, falling back to gpt2")
            self.tokenizer = AutoTokenizer.from_pretrained("gpt2")

    def truncate_to_limit(self, text: str, max_tokens: int) -> str:
        """トークン数制限に基づく厳密な切り出し (設計書 3.2)"""
        tokens = self.tokenizer.encode(text)
        if len(tokens) <= max_tokens:
            return text
        
        # 厳密なトークナイザーベースの Truncation
        truncated_tokens = tokens[:max_tokens]
        return self.tokenizer.decode(truncated_tokens)

    def sliding_window_chunk(self, text: str, chunk_size: int, overlap: int = 50) -> List[str]:
        """Sliding Window 方式によるチャンク分割 (設計書 7.1)"""
        tokens = self.tokenizer.encode(text)
        chunks = []
        
        start = 0
        while start < len(tokens):
            end = min(start + chunk_size, len(tokens))
            chunk_tokens = tokens[start:end]
            chunks.append(self.tokenizer.decode(chunk_tokens))
            
            if end == len(tokens):
                break
            
            start += (chunk_size - overlap)
            
        return chunks

    def count_tokens(self, text: str) -> int:
        """トークン数のカウント"""
        return len(self.tokenizer.encode(text))
