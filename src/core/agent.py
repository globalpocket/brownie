import os
import logging
import json
import httpx
import re
from typing import Dict, Any, List, Optional
from src.workspace.sandbox import SandboxManager

logger = logging.getLogger(__name__)

class CoderAgent:
    def __init__(self, config: Dict[str, Any], sandbox: SandboxManager):
        self.config = config
        self.sandbox = sandbox
        self.llm_endpoint = config['llm']['endpoint']
        self.model_name = config['llm']['model_name']

    async def plan_and_execute(self, task_id: str, repo_path: str, issue_title: str, issue_body: str):
        """ReActベースの自律実行ループ (設計書 8.4)"""
        logger.info(f"Agent starting task: {issue_title}")
        
        context = {
            "task_id": task_id,
            "repo_path": repo_path,
            "issue_title": issue_title,
            "issue_body": issue_body,
            "history": []
        }

        max_steps = self.config['agent'].get('max_auto_retries', 15)
        
        for step in range(max_steps):
            # 1. LLMによる推論 (設計書 2.1)
            prompt = self._build_prompt(context)
            response = await self._call_llm(prompt)
            
            # 2. アクションの抽出
            thought, action, action_input = self._parse_response(response)
            if not thought and not action:
                logger.warning(f"Step {step+1}: Could not parse LLM response. Retrying...")
                observation = "Error: 返答のフォーマットが正しくありません。「Thought: 思考の内容」と「Action: ツール(引数)」の形式で回答してください。"
            else:
                logger.info(f"Step {step+1}: Thought: {thought}")
                
                if action == "Finish" or (not action and "完了" in thought):
                    logger.info("Agent decided to finish.")
                    return True

                # 3. アクションの実行 (設計書 7.1)
                observation = await self._execute_action(task_id, repo_path, action, action_input)
                logger.info(f"Step {step+1}: Observation (len: {len(observation)})")
            
            # 履歴の更新
            context["history"].append({
                "step": step + 1,
                "thought": thought or "Formatting error",
                "action": action or "Retry",
                "input": action_input,
                "observation": observation
            })

        logger.error("Reached maximum steps without completion.")
        return False

    async def _call_llm(self, prompt: str) -> str:
        try:
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f"{self.llm_endpoint}/chat/completions",
                    json={
                        "model": self.model_name,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": 0.0 # 推論の安定化
                    },
                    timeout=300.0
                )
                if resp.status_code == 200:
                    return resp.json()['choices'][0]['message']['content']
                else:
                    return f"Error: LLM HTTP {resp.status_code}"
        except Exception as e:
            return f"Error: {str(e)}"

    def _build_prompt(self, context: Dict[str, Any]) -> str:
        history_str = ""
        for h in context["history"]:
            history_str += f"\nStep {h['step']}:\nThought: {h['thought']}\nAction: {h['action']}({h['input']})\nObservation: {h['observation'][:500]}\n"

        return f"""あなたは自律型エンジニアAI「Brownie」です。
以下のIssueを解決するために、ソースコードを調査し、修正してください。

【対象リポジトリパス】: {context['repo_path']}
【Issueタイトル】: {context['issue_title']}
【Issue内容】: {context['issue_body']}

【利用可能なツール】
- list_files(path): ディレクトリ内のファイルとフォルダを表示します。 (引数はリポジトリルートからの相対パス)
- read_file(path): ファイルの内容を完全に読み込みます。
- write_file(path, content): ファイルを作成または上書きします。contentは文字列で指定してください。
- run_command(command): サンドボックス内で任意のシェルコマンドを実行します。
- Finish(): すべての作業が完了し、検証も終わった場合に呼び出してください。

【重要】回答フォーマット:
各ステップで、以下の形式のみを使用して回答してください。余計な挨拶や説明は不要です。
Thought: 現在の状況を分析し、次に行うアクションを決定した理由。
Action: ツール名(引数)

【実行履歴】
{history_str}

次のアクションを決定してください。"""

    def _parse_response(self, response: str):
        thought = ""
        action = None
        action_input = ""
        
        # Thought の抽出
        t_match = re.search(r"Thought:\s*(.*?)(?=Action:|$)", response, re.DOTALL | re.IGNORECASE)
        if t_match:
            thought = t_match.group(1).strip()
            
        # Action の抽出 (Action: tool(args) または Action: `tool`(args) などに対応)
        a_match = re.search(r"Action:\s*[`]*(\w+)[`]*\s*\((.*)\)", response, re.DOTALL | re.IGNORECASE)
        if a_match:
            action = a_match.group(1).strip()
            action_input = a_match.group(2).strip()
        
        return thought, action, action_input

    async def _execute_action(self, task_id: str, repo_path: str, action: str, action_input: str) -> str:
        if not action: return "Error: アクションが指定されていません。「Action: ツール名(引数)」の形式で回答してください。"
        
        # 大文字小文字を区別せずに判定
        action_lower = action.lower()
        
        try:
            if action_lower == "list_files":
                path = action_input.strip("\"' ") or "."
                target = os.path.join(repo_path, path)
                if not os.path.exists(target): return f"Error: Path {path} not found"
                return str(os.listdir(target))
            
            elif action_lower == "read_file":
                path = action_input.strip("\"' ")
                target = os.path.join(repo_path, path)
                with open(target, "r") as f:
                    return f.read()
            
            elif action_lower == "write_file":
                if "," not in action_input: return "Error: write_file requires 'path, content'"
                path, content = action_input.split(",", 1)
                path = path.strip("\"' ")
                content = content.lstrip()
                if content.startswith(("'", "\"")) and content.endswith(content[0]):
                    content = content[1:-1]
                
                target = os.path.join(repo_path, path)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with open(target, "w") as f:
                    f.write(content)
                return f"Successfully written to {path}."

            elif action_lower == "run_command":
                cmd = action_input.strip("\"' ")
                res = await self.sandbox.run_in_sandbox(task_id, cmd)
                return f"ExitStatus: {res['exit_code']}\nLogs: {res['logs']}"
            
            return f"Unknown action: {action}. 有効なツール名 (list_files, read_file, write_file, run_command, Finish) を使用してください。"
        except Exception as e:
            return f"Agent Tool Error: {str(e)}"
