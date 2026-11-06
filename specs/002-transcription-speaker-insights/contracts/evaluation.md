# Local Comparison and Acceptance Evidence

Date: 2026-11-05. [Spec](../spec.md) / [research decisions](../research.md).
This contract defines the proposed local harness; no scores below are claimed.

## Frozen inputs

Use a versioned local evaluation manifest under ignored `.build/fixtures/` with:

- Recording ID, local path, SHA-256, decoded duration/rate, language, reference count,
  conditions (noise/compression/overlap/quiet speech) and development/held-out split.
- Permission/license and attribution, reference transcript hash, speaker-activity
  reference hash, annotated evaluation regions, annotator/reviewer version.
- Candidate profile identities and exact artifact revisions/hashes, runtime lock,
  device/compute/batch/thread settings, scoring version and report location.
  Each entry declares its role as `control` or `candidate`.

Freeze at least 12 conversations / 60 minutes, at least 30 minutes per language,
at least two conversations for every count from one through four, and at least
four held-out conversations (two per language). Keep private content and identifying
annotations outside Git. The committed fixture README documents preparation;
it does not contain private audio. A missing human-reference corpus blocks an
accuracy claim, not deterministic unit/contract implementation.

## Candidates and comparable runs

Required controls: current multilingual base and small on CPU, rerun on the same
conversations. Compare larger native Whisper models using a bounded experimental
allowlist change at both discovery and loaded-metadata gates, with failing tests
first; do not rename unsupported weights or enable unmeasured options in the UI.

Primary candidates: WhisperX large-v3 and turbo, CPU int8 and CUDA configurations
supported by the frozen runtime. Record actual ASR and Torch-stage devices. Use
batch size 1 initially and preserve selected PT/EN. Native Parakeet/Nemotron is an
experiment with the eligibility gates in research R2. No extra production adapters.

Record matching decoding settings or explicitly separate differing-model/system
comparisons; never describe a beam/thread/VAD change as a pure backend speedup.
No held-out tuning. Hinted runs are labelled and excluded from automatic-count
acceptance. The only recommendation is a measured profile that passes the gates.

## Scoring rules

| Measure | Frozen definition and acceptance |
| --- | --- |
| WER | Unicode NFC, lowercase, punctuation to spaces, collapsed whitespace; preserve accents/digits. Sum substitutions+deletions+insertions / reference words per language. Candidate held-out WER <=0.8 times the better remeasured legacy option per language (SC-001). Report speech-free insertions separately. |
| DER | Zero collar; include overlap; optimal one-to-one speaker matching over annotated regions. Retain missed speech, false alarms and confusion; <=15% per held-out language (SC-003). |
| Speaker count | Exact automatic count; at least ceil(0.9*N) correct overall and ceil(0.75*H) held-out. With N=12,H=4 this is 11 and 3 (SC-002). |
| Speaker duration | Include every eligible reference person with >=30 seconds, including missed people with predicted zero. After identity matching, >=90% satisfy absolute error <=max(3 seconds,10% reference duration) (SC-004). |
| Deterministic analytics | Exact interval/turn/rounding/coverage examples, including 7999/8000/8001-tick gaps and chunk-invariance (SC-004). |
| Speaker-attributed words | Per recording, minimize total per-speaker word edit cost over a one-to-one permutation including dummy streams for missing/extra speakers. Unassigned hypotheses must match only dummy reference streams and incur errors; never match them to a real reference person. Diagnostic; no additional success threshold. |
| Real-audio turns | Apply the product turn rule to references and predictions after matching; report per-speaker absolute turn error. Diagnostic, without inventing a spec threshold. |
| Controls | Declared silence/music/noise/tone and attenuated-speech fixtures, with speech-free false words/speakers/turns reported (SC-005). |
| Resources/time | End-to-end cold decode/load/ASR/alignment/diarization/report and warm time separately, RAM/VRAM peaks, cancellation acknowledgement. A 10-minute reference completes <=1200 seconds on a declared configuration (SC-006). |
| Preservation/offline | Before/after audio hashes; partial/full export status agreement; disconnected run plus connected zero-attempt trace for all child processes (SC-007/008). |

Perform every speaker-identity matching separately per recording, then aggregate
error/reference totals per language. Speaker IDs have no meaning across files.
Do not score only detected speakers or only easy excerpts. Retain raw hypotheses,
normalization output, scoring settings and reports. For datasets lacking precise
speaker activity, do not invent DER references from approximate text segments.

## Harness interface and evidence

Planned `scripts/benchmark-conversations.ps1` accepts `-Manifest`, `-Candidate`,
`-Device cpu|cuda` and a unique `-ReportName`. Candidate entries come from the
frozen evaluation manifest, not arbitrary shell strings. The existing
`scripts/benchmark.ps1` continues its original read-speech role.

Reports are create-new JSON under ignored `.build/benchmarks/`, with manifest/hash,
candidate/runtime/assets identity, original input hashes, machine inventory,
per-language/per-recording/speaker results, aggregate metrics, settings, warnings,
peak memory and cold/warm timings. Invalid input or execution/scoring failure exits
nonzero. Controls complete with candidate-only gates marked not applicable and
`acceptance_passed: null`; a successful control run exits zero. Candidate reports
record measured gates as pass/fail/not-run, `acceptance_scope: corpus`, and
`acceptance_passed: true|false|null` (null when a required corpus gate is not run).
Failed or incomplete required candidate corpus gates exit nonzero. A passing
corpus report does not establish UI, package or connected-network acceptance;
those remain separate checks in the quickstart. Preserve failed evidence; never
overwrite a run.

Summarize human-readable evidence and limits directly under `docs/`. Publisher
numbers, historic FLEURS results, synthetic tests and raw model throughput are
not substitutes for this product acceptance run.
