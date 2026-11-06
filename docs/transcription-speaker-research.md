# Transcription accuracy and speaker analysis research

Research date: 2026-11-05. Related feature:
[Accurate Transcription and Speaker Insights](../specs/002-transcription-speaker-insights/spec.md).

## Recommendation

Evaluate two complete local approaches before selecting a backend:

1. **WhisperX with Whisper large-v3, language-specific alignment and pyannote
   Community-1** as the established comparison pipeline. Include turbo as a
   speed/memory variant. This directly addresses words, timestamps and anonymous
   speaker attribution, but requires a substantially larger runtime than the
   current app.
2. **Parakeet TDT 0.6B v3 with Nemotron 3 Diarization through NeMo-Speech.cpp** as
   the native-runtime challenger. Current upstream documentation describes both
   models and Windows support. Validate the exact build rather than assuming
   current source documentation describes an available stable binary.

Also measure **Whisper medium, large-v3 and turbo in the existing whisper.cpp
runtime**. This isolates improvements from larger weights versus changing the
entire pipeline. Keep **Qwen3-ASR 1.7B** as an accuracy challenger if the first
comparison does not meet the feature gates. Do not build integrations for every
candidate: use repeatable offline experiments and choose the smallest solution
that passes. These are research recommendations, not measured rankings.

The user explicitly confirmed **local only; compare CPU and GPU options**. No
cloud provider is proposed. Initial delivery should analyze completed recordings;
preserve current live text while avoiding an additional promise of stable live
speaker identities. Model selection is a planning/measurement decision, not a
requirement to use WhisperX merely because it was suggested.

## What the app actually does today

Verified against the working tree, including the user's existing staged changes:

| Finding | Evidence | Consequence |
| --- | --- | --- |
| Windows Rust application using whisper-rs 0.16 with default features disabled | [Cargo.toml](../Cargo.toml), [project overview](project-overview.md) | Reusing native inference is a real option. A Python pipeline changes packaging requirements. |
| Discovery and loaded metadata accept only base/small, including English-only variants | [models.rs](../src/models.rs), [worker.rs](../src/transcription/worker.rs) | Copying larger weights into the folder does not currently enable them; validation explicitly rejects them. |
| The worker explicitly disables GPU use and uses greedy decoding with no prior context | [worker.rs](../src/transcription/worker.rs) | Accuracy/runtime complaints cannot be attributed solely to model family. Measure model size, decoding and backend separately. |
| Silero gates whole inference windows rather than trimming speech intervals | [worker.rs](../src/transcription/worker.rs) | The existing VAD does not itself supply a person-level speech timeline. |
| Transcript segments contain start/end samples and text, without speakers or words | [transcription/mod.rs](../src/transcription/mod.rs) | Speaker analysis needs additional result information; turn counts cannot be inferred from current chunk counts. |
| Microphone and computer output are mixed before live mono conversion | [audio/mod.rs](../src/audio/mod.rs) | Stereo is not a preserved local/remote person split. Output may already contain several remote people. |
| Capture/storage are independent of a supervised inference child | [project overview](project-overview.md) | Preserve this safety property regardless of the chosen inference implementation. |

Existing evidence already shows that the selected model matters:

| Existing measurement | Portuguese WER | English WER | Limits |
| --- | ---: | ---: | --- |
| Base, original whole-clip CPU feasibility run | 14.08% | 9.74% | Read speech; different pipeline from later imported-file run |
| Small, original whole-clip CPU feasibility run | 6.78% | 5.98% | Same feasibility phase, not evidence of call or diarization accuracy |
| Base, later optimized imported-WAV path with VAD | 13.91% | 9.74% | About ten minutes per language; references not independently human-audited |

These are historical repository measurements, not new experiments. Do not compare
their times across phases as controlled speedups. The imported base runs took
76.31 seconds for 611.28 seconds of Portuguese and 94.56 seconds for 600.96 seconds
of English. FLEURS read speech does not settle spontaneous Brazilian conversations,
overlap, proper nouns or speaker counting. See [implementation evidence](implementation-validation.md).

The documented reference CPU is an Intel Core i7-11800H with 16 logical processors
and approximately 63.77 GiB RAM. A read-only GPU inventory during this research
confirmed **NVIDIA GeForce RTX 3070 Laptop GPU, 8192 MiB, driver 577.00**. No new
candidate model was downloaded, installed or benchmarked. Driver compatibility,
available free VRAM and packaged GPU operation still require testing.

