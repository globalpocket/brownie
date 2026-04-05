import os
import hashlib
import sqlite3
import logging
import duckdb
import asyncio
from typing import List, Dict, Any, Optional

try:
    from tree_sitter import Language, Parser
    import tree_sitter_python
    import tree_sitter_javascript
    import tree_sitter_typescript
    import tree_sitter_go
except ImportError:
    # セットアップが完了していない場合（実行時にエラーとする）
    pass

logger = logging.getLogger(__name__)

class CodeAnalyzer:
    def __init__(self, repo_root: str):
        self.repo_root = os.path.realpath(repo_root)
        self.brwn_dir = os.path.join(self.repo_root, ".brwn")
        self.db_path = os.path.join(self.brwn_dir, "index.db")
        self._ensure_brwn_dir()
        self.conn = duckdb.connect(self.db_path)
        self._init_db()
        self.parsers = self._init_parsers()

    def _ensure_brwn_dir(self):
        """ .brwn ディレクトリの作成と .gitignore への追加 """
        if not os.path.exists(self.brwn_dir):
            os.makedirs(self.brwn_dir, exist_ok=True)
            logger.info(f"Created .brwn workspace at {self.repo_root}")
        
        # .gitignore への追記（推奨：AIが生成した一時的な知識ベースであることを明示）
        gitignore_path = os.path.join(self.repo_root, ".gitignore")
        ignore_entry = "\n# Brownie Context Data\n.brwn/\n"
        
        if os.path.exists(gitignore_path):
            with open(gitignore_path, "r") as f:
                content = f.read()
            if ".brwn/" not in content:
                with open(gitignore_path, "a") as f:
                    f.write(ignore_entry)
        else:
            with open(gitignore_path, "w") as f:
                f.write(ignore_entry)

    def _init_db(self):
        """ DuckDB テーブルの初期化 """
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                hash TEXT,
                last_scanned TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        self.conn.execute("CREATE SEQUENCE IF NOT EXISTS symbol_id_seq")
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS symbols (
                id INTEGER PRIMARY KEY DEFAULT nextval('symbol_id_seq'),
                file_path TEXT,
                name TEXT,
                type TEXT, -- 'class', 'function', 'method'
                start_line INTEGER,
                end_line INTEGER
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS calls (
                caller_name TEXT,
                callee_name TEXT,
                file_path TEXT,
                line INTEGER
            )
        """)

    def _init_parsers(self) -> Dict[str, Parser]:
        """ 各言語の Tree-sitter パーサを初期化 """
        parsers = {}
        try:
            # Python
            py_lang = Language(tree_sitter_python.language())
            parsers['python'] = Parser(py_lang)
            
            # JS/TS
            js_lang = Language(tree_sitter_javascript.language())
            parsers['javascript'] = Parser(js_lang)
            
            ts_lang = Language(tree_sitter_typescript.language_typescript())
            parsers['typescript'] = Parser(ts_lang)

            # Go
            go_lang = Language(tree_sitter_go.language())
            parsers['go'] = Parser(go_lang)
            
        except Exception as e:
            logger.error(f"Failed to initialize tree-sitter parsers: {e}")
        
        return parsers

    def _get_queries(self, lang: str):
        """ 各言語のシンボル抽出用クエリを定義 """
        if lang == 'python':
            return """
                (class_definition name: (identifier) @class.name) @class.def
                (function_definition name: (identifier) @func.name) @func.def
                (call function: (identifier) @call.name) @call.expr
                (call function: (attribute attribute: (identifier) @call.name)) @call.expr
            """
        elif lang in ('javascript', 'typescript'):
            return """
                (class_declaration name: (identifier) @class.name) @class.def
                (function_declaration name: (identifier) @func.name) @func.def
                (method_definition name: (property_identifier) @func.name) @func.def
                (call_expression function: (identifier) @call.name) @call.expr
                (call_expression function: (member_expression property: (property_identifier) @call.name)) @call.expr
            """
        elif lang == 'go':
            return """
                (type_spec name: (type_identifier) @class.name) @class.def
                (function_declaration name: (identifier) @func.name) @func.def
                (method_declaration name: (field_identifier) @func.name) @func.def
                (call_expression function: (identifier) @call.name) @call.expr
                (call_expression function: (selector_expression field: (field_identifier) @call.name)) @call.expr
            """
        return ""

    async def scan_project(self):
        """ プロジェクト全体のフルスキャン (Async) """
        logger.info(f"Scanning project for deep context: {self.repo_root}")
        
        loop = asyncio.get_event_loop()
        for root, dirs, files in os.walk(self.repo_root):
            # 除外ディレクトリ
            dirs[:] = [d for d in dirs if not d.startswith(".") and d not in ("node_modules", "vendor", "venv", ".venv")]
            
            for file in files:
                ext = os.path.splitext(file)[1].lower()
                if ext in ('.py', '.js', '.ts', '.go'):
                    full_path = os.path.join(root, file)
                    rel_path = os.path.relpath(full_path, self.repo_root)
                    # CPU バウンドな解析処理をスレッドプールで実行
                    await asyncio.to_thread(self._scan_file, full_path, rel_path)
        
        logger.info(f"Deep context scan completed for {self.repo_root}")

    def _get_file_hash(self, path: str) -> str:
        """ ファイルの MD5 ハッシュを取得 """
        hasher = hashlib.md5()
        with open(path, 'rb') as f:
            buf = f.read()
            hasher.update(buf)
        return hasher.hexdigest()

    def _scan_file(self, full_path: str, rel_path: str):
        """ 個別ファイルの解析とインデックス更新 """
        try:
            current_hash = self._get_file_hash(full_path)
            
            # ハッシュチェック（変更がなければスキップ）
            res = self.conn.execute("SELECT hash FROM files WHERE path = ?", (rel_path,)).fetchone()
            if res and res[0] == current_hash:
                return

            logger.debug(f"Parsing {rel_path}...")
            
            # 言語の特定
            ext = os.path.splitext(full_path)[1].lower()
            lang_key = 'python' if ext == '.py' else 'javascript' if ext == '.js' else 'typescript' if ext == '.ts' else 'go'
            parser = self.parsers.get(lang_key)
            if not parser: return

            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()

            tree = parser.parse(bytes(content, "utf-8"))
            query_str = self._get_queries(lang_key)
            if not query_str: return

            from tree_sitter import Query, QueryCursor
            language = self.parsers[lang_key].language
            query = Query(language, query_str)
            cursor = QueryCursor(query)
            captures = cursor.captures(tree.root_node)

            # 既存の当該ファイル情報をクリア
            self.conn.execute("DELETE FROM symbols WHERE file_path = ?", (rel_path,))
            self.conn.execute("DELETE FROM calls WHERE file_path = ?", (rel_path,))

            # シンボル情報の抽出と保存
            # Tree-sitter 0.22+ では captures() はタグ名をキーとした辞書を返す場合がある
            if isinstance(captures, dict):
                for tag, nodes in captures.items():
                    for node in nodes:
                        self._process_single_capture(rel_path, node, tag)
            else:
                # 従来のタプル形式の場合
                for node, tag in captures:
                    self._process_single_capture(rel_path, node, tag)

            # ファイルハッシュの更新
            self.conn.execute("INSERT OR REPLACE INTO files (path, hash) VALUES (?, ?)", (rel_path, current_hash))
            
        except Exception as e:
            logger.error(f"Error scanning {rel_path}: {e}")

    def _process_single_capture(self, rel_path: str, node: Any, tag: str):
        """ 単一のキャプチャ（ノードとタグ）を処理して DB に保存 """
        try:
            start_line = node.start_point[0] + 1
            end_line = node.end_point[0] + 1
            
            if tag.endswith(".def"):
                return 

            if tag.endswith(".name"):
                name = node.text.decode('utf-8')
                symbol_type = tag.split('.')[0] # 'class' or 'func'
                
                if symbol_type in ('class', 'func'):
                    self.conn.execute("""
                        INSERT INTO symbols (file_path, name, type, start_line, end_line)
                        VALUES (?, ?, ?, ?, ?)
                    """, (rel_path, name, symbol_type, start_line, end_line))
                    
            elif tag == "call.name":
                # 呼び出し関係の保存
                call_name = node.text.decode('utf-8')
                self.conn.execute("""
                    INSERT INTO calls (caller_name, callee_name, file_path, line)
                    VALUES (?, ?, ?, ?)
                """, ("global", call_name, rel_path, start_line))
                
        except Exception as e:
            logger.error(f"Error processing capture in {rel_path}: {e}")

    def close(self):
        self.conn.close()

if __name__ == "__main__":
    # 簡易テスト
    analyzer = CodeAnalyzer(".")
    analyzer.scan_project()
    analyzer.close()
