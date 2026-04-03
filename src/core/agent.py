import os
import logging
import json
import httpx
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

        max_steps = self.config['agent'].get('max_auto_retries', 10)
        
        for step in range(max_steps):
            # 1. LLMによる推論 (設計書 2.1)
            prompt = self._build_prompt(context)
            response = await self._call_llm(prompt)
            
            # 2. アクションの抽出
            thought, action, action_input = self._parse_response(response)
            logger.info(f"Step {step+1}: Thought: {thought}")
            
            if not action or action == "Finish":
                logger.info("Agent finished the task.")
                return True

            # 3. アクションの実行 (設計書 7.1)
            observation = await self._execute_action(task_id, repo_path, action, action_input)
            logger.info(f"Step {step+1}: Observation: {observation[:100]}...")
            
            # 履歴の更新
            context["history"].append({
                "step": step + 1,
                "thought": thought,
                "action": action,
                "input": action_input,
                "observation": observation
            })

        logger.error("Reached maximum steps without completion.")
        return False

    async def _call_llm(self, prompt: str) -> str:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                f"{self.llm_endpoint}/chat/completions",
                json={
                    "model": self.model_name,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0.2
                },
                timeout=300.0
            )
            if resp.status_code == 200:
                return resp.json()['choices'][0]['message']['content']
            else:
                raise RuntimeError(f"LLM call failed: {resp.text}")

    def _build_prompt(self, context: str) -> str:
        # 簡易的なReActプロンプト
        history_str = ""
        for h in context["history"]:
            history_str += f"\nThought: {h['thought']}\nAction: {h['action']}({h['input']})\nObservation: {h['observation']}\n"

        return f"""あなたは自律型エンジニアAI「Brownie」です。
以下のIssueを解決するために、ソースコードを調査し、修正してください。

【Issueタイトル】
{context['issue_title']}

【Issue内容】
{context['issue_body']}

【利用可能なツール】
- list_files(path): ディレクトリ内のファイル一覧を表示 (pathは {context['repo_path']} からの相対パス)
- read_file(path): ファイルの内容を読み込む
- write_file(path, content): ファイルを書き込む（または新規作成）
- run_command(command): サンドボックス内でコマンドを実行する
- Finish(): タスクが完了したことを報告する

【回答形式】
以下の形式厳守で回答してください：
Thought: [今の状況と次のステップの思考]
Action: [ツール名]([引数])

【これまでの履歴】
{history_str}

次のアクションを決定してください。"""

    def _parse_response(self, response: str):
        thought = ""
        action = None
        action_input = ""
        
        lines = response.split("\n")
        for line in lines:
            if line.startswith("Thought:"):
                thought = line[8:].strip()
            elif line.startswith("Action:"):
                action_part = line[7:].strip()
                if "(" in action_part and action_part.endswith(")"):
                    action = action_part.split("(")[0]
                    action_input = action_part.split("(")[1][:-1]
                else:
                    action = action_part
        
        return thought, action, action_input

    async def _execute_action(self, task_id: str, repo_path: str, action: str, action_input: str) -> str:
        try:
            if action == "list_files":
                target_path = os.path.join(repo_path, action_input.strip("/"))
                if not os.path.exists(target_path): return "Error: Path not found"
                files = os.listdir(target_path)
                return "\n".join(files)
            
            elif action == "read_file":
                target_path = os.path.join(repo_path, action_input.lstrip("/"))
                with open(target_path, "r") as f:
                    return f.read()
            
            elif action == "write_file":
                # シンプルな実装 (Content抽出が必要だが、今回はプロンプトが返すことを期待)
                # 注：本来はより堅牢なパーサーが必要
                target_path = os.path.join(repo_path, action_input.split(",")[0].strip())
                content = action_input.split(",", 1)[1].strip()
                os.makedirs(os.path.dirname(target_path), exist_ok=True)
                with open(target_path, "w") as f:
                    f.write(content)
                return "Successfully written."

            elif action == "run_command":
                res = await self.sandbox.run_in_sandbox(task_id, action_input)
                return f"Exit Code: {res['exit_code']}\nLogs: {res['logs']}"
            
            return f"Unknown action: {action}"
        except Exception as e:
            return f"Error executing action: {str(e)}"
