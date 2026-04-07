import docker
import os
import yaml
import logging

logger = logging.getLogger(__name__)

class SandboxManager:
    def __init__(self, user_id: int, group_id: int):
        self.user_id = user_id
        self.group_id = group_id
        self.workspace_root = None
        self.reference_root = None
        try:
            self.client = docker.from_env()
            self.client.ping()
        except Exception:
            # Mac / Linux の標準的なソケットパスを試行 (設計書 11.2 補足)
            paths = [
                f"unix://{os.path.expanduser('~/.docker/run/docker.sock')}",
                "unix:///var/run/docker.sock"
            ]
            self.client = None
            for path in paths:
                try:
                    self.client = docker.DockerClient(base_url=path)
                    self.client.ping()
                    break
                except Exception:
                    self.client = None
            
            if not self.client:
                # 最終的なフォールバック（エラーメッセージを分かりやすくする）
                raise RuntimeError("Docker daemon not found. Please ensure Docker Desktop is running. "
                                 "On Mac, you may need to set: export DOCKER_HOST='unix://$HOME/.docker/run/docker.sock'")

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

    def dump(self, data): # Added for compatibility if needed
        return yaml.dump(data)

    def set_workspace_root(self, root_path: str):
        """ワークスペースのルートパスを設定する"""
        self.workspace_root = os.path.realpath(root_path)
        logger.info(f"Sandbox workspace root set to: {self.workspace_root}")

    def set_reference_root(self, ref_path: str):
        """参照用（ローカル）ルートを設定する"""
        self.reference_root = os.path.realpath(ref_path)
        logger.info(f"Sandbox reference root set to: {self.reference_root}")

    def _get_full_path(self, path: str, rw: bool = False) -> str:
        """パスの正規化とセキュリティチェック (設計書 4.2)"""
        if not self.workspace_root:
            raise RuntimeError("Workspace root is not set.")
        
        # ワークスペース内として解決を試みる。
        # Pythonの os.path.join は絶対パスが与えられた場合後ろの引数のみを返す。
        # ユーザー環境の実パスを許容するため、そのまま結合・解決し、後続のスコープ検証に委ねる。
        full_path = os.path.normpath(os.path.join(self.workspace_root, path))
        
        # 書き込み操作(rw=True)の場合、必ずワークスペース内であることを強制
        if rw:
            if not full_path.startswith(self.workspace_root):
                logger.error(f"Write operation denied outside workspace: {full_path}")
                raise PermissionError("Write access denied outside the workspace area.")
            return full_path

        # 3. 読み込み操作の場合、ワークスペースになければ参照用リポジトリ(Local)を探す
        if os.path.exists(full_path):
            return full_path
        
        if self.reference_root:
            ref_path = os.path.normpath(os.path.join(self.reference_root, path))
            # 参照ルート内かつ実在する場合のみ許可
            if ref_path.startswith(self.reference_root) and os.path.exists(ref_path):
                return ref_path
            
        return full_path

    async def list_files(self, path: str = ".", max_depth: int = 1) -> str:
        """指定されたパスのファイル一覧を取得する (max_depth で制御可能)"""
        full_path = self._get_full_path(path, rw=False)
        if not os.path.exists(full_path):
            # パスが見わからない場合、例外を投げずに AI へのヒントを返して自律復旧を促す
            return f"Error: Path '{path}' not found. Please check the directory structure (e.g., did you mean 'src/{path}'?)."
        
        output = []
        for root, dirs, files in os.walk(full_path):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            rel_root = os.path.relpath(root, full_path)
            prefix = "" if rel_root == "." else rel_root + "/"
            
            # 整形
            output_items = []
            for d in sorted(dirs):
                output_items.append(f"[DIR]  {prefix}{d}/")
            for f in sorted(files):
                if not f.startswith("."):
                    output_items.append(f"[FILE] {prefix}{f}")
            
            output.extend(output_items)
            
            # 深さ制限
            current_depth = 0 if rel_root == "." else rel_root.count(os.sep) + 1
            if current_depth >= max_depth:
                del dirs[:]
        
        if not output:
            return "(Empty directory)"
            
        return "\n".join(output)

    async def read_file(self, path: str) -> str:
        """ファイル内容を読み取る"""
        full_path = self._get_full_path(path, rw=False)
        if not os.path.exists(full_path):
            return f"Error: File '{path}' not found. Please check if you missed a directory prefix (e.g., 'src/{path}'). Verify with list_files."
        if os.path.isdir(full_path):
            return f"Error: '{path}' is a directory. Use list_files to list its contents."
        
        # macOS などの大文字小文字を区別しないファイルシステムへの対策（厳密チェック）
        dirname, basename = os.path.split(os.path.realpath(full_path))
        if basename and basename not in os.listdir(dirname):
            return f"Error: File '{path}' not found (case-sensitive check failed). Verify the exact spelling."
        
        with open(full_path, "r", encoding="utf-8") as f:
            content = f.read()
            if not content:
                return f"(File {path} is empty)"
            return f"--- Contents of {path} (Full) ---\n{content}\n--- End of {path} ---"

    async def write_file(self, path: str, content: str) -> str:
        """ファイルに内容を書き込む"""
        full_path = self._get_full_path(path, rw=True)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)
        return f"Successfully written to {path}."

    def cleanup_orphans(self):
        """オーファンコンテナ・ボリュームの定期GC (設計書 8.4 浄化)"""
        containers = self.client.containers.list(all=True, filters={"label": "brownie_task_id"})
        for c in containers:
            if c.status != "running":
                logger.debug(f"Removing orphan container: {c.id}")
                try:
                    c.remove()
                except Exception:
                    pass
        
        self.client.volumes.prune()
