import os
import logging
from pathlib import Path
from typing import Optional, Union

logger = logging.getLogger(__name__)

class WorkspaceContext:
    def __init__(self, root_path: str, reference_path: Optional[str] = None):
        """
        ワークスペースのコンテキストを管理する。
        
        Args:
            root_path: ワークスペースのルート（書き込み可能、優先読み込み）
            reference_path: 参照用ルート（読み取り専用、フォールバック用）
        """
        self.root_path = Path(os.path.realpath(root_path))
        self.reference_path = Path(os.path.realpath(reference_path)) if reference_path else None
        
        logger.info(f"WorkspaceContext initialized. root={self.root_path}, reference={self.reference_path}")

    def resolve_path(self, target_path: str, strict: bool = True) -> Path:
        """
        AIエージェントから渡されたパスを安全な物理絶対パスに解決する。
        
        Args:
            target_path: 解決したいパス（相対・絶対いずれも可）
            strict: Trueの場合、root_path 外へのアクセスを禁止する (Path Traversal 防御)
            
        Returns:
            Path: 解決された絶対パス
            
        Raises:
            PermissionError: 境界外へのアクセスが検出された場合
        """
        # 1. パスの正規化
        p = Path(target_path)
        
        if p.is_absolute():
            full_path = p.resolve()
        else:
            full_path = (self.root_path / p).resolve()

        # 2. 境界チェック
        if strict:
            if not self._is_within(full_path, self.root_path):
                # 読み取り操作の場合、reference_path 内にあれば許可（フォールバック）
                if self.reference_path and self._is_within(full_path, self.reference_path):
                    return full_path
                
                logger.error(f"Security Alert: Path Traversal attempt detected: {target_path} -> {full_path}")
                raise PermissionError(f"Access denied. Path '{target_path}' is outside the authorized workspace.")
        
        return full_path

    def get_relative_path(self, absolute_path: Union[str, Path]) -> str:
        """
        絶対パスをリポジトリルートからの相対パスに変換する。
        AIへの出力時に使用。
        """
        abs_p = Path(absolute_path).resolve()
        try:
            return os.path.relpath(abs_p, self.root_path)
        except ValueError:
            # root_path 外の場合
            if self.reference_path:
                try:
                    return os.path.relpath(abs_p, self.reference_path)
                except ValueError:
                    pass
            return str(abs_p)

    def _is_within(self, child: Path, parent: Path) -> bool:
        """child が parent の配下にあるか判定する"""
        try:
            # Python 3.9+ supports is_relative_to
            return child.resolve().is_relative_to(parent.resolve())
        except (ValueError, AttributeError):
            # Fallback for even older versions or unexpected errors
            try:
                os.path.relpath(child.resolve(), parent.resolve())
                return not os.path.relpath(child.resolve(), parent.resolve()).startswith("..")
            except ValueError:
                return False
