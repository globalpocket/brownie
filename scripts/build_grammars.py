import logging
import sys

# ロギング設定
logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')
logger = logging.getLogger(__name__)

def check_analysis_grammars():
    """インストールされた Tree-sitter 文法パッケージのロードテスト"""
    langs_to_check = {
        "python": "tree_sitter_python",
        "javascript": "tree_sitter_javascript",
        "typescript": "tree_sitter_typescript",
        "go": "tree_sitter_go",
    }

    try:
        from tree_sitter import Language
    except ImportError:
        logger.error("tree-sitter Python package is not installed.")
        return False

    success = True
    for name, module_name in langs_to_check.items():
        try:
            # 1. 各言語モジュールをインポート
            mod = __import__(module_name)
            
            # 2. Language クラスによるロードテスト (v0.22+ 方式)
            # TypeScript の場合は関数の名前が異なるため個別対応
            if name == "typescript":
                lang = Language(mod.language_typescript())
            else:
                lang = Language(mod.language())
                
            logger.info(f"Successfully loaded {name} grammar (version {mod.__version__ if hasattr(mod, '__version__') else 'unknown'})")
        except ImportError:
            logger.warning(f"Grammar package '{module_name}' is not installed.")
            success = False
        except Exception as e:
            logger.error(f"Failed to load {name} grammar: {e}")
            success = False

    return success

if __name__ == "__main__":
    if check_analysis_grammars():
        logger.info("All analysis grammars are ready.")
        sys.exit(0)
    else:
        logger.error("Some grammars failed to load. Please check installation.")
        sys.exit(1)
