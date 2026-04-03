import docker
import yaml
import logging
import re
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

class SandboxManager:
    def __init__(self, user_id: int, group_id: int):
        self.client = docker.from_env()
        self.user_id = user_id
        self.group_id = group_id

    def sanitize_compose_yaml(self, yaml_content: str) -> str:
        """YAMLサニタイザー (設計書 8. サンドボックス & 実行環境)
        privileged, volumesマウント等の攻撃をブロックし、
        非Root実行ユーザーを指定する。
        """
        data = yaml.safe_load(yaml_content)
        
        # サービスごとのループ
        if 'services' in data:
            for service_name, config in data['services'].items():
                # 1. privileged 禁止
                if 'privileged' in config:
                    logger.warning(f"Removing privileged flag from {service_name}")
                    del config['privileged']
                
                # 2. volumes マウントの制限 (ホスト側のマウントを禁止、名前付きボリュームのみ許可など)
                # 設計上は workspace ディレクトリのみマウントするように調整
                if 'volumes' in config:
                    new_volumes = []
                    for vol in config['volumes']:
                        if isinstance(vol, str) and ":" in vol:
                            # ホストパスが "/etc" や "/" であれば削除
                            host_path = vol.split(":")[0]
                            if host_path in ["/", "/etc", "/root", "/var/run/docker.sock"]:
                                logger.warning(f"Forbidden volume mount detected: {vol}")
                                continue
                        new_volumes.append(vol)
                    config['volumes'] = new_volumes
                
                # 3. 実行ユーザーの指定 (設計書 3.2: ホスト側の権限ロック回避)
                config['user'] = f"{self.user_id}:{self.group_id}"
                
                # 4. ネットワーク隔離
                # デフォルトでは分離されたブリッジネットワークを使用
        
        return yaml.dump(data)

    async def run_in_sandbox(self, task_id: str, command: str, image: str = "ubuntu:22.04") -> Dict[str, Any]:
        """Docker 経由でコマンドを実行。ログマスキング適用。 (設計書 7.1)"""
        try:
            container = self.client.containers.run(
                image=image,
                command=command,
                user=f"{self.user_id}:{self.group_id}",
                detach=True,
                labels={"brownie_task_id": task_id}
            )
            
            result = container.wait()
            logs = container.logs().decode("utf-8")
            
            # ログマスキング (設計書 7.1: ログスクラビング)
            masked_logs = self._mask_sensitive_data(logs)
            
            container.remove()
            
            return {
                "exit_code": result["StatusCode"],
                "logs": masked_logs
            }
        except Exception as e:
            logger.error(f"Sandbox execution error: {e}")
            return {"exit_code": -1, "logs": str(e)}

    def _mask_sensitive_data(self, text: str) -> str:
        """機密情報のマスキング (設計書 7.1: ログスクラビング)"""
        # APIキー、パスワード等のパターンにマッチする箇所を *** に置換
        patterns = [
            r"ghp_[a-zA-Z0-9]{36}", # GitHub Token
            r"(password|secret)=\S+",
            r"Bearer \S+"
        ]
        for p in patterns:
            text = re.sub(p, r"\1=***" if "=" in p else "***", text, flags=re.IGNORECASE)
        return text

    def cleanup_orphans(self):
        """オーファンコンテナ・ボリュームの定期GC (設計書 8.4 浄化)"""
        containers = self.client.containers.list(all=True, filters={"label": "brownie_task_id"})
        for c in containers:
            if c.status != "running":
                logger.info(f"Removing orphan container: {c.id}")
                c.remove()
        
        self.client.volumes.prune()
