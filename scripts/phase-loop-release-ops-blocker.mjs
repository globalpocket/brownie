#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

function fail(reason, extra = {}) {
  console.log(JSON.stringify({ applied: false, reason, ...extra }));
  process.exit(2);
}

const [claimPath, backupPath, todoPath, runStamp, timestamp] = process.argv.slice(2);
if (!claimPath || !backupPath || !todoPath || !runStamp || !timestamp) {
  fail('usage');
}

let claim;
let backup;
try {
  claim = JSON.parse(fs.readFileSync(claimPath, 'utf8'));
  backup = fs.readFileSync(backupPath, 'utf8');
} catch (error) {
  fail(`unreadable:${error.message}`);
}

const selected = claim.selected_todo;
if (typeof selected !== 'string' || !selected.trim()) {
  fail('missing_selected_todo');
}

const firstLine = selected.split('\n')[0]?.trim() ?? '';
const idMatch = firstLine.match(/^- \[ \] ([^:\s]+):/u);
if (!idMatch) {
  fail('missing_selected_id');
}
const selectedId = idMatch[1];

if (!selected.includes('Route: release-ops')) {
  fail('selected_todo_not_release_ops');
}
if (!firstLine.includes('Patch only `')) {
  fail('selected_todo_not_patch_only_refresh');
}
if (!backup.includes(selected)) {
  fail('selected_todo_not_in_backup');
}

const blockerId = selectedId.endsWith('-remaining-blocker')
  ? selectedId
  : `${selectedId}-remaining-blocker`;

const blocker = `- [ ] ${blockerId}: Blocker: release-ops evidence refresh completed, but Product Ready is still false and remaining release evidence blockers must stay explicit.
  Route: release-ops.
  Depends on: <none>.
  Completion condition: remaining release blocker evidence is explicitly identified and Product Ready is not inferred from an empty queue.
  Forbidden changes: do not patch workspace files for this blocker; do not declare Runtime Product Ready, Runtime Release Ready, or public Release Ready.
  Verification: blocker: release evidence remains fail-closed and no workspace file is patched until the next concrete executable evidence TODO is available.
`;

const replacement = backup.replace(selected, blocker);
const tmpPath = path.join(
  path.dirname(todoPath),
  `${path.basename(todoPath)}.${process.pid}.release-ops-blocker-${runStamp}.tmp`
);

const fd = fs.openSync(tmpPath, 'w');
try {
  fs.writeFileSync(fd, replacement, 'utf8');
  fs.fsyncSync(fd);
} finally {
  fs.closeSync(fd);
}
fs.renameSync(tmpPath, todoPath);

try {
  const dirFd = fs.openSync(path.dirname(todoPath), 'r');
  try {
    fs.fsyncSync(dirFd);
  } finally {
    fs.closeSync(dirFd);
  }
} catch {
  // Directory fsync is best-effort on some filesystems.
}

console.log(JSON.stringify({
  applied: true,
  blocker_id: blockerId,
  operation: 'replace_completed_release_ops_with_remaining_blocker',
  run_stamp: runStamp,
  timestamp
}));
