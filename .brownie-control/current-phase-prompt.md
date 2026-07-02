# Brownie Phase 3.4.1 Fix 指示

対象リポジトリ:

```text
https://github.com/globalpocket/brownie
```

## 背景

Phase 3.4 で `proposal.readiness` と readiness report が実装された。

PR #34:

* `proposal.readiness`
* `WorkspacePatchReadinessReportSummary`
* `WorkspacePatchReadinessCheckSummary`
* `WorkspacePatchReadinessReportCreated`
* VSIX readiness command
* docs/tests

PR #35:

* `proposal.readiness` の NotReady / Blocked coverage 追加

Phase 3.4 は概ね合格だが、readiness report の ledger sanitizer allowlist と phase-loop state の整合性に follow-up が必要。

## 目的

Phase 3.4.1 では以下を修正する。

```text
- WorkspacePatchReadinessReportCreated の ledger payload が inspection / run.events で落ちないように sanitizer allowlist を補正する
- readiness report 関連 metadata が raw content を含まず安全に観測できることを test で保証する
- phase-loop state が Phase 3.4.1 実行後に review task へ渡せるように維持する
```

## 重要な制約

1. 実ファイルを書き換えない。
2. patch apply しない。
3. git command / shell command の新規 runtime 機能を追加しない。
4. process.exec / network / service control / destructive operation / subtask.spawn を追加しない。
5. canonical absolute path を返さない。
6. file content を保存しない。
7. full content / raw_content / full_content / patch / raw_input を保存しない。
8. secret-like text を report/checklist/summary に出さない。
9. Zoo Code / ZooCodeCustom からコードをコピーしない。

## 修正内容

### 1. Runtime sanitizer allowlist を補正する

`WorkspacePatchReadinessReportCreated` の payload で使われる summary-only fields を `sanitize_ledger_payload()` の allowlist に追加する。

追加候補:

```text
report_id
readiness_status
readiness_reason
generated_at
blocked_checks
```

既に `check_count` / `failed_checks` がある場合は維持する。

禁止 field は追加しない。

禁止 field:

```text
content
raw_content
full_content
patch
diff
raw_input
canonical_path
absolute_path
file_content
```

### 2. Readiness report ledger event の test を追加する

最低限、以下を確認する。

```text
- proposal.readiness 実行後に WorkspacePatchReadinessReportCreated が ledger に存在する
- run.events または inspect 系 summary で report_id / readiness_status / generated_at / check_count / failed_checks / blocked_checks が観測できる
- forbidden raw fields が payload に含まれない
- readiness report generation は workspace file を変更しない
```

### 3. VSIX validator の維持確認

既存の `hasNoForbiddenRawFields` が以下を reject することを維持する。

```text
content
raw_content
full_content
patch
diff
raw_input
canonical_path
absolute_path
file_content
```

必要なら readiness report validator test を補強する。

## phase-state の扱い

この PR は Phase 3.4.1 の実装 PR とする。

PR 作成時:

```json
{
  "current_phase": "3.4.1",
  "status": "awaiting_review",
  "latest_pr": <created_pr_number>,
  "last_reviewed_pr": 35
}
```

レビュー task が合格判定した後に、次の Phase 3.5 へ進める。

## Required Verification

```bash
cargo fmt --check
cargo check --workspace
cargo test --workspace

pnpm install
pnpm --filter brownie-vsix check
pnpm --filter brownie-vsix test
pnpm --filter brownie-vsix build
```

## PR description に書くこと

```text
## Summary
- Added readiness report ledger sanitizer fields.
- Added tests ensuring WorkspacePatchReadinessReportCreated is observable through sanitized ledger output.
- Confirmed forbidden raw fields remain excluded.
- Confirmed no write/apply behavior was introduced.

## Testing
- cargo fmt --check
- cargo check --workspace
- cargo test --workspace
- pnpm install
- pnpm --filter brownie-vsix check
- pnpm --filter brownie-vsix test
- pnpm --filter brownie-vsix build
```

## 禁止事項

```text
- patch apply しない
- workspace file を書き換えない
- main に直接 push しない
- PR を自動 merge しない
- blocked 状態から自動復帰しない
- Zoo Code / ZooCodeCustom からコードをコピーしない
```
