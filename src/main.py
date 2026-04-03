import asyncio
import logging
import os
import sys
import signal

# プロジェクトルートをパスに追加 (設計書 3.2 補足)
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from src.core.orchestrator import Orchestrator

# 1. ログ設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("brownie.main")

class BrownieApp:
    def __init__(self, config_path: str):
        self.config_path = config_path
        self.orchestrator = Orchestrator(config_path)
        self.stop_event = asyncio.Event()

    async def run(self):
        """メインプロセスの実行 (設計書 3.2: 生存信号送信・LLM死活監視)"""
        logger.info("Starting Brownie Main Process...")
        
        # 設計書に基づき、シグナルハンドラを設定
        loop = asyncio.get_running_loop()
        for s in (signal.SIGINT, signal.SIGTERM):
            loop.add_signal_handler(s, lambda: asyncio.create_task(self.shutdown()))
        
        try:
            # 1. 起動
            orchestrator_task = asyncio.create_task(self.orchestrator.start())
            
            # 2. 定期的な生存信号（Watchdog向け）
            asyncio.create_task(self._send_survival_signals())
            
            # 3. 待機
            await self.stop_event.wait()
            
            # 4. 停止
            orchestrator_task.cancel()
            await asyncio.gather(orchestrator_task, return_exceptions=True)
            
        except Exception as e:
            logger.error(f"Fatal error in main process: {e}")
        finally:
            logger.info("Brownie Main Process stopped.")

    async def _send_survival_signals(self):
        """Watchdogへの生存信号の送信 (設計書 3.2: 生存信号)"""
        while not self.stop_event.is_set():
            # 簡易的にロックファイルの更新時刻を更新するなどで生存を示す
            # 実際には Watchdog プロセスへのソケット通信など
            with open("/tmp/brownie_survival.signal", "w") as f:
                f.write(str(asyncio.get_event_loop().time()))
            await asyncio.sleep(5)

    async def shutdown(self):
        """シャットダウン処理"""
        logger.info("Shutting down Brownie...")
        self.stop_event.set()

if __name__ == "__main__":
    config_file = os.getenv("BROWNIE_CONFIG", "config/config.yaml")
    app = BrownieApp(config_file)
    asyncio.run(app.run())
