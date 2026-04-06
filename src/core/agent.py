from pydantic import BaseModel, Field
import re
import logging
import json
import httpx
from typing import Dict, Any, List, Optional, Union
from src.workspace.sandbox import SandboxManager
from src.version import get_footer
from src.workspace.analyzer.flow import FlowTracer
import os
import asyncio

logger = logging.getLogger(__name__)

class ActionDetail(BaseModel):
    tool: str = Field(..., description="The name of the tool to be called.")
    parameters: Dict[str, Any] = Field(default_factory=dict, description="Parameters for the tool call as a dictionary.")

class AgentAction(BaseModel):
    thought: str = Field(..., description="The agent's internal reasoning and analysis.")
    action: ActionDetail = Field(..., description="The tool to execute and its inputs.")

class CoderAgent:
    def __init__(self, config: Dict[str, Any], sandbox: SandboxManager, state: 'StateManager', 
                 gh_client: Optional[GitHubClientWrapper] = None, 
                 http_client: Optional[httpx.AsyncClient] = None,
                 model_manager: Optional['OllamaModelManager'] = None):
        self.config = config
        self.sandbox = sandbox
        self.state = state
        self.gh_client = gh_client
        self.http_client = http_client or httpx.AsyncClient(timeout=300.0)
        self.model_manager = model_manager
        self.llm_endpoint = config['llm']['endpoint']
        # self.model_name は廃止し、随時 model_manager から取得するか config を参照する
        self.max_llm_retries = config['agent'].get('max_llm_retries', 5)
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
11. **Directory Structure Awareness**: Always use `list_files(path=".", max_depth=1)` to verify the top-level structure before accessing subdirectories. Do not assume a directory (e.g., `workspace/`) exists at the root if it is actually nested (e.g., `src/workspace/`).
12. **Relative Pathing**: All paths provided to tools must be relative to the project root. If you see an error like "Path not found", re-verify the structure using `list_files` and try with the correct prefix (e.g., `src/`).
13. **Quality Guardrails (MANDATORY)**: 
    - After modifying any code, you MUST run `lint_code` to detect typos or structural errors before running tests.
    - Before finishing or committing, you MUST run `format_code` to ensure code style consistency.
    - If you introduce sensitive logic, run `scan_security` to check for vulnerabilities.
    - Use the feedback from these tools to self-correct your code.
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
        
        # 1. 意図解析 (Intent Analysis) - router モデルを使用
        if self.model_manager:
            await self.model_manager.switch_model(self.config['llm']['models']['router'])
            
        intent = await self._analyze_intent(issue_title, issue_body or "", instruction_priority or "")
        logger.info(f"[{task_id}] Intent Analysis: {intent['category']} - {intent['goal']}")

        existing_task = await self.state.get_task(task_id)
        existing_context = existing_task.get("context") or {} if existing_task else {}
        existing_history = existing_context.get("history", [])

        # もし特定のメンション等の新規イベントで履歴がない場合、Issue全体の最新の履歴を継承する
        if not existing_history:
            latest_task = await self.state.get_latest_task_for_issue(repo_name, issue_number)
            latest_context = latest_task.get("context") or {} if latest_task else {}
            existing_history = latest_context.get("history", [])

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
            "history": existing_history
        }

        max_steps = self.config['agent'].get('max_auto_retries', 15)
        
        for step in range(max_steps):
            # 1. プロンプト（多段メッセージ）の構築
            messages = await self._build_prompt(context)
            
            # 2. LLM 呼び出し
            # 実行フェーズでは重量モデル (coder) に切り替え
            if step == 0 and self.model_manager:
                await self.model_manager.switch_model(self.config['llm']['models']['coder'])

            response = await self._call_llm(messages)
            logger.info(f"[{task_id}] Step {step+1} LLM Response: {response}")
            
            # 2. アクションの抽出
            thought, action, action_input = self._parse_response(response)

            # 物理ループ検知（正規化：action が空なら "None" とする）
            norm_action = action if action else "None"
            current_action_signature = f"{norm_action}_{json.dumps(action_input, sort_keys=True, ensure_ascii=False)}"
            context["repeated_action_alert"] = False

            if len(context["history"]) >= 1:
                last_h = context["history"][-1]
                last_sig = f"{last_h['action']}_{json.dumps(last_h['input'], sort_keys=True, ensure_ascii=False)}"
                
                if last_sig == current_action_signature:
                    # 2回連続：警告フラグを立てる
                    context["repeated_action_alert"] = True
                    logger.warning(f"[{task_id}] Soft loop detected (2nd time). Warning will be injected into prompt.")
                    
                    if len(context["history"]) >= 2:
                        # 3回目連続：ハードストップ
                        prev_last_h = context["history"][-2]
                        prev_last_sig = f"{prev_last_h['action']}_{json.dumps(prev_last_h['input'], sort_keys=True, ensure_ascii=False)}"
                        
                        if prev_last_sig == current_action_signature:
                            logger.error(f"[{task_id}] Hard loop detected at Step {step+1}! Terminating task. Action: {norm_action}")
                            await self.gh_client.post_comment(repo_name, issue_number, f"❌ 無限ループを検知したため（同一アクションの3回連続実行）、作業を停止しました。\nアクション: `{norm_action}`\n対象: {json.dumps(action_input, ensure_ascii=False)}\n\n一度指示を修正するか、現在のファイルを削除してやり直してください。" + get_footer())
                            return False
            
            # 3. アクションの実行（Python例外によるフェイルセーフ）
            try:
                if not thought and not action:
                    raise ValueError("返答形式が不正です。JSONオブジェクトのみを返してください。")
                elif action == "Finish" or (not action and thought and "完了" in thought):
                    logger.info(f"[{task_id}] Agent decided to finish.")
                    
                    # 終了フェーズ（要約・報告）: reviewer モデルへ切り替え
                    if self.model_manager:
                        await self.model_manager.switch_model(self.config['llm']['models']['reviewer'])
                    
                    summary = await self._generate_summary(context["history"], "SUCCESS")
                    context["final_summary"] = summary
                    await self.state.update_task(task_id, "Completed", repo_name, issue_num=issue_number, context=context)
                    return True
                else:
                    observation = await self._execute_action(repo_name, action, action_input, context)
            except Exception as e:
                # Pythonレベルでエラーを検知し、アナライザLLMで日本語解析・報告後、直ちにAIループを遮断
                logger.warning(f"[{task_id}] Exception caught during action {action}: {e}")
                await self._analyze_and_report_error(str(e), repo_name, issue_number, self._target_language, step + 1, context)
                return False  # AIには渡さずにここで終了
            
            # --- Context Summarization (Phase 3) ---
            observation = await self._summarize_observation(observation)
            
            logger.info(f"[{task_id}] Step {step+1} Observation (summarized, first 500 chars): {observation[:500]}")
            context["history"].append({
                "step": step + 1,
                "thought": thought or "Formatting error",
                "action": norm_action,
                "input": action_input,
                "observation": observation
            })
            
            # 判断依頼（質問して終了）の検知 
            # 質問に関連する単語が含まれ、かつ Finish していない場合を判定
            if action == "post_comment" and any(q in (thought or "") + (action_input.get("body") or "") for q in ["質問", "判断", "確認", "教えて"]):
                summary = await self._generate_summary(context["history"], "SUSPENDED")
                context["final_summary"] = summary
                logger.info(f"[{task_id}] Agent requested user decision. Suspending task.")
                await self.state.update_task(task_id, "Suspended", repo_name, issue_num=issue_number, context=context)
                return "SUSPENDED" 
            
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

    async def _call_llm(self, messages: List[Dict[str, str]], force_json: bool = True, model_role: str = "coder") -> str:
        max_retries = self.max_llm_retries if force_json else 1
        last_error = ""

        # 使用するモデルの決定
        target_model = self.config['llm']['models'].get(model_role)
        if self.model_manager:
            current = self.model_manager.get_current_model()
            if current:
                target_model = current
        
        if not target_model:
            target_model = self.config['llm']['models'].get('router', 'llama3')

        for attempt in range(max_retries):
            try:
                payload = {
                    "model": target_model,
                    "messages": messages,
                    "temperature": 0.0,
                    "options": {
                        "num_ctx": 32768
                    }
                }
                if force_json:
                    # Pydantic モデルから JSON Schema を生成して渡す
                    payload["response_format"] = AgentAction.model_json_schema()

                resp = await self.http_client.post(
                    f"{self.llm_endpoint}/chat/completions",
                    json=payload
                )
                if resp.status_code == 200:
                    content = resp.json()['choices'][0]['message']['content']
                    logger.debug(f"Raw LLM Response (Attempt {attempt+1}): {content}")
                    
                    # Markdown ブロックの除去
                    clean_content = content.strip()
                    if "```json" in clean_content:
                        clean_content = clean_content.split("```json")[1].split("```")[0].strip()
                    elif "```" in clean_content:
                        clean_content = clean_content.split("```")[1].split("```")[0].strip()
                    
                    # { } の間を抽出 (フォールバック)
                    if "{" in clean_content and "}" in clean_content:
                        start = clean_content.find("{")
                        end = clean_content.rfind("}") + 1
                        clean_content = clean_content[start:end]

                    # JSON形式の検証
                    if force_json:
                        try:
                            json.loads(clean_content)
                            return clean_content
                        except json.JSONDecodeError as e:
                            last_error = f"Invalid JSON format: {str(e)}"
                            logger.warning(f"LLM returned invalid JSON (Attempt {attempt+1}/{max_retries}). Retrying...")
                            continue
                    return clean_content
                else:
                    last_error = f"LLM HTTP {resp.status_code} - {resp.text}"
                    logger.warning(f"LLM request failed (Attempt {attempt+1}/{max_retries}): {last_error}")
            except Exception as e:
                last_error = str(e)
                logger.warning(f"Error calling LLM (Attempt {attempt+1}/{max_retries}): {last_error}")
            
            await asyncio.sleep(1.0) # 短い待機を入れて再試行

        return f"Error after {max_retries} attempts: {last_error}"

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

    async def _build_prompt(self, context: Dict[str, Any]) -> List[Dict[str, str]]:
        """システムプロンプトとユーザープロンプトを構築する (多段メッセージ形式)"""
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

        # 2. システムコンテンツの生成 (役割、ツール、制約)
        if context.get('error_mode'):
            # エラー報告モード専用の簡潔なプロンプト (v22)
            system_content = f"""{res['role']}
{res['enforcement']}
{res['json_schema_desc']}
{common_json_schema}

【!!! MISSION: ERROR REPORTING !!!】
現在、予期せぬエラーにより作業が中断されています。
あなたの任務は、最後に発生したエラー内容を解析し、{self._target_language} で GitHub に報告することだけです。

1. `post_comment` を使用して、エラーの概要と（可能であれば）解決策のヒントを報告してください。
2. その後、直ちに `Finish` を実行して終了してください。

※ 他のツール（read_file, list_files, run_command 等）の使用は厳禁です。
"""
        else:
            role = res['role_pr'] if loc_type.startswith("PR") else res['role']

            # --- Least Privilege: 動的なツール制限 (Phase 2) ---
            intent_cat = context.get('intent_analysis', {}).get('category', 'UNKNOWN')
            forbidden_tools = []
            if intent_cat in ["DISCUSSION", "DIAGNOSTICS"]:
                forbidden_tools = ["write_file", "run_command", "merge_pull_request", "close_pull_request", "create_issue"]
                logger.info(f"Applying Least Privilege for category {intent_cat}: disabling {forbidden_tools}")

            all_tools_list = [
                ("- run_semgrep: {{}}", "run_semgrep"),
                ("- list_files(path: string, max_depth: integer)", "list_files"),
                ("- read_file(path: string)", "read_file"),
                ("- write_file(path: string, content: string)", "write_file"),
                ("- run_command(command: string)", "run_command"),
                ("- post_comment(body: string)", "post_comment"),
                ("- create_issue(title: string, body: string)", "create_issue"),
                ("- close_issue(issue_number: integer)", "close_issue"),
                ("- close_pull_request(pull_number: integer)", "close_pull_request"),
                ("- merge_pull_request(pull_number: integer)", "merge_pull_request"),
                ("- get_repository_flow(entry_symbol: string, max_depth: integer)", "get_repository_flow"),
                ("- lint_code(path: string)", "lint_code"),
                ("- format_code(path: string)", "format_code"),
                ("- scan_security(path: string)", "scan_security"),
                ("- Finish()", "finish")
            ]
            tools_description = "\n".join([desc for desc, name in all_tools_list if name not in forbidden_tools])

            system_content = f"""{role}
{res['enforcement']}

{res['json_schema_desc']}
{common_json_schema}

EXAMPLE RESPONSE 1:
{{
  "thought": "I will check the top-level directory to understand the project structure.",
  "action": {{
    "tool": "list_files",
    "parameters": {{ "path": ".", "max_depth": 1 }}
  }}
}}

EXAMPLE RESPONSE 2:
{{
  "thought": "I will trace the execution flow starting from the main function.",
  "action": {{
    "tool": "get_repository_flow",
    "parameters": {{ "entry_symbol": "main", "max_depth": 3 }}
  }}
}}

【Goal of This Session】
{context.get('intent_analysis', {}).get('goal', 'Undetermined')}

【Constraints】
{chr(10).join(['- ' + c for c in context.get('intent_analysis', {}).get('constraints', [])]) if context.get('intent_analysis', {}).get('constraints') else 'None'}

【Available Tools & Required Parameters】
You must use the following tools:
{tools_description}

【Rules (MANDATORY)】
{self.COMMON_RULES}

### 🚨 WDCA (Deep Context Awareness)
リポジトリ全体の構造を把握しています。必要に応じて `get_repository_flow` を使用せよ。

### 🚨 ユーザーへの判断依頼 (IMPORTANT)
実装方針や、目的の曖昧さがある場合は、`post_comment` 後、`Finish` せずに停止してください。
"""
        messages = [{"role": "system", "content": system_content}]

        # 3. 初期依頼 (Initial User Message)
        instruct_msg = f"(Additional Instructions: {instruct})" if (is_mention and instruct) else ""
        user_content = f"""【Target Issue】: {context['issue_title']}
{instruct_msg}
[Target Language]: {self._target_language}

Sandbox root is './'.
Reference Code fallback is active.
"""
        messages.append({"role": "user", "content": user_content})

        # 4. 履歴の展開 (History as turns)
        max_history_to_include = 10
        total_history = len(context["history"])
        start_idx = max(0, total_history - max_history_to_include)
        
        relevant_history = context["history"][start_idx:]
        num_relevant = len(relevant_history)

        for i, h in enumerate(relevant_history):
            # 不要なエラー報告履歴やハルシネーション（なりきり）を除外
            if h.get('action') in ['post_comment', 'post_error', 'report_error']:
                body_text = str(h.get('input', {}).get('body', "")) + " " + str(h.get('thought', ""))
                # エラー報告や監視、および PM なりきりパターンを除外
                skip_keywords = ["エラー", "Error", "Failed", "中断", "Project Manager", "Project Overview", "Milestones achieved"]
                if any(q in body_text for q in skip_keywords):
                    continue

            # Assistant 回答
            assistant_body = {
                "thought": h.get("thought", ""),
                "action": h.get("original_action", {"tool": h.get('action'), "parameters": h.get('input')})
            }
            messages.append({"role": "assistant", "content": json.dumps(assistant_body, ensure_ascii=False)})

            # User 観測結果 (Observation)
            is_latest = (i == num_relevant - 1)
            obs_limit = 30000 if is_latest else 1000
            obs = h['observation']
            if len(obs) > obs_limit:
                obs = obs[:obs_limit] + f"\n... (truncated {len(obs) - obs_limit} chars)"
            
            messages.append({"role": "user", "content": f"Observation:\n{obs}"})

        # 5. ループ警告・エラーモード・最終指示
        if context.get('repeated_action_alert'):
            messages.append({"role": "user", "content": f"[LOOP WARNING] {res['loop_warning']}"})

        if context.get('error_mode'):
            err_instr = f"\n【!!! CRITICAL ERROR !!!】\nLast operation failed: {context['error_obs']}\nReport this error via `post_comment` then `Finish`."
            messages.append({"role": "user", "content": err_instr})
        else:
            messages.append({"role": "user", "content": "Next step: Please provide your thought and next action in a SINGLE JSON object."})

        return messages

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

        # Step 1: Pydantic による一次パース (Structured Output 優先)
        try:
            # { } の抽出ロジック（_call_llm でも一部実施済みだが念のため）
            if "{" in clean_resp and "}" in clean_resp:
                start = clean_resp.find("{")
                end = clean_resp.rfind("}") + 1
                clean_json = clean_resp[start:end]
                
                parsed = AgentAction.model_validate_json(clean_json)
                return parsed.thought, parsed.action.tool, parsed.action.parameters
        except Exception as e:
            logger.debug(f"Pydantic parsing failed, falling back to heuristic: {e}")

        # Step 2: 既存のヒューリスティック・パース (フォールバック)
        def extract_tool_data(data: dict):
            t = data.get("thought", "")
            act_data = data.get("action", {})
            
            if isinstance(act_data, str):
                act = act_data
                act_input = {k: v for k, v in data.items() if k not in ("thought", "action")}
            elif isinstance(act_data, dict):
                if "tool" in act_data:
                    act = act_data.get("tool")
                    act_input = act_data.get("parameters", {})
                elif len(act_data) == 1:
                    act = list(act_data.keys())[0]
                    act_input = act_data[act]
                    if not isinstance(act_input, dict): act_input = {}
                else:
                    act = None
                    act_input = {}
            else:
                act = None
                act_input = {}
                
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
        if not action: 
            raise ValueError("有効な Action (JSONブロック) が見つかりませんでした。回答には必ず JSON ブロックを含めてください。")
        
        # ツール名の正規化: "Finish()" -> "finish", "list_files(path: string)" -> "list_files"
        action_clean = action.strip().split("(")[0].lower()
        
        if action_clean == "finish":
            # --- Critique Gateway: 終了前の品質チェック (Phase 2) ---
            history = context.get("history", [])
            has_write = any(h.get("action") == "write_file" for h in history)
            
            if has_write:
                # 最後の write_file 後のインデックスを取得
                last_write_idx = max(i for i, h in enumerate(history) if h.get("action") == "write_file")
                subsequent_actions = history[last_write_idx+1:]
                
                # lint_code と format_code の実行を確認 (致命的なエラーは Observation 内の文字列で判定)
                linted = any(h.get("action") == "lint_code" and "❌" not in h.get("observation", "") for h in subsequent_actions)
                formatted = any(h.get("action") == "format_code" for h in subsequent_actions)
                
                if not linted or not formatted:
                    missing = []
                    if not linted: missing.append("lint_code")
                    if not formatted: missing.append("format_code")
                    
                    msg = f"【Finish 拒否】ファイルを書き換えましたが、その後に以下のツールが正常に実行されていません: {', '.join(missing)}。品質確保（致命的なエラーの解消とフォーマット）を行ってから完了してください。"
                    logger.warning(f"Critique Gateway blocked Finish: {msg}")
                    return msg

            return "Task completed successfully."
        
        if not isinstance(action_input, dict):
            raise ValueError(f"Parameters must be a dictionary, got {type(action_input)}. Tool: {action}")

        if action_clean == "list_files":
            path = action_input.get("path", action_input.get("file_path", "."))
            depth = action_input.get("max_depth", action_input.get("depth", 1))
            return await self.sandbox.list_files(path, max_depth=int(depth))
        elif action_clean == "read_file":
            path = action_input.get("path", action_input.get("file_path"))
            if not path: raise ValueError("'path' parameter is strictly required.")
            return await self.sandbox.read_file(path)
        elif action_clean == "write_file":
            path = action_input.get("path", action_input.get("file_path"))
            content = action_input.get("content", action_input.get("text", action_input.get("body")))
            if not path or content is None: raise ValueError("Both 'path' and 'content' parameters are strictly required.")
            return await self.sandbox.write_file(path, content)
        elif action_clean == "run_command":
            res = await self.sandbox.run_command(action_input.get("command"))
            return f"ExitStatus: {res['exit_code']}\nLogs: {res['logs']}"
        elif action_clean == "run_semgrep":
            res = await self.sandbox.run_semgrep(context.get("task_id", "default"))
            return f"Semgrep Analysis Result:\nStatus: {res['status']}\nLogs: {res['logs']}"
        elif action_clean == "lint_code":
            return await self.sandbox.lint_code(action_input.get("path", "."))
        elif action_clean == "format_code":
            return await self.sandbox.format_code(action_input.get("path", "."))
        elif action_clean == "scan_security":
            return await self.sandbox.scan_security(action_input.get("path", "."))
        elif action_clean == "post_comment":
            body = action_input.get("body")
            if not body: raise ValueError("'body' parameter is required for post_comment.")
            
            # 自動翻訳ガードレール (v16)
            translated_body = await self._translate_if_needed(body, self._target_language)
            
            await self.gh_client.post_comment(repo_name, context["issue_number"], translated_body + get_footer())
            return "Successfully posted comment to GitHub."
        elif action_clean == "create_issue":
            title = action_input.get("title")
            body = action_input.get("body")
            if not title or not body:
                raise ValueError("'title' and 'body' parameters are required for create_issue.")
            
            translated_title = await self._translate_if_needed(title, self._target_language)
            translated_body = await self._translate_if_needed(body, self._target_language)
            
            new_issue_number = await self.gh_client.create_issue(repo_name, translated_title, translated_body + get_footer())
            return f"Successfully created new Issue #{new_issue_number} in GitHub."
        elif action_clean == "close_issue":
            num = action_input.get("issue_number")
            if num is None: raise ValueError("'issue_number' parameter is required.")
            await self.gh_client.close_issue(repo_name, int(num))
            return f"Successfully closed Issue #{num}."
        elif action_clean == "close_pull_request":
            num = action_input.get("pull_number")
            if num is None: raise ValueError("'pull_number' parameter is required.")
            await self.gh_client.close_pull_request(repo_name, int(num))
            return f"Goal achieved: Successfully closed PR #{num}. Please call Finish() now."
        elif action_clean == "merge_pull_request":
            num = action_input.get("pull_number")
            if num is None: raise ValueError("'pull_number' parameter is required.")
            await self.gh_client.merge_pull_request(repo_name, int(num))
            return f"Goal achieved: Successfully merged PR #{num}. Please call Finish() now."
        elif action_clean == "get_repository_flow":
            # AIが誤って 'path' や 'name' などのキーを使うことがあるため、正規化する
            symbol = action_input.get("entry_symbol") or action_input.get("symbol") or action_input.get("path") or action_input.get("name")
            depth = action_input.get("max_depth", action_input.get("depth", 5))
            if not symbol: raise ValueError("'entry_symbol' (e.g., function name) parameter is required.")
            return await self.get_repository_flow(symbol, int(depth))
        
        allowed_tools = ["list_files", "read_file", "write_file", "run_command", "run_semgrep", "close_pull_request", "merge_pull_request", "get_repository_flow", "Finish", "post_comment"]
        raise ValueError(f"Unknown action: '{action_clean}'. 利用可能なツールは {allowed_tools} のみです。")

    async def get_repository_flow(self, entry_symbol: str, max_depth: int = 5) -> str:
        """ 指定されたシンボルから始まる処理シーケンスを Mermaid 形式で取得するツール """
        repo_path = self.sandbox.workspace_root
        if not repo_path:
            return "Workspace root not set."
            
        db_path = os.path.join(repo_path, ".brwn", "index.db")
        
        if not os.path.exists(db_path):
            return f"Analysis index not found at {db_path}. Please check if .brwn directory exists."
            
        tracer = FlowTracer(db_path)
        try:
            # CPU バウンドな追跡処理をスレッドで実行
            flow_data = await asyncio.to_thread(tracer.trace_flow, entry_symbol, max_depth)
            return f"### {entry_symbol} の処理フロー\n\n```mermaid\n{flow_data}\n```"
        except Exception as e:
            return f"Error tracing flow: {str(e)}"
        finally:
            tracer.close()

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
You MUST respond with a SINGLE JSON object:
{{
  "analysis": "[Detailed error analysis and hints to fix it, strictly written in {target_lang}]"
}}"""
        
        user_prompt = f"Raw Error Output:\n{error_str}"
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        
        analysis_json_str = await self._call_llm(messages, force_json=True)
        analysis_text = "エラーが発生しました。"
        
        try:
            # クリーンアップは _call_llm で実施済み
            data = json.loads(analysis_json_str)
            analysis_text = data.get("analysis", result_fallback := "Error analyzing the error. Proceed with caution.")
        except Exception as e:
            logger.error(f"Failed to parse LLM error analysis: {e}")
            analysis_text = f"LLM parsing failed. Raw error: {error_str}"
            
        # GitHubへ報告 (オーナーと依頼者へメンション)
        if self.gh_client and repo_name and issue_number:
            owner = await self.gh_client.get_repo_owner(repo_name)
            # 依頼者の特定 (履歴または context から)
            requester = context.get('location_context', {}).get('user_login', "")
            
            my_username = self.gh_client.get_my_username().lower()
            mention_parts = [f"@{owner}"]
            if requester and requester.lower() != my_username and requester != "mention_trigger":
                mention_parts.append(f"@{requester}")
            
            mention_str = " ".join(mention_parts)
            
            # 手順の要約生成
            summary = await self._generate_summary(context["history"], "FAILED", error_str)
            
            msg = f"### ⚠️ {mention_str} エラーによるタスクの中断報告\n\n**状況:** {analysis_text}\n\n**これまでの実施内容:**\n{summary}"
            await self.gh_client.post_comment(repo_name, issue_number, msg + get_footer())

    async def _summarize_observation(self, observation: str) -> str:
        """長すぎる Observation を要約する (Phase 3)"""
        limit = 2000
        if len(observation) <= limit:
            return observation

        logger.info(f"Observation length ({len(observation)}) exceeds limit. Summarizing...")

        # 1. Regex による重要行の抽出 (スタックトレースやエラーメッセージを優先)
        important_lines = []
        lines = observation.splitlines()
        error_patterns = [
            r"error", r"fail", r"exception", r"traceback", r"caused by", r"denied", r"not found", r"❌"
        ]
        
        for i, line in enumerate(lines):
            if any(re.search(pat, line, re.IGNORECASE) for pat in error_patterns):
                # 前後1行を含めて抽出
                start = max(0, i - 1)
                end = min(len(lines), i + 2)
                important_lines.extend(lines[start:end])
        
        # 重複除去（順序維持）
        unique_important = []
        seen = set()
        for l in important_lines:
            if l not in seen:
                unique_important.append(l)
                seen.add(l)
        
        filtered_obs = "\n".join(unique_important)
        
        if len(filtered_obs) > limit:
            filtered_obs = filtered_obs[:limit] + "\n... (further truncated by regex)"
        
        # 2. LLM によるセマンティック要約 (軽量モデルを使用)
        if self.model_manager and len(observation) > 5000:
            try:
                # router モデルに切り替え
                await self.model_manager.switch_model(self.config['llm']['models']['router'])
                
                prompt = [
                    {"role": "system", "content": "あなたは技術ログの要約エキスパートです。以下のログからエラーの原因や重要な事実のみを抽出し、簡潔に要約してください。"},
                    {"role": "user", "content": f"Logs to summarize:\n{filtered_obs or observation[:limit]}"}
                ]
                summary = await self._call_llm(prompt, force_json=False, model_role="router")
                
                # coder モデルに戻す（次のステップのため）
                await self.model_manager.switch_model(self.config['llm']['models']['coder'])
                
                return f"[Summarized Observation]\n{summary.strip()}\n\n[Original length: {len(observation)} chars]"
            except Exception as e:
                logger.error(f"Semantic summarization failed: {e}")
        
        return f"[Regex-Extracted Observation]\n{filtered_obs or observation[:limit]}\n\n[Original length: {len(observation)} chars]"

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
            # システムプロンプトは特になし（ユーザープロンプトに全て含める）
            messages = [{"role": "user", "content": prompt}]
            content = await self._call_llm(messages, force_json=True)
            
            # JSONの抽出部分は _call_llm 内で行われているが、念のため再パース
            clean_content = content.strip()
            if "{" in clean_content:
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
        
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]
        translated = await self._call_llm(messages)
        
        if translated.strip().startswith("{"):
            try:
                data = json.loads(translated)
                return data.get("translation") or data.get("translated_text") or translated
            except:
                pass
        
        return translated.strip()

    async def _generate_summary(self, history: List[Dict], status: str, error_detail: str = "") -> str:
        """ 実施した内容を LLM で要約し、自然言語の報告書を生成する """
        if not history: return "開始直後に中断されました。"

        status_text = {
            "SUCCESS": "タスクが正常に完了しました。",
            "FAILED": "予期せぬエラーにより中断しました。",
            "SUSPENDED": "ユーザーの判断を仰ぐために一時停止しています。"
        }.get(status, "処理が中断されました。")

        # 履歴のフィルタリング (エラー報告などを除外)
        filtered_history = []
        for h in history:
            if h.get('action') in ['post_comment', 'post_error', 'report_error']:
                body_text = str(h.get('input', {}).get('body', "")) + " " + str(h.get('thought', ""))
                if "エラー" in body_text or "Error" in body_text or "Failed" in body_text or "中断" in body_text:
                    continue
            filtered_history.append(h)

        prompt = f"""以下の実行履歴（ReActループ）を元に、ユーザー（GitHub Issueの依頼者）向けの「実施内容の報告書」を生成してください。
現在の状態: {status_text}
エラー詳細（あれば）: {error_detail}

出力ルール:
- 【!! 日本語限定 !!】
- 親しみやすく、専門的で信頼できるトーン。
- 箇条書きで分かりやすく。
- エラーの場合は「どのステップで何が原因で中断したか」を具体的に。
- 質問（SUSPENDED）の場合は、何を答えてほしいのかを明確に。
- **重要: JSON 形式ではなく、直接テキスト（Markdown形式）で回答してください。**

実行履歴:
{json.dumps(filtered_history[-10:], ensure_ascii=False, indent=2)}
"""
        messages = [
            {"role": "system", "content": "あなたは技術的な実施内容を簡潔にまとめて報告するソフトウェアエンジニアです。必ず日本語で回答してください。"},
            {"role": "user", "content": prompt}
        ]
        try:
            summary_text = await self._call_llm(messages, force_json=False)
            return summary_text.strip()
        except Exception as e:
            logger.error(f"Failed to generate summary: {e}")
            return "実施内容の要約生成に失敗しました。"
