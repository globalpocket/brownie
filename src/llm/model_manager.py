import httpx
import logging
import asyncio
import os
from typing import Optional

logger = logging.getLogger(__name__)

class OllamaModelManager:
    """
    Ollama の VRAM 管理とモデル切り替えを担当するクラス。
    モデルのロード状態を追跡し、必要に応じてアンロードを行う。
    """
    def __init__(self, endpoint: str = "http://localhost:11434/v1"):
        # /v1 をベースURLから除去して Ollama ネイティブ API (11434) を向くように調整
        self.base_url = endpoint.replace("/v1", "").rstrip("/")
        self.current_loaded_model: Optional[str] = None
        self._lock = asyncio.Lock() # 同時に複数のモデルスイッチが走らないようロック

    async def unload_model(self, model_name: str) -> bool:
        """指定されたモデルを VRAM から即座に解放する"""
        logger.info(f"Unloading model {model_name} to free VRAM...")
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.base_url}/api/chat",
                    json={
                        "model": model_name,
                        "keep_alive": 0 # 0 を指定すると即時アンロードされる (Ollama 仕様)
                    },
                    timeout=10.0
                )
            if resp.status_code == 200:
                logger.info(f"Successfully unloaded {model_name}.")
                return True
            else:
                logger.warning(f"Unload command for {model_name} returned status {resp.status_code}")
                return False
        except Exception as e:
            logger.warning(f"Failed to unload model {model_name}: {e}")
            return False

    async def switch_model(self, target_model: str) -> bool:
        """
        新しいモデルへ安全に切り替える。
        現在異なるモデルがロードされている場合は、まずアンロードを行う。
        """
        async with self._lock:
            if self.current_loaded_model == target_model:
                logger.debug(f"Model {target_model} is already marked as loaded.")
                return True

            # 1. 現在のモデルをアンロード (VRAM 掃除)
            if self.current_loaded_model:
                await self.unload_model(self.current_loaded_model)
                await asyncio.sleep(2) # VRAM 解放のラグを考慮

            # 2. 目的のモデルをウォームアップ (ロード)
            logger.info(f"Loading/Warming up model {target_model}...")
            try:
                # keep_alive=-1 は、明示的にアンロードされるまでメモリに常駐させる指定
                async with httpx.AsyncClient() as client:
                    await client.post(
                        f"{self.base_url}/api/chat",
                        json={
                            "model": target_model,
                            "messages": [], # 空のメッセージでロードをトリガー
                            "keep_alive": -1 
                        },
                        timeout=180.0 # 大規模モデルの初回ロードは時間がかかるため余裕を持つ
                    )
                logger.info(f"Model {target_model} is ready.")
                self.current_loaded_model = target_model
                return True
            except httpx.ReadTimeout:
                # タイムアウトしても Ollama 側でロードが続行されている場合が多い
                logger.info(f"Model {target_model} load request sent, proceeding as loaded.")
                self.current_loaded_model = target_model
                return True
            except Exception as e:
                logger.error(f"Failed to load model {target_model}: {e}")
                return False

    def get_current_model(self) -> Optional[str]:
        return self.current_loaded_model