## Four separate jobs

| Job | Question answered | Evidence needed |
| --- | --- | --- |
| Speech recognition | What words were said? | Word error rate (WER), including inserted words, by language and recording condition |
| Alignment | When were those words said? | Boundary error and unaligned-word rate against human timing |
| Speaker diarization | Which anonymous person spoke when? | Diarization error rate (DER), count accuracy and returning-speaker consistency |
| Participation arithmetic | How long and how often did each person speak? | Exact interval/turn tests, followed by duration error against real annotated speech |

This distinction is essential: more precise alignment does not establish better
word recognition, and correct arithmetic does not make incorrect speaker labels
accurate. Derive speaking duration from speaker activity, not the outer bounds of
sentences that may include silence.

## Speech-recognition candidates

| Candidate | Portuguese and English | Role in evaluation | Deployment caveat |
| --- | --- | --- | --- |
| Whisper medium / large-v3 / large-v3-turbo | Multilingual variants support both | First comparison against existing base/small; evaluate accuracy and speed separately | Larger models and quantization/device settings must pass actual resource checks |
| Parakeet TDT 0.6B v3 | Both listed among 25 supported languages | Main native-runtime challenger; word timestamps are provided | v2 is English-only; do not substitute it for v3 |
| Qwen3-ASR 1.7B / 0.6B | Both listed; Portuguese is also supported by its separate aligner | Additional accuracy comparison if required | Official streaming path currently requires vLLM and does not return timestamps |
| Canary 1B v2 | Both among 25 supported languages | Reserve multilingual comparator | Translation is extra capability the feature does not need |
| VibeVoice-ASR | Broad multilingual model; verify Brazilian Portuguese with real audio | Reserve integrated words/speakers/timestamps experiment | Model metadata reports 9B BF16 parameters; full precision is unsuitable for an 8 GB-only GPU budget |
| Voxtral Mini 4B Realtime 2602 | Both among 13 languages | Future live-ASR comparator | Open realtime ASR is distinct from the hosted batch transcription/diarization product |

