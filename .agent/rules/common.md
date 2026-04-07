# BROWNIE Common Rules

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