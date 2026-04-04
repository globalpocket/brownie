import re
import logging
import json
import httpx
from typing import Dict, Any, List, Optional
from src.workspace.sandbox import SandboxManager
from src.version import get_footer

logger = logging.getLogger(__name__)

class CoderAgent:
    def __init__(self, config: Dict[str, Any], sandbox: SandboxManager, state: 'StateManager', 
                 gh_client: Optional[GitHubClientWrapper] = None, 
                 http_client: Optional[httpx.AsyncClient] = None):
        self.config = config
        self.sandbox = sandbox
        self.state = state
        self.gh_client = gh_client
        self.http_client = http_client or httpx.AsyncClient(timeout=300.0)
        self.llm_endpoint = config['llm']['endpoint']
        self.model_name = config['llm']['model_name']
        self._target_language = "日本語" # デフォルト

    # 共通ルール定義 (設計書：安全性と物理制約の根幹)
    COMMON_RULES = """
1. **No Repetition**: Avoid repeating the same actions or tool calls without progress. If stuck, change your approach.
2. **Research First**: Always read the existing code in [Reference Root] before making any changes in [Workspace Root].
3. **No Unauthorized Pivoting (SECURITY)**: If a specific file or path is missing, DO NOT attempt to find alternatives or guess other files. This is a security vulnerability (path traversal/misdirection). Report the missing file immediately.
4. **Error Reporting Obligation**: If ANY error occurs, you MUST:
   - TRANSLATE the error into the target language.
   - SUMMARIZE the cause briefly.
   - REPORT it using `post_comment`.
   - TERMINATE immediately with `Finish`.
   - DO NOT suggest fixes or analyze further in this mode.
5. **Path Specification**: Always use relative paths from the root of the workspace or reference directory.
6. **Built-in Provenance**: Do not worry about Build IDs; the system will automatically append them.
"""

    async def plan_and_execute(self, task_id: str, repo_name: str, issue_number: int, issue_title: str, issue_body: str, 
                               is_mention: bool = False, location_type: str = "ISSUE", 
                               location_context: dict = None, instruction_priority: str = None) -> bool:
        """ReActベースの自律実行ループ (設計書 8.4)"""
        self._current_repo_name = repo_name
        self._task_id = task_id
        location_context = location_context or {}
        
        # 依頼者の使用言語を判定 (Issue本文 or メンション時の命令)
        detect_text = (issue_body or "") + (instruction_priority or "")
        self._target_language = self._detect_language(detect_text)
        logger.info(f"[{task_id}] Detected target language: {self._target_language}")
        
        if is_mention:
            logger.info(f"[{task_id}] Agent starting task from MENTION ({location_type}): {instruction_priority[:50]}...")
        else:
            logger.info(f"[{task_id}] Agent starting task: {issue_title}")
        
        context = {
            "repo_name": repo_name,
            "issue_number": issue_number,
            "issue_title": issue_title,
            "issue_body": issue_body,
            "is_mention": is_mention,
            "location_type": location_type,
            "location_context": location_context,
            "instruction_priority": instruction_priority,
            "history": []
        }

        max_steps = self.config['agent'].get('max_auto_retries', 15)
        
        for step in range(max_steps):
            # 1. LLMによる推論
            system_prompt, user_prompt = self._build_prompt(context)
            response = await self._call_llm(system_prompt, user_prompt)
            logger.info(f"[{task_id}] Step {step+1} LLM Response: {response}")
            
            # 2. アクションの抽出
            thought, action, action_input = self._parse_response(response)

            # 物理ループ検知（正規化：action が空なら "None" とする）
            norm_action = action if action else "None"
            current_action_signature = f"{norm_action}_{json.dumps(action_input, sort_keys=True, ensure_ascii=False)}"
            context["repeated_action_alert"] = False

            if len(context["history"]) >= 2:
                # 履歴内のアクションを正規化して比較（None や Retry を排除）
                last_actions = []
                for h_item in context["history"][-2:]:
                    h_action = h_item['action'] if h_item['action'] not in [None, "Retry"] else "None"
                    last_actions.append(f"{h_action}_{json.dumps(h_item['input'], sort_keys=True, ensure_ascii=False)}")
                
                if all(a == current_action_signature for a in last_actions):
                    # 同一アクションが 3 回連続（今回の1回 + 履歴の2回）した場合はハードストップ
                    logger.error(f"[{task_id}] Hard loop detected at Step {step+1}! Terminating task. Action: {norm_action}")
                    await self.gh_client.post_comment(repo_name, issue_number, f"❌ 無限ループを検知したため（同一アクションの3回連続実行）、作業を停止しました。\nアクション: `{norm_action}`\n\n一度指示を修正するか、現在のファイルを削除してやり直してください。" + get_footer())
                    return False
            
                # 3. アクションの実行（物理ガードレール：Zero Tolerance）
                action_lower = str(action).lower()
                safe_tools = ["finish", "post_comment", "none"]
                is_pivot_attempt = context.get('error_mode') and action_lower not in safe_tools
                
                # 進捗を GitHub にコメント（ピボット試行時は即退場）
                status_suffix = " (❌ ERROR: Unauthorized Pivot Attempt - Terminating)" if is_pivot_attempt else ""
                if self.gh_client and repo_name and issue_number:
                    action_display = f"{action}({json.dumps(action_input, ensure_ascii=False)})" if action else "None"
                    msg = f"### 🧠 Step {step+1}: {action or 'Thinking...'}{status_suffix}\n\n**Thought:** {thought or '...'}\n\n**Action:** `{action_display}`"
                    await self.gh_client.post_comment(repo_name, issue_number, msg + get_footer())

                if is_pivot_attempt:
                    logger.error(f"[{task_id}] Zero-Tolerance: Blocked pivot attempt: {action}")
                    await self.gh_client.post_comment(repo_name, issue_number, "❌ 【重大な指示違反】エラー発生後に許可されていないツール（ピボット）を呼び出しました。セキュリティ保護のため、タスクを強制終了します。" + get_footer())
                    return False

                if not thought and not action:
                    observation = "Error: 返答形式が不正です。JSONオブジェクトのみを返してください。"
                elif action == "Finish" or (not action and thought and "完了" in thought):
                    logger.info(f"[{task_id}] Agent decided to finish.")
                    return True
                else:
                    observation = await self._execute_action(repo_name, action, action_input, context)
                
                logger.info(f"[{task_id}] Step {step+1} Observation (first 500 chars): {observation[:500]}")
                
            # エラー検知によるガードレール（Sticky Mode）
            if observation.startswith("Error:") or observation.startswith("Agent Tool Error:"):
                # 一度 True になったら、このタスク中は False に戻さない
                context["error_mode"] = True
                context["error_obs"] = observation
            context["history"].append({
                "step": step + 1,
                "thought": thought or "Formatting error",
                "action": norm_action,
                "input": action_input,
                "observation": observation
            })
            
            # 【重要】履歴のトリミング (設計書：メモリ・DB肥大化防止)
            max_history = self.config['agent'].get('max_history_steps', 15)
            if len(context["history"]) > max_history:
                context["history"] = context["history"][-max_history:]
                logger.info(f"[{task_id}] History trimmed to latest {max_history} steps.")

            # 【重要】DB への逐次反映
            await self.state.update_task(task_id, "InProgress", repo_name, 
                                       issue_num=issue_number, context=context)

        logger.error("Reached maximum steps without completion.")
        return False

    async def _call_llm(self, system_prompt: str, user_prompt: str) -> str:
        try:
            resp = await self.http_client.post(
                f"{self.llm_endpoint}/chat/completions",
                json={
                    "model": self.model_name,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.0,
                    "response_format": {"type": "json_object"},
                    "options": {
                        "num_ctx": 32768
                    }
                }
            )
            if resp.status_code == 200:
                return resp.json()['choices'][0]['message']['content']
            else:
                return f"Error: LLM HTTP {resp.status_code} - {resp.text}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _get_language_resources(self, lang: str) -> Dict[str, str]:
        """ターゲット言語に基づいた表示ラベルと警告文を返す"""
        if lang == "日本語":
            return {
                "role": "あなたはGitHub Issueの解決に集中するプロフェッショナルなソフトウェアエンジニアです。",
                "role_pr": "あなたはプルリクエストを管理するプロフェッショナルなソフトウェアエンジニアです。",
                "enforcement": "【!! 言語の絶対遵守 !!】\n思考(`thought`)および出力は、**必ず 日本語 のみ**で行ってください。英語は禁止です。",
                "json_schema_desc": "【!! 応答形式の厳守 !!】\n応答は必ず単一の JSON オブジェクト（schema: thought, action）で返してください。",
                "loop_warning": "【警告】ループを検知しました。別のアプローチを選択してください。",
                "analysis_mode_title": "【!!! エラー報告モード !!!】",
                "analysis_mode_desc": "エラー内容を日本語で翻訳・要約し、`post_comment` 後に `Finish` してください。解決策の提示は禁止です。"
            }
        else:
            return {
                "role": "You are a professional software engineer focused on resolving GitHub Issues.",
                "role_pr": "You are a professional software engineer managing a Pull Request.",
                "enforcement": "【!! LANGUAGE ENFORCEMENT !!】\nYou MUST write your thought process and output in **English ONLY**.",
                "json_schema_desc": "【!! STRICT JSON FORMAT !!】\nRespond ONLY with a single JSON object (schema: thought, action).",
                "loop_warning": "【WARNING】Loop detected. Try a different approach.",
                "analysis_mode_title": "【!!! ERROR REPORTING MODE !!!】",
                "analysis_mode_desc": "Translate and Summarize the error in the target language via `post_comment`, then `Finish` immediately."
            }

    def _build_prompt(self, context: Dict[str, Any]) -> Tuple[str, str]:
        """システムプロンプトとユーザープロンプトを構築する"""
        is_mention = context.get('is_mention', False)
        loc_type = context.get('location_type', 'ISSUE')
        instruct = context.get('instruction_priority', '')
        
        # 1. ターゲット言語のリソース取得
        res = self._get_language_resources(self._target_language)
        
        common_json_schema = f"""
{{
  "thought": "Analysis and next steps. MUST BE IN {self._target_language}.",
  "action": {{
    "tool": "tool_name",
    "parameters": {{ "param": "value" }}
  }}
}}"""

        # 2. システムプロンプトの構築
        if context.get("error_mode"):
            system_prompt = f"""
{res['analysis_mode_title']}
{res['enforcement']}

{res['analysis_mode_desc']}

{res['json_schema_desc']}
{common_json_schema}

【Available Tools (STRICTLY LIMITED)】
- post_comment (parameters: {{ \"body\": \"string\" }}) : Report the error.
- Finish (parameters: {{}}) : Call immediately after reporting.
"""
        else:
            role = res['role_pr'] if loc_type.startswith("PR") else res['role']
            system_prompt = f"""{role}
{res['enforcement']}

{res['json_schema_desc']}
{common_json_schema}

【Available Tools】
- list_files, read_file, write_file, run_command, post_comment, close_pull_request, merge_pull_request, Finish

【Rules (MANDATORY)】
{self.COMMON_RULES}
"""

        # 3. 履歴文字列の構築
        history_str = ""
        max_history_to_include = 10
        total_history = len(context["history"])
        start_idx = max(0, total_history - max_history_to_include)
        
        relevant_history = context["history"][start_idx:]
        num_relevant = len(relevant_history)

        for i, h in enumerate(relevant_history):
            input_str = json.dumps(h['input'], ensure_ascii=False)
            is_latest = (i == num_relevant - 1)
            
            if is_latest:
                obs_limit = 4000
            elif i >= num_relevant - 3:
                obs_limit = 1000
            else:
                obs_limit = 200
            
            obs = h['observation']
            if len(obs) > obs_limit:
                obs = obs[:obs_limit] + f"\n... (truncated {len(obs) - obs_limit} chars)"
            
            history_str += f"\nStep {h['step']}:\nThought: {h['thought']}\nAction: {h['action']}({input_str})\nObservation: {obs}\n"

        # 4. ユーザープロンプト（タスクと履歴）の構築
        ref_info = self.sandbox.reference_root or "Not set"
        ws_info = self.sandbox.workspace_root or "Not set"
        
        # 条件付きメッセージの事前構築
        instruct_msg = f"(Additional Instructions: {instruct})" if (is_mention and instruct) else ""
        loop_msg = f"[LOOP WARNING] {res['loop_warning']}" if context.get('repeated_action_alert') else ""
        
        error_report_msg = ""
        if context.get('error_mode'):
            error_report_msg = f"""
【!!! CRITICAL ERROR: REPORTING ONLY !!!】
Last operation failed: {context['error_obs']}
PROHIBITED: read_file, list_files, run_command, write_file.
REQUIRED: Translate and Summarize the above error in THE TARGET LANGUAGE via `post_comment`, then `Finish` immediately.
"""

        user_prompt = f"""
【Target Issue】: {context['issue_title']}
{instruct_msg}
[Target Language]: {self._target_language}

[Reference Root (Read-only)]: {ref_info}
[Workspace Root (Write/Test)]: {ws_info}

【Execution History】
{history_str}

Issue Body:
{context['issue_body']}

{loop_msg}
{error_report_msg}

Based on the execution history above, what is your next step? (Respond with a SINGLE JSON object)
"""
        return system_prompt, user_prompt

    def _parse_response(self, response: str):
        """JSON オブジェクトをパースして Thought と Action を抽出する"""
        thought = ""
        action = None
        action_input = {}

        clean_resp = response.strip()
        if clean_resp.startswith("```json"):
            clean_resp = clean_resp[len("```json"):].strip()
        if clean_resp.endswith("```"):
            clean_resp = clean_resp[:-3].strip()

        try:
            data = json.loads(clean_resp)
            thought = data.get("thought", "")
            action_data = data.get("action", {})
            action = action_data.get("tool")
            action_input = action_data.get("parameters", {})
        except Exception as e:
            logger.error(f"Failed to parse JSON response: {e}")
            if "{" in response and "}" in response:
                try:
                    start = response.find("{")
                    end = response.rfind("}") + 1
                    data = json.loads(response[start:end])
                    thought = data.get("thought", "")
                    action_data = data.get("action", {})
                    action = action_data.get("tool")
                    action_input = action_data.get("parameters", {})
                except:
                    pass
        
        return thought, action, action_input

    async def _execute_action(self, repo_name: str, action: str, action_input: Any, context: Dict[str, Any]) -> str:
        """JSON 形式の引数を受け取って実行する"""
        if not action: return "Error: 有効な Action (JSONブロック) が見つかりませんでした。"
        action_lower = action.lower()
        
        try:
            if action_lower == "finish":
                return "Task completed successfully."
            
            if not isinstance(action_input, dict):
                return f"Error: Parameters must be a dictionary, got {type(action_input)}"

            if action_lower == "list_files":
                return await self.sandbox.list_files(action_input.get("path", "."))
            elif action_lower == "read_file":
                return await self.sandbox.read_file(action_input.get("path"))
            elif action_lower == "write_file":
                return await self.sandbox.write_file(action_input.get("path"), action_input.get("content"))
            elif action_lower == "run_command":
                res = await self.sandbox.run_command(action_input.get("command"))
                prefix = "Error: " if res['exit_code'] != 0 else ""
                return f"{prefix}ExitStatus: {res['exit_code']}\nLogs: {res['logs']}"
            elif action_lower == "post_comment":
                body = action_input.get("body")
                if not body: return "Error: 'body' is required."
                
                # 自動翻訳ガードレール (v16)
                translated_body = await self._translate_if_needed(body, self._target_language)
                
                await self.gh_client.post_comment(repo_name, context["issue_number"], translated_body + get_footer())
                return "Successfully posted comment to GitHub."
            elif action_lower == "close_pull_request":
                num = action_input.get("pull_number")
                if num is None: return "Error: 'pull_number' is required."
                await self.gh_client.close_pull_request(repo_name, int(num))
                return f"Goal achieved: Successfully closed PR #{num}. Please call Finish() now."
            elif action_lower == "merge_pull_request":
                num = action_input.get("pull_number")
                if num is None: return "Error: 'pull_number' is required."
                await self.gh_client.merge_pull_request(repo_name, int(num))
                return f"Goal achieved: Successfully merged PR #{num}. Please call Finish() now."
            
            allowed_tools = ["list_files", "read_file", "write_file", "run_command", "close_pull_request", "merge_pull_request", "Finish"]
            return f"Unknown action: '{action}'. 利用可能なツールは {allowed_tools} のみです。"
        except Exception as e:
            return f"Agent Tool Error: {str(e)}"

    def _detect_language(self, text: str) -> str:
        """テキストから主に使用されている言語を判定する"""
        if not text: return "日本語"
        if re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text): return "日本語"
        return "English"

    async def _translate_if_needed(self, text: str, target_lang: str) -> str:
        """テキストがターゲット言語と一致しない場合、LLMを使用して自動翻訳するセーフティネット"""
        needs_translation = False
        if target_lang == "日本語" and not re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text):
            needs_translation = True
        elif target_lang == "English" and re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text):
            needs_translation = True
            
        if not needs_translation:
            return text

        logger.info(f"Language mismatch detected. Translating text to {target_lang}...")
        
        system_prompt = f"""You are a professional translator. Translate the following text into {target_lang} fluently and naturally. 
Keep the original meaning, tone, and technical terms.

You MUST respond with a SINGLE JSON object in the following format:
{{
  "translation": "your translated text here"
}}
No other explanation or text is allowed."""
        
        user_prompt = f"Text to translate:\n{text}"
        
        translated = await self._call_llm(system_prompt, user_prompt)
        
        if translated.strip().startswith("{"):
            try:
                data = json.loads(translated)
                return data.get("translation") or data.get("translated_text") or translated
            except:
                pass
        
        return translated.strip()
