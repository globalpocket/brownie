# LAN LLM tuning for the Brownie phase loop

This note captures the local tuning policy for Brownie phase-loop replacement
runs against a LAN OpenAI-compatible llama.cpp server.

## Current observed bottleneck

Local ledger diagnostics show phase-loop LLM requests around 35k-40k prompt
characters, with LAN LLM p50 latency around one minute for recent runs.

The currently loaded model profile observed through `/v1/models` is
`qwen35-MTP`, a 35B BF16 model with a 262k context. That profile is useful for
large code reasoning, but it is expensive for the common phase-loop operation:
produce a short `brownie-tool-intent` JSON block after a bounded file read.

## Tuning priority

Apply tuning in this order:

1. Reduce Brownie prompt/context size.
2. Route simple context/tool-intent turns to a smaller fast model.
3. Keep a larger code model for patch synthesis when the prompt already
   contains enough bounded file context.
4. Tune llama.cpp server parameters only after the workload shape is separated.

## Recommended local model roles

- `fast`: 8k-32k context, reasoning off, smaller model such as
  `qwen35-4b-q4km`. Use for first-pass context planning, TODO decomposition,
  and strict JSON tool-intent generation.
- `code`: prefer `qwen35-9b-coder-q4km` for automatic phase-loop second-pass
  synthesis. In near-operational `phase-loop.sh run-once` tests it was the
  only tested code model that completed quickly with no tool-intent rejection.
  Keep `devstral-small2-24b-q4km` as a manual non-Qwen fallback candidate and
  `gpt-oss-120B` as a heavy review-quality candidate. Avoid `qwen122`,
  `qwen122-long`, `gemma4-12B`, `qwen36-35b-a3b-iq4xs`, and non-coder `qwen35`
  for routine automatic patch synthesis unless later tests show improved
  structured-output behavior.
- `deep`: optional larger/long-context model. Avoid using it in the automatic
  phase loop unless a TODO explicitly needs long-context synthesis.

Brownie Runtime supports phase-loop per-pass routing with:

- `BROWNIE_LLM_MODEL_FAST` for the first LLM pass.
- `BROWNIE_LLM_MODEL_CODE` for second-pass and read-follow-up code synthesis.
- `BROWNIE_LLM_MAX_TOKENS_FAST` and `BROWNIE_LLM_MAX_TOKENS_CODE` for
  per-pass completion limits when a local server is prone to long generations.
- `BROWNIE_LLM_TEMPERATURE_FAST`, `BROWNIE_LLM_TOP_P_FAST`,
  `BROWNIE_LLM_TOP_K_FAST`, and the matching `*_CODE` variables for per-pass
  sampling control. `phase-loop.sh` applies model-specific defaults for known
  local aliases when these variables are unset.
- These variables only affect goals containing `# Brownie Phase Loop Effective Prompt`.
- `phase-loop.sh` exports `PHASE_LOOP_LLM_MODEL_FAST` and
  `PHASE_LOOP_LLM_MODEL_CODE`, plus the matching per-pass max-token variables,
  to the corresponding Runtime variables when they are present.

## llama.cpp server profile guidance

For the fast profile:

- prefer `ctx-size = 8192` to `32768`;
- keep `reasoning = off`;
- keep `parallel = 1` for deterministic phase-loop behavior;
- keep `cache-prompt = true`;
- use `cache-reuse` only if the prompt prefix is stable enough to benefit;
- prefer smaller quantized weights over very large BF16 weights.

For the code profile:

- keep `reasoning = off` unless a specific model requires it for instruction
  following;
- avoid 262k context unless the Runtime prompt actually needs it;
- keep timeout high enough for a single patch turn, but rely on Brownie read
  budgets to avoid multiple long calls.
- start with `BROWNIE_LLM_MAX_TOKENS_CODE=512` for automatic phase-loop runs;
  raise it only for a concrete task that demonstrably needs longer patch
  synthesis.
- keep sampling conservative for structured tool-intent output. The current
  model-specific phase-loop defaults are:

| pass | model alias | temperature | top_p | top_k | rationale |
|---|---:|---:|---:|---:|---|
| fast | `qwen35-4b-q4km` | 0 | 0.8 | 20 | deterministic context/tool selection |
| fast | `qwen35-9b-q4km` | 0 | 0.8 | 20 | deterministic context/tool selection |
| fast | `gemma4-12B` | 0 | 0.95 | 40 | preserve prior fast-model behavior while staying deterministic |
| code | `qwen35-9b-coder-q4km` | 0 | 0.8 | 20 | best observed speed/format adherence |
| code | `qwen122` | 0 | 0.8 | 20 | quality fallback; slower but structured-output capable |
| code | `qwen122-long` | 0 | 0.7 | 20 | narrower sampling to reduce fence drift |
| code | `qwen35` / `qwen35-MTP` | 0 | 0.7 | 20 | narrower sampling to reduce invalid `workspace.write` content |
| code | `qwen36-35b-a3b-iq4xs` | 0 | 0.8 | 20 | conservative structured patch synthesis |
| code | `devstral-small2-24b-iq4xs` | 0 | 0.8 | 20 | conservative structured patch synthesis |

## Current local operating profile

The current local profile validated by a phase-loop `run-once` uses:

- `BROWNIE_LLM_MODEL_FAST=qwen35-4b-q4km`
- `BROWNIE_LLM_MODEL_CODE=qwen35-9b-coder-q4km`
- `BROWNIE_LLM_MAX_TOKENS_FAST=512`
- `BROWNIE_LLM_MAX_TOKENS_CODE=512`
- `BROWNIE_LLM_TEMPERATURE_FAST=0`
- `BROWNIE_LLM_TOP_P_FAST=0.8`
- `BROWNIE_LLM_TOP_K_FAST=20`
- `BROWNIE_LLM_TEMPERATURE_CODE=0`
- `BROWNIE_LLM_TOP_P_CODE=0.8`
- `BROWNIE_LLM_TOP_K_CODE=20`

Observed on the local LAN server:

- `qwen35-4b-q4km` first-pass tool-intent turn with
  `qwen35-9b-coder-q4km` code pass completed a safe practical code-edit test
  in ~22 seconds end-to-end.
- `qwen35-9b-coder-q4km` is the routine code-pass default because it was the
  fastest model that completed `workspace.read` -> `workspace.write` ->
  patch application -> external verification in the practical comparison.
- `devstral-small2-24b-q4km` completed the same safe practical test in ~70
  seconds and remains a manual non-Qwen fallback candidate.
- `gpt-oss-120B` completed the same safe practical test in ~125 seconds and is
  reserved for heavy review/quality checks rather than routine loop turns.
- `qwen122` and `gemma4-12B` did not complete the same safe practical edit
  test successfully and should not be used for routine automatic patch
  synthesis without new evidence.

## 2026-09-11 final-smoke

Brownie Runtime verified that after a bounded `workspace.read` of
`docs/architecture/lan-llm-phase-loop-tuning.md`, the same file can be
patched with a single `workspace.write` patch_file using a short
complete-line old_text/new_text hunk. The marker line above confirms
this verification completed successfully.

## Brownie-side guardrails

- Run `pnpm --workspace-root diagnose:lan-llm` after operational tests to
  inspect latency, prompt size, response-shape drift, loaded model, and local
  recommendations.
- Keep parser tolerance for `json` fences and incomplete fences, because local
  llama.cpp responses have shown format drift.
- Keep phase-loop read budgets low. Long-context discovery loops are more
  expensive than writing a concrete follow-up TODO.
- Use per-pass provider/model routing so the first context/tool-intent pass can
  use `fast` while patch synthesis can use `code`.
