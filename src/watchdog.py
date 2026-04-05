#!/usr/bin/env python3
import time
import os
import sys
import signal
import subprocess
import logging
from logging.handlers import RotatingFileHandler
import shutil
from typing import Optional

# プロジェクトルートをパスに追加
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.append(base_dir)

# ログディレクトリの作成
log_dir = os.path.join(base_dir, "logs")
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, "brownie.log")

# ログ設定 (ファイルと標準出力の両方に出力)
log_level = logging.DEBUG if os.environ.get("BROWNIE_DEBUG") == "1" else logging.INFO
logging.basicConfig(
    level=log_level,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[
        RotatingFileHandler(log_file, maxBytes=10*1024*1024, backupCount=5),
        logging.StreamHandler(sys.stdout)
    ]
)
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

        # シグナルハンドラの設定 (設計書 4.2 運用監視)
        signal.signal(signal.SIGINT, self._handle_exit_signal)
        signal.signal(signal.SIGTERM, self._handle_exit_signal)

    def _handle_exit_signal(self, signum, frame):
        """終了シグナル受信時の処理"""
        logger.info(f"Received signal {signum}. Shutting down Brownie...")
        self.is_running = False
        if self.process:
            logger.info("Terminating main process...")
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                logger.warning("Main process did not terminate. Force killing...")
                self.process.kill()
        
        if os.path.exists(self.survival_file):
            os.remove(self.survival_file)
        
        sys.exit(0)

    def start(self):
        """Watchdogの実行 (設計書 3.2)"""
        logger.info("Starting Brownie Watchdog...")
        
        while self.is_running:
            # 1. メインプロセスの起動・監視
            if self.process is None or self.process.poll() is not None:
                self._handle_restart()
            
            # 2. 生存信号の確認
            self._check_survival()
            
            # 3. リソース監視
            self._monitor_resources()
            
            # 終了フラグが立っていたらループを抜ける
            if not self.is_running:
                break
                
            time.sleep(30)

    def _handle_restart(self):
        """プロセス再起動と CrashLoopBackOff"""
        if self.crash_count >= self.max_crashes:
            logger.error("Too many crashes! System stopping.")
            self.is_running = False
            return
        
        # 指数バックオフ
        wait_time = min(2 ** self.crash_count, 60)
        if self.crash_count > 0:
            logger.info(f"Waiting {wait_time}s before restart...")
            time.sleep(wait_time)
            
        logger.info(f"Restarting main process (Attempt: {self.crash_count + 1})...")
        
        venv_python = os.path.join(base_dir, ".venv", "bin", "python")
        # メインプロセスを起動 (親の死を検知できるようにする等、将来的な拡張の余地を残す)
        self.process = subprocess.Popen(
            [venv_python, self.main_script],
            cwd=base_dir
        )
        
        self.crash_count += 1
        self.last_survival_time = time.time()

    def _check_survival(self):
        """生存信号の確認"""
        try:
            if os.path.exists(self.survival_file):
                mtime = os.path.getmtime(self.survival_file)
                if mtime > self.last_survival_time:
                    self.last_survival_time = mtime
                    if time.time() - self.last_survival_time < 60:
                        self.crash_count = 0
            
            # 1時間以上生存信号がなければハングアップとみなす
            # (GitHub APIのBackoffが40分程度になるケースがあるため、余裕を持たせる)
            if time.time() - self.last_survival_time > 3600:
                logger.warning("Main process seems hung (No survival signal for 1 hour). Killing it...")
                if self.process:
                    self.process.terminate()
        except Exception as e:
            logger.error(f"Survival check error: {e}")

    def _monitor_resources(self):
        """リソース監視"""
        usage = shutil.disk_usage("/")
        free_gb = usage.free / (1024**3)
        if free_gb < 2: # 閾値を少し下げて 2GB
            logger.error(f"Disk space critically low: {free_gb:.2f} GB left!")

if __name__ == "__main__":
    import fcntl
    from pathlib import Path
    
    # ロックファイルの取得
    lock_path = Path.home() / ".local" / "share" / "brownie" / "brownie.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    
    lock_f = open(lock_path, "w")
    try:
        fcntl.flock(lock_f, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        print("Error: Another Watchdog is already running.")
        sys.exit(1)

    script_path = os.path.join(os.path.dirname(__file__), "main.py")
    dog = Watchdog(script_path, "/tmp/brownie_survival.signal")
    dog.start()
