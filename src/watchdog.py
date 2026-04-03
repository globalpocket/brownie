import time
import os
import sys
import signal
import subprocess
import logging
import shutil
import psutil # psutil は依存関係に追加する必要がある
from typing import Optional

# プロジェクトルートをパスに追加 (設計書 3.2 補足)
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

# ログ設定
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(name)s: %(message)s')
logger = logging.getLogger("brownie.watchdog")

class Watchdog:
    def __init__(self, main_script: str, survival_file: str):
        self.main_script = main_script
        self.survival_file = survival_file
        self.process: Optional[subprocess.Popen] = None
        self.last_survival_time = time.time()
        self.crash_count = 0
        self.max_crashes = 5
        self.is_running = True

    def start(self):
        """Watchdogの実行 (設計書 3.2: プロセス監視・ロールバック・CrashLoopBackOff)"""
        logger.info("Starting Brownie Watchdog...")
        
        while self.is_running:
            # 1. メインプロセスの起動・監視
            if self.process is None or self.process.poll() is not None:
                self._handle_restart()
            
            # 2. 生存信号の確認 (設計書 3.2: 生存信号)
            self._check_survival()
            
            # 3. リソース監視 (設計書 3.2: OOM/Disk 監視)
            self._monitor_resources()
            
            time.sleep(10)

    def _handle_restart(self):
        """プロセス再起動と CrashLoopBackOff (設計書 9. CrashLoopBackOff)"""
        if self.crash_count >= self.max_crashes:
            logger.error("Too many crashes! Out-of-Band (OOB) notification sent.")
            # 外部通知 (設計書 5.1: oob_webhook_url)
            self.is_running = False
            return
        
        # 指数バックオフ
        wait_time = min(2 ** self.crash_count, 60)
        if self.crash_count > 0:
            logger.info(f"Waiting {wait_time}s before restart...")
            time.sleep(wait_time)
            
        logger.info(f"Restarting main process (Attempt: {self.crash_count + 1})...")
        
        # 仮想環境のPythonを使用する
        venv_python = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".venv", "bin", "python")
        self.process = subprocess.Popen([venv_python, self.main_script])
        
        self.crash_count += 1
        self.last_survival_time = time.time()

    def _check_survival(self):
        """生存信号の確認 (設計書 4. ハートビート受信)"""
        try:
            if os.path.exists(self.survival_file):
                mtime = os.path.getmtime(self.survival_file)
                if mtime > self.last_survival_time:
                    self.last_survival_time = mtime
                    # 正常に動作していればクラッシュカウントをリセット
                    if time.time() - self.last_survival_time < 60:
                        self.crash_count = 0
            
            # 5分以上生存信号がなければハングアップとみなす
            if time.time() - self.last_survival_time > 300:
                logger.warning("Main process seems hung. Killing it...")
                if self.process:
                    self.process.terminate()
                    self.process.wait(timeout=10)
        except Exception as e:
            logger.error(f"Survival check error: {e}")

    def _monitor_resources(self):
        """リソース監視 (設計書 10. OOM/Disk監視)"""
        # 1. ディスク残量監視
        usage = shutil.disk_usage("/")
        free_gb = usage.free / (1024**3)
        if free_gb < 5: # 5GB未満で警告/停止
            logger.error(f"Disk space low: {free_gb:.2f} GB left! Pausing operations.")
            if self.process:
                os.kill(self.process.pid, signal.SIGSTOP) # 一時停止 (設計書 10. インフラ保護)
        
        # 2. メモリ監視 (psutil)
        mem = psutil.virtual_memory()
        if mem.percent > 95:
            logger.error("Memory usage critically high!")
            # 必要に応じて LLM コンテナ等の停止を指示

if __name__ == "__main__":
    import os
    script_path = os.path.join(os.path.dirname(__file__), "main.py")
    dog = Watchdog(script_path, "/tmp/brownie_survival.signal")
    dog.start()
