# Brownie TODO Queue

This file is the shared priority queue between the external Brownie phase-loop
controller and Brownie itself.

`phase-loop.md` remains the execution prompt and product boundary contract.
`todo.md` is the ordered list of concrete work items Brownie should consume.
The external controller may add, remove, or reorder unchecked items. Brownie may
refine the list when evidence changes, but must keep the list small, concrete,
and ordered by priority.

## Queue protocol

- Pending work is represented by unchecked Markdown task items: `- [ ] ...`.
- The first unchecked item is the highest-priority pending TODO.
- When Brownie starts work on a TODO, it must remove that TODO from this file,
  then record the active work in the normal Runtime/phase evidence for the
  current run.
- If the started work cannot be completed in the current slice, Brownie must add
  a follow-up TODO with the remaining concrete blocker or next implementation
  step before exiting.
- Do not use checked items as durable completion evidence. Completed work must
  be supported by implementation, tests, CI, PR/merge evidence, and the normal
  phase-loop audit artifacts.
- If this queue has no unchecked items and there is no active in-progress work,
  the phase-loop supervisor should stop instead of starting another Brownie run.

## Pending TODOs

- [ ] P0: Repair Runtime/CLI continuation so repeated `unknown_nonterminal` +
  `inspect_progress_overview` runs choose an actionable Product Ready slice or
  classify a concrete blocker instead of looping.
- [ ] P0: Close the MCP approval lock truncation safety regression with a failing
  test first, then an atomic lock acquisition fix.
- [ ] P0: Remove or route `workspace.append_line` through the authorized
  `workspace.write` proposal/application path.
- [ ] P0: Remove or strictly bound `runtime.sleep` so Runtime does not own
  scheduler/backoff behavior.
- [ ] P0: Reclassify `time.now` as read-only Runtime clock observation rather
  than process execution.
- [ ] P1: Bound `brownie run --file` file handling, including oversized,
  directory, special-file, UTF-8, and bounded-error rejection.
- [ ] P1: Finish `llm_provider_access` separation from generic network access
  across Runtime permissions, CLI/VSIX surfaces, docs, and evidence.
