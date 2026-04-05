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
7. **Strict Adherence (NO MEDDLING)**: Execute ONLY the explicitly requested task. Do not make unsolicited changes, do not create or modify files unprompted, and do not try to "help" by guessing goals. If the instruction is vague (e.g., "continue"), only do what was clearly requested in the issue originally, or stop and ask for clarification using `post_comment` and `Finish`.
8. **Terminology Definitions**: In the context of Issue body or comments, the word "Issue" refers to the GitHub Issue of this repository. The word "Wiki" refers to the GitHub Wiki of this repository. Do not confuse them with local files unless explicitly specified.
9. **Verification of Current State**: Before concluding a comparison task, you should list files in the workspace (using `list_files` or `run_command`) to understand the current implementation state. 
10. **Atomic Issue Creation**: Once a specific difference is registered as an Issue, do not repeat the same issue creation. Record your progress in `thought`. If you accidentally created duplicate or incorrect issues, you may use `close_issue` to clean up.
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
        
        # 意図解析 (Intent Analysis) - 設計書拡張 (v21)
        intent = await self._analyze_intent(issue_title, issue_body or "", instruction_priority or "")
        logger.info(f"[{task_id}] Intent Analysis: {intent['category']} - {intent['goal']}")

        # GitHubへ意図解析結果を報告
        if self.gh_client:
            intent_msg = f"### 🔍 Initial Intent Analysis\n"
            intent_msg += f"- **Category**: `{intent['category']}`\n"
            intent_msg += f"- **Goal**: {intent['goal']}\n"
            if intent['constraints']:
                intent_msg += f"- **Constraints**: {', '.join(intent['constraints'])}\n"
            intent_msg += f"- **Next Step**: {intent['initial_action_suggestion']}\n"
            await self.gh_client.post_comment(repo_name, issue_number, intent_msg + get_footer())

        context = {
            "repo_name": repo_name,
            "issue_number": issue_number,
            "issue_title": issue_title,
            "issue_body": issue_body,
            "intent_analysis": intent,  # 判定結果を定着
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
            
            # 3. アクションの実行（Python例外によるフェイルセーフ）
            if self.gh_client and repo_name and issue_number:
                req_json = context["history"][-1] if len(context["history"]) > 0 else "Initial Execution"
                resp_json = {
                    "thought": thought,
                    "action": {
                        "tool": action,
                        "parameters": action_input
                    }
                }
                msg = f"### 💬 Step {step+1} Request\n```json\n{json.dumps(req_json, ensure_ascii=False, indent=2)}\n```\n\n### 🧠 Step {step+1} Response\n```json\n{json.dumps(resp_json, ensure_ascii=False, indent=2)}\n```"
                await self.gh_client.post_comment(repo_name, issue_number, msg + get_footer())

            try:
                if not thought and not action:
                    raise ValueError("返答形式が不正です。JSONオブジェクトのみを返してください。")
                elif action == "Finish" or (not action and thought and "完了" in thought):
                    logger.info(f"[{task_id}] Agent decided to finish.")
                    return True
                else:
                    observation = await self._execute_action(repo_name, action, action_input, context)
            except Exception as e:
                # Pythonレベルでエラーを検知し、アナライザLLMで日本語解析・報告後、直ちにAIループを遮断
                logger.warning(f"[{task_id}] Exception caught during action {action}: {e}")
                await self._analyze_and_report_error(str(e), repo_name, issue_number, self._target_language, step + 1, context)
                return False  # AIには渡さずにここで終了
            
            logger.info(f"[{task_id}] Step {step+1} Observation (first 500 chars): {observation[:500]}")
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
                "loop_warning": "【警告】ループを検知しました。別のアプローチを選択してください。"
            }
        else:
            return {
                "role": "You are a professional software engineer focused on resolving GitHub Issues.",
                "role_pr": "You are a professional software engineer managing a Pull Request.",
                "enforcement": "【!! LANGUAGE ENFORCEMENT !!】\nYou MUST write your thought process and output in **English ONLY**.",
                "json_schema_desc": "【!! STRICT JSON FORMAT !!】\nRespond ONLY with a single JSON object (schema: thought, action).",
                "loop_warning": "【WARNING】Loop detected. Try a different approach."
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
        role = res['role_pr'] if loc_type.startswith("PR") else res['role']
        system_prompt = f"""{role}
{res['enforcement']}

{res['json_schema_desc']}
{common_json_schema}

【Goal of This Session】
{context.get('intent_analysis', {}).get('goal', 'Undetermined')}

【Constraints】
{chr(10).join(['- ' + c for c in context.get('intent_analysis', {}).get('constraints', [])]) if context.get('intent_analysis', {}).get('constraints') else 'None'}

【Available Tools & Required Parameters】
You must strictly use the exact parameter keys defined below:
- list_files: {{ "path": "string" }}
- read_file: {{ "path": "string" }}
- write_file: {{ "path": "string", "content": "string" }}
- run_command: {{ "command": "string" }}
- post_comment: {{ "body": "string" }}
- create_issue: {{ "title": "string", "body": "string" }}
- close_issue: {{ "issue_number": "integer" }}
- close_pull_request: {{ "pull_number": "integer" }}
- merge_pull_request: {{ "pull_number": "integer" }}
- Finish: {{}}
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
                obs_limit = 30000
            elif i >= num_relevant - 3:
                obs_limit = 1000
            else:
                obs_limit = 200
            
            obs = h['observation']
            if len(obs) > obs_limit:
                obs = obs[:obs_limit] + f"\n... (truncated {len(obs) - obs_limit} chars)"
            
            history_str += f"\nStep {h['step']}:\nThought: {h['thought']}\nAction: {h['action']}({input_str})\nObservation: {obs}\n"

        # 4. ユーザープロンプト（タスクと履歴）の構築
        # 絶対パスがプロンプトに含まれるとAIが絶対パスを生成し混乱するため、隠蔽する
        ref_env = "Reference Code fallback is active. Use relative paths like './src'."
        ws_env = "Sandbox root is './'."
        
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

[Environment (Write/Test)]: {ws_env}
[Environment (Read-only)]: {ref_env}

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

        def extract_tool_data(data: dict):
            t = data.get("thought", "")
            act_data = data.get("action", {})
            if isinstance(act_data, str):
                act = act_data
                act_input = {k: v for k, v in data.items() if k not in ("thought", "action")}
            else:
                act = act_data.get("tool")
                act_input = act_data.get("parameters", {})
            return t, act, act_input

        try:
            data = json.loads(clean_resp)
            thought, action, action_input = extract_tool_data(data)
        except Exception as e:
            logger.error(f"Failed to parse JSON response: {e}")
            if "{" in response and "}" in response:
                try:
                    start = response.find("{")
                    end = response.rfind("}") + 1
                    data = json.loads(response[start:end])
                    thought, action, action_input = extract_tool_data(data)
                except:
                    pass
        
        return thought, action, action_input

    async def _execute_action(self, repo_name: str, action: str, action_input: Any, context: Dict[str, Any]) -> str:
        """JSON 形式の引数を受け取って実行する。エラーはPython例外として投げる。"""
        if not action: raise ValueError("有効な Action (JSONブロック) が見つかりませんでした。")
        action_lower = action.lower()
        
        if action_lower == "finish":
            return "Task completed successfully."
        
        if not isinstance(action_input, dict):
            raise ValueError(f"Parameters must be a dictionary, got {type(action_input)}")

        if action_lower == "list_files":
            path = action_input.get("path", action_input.get("file_path", "."))
            return await self.sandbox.list_files(path)
        elif action_lower == "read_file":
            path = action_input.get("path", action_input.get("file_path"))
            if not path: raise ValueError("'path' parameter is strictly required.")
            return await self.sandbox.read_file(path)
        elif action_lower == "write_file":
            path = action_input.get("path", action_input.get("file_path"))
            content = action_input.get("content", action_input.get("text", action_input.get("body")))
            if not path or content is None: raise ValueError("Both 'path' and 'content' parameters are strictly required.")
            return await self.sandbox.write_file(path, content)
        elif action_lower == "run_command":
            res = await self.sandbox.run_command(action_input.get("command"))
            return f"ExitStatus: {res['exit_code']}\nLogs: {res['logs']}"
        elif action_lower == "post_comment":
            body = action_input.get("body")
            if not body: raise ValueError("'body' parameter is required for post_comment.")
            
            # 自動翻訳ガードレール (v16)
            translated_body = await self._translate_if_needed(body, self._target_language)
            
            await self.gh_client.post_comment(repo_name, context["issue_number"], translated_body + get_footer())
            return "Successfully posted comment to GitHub."
        elif action_lower == "create_issue":
            title = action_input.get("title")
            body = action_input.get("body")
            if not title or not body:
                raise ValueError("'title' and 'body' parameters are required for create_issue.")
            
            translated_title = await self._translate_if_needed(title, self._target_language)
            translated_body = await self._translate_if_needed(body, self._target_language)
            
            new_issue_number = await self.gh_client.create_issue(repo_name, translated_title, translated_body + get_footer())
            return f"Successfully created new Issue #{new_issue_number} in GitHub."
        elif action_lower == "close_issue":
            num = action_input.get("issue_number")
            if num is None: raise ValueError("'issue_number' parameter is required.")
            await self.gh_client.close_issue(repo_name, int(num))
            return f"Successfully closed Issue #{num}."
        elif action_lower == "close_pull_request":
            num = action_input.get("pull_number")
            if num is None: raise ValueError("'pull_number' parameter is required.")
            await self.gh_client.close_pull_request(repo_name, int(num))
            return f"Goal achieved: Successfully closed PR #{num}. Please call Finish() now."
        elif action_lower == "merge_pull_request":
            num = action_input.get("pull_number")
            if num is None: raise ValueError("'pull_number' parameter is required.")
            await self.gh_client.merge_pull_request(repo_name, int(num))
            return f"Goal achieved: Successfully merged PR #{num}. Please call Finish() now."
        
        allowed_tools = ["list_files", "read_file", "write_file", "run_command", "close_pull_request", "merge_pull_request", "Finish", "post_comment"]
        raise ValueError(f"Unknown action: '{action}'. 利用可能なツールは {allowed_tools} のみです。")

    async def _analyze_and_report_error(self, error_str: str, repo_name: str, issue_number: int, target_lang: str, step: int, context: Dict[str, Any]) -> str:
        """Pythonレイヤーでキャッチした例外をLLMに分析・翻訳させ、Observationとして返す。"""
        # 絶対パス（ホストマシンのパス）を GitHub コメントに載せないためのサニタイズ処理
        if self.sandbox.workspace_root:
            error_str = error_str.replace(self.sandbox.workspace_root, ".")
        if self.sandbox.reference_root:
            error_str = error_str.replace(self.sandbox.reference_root, ".")
            
        logger.info(f"Analyzing caught exception via LLM: {error_str[:100]}...")
        
        system_prompt = f"""You are a senior system debugger. An error just occurred during a tool execution.
Your task is to analyze the raw error and explain it clearly.

CRITICAL REQUIREMENT: You MUST analyze and write your explanation STRICTLY in the following language: {target_lang}.
Do not use English or any other language for the text inside your JSON output unless {target_lang} is English.

You MUST respond with a SINGLE JSON object exactly in the following format:
{{
  "analysis": "[Detailed error analysis and hints to fix it, strictly written in {target_lang}]"
}}"""
        
        user_prompt = f"Raw Error Output:\n{error_str}"
        
        analysis_json_str = await self._call_llm(system_prompt, user_prompt)
        analysis_text = "エラーが発生しました。"
        
        try:
            # クリーンアップとパース
            clean_resp = analysis_json_str.strip()
            if clean_resp.startswith("```json"): clean_resp = clean_resp[len("```json"):].strip()
            if clean_resp.endswith("```"): clean_resp = clean_resp[:-3].strip()
            
            data = json.loads(clean_resp)
            analysis_text = data.get("analysis", result_fallback := "Error analyzing the error. Proceed with caution.")
        except Exception as e:
            logger.error(f"Failed to parse LLM error analysis: {e}")
            analysis_text = f"LLM parsing failed. Raw error: {error_str}"
            
        # GitHubへ透明性のために報告（その後、AIループ自体は切断される）
        if self.gh_client and repo_name and issue_number:
            msg = f"### ⚠️ Step {step} Error Detected (System Halted)\n\n**Analysis:** {analysis_text}"
            await self.gh_client.post_comment(repo_name, issue_number, msg + get_footer())

    def _detect_language(self, text: str) -> str:
        """テキストから主に使用されている言語を判定する"""
        if not text: return "日本語"
        if re.search(r'[\u3040-\u309F\u30A0-\u30FF]', text): return "日本語"
        return "English"

    async def _analyze_intent(self, title: str, body: str, mention_text: str) -> Dict[str, Any]:
        """依頼内容の意図を解析する"""
        prompt = f"""Analyze the task's intent based on the context.
Deliver the result as a SINGLE JSON object.
Use the SAME language as the input (Issue body/Mention) for 'goal' and 'initial_action_suggestion'.

Title: {title}
Body: {body}
Mention: {mention_text}

JSON Schema:
{{
  "category": "One of: BUG_FIX, FEATURE_ADD, TECH_PROPOSAL, DISCUSSION, GH_OPS, LOCAL_OPS, DIAGNOSTICS, TEST_OPS, UNKNOWN",
  "goal": "A concise summary of the goal in the user's primary language.",
  "constraints": ["Explicit constraints or rules from the text in the user's language"],
  "initial_action_suggestion": "Recommended first step in ReAct loop in the user's language."
}}
"""
        try:
            import httpx
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{self.llm_endpoint}/v1/chat/completions",
                    json={
                        "model": self.model_name,
                        "messages": [{"role": "user", "content": prompt}]
                    }
                )
                response.raise_for_status()
                res = response.json()
                content = res['choices'][0]['message']['content']
                
                # JSONの抽出
                clean_content = content.strip()
                if "```json" in clean_content:
                    clean_content = clean_content.split("```json")[1].split("```")[0].strip()
                elif "{" in clean_content:
                    clean_content = clean_content[clean_content.find("{"):clean_content.rfind("}")+1]
                
                return json.loads(clean_content)
        except Exception as e:
            logger.error(f"Intent analysis failed: {e}")
            return {
                "category": "UNKNOWN",
                "goal": "Failed to analyze intent automatically.",
                "constraints": [],
                "initial_action_suggestion": "Proceed with research (list_files)."
            }

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
