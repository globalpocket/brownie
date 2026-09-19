#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const terminalEventTypes = new Set(['todo.completed', 'todo.replanned', 'todo.blocked']);
const requiredPrefix = ['todo.claimed', 'workflow.routed', 'skill.selected'];
const forbiddenPayloadPatterns = [
  { id: 'absolute_user_path', pattern: /\/Users\/|\/home\/|C:\/Users\//i },
  { id: 'private_state_path', pattern: /\.brownie\/private\//i },
  { id: 'raw_process_output_label', pattern: /raw stdout|raw stderr|EncodedCommand/i }
];

function parseArgs(argv) {
  const args = {
    trajectory: '',
    output: '',
    allowPartial: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--trajectory') {
      args.trajectory = argv[++index] ?? '';
    } else if (arg === '--output') {
      args.output = argv[++index] ?? '';
    } else if (arg === '--allow-partial') {
      args.allowPartial = true;
    } else {
      throw new Error(`Unsupported argument: ${arg}`);
    }
  }
  return args;
}

function resolveInputPath(inputPath) {
  if (!inputPath) {
    throw new Error('--trajectory is required.');
  }
  return path.isAbsolute(inputPath) ? inputPath : path.join(repoRoot, inputPath);
}

function readTrajectoryJsonl(inputPath) {
  const fullPath = resolveInputPath(inputPath);
  const text = fs.readFileSync(fullPath, 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        return {
          __parse_error: String(error?.message ?? error),
          __line: index + 1
        };
      }
    });
}

function eventsFromRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return [];
  }
  if (!Array.isArray(record.events)) {
    return [];
  }
  return record.events.map((event) => ({
    ...event,
    run_id: record.run_id,
    root_claim_id: record.claim_id
  }));
}

function findForbiddenPayload(value, pathParts = []) {
  if (typeof value === 'string') {
    for (const { id, pattern } of forbiddenPayloadPatterns) {
      if (pattern.test(value)) {
        return { id, path: pathParts.join('.') || '<payload>', value };
      }
    }
    return null;
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      const found = findForbiddenPayload(child, [...pathParts, String(index)]);
      if (found) {
        return found;
      }
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const found = findForbiddenPayload(child, [...pathParts, key]);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function orderedAtLeastOnce(types, sequence) {
  let cursor = 0;
  for (const type of types) {
    const foundAt = sequence.indexOf(type, cursor);
    if (foundAt < 0) {
      return false;
    }
    cursor = foundAt + 1;
  }
  return true;
}

export function evaluateBdkPublicHarnessTrajectory(records, { allowPartial = false } = {}) {
  const failures = [];
  const allEvents = [];
  const parseErrors = records.filter((record) => record?.__parse_error);
  for (const parseError of parseErrors) {
    failures.push({
      class: 'trajectory_parse_error',
      line: parseError.__line,
      message: parseError.__parse_error
    });
  }
  for (const record of records.filter((entry) => !entry?.__parse_error)) {
    allEvents.push(...eventsFromRecord(record));
  }
  const runGroups = new Map();
  for (const event of allEvents) {
    const key = `${event.run_id ?? ''}::${event.root_claim_id ?? event.claim_id ?? ''}`;
    if (!runGroups.has(key)) {
      runGroups.set(key, []);
    }
    runGroups.get(key).push(event);
  }
  for (const [key, events] of runGroups.entries()) {
    const types = events.map((event) => event.type);
    if (!orderedAtLeastOnce(requiredPrefix, types)) {
      failures.push({
        class: 'state_machine_prefix_missing',
        run_claim: key,
        expected: requiredPrefix,
        actual: types,
        repair_hint: 'Ensure each Brownie run emits todo.claimed -> workflow.routed -> skill.selected before Runtime or fallback work.'
      });
    }
    const terminalEvents = types.filter((type) => terminalEventTypes.has(type));
    if (!allowPartial && terminalEvents.length === 0) {
      failures.push({
        class: 'terminal_event_missing',
        run_claim: key,
        actual: types,
        repair_hint: 'Emit todo.completed, todo.replanned, or todo.blocked before finishing a harness-evaluated run.'
      });
    }
    if (terminalEvents.length > 1) {
      failures.push({
        class: 'multiple_terminal_events',
        run_claim: key,
        actual: terminalEvents,
        repair_hint: 'A single claim/run trajectory must finish with one terminal event.'
      });
    }
    for (const event of events) {
      if (event.claim_id !== event.root_claim_id) {
        failures.push({
          class: 'claim_id_mismatch',
          run_claim: key,
          event_type: event.type,
          repair_hint: 'The event claim_id must match the trajectory root claim_id.'
        });
      }
      const forbidden = findForbiddenPayload(event.payload);
      if (forbidden) {
        failures.push({
          class: 'forbidden_payload_detail',
          run_claim: key,
          event_type: event.type,
          detail: forbidden.id,
          payload_path: forbidden.path,
          repair_hint: 'Sanitize public harness payloads. Store paths and raw process details in private files, not trajectory payloads.'
        });
      }
    }
  }
  const latestEvent = allEvents.at(-1) ?? null;
  return {
    schema_version: 1,
    ok: failures.length === 0,
    evaluated_at: new Date().toISOString(),
    run_count: runGroups.size,
    event_count: allEvents.length,
    latest_run_id: latestEvent?.run_id ?? '',
    latest_claim_id: latestEvent?.root_claim_id ?? latestEvent?.claim_id ?? '',
    terminal_event_count: allEvents.filter((event) => terminalEventTypes.has(event.type)).length,
    failures
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const result = evaluateBdkPublicHarnessTrajectory(readTrajectoryJsonl(args.trajectory), {
    allowPartial: args.allowPartial
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) {
    const outputPath = path.isAbsolute(args.output) ? args.output : path.join(repoRoot, args.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, output, { mode: 0o600 });
  } else {
    process.stdout.write(output);
  }
  if (!result.ok) {
    process.exit(1);
  }
}