Whisper upstream describes turbo as a faster optimized large-v3 with some accuracy
loss. Its approximate Python-runtime VRAM figures are 5 GB for medium, 10 GB for
large and 6 GB for turbo. These are **not** estimates for the entire combined
pipeline, nor guarantees for a different runtime or quantization.
[Whisper model table](https://github.com/openai/whisper#available-models-and-languages).

whisper.cpp supports Windows, CPU inference, quantization and CUDA/Vulkan
acceleration. Rustcorder currently selects CPU explicitly; upstream capability is
not app capability. Native Whisper remains a useful low-disruption control.
[whisper.cpp](https://github.com/ggml-org/whisper.cpp).

Parakeet v3 provides word/segment timestamps and is CC BY 4.0. Its published
long-audio limits depend on attention mode and hardware, so evaluate bounded
processing and speaker consistency on complete recordings rather than importing
an advertised maximum as an app guarantee.
[Parakeet v3 model card](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3).

Qwen's ASR models and forced aligner support local provisioning; named-model
loading otherwise downloads assets. Its aligner supports Portuguese and English
and up to five minutes per input, so long recordings need correctly rebased
bounded alignment. Apache 2.0 applies to the published model.
[Qwen3-ASR model and usage](https://huggingface.co/Qwen/Qwen3-ASR-1.7B).

Canary v2 supplies word/segment timing under CC BY 4.0, but adding translation
would expand scope without answering the user's request.
[Canary v2 model card](https://huggingface.co/nvidia/canary-1b-v2).

VibeVoice integrates ASR, speaker labels and timestamps over long audio. Its
published metadata is 9B BF16, despite some descriptions referring to a smaller
language backbone. **Inference:** 9 billion parameters at two bytes require about
18 GB for weights alone, before working memory. Quantized or offloaded variants
need separate validation; reject the unquantized variant for this GPU shortlist.
[VibeVoice-ASR model card](https://huggingface.co/microsoft/VibeVoice-ASR).

Voxtral's open realtime model is Apache 2.0 and supports Portuguese, but its
capabilities must not be conflated with the separate batch diarization service.
It is lower priority for this completed-recording feature.
[Open realtime model](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602),
[Mistral's product distinction](https://mistral.ai/news/voxtral-transcribe-2/).

### What WhisperX adds, and what it does not prove

WhisperX combines faster-whisper, language-specific forced alignment and pyannote
speaker diarization. Its maintainers warn about overlapping speech, imperfect
diarization and words without alignable characters. Treat it as a complete
evaluation baseline, not a guarantee of correct words or all simultaneous voices.
[WhisperX documentation](https://github.com/m-bain/whisperX).

Current source selects Community-1 by default and exposes known/min/max speaker
counts. Portuguese alignment maps to a dedicated wav2vec2 checkpoint; preserve
unassigned words rather than assigning the nearest person without evidence.
[Diarization implementation](https://github.com/m-bain/whisperX/blob/main/whisperx/diarize.py),
[alignment mapping](https://github.com/m-bain/whisperX/blob/main/whisperx/alignment.py).

Current main-branch metadata says 3.8.7rc1, Python 3.10–3.13, PyTorch 2.8 and
pyannote-audio 4+. This is a moving source snapshot, not a tested version lock.
Resolve a compatible released dependency set during planning and validate Windows
decoding, required resources and all offline caches.
[WhisperX package metadata](https://github.com/m-bain/whisperX/blob/main/pyproject.toml).

faster-whisper is an inference implementation, not a separate trained recognition
model. It supports CPU/GPU int8 and local model directories. Upstream explicitly
requires equivalent decoding options, beam size and thread counts for comparisons.
Its documented CUDA dependencies differ from some WhisperX installation guidance;
test the chosen full dependency set rather than mixing tutorials. A local model
directory must include tokenizer/preprocessing files to avoid lazy downloads.
[faster-whisper requirements and comparison guidance](https://github.com/SYSTRAN/faster-whisper).

## Speaker diarization candidates

| Candidate | Local execution | Evaluation role | Principal limitation |
| --- | --- | --- | --- |
| pyannote Community-1 | CPU by default; optional CUDA; offline local pipeline | Established baseline, including automatic count estimation | Python/PyTorch assets and gated initial acquisition |
| Nemotron 3 Diarization | Offline/streaming; native runtime option documented | Main challenger; up to eight speaker identities | Recent integration; validate exact build, Portuguese, overlap and memory |
| Streaming Sortformer v2.1 | Local NeMo; four-speaker checkpoint | Optional comparison for later streaming work | Four-speaker ceiling; different runtime versions expose different checkpoint support |
| sherpa-onnx segmentation + embeddings + clustering | Native CPU-capable API, including Rust examples | Reserve option if native packaging outweighs baseline quality | This is not the complete Community-1 pipeline |
| whisper.cpp tinydiarize | Experimental speaker-turn markers | Exclude as the solution for this feature | Shown English model/change markers do not establish stable multilingual person identities |

Community-1 supports automatic or hinted counting and both ordinary and exclusive
diarization. Use ordinary overlapping activity for duration totals; exclusive
labels can help readable word attribution. Assets are CC BY 4.0, with Hugging Face
conditions/token needed for initial access and documented offline cloning. Its
published DER is 17.0% on AMI close-talk, 19.9% on AMI distant-mic and 26.7% on
CALLHOME. Those results include overlap with no forgiveness collar and are not
Brazilian Portuguese meeting guarantees.
[Community-1 model card](https://huggingface.co/pyannote/speaker-diarization-community-1).

Nemotron 3 was released on 2026-09-23, supports up to eight identities, and lists
OpenMDW-1.1 licensing. Its own DIHARD comparison reports 12.73% DER versus 19.09%
for Sortformer v2.1 at the listed offline-style setting. Do not directly compare
these numbers with a different publisher's benchmark: NVIDIA explicitly warns
that reference annotations, overlap and collar settings change the result.
[Nemotron 3 model card and evaluation protocol](https://huggingface.co/nvidia/Nemotron-3-Diarization).

The older streaming Sortformer v2.1 checkpoint has a four-speaker limit and
different licensing from Nemotron 3. It is a reserve experiment, not the default
answer merely because an older article calls it best.
[Sortformer v2.1 model card](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1).

NeMo-Speech.cpp now documents Parakeet v3 and Nemotron 3 support, local GGUF models
and Windows installation. Its CLI distinguishes offline-only Parakeet from
streaming models, and emits speaker-tagged words or standalone diarization. Named
defaults can automatically download missing weights. Therefore use explicit,
complete local paths and verify that the selected invocation cannot pull assets.
Validate raw overlap output separately: single speaker tags on words are
insufficient evidence that concurrent activity is preserved for statistics.
[Runtime overview](https://github.com/NVIDIA/NeMo-Speech.cpp),
[CLI behavior](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/cli.md).

Windows CPU/CUDA/Vulkan installation paths are documented, including required
build tools and the current lack of Windows text normalization. Check actual
release contents, DLL redistribution and target-device compatibility before
selecting this route; upstream documentation is not a successful Rustcorder build.
[Windows installation guide](https://github.com/NVIDIA/NeMo-Speech.cpp/blob/main/docs/install.md).

sherpa-onnx documents converted pyannote segmentation and Reverb segmentation,
speaker embeddings and clustering, with native/Rust APIs. A converted segmentation
model plus a different embedding/clusterer is not Community-1 and cannot inherit
its reported DER. Verify each selected weight's license and unknown-count behavior.
[Diarization APIs](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/index.html),
[model combinations](https://k2-fsa.github.io/sherpa/onnx/speaker-diarization/models.html).

tinydiarize's documented output inserts speaker-change markers with an experimental
small.en model. That does not establish who returns later or Portuguese support,
so it does not satisfy numbered-person analytics.
[Upstream example](https://github.com/ggml-org/whisper.cpp#speaker-segmentation-via-tinydiarize-experimental).

## CPU, GPU and offline packaging

The GPU has 8 GB total, shared with desktop graphics and the app. Do not budget all
of it for model weights. Measure peak **combined** memory, including decoder,
alignment and diarization. A runtime may need to release one model before loading
another, reduce batch size or use supported quantization. Each setting is a
separate measured option; do not silently lower quality after a resource failure.

| Evaluation lane | What to measure | Pass condition |
| --- | --- | --- |
| Existing CPU baseline | Rerun base/small on the new conversations | Establish current quality and elapsed time, not historical FLEURS assumptions |
| Native CPU | Larger/quantized Whisper; native Parakeet plus diarizer | Honest memory/time results and existing recording independence |
| GPU quality | large-v3/turbo or Parakeet, plus alignment/diarization | Fit available 8 GB memory with declared settings and meet feature quality/time gates |
| CPU without acceleration | Missing/disabled GPU, complete local assets | Existing CPU workflow remains usable; unsupported quality configurations are explained |

Keep normal use independent of package managers, online authentication, hosted
servers or model identifiers that trigger downloads. Record every model revision,
hash, tokenizer, alignment asset, VAD asset, runtime version and required DLL.
Pin and supply applicable notices for code and weights separately. The Portuguese
wav2vec2 alignment checkpoint currently lists Apache 2.0; inspect the exact
downloaded revision rather than treating every alignment asset as identically
licensed. [Portuguese alignment model](https://huggingface.co/jonatasgrosman/wav2vec2-large-xlsr-53-portuguese).

pyannote exposes optional usage telemetry. Explicitly disable it for Rustcorder
and verify no connection attempts; disconnected execution alone would not reveal
attempts. Initial gated model acquisition remains outside ordinary analysis and
does not justify embedding tokens or adding online login to the product.
[pyannote telemetry documentation](https://github.com/pyannote/pyannote-audio#telemetry).

## Precisely defining participation highlights

These are product definitions proposed for this feature, not claims from a model
publisher. Speaker numbers apply to one result only; they are assigned by first
attributed appearance. Report **estimated speaker count**, since automatic
clustering can split one person or merge similar voices. A supplied count is a
hint with visible provenance and must not be scored as automatic counting.

For each speaker, union their detected activity intervals to remove duplicates.
Their **speaking duration** is the sum of unioned lengths; never bridge pauses when
calculating duration. Their **speech share** is their duration divided by the sum
of all attributed speaker durations. Unassigned speech is shown separately.

For **turn count**, join successive intervals of the same person only when the
gap is at most 0.5 seconds and no different-person or unassigned speech occurs
inside that gap. Overlap during a person's ongoing speech does not split their
turn. Count the resulting chains, not text chunks, sentences or speaker switches.
This is an explicit initial product convention; validate it with actual conversations.

Calculate elapsed speech, silence, overlap and unassigned time using interval
unions on the original timeline. Overlap means at least two attributed speakers
active simultaneously. A person's time can overlap another person's time, so
summed person-time and elapsed speech are different quantities. Speech share sums
to approximately 100% after rounding, but person-time need not equal recording time.

Example: a 20-second recording has Person 1 at [0, 5) and [8, 10), Person 2 at
[4, 8), and unassigned speech at [12, 13).

| Result | Value |
| --- | ---: |
| Person 1 | 7.0 seconds; 63.6% share; 2 turns |
| Person 2 | 4.0 seconds; 36.4% share; 1 turn |
| Attributed speaker-time denominator | 11.0 seconds |
| Elapsed attributed speech | 10.0 seconds |
| Elapsed any speech, including unassigned | 11.0 seconds |
| Overlap | 1.0 second |
| Unassigned speech | 1.0 second |
| No detected speech | 9.0 seconds |

Use a labelled summary table and timestamped passages. Start with these factual
participation highlights; semantic summaries, topic ranking, action items, emotion
and inferred interruption intent need a separate request. Speaker labels do not
identify real people, and microphone/output channels do not identify participants.

## Evaluation that can justify a choice

1. **Freeze real references.** Use at least 60 minutes across 12 conversations,
   at least 30 minutes each of Brazilian Portuguese and English. Include one to
   four participants, returning voices, compressed call audio, quiet voices,
   noise, names/technical vocabulary and annotated overlap. Keep at least four
   conversations held out, two per language. Store private audio outside Git;
   use licensed or permissioned fixtures and preserve source hashes.
2. **Separate words from speakers.** Compare recognition first using identical
   inputs, normalization and documented decoding. Evaluate diarizers against human
   speech activity separately, then test combined word attribution. Report
   speaker-attributed word errors too, since a good overall transcript can be
   attributed to the wrong people. Do not tune to the held-out references.
3. **Use comparable speaker scoring.** Report DER with no collar and overlap
   included, plus miss/false-alarm/confusion components, automatic count accuracy,
   speaker-time error and turn-count error using the product convention. Match
   anonymous labels optimally to reference people. Preserve reference revisions.
   DER can be misleadingly changed by collar/overlap choices; the metrics library
   documents these controls. [pyannote.metrics reference](https://pyannote.github.io/pyannote-metrics/reference.html).
4. **Measure the entire workflow.** Include model load, decoding, recognition,
   alignment, diarization and report generation in cold time; report warm time
   separately. Capture RAM/VRAM peaks, cancellation and UI responsiveness. Test a
   10-minute conversation for the feature gate, a 60-minute conversation for
   sustained behavior, and the existing maximum-duration boundary with cheap
   fixtures plus real long-audio tests as resources permit. Do not infer live
   latency from offline throughput or a server benchmark's batching speed.
5. **Retain failure controls.** Digital silence, quiet noise, tones, music,
   attenuated real speech, missing/corrupt assets, missing tokenizer/aligner,
   resource failure, worker failure, export failure and cancellation. Verify an
   analysis failure preserves audio and successful text.
6. **Prove offline behavior twice.** Run with networking disabled and trace with
   networking available to find attempted downloads/telemetry. Test a clean
   Windows account without a developer cache, Python installation or CUDA toolkit
   unless these are explicit distribution prerequisites.

Proposed acceptance targets are in the spec: at least 20% relative WER reduction
against the better current option **per language on the new held-out corpus**,
DER at most 15% per language, exact speaker count on at least 90% of the full set,
bounded duration error, correct deterministic arithmetic and a 10-minute quality
analysis within 20 minutes on the declared machine. These are product targets,
not published promises. If none pass, report the failure and adjust scope or
targets explicitly; do not declare success from a different benchmark.

## Research limits and next decision

This research reviewed primary repositories, source files, model cards and
publisher documentation. It did not run the candidate models, audit dependencies,
accept gated model terms, verify redistribution obligations, or prove clean-host
installation. Main-branch capabilities can precede releases; pin exact revisions
and recheck compatibility at planning time. Published performance claims remain
publisher results, not results on Rustcorder's recordings.

Two guessed NeMo guide paths (`docs/diarization.md` and `docs/asr/diarization.md`)
returned 404. The model card's actual guide link resolves to the accessible
`docs/cli.md` cited above; no claims depend on the inaccessible paths.

The next step is `/speckit-plan`: define a bounded local comparison, verify the
chosen Windows runtime/assets and choose one combination from measured evidence.
Implementation then follows the repository's test-first policy. No source-code,
branch, release or changelog change was made for this research.
