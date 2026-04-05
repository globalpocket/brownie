import httpx
import logging
import asyncio

logger = logging.getLogger(__name__)

class OllamaModelManager:
    def __init__(self, base_url: str = "http://localhost:11434"):
        self.base_url = base_url
        self.current_model = None

    async def switch_model(self, target_model: str) -> bool:
        """不要なモデルをアンロードし、新しいモデルをVRAMにロードする"""
        if self.current_model == target_model:
            return True

        if self.current_model:
            logger.info(f"Unloading {self.current_model}...")
            try:
                async with httpx.AsyncClient() as client:
                    # 指示通り /api/chat に keep_alive: 0 を送ってアンロード
                    await client.post(f"{self.base_url}/api/chat", json={"model": self.current_model, "keep_alive": 0})
            except Exception as e:
                logger.warning(f"Failed to unload {self.current_model}: {e}")
            await asyncio.sleep(2)

        logger.info(f"Loading {target_model}...")
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                # 指示通り messages: [] と keep_alive: -1 を送ってロード
                await client.post(f"{self.base_url}/api/chat", json={"model": target_model, "messages": [], "keep_alive": -1})
            self.current_model = target_model
            return True
        except Exception as e:
            logger.error(f"Failed to load {target_model}: {e}")
            return False
