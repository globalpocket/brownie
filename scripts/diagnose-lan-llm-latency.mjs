import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultRepoRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = {
    repoRoot: defaultRepoRoot,
    baseUrl: process.env.BROWNIE_LLM_BASE_URL ?? null,
    json: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') {
      continue;
    } else if (arg === '--repo-root') {
      options.repoRoot = path.resolve(argv[++index] ?? '');
    } else if (arg === '--base-url') {
      options.baseUrl = argv[++index] ?? null;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readPrivateEnv(repoRoot) {
  const envPath = path.join(repoRoot, '.brownie', 'private', 'llm.env');
  const values = {};
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return values;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    let value = rest.join('=').trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key.trim()] = value;
  }
  return values;
}

function* walk(directory) {
  let entries = [];
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else {
      yield fullPath;
    }
  }
}

function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function previewShape(preview) {
  const text = String(preview ?? '').trim();
  if (text.startsWith('```brownie-tool-intent')) return 'strict_brownie_fence';
  if (text.startsWith('```json')) return 'json_fence';
  if (text.startsWith('brownie-tool-intent')) return 'label_then_json_fence';
  if (text.includes('tool_requests')) return 'tool_json_unfenced_or_mixed';
  if (text.length === 0) return 'empty';
  return 'prose_or_other';
}

function collectLedgerStats(repoRoot) {
  const privateRoot = path.join(repoRoot, '.brownie', 'private');
  const events = [];
  for (const filePath of walk(privateRoot)) {
    if (!filePath.endsWith('ledger.jsonl')) continue;
    const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const kind = event.kind;
      if (![
        'PromptBuilt',
        'SecondPassPromptBuilt',
        'LlmResponseReceived',
        'SecondPassLlmResponseReceived',
        'LlmRequestFailed',
        'SecondPassLlmRequestFailed'
      ].includes(kind)) {
        continue;
      }
      const payload = event.payload ?? {};
      events.push({
        kind,
        timestamp: event.timestamp,
        durationMs: Number.isFinite(payload.llm_request_duration_ms) ? payload.llm_request_duration_ms : null,
        promptChars: Number.isFinite(payload.llm_request_prompt_chars) ? payload.llm_request_prompt_chars : null,
        shape: previewShape(payload.content_preview ?? payload.prompt_preview ?? payload.reason ?? ''),
        failed: kind.endsWith('RequestFailed')
      });
    }
  }
  const durations = events.map((event) => event.durationMs).filter(Number.isFinite);
  const promptChars = events.map((event) => event.promptChars).filter(Number.isFinite);
  const shapeCounts = {};
  for (const event of events) {
    shapeCounts[event.shape] = (shapeCounts[event.shape] ?? 0) + 1;
  }
  return {
    event_count: events.length,
    failed_request_count: events.filter((event) => event.failed).length,
    duration_ms: {
      count: durations.length,
      min: durations.length ? Math.min(...durations) : null,
      p50: quantile(durations, 0.5),
      p90: quantile(durations, 0.9),
      max: durations.length ? Math.max(...durations) : null
    },
    prompt_chars: {
      count: promptChars.length,
      min: promptChars.length ? Math.min(...promptChars) : null,
      p50: quantile(promptChars, 0.5),
      p90: quantile(promptChars, 0.9),
      max: promptChars.length ? Math.max(...promptChars) : null
    },
    response_shape_counts: shapeCounts,
    recent: events.slice(-12)
  };
}

async function fetchModelSummary(baseUrl) {
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/$/, '')}/models`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const body = await response.json();
    const models = Array.isArray(body.data) ? body.data : [];
    return {
      loaded: models
        .filter((model) => model?.status?.value === 'loaded')
        .map((model) => ({
          id: model.id,
          ctx: model.meta?.n_ctx ?? null,
          params: model.meta?.n_params ?? null
        })),
      available_count: models.length
    };
  } catch (error) {
    return { error: error.name === 'AbortError' ? 'timeout' : error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function recommendations(stats, modelSummary) {
  const items = [];
  if ((stats.duration_ms.p50 ?? 0) > 30000) {
    items.push('Configure BROWNIE_LLM_MODEL_FAST for context/tool-intent turns and BROWNIE_LLM_MODEL_CODE for patch synthesis.');
  }
  if ((stats.prompt_chars.p50 ?? 0) > 30000) {
    items.push('Reduce effective prompt and context-window size before changing llama.cpp sampling knobs.');
  }
  if ((stats.response_shape_counts.prose_or_other ?? 0) > 0 || (stats.response_shape_counts.label_then_json_fence ?? 0) > 0) {
    items.push('Keep parser tolerance and strengthen stop/output constraints; response shape drift is observable.');
  }
  const loaded = modelSummary?.loaded ?? [];
  if (loaded.some((model) => model.ctx && model.ctx >= 200000)) {
    items.push('The loaded model uses a very large context; consider an 8k-32k fast profile for phase-loop tool-intent turns.');
  }
  return items;
}

export async function run(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const privateEnv = readPrivateEnv(options.repoRoot);
  options.baseUrl = options.baseUrl ?? privateEnv.BROWNIE_LLM_BASE_URL ?? null;
  const stats = collectLedgerStats(options.repoRoot);
  const modelSummary = await fetchModelSummary(options.baseUrl);
  const result = {
    schema_version: 1,
    repo_root: options.repoRoot,
    base_url_checked: options.baseUrl ? options.baseUrl.replace(/\/\/.*@/, '//<redacted>@') : null,
    stats,
    model_summary: modelSummary,
    recommendations: recommendations(stats, modelSummary)
  };
  if (options.json) {
    return `${JSON.stringify(result, null, 2)}\n`;
  }
  const lines = [
    `LLM events: ${stats.event_count}, failed requests: ${stats.failed_request_count}`,
    `Latency ms: count=${stats.duration_ms.count} p50=${stats.duration_ms.p50 ?? 'n/a'} p90=${stats.duration_ms.p90 ?? 'n/a'} max=${stats.duration_ms.max ?? 'n/a'}`,
    `Prompt chars: count=${stats.prompt_chars.count} p50=${stats.prompt_chars.p50 ?? 'n/a'} p90=${stats.prompt_chars.p90 ?? 'n/a'} max=${stats.prompt_chars.max ?? 'n/a'}`,
    `Response shapes: ${JSON.stringify(stats.response_shape_counts)}`,
    `Loaded models: ${JSON.stringify(modelSummary?.loaded ?? modelSummary ?? null)}`,
    'Recommendations:',
    ...result.recommendations.map((item) => `- ${item}`)
  ];
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] === __filename) {
  try {
    process.stdout.write(await run());
  } catch (error) {
    process.stderr.write(`diagnose LAN LLM latency: ${error.message}\n`);
    process.exitCode = 64;
  }
}
